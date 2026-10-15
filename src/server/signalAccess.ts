import type { Node } from "web-tree-sitter";

import type {
  AccessKind,
  AccessSource,
  Analysis,
  HdlScope,
  HdlSymbol,
  IdentifierUse,
  PortDirection,
  SignalAccess,
  SymbolCategory,
} from "./model.js";
import { ASSIGNMENT_TYPES, firstLine, lvalueName, toRange } from "./trees.js";

export type { AccessKind, AccessSource, SignalAccess } from "./model.js";

/**
 * Every identifier reference and every drive/load a document declares, found in
 * a single traversal.
 *
 * The earlier version walked the tree once to list identifier references and
 * then, for each of them, re-found its node by searching down from the root --
 * converting an LSP position back to a byte offset by reading the document one
 * character at a time through the WASM boundary. On a 250-line module that was
 * 95 ms of the 100 ms an analysis took, and it ran on every keystroke.
 *
 * Everything both consumers need is already visible while walking: the
 * ancestors on the stack say whether a name is being driven, whether it sits in
 * an `assign` or inside an instantiation, and which statement it belongs to.
 * So the walk is done once and nothing is looked up afterwards -- and because a
 * reference *is* the thing the tracer classifies, the two results come from the
 * same visit rather than from two walks of the same tree.
 */

/** What one traversal of the document yields. */
export interface References {
  /** Every name *used* in the document, declarations excluded. */
  readonly uses: IdentifierUse[];
  /** Every drive and load, for the Signal Tracer. */
  readonly accesses: SignalAccess[];
}

/** Constructs that end a statement: a reference above them is out of context. */
const SCOPE_BOUNDARIES = new Set([
  "module_declaration",
  "interface_declaration",
  "program_declaration",
  "package_declaration",
  "class_declaration",
  "generate",
  "generate_region",
]);

/** Symbol categories that carry a value the tracer should follow. */
const SIGNAL_CATEGORIES = new Set<SymbolCategory>(["net", "variable", "port"]);

/**
 * Nodes whose identifiers are declarations, not references.
 *
 * An enum literal inside `enum {IDLE, RUN}` is part of a declaration. Counting
 * it as a use would report every enum member as an undeclared identifier and
 * offer them as completions of things that do not exist.
 */
const DECLARATION_ONLY_TYPES = new Set(["enum_name_declaration"]);

/**
 * Preprocessor nodes, whose text is not code the author wrote here.
 *
 * `NAME`, `RANGE` and `ASSIGNMENT` inside `` `define TMR(NAME, RANGE,
 * ASSIGNMENT) `` are the macro's *formal arguments*, not undeclared signals.
 * Counting them as references reported every one of them as an unknown
 * identifier -- twenty findings in a single header file. A macro body is not
 * HDL until somebody calls it, so the traversal does not descend into it.
 *
 * A macro *invocation* is the opposite case and is deliberately absent from
 * this set: `` `TMR(rd_pt,,rd_pt_next) `` names real signals in its arguments,
 * and those are the ones the tracer should follow.
 */
const PREPROCESSOR_TYPES = new Set([
  "text_macro_definition",
  "conditional_compilation_directive",
  "include_compiler_directive",
  "undefine_compiler_directive",
  "compiler_directive",
]);

/** Direction implies read/write across a port boundary. */
function boundaryKind(direction: PortDirection | undefined): AccessKind | undefined {
  if (direction === "input") return "drive";
  if (direction === "output" || direction === "inout") return "load";
  return undefined;
}

/** Port declarations of every module and interface in the document. */
function portDeclarations(analysis: Analysis): { symbol: HdlSymbol; scopeId: number }[] {
  const out: { symbol: HdlSymbol; scopeId: number }[] = [];
  const walk = (scopes: readonly HdlScope[]): void => {
    for (const scope of scopes) {
      for (const symbol of scope.ports) {
        if (!boundaryKind(symbol.direction)) continue;
        out.push({ symbol, scopeId: scope.id });
      }
      walk(scope.children);
    }
  };
  walk(analysis.scopes);
  return out;
}

/**
 * Every signal name the document declares, as one set.
 *
 * The previous per-name lookup walked a scope's symbol list for every
 * reference; with a few hundred references against a few hundred symbols that
 * is quadratic in the size of the file. A single set answers it in constant
 * time, at the cost of not distinguishing a local name from a nested one --
 * which only ever turns a non-signal into a traced one, and every name here is
 * already checked against the declaration tables when it is recorded.
 */
function declaredSignalNames(analysis: Analysis): Set<string> {
  const names = new Set<string>();
  const walk = (scopes: readonly HdlScope[]): void => {
    for (const scope of scopes) {
      for (const symbol of scope.ports) if (SIGNAL_CATEGORIES.has(symbol.category)) names.add(symbol.name);
      for (const symbol of scope.symbols) if (SIGNAL_CATEGORIES.has(symbol.category)) names.add(symbol.name);
      walk(scope.children);
    }
  };
  walk(analysis.scopes);
  return names;
}

/**
 * Scopes indexed by the byte offset they start at.
 *
 * The walk pushes a scope when it reaches its first byte and pops it on the way
 * out, which is how each reference gets its enclosing scope without asking the
 * analyzer to search a range list for every identifier. The range index already
 * stores those byte offsets, so no position is converted back here.
 */
function scopesByStart(analysis: Analysis): Map<number, HdlScope[]> {
  const byStart = new Map<number, HdlScope[]>();
  for (const entry of analysis.scopesByRange) {
    const list = byStart.get(entry.start);
    if (list) list.push(entry.scope);
    else byStart.set(entry.start, [entry.scope]);
  }
  return byStart;
}

/**
 * Collects every drive and load declared directly in the document: assignments,
 * declaration initialisers and port declarations.
 *
 * Instance connections are deliberately *not* handled here. Resolving one needs
 * the port direction of the instantiated module, which lives in the catalog --
 * and the catalog is built from this analysis. Resolving them later, against a
 * finished catalog, keeps that dependency one-directional.
 *
 * `text` is the document's source, passed in so a node's characters can be
 * sliced out of it rather than read back through the WASM boundary.
 */
export function collectReferences(analysis: Analysis, text: string): References {
  const accesses: SignalAccess[] = [];
  const uses: IdentifierUse[] = [];
  const seen = new Set<string>();
  const signalNames = declaredSignalNames(analysis);
  const scopeStarts = scopesByStart(analysis);
  const declarations = analysis.declarationNames;

  const slice = (node: Node): string => text.slice(node.startIndex, node.endIndex);

  /**
   * Records one access, dropping names that are not signals in this document.
   *
   * `siteKey` identifies the statement rather than the individual read, so a
   * signal read twice in one expression (`wptr[AW-1] != rptr[AW-1]`) is listed
   * once -- a tracer wants the statement that touches it, not every mention.
   */
  const record = (
    node: Node,
    name: string,
    scopeId: number,
    kind: AccessKind,
    source: AccessSource,
    detail: string,
    siteKey: string,
  ): void => {
    // `AW-1` is a parameter read, not a net; keep the tracer to real signals.
    if (!signalNames.has(name)) return;

    const key = `${name}|${kind}|${source}|${siteKey}`;
    if (seen.has(key)) return;
    seen.add(key);

    accesses.push({ name, scopeId, kind, range: toRange(node), source, detail });
  };

  for (const { symbol, scopeId } of portDeclarations(analysis)) {
    const kind = boundaryKind(symbol.direction);
    if (!kind) continue;

    // The symbol carries a Range, not a Node; synthesise the record directly.
    accesses.push({
      name: symbol.name,
      scopeId,
      kind,
      range: symbol.selectionRange,
      source: kind === "drive" ? "port_input" : "port_output",
      detail: kind === "drive" ? "input port" : "output port",
      port: symbol.name,
    });
  }

  // --- the single traversal -------------------------------------------------
  //
  // `path` is the chain of ancestors of the node being examined. Reading it
  // answers every "is this inside an assign / an instantiation / a statement"
  // question without touching the tree again, because those nodes were already
  // visited on the way down.

  const path: Node[] = [];
  /** Scope stack, parallel to `path`; the last entry is the innermost scope. */
  const scopeStack: HdlScope[] = [];

  const onEnter = (node: Node): void => {
    path.push(node);

    const opened = scopeStarts.get(node.startIndex);
    if (opened) scopeStack.push(...opened);
  };

  const onLeave = (node: Node): void => {
    path.pop();
    const opened = scopeStarts.get(node.startIndex);
    if (opened) scopeStack.length -= opened.length;
  };

  /** True when a `continuous_assign` encloses the current node. */
  const insideContinuousAssign = (): boolean => {
    for (let i = path.length - 1; i >= 0; i--) {
      const type = path[i]!.type;
      if (type === "continuous_assign") return true;
      if (SCOPE_BOUNDARIES.has(type)) return false;
    }
    return false;
  };

  /**
   * True when the current node sits inside an instantiation.
   *
   * Names there are port connections rather than signals the module body reads
   * or writes, and they are reported once the port directions are known.
   */
  const insideInstantiation = (): boolean => {
    for (let i = path.length - 1; i >= 0; i--) {
      const type = path[i]!.type;
      if (
        type === "hierarchical_instance" ||
        type === "module_instantiation" ||
        type === "list_of_port_connections"
      ) {
        return true;
      }
      if (SCOPE_BOUNDARIES.has(type)) return false;
    }
    return false;
  };

  /** The assignment lvalue the current node sits inside, if any. */
  const enclosingLvalue = (): Node | undefined => {
    for (let i = path.length - 1; i >= 0; i--) {
      const type = path[i]!.type;
      if (type === "variable_lvalue" || type === "net_lvalue") return path[i];
    }
    return undefined;
  };

  /** The nearest enclosing assignment, used to describe a write. */
  const enclosingAssignment = (): Node | undefined => {
    for (let i = path.length - 1; i >= 0; i--) {
      const type = path[i]!.type;
      if (ASSIGNMENT_TYPES.has(type)) return path[i];
      if (SCOPE_BOUNDARIES.has(type)) return undefined;
    }
    return undefined;
  };

  /**
   * The statement the current node belongs to, which is what should be shown:
   * `always_ff @(posedge clk) q <= d;` reports the whole always block rather
   * than just the assignment buried inside its wrapper nodes.
   */
  const enclosingStatement = (): Node | undefined => {
    for (let i = path.length - 2; i >= 0; i--) {
      if (SCOPE_BOUNDARIES.has(path[i]!.type)) return path[i + 1];
    }
    return path[0];
  };

  /**
   * Identifies the *point* an access happens at, for deduplication.
   *
   * `p` read twice in `(p == q) || (p != q)` is one logical load, so the key
   * climbs to the outermost binary expression. But `if (d) q = d;` is two
   * points, and those sit under different `conditional_statement` branches, so
   * the walk stops at a statement or a block boundary.
   */
  const siteKeyFor = (node: Node): string => {
    let key: string | undefined;

    for (let i = path.length - 1; i >= 0; i--) {
      const current = path[i]!;
      if (ACCESS_POINT_TYPES.has(current.type)) {
        // A statement boundary wins: do not climb past it.
        key = `${current.type}@${current.startIndex}`;
        break;
      }
      if (SCOPE_BOUNDARIES.has(current.type)) break;
      if (!EXPRESSION_WRAPPERS.has(current.type)) {
        key = `${current.type}@${current.startIndex}`;
      }
    }

    return key ?? `node@${node.startIndex}`;
  };

  /**
   * A one-line description of the access.
   *
   * Inside an `always` block the header says nothing about which statement
   * touched the signal, so the assignment is shown instead and the enclosing
   * block is named. Outside one, the statement is already the useful thing.
   */
  const describeAccess = (): string => {
    const statement = enclosingStatement();
    if (!statement) return "";

    // `assign y = a & b;` is already a complete statement; keep it.
    if (statement.type === "continuous_assign") return firstLine(slice(statement));

    const assignment = enclosingAssignment();
    if (assignment && assignment.id !== statement.id) return firstLine(slice(assignment));

    return firstLine(slice(statement));
  };

  const visit = (node: Node): void => {
    onEnter(node);

    if (node.type === "simple_identifier" && !declarations.has(node.id)) {
      const name = slice(node);
      const scopeId = scopeStack[scopeStack.length - 1]?.id ?? -1;

      uses.push({ name, range: toRange(node), context: node.parent?.type ?? node.type, scopeId });

      // A name inside an instantiation's port list is the port boundary, not a
      // read of the module body.
      if (!insideInstantiation()) {
        const lvalue = enclosingLvalue();
        const isDrive = lvalue !== undefined && lvalueName(lvalue) === name;

        // Both sides of an `assign` belong to a continuous assignment; only
        // procedural code reports a procedural assignment.
        const source: AccessSource = insideContinuousAssign()
          ? "continuous_assign"
          : "procedural_assignment";

        record(
          node,
          name,
          scopeId,
          isDrive ? "drive" : "load",
          source,
          describeAccess(),
          siteKeyFor(node),
        );
      }
    }

    for (let i = node.childCount - 1; i >= 0; i--) {
      // A node type whose identifiers are all declarations is not descended
      // into at all, so its members are never mistaken for references. The
      // same holds for the preprocessor: a macro's body is text, not code.
      if (DECLARATION_ONLY_TYPES.has(node.type) || PREPROCESSOR_TYPES.has(node.type)) break;
      const child = node.child(i);
      if (child) visit(child);
    }

    onLeave(node);
  };

  visit(analysis.parseTree.rootNode);

  return { uses, accesses };
}

/** Wrapper nodes that add structure without being a distinct access point. */
const EXPRESSION_WRAPPERS = new Set(["primary", "mintypmax_expression", "hierarchical_identifier"]);

/**
 * Node types that end a chain of expressions.
 *
 * A `conditional_statement` is the boundary that keeps `if (d)` and `q = d`
 * as two separate access points, while a bare binary `expression` keeps
 * `p == q` and `p != q` inside the same one.
 */
const ACCESS_POINT_TYPES = new Set([
  "net_assignment",
  "operator_assignment",
  "blocking_assignment",
  "nonblocking_assignment",
  "conditional_statement",
  "case_statement",
  "always_construct",
  "initial_construct",
  "final_construct",
  "loop_statement",
  "always_keyword",
  "net_port_type",
]);

/**
 * The signal a port binding refers to.
 *
 * `.din(push_data)` names `push_data`; `.din(push_data[3:0])` still refers to
 * the net `push_data`; a bare expression like `.clk` (implicit) is left alone.
 */
export function rootNameOf(expression: string): string | undefined {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_$]*)/.exec(expression);
  return match?.[1];
}

/** Accesses of `name`, split by direction. */
export function partitionAccess(
  accesses: readonly SignalAccess[],
  name: string,
): { drivers: SignalAccess[]; loads: SignalAccess[] } {
  const drivers: SignalAccess[] = [];
  const loads: SignalAccess[] = [];

  for (const access of accesses) {
    if (access.name !== name) continue;
    (access.kind === "drive" ? drivers : loads).push(access);
  }

  return { drivers, loads };
}

/** All distinct signal names an access list mentions, sorted. */
export function accessNames(accesses: readonly SignalAccess[]): string[] {
  const names = new Set<string>();
  for (const access of accesses) names.add(access.name);
  return [...names].sort();
}