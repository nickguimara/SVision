import path from "node:path";

import { TextDocument } from "vscode-languageserver-textdocument";

import {
  createConnection,
  DocumentHighlightKind,
  ProposedFeatures,
  TextDocumentSyncKind,
  type TextDocumentSyncOptions,
} from "vscode-languageserver/node";
import type {
  CompletionItem,
  CompletionList,
  Connection,
  DidChangeConfigurationParams,
  DocumentSymbolParams,
  InitializeParams,
  InitializeResult,
  ReferenceParams,
  ServerCapabilities,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";

import { Catalog } from "./catalog.js";
import { DocumentManager } from "./documentManager.js";
import { VerilogParser } from "./verilogParser.js";
import { IncludeResolver } from "./includes.js";
import { TopResolver, type TopUnit } from "./top.js";
import { DEFAULT_INDEX_OPTIONS, WorkspaceIndexer } from "./workspaceIndex.js";
import { completionContext, provideCompletion, type CompletionSettings } from "./providers/completion.js";
import { provideHover } from "./providers/hover.js";
import { provideSignatureHelp } from "./callables.js";
import { provideDefinition, provideReferences } from "./providers/definition.js";
import { provideDocumentSymbols } from "./providers/documentSymbols.js";
import { moduleOfSignal, traceSignal, type TraceHop } from "./trace.js";
import { buildNavigator } from "./navigator.js";
import { computeDiagnostics, type DiagnosticSettings } from "./providers/diagnostics.js";

/** Shape of the `initializationOptions` sent by the extension host. */
interface ServerOptions {
  index?: { include?: string[]; exclude?: string[]; maxFiles?: number };
  /**
   * Folder of the document being edited, sent by the client.
   *
   * The protocol's own `workspaceFolders` is empty when a single file is opened
   * without a folder, and without this the packages sitting beside that file are
   * never indexed -- so `cfg_pkg::WIDTH` has nothing to resolve against.
   */
  workspaceFolder?: string | null;
}

/** How long to wait after the last keystroke before running diagnostics. */
const DIAGNOSTIC_DEBOUNCE_MS = 250;

/** How long to wait after the last keystroke before following an `include`. */
const INCLUDE_DEBOUNCE_MS = 400;

const connection: Connection = createConnection(ProposedFeatures.all);

const catalog = new Catalog();

/**
 * Shared by every indexer the server builds.
 *
 * The handshake may replace the indexer with one configured from the client's
 * settings, and a resolver of its own would start out knowing no files -- which
 * would undo the includes resolved during the first pass.
 */
const includes = new IncludeResolver();

/**
 * Which module the design hangs from.
 *
 * Held for the life of the session and rebuilt only when the design changes,
 * which is what the structure version inside the catalog is for: the answer
 * cannot depend on which file happens to be open.
 */
const tops = new TopResolver(catalog);

/** Created once the grammar is loaded; every handler reads through it. */
let documents: DocumentManager;
/** Rebuilt from client options during `onInitialize`. */
let indexer: WorkspaceIndexer;

const completionSettings: CompletionSettings = {
  showWidth: true,
  showType: true,
  snippets: true,
  systemFunctions: true,
  includeParameters: true,
};

const diagnosticSettings: DiagnosticSettings = {
  enable: true,
  unknownIdentifiers: true,
  widthMismatch: true,
  blockingInSequential: true,
  implicitSensitivity: true,
  latchDetection: true,
};

const pendingDiagnostics = new Map<string, NodeJS.Timeout>();

/** Documents whose `include`s still have to be resolved and read. */
const pendingIncludeFollows = new Set<string>();
let includeTimer: NodeJS.Timeout | undefined;

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * The SystemVerilog grammar ships as WebAssembly, so the runtime must be
 * initialised before any document can be parsed. Handlers are registered only
 * after that completes, which guarantees no request arrives against a
 * half-built server.
 */
async function main(): Promise<void> {
  const parser = await VerilogParser.create();

  documents = new DocumentManager(parser);
  indexer = new WorkspaceIndexer(parser, catalog, DEFAULT_INDEX_OPTIONS, includes);

  // Analysis needs the workspace's class names to tell `Packet pkt;` from a
  // one-bit net, and the catalog is what holds them.
  documents.knownClasses = () => catalog.classNames();
  // A width written in terms of a package parameter needs that parameter's
  // value, which lives in whichever file declares the package.
  documents.importedParameterValues = (name) => catalog.parameterValues(name);
  // A `` `NAME(args) `` declaration stands for one written in whichever file
  // defines the macro, so the workspace-wide set is needed to read it.
  documents.macros = () => indexer.macros;

  registerInitialize(parser);
  registerDocumentHandlers();
  registerLanguageHandlers();

  connection.onShutdown(() => {
    for (const timer of pendingDiagnostics.values()) clearTimeout(timer);
    pendingDiagnostics.clear();
    if (includeTimer) clearTimeout(includeTimer);
    pendingIncludeFollows.clear();
    parser.dispose();
  });

  connection.listen();
}

function registerInitialize(parser: VerilogParser): void {
  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const options = (params.initializationOptions ?? {}) as ServerOptions;
    if (options.index) {
      indexer = new WorkspaceIndexer(
        parser,
        catalog,
        {
          include: options.index.include ?? DEFAULT_INDEX_OPTIONS.include,
          exclude: options.index.exclude ?? DEFAULT_INDEX_OPTIONS.exclude,
          maxFiles: options.index.maxFiles ?? DEFAULT_INDEX_OPTIONS.maxFiles,
        },
        includes,
      );
    }

    const sync: TextDocumentSyncOptions = {
      openClose: true,
      change: TextDocumentSyncKind.Full,
      save: { includeText: false },
    };

    const capabilities: ServerCapabilities = {
      textDocumentSync: sync,
      completionProvider: {
        resolveProvider: false,
        // Dot starts a port/parameter binding, `#` a parameter override,
        // `(` a connection list, and space reopens the list after a keyword
        // such as `assign`. The response for an empty prefix is small and
        // stable, so triggering on space does not make it flicker.
        triggerCharacters: [".", ":", "#", "(", " "],
      },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: ["(", ","], retriggerCharacters: [")"] },
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentSymbolProvider: true,
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    };

    // Indexing runs after the handshake so the editor stays responsive.
    void indexWorkspace(params);

    return { capabilities, serverInfo: { name: "svision", version: "0.2.3" } };
  });
}

/** Folders already indexed, so a new document never triggers a second scan. */
const indexedRoots = new Set<string>();

/**
 * Re-analyses and re-diagnoses every open document.
 *
 * Indexing runs after the handshake, so whatever is on screen was analysed
 * against an empty catalog. That shows up twice: a module that imports a
 * package reports every one of its parameters as undeclared, *and* a port
 * written `[C_PKT_DAT_W-1:0]` has no width, because folding the constant
 * needed the value that only arrived with the index.
 *
 * Re-diagnosing alone would fix the first and not the second, so the analysis
 * itself is redone. This is what makes the findings clear on their own once
 * the workspace has been read, without the user having to type something.
 */
function refreshOpenDocuments(): void {
  for (const entry of documents.all()) {
    const updated = documents.reanalyze(entry.document.uri);
    if (!updated) continue;
    indexOpenDocument(updated.document.uri);
    scheduleDiagnostics(updated.document.uri, true);
  }
}

/**
 * Records what an open document contributes to the workspace, and resolves the
 * includes it writes.
 *
 * The directives come from the analysis the document manager already produced,
 * rather than from another pass over the tree: they are needed on every
 * keystroke, and walking the tree a second time to find lines that rarely change
 * is exactly the cost this is meant to avoid.
 */
function indexOpenDocument(uri: string): void {
  const entry = documents.get(uri);
  if (!entry) return;

  catalog.replaceDocument(uri, entry.analysis.scopes, entry.analysis.accesses, entry.analysis.unitSymbols);
  indexer.followIncludes(uri, entry.analysis.includes);
}

/**
 * Reads the headers an open document's includes name.
 *
 * With no workspace folder open the walk only ever sees the folder of the file
 * that was opened, and the package it pulls in is usually a couple of folders
 * away -- so `cfg_pkg::WIDTH` has nothing to resolve against. Reading what the
 * document itself asks for closes that gap, and it stays bounded by the
 * document: one lookup per include directive, over files whose paths a human
 * wrote down.
 *
 * Debounced, because the only thing that changes it is an edit, and a line of
 * text being typed should not turn into a filesystem walk. Several documents
 * edited in quick succession share one pass.
 */
function scheduleIncludeFollow(uri: string): void {
  pendingIncludeFollows.add(uri);
  if (includeTimer) return;

  includeTimer = setTimeout(() => {
    includeTimer = undefined;
    const uris = [...pendingIncludeFollows];
    pendingIncludeFollows.clear();

    void (async () => {
      for (const target of uris) {
        indexer.followIncludes(target, documents.get(target)?.analysis.includes ?? []);
      }
      const reached = await indexer.indexReachedIncludes();
      if (reached === 0) return;

      connection.console.log(
        `[svision] read ${reached} header(s) reached by an \`include from ${uris.join(", ")}`,
      );
      // Those documents were analysed before their headers were in the catalog.
      refreshOpenDocuments();
      // Reading a file teaches the resolver about it, which can turn an earlier
      // "not found" into a hit -- so the report is reissued rather than left
      // claiming a header is missing when it is not.
      reportMissingIncludes();
    })();
  }, INCLUDE_DEBOUNCE_MS);
}

async function indexWorkspace(params: InitializeParams): Promise<void> {
  const options = (params.initializationOptions ?? {}) as ServerOptions;

  // Three sources, in order of authority. The protocol's workspace folders come
  // first, then the deprecated root, then the folder the client attached the
  // editing document to -- which is the one that saves single-file use, where
  // every `workspaceFolders` field is empty but the packages are still sitting
  // next to the file.
  const roots: string[] = [];
  const add = (uri: string | null | undefined): void => {
    const decoded = uri ? decodeFileUri(uri) : undefined;
    if (decoded && !roots.includes(decoded)) roots.push(decoded);
  };

  if (params.workspaceFolders?.length) {
    for (const folder of params.workspaceFolders) add(folder.uri);
  } else {
    add(params.rootUri ?? null);
    add(options.workspaceFolder);
  }

  if (roots.length === 0) return;

  const started = Date.now();
  let indexed = 0;
  for (const root of roots) {
    if (indexedRoots.has(root)) continue;
    indexedRoots.add(root);
    indexed += await indexer.indexFolders([root]);
  }
  const elapsed = Date.now() - started;

  connection.console.log(
    `[svision] indexed ${indexed} file(s) in ${elapsed}ms` +
      (indexer.wasTruncated ? " (truncated at the file limit)" : "") +
      `, ${catalog.units().length} design unit(s) known` +
      `, ${indexer.macros.size} macro(s) known`,
  );

  // The macros a design calls but the workspace cannot explain.
  //
  // `include` is not followed, so a definition sitting in a vendor library or a
  // file list outside the workspace leaves every signal it declares looking
  // undeclared. Naming the macros is the difference between a tool bug and a
  // missing file, and it takes one glance at the output channel instead of a
  // guessing game.
  if (indexer.undefinedMacros.size > 0) {
    const shown = [...indexer.undefinedMacros.keys()].slice(0, 20);
    connection.console.log(
      `[svision] ${indexer.undefinedMacros.size} macro(s) are called but not defined in the workspace ` +
        `(the header that defines them was not reached): ${shown.join(", ")}` +
        (shown.length < indexer.undefinedMacros.size ? ", ..." : ""),
    );
  }

  // Anything already on screen was analysed without this catalog.
  refreshOpenDocuments();

  // An include the editor could not place is a missing file, and nothing else
  // in the session would say so: every type and macro it declared simply is not
  // there, and the symptom points at the extension rather than at the file list.
  reportMissingIncludes();

  reportDesignTop();
}

/**
 * Names the includes that resolved to nothing, and who asks for them.
 *
 * The counterpart to the undefined-macro report. A macro is missing because its
 * file could not be reached; the include says which file that was, so the two
 * together turn "this type is unknown" into "you are missing `defines.svh`".
 */
function reportMissingIncludes(): void {
  const missing = includes.missing;
  if (missing.size === 0) return;

  const shown = [...missing.entries()].slice(0, 20);
  const format = ([target, askers]: [string, ReadonlySet<string>]): string =>
    `${target} (from ${[...askers].slice(0, 3).map(baseNameOfUri).join(", ")})`;

  connection.console.log(
    `[svision] ${missing.size} \`include name(s) could not be found in the workspace: ` +
      shown.map(format).join(", ") +
      (shown.length < missing.size ? ", ..." : "") +
      " (each one was searched beside the including file, in the folders above it, " +
      "at every workspace root and by name across the whole project)",
  );
}

function baseNameOfUri(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts[parts.length - 1] ?? uri;
}

/**
 * Logs the module the design hangs from.
 *
 * Read once here so the number in the log is the one the sidebar uses, and so a
 * project whose top is not the module the user happens to have open still has
 * one place that says what the design is.
 */
function reportDesignTop(): void {
  const top = tops.top();
  if (!top) return;

  const others = tops.roots().filter((root) => root.name !== top.name);
  connection.console.log(
    `[svision] design top: ${top.name} (${top.reach} design unit(s) below it)` +
      (others.length > 0 ? `; also a root: ${others.map((root) => root.name).join(", ")}` : ""),
  );
}

/**
 * Indexes the folder a newly opened document belongs to, once.
 *
 * This is what makes packages beside a loose file discoverable: with no
 * workspace folder open, `initialize` had nothing to scan, so
 * `cfg_pkg::WIDTH` had no `cfg_pkg` to resolve against until the user happened
 * to open a folder.
 *
 * The folder on its own is not enough. A package kept in `../pkg/` is not beside
 * the file that uses it, which is why the document's own includes are followed
 * as well -- the include names the file, and nothing else does.
 */
function indexFolderOf(uri: string): void {
  const decoded = decodeFileUri(uri);
  if (!decoded) return;

  const folder = path.dirname(decoded);
  if (indexedRoots.has(folder)) return;

  indexedRoots.add(folder);
  void indexer.indexFolders([folder]).then(async (count) => {
    connection.console.log(`[svision] indexed ${folder} after it was opened (${count} file(s))`);
    // Same reason as the startup pass: this document was analysed before the
    // package sitting next to it was in the catalog.
    refreshOpenDocuments();
    scheduleIncludeFollow(uri);
    reportMissingIncludes();
    reportDesignTop();
  });
}

/* ------------------------------------------------------------------ *
 * Whole-design issue list
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Document synchronisation
 * ------------------------------------------------------------------ */

function registerDocumentHandlers(): void {
  connection.onDidOpenTextDocument((event) => {
    const document = TextDocument.create(
      event.textDocument.uri,
      event.textDocument.languageId,
      event.textDocument.version,
      event.textDocument.text,
    );
    const entry = documents.update(document.uri, document);
    indexOpenDocument(entry.document.uri);
    indexFolderOf(document.uri);
    scheduleIncludeFollow(entry.document.uri);
    scheduleDiagnostics(entry.document.uri);
  });

  connection.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length === 0) return;
    const existing = documents.get(event.textDocument.uri);
    if (!existing) return;

    // Full sync: the client sends the whole document on every change.
    const document = TextDocument.create(
      event.textDocument.uri,
      existing.document.languageId,
      event.textDocument.version,
      event.contentChanges[0]!.text,
    );

    const entry = documents.update(document.uri, document);
    indexOpenDocument(entry.document.uri);
    // A line of `include just typed names a file nothing has read yet, and the
    // folder walk is long over.
    scheduleIncludeFollow(entry.document.uri);
    // The whole-design list has to stay in step with the catalog, because its
    // checks read port directions from it.
    scheduleDiagnostics(entry.document.uri);
  });

  connection.onDidSaveTextDocument((event) => {
    scheduleDiagnostics(event.textDocument.uri, true);
  });

  connection.onDidCloseTextDocument((event) => {
    const timer = pendingDiagnostics.get(event.textDocument.uri);
    if (timer) {
      clearTimeout(timer);
      pendingDiagnostics.delete(event.textDocument.uri);
    }
    connection.sendDiagnostics({ uri: event.textDocument.uri, diagnostics: [] });
    documents.close(event.textDocument.uri);
    indexer.forgetDocument(event.textDocument.uri);
    // The catalog entry stays: the file still exists on disk.
  });

  connection.onDidChangeConfiguration((params: DidChangeConfigurationParams) => {
    readSettings((params.settings ?? {}) as Record<string, unknown>);
    for (const entry of documents.all()) scheduleDiagnostics(entry.document.uri, true);
  });
}

function readSettings(settings: Record<string, unknown>): void {
  const source = (settings.svision ?? settings) as Record<string, unknown>;

  const bool = (key: string, fallback: boolean): boolean =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : fallback;

  completionSettings.showWidth = bool("completion.showWidth", completionSettings.showWidth);
  completionSettings.showType = bool("completion.showType", completionSettings.showType);
  completionSettings.snippets = bool("completion.snippets", completionSettings.snippets);
  completionSettings.systemFunctions = bool(
    "completion.includeSystemFunctions",
    completionSettings.systemFunctions,
  );
  completionSettings.includeParameters = bool(
    "completion.includeParameters",
    completionSettings.includeParameters,
  );

  diagnosticSettings.enable = bool("diagnostics.enable", diagnosticSettings.enable);
  diagnosticSettings.unknownIdentifiers = bool(
    "diagnostics.unknownIdentifiers",
    diagnosticSettings.unknownIdentifiers,
  );
  diagnosticSettings.widthMismatch = bool("diagnostics.widthMismatch", diagnosticSettings.widthMismatch);
  diagnosticSettings.blockingInSequential = bool(
    "diagnostics.blockingInSequential",
    diagnosticSettings.blockingInSequential,
  );
  diagnosticSettings.implicitSensitivity = bool(
    "diagnostics.implicitSensitivity",
    diagnosticSettings.implicitSensitivity,
  );
  diagnosticSettings.latchDetection = bool("diagnostics.latchDetection", diagnosticSettings.latchDetection);
}

function scheduleDiagnostics(uri: string, immediate = false): void {
  const existing = pendingDiagnostics.get(uri);
  if (existing) clearTimeout(existing);

  const run = () => {
    pendingDiagnostics.delete(uri);
    const entry = documents.get(uri);
    if (!entry) return;
    const items = computeDiagnostics(
      entry.document,
      entry.analysis,
      catalog,
      diagnosticSettings,
      includes,
    );
    connection.sendDiagnostics({ uri, diagnostics: items });
  };

  if (immediate) run();
  else pendingDiagnostics.set(uri, setTimeout(run, DIAGNOSTIC_DEBOUNCE_MS));
}

/* ------------------------------------------------------------------ *
 * Language features
 * ------------------------------------------------------------------ */

function entryAt(params: TextDocumentPositionParams) {
  const entry = documents.get(params.textDocument.uri);
  if (!entry) return undefined;
  return { entry, offset: entry.document.offsetAt(params.position) };
}

function registerLanguageHandlers(): void {
  connection.onSignatureHelp((params) => {
    const found = entryAt(params);
    return found ? provideSignatureHelp(found.entry.document, found.entry.analysis, catalog, found.offset, includes) : null;
  });
  // One level of the RTL viewer: the submodule blocks of a module, the nets
  // between them, and the breadcrumb back up to the top.
  // Drivers and loads of one signal, followed across module boundaries.
  connection.onRequest(
    "svision/signalTrace",
    (request: { module: string; signal: string; uri: string }): TraceHop | null => {
      if (!request.module || !request.signal) return null;
      return (
        traceSignal(
          { moduleName: request.module, uri: request.uri, signal: request.signal },
          catalog,
          undefined,
          documents.get(request.uri)?.analysis,
        ) ?? null
      );
    },
  );

  /**
   * Which module a file, or a signal inside it, belongs to.
   *
   * The sidebar needs this to decide what the RTL viewer and the tracer should
   * start from when the user has not picked anything explicitly.
   */
  connection.onRequest(
    "svision/moduleAt",
    (request: { uri: string; signal?: string }): string | null => {
      const entry = documents.get(request.uri);
      if (!entry) return null;

      if (request.signal) {
        // The first mention of the name is enough: a signal lives in one scope,
        // and moduleOfSignal checks that the scope really declares it.
        const first = entry.analysis.uses.find((u) => u.name === request.signal);
        const offset = first ? entry.document.offsetAt(first.range.start) : 0;

        const scope = moduleOfSignal(entry.analysis, request.signal, offset);
        if (scope) return scope.name;
      }

      return entry.analysis.scopes.find((s) => s.category === "module")?.name ?? null;
    },
  );

  /**
 * The navigator: every declaration of one file, grouped.
 *
 * Strictly local -- no workspace lookup -- because the question it answers is
 * about the file the user is editing.
 */
connection.onRequest("svision/navigator", (request: { uri: string }) => {
  const entry = documents.get(request.uri);
  if (!entry) return null;
  return buildNavigator(entry.analysis);
});

/**
   * Which module the project hangs from.
   *
   * Answered from the catalog's instantiation graph and kept until the design
   * changes, so asking twice costs nothing. A file with no module of its own --
   * a header, a package -- is answered with the top that reaches the rest, which
   * is the only way to place it in the design at all.
   */
  connection.onRequest(
    "svision/designTop",
    (request: { uri?: string; module?: string }): { top: TopUnit | null; roots: TopUnit[] } => {
      const roots = tops.roots();

      if (request.module) {
        const owner = tops.topOf(request.module);
        return { top: owner ?? roots[0] ?? null, roots };
      }

      if (request.uri) {
        const entry = documents.get(request.uri);
        const own = entry?.analysis.scopes.find((scope) => scope.category === "module")?.name;
        const owner = own ? tops.topOf(own, request.uri) : undefined;
        if (owner) return { top: owner, roots };
      }

      return { top: roots[0] ?? null, roots };
    },
  );

  /** Module names available in the workspace, for the viewer's entry points. */
  connection.onRequest("svision/designUnits", () =>
    catalog.units().map((e) => ({
      name: e.name,
      kind: e.kind,
      uri: e.uri,
      range: e.selectionRange,
      childCount: e.instances.length,
    })),
  );
  connection.onCompletion((params): CompletionList | CompletionItem[] => {
    const found = entryAt(params);
    if (!found) return { isIncomplete: false, items: [] };
    const context = completionContext(found.entry.document, found.entry.analysis, found.offset);
    return provideCompletion(context, documents, catalog, completionSettings, includes);
  });

  connection.onHover((params) => {
    const found = entryAt(params);
    if (!found) return null;
    return provideHover(
      found.entry.document,
      found.entry.analysis,
      catalog,
      found.offset,
      {
        showWidth: completionSettings.showWidth,
        showType: completionSettings.showType,
      },
      includes,
    );
  });

  connection.onDefinition((params) => {
    const found = entryAt(params);
    if (!found) return null;
    return provideDefinition(found.entry.document, found.entry.analysis, catalog, found.offset, includes);
  });

  connection.onReferences((params: ReferenceParams) => {
    const found = entryAt(params);
    if (!found) return [];
    return provideReferences(
      found.entry.document,
      found.entry.analysis,
      found.offset,
      params.context.includeDeclaration,
    );
  });

  connection.onDocumentHighlight((params) => {
    const found = entryAt(params);
    if (!found) return [];
    return provideReferences(found.entry.document, found.entry.analysis, found.offset, true).map(
      (location) => ({ range: location.range, kind: DocumentHighlightKind.Text }),
    );
  });

  connection.onDocumentSymbol((params: DocumentSymbolParams) => {
    const entry = documents.get(params.textDocument.uri);
    if (!entry) return [];
    return provideDocumentSymbols(entry.analysis);
  });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function decodeFileUri(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  const withoutScheme = decodeURIComponent(uri.slice("file://".length));
  return withoutScheme.startsWith("/") ? withoutScheme : `/${withoutScheme}`;
}

void main().catch((error: unknown) => {
  connection.console.error(`[svision] fatal startup error: ${String(error)}`);
  process.exit(1);
});
