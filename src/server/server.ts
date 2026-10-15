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
import { DEFAULT_INDEX_OPTIONS, WorkspaceIndexer } from "./workspaceIndex.js";
import { completionContext, provideCompletion, type CompletionSettings } from "./providers/completion.js";
import { provideHover } from "./providers/hover.js";
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

const connection: Connection = createConnection(ProposedFeatures.all);

const catalog = new Catalog();

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
  indexer = new WorkspaceIndexer(parser, catalog, DEFAULT_INDEX_OPTIONS);

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
    parser.dispose();
  });

  connection.listen();
}

function registerInitialize(parser: VerilogParser): void {
  connection.onInitialize((params: InitializeParams): InitializeResult => {
    const options = (params.initializationOptions ?? {}) as ServerOptions;
    if (options.index) {
      indexer = new WorkspaceIndexer(parser, catalog, {
        include: options.index.include ?? DEFAULT_INDEX_OPTIONS.include,
        exclude: options.index.exclude ?? DEFAULT_INDEX_OPTIONS.exclude,
        maxFiles: options.index.maxFiles ?? DEFAULT_INDEX_OPTIONS.maxFiles,
      });
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
        triggerCharacters: [".", "#", "(", " "],
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentSymbolProvider: true,
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    };

    // Indexing runs after the handshake so the editor stays responsive.
    void indexWorkspace(params);

    return { capabilities, serverInfo: { name: "svision", version: "0.2.0" } };
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
    catalog.replaceDocument(updated.document.uri, updated.analysis.scopes, updated.analysis.accesses);
    scheduleDiagnostics(updated.document.uri, true);
  }
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
        `(include paths are not followed): ${shown.join(", ")}` +
        (shown.length < indexer.undefinedMacros.size ? ", ..." : ""),
    );
  }

  // Anything already on screen was analysed without this catalog.
  refreshOpenDocuments();
}

/**
 * Indexes the folder a newly opened document belongs to, once.
 *
 * This is what makes packages beside a loose file discoverable: with no
 * workspace folder open, `initialize` had nothing to scan, so
 * `cfg_pkg::WIDTH` had no `cfg_pkg` to resolve against until the user happened
 * to open a folder.
 */
function indexFolderOf(uri: string): void {
  const decoded = decodeFileUri(uri);
  if (!decoded) return;

  const folder = path.dirname(decoded);
  if (indexedRoots.has(folder)) return;

  indexedRoots.add(folder);
  void indexer.indexFolders([folder]).then((count) => {
    connection.console.log(`[svision] indexed ${folder} after it was opened (${count} file(s))`);
    // Same reason as the startup pass: this document was analysed before the
    // package sitting next to it was in the catalog.
    refreshOpenDocuments();
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
    catalog.replaceDocument(entry.document.uri, entry.analysis.scopes, entry.analysis.accesses);
    indexFolderOf(document.uri);
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
    catalog.replaceDocument(entry.document.uri, entry.analysis.scopes, entry.analysis.accesses);
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
    const items = computeDiagnostics(entry.document, entry.analysis, catalog, diagnosticSettings);
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
    return provideCompletion(context, documents, catalog, completionSettings);
  });

  connection.onHover((params) => {
    const found = entryAt(params);
    if (!found) return null;
    return provideHover(found.entry.document, found.entry.analysis, catalog, found.offset, {
      showWidth: completionSettings.showWidth,
      showType: completionSettings.showType,
    });
  });

  connection.onDefinition((params) => {
    const found = entryAt(params);
    if (!found) return null;
    return provideDefinition(found.entry.document, found.entry.analysis, catalog, found.offset);
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