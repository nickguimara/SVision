import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
  type TextDocument,
} from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

import { widthOf, type EvalEnv } from "../eval.js";
import { scopeChain, visibleSymbols, type Analysis } from "../model.js";
import { enclosingReference, resolvePath } from "../hierarchy.js";
import { importedMember } from "../imports.js";
import type { Catalog } from "../catalog.js";

export interface DiagnosticSettings {
  enable: boolean;
  unknownIdentifiers: boolean;
  widthMismatch: boolean;
  blockingInSequential: boolean;
  implicitSensitivity: boolean;
  latchDetection: boolean;
}

/** Names that are always legal even though nothing in the file declares them. */
const BUILTIN_NAMES = new Set([
  "this", "super", "null", "rand", "randc", "local", "protected", "static",
  "automatic", "void", "error", "warning", "info", "fatal", "assert", "cover",
  "default", "disable", "fork", "join", "join_any", "join_none", "program",
  "time", "string", "real", "realtime", "integer", "genvar", "edge",
]);

/** Nodes holding compiler-directive text, whose identifiers are macro names. */
const PREPROCESSOR_PARENTS = new Set([
  "text_macro_definition",
  "text_macro_name",
  "text_macro_usage",
  "ifdef_condition",
  "elsif_condition",
  "include_file_path",
  // The formal arguments of a macro are not signals: `NAME`, `RANGE` and
  // `ASSIGNMENT` in `` `define TMR(NAME, RANGE, ASSIGNMENT) `` are the names
  // the macro will substitute. A macro only becomes HDL when somebody calls it.
  // The grammar nests each one under `formal_argument`, so listing only the
  // definition would leave every one of them reported as undeclared.
  "macro_text",
  "formal_argument",
  "list_of_formal_arguments",
]);

/** Assignment node types, in all their spellings. */
const ASSIGNMENT_TYPES = new Set([
  "blocking_assignment",
  "nonblocking_assignment",
  "net_assignment",
  "operator_assignment",
]);

/** Nodes that merely wrap a nested statement. */
const STATEMENT_WRAPPERS = new Set(["statement", "statement_item", "statement_or_null"]);

const SEVERITY = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
  hint: DiagnosticSeverity.Hint,
} as const;

export function computeDiagnostics(
  document: TextDocument,
  analysis: Analysis,
  catalog: Catalog,
  settings: DiagnosticSettings,
): Diagnostic[] {
  if (!settings.enable) return [];

  const diagnostics: Diagnostic[] = [];
  const tree = analysis.parseTree;

  const env = buildEnv(analysis);
  const assignedIn = new Map<number, Set<string>>();

  // One traversal for every check.
  //
  // Each rule used to walk the whole tree on its own, so a 250-line module was
  // walked six times on every keystroke -- and every node visit crosses the
  // WASM boundary. The rules only differ in which node type they react to, so
  // they run together and the two that need a subtree search defer to it: the
  // nested loops below cover the same nodes, because a nested node is always
  // reached after the construct that contains it.
  for (const node of iterate(tree.rootNode)) {
    if ((node.type === "ERROR" || node.isMissing) && !causedByMacro(node)) {
      diagnostics.push(syntaxDiagnostic(node));
    }

    // Collected before the rules that need it, so a latch or a sensitivity
    // finding sees every assignment in the block, not only the earlier ones.
    if (isSequentialBlock(node) || isCombinational(node)) {
      collectAssignments(node, assignedIn);
    }

    if (ASSIGNMENT_TYPES.has(node.type) && settings.widthMismatch) {
      const diagnostic = widthDiagnostic(node, env);
      if (diagnostic) diagnostics.push(diagnostic);
    }

    if (node.type === "simple_identifier" && settings.unknownIdentifiers) {
      const diagnostic = unknownDiagnostic(analysis, node, catalog, document.uri.toString());
      if (diagnostic) diagnostics.push(diagnostic);
    }

    if (settings.blockingInSequential && isSequentialBlock(node)) {
      const inner = firstBlockingAssignment(node);
      if (inner) {
        diagnostics.push({
          severity: SEVERITY.warning,
          range: nodeRange(inner),
          message:
            "Blocking assignment (=) inside always_ff infers race-prone logic; use non-blocking (<=).",
          source: "svision",
          code: "sequential-blocking",
        });
      }
    }

    if (settings.implicitSensitivity && node.type === "always_construct") {
      const diagnostic = sensitivityDiagnostic(node);
      if (diagnostic) diagnostics.push(diagnostic);
    }

    if (settings.latchDetection && isCombinational(node)) {
      diagnostics.push(...latchDiagnostics(node, assignedIn));
    }
  }

  return dedupeDiagnostics(diagnostics);
}

/* ------------------------------------------------------------------ *
 * Assignment helpers
 * ------------------------------------------------------------------ */

/**
 * The lvalue and right-hand side of an assignment.
 *
 * None of the assignment node types carry LSP-style fields in this grammar, so
 * the operands are taken positionally: `blocking_assignment` wraps an
 * `operator_assignment`, whose named children are the lvalue then the value.
 */
function assignmentParts(node: Node): { left: Node | null; right: Node | null } {
  let target = node;
  if (target.type === "blocking_assignment" || target.type === "nonblocking_assignment") {
    const inner = target.namedChildren.find((c) => c.type === "operator_assignment");
    if (inner) target = inner;
  }

  const named = target.namedChildren;
  const lvalue = named.find((c) => c.type === "variable_lvalue" || c.type === "net_lvalue");
  const value = named.find((c) => c.type === "expression");

  if (lvalue && value) return { left: lvalue, right: value };
  return { left: named[0] ?? null, right: named[1] ?? null };
}

/** True when `name` appears anywhere in the subtree. */
function mentionsIdentifier(node: Node, name: string): boolean {
  for (const inner of iterate(node)) {
    if (inner.type === "simple_identifier" && inner.text === name) return true;
  }
  return false;
}

/** Root identifier of an lvalue, ignoring bit and part selects. */
function lvalueName(node: Node | null): string | undefined {
  if (!node) return undefined;
  if (node.type === "simple_identifier") return node.text;
  if (node.type === "hierarchical_identifier") return lvalueName(node.namedChild(0) ?? null);
  if (
    node.type === "select" ||
    node.type === "bit_select" ||
    node.type === "part_select_range" ||
    node.type === "variable_lvalue" ||
    node.type === "net_lvalue" ||
    node.type === "primary"
  ) {
    return lvalueName(node.namedChildren[0] ?? null);
  }
  return undefined;
}

/** Every signal assigned anywhere inside a subtree. */
function assignedNamesWithin(node: Node): Set<string> {
  const names = new Set<string>();
  for (const inner of iterate(node)) {
    if (!ASSIGNMENT_TYPES.has(inner.type)) continue;
    const name = lvalueName(assignmentParts(inner).left);
    if (name) names.add(name);
  }
  return names;
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/** The first blocking assignment inside an `always_ff`, if there is one. */
function firstBlockingAssignment(node: Node): Node | undefined {
  for (const inner of iterate(node)) {
    if (inner.type === "blocking_assignment") return inner;
  }
  return undefined;
}

/**
 * Keywords that end up stranded when a macro breaks the parse.
 *
 * `else` is the common one: it means the construct before it was not closed.
 * `output` in `output `TMRINST(SIZE-1,0, state);` is the other direction --
 * the keyword is the one that has nothing to attach to, because the macro
 * after it is not a grammar the author could have written in plain HDL.
 */
const STRANDED_KEYWORDS = new Set([
  "else",
  "end",
  "endcase",
  "endmodule",
  "endtask",
  "endfunction",
  "endgenerate",
  "endinterface",
  "endprogram",
  "endproperty",
  "begin",
  "fork",
  "join",
  "output",
  "input",
  "inout",
  "wire",
  "reg",
  "logic",
  "assign",
]);

/** Siblings that carry no meaning between a statement and the keyword after it. */
const TRIVIA_TEXT = new Set(["", ";", ":"]);

/**
 * True when a syntax error exists only because a macro is there.
 *
 * ```systemverilog
 * always @(posedge Clk)
 *   if (!Rst)
 *     `TMR(rd_pt,,{ADDRW{1'b0}});   // a statement the grammar cannot see
 *   else
 *     `TMR(rd_pt,,rd_pt_next);
 * ```
 *
 * The grammar has no production for a macro call used as a statement, so the
 * `if` ends early and the `else` is left dangling at module level. The author
 * wrote balanced code; the parse is what broke, and reporting the `else` blames
 * them for it. Expanding the macro makes the same source parse with no error at
 * all, which is what was checked before deciding to stay quiet.
 *
 * The reverse happens too -- `output `TMRINST(SIZE-1,0, state);` strands the
 * direction keyword -- so the macro is looked for on either side.
 *
 * The test is deliberately narrow: a bare keyword with a macro call in the
 * item immediately before or after it. A real syntax error further away, or one
 * with no macro anywhere near it, is still reported.
 */
function causedByMacro(node: Node): boolean {
  const keyword = node.text.trim();
  if (!keyword || keyword.split(/\s/)[0] !== keyword) return false;
  if (!STRANDED_KEYWORDS.has(keyword)) return false;

  const parent = node.parent;
  if (!parent) return false;

  let before = node.previousSibling;
  while (before && isTrivia(before)) before = before.previousSibling;
  if (before && holdsMacroInvocation(before)) return true;

  let after = node.nextSibling;
  while (after && isTrivia(after)) after = after.nextSibling;
  return after ? holdsMacroInvocation(after) : false;
}

/**
 * True for the semicolons and comments the grammar wraps in a node of its own.
 *
 * The lone `;` that closes a macro-call statement arrives as a `module_item`
 * holding nothing but a semicolon, so the type alone cannot say what it is.
 */
function isTrivia(node: Node): boolean {
  if (node.type.endsWith("_comment")) return true;
  return TRIVIA_TEXT.has(node.text.trim());
}

/** True when `node`'s subtree contains a macro call. */
function holdsMacroInvocation(node: Node): boolean {
  if (node.type === "text_macro_usage") return true;
  for (const child of node.children) {
    if (holdsMacroInvocation(child)) return true;
  }
  return false;
}

function syntaxDiagnostic(node: Node): Diagnostic {
  if (node.isMissing) {
    return {
      severity: SEVERITY.error,
      range: nodeRange(node),
      message: `Missing \`${node.type}\` before this position.`,
      source: "svision",
      code: "syntax-missing",
    };
  }
  const snippet = node.text.split("\n")[0]!.slice(0, 40);
  return {
    severity: SEVERITY.error,
    range: nodeRange(node),
    message: `Unexpected syntax \`${snippet}\`.`,
    source: "svision",
    code: "syntax-error",
  };
}

function widthDiagnostic(node: Node, env: EvalEnv): Diagnostic | null {
  const { left, right } = assignmentParts(node);
  if (!left || !right) return null;

  // An object handle has no width to truncate into. `pkt.payload = 8'hAB`
  // assigns through the handle, and treating it as a 1-bit net would report
  // every field write as a truncation.
  if (env.isHandle?.(lvalueName(left) ?? "")) return null;

  const leftWidth = widthOf(left, env);
  const rightWidth = widthOf(right, env);
  if (leftWidth === undefined || rightWidth === undefined) return null;
  if (leftWidth === rightWidth) return null;

  // Only truncation is reported. Zero-extending a narrow expression into a
  // wider target is how `ptr <= ptr + 1'b1` and ordinary constants work, so
  // warning on it would bury the real findings under noise.
  if (leftWidth >= rightWidth) return null;

  // Accumulator pattern: `cnt <= cnt + 1`, `sum <= sum + data`. The right-hand
  // side is evaluated at the width of the assignment, so the difference is an
  // artefact of unsized literals rather than a real truncation.
  const target = lvalueName(left);
  if (target && mentionsIdentifier(right, target)) return null;

  const name = target ?? "the target";
  const lost = rightWidth - leftWidth;

  return {
    severity: SEVERITY.warning,
    range: nodeRange(node),
    message:
      `Assignment truncates: '${name}' is ${pluralBits(leftWidth)} but the right-hand side is ` +
      `${pluralBits(rightWidth)}. The upper ${lost} ${plural(lost, "bit")} ` +
      `${lost === 1 ? "is" : "are"} discarded.`,
    source: "svision",
    code: "width-mismatch",
  };
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function pluralBits(count: number): string {
  return `${count} ${plural(count, "bit")}`;
}

function unknownDiagnostic(
  analysis: Analysis,
  node: Node,
  catalog: Catalog,
  uri: string,
): Diagnostic | null {
  const name = node.text;
  if (name.startsWith("$")) return null;
  if (BUILTIN_NAMES.has(name)) return null;

  // A dotted path: the members live in another scope, so local lookup cannot
  // answer. If the walk reaches that scope and finds the name, it is declared;
  // if it reaches the scope and does not, that is a real typo worth reporting.
  //
  // This runs before the structural filter, which would otherwise discard every
  // segment of `DUT_if.adc_in` including the one worth checking.
  const whole = enclosingReference(node);
  if (whole) {
    const resolved = resolvePath(whole, analysis, catalog, uri);

    if (!resolved) {
      // The scope itself was out of reach -- an unknown instance, a unit that
      // is not indexed. Fall through to the structural filter below, which
      // still catches an undeclared root and ignores the rest of the path.
    } else if (!resolved.missingMember) {
      return null;
    } else if (resolved.missingName === name) {
      // Only the segment that actually failed is worth a finding. In
      // `DUT_if.typo.adc_in` the walk stops at `typo`; `adc_in` is innocent.
      return {
        severity: SEVERITY.warning,
        range: nodeRange(node),
        message:
          `Unknown member \`${name}\`. ` +
          (resolved.viaInterface ? "The interface" : "The scope") +
          ` reached through \`${whole.text.split(".")[0]}\` does not declare it.`,
        source: "svision",
        code: "unknown-identifier",
      };
    } else {
      // A later segment failed; this one is simply not where the walk stopped.
      return null;
    }
  }

  if (isStructuralPosition(node)) return null;

  if (importedMember(analysis, catalog, node.startIndex, name)) return null;

  if (isDeclaredHere(analysis, name, node.startIndex)) return null;
  if (catalog.get(name)) return null;

  return {
    severity: SEVERITY.warning,
    range: nodeRange(node),
    message: `Unknown identifier \`${name}\`. It is not declared in this scope or any enclosing scope.`,
    source: "svision",
    code: "unknown-identifier",
  };
}

/**
 * Flags `always @(a) ...` blocks that read a signal they do not list.
 * `always_comb`, `always_latch`, `always_ff` and `always @*` are excluded: the
 * first three are complete by construction, and the last covers every read.
 */
function sensitivityDiagnostic(node: Node): Diagnostic | null {
  const keywordText = alwaysKeyword(node);
  if (keywordText === "always_comb" || keywordText === "always_latch" || keywordText === "always_ff") {
    return null;
  }
  if (!keywordText.startsWith("always")) return null;

  // The explicit event list lives in `event_control`, below the keyword.
  let eventControl: Node | undefined;
  for (const inner of iterate(node)) {
    if (inner.type === "event_control") {
      eventControl = inner;
      break;
    }
  }
  if (!eventControl) return null;
  if (eventControl.text.includes("*")) return null;

  // A clocked block is sequential by design: only the clock and the async
  // reset belong in the list, so `always @(posedge clk)` is never a finding.
  if (eventControl.text.includes("posedge") || eventControl.text.includes("negedge")) {
    return null;
  }

  const declared = new Set<string>();
  for (const id of iterate(eventControl)) {
    if (id.type === "simple_identifier") declared.add(id.text);
  }
  if (declared.size === 0) return null;

  // Collect the lvalue side of every assignment in the block: identifiers inside
  // those subtrees are writes, not reads. The lvalue is nested under a wrapper,
  // so an ancestry check is needed rather than a parent-type test.
  const lvalues: Node[] = [];
  for (const inner of iterate(node)) {
    if (!ASSIGNMENT_TYPES.has(inner.type)) continue;
    const { left } = assignmentParts(inner);
    if (left) lvalues.push(left);
  }

  const read = new Set<string>();
  for (const id of iterate(node)) {
    if (id.type !== "simple_identifier") continue;
    if (isInside(id, eventControl)) continue;
    if (lvalues.some((lvalue) => isInside(id, lvalue))) continue;
    // `always @(DUT.u.x)` already lists what it watches; the segments of a
    // hierarchical name are not local signals the author could add.
    if (insideHierarchicalIdentifier(id)) continue;
    read.add(id.text);
  }

  const missing = [...read].filter((name) => !declared.has(name));
  if (missing.length === 0) return null;

  const listed = missing.slice(0, 4).map((m) => `\`${m}\``).join(", ");
  const overflow = missing.length > 4 ? `, +${missing.length - 4} more` : "";

  return {
    severity: SEVERITY.warning,
    range: nodeRange(node),
    message: `Sensitivity list is incomplete: ${listed}${overflow} ${missing.length === 1 ? "is" : "are"} read but not listed. Use \`always @(*)\` or \`always_comb\`.`,
    source: "svision",
    code: "implicit-sensitivity",
  };
}

/**
 * Reports signals assigned inside a combinational block without being assigned
 * on every execution path, which is what infers a latch.
 */
function latchDiagnostics(node: Node, assignedIn: Map<number, Set<string>>): Diagnostic[] {
  const assigned = assignedIn.get(node.id);
  if (!assigned || assigned.size === 0) return [];

  const guaranteed = guaranteedAssignments(node);
  const risky = [...assigned].filter((name) => !guaranteed.has(name));
  if (risky.length === 0) return [];

  const listed = risky.slice(0, 4).map((r) => `\`${r}\``).join(", ");
  const overflow = risky.length > 4 ? `, +${risky.length - 4} more` : "";

  return [
    {
      severity: SEVERITY.warning,
      range: nodeRange(node),
      message: `Possible latch inferred: ${listed}${overflow} ${risky.length === 1 ? "is" : "are"} not assigned on every path.`,
      source: "svision",
      code: "latch-inference",
    },
  ];
}

/** Records, per block node id, the set of signals assigned inside it. */
function collectAssignments(node: Node, into: Map<number, Set<string>>): void {
  into.set(node.id, assignedNamesWithin(node));
}

/** Statements of the block body, unwrapped from `statement`/`statement_item`. */
function bodyStatements(node: Node): Node[] {
  let body = node.namedChildren.find((c) => c.type !== "always_keyword");
  while (body && STATEMENT_WRAPPERS.has(body.type) && body.namedChildCount === 1) {
    body = body.namedChild(0)!;
  }
  if (!body) return [];

  // A begin/end block directly holds the statements.
  if (body.type === "seq_block") return [...body.namedChildren];

  // A single statement, possibly wrapped.
  const inner = unwrapStatement(body);
  return inner ? [inner] : [body];
}

function unwrapStatement(node: Node): Node | null {
  let current: Node = node;
  for (let i = 0; i < 16; i++) {
    if (STATEMENT_WRAPPERS.has(current.type) && current.namedChildCount === 1) {
      current = current.namedChild(0)!;
      continue;
    }
    if (current.type === "seq_block") return current;
    return current;
  }
  return current;
}

/**
 * Signals assigned on every execution path through the block.
 *
 * An assignment counts only when it is unconditional, or when every arm of an
 * `if`/`else` or every branch of a `case` (with a `default`) assigns it.
 */
function guaranteedAssignments(block: Node): Set<string> {
  let certain: Set<string> | null = null;
  for (const statement of bodyStatements(block)) {
    const names = guaranteedIn(statement);
    // A name survives only if every statement on every path assigns it.
    certain = certain === null ? names : intersect(certain, names);
  }
  return certain ?? new Set();
}

/** Assignments guaranteed by a single statement; empty means "may not run". */
function guaranteedIn(statement: Node): Set<string> {
  if (ASSIGNMENT_TYPES.has(statement.type)) {
    const name = lvalueName(assignmentParts(statement).left);
    return name ? new Set([name]) : new Set();
  }

  if (statement.type === "conditional_statement") {
    return guaranteedByConditional(statement);
  }

  if (statement.type === "case_statement") {
    return guaranteedByCase(statement);
  }

  // A begin/end at statement level runs straight through.
  const inner = unwrapStatement(statement);
  if (inner && inner !== statement) {
    let certain: Set<string> | null = null;
    const nested = inner.type === "seq_block" ? inner.namedChildren : [inner];
    for (const child of nested) {
      const names = guaranteedIn(child);
      certain = certain === null ? names : intersect(certain, names);
    }
    return certain ?? new Set();
  }

  return new Set();
}

function guaranteedByConditional(statement: Node): Set<string> {
  // `if / else if / else` is flattened into a single node holding every branch
  // in source order, so the arms are recovered from the child sequence.
  const arms = conditionalArms(statement);
  if (arms.length === 0) return new Set();

  // Without a final `else`, control can fall past the whole chain.
  const last = arms[arms.length - 1]!;
  if (!precededByElse(statement, last.body)) return new Set();

  let acc: Set<string> | null = null;
  for (const arm of arms) {
    const names = assignedNamesWithin(arm.body);
    acc = acc === null ? names : intersect(acc, names);
  }
  return acc ?? new Set();
}

/**
 * Every branch body of an `if` statement, in source order. The last entry is
 * the `else` body only when the statement ends with an `else`.
 */
function conditionalArms(statement: Node): { body: Node }[] {
  const arms: { body: Node }[] = [];

  for (const child of statement.children) {
    if (child.isNamed && child.type === "statement_or_null") {
      arms.push({ body: child });
    }
  }

  return arms;
}

function guaranteedByCase(statement: Node): Set<string> {
  const items = statement.namedChildren.filter((c) => c.type === "case_item");
  if (items.length === 0) return new Set();

  const hasDefault = items.some((item) =>
    item.children.some((k) => !k.isNamed && (k.type === "default" || k.type === "default:")),
  );
  if (!hasDefault) return new Set();

  let acc: Set<string> | null = null;
  for (const item of items) {
    const names = assignedNamesWithin(item);
    acc = acc === null ? names : intersect(acc, names);
  }
  return acc ?? new Set();
}

/** True when `child` sits immediately after an `else` token. */
function precededByElse(parent: Node, child: Node): boolean {
  const index = parent.children.findIndex((c) => c.id === child.id);
  if (index <= 0) return false;
  const previous = parent.children[index - 1]!;
  return !previous.isNamed && previous.type === "else";
}

/** True when `node` lies within `ancestor`. */
function isInside(node: Node, ancestor: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current.id === ancestor.id) return true;
    current = current.parent;
  }
  return false;
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const value of a) {
    if (b.has(value)) out.add(value);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Block classification
 * ------------------------------------------------------------------ */

function alwaysKeyword(node: Node): string {
  return node.namedChildren.find((c) => c.type === "always_keyword")?.text.trim() ?? "";
}

function isSequentialBlock(node: Node): boolean {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_ff";
}

function isCombinational(node: Node): boolean {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_comb";
}

/* ------------------------------------------------------------------ *
 * Tree walking and lookup
 * ------------------------------------------------------------------ */

/** Depth-first walk over every node, including anonymous ones. */
function* iterate(root: Node): Generator<Node> {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
}

function nodeRange(node: Node): Range {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

/**
 * Identifiers that are not variable references: member selections, package
 * scope resolution, module type names, scope declarations, and binding names.
 */
function isStructuralPosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;

  // `IDLE = 2'b00` inside `enum { ... }`: the name is the declaration itself,
  // not a use of something declared elsewhere.
  if (parent.type === "enum_name_declaration") return true;

  // `endpackage : p` repeats the name at the end of the declaration. Every
  // identifier directly inside a scope declaration is part of its header.
  if (
    parent.type === "package_declaration" ||
    parent.type === "module_declaration" ||
    parent.type === "interface_declaration"
  ) {
    return true;
  }

  // Macro names in `ifdef / `define / `include are not HDL identifiers.
  if (PREPROCESSOR_PARENTS.has(parent.type)) return true;
  if (parent.type.endsWith("_directive") || parent.type.endsWith("_condition")) return true;
  // The name of a module / interface / program.
  if (parent.type.endsWith("_header")) return true;
  // `a.b.c.d` -- only the first segment names something in this scope. Every
  // later segment is a member of an instance or an array element, reached
  // through the design hierarchy rather than declared here. This is what keeps
  // `force DUT.chrols[i].chrol.err = 0` from reporting `chrol` as unknown.
  //
  // The first segment is deliberately *not* filtered: `DUT` really does have to
  // be declared here, and a typo in it should still be reported.
  if (parent.type === "hierarchical_identifier" && parent.namedChild(0)?.id !== node.id) return true;
  // `pkg::name`
  if (parent.type === "scoped_identifier" || parent.type === "class_type") return true;
  if (parent.type === "package_import_item" || parent.type === "package_scope") return true;
  // `sub u_sub (...)` -- the type name.
  if (parent.type === "module_instantiation" && parent.childForFieldName("instance_type")?.id === node.id) {
    return true;
  }
  // `sub u_sub (...)` -- the instance name, which is also a declaration.
  if (parent.type === "name_of_instance" || parent.type === "simple_identifier_with_escaped_id") {
    return true;
  }
  // `.port(...)` and `.PARAM(...)` binding names.
  if (parent.type === "named_port_connection" || parent.type === "named_parameter_assignment") return true;
  // `int'(x)`, `$bits(t)`, and similar type positions.
  if (parent.type === "cast" || parent.type === "signing" || parent.type === "data_type") return true;
  // Struct literal fields.
  if (parent.type === "assignment_pattern_expression") return true;

  return false;
}

/**
 * True when `node` sits inside a *dotted* reference, `a.b.c`.
 *
 * A single name is also wrapped in a `hierarchical_identifier` by this grammar,
 * so the node type alone says nothing: what matters is whether there is more
 * than one segment. `a` is a local signal; `DUT.u.x` is a path into the design.
 */
function insideHierarchicalIdentifier(node: Node): boolean {
  let current: Node | null | undefined = node;
  while (current) {
    if (current.type === "hierarchical_identifier") {
      const segments = current.namedChildren.filter(
        (c) => c.type === "simple_identifier" || c.type === "select",
      ).length;
      if (segments > 1) return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * True when `name` is declared in the scope at `offset`, as a signal, a
 * parameter, or an instance.
 *
 * An instance is a declaration like any other: `u_dsp.a.b = 0` starts from
 * `u_dsp`, and reporting that as unknown would flag every hierarchical
 * reference into an instance -- which is how testbenches and `force` are
 * written.
 */
function isDeclaredHere(analysis: Analysis, name: string, offset: number): boolean {
  if (visibleSymbols(analysis, offset).some((s) => s.name === name)) return true;

  const chain = scopeChain(analysis, offset);
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i]!;
    if (scope.instances.some((instance) => instance.instanceName === name)) return true;
  }

  return false;
}

/** Builds an evaluation environment from folded parameters and known widths. */
function buildEnv(analysis: Analysis): EvalEnv {
  const paramValues = new Map<string, number>();
  const widths = new Map<string, number>();
  const handles = new Set<string>();

  for (const scope of analysis.scopes) {
    for (const param of scope.parameters) {
      if (param.resolvedValue !== undefined) paramValues.set(param.name, param.resolvedValue);
    }
    for (const port of scope.ports) {
      if (port.packedWidth !== undefined) widths.set(port.name, port.packedWidth);
    }
    for (const symbol of scope.symbols) {
      if (symbol.resolvedValue !== undefined) paramValues.set(symbol.name, symbol.resolvedValue);
      if (symbol.packedWidth !== undefined) widths.set(symbol.name, symbol.packedWidth);
      if (symbol.handleOf) handles.add(symbol.name);
    }
  }

  return {
    lookup: (name) => paramValues.get(name),
    symbolWidth: (name) => widths.get(name),
    isHandle: (name) => handles.has(name),
  };
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    const key = `${d.range.start.line}:${d.range.start.character}:${d.code ?? ""}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort(
    (a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
  );
}