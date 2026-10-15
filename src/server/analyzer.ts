import type { Node, Tree } from "web-tree-sitter";
import type { Position, Range } from "vscode-languageserver-types";

import { evaluateText, rangeWidth, unpackedCount, widthOfText, type EvalEnv } from "./eval.js";
import type {
  Analysis,
  HdlInstance,
  HdlScope,
  HdlSymbol,
  IdentifierUse,
  PackageImport,
  PortBinding,
  PortDirection,
  ScopeCategory,
  ScopeIndexEntry,
  SymbolCategory,
} from "./model.js";
import { collectReferences } from "./signalAccess.js";
import { expand, type MacroTable } from "./macros.js";
import { iterate } from "./trees.js";

/* ------------------------------------------------------------------ *
 * Small node helpers
 * ------------------------------------------------------------------ */

function toPosition(p: { row: number; column: number }): Position {
  return { line: p.row, character: p.column };
}

function toRange(node: Node): Range {
  return {
    start: toPosition(node.startPosition),
    end: toPosition(node.endPosition),
  };
}

function selection(node: Node): Range {
  return {
    start: toPosition(node.startPosition),
    end: toPosition(node.endPosition),
  };
}

/** First descendant of `type`, breadth-first, or null. */
function findChild(node: Node, type: string): Node | null {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}

/** First descendant of `type`, searching breadth-first, or null. */
function findDescendant(node: Node, type: string, maxDepth = 4): Node | null {
  let frontier: Node[] = node.namedChildren;
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const child of frontier) {
      if (child.type === type) return child;
      next.push(...child.namedChildren);
    }
    frontier = next;
  }
  return null;
}

function findChildren(node: Node, type: string): Node[] {
  return node.namedChildren.filter((c) => c.type === type);
}

/**
 * A port recovered from a Verilog-1995 body declaration, carrying the id of
 * the identifier it came from so it can be registered as a declaration.
 */
interface LegacyPort extends PendingSymbol {
  declarationId: number;
}

/**
 * Reads Verilog-1995 port declarations out of a module body.
 *
 * `input [5:0] rg_add;` and `output reg [12:0] K1, K2;` declare ports whose
 * direction, type and range only exist here. Only names the header also lists
 * become ports: a body declaration absent from the header is an internal net.
 */
function parseLegacyPorts(body: Node, headerNames: ReadonlySet<string>): LegacyPort[] {
  const out: LegacyPort[] = [];

  for (const node of iterate(body)) {
    if (node.type !== "port_declaration") continue;

    // `port_declaration` wraps an `input_declaration` / `output_declaration`,
    // which is where the direction, type and identifier list actually live.
    const inner = node.namedChild(0);
    if (!inner) continue;

    const direction = parseDirection(inner.children.find((c) => !c.isNamed)?.text ?? "");
    if (!direction) continue;

    // `input [5:0] rg_add` declares the range as the net's own dimension;
    // `output reg [12:0] K1` puts it inside a `variable_port_type`.
    const portType = inner.namedChildren.find(
      (c) => c.type === "net_port_type" || c.type === "variable_port_type",
    );

    const packedDim = portType ? findDescendant(portType, "packed_dimension", 2) : null;

    // `output reg [12:0] q` -- `reg` says the storage class, not the type, so
    // it must not end up in `typeText` where hover would display it as one.
    const split = portType ? splitPackedText(portType.text) : undefined;
    const typeText = split
      ? split.type && !/^(reg|logic|wire|bit|integer|int|var)$/.test(split.type)
        ? split.type
        : undefined
      : undefined;
    const packedRangeText = innerOf(packedDim) ?? split?.range;

    const identifierList = inner.namedChildren.find((c) => c.type.startsWith("list_of_"));
    if (!identifierList) continue;

    for (const nameNode of identifierList.namedChildren) {
      if (nameNode.type !== "simple_identifier" && nameNode.type !== "port_identifier") continue;
      if (!headerNames.has(nameNode.text)) continue;

      out.push({
        name: nameNode.text,
        category: "port",
        typeText: typeText ?? "",
        packedRangeText,
        packedRangeNode: packedDim,
        unpackedDims: [],
        direction,
        isPort: true,
        scopeId: -1,
        range: toRange(node),
        selectionRange: selection(nameNode),
        declarationId: nameNode.id,
      });
    }
  }

  return out;
}

/** Text of `node` with surrounding whitespace removed. */
function nodeText(node: Node | null | undefined): string {
  return node ? node.text.trim() : "";
}

/** Inner text of a bracketed node, e.g. `[7:0]` -> `7:0`. */
function innerOf(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const raw = node.text.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) return raw.slice(1, -1).trim();
  return raw;
}

/**
 * Splits a trailing packed dimension off a type written as a single token.
 *
 * `net_port_type` nodes such as `wire [7:0]` carry no child node for the
 * dimension, so the range has to be recovered from the text.
 */
function splitPackedText(text: string | undefined): { type: string; range?: string } {
  if (!text) return { type: "" };
  const match = /\[\s*([^\]]*?)\s*\]/.exec(text);
  if (!match) return { type: text.trim() };
  return {
    type: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(),
    range: match[1],
  };
}

/**
 * Text of an initializer / binding value.
 *
 * Declarations carry the value as everything after `=`; named bindings such as
 * `.port(signal)` carry it between the parentheses instead.
 */
function valueText(node: Node): string {
  const open = node.children.findIndex((c) => !c.isNamed && c.type === "(");
  if (open >= 0) {
    return node.children.slice(open + 1, -1).map((c) => c.text).join("").trim();
  }
  const equals = node.children.findIndex((c) => !c.isNamed && c.type === "=");
  if (equals >= 0) {
    return node.children.slice(equals + 1).map((c) => c.text).join("").trim();
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * Scope kinds
 * ------------------------------------------------------------------ */

const SCOPE_KINDS: Record<string, ScopeCategory | undefined> = {
  module_declaration: "module",
  interface_declaration: "interface",
  program_declaration: "program",
  package_declaration: "package",
  class_declaration: "class",
  function_declaration: "function",
  task_declaration: "task",
  generate_block: "block",
  generate_region: "block",
  begin_generate_block: "block",
};

/**
 * Procedural blocks that are a scope only when they are named.
 *
 * `begin : name ... end` is addressable as `name.signal`, so it has to be a
 * scope. A bare `begin ... end` is not addressable by anything, and making one a
 * scope costs every later lookup a range to filter: a 243-line module ended up
 * with 55 scopes instead of a dozen, and `scopeChain` is called on every
 * keystroke. So an unnamed block contributes its declarations to the enclosing
 * scope instead of getting one of its own.
 */
const PROCEDURAL_BLOCKS = new Set(["seq_block", "par_block"]);

const HEADER_TYPES = new Set([
  "module_ansi_header",
  "module_nonansi_header",
  "interface_ansi_header",
  "interface_nonansi_header",
  "program_ansi_header",
  "program_nonansi_header",
  "package_header",
]);

/**
 * The scopes a name has to be reachable from.
 *
 * A named block is visible to the whole design unit around it, not just to its
 * immediate parent, so the chain of declarations stops here.
 */
const DESIGN_UNITS = new Set<ScopeCategory>([
  "module",
  "interface",
  "program",
  "package",
  "class",
]);

/**
 * Nodes that only wrap the items of a scope, with nothing of their own.
 *
 * Flattening them is what lets a declaration inside them be read as a
 * declaration of the scope that encloses them. The generate constructs belong
 * here for the same reason `package_item` does -- `generate_region > conditional_
 * generate_construct > if_generate_construct > generate_block` is four levels of
 * wrapper around one block, and stopping at the first one leaves the block
 * itself unvisited.
 */
const ITEM_WRAPPERS = new Set([
  "package_item",
  "class_item",
  "checker_item",
  "config_declaration",
  // Verilog-1995: with a non-ANSI header, every declaration in the body is
  // wrapped in a `module_item`. Without these, `parameter integer DATAW = 12;`
  // written after `module m (a);` is never reached -- a whole design dialect
  // loses its parameters, and only its ports survive, because those are read
  // from the body by a separate path.
  "module_item",
  "interface_item",
  "program_item",
  // Statements. A named block is reached only by descending through these:
  // `initial begin : name` is `initial_construct > statement_or_null >
  // statement > statement_item > seq_block`, and stopping any earlier leaves the
  // block unopened and every signal inside it undeclared.
  "initial_construct",
  "final_construct",
  "always_construct",
  "procedural_timing_control_statement",
  "statement_or_null",
  "statement",
  "statement_item",
  "block_statement_or_null",
]);

/**
 * True when a node only wraps the items of the scope that encloses it.
 *
 * The generate constructs are matched by shape rather than by a hand-written
 * list, because their names are not guessable: the grammar calls a `for`
 * construct `loop_generate_construct` and a case arm `case_generate_item`, and
 * an earlier attempt that listed `for_generate_construct` silently matched
 * nothing -- every `begin : name` inside a generate loop went unopened, and
 * nothing said so.
 *
 * A node is a wrapper when it is one of the known ones, or when its type says
 * "generate" without being a generate scope or a keyword of its own.
 */
function isTransparentWrapper(type: string): boolean {
  // Memoised because the answer depends only on the node type, and a document
  // has a few dozen distinct types against thousands of nodes. Without this the
  // substring scan runs on every node of every traversal.
  const cached = wrapperVerdicts.get(type);
  if (cached !== undefined) return cached;

  const verdict = ITEM_WRAPPERS.has(type)
    ? true
    : !type.includes("generate")
      ? false
      : !GENERATE_SCOPES.has(type) && type !== "generate" && type !== "endgenerate";

  wrapperVerdicts.set(type, verdict);
  return verdict;
}

const wrapperVerdicts = new Map<string, boolean>();

/** The generate node types that are scopes rather than wrappers. */
const GENERATE_SCOPES = new Set(["generate_region", "generate_block", "begin_generate_block"]);

/**
 * The node that carries a scope's name, ports and header parameters.
 *
 * Returns null when there is no such node: `package p;` and `class C;` put the
 * name directly on the declaration and have no header node at all. Falling back
 * to the declaration itself would be wrong, because its children include the
 * whole body -- scanning it for header parameters counts every declaration in
 * the body a second time.
 */
function scopeHeader(scopeNode: Node): Node | null {
  for (const child of scopeNode.namedChildren) {
    if (HEADER_TYPES.has(child.type)) return child;
  }
  return null;
}

/** The identifier that names a scope, wherever the grammar put it. */
function scopeNameNode(scopeNode: Node, header: Node | null): Node | null {
  const named = header?.childForFieldName("name") ?? scopeNode.childForFieldName("name");
  if (named) return named;

  // `package` / `class` name themselves with a bare identifier child.
  const direct = scopeNode.namedChildren.find((c) => c.type === "simple_identifier");
  if (direct) return direct;

  // A function or task buries its name inside the body declaration, one level
  // below the return type.
  const body = scopeNode.namedChildren.find(
    (c) => c.type === "function_body_declaration" || c.type === "task_body_declaration",
  );
  return body?.namedChildren.find((c) => c.type === "simple_identifier") ?? null;
}

/**
 * The class name in a type position, when the type is a class.
 *
 * `Packet #(8) pkt;` puts the name inside a `class_type`, next to the parameter
 * overrides; `Packet pkt;` has no `class_type` at all and the name *is* the
 * type. Both spellings mean the same declaration, and neither can be read off
 * the type's text -- for the parameterised form that text is `Packet #(8)`.
 * Returning null leaves the declaration to be read as an ordinary net.
 */
function classTypeName(typeNode: Node | null, knownClasses: ReadonlySet<string>): string | null {
  const classType = typeNode ? findChild(typeNode, "class_type") : null;
  const named = classType?.namedChild(0);
  if (named?.type === "simple_identifier") return named.text;

  const bare = typeNode?.namedChild(0);
  if (bare?.type === "simple_identifier" && knownClasses.has(bare.text)) return bare.text;

  return null;
}

/** The type name in `extends <class_type>`, without its parameter overrides. */
function baseClassName(classNode: Node): Node | null {
  for (const child of classNode.namedChildren) {
    if (child.type !== "class_type") continue;
    const first = child.namedChild(0);
    if (first?.type === "simple_identifier") return first;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Analyzer
 * ------------------------------------------------------------------ */

interface MutableScope {
  id: number;
  name: string;
  category: ScopeCategory;
  parentId?: number;
  range: Range;
  selectionRange: Range;
  headerText: string;
  parameters: HdlSymbol[];
  ports: HdlSymbol[];
  symbols: HdlSymbol[];
  instances: HdlInstance[];
  children: HdlScope[];
  depth: number;
  start: number;
  end: number;
  baseClass?: string;
  imports?: PackageImport[];
}

/**
 * Declarations that have no width of their own.
 *
 * A method's return type is not the method's width, a type has none at all, and
 * an object handle is only a reference -- its values live in its members. Saying
 * `1 bit` for any of them would be a fact that is merely true of the language
 * and false of the code.
 */
const WIDTHLESS = new Set<SymbolCategory>([
  "function",
  "task",
  "typedef",
  "class",
  "handle",
  "package",
  "module",
  "interface",
  "program",
  "genvar",
]);

/** Symbol under construction: raw text first, widths resolved afterwards. */
interface PendingSymbol extends Omit<HdlSymbol, "packedWidth" | "unpackedCount"> {
  /** Kept so widths can be folded from the syntax tree, not just from text. */
  packedRangeNode?: Node | null;
}

class Analyzer {
  private lines: string[];
  private nextScopeId = 1;
  private readonly scopes: MutableScope[] = [];
  /** Node ids that are declaration names, so they are not counted as uses. */
  readonly declarationNames = new Set<number>();
  private readonly uses: IdentifierUse[] = [];
  /** Imports outside any scope, i.e. at compilation-unit level. */
  private readonly fileImports: PackageImport[] = [];
  /**
   * Class names known before this file was read, plus the ones it declares.
   *
   * Deciding whether `Packet pkt;` is an object or a one-bit net requires
   * knowing `Packet` is a class, and that answer usually lives in another file.
   */
  readonly classNames: Set<string>;
  /**
   * Resolves the folded values of a package's parameters, for `import pkg::*`.
   *
   * Supplied by the caller because the analyzer deliberately knows nothing
   * about the workspace: a package usually lives in another file, and a width
   * like `[C_PKT_DAT_W-1:0]` cannot be folded without its value.
   */
  readonly importedParameterValues:
    | ((packageName: string) => ReadonlyMap<string, number> | undefined)
    | undefined;

  /** Macros known to the workspace, for expanding `NAME(args) declarations. */
  readonly macros: MacroTable;
  /** Parses an expanded macro body. Supplied by the caller that owns a parser. */
  readonly parseFragment: ((text: string) => Tree) | undefined;

  constructor(
    text: string,
    knownClasses: ReadonlySet<string> = new Set(),
    importedParameterValues?: (packageName: string) => ReadonlyMap<string, number> | undefined,
    macros: MacroTable = new Map(),
    parseFragment?: (text: string) => Tree,
  ) {
    this.lines = text.split(/\r?\n/);
    this.classNames = new Set(knownClasses);
    this.importedParameterValues = importedParameterValues;
    this.macros = macros;
    this.parseFragment = parseFragment;
  }

  run(tree: Tree): AnalysisBase {
    this.visitScopeChildren(tree.rootNode, undefined, 0);
    for (const scope of this.scopes) {
      if (scope.category === "class") this.classNames.add(scope.name);
    }

    // Resolve folded constants once every scope is populated.
    for (const scope of this.scopes) this.resolveScope(scope);

    const scopesById = new Map<number, HdlScope>();
    const scopesByRange: ScopeIndexEntry[] = [];
    for (const s of this.scopes) {
      scopesById.set(s.id, s);
      scopesByRange.push({ scope: s, start: s.start, end: s.end, depth: s.depth });
    }

    const identifiers = new Map<string, IdentifierUse[]>();
    for (const use of this.uses) {
      const list = identifiers.get(use.name);
      if (list) list.push(use);
      else identifiers.set(use.name, [use]);
    }

    const start = Date.now();
    return {
      scopes: this.scopes,
      scopesById,
      scopesByRange,
      parseTree: tree,
      durationMs: Math.max(0, Date.now() - start),
      imports: this.fileImports,
      classNames: this.classNames,
      declarationNames: this.declarationNames,
    };
  }

  /**
   * Every class declared in this file.
   *
   * The caller may need to analyse again once it learns these: a file that
   * declares `Packet` and also writes `Packet pkt;` cannot know which is which
   * until the class declaration has been read.
   */
  classesHere(): Set<string> {
    const names = new Set(this.classNames);
    for (const scope of this.scopes) {
      if (scope.category === "class") names.add(scope.name);
    }
    return names;
  }

  /* ---------------------------------------------------------------- *
   * Scope traversal
   * ---------------------------------------------------------------- */

  /**
   * Visits the direct children of a scope, flattening `package_item`,
   * `class_item` and similar wrappers so their contents are seen as
   * declarations of the enclosing scope.
   */
  private visitScopeChildren(node: Node, parentId: number | undefined, depth: number): void {
    const stack: Node[] = [...node.namedChildren].reverse();
    while (stack.length > 0) {
      const child = stack.pop()!;
      if (isTransparentWrapper(child.type)) {
        stack.push(...[...child.namedChildren].reverse());
        continue;
      }
      this.visitNode(child, parentId, depth);
    }
  }

  private visitNode(node: Node, parentId: number | undefined, depth: number): void {
    // Functions and tasks are handled before the generic scope dispatch: they
    // are scopes, but they also have to be *declared* in whatever encloses
    // them, and the generic path only opens a scope.
    if (node.type === "function_declaration" || node.type === "task_declaration") {
      const nameNode = scopeNameNode(node, scopeHeader(node));
      if (nameNode) this.declarationNames.add(nameNode.id);
      this.declareMethod(node, this.scopeAt(parentId), nameNode?.text ?? "<anonymous>", {
        doc: this.docBefore(node),
      });
      return;
    }

    // A procedural block is a scope only when it is named; see
    // PROCEDURAL_BLOCKS for why an unnamed one is not.
    if (PROCEDURAL_BLOCKS.has(node.type)) {
      const label = scopeNameNode(node, null);
      if (!label) {
        this.visitScopeChildren(node, parentId, depth);
        return;
      }

      this.declarationNames.add(label.id);
      this.openScope(node, "block", parentId, depth);
      return;
    }

    const kind = SCOPE_KINDS[node.type];
    if (kind) {
      this.openScope(node, kind, parentId, depth);
      return;
    }

    const currentScope = parentId !== undefined ? this.scopes.find((s) => s.id === parentId) : undefined;

    switch (node.type) {
      case "parameter_declaration":
      case "local_parameter_declaration": {
        const isLocal = node.type === "local_parameter_declaration";
        for (const sym of this.parseParamDeclaration(node, currentScope, isLocal)) {
          this.declare(currentScope, sym, isLocal ? "localparam" : "parameter");
        }
        return;
      }
      case "net_declaration": {
        this.parseNetDeclaration(node, currentScope);
        return;
      }
      case "genvar_declaration": {
        for (const ident of findChildren(findChild(node, "list_of_genvar_identifiers") ?? node, "simple_identifier")) {
          this.declarationNames.add(ident.id);
          this.declare(currentScope, {
            name: ident.text,
            category: "genvar",
            typeText: "genvar",
            unpackedDims: [],
            isPort: false,
            scopeId: currentScope?.id ?? -1,
            range: toRange(node),
            selectionRange: selection(ident),
          }, "genvar");
        }
        return;
      }
      case "text_macro_usage": {
        // A declaration written by a preprocessor: `` `NOTMRINST((W-1),0,x); ``
        // stands for `reg [W-1:0] x`. Left alone it declares nothing, and every
        // use of `x` reads as an unknown identifier.
        this.declareFromMacro(node, currentScope);
        return;
      }
      case "block_item_declaration": {
        // `begin : name logic [7:0] scratch; ... end` -- a declaration written
        // inside a named block. The inner node is the same shape the module path
        // already knows how to read.
        const inner = findChild(node, "data_declaration");
        if (inner) this.parseDataDeclaration(inner, currentScope);
        return;
      }
      case "data_declaration": {
        this.parseDataDeclaration(node, currentScope);
        return;
      }
      case "module_instantiation": {
        const inst = this.parseInstantiation(node, currentScope);
        if (inst && currentScope) currentScope.instances.push(inst);
        return;
      }
      case "class_property": {
        // `rand bit [7:0] payload;` and `static int count = 0;` are data
        // declarations wearing a class member's qualifiers. The inner node is
        // the same shape the module path already knows how to read.
        const inner = findChild(node, "data_declaration");
        if (inner) {
          const qualifiers = this.classQualifiers(node);
          this.parseDataDeclaration(inner, currentScope, qualifiers);
        }
        return;
      }
      case "class_method": {
        // A function or task written as a class member. It is declared as a
        // symbol so `pkt.is_valid()` resolves and completes, and opened as a
        // scope so go-to-definition lands inside the body.
        const inner =
          findChild(node, "class_constructor_declaration") ??
          findChild(node, "function_declaration") ??
          findChild(node, "task_declaration");
        if (!inner) return;

        const isConstructor = inner.type === "class_constructor_declaration";
        const nameNode = isConstructor ? null : scopeNameNode(inner, scopeHeader(inner));
        const methodName = isConstructor ? "new" : nameNode?.text ?? "<anonymous>";

        if (nameNode) this.declarationNames.add(nameNode.id);

        this.declareMethod(inner, currentScope, methodName, {
          qualifiers: this.classQualifiers(node),
          doc: this.docBefore(node),
        });
        return;
      }
      case "function_declaration":
      case "task_declaration": {
        // A module-level function or task. Declaring it is what makes a call
        // resolve and complete; opening it is what makes its arguments and body
        // navigable.
        const nameNode = scopeNameNode(node, scopeHeader(node));
        const name = nameNode?.text ?? "<anonymous>";

        if (nameNode) this.declarationNames.add(nameNode.id);

        this.declareMethod(node, currentScope, name, { doc: this.docBefore(node) });
        return;
      }
      case "class_constructor_declaration": {
        // The keyword `new` is a token, not an identifier, so there is no name
        // node to read -- and nothing to mark as a declaration.
        this.declareMethod(node, currentScope, "new", { doc: this.docBefore(node) });
        return;
      }
      case "package_import_declaration": {
        // `import` normally arrives wrapped in a `data_declaration`, which
        // `parseDataDeclaration` handles. Reaching it bare means the wrapper is
        // missing, and dropping the import would silently lose names.
        const imports = this.parsePackageImports(node);
        this.fileImports.push(...imports);
        if (currentScope) {
          (currentScope as { imports?: PackageImport[] }).imports = [
            ...(currentScope.imports ?? []),
            ...imports,
          ];
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * The qualifiers on a class member, in source order.
   *
   * They sit in different wrapper nodes depending on the keyword --
   * `random_qualifier` for `rand`, `class_item_qualifier` for `static`,
   * `local`/`protected` are bare tokens -- so they are read from the member's
   * own children rather than from a fixed set of fields.
   */
  private classQualifiers(node: Node): string[] {
    const out: string[] = [];
    for (const child of node.children) {
      if (child.type === "data_declaration") continue;

      if (
        child.type === "class_item_qualifier" ||
        child.type === "random_qualifier" ||
        child.type === "const_qualifier"
      ) {
        // The wrapper holds only keyword tokens, and those are *anonymous* as
        // far as the tree is concerned -- `rand` and `static` never appear as
        // named children -- so the wrapper's own text is the qualifier.
        for (const word of child.text.split(/\s+/).filter(Boolean)) out.push(word);
      } else if (child.type === "local" || child.type === "protected") {
        out.push(child.text);
      }
    }
    return out;
  }

  /**
   * Declares a function or task in its enclosing scope and opens a scope for it.
   *
   * Both halves are needed and neither is enough alone: without the symbol,
   * `add(1, 2)` neither resolves nor completes, and without the scope the
   * arguments and the body stay invisible to go-to-definition.
   */
  private declareMethod(
    node: Node,
    enclosing: MutableScope | undefined,
    name: string,
    extras: { qualifiers?: string[]; doc?: string },
  ): void {
    const isTask = node.type === "task_declaration";
    const isConstructor = node.type === "class_constructor_declaration";
    const category: SymbolCategory = isTask ? "task" : "function";

    // The declared return type is what a call site wants to know -- not the
    // whole declaration, and for a constructor there is no type at all.
    const returnType = isConstructor
      ? "constructor"
      : nodeText(findDescendant(node, "data_type_or_void", 2) ?? undefined) || "void";

    const nameNode = scopeNameNode(node, scopeHeader(node));

    this.declare(enclosing, {
      name,
      category,
      typeText: returnType,
      unpackedDims: [],
      isPort: false,
      scopeId: enclosing?.id ?? -1,
      range: toRange(node),
      selectionRange: nameNode ? selection(nameNode) : toRange(node),
      doc: extras.doc,
      ...(extras.qualifiers?.length ? { qualifiers: extras.qualifiers } : {}),
    }, category);

    this.openScope(
      node,
      isTask ? "task" : "function",
      enclosing?.id,
      (enclosing?.depth ?? -1) + 1,
      name,
    );
  }

  /**
   * Declares what a macro invocation in declaration position stands for.
   *
   * `` `NOTMRINST((CHANW-1),0,chan_mask); `` expands to `reg [CHANW-1:0]
   * chan_mask`, which is an ordinary declaration once the preprocessor is done
   * with it. The expansion is parsed as its own little document and read with
   * the same declaration parsers as the file itself, then anchored at the
   * invocation so hover and go-to-definition land where the author can see
   * them.
   *
   * A macro the workspace does not define is left completely alone: the point
   * is to read what is written, and a macro from an unread include would
   * otherwise become a silently invented declaration.
   */
  private declareFromMacro(node: Node, scope: MutableScope | undefined): void {
    const parse = this.parseFragment;
    if (!parse || !scope || this.macros.size === 0) return;

    const invocation = node.text;
    const name = /^`\s*([A-Za-z_]\w*)/.exec(invocation)?.[1];
    if (!name || !this.macros.has(name)) return;

    const { text } = expand(invocation, this.macros, node.startIndex);
    // A macro body rarely carries its own terminating semicolon -- the common
    // form is `define X(a,b,n) reg [a:b] n` -- so the declaration only parses
    // with one appended.
    const source = `${text.trimEnd()};`;

    let fragment: Tree;
    try {
      fragment = parse(source);
    } catch {
      return;
    }

    const anchor = toRange(node);
    const collected = this.collectFromFragment(fragment, source);

    for (const symbol of collected.symbols) {
      // Re-anchored onto the invocation: the expansion's coordinates mean
      // nothing in the file the author is reading.
      (symbol as { range: Range }).range = anchor;
      (symbol as { selectionRange: Range }).selectionRange = anchor;

      // The node the range was read from belongs to the fragment's tree, which
      // is freed below. The text survives it, and the text is enough to fold a
      // width from -- holding the node would leave a dangling pointer that
      // crashes the width pass the moment the expansion is released.
      (symbol as PendingSymbol).packedRangeNode = null;

      this.declare(scope, symbol, symbol.category);
    }

    // A macro may instantiate modules as well as declaring signals -- the
    // common shape declares a wire, a shadow copy of it and a voting block over
    // the copy. Leaving the instance out would show the signals and hide the
    // thing that reads them.
    for (const instance of collected.instances) {
      scope.instances.push({ ...instance, range: anchor, typeRange: anchor });
    }

    fragment.delete();
  }

  /**
   * Declarations of an expanded macro body, read by a throwaway analyzer.
   *
   * The body is a different document with different coordinates, so it gets
   * its own analyzer pointed at a scratch scope. Only the declarations are
   * wanted; references, widths and accesses of the expansion are the caller's
   * business, not this one's.
   */
  private collectFromFragment(
    fragment: Tree,
    source: string,
  ): { symbols: HdlSymbol[]; instances: HdlInstance[] } {
    const shadow = this.fragmentAnalyzer();

    const scratch: MutableScope = {
      id: 0,
      name: "<macro>",
      category: "module",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      headerText: "",
      parameters: [],
      ports: [],
      symbols: [],
      instances: [],
      children: [],
      depth: 0,
      start: 0,
      end: source.length,
    };

    // Everything the body declares is wanted; nothing it references is.
    shadow.resetFor(source);
    shadow.scopes.push(scratch);

    for (const child of fragment.rootNode.namedChildren) {
      shadow.visitNode(child, scratch.id, 1);
    }

    return {
      symbols: [...scratch.parameters, ...scratch.ports, ...scratch.symbols],
      instances: scratch.instances,
    };
  }

  /**
   * The analyzer that reads macro expansions, built once and reused.
   *
   * A file can hold thousands of macro calls. Building an analyzer per call
   * cost more than parsing the expansion did -- measured at 0.04 ms per
   * invocation against 0.013 ms for the parse -- so the state is reset between
   * bodies instead of the object being rebuilt.
   */
  private fragmentAnalyzer(): Analyzer {
    this.fragment ??= new Analyzer(
      "",
      this.classNames,
      this.importedParameterValues,
      this.macros,
      this.parseFragment,
    );
    return this.fragment;
  }

  private fragment: Analyzer | undefined;

  /** Clears everything but the configuration, to read a different body. */
  private resetFor(text: string): void {
    this.scopes.length = 0;
    this.declarationNames.clear();
    this.uses.length = 0;
    this.fileImports.length = 0;
    this.nextScopeId = 1;
    this.lines = text.split(/\r?\n/);
  }

  /** `import pkg::*;` and `import pkg::A, pkg::B;` */
  private parsePackageImports(node: Node): PackageImport[] {
    const out: PackageImport[] = [];

    for (const item of node.namedChildren) {
      if (item.type !== "package_import_item") continue;

      const names = item.namedChildren.filter((c) => c.type === "simple_identifier");
      const head = names[0];
      if (!head) continue;
      this.declarationNames.add(head.id);

      const wildcard = item.text.includes("*");
      const explicit = wildcard
        ? []
        : names.slice(1).map((c) => {
            this.declarationNames.add(c.id);
            return c.text;
          });

      out.push({
        packageName: head.text,
        wildcard,
        explicit,
        range: toRange(item),
      });
    }

    return out;
  }

  private openScope(
    node: Node,
    kind: ScopeCategory,
    parentId: number | undefined,
    depth: number,
    /** Name for scopes the grammar does not name, e.g. a class method. */
    nameOverride?: string,
  ): void {
    const header = scopeHeader(node);
    const nameNode = scopeNameNode(node, header);
    const name = nameOverride ?? (nameNode ? nameNode.text : `<anonymous ${kind}>`);
    if (nameNode) this.declarationNames.add(nameNode.id);

    const scope: MutableScope = {
      id: this.nextScopeId++,
      name,
      category: kind,
      parentId,
      range: toRange(node),
      selectionRange: nameNode ? selection(nameNode) : toRange(node),
      headerText: header ? header.text.slice(0, 400) : node.text.slice(0, 200),
      parameters: [],
      ports: [],
      symbols: [],
      instances: [],
      children: [],
      depth,
      start: node.startIndex,
      end: node.endIndex,
    };

    // `class Derived extends Packet #(16);` -- the base's members are this
    // class's members too, and the base is usually in another file.
    const base = kind === "class" ? baseClassName(node) : null;
    if (base) {
      this.declarationNames.add(base.id);
      scope.baseClass = base.text;
    }

    this.scopes.push(scope);

    const parent = parentId !== undefined ? this.scopes.find((s) => s.id === parentId) : undefined;
    if (parent) parent.children.push(scope as HdlScope);

    // A function or task declares its arguments in a `tf_port_list`, not in a
    // header node. `input int a, output logic q` has to become real ports, or
    // the argument names inside the body look undeclared.
    if (kind === "function" || kind === "task") {
      for (const port of this.parseTfPortList(node, scope)) {
        scope.ports.push(port);
      }
    } else if (header) {
      // `module m import p::*; ( ... );`
      //
      // The import sits between the module name and the port list, so it is a
      // child of the header node and not of the body -- nothing else in the
      // traversal ever sees it. Designs that write their ports this way depend
      // on those names being visible *in the port list itself*, which is why
      // missing this leaves every parameter used in a width undeclared.
      const headerImports = findChildren(header, "package_import_declaration");
      if (headerImports.length > 0) {
        const imports = headerImports.flatMap((node) => this.parsePackageImports(node));
        (scope as { imports?: PackageImport[] }).imports = [
          ...(scope.imports ?? []),
          ...imports,
        ];
      }

      // Header-declared parameters and ports belong to this scope. Scopes with
      // no header node (`package`, `class`) declare everything in their body,
      // which the traversal below picks up.
      for (const paramDecl of this.findParamDeclarations(header)) {
        for (const sym of this.parseParamDeclaration(paramDecl, scope, false)) {
          scope.parameters.push(sym);
        }
      }
      for (const sym of this.parsePortList(header, scope, node)) {
        scope.ports.push(sym);
      }
    } else if (kind === "class") {
      // `class Packet #(parameter int W = 8)` keeps its parameter list in a
      // `parameter_port_list` directly on the declaration, with no header node
      // to read it from.
      const paramList = findChild(node, "parameter_port_list");
      if (paramList) {
        for (const paramDecl of this.findParamDeclarations(paramList)) {
          for (const sym of this.parseParamDeclaration(paramDecl, scope, false)) {
            scope.parameters.push(sym);
          }
        }
      }
    }

    // A named block is reachable as `block_name.signal` from anywhere in the
    // design unit that encloses it, so its name is declared in every enclosing
    // scope up to that unit -- not only in its immediate parent. A block inside
    // a `generate` is a grandchild of the module, and `gblk.lane` written from
    // the module's body has to resolve.
    if (kind === "block" && nameNode) {
      const entry: PendingSymbol = {
        name: nameNode.text,
        category: "block",
        typeText: "block",
        unpackedDims: [],
        isPort: false,
        scopeId: -1,
        range: toRange(node),
        selectionRange: selection(nameNode),
        doc: this.docBefore(node),
      };

      for (let owner = parent as MutableScope | undefined; owner; ) {
        this.declare(owner, { ...entry, scopeId: owner.id }, "block");
        // Stop at the design unit: past it, the block is not in scope.
        if (DESIGN_UNITS.has(owner.category)) break;
        owner = owner.parentId !== undefined ? this.scopes.find((s) => s.id === owner!.parentId) : undefined;
      }
    }

    this.visitScopeChildren(node, scope.id, depth + 1);
  }

  /**
   * The arguments of a function or task, read as ports.
   *
   * `task drive(input logic en, output logic q);` and
   * `function int add(input int a, input int b);` both put their arguments in a
   * `tf_port_list`, one `tf_port_item` each, with the direction in a
   * `tf_port_direction` sibling. An argument written without a direction
   * (`task t(input int a);` is fine, `function f(int a);` is not) still needs a
   * name, and a plain `int a` is a `tf_variable_identifier` rather than a port.
   */
  private parseTfPortList(node: Node, scope: MutableScope): PendingSymbol[] {
    const out: PendingSymbol[] = [];

    // `tf_port_list` is a child of `function_body_declaration`, so it is one level
    // below the declaration node; a constructor names its arguments differently.
    const lists: Node[] = [];
    const collectLists = (current: Node, depth: number): void => {
      if (depth > 3) return;
      for (const child of current.namedChildren) {
        if (child.type === "tf_port_list" || child.type === "class_constructor_arg_list") {
          lists.push(child);
        } else {
          collectLists(child, depth + 1);
        }
      }
    };
    collectLists(node, 0);

    for (const list of lists) {
      for (const item of list.namedChildren) {
        if (item.type !== "tf_port_item" && item.type !== "class_constructor_arg") continue;
        const portItem = item.type === "class_constructor_arg" ? findChild(item, "tf_port_item") : item;
        if (!portItem) continue;

        const nameNode = portItem.namedChildren.find(
          (c) => c.type === "simple_identifier" || c.type === "tf_variable_identifier",
        );
        if (!nameNode) continue;
        this.declarationNames.add(nameNode.id);

        const typeNode = findChild(portItem, "data_type_or_implicit");
        const directionNode = findChild(portItem, "tf_port_direction");
        const packedDim = typeNode ? findDescendant(typeNode, "packed_dimension", 3) : null;
        const fromText = typeNode && !packedDim ? splitPackedText(nodeText(typeNode)) : null;
        const typeText = packedDim
          ? stripPacked(nodeText(typeNode), packedDim.text)
          : (fromText?.type ?? (typeNode ? nodeText(typeNode) : undefined) ?? "");

        out.push({
          name: nameNode.text,
          category: "port",
          typeText: typeText || "logic",
          packedRangeText: innerOf(packedDim ?? undefined) ?? fromText?.range,
          packedRangeNode: packedDim ?? null,
          unpackedDims: portItem.namedChildren
            .filter((c) => c.type === "unpacked_dimension")
            .map((d) => d.text),
          direction: directionNode ? parseDirection(directionNode.text) : undefined,
          isPort: true,
          scopeId: scope.id,
          range: toRange(portItem),
          selectionRange: selection(nameNode),
          doc: this.docBefore(portItem),
        });
      }
    }

    return out;
  }

  /** The mutable scope a `parentId` refers to, if it is still open. */
  private scopeAt(parentId: number | undefined): MutableScope | undefined {
    return parentId !== undefined ? this.scopes.find((s) => s.id === parentId) : undefined;
  }

  private findParamDeclarations(header: Node): Node[] {
    const found: Node[] = [];
    const walk = (n: Node) => {
      for (const child of n.namedChildren) {
        if (
          child.type === "parameter_declaration" ||
          child.type === "local_parameter_declaration" ||
          child.type === "parameter_port_declaration"
        ) {
          const target = child.type === "parameter_port_declaration"
            ? findChild(child, "parameter_declaration")
            : child;
          if (target) found.push(target);
          continue;
        }
        walk(child);
      }
    };
    walk(header);
    return found;
  }

  /* ---------------------------------------------------------------- *
   * Declaration parsers
   * ---------------------------------------------------------------- */

  private parseParamDeclaration(node: Node, scope: MutableScope | undefined, isLocal: boolean): PendingSymbol[] {
    const typeNode = findChild(node, "data_type_or_implicit");
    const typeText = nodeText(typeNode) || "parameter";
    const out: PendingSymbol[] = [];

    const assignments = findChild(node, "list_of_param_assignments");
    if (!assignments) return out;

    for (const assignment of assignments.namedChildren) {
      const nameNode = assignment.namedChild(0);
      if (!nameNode || nameNode.type !== "simple_identifier") continue;
      this.declarationNames.add(nameNode.id);

      out.push({
        name: nameNode.text,
        category: isLocal ? "localparam" : "parameter",
        typeText,
        unpackedDims: [],
        isPort: false,
        scopeId: scope?.id ?? -1,
        range: toRange(assignment),
        selectionRange: selection(nameNode),
        initializerText: valueText(assignment),
      });
    }
    return out;
  }

  /**
   * Reads the ports of a module, in either dialect.
   *
   * ANSI style declares everything in the header:
   * `module m(input wire [7:0] a, output reg b);`
   *
   * Verilog-1995 style lists bare names in the header and declares them in the
   * body: `module m(a, b); input [7:0] a; output reg b;`. The header then says
   * nothing about direction, width or type, so the body's `port_declaration`
   * nodes are the only source of truth.
   */
  private parsePortList(header: Node, scope: MutableScope, body: Node | undefined): PendingSymbol[] {
    // ANSI headers carry the declarations themselves; non-ANSI headers carry
    // bare names in a `list_of_ports` and say nothing else.
    const portList = header.namedChildren.find(
      (c) =>
        c.type === "list_of_port_declarations" ||
        c.type === "list_of_tf_ports" ||
        c.type === "list_of_ports",
    );
    if (!portList) return [];

    const out: PendingSymbol[] = [];

    // In an ANSI port list a bare direction applies to every following name
    // until another direction appears, so `input a, b, c` makes all three
    // inputs of the same (possibly implicit) type.
    let inheritedDirection: PortDirection | undefined;
    let inheritedTypeText: string | undefined;
    let inheritedPackedRange: string | undefined;
    let inheritedPackedNode: Node | null = null;

    for (const portNode of portList.namedChildren) {
      if (portNode.type !== "ansi_port_declaration" && portNode.type !== "ansi_tf_port_declaration") continue;

      const headerNode = portNode.namedChildren.find((c) => c.type.endsWith("_port_header"));
      const typeSearchRoot = headerNode ?? portNode;

      const directionNode = findDescendant(typeSearchRoot, "port_direction", 2);
      const typeHolder =
        findDescendant(typeSearchRoot, "data_type", 3) ??
        findDescendant(typeSearchRoot, "net_port_type", 3) ??
        findDescendant(typeSearchRoot, "net_type", 3);

      // A new direction resets the inherited type.
      if (directionNode) {
        inheritedDirection = parseDirection(directionNode.text);
        inheritedTypeText = undefined;
        inheritedPackedRange = undefined;
        inheritedPackedNode = null;
      }

      // Prefer the structured dimension; fall back to the text when the type
      // arrived as a single token, as net ports do.
      const packedDim = typeHolder ? findDescendant(typeHolder, "packed_dimension", 2) : null;
      const fromText = typeHolder && !packedDim ? splitPackedText(typeHolder.text) : null;

      if (typeHolder) {
        // `input [11:0] a` declares no type at all, only a range, so an empty
        // type here must stay empty rather than falling back to the range text.
        const declared = fromText
          ? fromText.type || undefined
          : stripPacked(typeHolder.text, packedDim?.text) || undefined;

        inheritedTypeText = declared;
        inheritedPackedRange = innerOf(packedDim ?? undefined) ?? fromText?.range;
        inheritedPackedNode = packedDim ?? null;
      }

      const direction = parseDirection(directionNode ? directionNode.text : "") ?? inheritedDirection;
      // An implicit port declares no type of its own; `typeText` stays empty
      // and the direction is what gets displayed.
      const typeText = inheritedTypeText ?? "";
      const packedRangeText = inheritedPackedRange;

      // A declaration can name several ports (`input a, b`); the `port_name`
      // field only points at the first, so every identifier is collected.
      const nameNodes = portNode.namedChildren.filter((c) => c.type === "simple_identifier");
      for (const nameNode of nameNodes) {
        this.declarationNames.add(nameNode.id);
        out.push({
          name: nameNode.text,
          category: "port",
          typeText,
          packedRangeText,
          packedRangeNode: inheritedPackedNode,
          unpackedDims: findChildren(portNode, "unpacked_dimension").map((d) => d.text),
          direction,
          isPort: true,
          scopeId: scope.id,
          range: toRange(portNode),
          selectionRange: selection(nameNode),
          doc: this.docBefore(portNode),
        });
      }
    }

    // Verilog-1995: the header lists bare names, and the body declares them.
    // Those declarations are already parsed as nets or variables, so here
    // they are only promoted to ports -- a port is a net or variable that is
    // also reachable from outside the module.
    //
    // Only for a non-ANSI header: `list_of_ports` carries bare names, while
    // `list_of_port_declarations` means the header already said everything and
    // the loop above has the answer.
    if (body && portList?.type === "list_of_ports") {
      const headerNames = new Set<string>();
      for (const child of portList.namedChildren) {
        if (child.type === "simple_identifier" || child.type === "port") {
          headerNames.add(child.text);
          continue;
        }
        for (const inner of iterate(child)) {
          if (inner.type === "simple_identifier") headerNames.add(inner.text);
        }
      }

      const promoted = parseLegacyPorts(body, headerNames);
      out.push(...promoted);
      for (const symbol of promoted) this.declarationNames.add(symbol.declarationId);
    }
    return out;
  }

  private parseDataDeclaration(
    node: Node,
    scope: MutableScope | undefined,
    qualifiers?: readonly string[],
  ): void {
    const typeDecl = findChild(node, "type_declaration");
    if (typeDecl) {
      this.parseTypeDeclaration(typeDecl, scope);
      return;
    }

    const importDecl = findChild(node, "package_import_declaration");
    if (importDecl) {
      const imports = this.parsePackageImports(importDecl);

      // `import` may sit at compilation-unit level, outside any scope, so the
      // file's own imports are kept too and visibility checks both lists.
      this.fileImports.push(...imports);

      if (scope) {
        (scope as { imports?: PackageImport[] }).imports = [...(scope.imports ?? []), ...imports];
      }

      for (const item of findChildren(importDecl, "package_import_item")) {
        const ident = item.namedChild(0);
        if (!ident) continue;
        // The imported package name is a reference, not a declaration.
        this.declarationNames.add(ident.id);
        if (scope && this.scopes.find((s) => s.id === scope.id)?.name === ident.text) continue;
        this.declare(scope, {
          name: ident.text,
          category: "package",
          typeText: `package ${nodeText(item).replace(/\s+/g, " ")}`,
          unpackedDims: [],
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange(item),
          selectionRange: selection(ident),
          doc: "Imported package -- members are accessible as `pkg::member`.",
        }, "package");
      }
      return;
    }

    const typeNode = findChild(node, "data_type_or_implicit");
    const dataTypeNode = typeNode ? findChild(typeNode, "data_type") ?? typeNode : null;

    // Search for the dimension rather than assuming a fixed nesting, and fall
    // back to the text when the type arrived as a single token.
    const packedDim = dataTypeNode ? findDescendant(dataTypeNode, "packed_dimension", 3) : null;
    const fromText = dataTypeNode && !packedDim ? splitPackedText(dataTypeNode.text) : null;

    const typeText =
      (packedDim ? stripPacked(dataTypeNode!.text, packedDim.text) : (fromText?.type ?? dataTypeNode?.text ?? "")) ||
      (typeNode?.text.trim() ?? "logic");
    const packedRangeText = innerOf(packedDim ?? undefined) ?? fromText?.range;

    for (const [category, listName, assignmentType] of [
      ["variable", "list_of_variable_decl_assignments", "variable_decl_assignment"],
      ["variable", "list_of_variable_identifiers", "variable_identifier"],
      ["net", "list_of_net_decl_assignments", "net_decl_assignment"],
    ] as const) {
      const list = findChild(node, listName);
      if (!list) continue;

      for (const assignment of list.namedChildren) {
        if (assignment.type !== assignmentType) continue;
        const nameNode = assignment.namedChild(0);
        if (!nameNode || nameNode.type !== "simple_identifier") continue;
        this.declarationNames.add(nameNode.id);

        const unpackedDims = assignment.namedChildren.filter((c) => c.type === "unpacked_dimension");

        // `Packet pkt;` is an object, not a vector. Deciding that needs to know
        // what `Packet` is, which the file being read usually cannot say.
        const className = classTypeName(dataTypeNode ?? typeNode, this.classNames);
        const handleOf = className && this.classNames.has(className) ? className : undefined;

        this.declare(scope, {
          name: nameNode.text,
          category: handleOf ? "handle" : (category as SymbolCategory),
          typeText,
          packedRangeText: handleOf ? undefined : packedRangeText,
          packedRangeNode: handleOf ? null : (packedDim ?? null),
          unpackedDims: handleOf ? [] : unpackedDims.map((d) => d.text),
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange(assignment),
          selectionRange: selection(nameNode),
          initializerText: valueText(assignment),
          doc: this.docBefore(node),
          ...(qualifiers?.length ? { qualifiers } : {}),
          ...(handleOf ? { handleOf } : {}),
        }, handleOf ? "handle" : (category as SymbolCategory));
      }
      if (list) break;
    }
  }

  private parseTypeDeclaration(typeDecl: Node, scope: MutableScope | undefined): void {
    const nameNode = typeDecl.childForFieldName("type_name");
    if (!nameNode) return;
    this.declarationNames.add(nameNode.id);

    const dataTypeNode = findChild(typeDecl, "data_type");
    // The `enum` keyword is an anonymous node with no children; the literals
    // are its siblings under `data_type`. So an enum is detected by its
    // literals, not by the keyword.
    const enumLiterals = dataTypeNode ? findChildren(dataTypeNode, "enum_name_declaration") : [];
    const packedDim = dataTypeNode
      ? dataTypeNode.namedChildren.find((c) => c.type === "packed_dimension")
      : null;

    // A typedef of a bare identifier is an alias; record the aliased name.
    const alias = dataTypeNode && dataTypeNode.namedChildCount === 1
      ? dataTypeNode.namedChild(0)
      : null;

    const isEnum = enumLiterals.length > 0;

    this.declare(scope, {
      name: nameNode.text,
      category: "typedef",
      typeText: isEnum
        ? "enum"
        : stripPacked(alias?.text ?? dataTypeNode?.text, packedDim?.text) || "typedef",
      packedRangeText: isEnum ? innerOf(packedDim ?? undefined) : undefined,
      packedRangeNode: packedDim ?? null,
      unpackedDims: [],
      isPort: false,
      scopeId: scope?.id ?? -1,
      range: toRange(typeDecl),
      selectionRange: selection(nameNode),
      doc: this.docBefore(typeDecl),
    }, "typedef");

    // Enum literals live in the enclosing scope in SystemVerilog.
    for (const member of enumLiterals) {
        const ident = member.namedChild(0);
        if (!ident) continue;
        this.declarationNames.add(ident.id);
        this.declare(scope, {
          name: ident.text,
          category: "enum",
          typeText: nameNode.text,
          unpackedDims: [],
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange(member),
          selectionRange: selection(ident),
        }, "enum");
    }

    // Struct and union members are fields of the type, not signals of the
    // scope. They are recorded so hovering one of them works and so the
    // unknown-identifier check knows the name is declared.
    if (dataTypeNode) this.declareStructMembers(dataTypeNode, nameNode.text, scope);
  }

  /**
   * Records the fields of a `struct` / `union` typedef.
   *
   * They are attached to the scope that declares the type, which is how
   * `valid` and `data` in `typedef struct packed { ... } entry_t;` stop being
   * reported as undeclared.
   */
  private declareStructMembers(dataType: Node, typeName: string, scope: MutableScope | undefined): void {
    for (const member of findChildren(dataType, "struct_union_member")) {
      // `logic [7:0] data;` is a `data_type_or_void` followed by a list of
      // declarators, so the names are not the member's first children. A
      // single member can declare several: `logic valid, dirty;`.
      const assignments = findChild(member, "list_of_variable_decl_assignments");
      if (!assignments) continue;

      for (const assignment of findChildren(assignments, "variable_decl_assignment")) {
        const ident = assignment.namedChild(0);
        if (!ident || ident.type !== "simple_identifier") continue;

        this.declarationNames.add(ident.id);
        this.declare(scope, {
          name: ident.text,
          category: "variable",
          typeText: typeName,
          unpackedDims: [],
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange(member),
          selectionRange: selection(ident),
        }, "variable");
      }
    }
  }

  private parseNetDeclaration(node: Node, scope: MutableScope | undefined): void {
    const netTypeNode = findChild(node, "net_type");
    const netType = nodeText(netTypeNode) || "wire";

    // `Packet pkt;` has no `net_type` at all: the grammar puts the class name
    // straight on the declaration, and nothing here knows what it is until the
    // catalog says `Packet` is a class.
    const bareTypeNode = netTypeNode ? null : (node.namedChildren.find((c) => c.type === "simple_identifier") ?? null);
    const className = bareTypeNode && this.classNames.has(bareTypeNode.text) ? bareTypeNode.text : undefined;
    if (bareTypeNode) this.declarationNames.add(bareTypeNode.id);

    // The packed range is not inside `net_type`: the grammar puts it in a
    // sibling `data_type_or_implicit`, alongside any `signed` modifier.
    const rangeHolder = findChild(node, "data_type_or_implicit");
    const packedDim = rangeHolder ? findDescendant(rangeHolder, "packed_dimension", 2) : null;
    const fromText = rangeHolder && !packedDim ? splitPackedText(nodeText(rangeHolder)) : null;

    const modifier = packedDim
      ? stripPacked(nodeText(rangeHolder), packedDim.text)
      : (fromText?.type ?? "");
    const packedRangeText = innerOf(packedDim ?? undefined) ?? fromText?.range;

    // The node type is `drive_strength`, not `net_strength`.
    const strengthNode = findChild(node, "drive_strength");
    const typeText = className ?? [netType, modifier, nodeText(strengthNode)].filter(Boolean).join(" ");

    const list = findChild(node, "list_of_net_decl_assignments");
    if (!list) return;

    for (const assignment of list.namedChildren) {
      if (assignment.type !== "net_decl_assignment") continue;
      const nameNode = assignment.namedChild(0);
      if (!nameNode || nameNode.type !== "simple_identifier") continue;
      this.declarationNames.add(nameNode.id);

      this.declare(scope, {
        name: nameNode.text,
        category: className ? "handle" : "net",
        typeText,
        // A handle has no width of its own; its members carry the values.
        packedRangeText: className ? undefined : packedRangeText,
        packedRangeNode: className ? null : (packedDim ?? null),
        unpackedDims: className ? [] : findChildren(assignment, "unpacked_dimension").map((d) => d.text),
        isPort: false,
        scopeId: scope?.id ?? -1,
        range: toRange(assignment),
        selectionRange: selection(nameNode),
        initializerText: valueText(assignment),
        doc: this.docBefore(node),
        ...(className ? { handleOf: className } : {}),
      }, className ? "handle" : "net");
    }
  }

  private parseInstantiation(node: Node, scope: MutableScope | undefined): HdlInstance | null {
    const typeNode = node.childForFieldName("instance_type");
    if (!typeNode) return null;
    this.declarationNames.add(typeNode.id);

    const hierInstance = node.namedChildren.find((c) => c.type === "hierarchical_instance");
    const nameOfInstance = hierInstance
      ? findChild(hierInstance, "name_of_instance")?.namedChild(0)
      : null;
    if (nameOfInstance) this.declarationNames.add(nameOfInstance.id);

    const parameterOverrides: PortBinding[] = [];
    const pva = node.namedChildren.find((c) => c.type === "parameter_value_assignment");
    if (pva) {
      for (const item of pva.namedChildren) {
        for (const assignment of item.namedChildren) {
          if (assignment.type === "named_parameter_assignment") {
            const nameId = assignment.namedChildren.find((c) => c.type === "simple_identifier");
            if (nameId) this.declarationNames.add(nameId.id);
            parameterOverrides.push({
              portName: nameId?.text,
              valueText: valueText(assignment),
              range: toRange(assignment),
              nameRange: nameId ? selection(nameId) : undefined,
            });
          } else {
            parameterOverrides.push({
              valueText: valueText(assignment),
              range: toRange(assignment),
            });
          }
        }
      }
    }

    const connections: PortBinding[] = [];
    const portList = hierInstance
      ? hierInstance.namedChildren.find((c) => c.type === "list_of_port_connections")
      : null;
    if (portList) {
      for (const conn of portList.namedChildren) {
        if (conn.type === "named_port_connection") {
          const nameId = conn.namedChildren.find((c) => c.type === "simple_identifier");
          if (nameId) this.declarationNames.add(nameId.id);
          connections.push({
            portName: nameId?.text,
            valueText: valueText(conn),
            range: toRange(conn),
            nameRange: nameId ? selection(nameId) : undefined,
          });
        } else if (conn.type === "ordered_port_connection") {
          connections.push({
            valueText: conn.namedChildren.map((c) => c.text).join(" ").trim(),
            range: toRange(conn),
          });
        } else if (conn.type === "wildcard_port_connection") {
          connections.push({ valueText: "*", range: toRange(conn) });
        }
      }
    }

    return {
      typeName: typeNode.text,
      instanceName: nameOfInstance?.text ?? "",
      range: toRange(node),
      typeRange: selection(typeNode),
      parameterOverrides,
      connections,
    };
  }

  /* ---------------------------------------------------------------- *
   * Constant folding
   * ---------------------------------------------------------------- */

  /**
   * Seeds `paramValues` with the parameters a scope can see from other files.
   *
   * Two ways a scope reaches another file, and both need the same numbers:
   *
   *  - `import pkg::*`, which brings in everything the package declares and
   *    everything the package itself imported;
   *  - a qualified reference, `logic [pkg::WIDTH-1:0]`, which names the package
   *    at every use and needs no import at all.
   *
   * The qualified form is found by reading the scope's own declarations rather
   * than the tree: the package name is already sitting in the range text, and
   * scanning for it costs nothing compared with resolving the expression.
   */
  private seedImportedValues(scope: MutableScope): Map<string, number> {
    const resolve = this.importedParameterValues;
    const out = new Map<string, number>();
    if (!resolve) return out;

    const packages = new Set<string>();

    for (const entry of scope.imports ?? []) {
      if (entry.wildcard) packages.add(entry.packageName);
    }

    // `[pkg::WIDTH-1:0]` and `pkg::state_e` both name the package in text.
    for (const declaration of [...scope.ports, ...scope.symbols, ...scope.parameters]) {
      for (const text of [declaration.packedRangeText, declaration.typeText]) {
        if (!text) continue;
        for (const match of text.matchAll(/\b([A-Za-z_]\w*)::/g)) {
          packages.add(match[1]!);
        }
      }
    }

    for (const name of packages) {
      for (const [key, value] of resolve(name) ?? []) {
        if (!out.has(key)) out.set(key, value);
      }
    }
    return out;
  }

  private resolveScope(scope: MutableScope): void {
    const paramValues = new Map<string, number>();

    // Parameters brought in by `import pkg::*` are constant-foldable exactly
    // like local ones. Without seeding them here, a port written
    // `output logic [C_PKT_DAT_W-1:0] p` stays widthless -- the name resolves,
    // but the bit count that completion and hover show never appears, which
    // reads as "the package parameter was not recognised".
    //
    // They go in a separate map, consulted only as a fallback, so a local
    // declaration of the same name shadows the imported one the way SV says it
    // should.
    const imported = this.seedImportedValues(scope);

    // Parameters may reference earlier parameters, so iterate to a fixed point.
    const pending = [...scope.parameters, ...scope.symbols.filter((s) => s.category === "localparam" || s.category === "parameter")];
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const sym of pending) {
        if (paramValues.has(sym.name)) continue;
        const value = this.evaluateSymbolValue(sym, paramValues, imported);
        if (value !== undefined) {
          paramValues.set(sym.name, value);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const symbolWidths = new Map<string, number>();
    const env: EvalEnv = {
      // A local declaration shadows an imported one of the same name, so the
      // local map is consulted first and the imported one only fills the gaps.
      lookup: (name) => paramValues.get(name) ?? imported.get(name),
      symbolWidth: (name) => symbolWidths.get(name),
    };

    const resolve = (sym: HdlSymbol): void => {
      if (sym.resolvedValue === undefined && paramValues.has(sym.name)) {
        (sym as { resolvedValue?: number }).resolvedValue = paramValues.get(sym.name);
      }

      // A method, a type and an object handle have no width of their own. A
      // function's `bit` is its *return* type, not the width of the method, and
      // showing `1 bit` next to a method is simply wrong.
      if (WIDTHLESS.has(sym.category)) return;

      const rangeNode = (sym as PendingSymbol).packedRangeNode;

      let packedWidth: number | undefined;
      if (rangeNode) packedWidth = rangeWidth(rangeNode, env);
      if (packedWidth === undefined && sym.packedRangeText) packedWidth = widthOfText(sym.packedRangeText, env);
      if (typeof packedWidth !== "number") packedWidth = undefined;

      // A vector with no declared range is one bit wide, and that is a fact
      // rather than a guess, so it is stated explicitly instead of being left
      // blank. Only when no range was declared at all: an unresolved range
      // means the width is genuinely unknown and must stay unknown.
      const declaresRange = rangeNode != null || sym.packedRangeText !== undefined;
      if (packedWidth === undefined && !declaresRange) {
        packedWidth = implicitWidth(sym.typeText);
      }

      if (packedWidth !== undefined) {
        (sym as { packedWidth?: number }).packedWidth = packedWidth;
      }
      const count = unpackedCount(sym.unpackedDims, env);
      if (count !== undefined) {
        (sym as { unpackedCount?: number }).unpackedCount = count;
      }
      if (packedWidth !== undefined) symbolWidths.set(sym.name, packedWidth);
    };

    // Two passes so signals can reference each other's widths via expressions.
    for (let pass = 0; pass < 3; pass++) {
      for (const sym of scope.ports) resolve(sym);
      for (const sym of scope.symbols) resolve(sym);
    }

    // Store back the folded parameter values.
    for (const sym of scope.parameters) {
      const value = paramValues.get(sym.name);
      if (value !== undefined) (sym as { resolvedValue?: number }).resolvedValue = value;
    }
  }

  private evaluateSymbolValue(
    sym: HdlSymbol,
    params: Map<string, number>,
    imported: Map<string, number>,
  ): number | undefined {
    // Parameter defaults are kept as text; fold them against the parameters
    // resolved so far, repeating the pass until the set stops growing. A local
    // parameter may well be written in terms of an imported one.
    return evaluateText(sym.initializerText ?? "", {
      lookup: (name) => params.get(name) ?? imported.get(name),
      symbolWidth: () => undefined,
    });
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  private declare(scope: MutableScope | undefined, sym: PendingSymbol, category: SymbolCategory): void {
    const full: PendingSymbol = { ...sym, category };
    if (!scope) return;
    if (category === "parameter" || category === "localparam") {
      scope.parameters.push(full as HdlSymbol);
    } else {
      scope.symbols.push(full as HdlSymbol);
    }
  }

  /** Leading comment block immediately above `node`, if any. */
  private docBefore(node: Node): string | undefined {
    const row = node.startPosition.row - 1;
    if (row < 0) return undefined;
    const lines: string[] = [];
    for (let i = row; i >= 0 && lines.length < 12; i--) {
      const line = this.lines[i] ?? "";
      const trimmed = line.trim();
      if (trimmed === "") {
        if (lines.length === 0) continue; // allow one blank line before the doc block
        break;
      }
      if (trimmed.startsWith("//")) lines.unshift(trimmed.replace(/^\/\/\s?/, ""));
      else if (trimmed.startsWith("/*") || trimmed.startsWith("*")) lines.unshift(trimmed.replace(/^\/\*+/, "").replace(/\*+\/$/, ""));
      else break;
    }
    const doc = lines.join("\n").trim();
    return doc.length > 0 ? doc : undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Free helpers
 * ------------------------------------------------------------------ */

/**
 * Widths implied by a base type when the declaration carries no packed range.
 *
 * A vector or net with no range is one bit, and the integer family has a
 * fixed width defined by the language. Types that are not listed here --
 * user typedefs, classes, `real` -- stay unknown rather than being guessed.
 */
const IMPLICIT_WIDTHS: Record<string, number> = {
  bit: 1,
  logic: 1,
  reg: 1,
  wire: 1,
  uwire: 1,
  tri: 1,
  tri0: 1,
  tri1: 1,
  triand: 1,
  trior: 1,
  trireg: 1,
  wand: 1,
  wor: 1,
  supply0: 1,
  supply1: 1,
  byte: 8,
  shortint: 16,
  int: 32,
  integer: 32,
  longint: 64,
  time: 64,
};

/** Width implied by `typeText` alone, or undefined when it cannot be known. */
function implicitWidth(typeText: string): number | undefined {
  // A declaration with no type at all is one bit wide: in Verilog-1995 an
  // `input b;` in the body is implicitly a scalar wire. Saying nothing there
  // would leave a plain input port with no width at all, which reads as "not
  // understood" rather than "one bit".
  if (!typeText || !typeText.trim()) return 1;
  // `wire signed`, `reg`, `wire (strong0, weak1)` all start with the base type.
  const base = typeText.trim().split(/[\s(]/)[0]!.toLowerCase();
  // An own-property check, not a plain index: a base type named `constructor`
  // or `toString` would otherwise pick up the inherited member and be typed as
  // a function rather than a width.
  return Object.hasOwn(IMPLICIT_WIDTHS, base) ? IMPLICIT_WIDTHS[base] : undefined;
}

function parseDirection(text: string): PortDirection | undefined {
  switch (text.trim()) {
    case "input": return "input";
    case "output": return "output";
    case "inout": return "inout";
    case "ref": return "ref";
    case "interface": return "interface";
    default: return undefined;
  }
}

function stripPacked(typeText: string | undefined, packedText: string | undefined): string {
  if (!typeText) return "";
  let out = typeText;
  if (packedText) out = out.split(packedText).join("");
  return out.trim();
}


/**
 * What the declaration pass alone can produce. `uses`, `identifiers` and
 * `accesses` need the whole document, so `analyzeTree` fills them in.
 */
type AnalysisBase = Omit<Analysis, "uses" | "identifiers" | "accesses">;

/**
 * Class names declared in a source file, found without parsing it.
 *
 * The indexer needs every file's classes *before* it analyses any of them:
 * deciding that `Packet pkt;` is an object needs to know that `Packet` is a
 * class, and the file declaring it may be read later in the walk. A second
 * parse of every file would be correct and expensive; the declaration is
 * syntactically unmistakable, so a scan of the raw text is enough.
 */
export function classNamesIn(text: string): Set<string> {
  const names = new Set<string>();
  // `class C`, `virtual class C`, `interface class C`, with optional
  // `#(...)` and `extends ...` afterwards -- none of which affect the name.
  const pattern = /(?:^|[\s;}])(?:(?:virtual|interface|local)\s+)*class\s+([A-Za-z_]\w*)/g;

  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name) names.add(name);
  }

  return names;
}

/**
 * Analyses one document.
 * `knownClasses` carries the class names the workspace has already indexed. It
 * is what lets `Packet pkt;` be recognised as an object rather than a one-bit
 * net, and passing the same set back is how a file that declares its own classes
 * gets analysed correctly: the first pass finds them, a second pass with them in
 * hand classifies the declarations that use them.
 */
export function analyzeTree(
  tree: Tree,
  text: string,
  knownClasses: ReadonlySet<string> = new Set(),
  importedParameterValues?: (packageName: string) => ReadonlyMap<string, number> | undefined,
  macros: MacroTable = new Map(),
  parseFragment?: (text: string) => Tree,
): Analysis {
  const analyzer = new Analyzer(text, knownClasses, importedParameterValues, macros, parseFragment);
  const base = analyzer.run(tree);

  // References and accesses come from one traversal: a reference *is* the thing
  // the tracer classifies, so walking the tree twice meant paying the WASM
  // boundary cost twice for the same nodes.
  const draft = { ...base, uses: [], identifiers: new Map(), accesses: [] } as unknown as Analysis;
  const { uses, accesses } = collectReferences(draft, text);

  const identifiers = new Map<string, IdentifierUse[]>();
  for (const use of uses) {
    const list = identifiers.get(use.name);
    if (list) list.push(use);
    else identifiers.set(use.name, [use]);
  }

  return { ...base, uses, identifiers, accesses };
}
