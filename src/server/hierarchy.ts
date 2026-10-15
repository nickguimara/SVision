import type { Range } from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

import type { Catalog, CatalogEntry } from "./catalog.js";
import { scopeChain, type Analysis, type HdlScope, type HdlSymbol } from "./model.js";
import { importedMember } from "./imports.js";

/**
 * Following a dotted name across the design hierarchy.
 *
 * `DUT_if.adc_in`, `DUT.u_sub.deep_sig` and `gen_i[3].member` all name
 * something declared in another scope, possibly in another file. Local scope
 * lookup cannot answer them: the declaration lives inside an interface, a
 * submodule or a generate block, not in the file being read.
 *
 * Each step is resolved in turn -- instance first, then member -- and the walk
 * stops as soon as a step cannot be resolved, because a path that is wrong at
 * position 2 says nothing about positions 3 and 4.
 */

/** One segment of a hierarchical reference. */
export interface PathSegment {
  readonly name: string;
  readonly range: Range;
  /** Index into the segment of an array select, when the path indexes. */
  readonly index?: string;
}

/** A declaration reached by following a path, and where it lives. */
export interface ResolvedPath {
  readonly symbol: HdlSymbol;
  /** File the declaration is written in, which may not be this one. */
  readonly uri: string;
  /** True when the declaration is a member of an interface. */
  readonly viaInterface: boolean;
  /** The interface instance the walk went through, when it did. */
  readonly instance?: string;
  /** Set when the scope was reachable but the named member was not in it. */
  missingMember?: boolean;
  /** The name that was looked for and not found. */
  missingName?: string;
}

/** Node types that wrap a whole reference, outermost first. */
const PATH_WRAPPERS = new Set([
  "hierarchical_identifier",
  "select",
  "bit_select",
  "part_select_range",
  "scope_resolution",
  // The chain this grammar puts around a `pkg::name`. In an expression it is
  // `method_call > subroutine_call > function_subroutine_call`; in a constant
  // initialiser two more constant-expression layers are stacked on top, and
  // the member itself sits in a `method_call_body`.
  "method_call",
  "method_call_body",
  "subroutine_call",
  "function_subroutine_call",
  "constant_function_call",
  "constant_primary",
]);

/**
 * Splits `DUT.u_sub[3].sig` into its segments, outermost first.
 *
 * Returns undefined when the node is not a path at all, which is the common
 * case: a bare name is also wrapped in a `hierarchical_identifier` by this
 * grammar, and only the number of segments tells them apart.
 */
export function pathOf(node: Node | null | undefined): PathSegment[] | undefined {
  const top = enclosingReference(node);
  if (!top) return undefined;

  const segments: PathSegment[] = [];
  collect(top, segments);

  return segments.length > 1 ? segments : undefined;
}

/**
 * The whole `a.b.c` reference a node belongs to, when it is a path.
 *
 * Callers usually hold one segment -- `b` out of `DUT_if.b` -- because that is
 * what the cursor lands on, so the enclosing reference has to be recovered
 * before the path can be walked.
 */
export function enclosingReference(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined;

  let top = node;

  while (top.parent) {
    const parent = top.parent;

    // Two ways a parent is still part of the same reference. Either the grammar
    // says so, or the wrapper adds context without moving the reference: it
    // starts where this node starts and is strictly longer. That second test is
    // what gets past `constant_primary` and `method_call_body`, which sit
    // between the identifier and the `method_call` that carries the `::`.
    const byType = PATH_WRAPPERS.has(parent.type);
    const byPosition = parent.startIndex === top.startIndex && parent.text.length > top.text.length;
    if (!byType && !byPosition) break;

    top = parent;
  }

  // A single name is not a path, and walking one would be a no-op anyway.
  return pathSegmentsOf(top).length > 1 ? top : undefined;
}

function pathSegmentsOf(top: Node): PathSegment[] {
  const segments: PathSegment[] = [];
  collect(top, segments);
  return segments;
}

/**
 * Splits a `pkg::name` reference.
 *
 * This grammar has no `scope_resolution` node at all, so a package-scoped name
 * arrives buried under up to five wrappers -- in a constant initialiser it is
 * `constant_function_call > function_subroutine_call > subroutine_call >
 * method_call`, and in an expression one layer is missing. Which wrapper is on
 * top therefore varies with where the reference sits, so the split is driven by
 * the `::` in the text rather than by any one node type.
 */
function collectScopeResolved(node: Node, into: PathSegment[]): boolean {
  if (!node.text.includes("::")) return false;

  const expected = node.text.split("::").length;
  const identifiers: Node[] = [];

  const walk = (current: Node): void => {
    if (identifiers.length >= expected) return;
    if (current.type === "simple_identifier") {
      identifiers.push(current);
      return;
    }
    for (const child of current.namedChildren) walk(child);
  };
  walk(node);

  if (identifiers.length < 2) return false;

  for (const identifier of identifiers) {
    into.push({
      name: identifier.text,
      range: {
        start: { line: identifier.startPosition.row, character: identifier.startPosition.column },
        end: { line: identifier.endPosition.row, character: identifier.endPosition.column },
      },
    });
  }
  return true;
}

function collect(node: Node, into: PathSegment[]): void {
  if (collectScopeResolved(node, into)) return;

  // `hierarchical_identifier` holds plain names; `select` adds an index.
  if (node.type === "hierarchical_identifier") {
    for (const child of node.namedChildren) {
      into.push({
        name: child.text,
        range: {
          start: { line: child.startPosition.row, character: child.startPosition.column },
          end: { line: child.endPosition.row, character: child.endPosition.column },
        },
      });
    }
    return;
  }

  const head = node.namedChildren[0];
  if (!head) return;
  if (["tf_call", "subroutine_call_statement", "subroutine_call", "function_subroutine_call", "constant_function_call"].includes(node.type)) {
    collect(head, into);
    return;
  }
  // A dotted task/function call is wrapped in tf_call; its first child is
  // the path, while the remaining children are arguments, not path segments.
  if (node.type !== "select" && head.type === "hierarchical_identifier") {
    collect(head, into);
    return;
  }

  if (node.type === "select") {
    // `a[expr]` -- `name` is the array, the index selects an element of it.
    const identifier = head.namedChild(0);
    if (identifier) {
      into.push({
        name: identifier.text,
        range: {
          start: { line: identifier.startPosition.row, character: identifier.startPosition.column },
          end: { line: identifier.endPosition.row, character: identifier.endPosition.column },
        },
      });
    }
    const index = node.namedChildren[1]?.text;
    const last = into[into.length - 1];
    if (last && index) into[into.length - 1] = { ...last, index };
    return;
  }

  if (node.type === "scope_resolution" && head.type !== "simple_identifier") {
    // `pkg::name` -- a package scope, which the catalog resolves by name.
    collect(head, into);
    for (const child of node.namedChildren.slice(1)) {
      into.push({
        name: child.text,
        range: {
          start: { line: child.startPosition.row, character: child.startPosition.column },
          end: { line: child.endPosition.row, character: child.endPosition.column },
        },
      });
    }
    return;
  }

  into.push({
    name: head.text,
    range: {
      start: { line: head.startPosition.row, character: head.startPosition.column },
      end: { line: head.endPosition.row, character: head.endPosition.column },
    },
  });
}

/**
 * The interface a port's or variable's type names, when it names one.
 *
 * `bus_if.slave bus` records the type as `bus_if.slave`: the interface plus the
 * modport the port is declared through. Following `bus.data` needs the
 * interface, so the modport is dropped and the trailing name is looked up --
 * `pkg::bus_if` is legal too, and only the last segment is the interface name.
 *
 * Returns undefined for anything that is not an interface, because the same
 * question is asked of every port and most of them are plain nets.
 */
export function interfaceOfType(typeText: string, catalog: Catalog): CatalogEntry | undefined {
  const last = typeText.replace(/^virtual\s+(?:interface\s+)?/, "")
    .replace(/\s*#\s*\([^]*\)/, "").trim().split("::").pop()?.split(".")[0]?.trim();
  if (!last) return undefined;

  const candidates = catalog.all(last).filter((entry) => entry.kind === "interface");
  return candidates[0];
}

/**
 * Walks a path from `offset` in `analysis`.
 *
 * `missingMember` tells a typo from an unreachable path: when the walk found
 * the scope to look in but the named member is not there, that is a finding,
 * whereas failing to reach the scope at all is not -- the design may simply
 * not be indexed yet.
 */
/**
 * Scopes a hierarchical name can step into, indexed by parent and name.
 *
 * A module instance and a named block are both "a scope reachable by name", and
 * they are reached the same way: `someName.member`. Only modules cross files;
 * a block is always local, so the map is built per analysis and cached.
 */
/**
 * The named scope `name` reaches from the chain enclosing a use.
 *
 * Not necessarily a direct child, nor even a descendant at one fixed depth: a
 * block inside a `generate` is nested under the region, yet `gblk.lane` is
 * written from the module's body. So the block counts as reachable when *any*
 * of its ancestors is on the chain, and the closest one wins.
 */
function childNamed(
  analysis: Analysis,
  chain: readonly HdlScope[],
  name: string,
): HdlScope | undefined {
  const onChain = new Set(chain.map((scope) => scope.id));
  let found: HdlScope | undefined;
  let foundDepth = -1;

  for (const scope of analysis.scopes) {
    if (scope.name !== name || scope.parentId === undefined) continue;
    if (scope.category !== "block" && scope.category !== "function" && scope.category !== "task") continue;

    // Walk up until a scope on the chain shows up; the number of hops is the
    // depth, so the nearest block wins.
    let depth = 0;
    let parentId: number | undefined = scope.parentId;
    while (parentId !== undefined && !onChain.has(parentId)) {
      const parent = analysis.scopesById.get(parentId);
      if (!parent) break;
      parentId = parent.parentId;
      depth++;
    }
    if (parentId === undefined || depth <= foundDepth) continue;

    found = scope;
    foundDepth = depth;
  }

  return found;
}

/**
 * The named block or method scope visible from a chain of enclosing scopes.
 *
 * Exported because completion asks the same question as a hierarchical
 * reference: `main.` in an editor is `main.something`, and the answer is the
 * block's own scope rather than anything in the catalog.
 */
export function resolveNamedBlock(
  analysis: Analysis,
  chain: readonly HdlScope[],
  name: string,
): HdlScope | undefined {
  return childNamed(analysis, chain, name);
}

export function resolvePath(
  node: Node | null | undefined,
  analysis: Analysis,
  catalog: Catalog,
  documentUri: string,
): ResolvedPath | undefined {
  const result = walkPath(node, analysis, catalog, documentUri);

  if (result === "no-path") return undefined;

  // The walk reached the scope but the member is not declared in it, which is a
  // finding the caller may want to report rather than a dead end.
  if (!("symbol" in result)) {
    return {
      symbol: MISSING,
      uri: documentUri,
      viaInterface: result.viaInterface,
      missingMember: true,
      missingName: result.missing,
    };
  }

  return result;
}

/**
 * Placeholder for a path that reached its scope and found nothing.
 *
 * It carries no declaration; callers that only care about a hit check
 * `missingMember` first.
 */
const MISSING = {
  name: "",
  category: "variable",
  typeText: "",
  unpackedDims: [],
  isPort: false,
  scopeId: -1,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
} as HdlSymbol;

type WalkResult = ResolvedPath | "no-path" | { missing: string; viaInterface: boolean };

/** A scope was reached, and it does not declare `missing`. */
function notFound(name: string, viaInterface: boolean): WalkResult {
  return { missing: name, viaInterface };
}

function walkPath(
  node: Node | null | undefined,
  analysis: Analysis,
  catalog: Catalog,
  documentUri: string,
): WalkResult {
  const segments = pathOf(node);
  if (!segments) return "no-path";

  const offset = node?.startIndex ?? 0;
  const chain = scopeChain(analysis, offset);

  // --- the first segment names something visible from here -------------------
  const head = segments[0]!;
  if (head.name === "this" || head.name === "super") {
    const owner = chain.find((s) => s.ownerClass)?.ownerClass ?? chain.find((s) => s.category === "class")?.name;
    let entry = owner ? catalog.resolve(owner) : undefined;
    if (head.name === "super") entry = entry?.baseClass ? catalog.resolve(entry.baseClass) : undefined;
    if (entry) return intoEntry(entry, segments, 1, catalog, false, head.name);
  }

  // An instance of a module, interface or package: the rest of the path is
  // inside it.
  for (let i = chain.length - 1; i >= 0; i--) {
    const instance = chain[i]!.instances.find((it) => it.instanceName === head.name);
    if (instance) {
      return intoInstance(instance.typeName, segments, documentUri, catalog);
    }

    // A named block: `main.scratch` inside a testbench. It is local, so there
    // is nothing to look up in the catalog -- the members are the scope's own.
    const block = childNamed(analysis, chain, head.name);
    if (block) return intoScope(block, segments, 1, documentUri);
  }

  // A local declaration. `Packet pkt;` then `pkt.payload` needs the catalog to
  // say what `Packet` holds, because the class usually lives in another file.
  const local = visibleInChain(chain, head.name) ?? importedMember(analysis, catalog, offset, head.name)?.symbol;
  if (local) {
    if (segments.length === 1) return { symbol: local, uri: documentUri, viaInterface: false };

    if (local.handleOf) {
      const entry = catalog.resolve(local.handleOf);
      if (entry) return intoEntry(entry, segments, 1, catalog, false, head.name);
    }

    // A port or variable of interface type: `bus_if.slave bus` then `bus.data`.
    // Nothing else in the chain can answer for it -- it is not an instance, it
    // is a name bound to a foreign scope by its declared type.
    const iface = interfaceOfType(local.typeText, catalog);
    if (iface) return intoEntry(iface, segments, 1, catalog, true, head.name);
  }

  // A package or class named directly, for `cfg_pkg::WIDTH`.
  const unit = catalog.get(head.name);
  if (unit && segments.length > 1) {
    return intoEntry(unit, segments, 1, catalog, unit.kind === "interface", head.name);
  }

  return "no-path";
}

/** Steps into the module or interface an instance refers to. */
function intoInstance(
  typeName: string,
  segments: PathSegment[],
  documentUri: string,
  catalog: Catalog,
): WalkResult {
  const entry = catalog.resolve(typeName);
  if (!entry) return "no-path";

  return intoEntry(entry, segments, 1, catalog, entry.kind === "interface", segments[0]!.name);
}

/**
 * Resolves `segments[from...]` against a scope that lives in this file.
 *
 * A named block has no entry in the catalog and none of the width machinery a
 * cross-file walk needs; it is just a scope, so the members are read straight
 * out of it and the declaration lives in the file being read.
 */
function intoScope(
  scope: HdlScope,
  segments: PathSegment[],
  from: number,
  documentUri: string,
): WalkResult {
  const member = segments[from];
  if (!member) return "no-path";

  const symbol = findInEntry(scope, member.name);
  if (!symbol) return notFound(member.name, false);

  const resolved: ResolvedPath = {
    symbol,
    uri: documentUri,
    viaInterface: false,
    instance: scope.name,
  };

  // More path left: keep descending into a block nested in this one.
  const next = segments[from + 1];
  if (!next) return resolved;

  const nested = childNamedLocal(scope, member.name);
  return nested ? intoScope(nested, segments, from + 2, documentUri) : resolved;
}

function childNamedLocal(scope: HdlScope, name: string): HdlScope | undefined {
  return scope.children.find((child) => child.name === name && child.category === "block");
}

/** Resolves `segments[from...]` against one design unit. */
function intoEntry(
  entry: CatalogEntry,
  segments: PathSegment[],
  from: number,
  catalog: Catalog,
  viaInterface: boolean,
  instance?: string,
): WalkResult {
  const member = segments[from];
  if (!member) return "no-path";

  // A subclass sees its base's members, so a class lookup has to follow
  // `extends` rather than reading only what the class itself declares.
  const inherited = entry.kind === "class" ? catalog.externalDeclarations(entry.name).find((s) => s.symbol.name === member.name) : undefined;
  const symbol =
    entry.kind === "class"
      ? inherited?.symbol
      : findInEntry(entry, member.name);
  if (!symbol) {
    // The scope was reached; the name inside it is simply not there.
    return notFound(member.name, viaInterface);
  }

  const resolved: ResolvedPath = { symbol, uri: inherited?.uri ?? entry.uri, viaInterface, instance };

  // Still more path left: keep descending through nested instances.
  const next = segments[from + 1];
  if (!next) return resolved;

  const memberType = symbol.handleOf ? catalog.resolve(symbol.handleOf) : interfaceOfType(symbol.typeText, catalog);
  if (memberType) return intoEntry(memberType, segments, from + 1, catalog, memberType.kind === "interface", member.name);

  const nested = entry.instances.find((i) => i.instanceName === member.name);
  if (nested) {
    const child = catalog.resolve(nested.typeName);
    if (child) return intoEntry(child, segments, from + 2, catalog, viaInterface, member.name);
  }

  return resolved;
}

/** What a design unit and a local scope have in common for name lookup. */
interface Declarations {
  readonly ports: readonly HdlSymbol[];
  readonly parameters: readonly HdlSymbol[];
  readonly symbols: readonly HdlSymbol[];
}

/** Every declaration a unit offers: ports, parameters, then the body. */
function findInEntry(entry: Declarations, name: string): HdlSymbol | undefined {
  return (
    entry.ports.find((s) => s.name === name) ??
    entry.parameters.find((s) => s.name === name) ??
    entry.symbols.find((s) => s.name === name)
  );
}

/** A name visible from `offset`, honouring shadowing. */
function visibleInChain(chain: readonly HdlScope[], name: string): HdlSymbol | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i]!;
    const found = findInEntry(scope, name);
    if (found) return found;
  }
  return undefined;
}
