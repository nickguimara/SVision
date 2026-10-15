import {
  CompletionItemKind,
  type CompletionItem,
  type CompletionList,
  type TextDocument,
} from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

import type { Analysis, HdlScope, HdlSymbol } from "../model.js";
import { scopeChain, visibleSymbols } from "../model.js";
import { nodeAt } from "../locate.js";
import { resolveNamedBlock } from "../hierarchy.js";
import type { Catalog } from "../catalog.js";
import type { DocumentManager } from "../documentManager.js";
import { importedMembers } from "../imports.js";
import { staticCompletionItems } from "../completionData.js";
import {
  CATEGORY_LABEL,
  describeSymbol,
  documentationFor,
  toCompletionKind,
} from "../symbolFormatting.js";

export interface CompletionSettings {
  showWidth: boolean;
  showType: boolean;
  snippets: boolean;
  systemFunctions: boolean;
  includeParameters: boolean;
}

export interface CompletionContext {
  analysis: Analysis;
  document: TextDocument;
  offset: number;
  /** Text typed at the cursor, used for fuzzy filtering and range maths. */
  prefix: string;
  /** Word characters immediately before the cursor. */
  rangeStart: number;
}

export function completionContext(document: TextDocument, analysis: Analysis, offset: number): CompletionContext {
  const text = document.getText();
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1]!)) start--;
  return { analysis, document, offset, prefix: text.slice(start, offset), rangeStart: start };
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Produces the completion list for a position.
 *
 * Context-sensitive behaviour:
 *  - inside a `.port(` connection  -> only that instance's ports
 *  - inside a `.PARAM(` override  -> only that instance's parameters
 *  - after `ifc.` of an interface -> that interface's members
 *  - at an instantiation type    -> only design units in the workspace
 *  - otherwise                   -> visible symbols + keywords + snippets
 */
export function provideCompletion(
  context: CompletionContext,
  documents: DocumentManager,
  catalog: Catalog,
  settings: CompletionSettings,
): CompletionList {
  const items: CompletionItem[] = [];
  const connection = instantiationContext(context);

  if (connection) {
    return {
      isIncomplete: false,
      items: connectionItems(connection, context, catalog, settings),
    };
  }

  // `DUT_if.` -- the members of an interface instance, or of a submodule.
  const member = memberAccessContext(context, catalog);
  if (member) {
    return { isIncomplete: false, items: member.items };
  }

  // Visible HDL declarations.
  const chain = scopeChain(context.analysis, context.offset);
  const scope = chain[chain.length - 1];
  const symbols = visibleSymbols(context.analysis, context.offset);

  for (const symbol of symbols) {
    if ((symbol.category === "parameter" || symbol.category === "localparam") && !settings.includeParameters) {
      continue;
    }
    items.push(symbolItem(symbol, context, settings, "1"));
  }

  // Names made visible by `import cfg_pkg::*`. They are not declared here, so
  // without this a perfectly good cross-file parameter is simply absent from
  // the list.
  const alreadyOffered = new Set(symbols.map((s) => s.name));
  for (const imported of importedMembers(context.analysis, catalog, context.offset)) {
    if (alreadyOffered.has(imported.symbol.name)) continue;
    alreadyOffered.add(imported.symbol.name);
    if (
      (imported.symbol.category === "parameter" || imported.symbol.category === "localparam") &&
      !settings.includeParameters
    ) {
      continue;
    }

    const item = symbolItem(imported.symbol, context, settings, "1");
    item.detail = `${item.detail ?? ""} · ${imported.packageName}::`.trim();
    items.push(item);
  }

  // Design units: modules, interfaces, packages.
  if (atInstantiationType(context, scope)) {
    for (const unit of catalog.units()) {
      items.push(unitItem(unit.name, unit.kind, unit.uri, unit.ports, unit.parameters, "0"));
    }
  } else {
    for (const unit of catalog.units()) {
      items.push(unitItem(unit.name, unit.kind, unit.uri, unit.ports, unit.parameters, "3"));
    }
  }

  // Enclosing scope names help `pkg::member` style references.
  for (const outer of chain) {
    if (outer.id === scope?.id) continue;
    items.push({
      label: outer.name,
      kind: toCompletionKind(outer.category),
      detail: `${CATEGORY_LABEL[outer.category] ?? outer.category} (enclosing scope)`,
      sortText: `4|${outer.name}`,
    });
  }

  // Keywords and scaffolding snippets only become relevant once something has
  // been typed. Offering them on an empty prefix floods the list at the exact
  // moment the user reaches for `assign <space>`, where the signals are all
  // they want to see.
  if (context.prefix.length > 0) {
    items.push(
      ...staticCompletionItems({ snippets: settings.snippets, systemFunctions: settings.systemFunctions }),
    );
  }

  return { isIncomplete: false, items: dedupe(items) };
}

/* ------------------------------------------------------------------ *
 * Item construction
 * ------------------------------------------------------------------ */

export function symbolItem(
  symbol: HdlSymbol,
  context: CompletionContext,
  settings: CompletionSettings,
  bucket: string,
): CompletionItem {
  const uses = context.analysis.identifiers.get(symbol.name)?.length ?? 0;
  const detail = describeSymbol(symbol, settings);

  const item: CompletionItem = {
    label: symbol.name,
    kind: toCompletionKind(symbol.category),
    detail: detail || CATEGORY_LABEL[symbol.category],
    documentation: documentationFor(symbol, { ...settings, usageCount: uses }),
    sortText: `${bucket}|${symbol.category}|${symbol.name}`,
    filterText: symbol.name,
  };

  // Ports get a plain insert; nothing to expand.
  item.insertText = symbol.name;

  // A parameter can be inserted as its resolved value with a "value:" commit.
  if (
    (symbol.category === "parameter" || symbol.category === "localparam") &&
    symbol.resolvedValue !== undefined
  ) {
    item.command = {
      title: "Insert resolved value",
      command: "svision.insertResolvedValue",
      arguments: [
        {
          uri: context.document.uri,
          range: { start: context.document.positionAt(context.offset), end: context.document.positionAt(context.offset) },
          name: symbol.name,
          value: String(symbol.resolvedValue),
        },
      ],
    };
  }

  return item;
}

function unitItem(
  name: string,
  kind: HdlScope["category"],
  uri: string,
  ports: HdlSymbol[],
  parameters: HdlSymbol[],
  bucket: string,
): CompletionItem {
  const portSummary = ports.length > 0 ? ` (${ports.length} ports)` : "";
  const paramSummary = parameters.length > 0 ? ` (${parameters.length} params)` : "";

  return {
    label: name,
    kind:
      kind === "interface"
        ? CompletionItemKind.Interface
        : kind === "package"
          ? CompletionItemKind.Module
          : CompletionItemKind.Class,
    detail: `${CATEGORY_LABEL[kind] ?? kind}${portSummary}${paramSummary} — ${shortUri(uri)}`,
    sortText: `${bucket}|${kind}|${name}`,
    filterText: name,
  };
}

function connectionItems(
  connection: InstantiationContext,
  context: CompletionContext,
  catalog: Catalog,
  settings: CompletionSettings,
): CompletionItem[] {
  const unit = catalog.get(connection.typeName);
  if (!unit) {
    // The module is not indexed yet; fall back to the full list.
    return [];
  }

  const source = connection.kind === "port" ? unit.ports : unit.parameters;
  return source.map((symbol) => {
    const uses = context.analysis.identifiers.get(symbol.name)?.length ?? 0;
    return {
      label: symbol.name,
      kind: toCompletionKind(symbol.category),
      detail: describeSymbol(symbol, settings),
      documentation: documentationFor(symbol, { ...settings, usageCount: uses }),
      filterText: symbol.name,
      insertText: connection.kind === "port" ? `.${symbol.name}()` : `.${symbol.name}(${symbol.resolvedValue ?? ""})`,
      sortText: `0|${symbol.category}|${symbol.name}`,
    } satisfies CompletionItem;
  });
}

/* ------------------------------------------------------------------ *
 * Context detection
 * ------------------------------------------------------------------ */

interface InstantiationContext {
  readonly kind: "port" | "parameter";
  readonly typeName: string;
}

/**
 * Detects `<instance>.` at the cursor, so the list can be restricted to what
 * that instance offers.
 *
 * `DUT_if.adc` is the case that matters most: an interface's signals are not
 * ports of the enclosing module, they are ordinary declarations inside the
 * interface, so nothing in the local scope would suggest them.
 *
 * The identifier before the dot is read from the text rather than the tree,
 * because the cursor sits in the middle of a partial member name and the parse
 * at that point is not yet a complete reference.
 */
function memberAccessContext(
  context: CompletionContext,
  catalog: Catalog,
): { items: CompletionItem[] } | undefined {
  const text = context.document.getText();
  let start = context.rangeStart;

  // Walk back over the member name being typed.
  while (start > 0 && isWordChar(text[start - 1]!)) start--;

  // `pkg::` and `inst.` ask the same question with different syntax: what does
  // this named scope hold?
  const dotted = text.slice(Math.max(0, start - 2), start) === "::";
  const delimiter = dotted ? 2 : 1;
  if (start < delimiter) return undefined;
  if ((dotted ? text[start - 2] : text[start - 1]) !== (dotted ? ":" : ".")) return undefined;

  // ... and over the name before the separator.
  const nameEnd = start - delimiter;
  let nameStart = nameEnd;
  while (nameStart > 0 && isWordChar(text[nameStart - 1]!)) nameStart--;
  const ownerName = text.slice(nameStart, nameEnd);
  if (!ownerName || !/^[A-Za-z_]/.test(ownerName)) return undefined;

  // `cfg_pkg::` names a package, whose members are declarations in its own
  // file rather than ports.
  if (dotted) {
    const pkg = catalog.resolve(ownerName);
    if (!pkg) return undefined;
    return { items: memberItems([...pkg.parameters, ...pkg.ports, ...pkg.symbols]) };
  }

  const instance = context.analysis.scopes
    .flatMap((scope) => scope.instances)
    .find((i) => i.instanceName === ownerName);
  if (instance) {
    const entry = catalog.resolve(instance.typeName);
    if (!entry) return undefined;

    // An interface offers everything it declares; a module offers its ports.
    const members =
      entry.kind === "interface" ? [...entry.ports, ...entry.symbols] : entry.ports;

    return { items: memberItems(members) };
  }

  // `pkt.` where `pkt` is an object handle. A class offers its properties and
  // its methods, including the ones inherited from a base class.
  const handle = visibleSymbols(context.analysis, context.offset).find(
    (s) => s.name === ownerName && s.handleOf,
  );
  if (handle?.handleOf) {
    const members = catalog.classMembers(handle.handleOf);
    if (members.length > 0) return { items: memberItems(members) };
  }

  // `main.` where `main` names a block: `begin : main ... end`. Its members are
  // the signals declared inside, which live in the block's own scope.
  const block = namedBlockScope(context.analysis, context.offset, ownerName);
  if (block) {
    const members = [...block.parameters, ...block.ports, ...block.symbols];
    if (members.length > 0) return { items: memberItems(members) };
  }

  return undefined;
}

/** The named block visible from `offset`, if there is one. */
function namedBlockScope(
  analysis: Analysis,
  offset: number,
  name: string,
): HdlScope | undefined {
  const enclosing = scopeChain(analysis, offset);
  return resolveNamedBlock(analysis, enclosing, name);
}

/** Completion entries for one set of members, keeping each one's detail. */
function memberItems(members: readonly HdlSymbol[]): CompletionItem[] {
  return members.map((symbol) => {
    const item: CompletionItem = {
      label: symbol.name,
      kind: toCompletionKind(symbol.category),
      detail: describeSymbol(symbol, { showWidth: true, showType: true }),
    };
    if (symbol.doc) item.documentation = symbol.doc;
    return item;
  });
}

/** Bindings whose name and value can be completed from the interface. */
const BINDING_TYPES = new Set(["named_port_connection", "named_parameter_assignment"]);

/**
 * Detects a `.foo(` / `.FOO(` position inside a `module_instantiation`, so the
 * list can be restricted to that instance's ports or parameters.
 *
 * The binding is a sibling of the instance node rather than an ancestor of the
 * cursor, so it is located by range containment rather than by walking up.
 */
function instantiationContext(context: CompletionContext): InstantiationContext | undefined {
  let node: Node | null = nodeAtOffset(context);

  // Ascend to the enclosing instantiation, bailing out at the design-unit edge.
  let instantiation: Node | null = null;
  while (node) {
    if (node.type === "module_instantiation") {
      instantiation = node;
      break;
    }
    if (
      node.type === "source_file" ||
      node.type === "module_declaration" ||
      node.type === "interface_declaration"
    ) {
      return undefined;
    }
    node = node.parent;
  }

  if (!instantiation) return undefined;

  const typeName = instantiation.childForFieldName("instance_type")?.text;
  if (!typeName) return undefined;

  for (const binding of findBindings(instantiation)) {
    if (binding.startIndex <= context.offset && context.offset <= binding.endIndex) {
      return {
        kind: binding.type === "named_parameter_assignment" ? "parameter" : "port",
        typeName,
      };
    }
  }

  return undefined;
}

function* findBindings(instantiation: Node): Generator<Node> {
  const stack: Node[] = [instantiation];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (BINDING_TYPES.has(node.type)) {
      yield node;
      continue;
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i);
      if (child) stack.push(child);
    }
  }
}

function nodeAtOffset(context: CompletionContext): Node | null {
  return nodeAt(context.analysis, context.offset);
}

/** True when the cursor sits where an instantiated module type is expected. */
function atInstantiationType(context: CompletionContext, scope: HdlScope | undefined): boolean {
  if (!scope) return false;
  const node = nodeAtOffset(context);
  if (!node) return false;
  // After `module_name` with no instance name typed yet.
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "module_instantiation") {
    return parent.childForFieldName("instance_type")?.id === node.id;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

function dedupe(items: CompletionItem[]): CompletionItem[] {
  const seen = new Map<string, CompletionItem>();
  for (const item of items) {
    const existing = seen.get(item.label);
    // Keep the most specific entry: lower sortText bucket wins.
    if (!existing || (item.sortText ?? "") < (existing.sortText ?? "")) {
      seen.set(item.label, item);
    }
  }
  return [...seen.values()];
}

function shortUri(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts.slice(-2).join("/");
}