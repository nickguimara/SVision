import type { Node } from "web-tree-sitter";

/**
 * Constant-expression evaluation for SystemVerilog.
 *
 * Everything here is deliberately conservative: when a value cannot be folded
 * with certainty the functions return `undefined` rather than guessing. That
 * matters because the results feed user-visible widths, and a wrong width is far
 * worse than no width.
 */

export interface EvalEnv {
  /** Value of a parameter / localparam / genvar, if known. */
  lookup(name: string): number | undefined;
  /** Bit width of a declared net or variable, if known. */
  symbolWidth(name: string): number | undefined;
  /**
   * True for a class object handle, which has no bit width.
   *
   * A handle has no width of its own -- values reach it through its members --
   * so width arithmetic has to leave it alone rather than treat it as 1 bit.
   */
  isHandle?(name: string): boolean;
}

export const EMPTY_ENV: EvalEnv = { lookup: () => undefined, symbolWidth: () => undefined };

/** Binary operators, lowest binding power last. */
const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "~|": 3,
  "^": 4,
  "~^": 4,
  "^~": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "===": 6,
  "!==": 6,
  "==?": 6,
  "!=?": 6,
  "<": 7,
  "<=": 7,
  ">": 7,
  ">=": 7,
  "<<": 8,
  ">>": 8,
  "<<<": 8,
  ">>>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};

/** Node types that merely wrap a single expression. */
const WRAPPERS = new Set([
  "expression",
  "constant_expression",
  "constant_primary",
  "mintypmax_expression",
  "constant_mintypmax_expression",
  "primary",
  "data_type_or_implicit",
  "expression_or_dist",
  "unary_expression",
  "parenthesized_expression",
  "net_lvalue",
  "variable_lvalue",
  "param_expression",
  "constant_range",
]);

/** Comparison and logical operators always yield a 1-bit result. */
const COMPARISON = new Set(["==", "!=", "===", "!==", "==?", "!=?", "<", "<=", ">", ">=", "&&", "||"]);
const LOGICAL = new Set(["&&", "||"]);
const BITWISE = new Set(["&", "|", "^", "~^", "^~"]);

/** Shallow scan for a top-level binary operator child. */
function findOperator(node: Node): { index: number; op: string; prec: number } | undefined {
  let best: { index: number; op: string; prec: number } | undefined;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.isNamed) continue;
    const prec = PRECEDENCE[child.type];
    if (prec === undefined) continue;
    // Lowest precedence wins; ties resolve to the left-most operator (left assoc).
    if (!best || prec < best.prec) {
      best = { index: i, op: child.type, prec };
      if (prec === 1) break;
    }
  }
  return best;
}

/** Last non-trivial child, used as the fallback operand of a unary operator. */
function operandChild(node: Node): Node | undefined {
  const named = node.namedChildren;
  if (named.length === 0) return undefined;
  return named[named.length - 1];
}

/** Strips wrapper layers until a node with real structure is reached. */
function unwrap(node: Node): Node {
  let current = node;
  // Bounded to avoid pathological nesting in malformed input.
  for (let i = 0; i < 64; i++) {
    if (current.namedChildCount === 1 && WRAPPERS.has(current.type)) {
      const inner = current.namedChild(0);
      if (!inner) break;
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

const SIZE_RE = /^(\d+)?'\s*[sS]?([bodhBODH])\s*([0-9a-fA-FxXzZ_]+)$/;
const PLAIN_RE = /^[0-9][0-9_]*$/;
const UNBASED_RE = /^'\s*[sS]?([01xXzZ])$/;
const BASED_ONLY_RE = /^'(?:[sS]?)([bodhBODH])\s*([0-9a-fA-FxXzZ_]+)$/;

/** Parses a numeric literal's text. Returns value and declared bit size. */
function parseLiteral(text: string): { value: number; size?: number } | undefined {
  const s = text.trim().replace(/_/g, "");

  const unbased = UNBASED_RE.exec(s);
  if (unbased) {
    const ch = unbased[1]!.toLowerCase();
    return { value: ch === "1" ? 1 : 0, size: 1 };
  }

  const sized = SIZE_RE.exec(s);
  if (sized) {
    const size = sized[1] ? parseInt(sized[1], 10) : undefined;
    const base = sized[2]!.toLowerCase();
    const digits = sized[3]!;
    const radix = base === "b" ? 2 : base === "o" ? 8 : base === "h" ? 16 : 10;
    // x/z digits make the value only partially known; fold them to 0.
    if (/[xXzZ]/.test(digits)) {
      return { value: 0, size };
    }
    const value = parseInt(digits, radix);
    if (Number.isNaN(value)) return { value: 0, size };
    return { value, size };
  }

  if (PLAIN_RE.test(s)) {
    return { value: parseInt(s, 10) };
  }

  // `'hFF` with no explicit size.
  const based = BASED_ONLY_RE.exec(s);
  if (based) {
    const base = based[1]!.toLowerCase();
    const digits = based[2]!;
    if (/[xXzZ]/.test(digits)) return { value: 0 };
    const radix = base === "b" ? 2 : base === "o" ? 8 : base === "h" ? 16 : 10;
    const value = parseInt(digits, radix);
    return Number.isNaN(value) ? undefined : { value };
  }

  return undefined;
}

/** Built-in system functions worth folding for width computation. */
function callSystemFunction(node: Node, env: EvalEnv): number | undefined {
  const text = node.text.trim();
  const match = /^\$([A-Za-z_][A-Za-z0-9_$]*)\s*\(([\s\S]*)\)$/.exec(text);
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const argText = match[2]!.trim();

  switch (name) {
    case "clog2": {
      if (argText === "") return 0;
      const arg = evaluateText(argText, env);
      if (arg === undefined || arg <= 1) return undefined;
      return Math.ceil(Math.log2(arg));
    }
    case "ceil": {
      const arg = evaluateText(argText, env);
      return arg === undefined ? undefined : Math.ceil(arg);
    }
    case "floor": {
      const arg = evaluateText(argText, env);
      return arg === undefined ? undefined : Math.floor(arg);
    }
    case "bits": {
      if (!argText) return undefined;
      // `$bits(type_or_signal)` -- only resolvable through a symbol width.
      const cleaned = argText.replace(/^\[[^\]]*\]\s*/, "");
      return env.symbolWidth(cleaned);
    }
    case "size": {
      if (!argText) return undefined;
      return env.symbolWidth(argText.replace(/^\[[^\]]*\]\s*/, ""));
    }
    case "left": {
      const args = argText.split(",");
      const value = evaluateText(args[0] ?? "", env);
      const width = evaluateText(args[1] ?? "", env);
      if (value === undefined || width === undefined) return undefined;
      const mask = width >= 32 ? 0xffffffff : (1 << width) - 1;
      return (value << width) & mask;
    }
    case "right": {
      const args = argText.split(",");
      const value = evaluateText(args[0] ?? "", env);
      const width = evaluateText(args[1] ?? "", env);
      if (value === undefined || width === undefined) return undefined;
      return value >>> width;
    }
    default:
      return undefined;
  }
}

/**
 * Evaluates a constant expression to an integer.
 * Returns `undefined` when the value cannot be determined exactly.
 */
export function evaluate(node: Node | null | undefined, env: EvalEnv): number | undefined {
  if (!node) return undefined;
  const current = unwrap(node);

  const op = findOperator(current);
  if (op) {
    const leftNode = current.child(op.index - 1);
    const rightNode = current.child(op.index + 1);
    if (!leftNode || !rightNode) return undefined;

    // Logical operators short-circuit, so a 0 lhs is enough to decide.
    if (LOGICAL.has(op.op)) {
      const left = evaluate(leftNode, env);
      const right = evaluate(rightNode, env);
      if (left === undefined || right === undefined) return undefined;
      return apply(op.op, left, right);
    }

    const left = evaluate(leftNode, env);
    const right = evaluate(rightNode, env);
    if (left === undefined || right === undefined) return undefined;
    return apply(op.op, left, right);
  }

  // Unary operators.
  if (current.childCount >= 2 && !current.child(0)!.isNamed) {
    const token = current.child(0)!.type;
    if (token === "-" || token === "+" || token === "~" || token === "!") {
      const operand = operandChild(current);
      if (!operand) return undefined;
      const value = evaluate(operand, env);
      if (value === undefined) return undefined;
      if (token === "-") return -value;
      if (token === "~") return ~value;
      if (token === "!") return value === 0 ? 1 : 0;
      return value;
    }
  }

  if (current.type === "simple_identifier") {
    const value = env.lookup(current.text);
    if (value !== undefined) return value;
    // A bare identifier may also be a 1-bit signal; that is a width, not a value.
    return undefined;
  }

  if (current.type === "hierarchical_identifier") {
    return undefined;
  }

  if (current.type.includes("function_call") || current.type === "system_tf_call") {
    return callSystemFunction(current, env);
  }

  if (current.type === "concatenation") {
    // Concatenation value = low bits last.
    let value = 0;
    let shift = 0;
    for (const child of current.namedChildren) {
      const part = evaluate(child, env);
      if (part === undefined) return undefined;
      const partWidth = widthOf(child, env) ?? 32;
      value |= part << shift;
      shift += partWidth;
    }
    return value;
  }

  if (current.type === "primary_literal" || current.type === "integral_number" || current.type === "number") {
    return parseLiteral(current.text)?.value;
  }

  // Last resort: a single-child wrapper the tables above did not name.
  if (current.namedChildCount === 1) {
    const inner = current.namedChild(0);
    if (inner && inner.id !== current.id) return evaluate(inner, env);
  }

  const literal = parseLiteral(current.text);
  return literal?.value;
}

/**
 * Folds a constant expression given as source text.
 *
 * Used for the parts of a declaration that the analyzer keeps as text (default
 * values, packed range strings) rather than as syntax nodes. Like {@link
 * evaluate}, it returns `undefined` whenever the value is not certain.
 */
export function evaluateText(text: string, env: EvalEnv): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // `pkg::PARAM` is a parameter named in another file. The package qualifier is
  // not arithmetic -- it only says where the name lives -- so it is dropped and
  // the name looked up on its own. The analyzer seeded the value from the
  // catalog before calling, which is what makes the lookup below succeed.
  const qualified = /^[A-Za-z_]\w*::([A-Za-z_]\w*)$/.exec(trimmed);
  if (qualified) return env.lookup?.(qualified[1]!);

  if (env.lookup) {
    const direct = env.lookup(trimmed);
    if (direct !== undefined) return direct;
  }

  const literal = parseLiteral(trimmed.replace(/_/g, ""));
  if (literal) return literal.value;

  // $clog2(<expr>)
  const clog = /^\$clog2\s*\(([\s\S]*)\)$/.exec(trimmed);
  if (clog) {
    const arg = evaluateText(clog[1]!, env);
    if (arg === undefined || arg <= 1) return undefined;
    return Math.ceil(Math.log2(arg));
  }

  const parenthesised = /^\(\s*([\s\S]*)\s*\)$/.exec(trimmed);
  if (parenthesised) return evaluateText(parenthesised[1]!, env);

  // Unary sign.
  if (trimmed.startsWith("-")) {
    const value = evaluateText(trimmed.slice(1), env);
    return value === undefined ? undefined : -value;
  }
  if (trimmed.startsWith("+")) return evaluateText(trimmed.slice(1), env);

  // A bare identifier is a parameter or a 1-bit signal, never a usable number.
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) return undefined;

  const binary = findTopLevelBinary(trimmed);
  if (binary) {
    const left = evaluateText(trimmed.slice(0, binary.index), env);
    const right = evaluateText(trimmed.slice(binary.index + binary.op.length), env);
    if (left === undefined || right === undefined) return undefined;
    return apply(binary.op, left, right);
  }

  return undefined;
}

/** Binary operators considered when splitting an expression written as text. */
const TEXT_OPERATORS = ["<<", ">>", "+", "-", "*", "/", "%", "&", "|", "^"];

/**
 * Splits on the lowest-precedence top-level operator, respecting parentheses.
 * Returns the right-most such operator so the left operand is the largest term.
 */
function findTopLevelBinary(text: string): { index: number; op: string } | undefined {
  let depth = 0;
  let best: { index: number; op: string; prec: number } | undefined;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0) {
      const two = text.slice(i, i + 2);
      const op = TEXT_OPERATORS.includes(two) ? two : TEXT_OPERATORS.includes(char) ? char : undefined;
      if (!op) continue;
      // A leading `+`/`-` is a sign, not an operator.
      if (i === 0) continue;

      const prec = PRECEDENCE[op] ?? 0;
      if (!best || prec <= best.prec) best = { index: i, op, prec };
    }
  }

  return best ? { index: best.index, op: best.op } : undefined;
}

function apply(op: string, left: number, right: number): number {
  switch (op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": return left * right;
    case "/": return right === 0 ? undefined! : Math.trunc(left / right);
    case "%": return right === 0 ? undefined! : left % right;
    case "**": return left ** right;
    case "<<": return left << right;
    case ">>": return left >> right;
    case "<<<": return left << right;
    case ">>>": return left >>> right;
    case "&": return left & right;
    case "|": return left | right;
    case "^": return left ^ right;
    case "~^":
    case "^~": return ~(left ^ right);
    case "&&": return left !== 0 && right !== 0 ? 1 : 0;
    case "||": return left !== 0 || right !== 0 ? 1 : 0;
    case "==": return left === right ? 1 : 0;
    case "!=": return left !== right ? 1 : 0;
    case "===": return left === right ? 1 : 0;
    case "!==": return left !== right ? 1 : 0;
    case "==?": return left === right ? 1 : 0;
    case "!=?": return left !== right ? 1 : 0;
    case "<": return left < right ? 1 : 0;
    case "<=": return left <= right ? 1 : 0;
    case ">": return left > right ? 1 : 0;
    case ">=": return left >= right ? 1 : 0;
    default: return undefined!;
  }
}

/**
 * Bit width of an expression, used for assignment width checks and for
 * annotating inferred sub-expressions. Returns `undefined` when unknown.
 */
export function widthOf(node: Node | null | undefined, env: EvalEnv): number | undefined {
  if (!node) return undefined;
  const current = unwrap(node);

  const op = findOperator(current);
  if (op) {
    if (COMPARISON.has(op.op)) return 1;
    if (LOGICAL.has(op.op)) return 1;
    const left = widthOf(current.child(op.index - 1), env);
    const right = widthOf(current.child(op.index + 1), env);
    if (BITWISE.has(op.op)) {
      if (left === undefined || right === undefined) return undefined;
      return Math.max(left, right);
    }
    if (left === undefined || right === undefined) return undefined;
    return Math.max(left, right);
  }

  if (current.childCount >= 2 && !current.child(0)!.isNamed) {
    const token = current.child(0)!.type;
    if (token === "!" ) return 1;
    if (token === "~") return widthOf(operandChild(current), env);
    if (token === "-" || token === "+") return widthOf(operandChild(current), env);
  }

  if (current.type === "simple_identifier") {
    return env.symbolWidth(current.text);
  }

  if (current.type === "hierarchical_identifier") {
    // `a.b.c` -- resolve through the leftmost segment.
    const first = current.namedChild(0);
    return first ? widthOf(first, env) : undefined;
  }

  if (current.type === "select" || current.type === "bit_select" || current.type === "part_select_range") {
    const rangeNode = current.namedChildren.find((c) => c.type === "constant_range" || c.type === "constant_expression");
    if (!rangeNode) return 1; // single-bit select
    return rangeWidth(rangeNode, env);
  }

  if (current.type === "constant_range") {
    return rangeWidth(current, env);
  }

  if (current.type === "concatenation") {
    // Replication `{ N { expr } }`: the inner concatenation has a count
    // expression and the replicated expression as its first two named children.
    const raw = current.text.trim();
    if (/^\{\s*[^}\s]+\s*\{/.test(raw)) {
      const count = evaluateText(raw.slice(1).trim().split(/\s+/)[0] ?? "", env);
      if (count === undefined) return undefined;
      const inner = current.namedChild(1);
      const innerWidth = inner ? (widthOf(inner, env) ?? 32) : 32;
      return count * innerWidth;
    }

    let total = 0;
    let seen = false;
    for (const child of current.namedChildren) {
      const w = widthOf(child, env);
      if (w === undefined) return undefined;
      total += w;
      seen = true;
    }
    return seen ? total : undefined;
  }

  if (current.type === "primary_literal" || current.type === "integral_number" || current.type === "number") {
    const literal = parseLiteral(current.text);
    if (!literal) return undefined;
    if (literal.size !== undefined) return literal.size;
    // Unsized literals take the width of the context; 32 is the SV default.
    return 32;
  }

  if (current.type.includes("function_call") || current.type === "system_tf_call") {
    return undefined;
  }

  return undefined;
}

/**
 * Width spanned by a dimension node: `[msb:lsb]`, `[size]`, or a
 * `packed_dimension` / `unpacked_dimension` / `select` that wraps one of those.
 */
export function rangeWidth(node: Node, env: EvalEnv): number | undefined {
  // Dimensions nest their range one level down, so descend first.
  if (node.type === "packed_dimension" || node.type === "unpacked_dimension" || node.type === "select") {
    const inner = node.namedChildren.find((c) => c.type === "constant_range");
    if (!inner) return undefined;
    return rangeWidth(inner, env);
  }

  const named = node.namedChildren;
  if (named.length === 0) return undefined;

  // Colon form: msb:lsb.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed && child.type === ":") {
      const msb = evaluate(node.child(i - 1), env);
      const lsb = evaluate(node.child(i + 1), env);
      if (msb === undefined || lsb === undefined) return undefined;
      return Math.abs(msb - lsb) + 1;
    }
  }

  // Single form: [expr] -- an implicit [:expr], so size == expr + 1.
  const value = evaluate(named[0]!, env);
  if (value === undefined) return undefined;
  return value + 1;
}

/** Width of a packed range written as text, e.g. `WIDTH-1:0`. */
export function widthOfText(text: string, env: EvalEnv): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const colon = indexOfTopLevelColon(t);
  if (colon >= 0) {
    const msb = evaluateText(t.slice(0, colon), env);
    const lsb = evaluateText(t.slice(colon + 1), env);
    if (msb === undefined || lsb === undefined) return undefined;
    return Math.abs(msb - lsb) + 1;
  }
  const value = evaluateText(t, env);
  if (value === undefined) return undefined;
  return value + 1;
}

/**
 * The index of the `:` that separates the two ends of a range.
 *
 * `pkg::PARAM` is skipped: the scope-resolution operator is not a range, and
 * taking its first colon would split `salsa2_dsp_pkg::WIDTH-1:0` into a package
 * name and a nonsense remainder, so every qualified width came out unknown.
 */
function indexOfTopLevelColon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ":" && depth === 0) {
      // `::` is a scope resolution; only a lone colon ends a range.
      if (text[i + 1] === ":") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/** Number of elements described by unpacked dimensions, e.g. `[D-1:0][7:0]`. */
/**
 * How many elements an array of the given unpacked dimensions holds.
 *
 * A dimension is either a range, `[7:0]`, or a size, `[DEPTH]`. The two are
 * not the same number: `[7:0]` is 8 elements while `[8]` is 8 as well, but a
 * range is a difference plus one and a size is the value itself. Folding a size
 * as a range would turn a 4-element array into 5, which the Navigator then
 * reports as `5 x 32 bits`.
 */
export function unpackedCount(dims: string[], env: EvalEnv): number | undefined {
  if (dims.length === 0) return 1;
  let total = 1;
  for (const dim of dims) {
    const inner = dim.trim().replace(/^\[/, "").replace(/\]$/, "");
    const count = indexOfTopLevelColon(inner) >= 0
      ? widthOfText(inner, env)
      : evaluateText(inner, env);
    if (count === undefined) return undefined;
    total *= count;
  }
  return total;
}