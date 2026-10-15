import type { Range } from "vscode-languageserver-types";
import type { IncludeDirective } from "./includes.js";

/** Direction of a module/interface port. */
export type PortDirection = "input" | "output" | "inout" | "ref" | "interface";

/**
 * Classification of a declaration. Mapped to LSP `SymbolKind` in the providers,
 * kept HDL-specific here so hover and completion can style each category.
 */
export type SymbolCategory =
  | "port"
  | "net"
  | "variable"
  | "parameter"
  | "localparam"
  | "typedef"
  | "enum"
  | "genvar"
  | "task"
  | "function"
  | "instance"
  | "module"
  | "interface"
  | "program"
  | "package"
  | "class"
  | "handle"
  | "block";

export type ScopeCategory = Extract<
  SymbolCategory,
  "module" | "interface" | "program" | "package" | "class" | "function" | "task" | "block"
>;

/**
 * A declared HDL entity. `range` spans the whole declaration (so folding and
 * "reveal range" work); `selectionRange` covers the identifier alone, which is
 * where navigation targets land.
 */
export interface HdlSymbol {
  readonly name: string;
  readonly category: SymbolCategory;
  /** Declared type verbatim, e.g. `logic signed [7:0]` or `my_pkg::cfg_t`. */
  readonly typeText: string;
  /** Packed dimension verbatim, e.g. `WIDTH-1:0`. Absent for scalar nets. */
  readonly packedRangeText?: string;
  /** Packed width in bits once parameters are folded; undefined if not resolvable. */
  readonly packedWidth?: number;
  /** Unpacked dimensions verbatim, e.g. `["[DEPTH-1:0]"]`. */
  readonly unpackedDims: string[];
  /** Total element count across unpacked dims, when resolvable. */
  readonly unpackedCount?: number;
  readonly direction?: PortDirection;
  readonly isPort: boolean;
  readonly scopeId: number;
  readonly range: Range;
  readonly selectionRange: Range;
  /** Verbatim initializer for variables, or default value for parameters. */
  readonly initializerText?: string;
  /** Folded constant for parameters, when the expression is fully evaluable. */
  readonly resolvedValue?: number;
  readonly children?: HdlSymbol[];
  /** Comments immediately preceding the declaration. */
  readonly doc?: string;
  /**
   * Verbatim declaration qualifiers, e.g. `["static", "rand"]`.
   *
   * A class member's qualifiers change what it means -- `static count` is one
   * variable shared by every object, `rand payload` is a constraint the solver
   * fills -- so they have to survive into hover and completion.
   */
  readonly qualifiers?: readonly string[];
  /**
   * The class this handle points at, when the declaration is `Packet pkt;`.
   *
   * Set only when the type name is known to be a class, so an ordinary net is
   * never mistaken for an object.
   */
  readonly handleOf?: string;
  /** Ordered task/function arguments, including defaults and directions. */
  readonly arguments?: readonly HdlSymbol[];
}

/** A module/interface instantiation site. */
export interface HdlInstance {
  readonly typeName: string;
  readonly instanceName: string;
  /** Whole `type #(...) inst (...)` statement. */
  readonly range: Range;
  /** Span of the type name, so definition can jump to the right module. */
  readonly typeRange: Range;
  readonly parameterOverrides: readonly PortBinding[];
  readonly connections: readonly PortBinding[];
}

export interface PortBinding {
  readonly portName?: string;
  readonly valueText: string;
  readonly range: Range;
  /** Span of the port/parameter name itself. */
  readonly nameRange?: Range;
}

/**
 * Where a read or a write of a signal comes from. This is the axis the Signal
 * Tracer groups by, so it names *why* the access happens rather than only what
 * the signal is called.
 */
export type AccessSource =
  /** `assign x = y;` */
  | "continuous_assign"
  /** `x <= y;` inside an always block, or a declaration initialiser. */
  | "procedural_assignment"
  /** The signal is this module's `input` port: driven from outside. */
  | "port_input"
  /** The signal is this module's `output` port: read from the inside. */
  | "port_output"
  /** The net reaches an input port of a submodule, which reads it. */
  | "instance_input"
  /** The net comes from an output port of a submodule, which drives it. */
  | "instance_output";

export type AccessKind = "drive" | "load";

/** One read or write of one signal, with enough context to explain itself. */
export interface SignalAccess {
  readonly name: string;
  readonly scopeId: number;
  readonly kind: AccessKind;
  readonly range: Range;
  readonly source: AccessSource;
  /** Short human-readable explanation, e.g. `assign dout = ...`. */
  readonly detail: string;
  /** Port name, when the access came from a port boundary. */
  readonly port?: string;
}

/** A lexical scope that owns symbols: module, interface, package, class, ... */
export interface HdlScope {
  readonly id: number;
  readonly name: string;
  readonly category: ScopeCategory;
  readonly parentId?: number;
  readonly range: Range;
  readonly selectionRange: Range;
  /** Verbatim header, e.g. `module fifo #(parameter int W = 8) (`. */
  readonly headerText: string;
  readonly parameters: HdlSymbol[];
  readonly ports: HdlSymbol[];
  readonly symbols: HdlSymbol[];
  readonly instances: HdlInstance[];
  readonly children: HdlScope[];
  /**
   * The class this one extends, without its parameter overrides.
   *
   * A subclass inherits every member of the base, so resolution has to know
   * what to look behind; the base may well live in another file.
   */
  readonly baseClass?: string;
  /** Owner of an out-of-block implementation (`task C::run`). */
  readonly ownerClass?: string;
  /** Packages brought into scope by an `import` statement. */
  readonly imports?: readonly PackageImport[];
}

/** One `import pkg::*;` or `import pkg::NAME;` inside a scope. */
export interface PackageImport {
  readonly packageName: string;
  /** True for `pkg::*`, false for named imports. */
  readonly wildcard: boolean;
  /** The names listed explicitly, when the import is not a wildcard. */
  readonly explicit: readonly string[];
  readonly range: Range;
}

/**
 * Every identifier *reference* in a file, recorded during analysis. Drives
 * "find all references" and the unknown-identifier diagnostic in one pass.
 */
export interface IdentifierUse {
  readonly name: string;
  readonly range: Range;
  /** Node type of the reference, e.g. `net_lvalue`, `simple_identifier`. */
  readonly context: string;
  readonly scopeId: number;
}

/** Result of analysing one document. */
export interface Analysis {
  readonly scopes: HdlScope[];
  readonly scopesById: Map<number, HdlScope>;
  readonly identifiers: Map<string, IdentifierUse[]>;
  readonly uses: IdentifierUse[];
  /**
   * Every drive and load declared in this document, with the range pointing at
   * the signal itself. Instance connections are added later, once the catalog
   * can supply port directions. Drives the Signal Tracer.
   */
  readonly accesses: SignalAccess[];
  readonly scopesByRange: ScopeIndexEntry[];
  readonly parseTree: import("web-tree-sitter").Tree;
  readonly durationMs: number;
  /**
   * Every `import` in this file, including ones at compilation-unit level
   * where no scope owns them.
   */
  readonly imports: readonly PackageImport[];
  /**
   * Every `` `include `` in this file, in source order.
   *
   * What the file pulls in decides what it can see: a package named by an
   * include is often in a folder the workspace walk never reaches, and the
   * directive is the only thing that says so.
   */
  readonly includes: readonly IncludeDirective[];
  /** Class names known when this file was analysed, plus the ones it declares. */
  readonly classNames: ReadonlySet<string>;
  /**
   * Ids of the nodes that *declare* a name, so a walk can tell a declaration
   * from a reference without a second pass over the tree.
   */
  readonly declarationNames: ReadonlySet<number>;
  /**
   * Declarations that belong to no scope: what a header leaves in the
   * compilation unit.
   *
   * A shared header declares its types above the first `module`, and the file
   * that `` `include ``s it uses them as if they were local. Nothing inside the
   * including document declares them, so the catalog hands them over from the
   * header's own analysis.
   */
  readonly unitSymbols: readonly HdlSymbol[];
}

/** An interval index over scope ranges, for O(log n) scope lookup by position. */
export interface ScopeIndexEntry {
  readonly scope: HdlScope;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
}

/** Inclusive ancestry chain, innermost last. */
export function scopeChain(analysis: Analysis, position: number): HdlScope[] {
  const matches = analysis.scopesByRange.filter((e) => e.start <= position && position <= e.end);
  return matches.sort((a, b) => a.depth - b.depth).map((e) => e.scope);
}

/** All symbols visible at `position`, innermost scope last, deduplicated by name. */
export function visibleSymbols(analysis: Analysis, position: number): HdlSymbol[] {
  const chain = scopeChain(analysis, position);
  const seen = new Set<string>();
  const out: HdlSymbol[] = [];

  const consider = (sym: HdlSymbol) => {
    // Prefer the innermost declaration when a name is shadowed.
    if (seen.has(sym.name)) return;
    seen.add(sym.name);
    out.push(sym);
  };

  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i]!;
    for (const sym of scope.parameters) consider(sym);
    for (const sym of scope.ports) consider(sym);
    for (const sym of scope.symbols) consider(sym);
  }
  return out;
}

/** Resolves a name at `position` using normal shadowing rules. */
export function resolveSymbol(analysis: Analysis, name: string, position: number): HdlSymbol | undefined {
  return visibleSymbols(analysis, position).find((s) => s.name === name);
}

/**
 * Names an `import` statement brings into scope.
 *
 * `import cfg_pkg::*;` makes every public member of `cfg_pkg` usable unqualified;
 * `import cfg_pkg::WIDTH;` brings only that one. The members themselves live in
 * another file, so this returns the import instructions and leaves the lookup to
 * whoever holds the catalog.
 *
 * Imports at compilation-unit level apply everywhere in the file, so they are
 * merged with the ones owned by the enclosing scopes.
 */
export function importsInScope(analysis: Analysis, position: number): PackageImport[] {
  const chain = scopeChain(analysis, position);

  const out: PackageImport[] = [];
  const seen = new Set<PackageImport>();

  const consider = (list: readonly PackageImport[] | undefined): void => {
    for (const entry of list ?? []) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      out.push(entry);
    }
  };

  consider(analysis.imports);
  for (const scope of chain) consider(scope.imports);

  return out;
}

/**
 * True when `name` is imported into scope by an `import` statement.
 *
 * The name alone is not enough to be sure -- a local declaration may shadow an
 * imported one -- but it is what the callers need in order to stop reporting a
 * perfectly good cross-file name as undeclared.
 */
export function isImportedName(imports: readonly PackageImport[], name: string): boolean {
  return imports.some(
    (entry) => entry.wildcard || entry.explicit.some((n) => n === name),
  );
}
