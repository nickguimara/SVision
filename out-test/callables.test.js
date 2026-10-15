"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// test/callables.test.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_node_fs3 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path4 = __toESM(require("node:path"));
var import_node_test = require("node:test");
var import_vscode_languageserver_textdocument = require("vscode-languageserver-textdocument");

// src/server/verilogParser.ts
var import_web_tree_sitter = require("web-tree-sitter");
var VerilogParser = class _VerilogParser {
  static language;
  static initPromise;
  language;
  parser;
  constructor(language) {
    this.language = language;
    this.parser = new import_web_tree_sitter.Parser();
    this.parser.setLanguage(language);
  }
  static async create() {
    const language = await _VerilogParser.loadLanguage();
    return new _VerilogParser(language);
  }
  static loadLanguage() {
    if (_VerilogParser.language) {
      return Promise.resolve(_VerilogParser.language);
    }
    if (!_VerilogParser.initPromise) {
      _VerilogParser.initPromise = (async () => {
        await import_web_tree_sitter.Parser.init({
          locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm")
        });
        const wasm = require.resolve("tree-sitter-systemverilog/tree-sitter-systemverilog.wasm");
        const language = await import_web_tree_sitter.Language.load(wasm);
        _VerilogParser.language = language;
        return language;
      })();
    }
    return _VerilogParser.initPromise;
  }
  /**
   * Parses `text`, reusing the previous parse for incremental updates when the
   * caller supplies the corresponding old tree.
   */
  parse(text, oldTree) {
    const tree = this.parser.parse(text, oldTree);
    if (tree) return tree;
    const fallback = this.parser.parse(text);
    if (!fallback) throw new Error("tree-sitter failed to produce a tree");
    return fallback;
  }
  getLanguage() {
    return this.language;
  }
  /** The node covering `offset`, preferring the innermost named node. */
  nodeAt(tree, offset) {
    const root = tree.rootNode;
    if (offset < 0 || offset > root.endIndex) return null;
    const raw = root.namedDescendantForIndex(offset);
    if (!raw) return null;
    return raw.startIndex <= offset && offset < raw.endIndex ? raw : raw.parent ?? raw;
  }
  dispose() {
    try {
      this.parser.delete();
    } catch {
    }
  }
};

// src/server/eval.ts
var PRECEDENCE = {
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
  "**": 11
};
var WRAPPERS = /* @__PURE__ */ new Set([
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
  "constant_range"
]);
var COMPARISON = /* @__PURE__ */ new Set(["==", "!=", "===", "!==", "==?", "!=?", "<", "<=", ">", ">=", "&&", "||"]);
var LOGICAL = /* @__PURE__ */ new Set(["&&", "||"]);
var BITWISE = /* @__PURE__ */ new Set(["&", "|", "^", "~^", "^~"]);
function findOperator(node) {
  let best;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.isNamed) continue;
    const prec = PRECEDENCE[child.type];
    if (prec === void 0) continue;
    if (!best || prec < best.prec) {
      best = { index: i, op: child.type, prec };
      if (prec === 1) break;
    }
  }
  return best;
}
function operandChild(node) {
  const named = node.namedChildren;
  if (named.length === 0) return void 0;
  return named[named.length - 1];
}
function unwrap(node) {
  let current = node;
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
var SIZE_RE = /^(\d+)?'\s*[sS]?([bodhBODH])\s*([0-9a-fA-FxXzZ_]+)$/;
var PLAIN_RE = /^[0-9][0-9_]*$/;
var UNBASED_RE = /^'\s*[sS]?([01xXzZ])$/;
var BASED_ONLY_RE = /^'(?:[sS]?)([bodhBODH])\s*([0-9a-fA-FxXzZ_]+)$/;
function parseLiteral(text) {
  const s = text.trim().replace(/_/g, "");
  const unbased = UNBASED_RE.exec(s);
  if (unbased) {
    const ch = unbased[1].toLowerCase();
    return { value: ch === "1" ? 1 : 0, size: 1 };
  }
  const sized = SIZE_RE.exec(s);
  if (sized) {
    const size = sized[1] ? parseInt(sized[1], 10) : void 0;
    const base = sized[2].toLowerCase();
    const digits = sized[3];
    const radix = base === "b" ? 2 : base === "o" ? 8 : base === "h" ? 16 : 10;
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
  const based = BASED_ONLY_RE.exec(s);
  if (based) {
    const base = based[1].toLowerCase();
    const digits = based[2];
    if (/[xXzZ]/.test(digits)) return { value: 0 };
    const radix = base === "b" ? 2 : base === "o" ? 8 : base === "h" ? 16 : 10;
    const value = parseInt(digits, radix);
    return Number.isNaN(value) ? void 0 : { value };
  }
  return void 0;
}
function callSystemFunction(node, env) {
  const text = node.text.trim();
  const match = /^\$([A-Za-z_][A-Za-z0-9_$]*)\s*\(([\s\S]*)\)$/.exec(text);
  if (!match) return void 0;
  const name = match[1].toLowerCase();
  const argText = match[2].trim();
  switch (name) {
    case "clog2": {
      if (argText === "") return 0;
      const arg = evaluateText(argText, env);
      if (arg === void 0 || arg <= 1) return void 0;
      return Math.ceil(Math.log2(arg));
    }
    case "ceil": {
      const arg = evaluateText(argText, env);
      return arg === void 0 ? void 0 : Math.ceil(arg);
    }
    case "floor": {
      const arg = evaluateText(argText, env);
      return arg === void 0 ? void 0 : Math.floor(arg);
    }
    case "bits": {
      if (!argText) return void 0;
      const cleaned = argText.replace(/^\[[^\]]*\]\s*/, "");
      return env.symbolWidth(cleaned);
    }
    case "size": {
      if (!argText) return void 0;
      return env.symbolWidth(argText.replace(/^\[[^\]]*\]\s*/, ""));
    }
    case "left": {
      const args = argText.split(",");
      const value = evaluateText(args[0] ?? "", env);
      const width = evaluateText(args[1] ?? "", env);
      if (value === void 0 || width === void 0) return void 0;
      const mask = width >= 32 ? 4294967295 : (1 << width) - 1;
      return value << width & mask;
    }
    case "right": {
      const args = argText.split(",");
      const value = evaluateText(args[0] ?? "", env);
      const width = evaluateText(args[1] ?? "", env);
      if (value === void 0 || width === void 0) return void 0;
      return value >>> width;
    }
    default:
      return void 0;
  }
}
function evaluate(node, env) {
  if (!node) return void 0;
  const current = unwrap(node);
  const op = findOperator(current);
  if (op) {
    const leftNode = current.child(op.index - 1);
    const rightNode = current.child(op.index + 1);
    if (!leftNode || !rightNode) return void 0;
    if (LOGICAL.has(op.op)) {
      const left2 = evaluate(leftNode, env);
      const right2 = evaluate(rightNode, env);
      if (left2 === void 0 || right2 === void 0) return void 0;
      return apply(op.op, left2, right2);
    }
    const left = evaluate(leftNode, env);
    const right = evaluate(rightNode, env);
    if (left === void 0 || right === void 0) return void 0;
    return apply(op.op, left, right);
  }
  if (current.childCount >= 2 && !current.child(0).isNamed) {
    const token = current.child(0).type;
    if (token === "-" || token === "+" || token === "~" || token === "!") {
      const operand = operandChild(current);
      if (!operand) return void 0;
      const value = evaluate(operand, env);
      if (value === void 0) return void 0;
      if (token === "-") return -value;
      if (token === "~") return ~value;
      if (token === "!") return value === 0 ? 1 : 0;
      return value;
    }
  }
  if (current.type === "simple_identifier") {
    const value = env.lookup(current.text);
    if (value !== void 0) return value;
    return void 0;
  }
  if (current.type === "hierarchical_identifier") {
    return void 0;
  }
  if (current.type.includes("function_call") || current.type === "system_tf_call") {
    return callSystemFunction(current, env);
  }
  if (current.type === "concatenation") {
    let value = 0;
    let shift = 0;
    for (const child of current.namedChildren) {
      const part = evaluate(child, env);
      if (part === void 0) return void 0;
      const partWidth = widthOf(child, env) ?? 32;
      value |= part << shift;
      shift += partWidth;
    }
    return value;
  }
  if (current.type === "primary_literal" || current.type === "integral_number" || current.type === "number") {
    return parseLiteral(current.text)?.value;
  }
  if (current.namedChildCount === 1) {
    const inner = current.namedChild(0);
    if (inner && inner.id !== current.id) return evaluate(inner, env);
  }
  const literal = parseLiteral(current.text);
  return literal?.value;
}
function evaluateText(text, env) {
  const trimmed = text.trim();
  if (!trimmed) return void 0;
  const qualified = /^[A-Za-z_]\w*::([A-Za-z_]\w*)$/.exec(trimmed);
  if (qualified) return env.lookup?.(qualified[1]);
  if (env.lookup) {
    const direct = env.lookup(trimmed);
    if (direct !== void 0) return direct;
  }
  const literal = parseLiteral(trimmed.replace(/_/g, ""));
  if (literal) return literal.value;
  const clog = /^\$clog2\s*\(([\s\S]*)\)$/.exec(trimmed);
  if (clog) {
    const arg = evaluateText(clog[1], env);
    if (arg === void 0 || arg <= 1) return void 0;
    return Math.ceil(Math.log2(arg));
  }
  const parenthesised = /^\(\s*([\s\S]*)\s*\)$/.exec(trimmed);
  if (parenthesised) return evaluateText(parenthesised[1], env);
  if (trimmed.startsWith("-")) {
    const value = evaluateText(trimmed.slice(1), env);
    return value === void 0 ? void 0 : -value;
  }
  if (trimmed.startsWith("+")) return evaluateText(trimmed.slice(1), env);
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) return void 0;
  const binary = findTopLevelBinary(trimmed);
  if (binary) {
    const left = evaluateText(trimmed.slice(0, binary.index), env);
    const right = evaluateText(trimmed.slice(binary.index + binary.op.length), env);
    if (left === void 0 || right === void 0) return void 0;
    return apply(binary.op, left, right);
  }
  return void 0;
}
var TEXT_OPERATORS = ["<<", ">>", "+", "-", "*", "/", "%", "&", "|", "^"];
function findTopLevelBinary(text) {
  let depth = 0;
  let best;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0) {
      const two = text.slice(i, i + 2);
      const op = TEXT_OPERATORS.includes(two) ? two : TEXT_OPERATORS.includes(char) ? char : void 0;
      if (!op) continue;
      if (i === 0) continue;
      const prec = PRECEDENCE[op] ?? 0;
      if (!best || prec <= best.prec) best = { index: i, op, prec };
    }
  }
  return best ? { index: best.index, op: best.op } : void 0;
}
function apply(op, left, right) {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? void 0 : Math.trunc(left / right);
    case "%":
      return right === 0 ? void 0 : left % right;
    case "**":
      return left ** right;
    case "<<":
      return left << right;
    case ">>":
      return left >> right;
    case "<<<":
      return left << right;
    case ">>>":
      return left >>> right;
    case "&":
      return left & right;
    case "|":
      return left | right;
    case "^":
      return left ^ right;
    case "~^":
    case "^~":
      return ~(left ^ right);
    case "&&":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "||":
      return left !== 0 || right !== 0 ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
    case "===":
      return left === right ? 1 : 0;
    case "!==":
      return left !== right ? 1 : 0;
    case "==?":
      return left === right ? 1 : 0;
    case "!=?":
      return left !== right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    default:
      return void 0;
  }
}
function widthOf(node, env) {
  if (!node) return void 0;
  const current = unwrap(node);
  const op = findOperator(current);
  if (op) {
    if (COMPARISON.has(op.op)) return 1;
    if (LOGICAL.has(op.op)) return 1;
    const left = widthOf(current.child(op.index - 1), env);
    const right = widthOf(current.child(op.index + 1), env);
    if (BITWISE.has(op.op)) {
      if (left === void 0 || right === void 0) return void 0;
      return Math.max(left, right);
    }
    if (left === void 0 || right === void 0) return void 0;
    return Math.max(left, right);
  }
  if (current.childCount >= 2 && !current.child(0).isNamed) {
    const token = current.child(0).type;
    if (token === "!") return 1;
    if (token === "~") return widthOf(operandChild(current), env);
    if (token === "-" || token === "+") return widthOf(operandChild(current), env);
  }
  if (current.type === "simple_identifier") {
    return env.symbolWidth(current.text);
  }
  if (current.type === "hierarchical_identifier") {
    const first = current.namedChild(0);
    return first ? widthOf(first, env) : void 0;
  }
  if (current.type === "select" || current.type === "bit_select" || current.type === "part_select_range") {
    const rangeNode = current.namedChildren.find((c) => c.type === "constant_range" || c.type === "constant_expression");
    if (!rangeNode) return 1;
    return rangeWidth(rangeNode, env);
  }
  if (current.type === "constant_range") {
    return rangeWidth(current, env);
  }
  if (current.type === "concatenation") {
    const raw = current.text.trim();
    if (/^\{\s*[^}\s]+\s*\{/.test(raw)) {
      const count = evaluateText(raw.slice(1).trim().split(/\s+/)[0] ?? "", env);
      if (count === void 0) return void 0;
      const inner = current.namedChild(1);
      const innerWidth = inner ? widthOf(inner, env) ?? 32 : 32;
      return count * innerWidth;
    }
    let total = 0;
    let seen = false;
    for (const child of current.namedChildren) {
      const w = widthOf(child, env);
      if (w === void 0) return void 0;
      total += w;
      seen = true;
    }
    return seen ? total : void 0;
  }
  if (current.type === "primary_literal" || current.type === "integral_number" || current.type === "number") {
    const literal = parseLiteral(current.text);
    if (!literal) return void 0;
    if (literal.size !== void 0) return literal.size;
    return 32;
  }
  if (current.type.includes("function_call") || current.type === "system_tf_call") {
    return void 0;
  }
  return void 0;
}
function rangeWidth(node, env) {
  if (node.type === "packed_dimension" || node.type === "unpacked_dimension" || node.type === "select") {
    const inner = node.namedChildren.find((c) => c.type === "constant_range");
    if (!inner) return void 0;
    return rangeWidth(inner, env);
  }
  const named = node.namedChildren;
  if (named.length === 0) return void 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed && child.type === ":") {
      const msb = evaluate(node.child(i - 1), env);
      const lsb = evaluate(node.child(i + 1), env);
      if (msb === void 0 || lsb === void 0) return void 0;
      return Math.abs(msb - lsb) + 1;
    }
  }
  const value = evaluate(named[0], env);
  if (value === void 0) return void 0;
  return value + 1;
}
function widthOfText(text, env) {
  const t = text.trim();
  if (!t) return void 0;
  const colon = indexOfTopLevelColon(t);
  if (colon >= 0) {
    const msb = evaluateText(t.slice(0, colon), env);
    const lsb = evaluateText(t.slice(colon + 1), env);
    if (msb === void 0 || lsb === void 0) return void 0;
    return Math.abs(msb - lsb) + 1;
  }
  const value = evaluateText(t, env);
  if (value === void 0) return void 0;
  return value + 1;
}
function indexOfTopLevelColon(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ":" && depth === 0) {
      if (text[i + 1] === ":") {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}
function unpackedCount(dims, env) {
  if (dims.length === 0) return 1;
  let total = 1;
  for (const dim of dims) {
    const inner = dim.trim().replace(/^\[/, "").replace(/\]$/, "");
    const count = indexOfTopLevelColon(inner) >= 0 ? widthOfText(inner, env) : evaluateText(inner, env);
    if (count === void 0) return void 0;
    total *= count;
  }
  return total;
}

// src/server/trees.ts
function toPosition(p) {
  return { line: p.row, character: p.column };
}
function toRange(node) {
  return {
    start: toPosition(node.startPosition),
    end: toPosition(node.endPosition)
  };
}
function* iterate(root) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    yield node;
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
}
var ASSIGNMENT_TYPES = /* @__PURE__ */ new Set([
  "blocking_assignment",
  "nonblocking_assignment",
  "net_assignment",
  "operator_assignment"
]);
function lvalueName(node) {
  if (!node) return void 0;
  if (node.type === "simple_identifier") return node.text;
  if (node.type === "hierarchical_identifier") return lvalueName(node.namedChild(0) ?? null);
  if (node.type === "select" || node.type === "bit_select" || node.type === "part_select_range" || node.type === "variable_lvalue" || node.type === "net_lvalue" || node.type === "primary") {
    return lvalueName(node.namedChildren[0] ?? null);
  }
  return void 0;
}
function firstLine(text) {
  const line = text.split("\n", 1)[0] ?? text;
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}\u2026` : trimmed;
}

// src/server/signalAccess.ts
var SCOPE_BOUNDARIES = /* @__PURE__ */ new Set([
  "module_declaration",
  "interface_declaration",
  "program_declaration",
  "package_declaration",
  "class_declaration",
  "generate",
  "generate_region"
]);
var SIGNAL_CATEGORIES = /* @__PURE__ */ new Set(["net", "variable", "port"]);
var DECLARATION_ONLY_TYPES = /* @__PURE__ */ new Set(["enum_name_declaration"]);
var PREPROCESSOR_TYPES = /* @__PURE__ */ new Set([
  "text_macro_definition",
  "conditional_compilation_directive",
  "include_compiler_directive",
  "undefine_compiler_directive",
  "compiler_directive"
]);
function boundaryKind(direction) {
  if (direction === "input") return "drive";
  if (direction === "output" || direction === "inout") return "load";
  return void 0;
}
function portDeclarations(analysis) {
  const out = [];
  const walk = (scopes) => {
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
function declaredSignalNames(analysis) {
  const names = /* @__PURE__ */ new Set();
  const walk = (scopes) => {
    for (const scope of scopes) {
      for (const symbol of scope.ports) if (SIGNAL_CATEGORIES.has(symbol.category)) names.add(symbol.name);
      for (const symbol of scope.symbols) if (SIGNAL_CATEGORIES.has(symbol.category)) names.add(symbol.name);
      walk(scope.children);
    }
  };
  walk(analysis.scopes);
  return names;
}
function scopesByStart(analysis) {
  const byStart = /* @__PURE__ */ new Map();
  for (const entry of analysis.scopesByRange) {
    const list = byStart.get(entry.start);
    if (list) list.push(entry.scope);
    else byStart.set(entry.start, [entry.scope]);
  }
  return byStart;
}
function collectReferences(analysis, text) {
  const accesses = [];
  const uses = [];
  const seen = /* @__PURE__ */ new Set();
  const signalNames = declaredSignalNames(analysis);
  const scopeStarts = scopesByStart(analysis);
  const declarations = analysis.declarationNames;
  const slice = (node) => text.slice(node.startIndex, node.endIndex);
  const record = (node, name, scopeId, kind, source, detail, siteKey) => {
    if (!signalNames.has(name)) return;
    const key = `${name}|${kind}|${source}|${siteKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    accesses.push({ name, scopeId, kind, range: toRange(node), source, detail });
  };
  for (const { symbol, scopeId } of portDeclarations(analysis)) {
    const kind = boundaryKind(symbol.direction);
    if (!kind) continue;
    accesses.push({
      name: symbol.name,
      scopeId,
      kind,
      range: symbol.selectionRange,
      source: kind === "drive" ? "port_input" : "port_output",
      detail: kind === "drive" ? "input port" : "output port",
      port: symbol.name
    });
  }
  const path5 = [];
  const scopeStack = [];
  const onEnter = (node) => {
    path5.push(node);
    const opened = scopeStarts.get(node.startIndex);
    if (opened) scopeStack.push(...opened);
  };
  const onLeave = (node) => {
    path5.pop();
    const opened = scopeStarts.get(node.startIndex);
    if (opened) scopeStack.length -= opened.length;
  };
  const insideContinuousAssign = () => {
    for (let i = path5.length - 1; i >= 0; i--) {
      const type = path5[i].type;
      if (type === "continuous_assign") return true;
      if (SCOPE_BOUNDARIES.has(type)) return false;
    }
    return false;
  };
  const insideInstantiation = () => {
    for (let i = path5.length - 1; i >= 0; i--) {
      const type = path5[i].type;
      if (type === "hierarchical_instance" || type === "module_instantiation" || type === "list_of_port_connections") {
        return true;
      }
      if (SCOPE_BOUNDARIES.has(type)) return false;
    }
    return false;
  };
  const enclosingLvalue = () => {
    for (let i = path5.length - 1; i >= 0; i--) {
      const type = path5[i].type;
      if (type === "variable_lvalue" || type === "net_lvalue") return path5[i];
    }
    return void 0;
  };
  const enclosingAssignment = () => {
    for (let i = path5.length - 1; i >= 0; i--) {
      const type = path5[i].type;
      if (ASSIGNMENT_TYPES.has(type)) return path5[i];
      if (SCOPE_BOUNDARIES.has(type)) return void 0;
    }
    return void 0;
  };
  const enclosingStatement = () => {
    for (let i = path5.length - 2; i >= 0; i--) {
      if (SCOPE_BOUNDARIES.has(path5[i].type)) return path5[i + 1];
    }
    return path5[0];
  };
  const siteKeyFor = (node) => {
    let key;
    for (let i = path5.length - 1; i >= 0; i--) {
      const current = path5[i];
      if (ACCESS_POINT_TYPES.has(current.type)) {
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
  const describeAccess = () => {
    const statement = enclosingStatement();
    if (!statement) return "";
    if (statement.type === "continuous_assign") return firstLine(slice(statement));
    const assignment = enclosingAssignment();
    if (assignment && assignment.id !== statement.id) return firstLine(slice(assignment));
    return firstLine(slice(statement));
  };
  const visit = (node) => {
    onEnter(node);
    if (node.type === "simple_identifier" && !declarations.has(node.id)) {
      const name = slice(node);
      const scopeId = scopeStack[scopeStack.length - 1]?.id ?? -1;
      uses.push({ name, range: toRange(node), context: node.parent?.type ?? node.type, scopeId });
      if (!insideInstantiation()) {
        const lvalue = enclosingLvalue();
        const isDrive = lvalue !== void 0 && lvalueName(lvalue) === name;
        const source = insideContinuousAssign() ? "continuous_assign" : "procedural_assignment";
        record(
          node,
          name,
          scopeId,
          isDrive ? "drive" : "load",
          source,
          describeAccess(),
          siteKeyFor(node)
        );
      }
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      if (DECLARATION_ONLY_TYPES.has(node.type) || PREPROCESSOR_TYPES.has(node.type)) break;
      const child = node.child(i);
      if (child) visit(child);
    }
    onLeave(node);
  };
  visit(analysis.parseTree.rootNode);
  return { uses, accesses };
}
var EXPRESSION_WRAPPERS = /* @__PURE__ */ new Set(["primary", "mintypmax_expression", "hierarchical_identifier"]);
var ACCESS_POINT_TYPES = /* @__PURE__ */ new Set([
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
  "net_port_type"
]);
function rootNameOf(expression) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_$]*)/.exec(expression);
  return match?.[1];
}

// src/server/includes.ts
var import_node_fs = require("node:fs");
var import_node_path2 = __toESM(require("node:path"));

// src/server/paths.ts
var import_node_path = __toESM(require("node:path"));
function toPosix(value) {
  return value.split(import_node_path.default.sep).join("/");
}
function pathToUri(absolute) {
  const normalised = toPosix(absolute);
  const encoded = normalised.split("/").filter((segment) => segment.length > 0).map(encodeURIComponent).join("/");
  const drive = /^([A-Za-z]):/.exec(encoded);
  if (drive) return `file:///${encoded.replace(/^([A-Za-z]):/, "%241:")}`;
  return `file:///${encoded}`;
}
function uriToPath(uri) {
  if (!uri.startsWith("file://")) return void 0;
  const decoded = decodeURIComponent(uri.slice("file://".length));
  const absolute = decoded.startsWith("/") ? decoded : `/${decoded}`;
  return import_node_path.default.normalize(absolute);
}
function folded(value) {
  return toPosix(value).toLowerCase();
}

// src/server/includes.ts
var MAX_ASCENT = 4;
function readInclude(node) {
  if (node.type !== "include_compiler_directive") return void 0;
  const read = readTarget(node);
  if (!read) return void 0;
  return {
    target: read.target,
    systemLib: read.systemLib,
    range: {
      start: { line: node.startPosition.row, character: node.startPosition.column },
      end: { line: node.endPosition.row, character: node.endPosition.column }
    }
  };
}
function readTarget(node) {
  const text = node.text.replace(/^\s*`include\s*/, "").trim();
  const angle = /^<([^>]*)>/.exec(text);
  if (angle) return { target: (angle[1] ?? "").trim(), systemLib: true };
  const quoted = /^"([^"]*)"/.exec(text);
  if (quoted) return { target: (quoted[1] ?? "").trim(), systemLib: false };
  return void 0;
}
var IncludeResolver = class {
  /** Folders a search starts from: the workspace roots and their ancestors. */
  roots = [];
  /** Absolute posix paths of every file the index has read. */
  files = /* @__PURE__ */ new Set();
  /** Lowercased basename -> absolute paths, for a name-only lookup. */
  byBasename = /* @__PURE__ */ new Map();
  /** Absolute path -> the includes that file resolved to. */
  edges = /* @__PURE__ */ new Map();
  /**
   * Resolved names, with the generation they were answered in.
   *
   * A miss has to be re-tried once the index has learned more files -- the
   * header may simply not have been read yet -- so an answer is only reused
   * while the set of known files is the one it was computed against.
   */
  answers = /* @__PURE__ */ new Map();
  /** Incremented whenever a file or a root is learned. */
  generation = 0;
  /** Include names nothing could be found for, and the files that ask. */
  unresolved = /* @__PURE__ */ new Map();
  /** Registers a folder a relative include is tried against. */
  noteRoot(directory) {
    const absolute = toPosix(import_node_path2.default.normalize(directory));
    if (this.roots.includes(absolute)) return;
    this.roots.push(absolute);
    this.generation++;
  }
  /**
   * Registers a file the index has read, so a later include can name it.
   *
   * This is what makes "the header is somewhere in this project" answerable: the
   * walk teaches the resolver about every file it passes, and an include typed
   * long afterwards can still be placed by path or by name.
   */
  noteFile(absolute) {
    const file = toPosix(import_node_path2.default.normalize(absolute));
    if (this.files.has(file)) return;
    this.files.add(file);
    const key = import_node_path2.default.posix.basename(file).toLowerCase();
    const bucket = this.byBasename.get(key);
    if (bucket) bucket.push(file);
    else this.byBasename.set(key, [file]);
    this.generation++;
  }
  /**
   * Resolves every include written in one file and remembers the edges.
   *
   * `file` is the including file's absolute path, because that directory is
   * what a quoted name is resolved against. Returns what the file reaches, so
   * the caller can index whatever the workspace walk did not reach itself.
   */
  noteIncludes(file, directives) {
    const source = toPosix(import_node_path2.default.normalize(file));
    const from = import_node_path2.default.posix.dirname(source);
    const out = [];
    for (const directive of directives) {
      const hit = this.answer(directive, from);
      if (hit) {
        this.noteFile(hit);
        this.unresolved.delete(directive.target);
        out.push({ absolute: hit, directive });
        continue;
      }
      const askers = this.unresolved.get(directive.target);
      if (askers) askers.add(source);
      else this.unresolved.set(directive.target, /* @__PURE__ */ new Set([source]));
    }
    this.edges.set(source, out);
    return out;
  }
  /** Forgets a file's edges, so an edited include is looked up again. */
  forget(file) {
    this.edges.delete(toPosix(import_node_path2.default.normalize(file)));
  }
  /** Files named by `` `include `` in `file`, absolute paths. */
  includesOf(file) {
    return (this.edges.get(toPosix(import_node_path2.default.normalize(file))) ?? []).map((edge) => edge.absolute);
  }
  /**
   * Every file `file` reaches through includes, transitively.
   *
   * Headers include headers, and the one that declares the type is often the
   * furthest away. The `seen` set is what stops a pair of headers that include
   * each other -- not unheard of behind an `ifndef` guard -- from looping.
   */
  closure(file, limit = 64) {
    const start = toPosix(import_node_path2.default.normalize(file));
    const seen = /* @__PURE__ */ new Set([start]);
    const queue = [start];
    while (queue.length > 0 && seen.size <= limit) {
      const current = queue.shift();
      for (const edge of this.edges.get(current) ?? []) {
        if (seen.has(edge.absolute)) continue;
        seen.add(edge.absolute);
        queue.push(edge.absolute);
      }
    }
    seen.delete(start);
    return [...seen];
  }
  /**
   * Include names nothing could be found for, and the files that ask for them.
   *
   * Reported in the log because a missing header is invisible otherwise: every
   * macro it would have declared then reads as an unknown name, and the symptom
   * points at the extension rather than at the file list.
   */
  get missing() {
    return this.unresolved;
  }
  /**
   * The file an include names, or undefined.
   *
   * Reused only while the set of known files is the one the answer came from: a
   * miss has to be re-tried once the index has read more, because the header may
   * simply not have been reached yet.
   */
  answer(directive, from) {
    const target = directive.target.trim();
    const key = `${from}|${target}|${directive.systemLib ? "<" : '"'}`;
    const cached = this.answers.get(key);
    if (cached && cached.generation === this.generation) return cached.hit;
    const hit = this.search(target, from, directive.systemLib);
    this.answers.set(key, { generation: this.generation, hit });
    return hit;
  }
  /**
   * Where the file for `name` is, tried in the order a compiler would be told.
   *
   * Beside the file that wrote it, then up the folder tree, then at a workspace
   * root, then anywhere in the project by path suffix, and finally by bare file
   * name. Each step is reached only when the one before it found nothing, so a
   * name with an exact answer always gets it.
   */
  search(name, from, systemLib) {
    const trimmed = name.trim();
    if (trimmed.length === 0) return void 0;
    if (import_node_path2.default.isAbsolute(trimmed)) return existing(trimmed);
    if (!systemLib) {
      const beside = existing(import_node_path2.default.resolve(from, trimmed));
      if (beside) return beside;
    }
    let directory = from;
    for (let level = 0; level < MAX_ASCENT; level++) {
      const parent = import_node_path2.default.dirname(directory);
      if (parent === directory) break;
      directory = parent;
      const candidate = existing(import_node_path2.default.resolve(directory, trimmed));
      if (candidate) return candidate;
    }
    for (const root of this.roots) {
      const candidate = existing(import_node_path2.default.resolve(root, trimmed));
      if (candidate) return candidate;
    }
    const suffix = `/${folded(trimmed)}`;
    let shallowest;
    for (const file of this.files) {
      if (!file.toLowerCase().endsWith(suffix)) continue;
      if (!shallowest || file.length < shallowest.length) shallowest = file;
    }
    if (shallowest) return shallowest;
    const byName = this.byBasename.get(import_node_path2.default.posix.basename(folded(trimmed)));
    if (byName && byName.length === 1) return byName[0];
    return void 0;
  }
};
function existing(candidate) {
  try {
    if (!(0, import_node_fs.statSync)(candidate).isFile()) return void 0;
    return toPosix(import_node_path2.default.normalize(candidate));
  } catch {
    return void 0;
  }
}

// src/server/macros.ts
var MAX_EXPANSION_DEPTH = 8;
function collectMacros(tree, source) {
  const out = [];
  const stack = [tree.rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === "text_macro_definition") {
      const def = readDefinition(node, source);
      if (def) {
        const existing2 = out.findIndex((m) => m.name === def.name);
        if (existing2 >= 0) out[existing2] = def;
        else out.push(def);
      }
      continue;
    }
    if (node.type === "undefine_compiler_directive") {
      const name = node.namedChild(0)?.text ?? "";
      const index = out.findIndex((m) => m.name === name);
      if (index >= 0) out.splice(index, 1);
      continue;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
  return out;
}
function readDefinition(node, source) {
  const nameNode = findChild(node, "text_macro_name");
  const bodyNode = findChild(node, "macro_text");
  if (!nameNode) return void 0;
  const header = source.slice(nameNode.startIndex, nameNode.endIndex);
  const match = /^([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/.exec(header);
  if (!match) return void 0;
  const params = (match[2] ?? "").split(",").map((p) => p.trim()).filter((p) => p.length > 0 && p !== "=");
  return {
    name: match[1],
    params,
    body: bodyNode ? source.slice(bodyNode.startIndex, bodyNode.endIndex) : ""
  };
}
function findChild(node, type) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}
function expand(text, macros, originBase, depth = 0) {
  let out = "";
  const origin = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`" && text[i + 1] === "`") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const match = /^`\s*([A-Za-z_]\w*)\s*/.exec(text.slice(i));
      const name = match?.[1];
      if (!name) {
        const literal2 = /^`\s*[A-Za-z_]\w*/.exec(text.slice(i))[0];
        for (let k = 0; k < literal2.length; k++) {
          out += literal2[k];
          origin.push(originBase + i + k);
        }
        i += literal2.length;
        continue;
      }
      const callStart = i;
      const def = macros.get(name);
      if (!def) {
        const literal2 = match[0];
        for (let k = 0; k < literal2.length; k++) {
          out += literal2[k];
          origin.push(originBase + i + k);
        }
        i += literal2.length;
        continue;
      }
      const args = readArguments(text, i + match[0].length);
      const expandedBody = substitute(def, args, depth);
      if (depth < MAX_EXPANSION_DEPTH && expandedBody !== void 0) {
        const inner = expand(expandedBody.text, macros, callStart, depth + 1);
        out += inner.text;
        for (const offset of inner.origin) origin.push(callStart + offset);
        i = args.end;
        continue;
      }
      const literal = text.slice(callStart, args.end);
      for (let k = 0; k < literal.length; k++) {
        out += literal[k];
        origin.push(originBase + callStart + k);
      }
      i = args.end;
      continue;
    }
    out += ch;
    origin.push(originBase + i);
    i++;
  }
  return { text: out, origin };
}
function readArguments(text, at) {
  let i = at;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "(") return { args: [], end: i };
  let depth = 0;
  let start = i + 1;
  const args = [];
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        args.push(text.slice(start, i));
        i++;
        break;
      }
    } else if (ch === "," && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: i };
}
function substitute(def, call, depth) {
  if (def.params.length === 0) return { text: def.body, start: 0 };
  let out = def.body;
  let offset = 0;
  for (let index = 0; index < def.params.length; index++) {
    const formal = def.params[index];
    const actual = call.args[index]?.trim() ?? "";
    const pattern = new RegExp(`\\b${escapeRegExp(formal)}\\b`, "g");
    out = out.replace(pattern, () => {
      const written = actual;
      offset += written.length - formal.length;
      return written;
    });
  }
  void offset;
  void depth;
  return { text: out, start: 0 };
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/server/analyzer.ts
function toPosition2(p) {
  return { line: p.row, character: p.column };
}
function toRange2(node) {
  return {
    start: toPosition2(node.startPosition),
    end: toPosition2(node.endPosition)
  };
}
function selection(node) {
  return {
    start: toPosition2(node.startPosition),
    end: toPosition2(node.endPosition)
  };
}
function findChild2(node, type) {
  for (const child of node.namedChildren) {
    if (child.type === type) return child;
  }
  return null;
}
function findDescendant(node, type, maxDepth = 4) {
  let frontier = node.namedChildren;
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const child of frontier) {
      if (child.type === type) return child;
      next.push(...child.namedChildren);
    }
    frontier = next;
  }
  return null;
}
function findChildren(node, type) {
  return node.namedChildren.filter((c) => c.type === type);
}
function parseLegacyPorts(body, headerNames) {
  const out = [];
  for (const node of iterate(body)) {
    if (node.type !== "port_declaration") continue;
    const inner = node.namedChild(0);
    if (!inner) continue;
    const direction = parseDirection(inner.children.find((c) => !c.isNamed)?.text ?? "");
    if (!direction) continue;
    const portType = inner.namedChildren.find(
      (c) => c.type === "net_port_type" || c.type === "variable_port_type"
    );
    const packedDim = portType ? findDescendant(portType, "packed_dimension", 2) : null;
    const split = portType ? splitPackedText(portType.text) : void 0;
    const typeText = split ? split.type && !/^(reg|logic|wire|bit|integer|int|var)$/.test(split.type) ? split.type : void 0 : void 0;
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
        range: toRange2(node),
        selectionRange: selection(nameNode),
        declarationId: nameNode.id
      });
    }
  }
  return out;
}
function nodeText(node) {
  return node ? node.text.trim() : "";
}
function innerOf(node) {
  if (!node) return void 0;
  const raw = node.text.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) return raw.slice(1, -1).trim();
  return raw;
}
function splitPackedText(text) {
  if (!text) return { type: "" };
  const match = /\[\s*([^\]]*?)\s*\]/.exec(text);
  if (!match) return { type: text.trim() };
  return {
    type: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(),
    range: match[1]
  };
}
function valueText(node) {
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
var SCOPE_KINDS = {
  module_declaration: "module",
  interface_declaration: "interface",
  program_declaration: "program",
  package_declaration: "package",
  class_declaration: "class",
  function_declaration: "function",
  task_declaration: "task",
  generate_block: "block",
  generate_region: "block",
  begin_generate_block: "block"
};
var PROCEDURAL_BLOCKS = /* @__PURE__ */ new Set(["seq_block", "par_block"]);
var HEADER_TYPES = /* @__PURE__ */ new Set([
  "module_ansi_header",
  "module_nonansi_header",
  "interface_ansi_header",
  "interface_nonansi_header",
  "program_ansi_header",
  "program_nonansi_header",
  "package_header"
]);
var DESIGN_UNITS = /* @__PURE__ */ new Set([
  "module",
  "interface",
  "program",
  "package",
  "class"
]);
var ITEM_WRAPPERS = /* @__PURE__ */ new Set([
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
  // A task or function body. Without these, everything declared inside one is
  // invisible: `task automatic drive; logic [7:0] a; ... endtask` opens a scope
  // for `drive` but never walks into the body that holds it, so every local
  // variable reads as undeclared and every call inside it is unchecked.
  "task_body_declaration",
  "function_body_declaration",
  // `logic a;` inside a task arrives as `tf_item_declaration > block_item_
  // declaration > data_declaration` in one grammar and as
  // `block_item_declaration > data_declaration` in another, so both wrappers
  // have to be flattened for either to be read.
  "tf_item_declaration",
  "function_statement_or_null",
  "function_statement",
  "conditional_statement",
  "loop_statement",
  "case_statement",
  "case_item"
]);
function isTransparentWrapper(type) {
  const cached = wrapperVerdicts.get(type);
  if (cached !== void 0) return cached;
  const verdict = ITEM_WRAPPERS.has(type) ? true : !type.includes("generate") ? false : !GENERATE_SCOPES.has(type) && type !== "generate" && type !== "endgenerate";
  wrapperVerdicts.set(type, verdict);
  return verdict;
}
var wrapperVerdicts = /* @__PURE__ */ new Map();
var GENERATE_SCOPES = /* @__PURE__ */ new Set(["generate_region", "generate_block", "begin_generate_block"]);
function scopeHeader(scopeNode) {
  for (const child of scopeNode.namedChildren) {
    if (HEADER_TYPES.has(child.type)) return child;
  }
  return null;
}
function scopeNameNode(scopeNode, header) {
  const named = header?.childForFieldName("name") ?? scopeNode.childForFieldName("name");
  if (named) return named;
  const direct = scopeNode.namedChildren.find((c) => c.type === "simple_identifier");
  if (direct) return direct;
  const body = scopeNode.namedChildren.find(
    (c) => c.type === "function_body_declaration" || c.type === "task_body_declaration"
  );
  return body?.namedChildren.find((c) => c.type === "simple_identifier") ?? null;
}
function classTypeName(typeNode, knownClasses) {
  const classType = typeNode ? findChild2(typeNode, "class_type") : null;
  const named = classType?.namedChild(0);
  if (named?.type === "simple_identifier") return named.text;
  const bare = typeNode?.namedChild(0);
  if (bare?.type === "simple_identifier" && knownClasses.has(bare.text)) return bare.text;
  return null;
}
function baseClassName(classNode) {
  for (const child of classNode.namedChildren) {
    if (child.type !== "class_type") continue;
    const first = child.namedChild(0);
    if (first?.type === "simple_identifier") return first;
  }
  return null;
}
var WIDTHLESS = /* @__PURE__ */ new Set([
  "function",
  "task",
  "typedef",
  "class",
  "handle",
  "package",
  "module",
  "interface",
  "program",
  "genvar"
]);
var Analyzer = class _Analyzer {
  lines;
  nextScopeId = 1;
  scopes = [];
  /** Node ids that are declaration names, so they are not counted as uses. */
  declarationNames = /* @__PURE__ */ new Set();
  uses = [];
  /** Imports outside any scope, i.e. at compilation-unit level. */
  fileImports = [];
  /** Files this document pulls in with an `include, in source order. */
  includes = [];
  /**
   * Declarations outside any scope: the compilation unit's own vocabulary.
   *
   * A header that writes `typedef struct packed {...} hdr_t;` above its first
   * module is handing that type to every file that includes it, and there is no
   * scope to leave it in -- the header has no module. Keeping them here is what
   * lets the file that includes it resolve the name at all.
   */
  unitSymbols = [];
  /**
   * Class names known before this file was read, plus the ones it declares.
   *
   * Deciding whether `Packet pkt;` is an object or a one-bit net requires
   * knowing `Packet` is a class, and that answer usually lives in another file.
   */
  classNames;
  /**
   * Resolves the folded values of a package's parameters, for `import pkg::*`.
   *
   * Supplied by the caller because the analyzer deliberately knows nothing
   * about the workspace: a package usually lives in another file, and a width
   * like `[C_PKT_DAT_W-1:0]` cannot be folded without its value.
   */
  importedParameterValues;
  /** Macros known to the workspace, for expanding `NAME(args) declarations. */
  macros;
  /** Parses an expanded macro body. Supplied by the caller that owns a parser. */
  parseFragment;
  constructor(text, knownClasses = /* @__PURE__ */ new Set(), importedParameterValues, macros = /* @__PURE__ */ new Map(), parseFragment) {
    this.lines = text.split(/\r?\n/);
    this.classNames = new Set(knownClasses);
    this.importedParameterValues = importedParameterValues;
    this.macros = macros;
    this.parseFragment = parseFragment;
  }
  run(tree) {
    this.visitScopeChildren(tree.rootNode, void 0, 0);
    for (const scope of this.scopes) {
      if (scope.category === "class") this.classNames.add(scope.name);
    }
    for (const scope of this.scopes) this.resolveScope(scope);
    this.resolveUnitSymbols();
    const scopesById = /* @__PURE__ */ new Map();
    const scopesByRange = [];
    for (const s of this.scopes) {
      scopesById.set(s.id, s);
      scopesByRange.push({ scope: s, start: s.start, end: s.end, depth: s.depth });
    }
    const identifiers = /* @__PURE__ */ new Map();
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
      includes: this.includes,
      classNames: this.classNames,
      declarationNames: this.declarationNames,
      unitSymbols: this.unitSymbols
    };
  }
  /**
   * Folds widths for what the compilation unit declares.
   *
   * The same two passes `resolveScope` runs, over a scope that exists only to be
   * resolved: a header's `typedef logic [7:0] byte_t;` has to know its width
   * before the file that includes it can show one.
   */
  resolveUnitSymbols() {
    if (this.unitSymbols.length === 0) return;
    const holder = {
      id: 0,
      name: "",
      category: "package",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      headerText: "",
      parameters: [],
      ports: [],
      symbols: this.unitSymbols,
      instances: [],
      children: [],
      depth: 0,
      start: 0,
      end: 0
    };
    this.resolveScope(holder);
  }
  /**
   * Every class declared in this file.
   *
   * The caller may need to analyse again once it learns these: a file that
   * declares `Packet` and also writes `Packet pkt;` cannot know which is which
   * until the class declaration has been read.
   */
  classesHere() {
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
  visitScopeChildren(node, parentId, depth) {
    const stack = [...node.namedChildren].reverse();
    while (stack.length > 0) {
      const child = stack.pop();
      if (isTransparentWrapper(child.type)) {
        stack.push(...[...child.namedChildren].reverse());
        continue;
      }
      this.visitNode(child, parentId, depth);
    }
  }
  visitNode(node, parentId, depth) {
    if (node.type === "function_declaration" || node.type === "task_declaration") {
      const nameNode = scopeNameNode(node, scopeHeader(node));
      if (nameNode) this.declarationNames.add(nameNode.id);
      this.declareMethod(node, this.scopeAt(parentId), nameNode?.text ?? "<anonymous>", {
        doc: this.docBefore(node)
      });
      return;
    }
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
    const currentScope = parentId !== void 0 ? this.scopes.find((s) => s.id === parentId) : void 0;
    switch (node.type) {
      case "tf_port_declaration": {
        if (!currentScope) return;
        const list = findChild2(node, "list_of_tf_variable_identifiers");
        const type = findChild2(node, "data_type_or_implicit");
        const split = splitPackedText(type?.text);
        const direction = parseDirection(findChild2(node, "tf_port_direction")?.text ?? "input");
        for (const name of list ? findChildren(list, "simple_identifier") : []) {
          this.declarationNames.add(name.id);
          currentScope.ports.push({
            name: name.text,
            category: "port",
            typeText: split.type || "logic",
            packedRangeText: split.range,
            direction,
            unpackedDims: [],
            isPort: true,
            scopeId: currentScope.id,
            range: toRange2(node),
            selectionRange: selection(name)
          });
        }
        return;
      }
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
        for (const ident of findChildren(findChild2(node, "list_of_genvar_identifiers") ?? node, "simple_identifier")) {
          this.declarationNames.add(ident.id);
          this.declare(currentScope, {
            name: ident.text,
            category: "genvar",
            typeText: "genvar",
            unpackedDims: [],
            isPort: false,
            scopeId: currentScope?.id ?? -1,
            range: toRange2(node),
            selectionRange: selection(ident)
          }, "genvar");
        }
        return;
      }
      case "text_macro_usage": {
        this.declareFromMacro(node, currentScope);
        return;
      }
      case "block_item_declaration": {
        const inner = findChild2(node, "data_declaration");
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
        const inner = findChild2(node, "data_declaration");
        if (inner) {
          const qualifiers = this.classQualifiers(node);
          this.parseDataDeclaration(inner, currentScope, qualifiers);
        }
        return;
      }
      case "class_method": {
        const inner = findChild2(node, "class_constructor_declaration") ?? findChild2(node, "function_declaration") ?? findChild2(node, "task_declaration") ?? findChild2(node, "task_prototype") ?? findChild2(node, "function_prototype");
        if (!inner) return;
        const isConstructor = inner.type === "class_constructor_declaration";
        const nameNode = isConstructor ? null : scopeNameNode(inner, scopeHeader(inner));
        const methodName = isConstructor ? "new" : nameNode?.text ?? "<anonymous>";
        if (nameNode) this.declarationNames.add(nameNode.id);
        this.declareMethod(inner, currentScope, methodName, {
          qualifiers: this.classQualifiers(node),
          doc: this.docBefore(node)
        });
        return;
      }
      case "function_declaration":
      case "task_declaration": {
        const nameNode = scopeNameNode(node, scopeHeader(node));
        const name = nameNode?.text ?? "<anonymous>";
        if (nameNode) this.declarationNames.add(nameNode.id);
        this.declareMethod(node, currentScope, name, { doc: this.docBefore(node) });
        return;
      }
      case "class_constructor_declaration": {
        this.declareMethod(node, currentScope, "new", { doc: this.docBefore(node) });
        return;
      }
      case "include_compiler_directive": {
        const directive = readInclude(node);
        if (directive) this.includes.push(directive);
        return;
      }
      case "for_initialization": {
        for (const declaration of node.namedChildren) {
          if (declaration.type !== "for_variable_declaration") continue;
          const type = findChild2(declaration, "data_type");
          for (const name of findChildren(declaration, "simple_identifier")) {
            this.declarationNames.add(name.id);
            this.declare(currentScope, {
              name: name.text,
              category: "variable",
              typeText: type?.text ?? "int",
              unpackedDims: [],
              isPort: false,
              scopeId: currentScope?.id ?? -1,
              range: toRange2(declaration),
              selectionRange: selection(name)
            }, "variable");
          }
        }
        return;
      }
      case "package_import_declaration": {
        const imports = this.parsePackageImports(node);
        this.fileImports.push(...imports);
        if (currentScope) {
          currentScope.imports = [
            ...currentScope.imports ?? [],
            ...imports
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
  classQualifiers(node) {
    const out = [];
    for (const child of node.children) {
      if (child.type === "data_declaration") continue;
      if (child.type === "class_item_qualifier" || child.type === "random_qualifier" || child.type === "const_qualifier") {
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
  declareMethod(node, enclosing, name, extras) {
    const isTask = node.type === "task_declaration" || node.type === "task_prototype";
    const isConstructor = node.type === "class_constructor_declaration";
    const category = isTask ? "task" : "function";
    const returnType = isConstructor ? "constructor" : nodeText(findDescendant(node, "data_type_or_void", 2) ?? void 0) || "void";
    const nameNode = scopeNameNode(node, scopeHeader(node));
    if (nameNode) this.declarationNames.add(nameNode.id);
    const body = findChild2(node, "task_body_declaration") ?? findChild2(node, "function_body_declaration");
    const ownerNode = body ? findChild2(body, "class_scope") : null;
    const ownerClass = ownerNode?.text.replace(/::$/, "").trim();
    const method = {
      name,
      category,
      typeText: returnType,
      unpackedDims: [],
      isPort: false,
      scopeId: enclosing?.id ?? -1,
      range: toRange2(node),
      selectionRange: nameNode ? selection(nameNode) : toRange2(node),
      doc: extras.doc,
      ...extras.qualifiers?.length ? { qualifiers: extras.qualifiers } : {}
    };
    const before2 = this.scopes.length;
    this.openScope(
      node,
      isTask ? "task" : "function",
      enclosing?.id,
      (enclosing?.depth ?? -1) + 1,
      name
    );
    const methodScope = this.scopes[before2];
    if (methodScope) {
      methodScope.ownerClass = ownerClass;
      method.arguments = methodScope.ports;
    }
    if (!ownerClass) this.declare(enclosing, method, category);
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
  declareFromMacro(node, scope) {
    const parse = this.parseFragment;
    if (!parse || !scope || this.macros.size === 0) return;
    const invocation = node.text;
    const name = /^`\s*([A-Za-z_]\w*)/.exec(invocation)?.[1];
    if (!name || !this.macros.has(name)) return;
    const { text } = expand(invocation, this.macros, node.startIndex);
    const source = `${text.trimEnd()};`;
    let fragment;
    try {
      fragment = parse(source);
    } catch {
      return;
    }
    const anchor = toRange2(node);
    const collected = this.collectFromFragment(fragment, source);
    for (const symbol of collected.symbols) {
      symbol.range = anchor;
      symbol.selectionRange = anchor;
      symbol.packedRangeNode = null;
      this.declare(scope, symbol, symbol.category);
    }
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
  collectFromFragment(fragment, source) {
    const shadow = this.fragmentAnalyzer();
    const scratch = {
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
      end: source.length
    };
    shadow.resetFor(source);
    shadow.scopes.push(scratch);
    for (const child of fragment.rootNode.namedChildren) {
      shadow.visitNode(child, scratch.id, 1);
    }
    return {
      symbols: [...scratch.parameters, ...scratch.ports, ...scratch.symbols],
      instances: scratch.instances
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
  fragmentAnalyzer() {
    this.fragment ??= new _Analyzer(
      "",
      this.classNames,
      this.importedParameterValues,
      this.macros,
      this.parseFragment
    );
    return this.fragment;
  }
  fragment;
  /** Clears everything but the configuration, to read a different body. */
  resetFor(text) {
    this.scopes.length = 0;
    this.declarationNames.clear();
    this.uses.length = 0;
    this.fileImports.length = 0;
    this.nextScopeId = 1;
    this.lines = text.split(/\r?\n/);
  }
  /** `import pkg::*;` and `import pkg::A, pkg::B;` */
  parsePackageImports(node) {
    const out = [];
    for (const item of node.namedChildren) {
      if (item.type !== "package_import_item") continue;
      const names = item.namedChildren.filter((c) => c.type === "simple_identifier");
      const head = names[0];
      if (!head) continue;
      this.declarationNames.add(head.id);
      const wildcard = item.text.includes("*");
      const explicit = wildcard ? [] : names.slice(1).map((c) => {
        this.declarationNames.add(c.id);
        return c.text;
      });
      out.push({
        packageName: head.text,
        wildcard,
        explicit,
        range: toRange2(item)
      });
    }
    return out;
  }
  openScope(node, kind, parentId, depth, nameOverride) {
    const header = scopeHeader(node);
    const nameNode = scopeNameNode(node, header);
    const name = nameOverride ?? (nameNode ? nameNode.text : `<anonymous ${kind}>`);
    if (nameNode) this.declarationNames.add(nameNode.id);
    const scope = {
      id: this.nextScopeId++,
      name,
      category: kind,
      parentId,
      range: toRange2(node),
      selectionRange: nameNode ? selection(nameNode) : toRange2(node),
      headerText: header ? header.text.slice(0, 400) : node.text.slice(0, 200),
      parameters: [],
      ports: [],
      symbols: [],
      instances: [],
      children: [],
      depth,
      start: node.startIndex,
      end: node.endIndex
    };
    const base = kind === "class" ? baseClassName(node) : null;
    if (base) {
      this.declarationNames.add(base.id);
      scope.baseClass = base.text;
    }
    this.scopes.push(scope);
    const parent = parentId !== void 0 ? this.scopes.find((s) => s.id === parentId) : void 0;
    if (parent) parent.children.push(scope);
    if (kind === "function" || kind === "task") {
      for (const port of this.parseTfPortList(node, scope)) {
        scope.ports.push(port);
      }
    } else if (header) {
      const headerImports = findChildren(header, "package_import_declaration");
      if (headerImports.length > 0) {
        const imports = headerImports.flatMap((node2) => this.parsePackageImports(node2));
        scope.imports = [
          ...scope.imports ?? [],
          ...imports
        ];
      }
      for (const paramDecl of this.findParamDeclarations(header)) {
        for (const sym of this.parseParamDeclaration(paramDecl, scope, false)) {
          scope.parameters.push(sym);
        }
      }
      for (const sym of this.parsePortList(header, scope, node)) {
        scope.ports.push(sym);
      }
    } else if (kind === "class") {
      const paramList = findChild2(node, "parameter_port_list");
      if (paramList) {
        for (const paramDecl of this.findParamDeclarations(paramList)) {
          for (const sym of this.parseParamDeclaration(paramDecl, scope, false)) {
            scope.parameters.push(sym);
          }
        }
      }
    }
    if (kind === "block" && nameNode) {
      const entry = {
        name: nameNode.text,
        category: "block",
        typeText: "block",
        unpackedDims: [],
        isPort: false,
        scopeId: -1,
        range: toRange2(node),
        selectionRange: selection(nameNode),
        doc: this.docBefore(node)
      };
      for (let owner = parent; owner; ) {
        this.declare(owner, { ...entry, scopeId: owner.id }, "block");
        if (DESIGN_UNITS.has(owner.category)) break;
        owner = owner.parentId !== void 0 ? this.scopes.find((s) => s.id === owner.parentId) : void 0;
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
  parseTfPortList(node, scope) {
    const out = [];
    const lists = [];
    const collectLists = (current, depth) => {
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
      let inheritedType = "logic";
      let inheritedDirection = "input";
      let inheritedRange;
      for (const item of list.namedChildren) {
        if (item.type !== "tf_port_item" && item.type !== "class_constructor_arg") continue;
        const portItem = item.type === "class_constructor_arg" ? findChild2(item, "tf_port_item") : item;
        if (!portItem) continue;
        const nameNode = portItem.namedChildren.find(
          (c) => c.type === "simple_identifier" || c.type === "tf_variable_identifier"
        );
        if (!nameNode) continue;
        this.declarationNames.add(nameNode.id);
        const typeNode = findChild2(portItem, "data_type_or_implicit");
        const directionNode = findChild2(portItem, "tf_port_direction");
        if (directionNode) {
          inheritedDirection = parseDirection(directionNode.text) ?? "input";
          inheritedType = "logic";
          inheritedRange = void 0;
        }
        const packedDim = typeNode ? findDescendant(typeNode, "packed_dimension", 3) : null;
        const fromText = typeNode && !packedDim ? splitPackedText(nodeText(typeNode)) : null;
        const typeText = packedDim ? stripPacked(nodeText(typeNode), packedDim.text) : fromText?.type ?? (typeNode ? nodeText(typeNode) : void 0) ?? "";
        if (typeNode && typeNode.text.trim()) {
          inheritedType = typeText || "logic";
          inheritedRange = innerOf(packedDim ?? void 0) ?? fromText?.range;
        }
        out.push({
          name: nameNode.text,
          category: "port",
          typeText: inheritedType,
          packedRangeText: inheritedRange,
          packedRangeNode: packedDim ?? null,
          unpackedDims: portItem.namedChildren.filter((c) => c.type === "unpacked_dimension").map((d) => d.text),
          direction: inheritedDirection,
          isPort: true,
          scopeId: scope.id,
          range: toRange2(portItem),
          selectionRange: selection(nameNode),
          doc: this.docBefore(portItem),
          initializerText: portItem.text.includes("=") ? portItem.text.slice(portItem.text.indexOf("=") + 1).trim() : void 0
        });
      }
    }
    return out;
  }
  /** The mutable scope a `parentId` refers to, if it is still open. */
  scopeAt(parentId) {
    return parentId !== void 0 ? this.scopes.find((s) => s.id === parentId) : void 0;
  }
  findParamDeclarations(header) {
    const found = [];
    const walk = (n) => {
      for (const child of n.namedChildren) {
        if (child.type === "parameter_declaration" || child.type === "local_parameter_declaration" || child.type === "parameter_port_declaration") {
          const target = child.type === "parameter_port_declaration" ? findChild2(child, "parameter_declaration") : child;
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
  parseParamDeclaration(node, scope, isLocal) {
    const typeNode = findChild2(node, "data_type_or_implicit");
    const typeText = nodeText(typeNode) || "parameter";
    const out = [];
    const assignments = findChild2(node, "list_of_param_assignments");
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
        range: toRange2(assignment),
        selectionRange: selection(nameNode),
        initializerText: valueText(assignment)
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
  parsePortList(header, scope, body) {
    const portList = header.namedChildren.find(
      (c) => c.type === "list_of_port_declarations" || c.type === "list_of_tf_ports" || c.type === "list_of_ports"
    );
    if (!portList) return [];
    const out = [];
    let inheritedDirection;
    let inheritedTypeText;
    let inheritedPackedRange;
    let inheritedPackedNode = null;
    for (const portNode of portList.namedChildren) {
      if (portNode.type !== "ansi_port_declaration" && portNode.type !== "ansi_tf_port_declaration") continue;
      const headerNode = portNode.namedChildren.find((c) => c.type.endsWith("_port_header"));
      const typeSearchRoot = headerNode ?? portNode;
      const directionNode = findDescendant(typeSearchRoot, "port_direction", 2);
      const typeHolder = findDescendant(typeSearchRoot, "data_type", 3) ?? findDescendant(typeSearchRoot, "net_port_type", 3) ?? findDescendant(typeSearchRoot, "net_type", 3);
      if (headerNode?.type === "interface_port_header") {
        inheritedDirection = void 0;
        inheritedTypeText = headerNode.text;
        inheritedPackedRange = void 0;
        inheritedPackedNode = null;
      } else if (directionNode) {
        inheritedDirection = parseDirection(directionNode.text);
        inheritedTypeText = void 0;
        inheritedPackedRange = void 0;
        inheritedPackedNode = null;
      }
      const packedDim = typeHolder ? findDescendant(typeHolder, "packed_dimension", 2) : null;
      const fromText = typeHolder && !packedDim ? splitPackedText(typeHolder.text) : null;
      if (typeHolder) {
        const declared = fromText ? fromText.type || void 0 : stripPacked(typeHolder.text, packedDim?.text) || void 0;
        inheritedTypeText = declared;
        inheritedPackedRange = innerOf(packedDim ?? void 0) ?? fromText?.range;
        inheritedPackedNode = packedDim ?? null;
      }
      const direction = parseDirection(directionNode ? directionNode.text : "") ?? inheritedDirection;
      const typeText = inheritedTypeText ?? "";
      const packedRangeText = inheritedPackedRange;
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
          range: toRange2(portNode),
          selectionRange: selection(nameNode),
          doc: this.docBefore(portNode)
        });
      }
    }
    if (body && portList?.type === "list_of_ports") {
      const headerNames = /* @__PURE__ */ new Set();
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
  parseDataDeclaration(node, scope, qualifiers) {
    const typeDecl = findChild2(node, "type_declaration");
    if (typeDecl) {
      this.parseTypeDeclaration(typeDecl, scope);
      return;
    }
    const importDecl = findChild2(node, "package_import_declaration");
    if (importDecl) {
      const imports = this.parsePackageImports(importDecl);
      this.fileImports.push(...imports);
      if (scope) {
        scope.imports = [...scope.imports ?? [], ...imports];
      }
      for (const item of findChildren(importDecl, "package_import_item")) {
        const ident = item.namedChild(0);
        if (!ident) continue;
        this.declarationNames.add(ident.id);
        if (scope && this.scopes.find((s) => s.id === scope.id)?.name === ident.text) continue;
        this.declare(scope, {
          name: ident.text,
          category: "package",
          typeText: `package ${nodeText(item).replace(/\s+/g, " ")}`,
          unpackedDims: [],
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange2(item),
          selectionRange: selection(ident),
          doc: "Imported package -- members are accessible as `pkg::member`."
        }, "package");
      }
      return;
    }
    const typeNode = findChild2(node, "data_type_or_implicit");
    const dataTypeNode = typeNode ? findChild2(typeNode, "data_type") ?? typeNode : null;
    const packedDim = dataTypeNode ? findDescendant(dataTypeNode, "packed_dimension", 3) : null;
    const fromText = dataTypeNode && !packedDim ? splitPackedText(dataTypeNode.text) : null;
    const typeText = (packedDim ? stripPacked(dataTypeNode.text, packedDim.text) : fromText?.type ?? dataTypeNode?.text ?? "") || (typeNode?.text.trim() ?? "logic");
    const packedRangeText = innerOf(packedDim ?? void 0) ?? fromText?.range;
    for (const [category, listName, assignmentType] of [
      ["variable", "list_of_variable_decl_assignments", "variable_decl_assignment"],
      ["variable", "list_of_variable_identifiers", "variable_identifier"],
      ["net", "list_of_net_decl_assignments", "net_decl_assignment"]
    ]) {
      const list = findChild2(node, listName);
      if (!list) continue;
      for (const assignment of list.namedChildren) {
        if (assignment.type !== assignmentType) continue;
        const nameNode = assignment.namedChild(0);
        if (!nameNode || nameNode.type !== "simple_identifier") continue;
        this.declarationNames.add(nameNode.id);
        const unpackedDims = assignment.namedChildren.filter((c) => c.type === "unpacked_dimension");
        const className = classTypeName(dataTypeNode ?? typeNode, this.classNames);
        const handleOf = className && this.classNames.has(className) ? className : void 0;
        this.declare(scope, {
          name: nameNode.text,
          category: handleOf ? "handle" : category,
          typeText,
          packedRangeText: handleOf ? void 0 : packedRangeText,
          packedRangeNode: handleOf ? null : packedDim ?? null,
          unpackedDims: handleOf ? [] : unpackedDims.map((d) => d.text),
          isPort: false,
          scopeId: scope?.id ?? -1,
          range: toRange2(assignment),
          selectionRange: selection(nameNode),
          initializerText: valueText(assignment),
          doc: this.docBefore(node),
          ...qualifiers?.length ? { qualifiers } : {},
          ...handleOf ? { handleOf } : {}
        }, handleOf ? "handle" : category);
      }
      if (list) break;
    }
  }
  parseTypeDeclaration(typeDecl, scope) {
    const nameNode = typeDecl.childForFieldName("type_name");
    if (!nameNode) return;
    this.declarationNames.add(nameNode.id);
    const dataTypeNode = findChild2(typeDecl, "data_type");
    const enumLiterals = dataTypeNode ? findChildren(dataTypeNode, "enum_name_declaration") : [];
    const packedDim = dataTypeNode ? dataTypeNode.namedChildren.find((c) => c.type === "packed_dimension") : null;
    const alias = dataTypeNode && dataTypeNode.namedChildCount === 1 ? dataTypeNode.namedChild(0) : null;
    const isEnum = enumLiterals.length > 0;
    this.declare(scope, {
      name: nameNode.text,
      category: "typedef",
      typeText: isEnum ? "enum" : stripPacked(alias?.text ?? dataTypeNode?.text, packedDim?.text) || "typedef",
      packedRangeText: isEnum ? innerOf(packedDim ?? void 0) : void 0,
      packedRangeNode: packedDim ?? null,
      unpackedDims: [],
      isPort: false,
      scopeId: scope?.id ?? -1,
      range: toRange2(typeDecl),
      selectionRange: selection(nameNode),
      doc: this.docBefore(typeDecl)
    }, "typedef");
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
        range: toRange2(member),
        selectionRange: selection(ident)
      }, "enum");
    }
    if (dataTypeNode) this.declareStructMembers(dataTypeNode, nameNode.text, scope);
  }
  /**
   * Records the fields of a `struct` / `union` typedef.
   *
   * They are attached to the scope that declares the type, which is how
   * `valid` and `data` in `typedef struct packed { ... } entry_t;` stop being
   * reported as undeclared.
   */
  declareStructMembers(dataType, typeName, scope) {
    for (const member of findChildren(dataType, "struct_union_member")) {
      const assignments = findChild2(member, "list_of_variable_decl_assignments");
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
          range: toRange2(member),
          selectionRange: selection(ident)
        }, "variable");
      }
    }
  }
  parseNetDeclaration(node, scope) {
    const netTypeNode = findChild2(node, "net_type");
    const netType = nodeText(netTypeNode) || "wire";
    const bareTypeNode = netTypeNode ? null : node.namedChildren.find((c) => c.type === "simple_identifier") ?? null;
    const className = bareTypeNode && this.classNames.has(bareTypeNode.text) ? bareTypeNode.text : void 0;
    if (bareTypeNode) this.declarationNames.add(bareTypeNode.id);
    const rangeHolder = findChild2(node, "data_type_or_implicit");
    const packedDim = rangeHolder ? findDescendant(rangeHolder, "packed_dimension", 2) : null;
    const fromText = rangeHolder && !packedDim ? splitPackedText(nodeText(rangeHolder)) : null;
    const modifier = packedDim ? stripPacked(nodeText(rangeHolder), packedDim.text) : fromText?.type ?? "";
    const packedRangeText = innerOf(packedDim ?? void 0) ?? fromText?.range;
    const strengthNode = findChild2(node, "drive_strength");
    const typeText = className ?? [netType, modifier, nodeText(strengthNode)].filter(Boolean).join(" ");
    const list = findChild2(node, "list_of_net_decl_assignments");
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
        packedRangeText: className ? void 0 : packedRangeText,
        packedRangeNode: className ? null : packedDim ?? null,
        unpackedDims: className ? [] : findChildren(assignment, "unpacked_dimension").map((d) => d.text),
        isPort: false,
        scopeId: scope?.id ?? -1,
        range: toRange2(assignment),
        selectionRange: selection(nameNode),
        initializerText: valueText(assignment),
        doc: this.docBefore(node),
        ...className ? { handleOf: className } : {}
      }, className ? "handle" : "net");
    }
  }
  parseInstantiation(node, scope) {
    const typeNode = node.childForFieldName("instance_type");
    if (!typeNode) return null;
    this.declarationNames.add(typeNode.id);
    const hierInstance = node.namedChildren.find((c) => c.type === "hierarchical_instance");
    const nameOfInstance = hierInstance ? findChild2(hierInstance, "name_of_instance")?.namedChild(0) : null;
    if (nameOfInstance) this.declarationNames.add(nameOfInstance.id);
    const parameterOverrides = [];
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
              range: toRange2(assignment),
              nameRange: nameId ? selection(nameId) : void 0
            });
          } else {
            parameterOverrides.push({
              valueText: valueText(assignment),
              range: toRange2(assignment)
            });
          }
        }
      }
    }
    const connections = [];
    const portList = hierInstance ? hierInstance.namedChildren.find((c) => c.type === "list_of_port_connections") : null;
    if (portList) {
      for (const conn of portList.namedChildren) {
        if (conn.type === "named_port_connection") {
          const nameId = conn.namedChildren.find((c) => c.type === "simple_identifier");
          if (nameId) this.declarationNames.add(nameId.id);
          connections.push({
            portName: nameId?.text,
            valueText: valueText(conn),
            range: toRange2(conn),
            nameRange: nameId ? selection(nameId) : void 0
          });
        } else if (conn.type === "ordered_port_connection") {
          connections.push({
            valueText: conn.namedChildren.map((c) => c.text).join(" ").trim(),
            range: toRange2(conn)
          });
        } else if (conn.type === "wildcard_port_connection") {
          connections.push({ valueText: "*", range: toRange2(conn) });
        }
      }
    }
    return {
      typeName: typeNode.text,
      instanceName: nameOfInstance?.text ?? "",
      range: toRange2(node),
      typeRange: selection(typeNode),
      parameterOverrides,
      connections
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
  seedImportedValues(scope) {
    const resolve = this.importedParameterValues;
    const out = /* @__PURE__ */ new Map();
    if (!resolve) return out;
    const packages = /* @__PURE__ */ new Set();
    for (const entry of scope.imports ?? []) {
      if (entry.wildcard) packages.add(entry.packageName);
    }
    for (const declaration of [...scope.ports, ...scope.symbols, ...scope.parameters]) {
      for (const text of [declaration.packedRangeText, declaration.typeText]) {
        if (!text) continue;
        for (const match of text.matchAll(/\b([A-Za-z_]\w*)::/g)) {
          packages.add(match[1]);
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
  resolveScope(scope) {
    const paramValues = /* @__PURE__ */ new Map();
    const imported = this.seedImportedValues(scope);
    const pending = [...scope.parameters, ...scope.symbols.filter((s) => s.category === "localparam" || s.category === "parameter")];
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const sym of pending) {
        if (paramValues.has(sym.name)) continue;
        const value = this.evaluateSymbolValue(sym, paramValues, imported);
        if (value !== void 0) {
          paramValues.set(sym.name, value);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const symbolWidths = /* @__PURE__ */ new Map();
    const env = {
      // A local declaration shadows an imported one of the same name, so the
      // local map is consulted first and the imported one only fills the gaps.
      lookup: (name) => paramValues.get(name) ?? imported.get(name),
      symbolWidth: (name) => symbolWidths.get(name)
    };
    const resolve = (sym) => {
      if (sym.resolvedValue === void 0 && paramValues.has(sym.name)) {
        sym.resolvedValue = paramValues.get(sym.name);
      }
      if (WIDTHLESS.has(sym.category)) return;
      const rangeNode = sym.packedRangeNode;
      let packedWidth;
      if (rangeNode) packedWidth = rangeWidth(rangeNode, env);
      if (packedWidth === void 0 && sym.packedRangeText) packedWidth = widthOfText(sym.packedRangeText, env);
      if (typeof packedWidth !== "number") packedWidth = void 0;
      const declaresRange = rangeNode != null || sym.packedRangeText !== void 0;
      if (packedWidth === void 0 && !declaresRange) {
        packedWidth = implicitWidth(sym.typeText);
      }
      if (packedWidth !== void 0) {
        sym.packedWidth = packedWidth;
      }
      const count = unpackedCount(sym.unpackedDims, env);
      if (count !== void 0) {
        sym.unpackedCount = count;
      }
      if (packedWidth !== void 0) symbolWidths.set(sym.name, packedWidth);
    };
    for (let pass = 0; pass < 3; pass++) {
      for (const sym of scope.ports) resolve(sym);
      for (const sym of scope.symbols) resolve(sym);
    }
    for (const sym of scope.parameters) {
      const value = paramValues.get(sym.name);
      if (value !== void 0) sym.resolvedValue = value;
    }
  }
  evaluateSymbolValue(sym, params, imported) {
    return evaluateText(sym.initializerText ?? "", {
      lookup: (name) => params.get(name) ?? imported.get(name),
      symbolWidth: () => void 0
    });
  }
  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */
  declare(scope, sym, category) {
    const full = { ...sym, category };
    if (!scope) {
      this.unitSymbols.push(full);
      return;
    }
    if (category === "parameter" || category === "localparam") {
      scope.parameters.push(full);
    } else {
      scope.symbols.push(full);
    }
  }
  /** Leading comment block immediately above `node`, if any. */
  docBefore(node) {
    const row = node.startPosition.row - 1;
    if (row < 0) return void 0;
    const lines = [];
    for (let i = row; i >= 0 && lines.length < 12; i--) {
      const line = this.lines[i] ?? "";
      const trimmed = line.trim();
      if (trimmed === "") {
        if (lines.length === 0) continue;
        break;
      }
      if (trimmed.startsWith("//")) lines.unshift(trimmed.replace(/^\/\/\s?/, ""));
      else if (trimmed.startsWith("/*") || trimmed.startsWith("*")) lines.unshift(trimmed.replace(/^\/\*+/, "").replace(/\*+\/$/, ""));
      else break;
    }
    const doc = lines.join("\n").trim();
    return doc.length > 0 ? doc : void 0;
  }
};
var IMPLICIT_WIDTHS = {
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
  time: 64
};
function implicitWidth(typeText) {
  if (!typeText || !typeText.trim()) return 1;
  const base = typeText.trim().split(/[\s(]/)[0].toLowerCase();
  return Object.hasOwn(IMPLICIT_WIDTHS, base) ? IMPLICIT_WIDTHS[base] : void 0;
}
function parseDirection(text) {
  switch (text.trim()) {
    case "input":
      return "input";
    case "output":
      return "output";
    case "inout":
      return "inout";
    case "ref":
      return "ref";
    case "interface":
      return "interface";
    default:
      return void 0;
  }
}
function stripPacked(typeText, packedText) {
  if (!typeText) return "";
  let out = typeText;
  if (packedText) out = out.split(packedText).join("");
  return out.trim();
}
function classNamesIn(text) {
  const names = /* @__PURE__ */ new Set();
  const pattern = /(?:^|[\s;}])(?:(?:virtual|interface|local)\s+)*class\s+([A-Za-z_]\w*)/g;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}
function analyzeTree(tree, text, knownClasses = /* @__PURE__ */ new Set(), importedParameterValues, macros = /* @__PURE__ */ new Map(), parseFragment) {
  const analyzer = new Analyzer(text, knownClasses, importedParameterValues, macros, parseFragment);
  const base = analyzer.run(tree);
  const draft = { ...base, uses: [], identifiers: /* @__PURE__ */ new Map(), accesses: [] };
  const { uses, accesses } = collectReferences(draft, text);
  const identifiers = /* @__PURE__ */ new Map();
  for (const use of uses) {
    const list = identifiers.get(use.name);
    if (list) list.push(use);
    else identifiers.set(use.name, [use]);
  }
  return { ...base, uses, identifiers, accesses };
}

// src/server/catalog.ts
var UNIT_KINDS = /* @__PURE__ */ new Set([
  "module",
  "interface",
  "program",
  "package",
  "class"
]);
var MAX_IMPORT_HOPS = 8;
var Catalog = class {
  byName = /* @__PURE__ */ new Map();
  /** uri -> names declared by that document, so removal is exact. */
  byUri = /* @__PURE__ */ new Map();
  /**
   * uri -> declarations that belong to no scope, i.e. what a header leaves
   * behind in the compilation unit.
   *
   * `typedef struct {...} hdr_t;` and the literals of an `enum` written above
   * the first `module` are visible to every unit in the file that includes the
   * header. No scope owns them, so nothing else can be asked where they are.
   */
  unitSymbols = /* @__PURE__ */ new Map();
  /** uri -> the shape of what the document declares, to spot a real change. */
  shapes = /* @__PURE__ */ new Map();
  /**
   * Bumped only when a document's *shape* changes.
   *
   * A design unit's name, its kind and what it instantiates are the structure
   * the workspace answers questions about; a renamed signal is not. Anything
   * cached against the workspace -- the top of the design, which module reaches
   * which -- is keyed on this, so a keystroke costs nothing and a new submodule
   * costs one rebuild.
   */
  version = 0;
  /** Changes whenever the design itself does. See `version`. */
  get structureVersion() {
    return this.version;
  }
  /**
   * Rebuilds the entries contributed by a single document.
   *
   * Port-boundary accesses need the direction of the *instantiated* module,
   * which may live in another file that has not been indexed yet. Resolution is
   * therefore a separate pass: this method only records what the document says,
   * and `resolveAll` rebuilds every entry's accesses from the finished index.
   */
  replaceDocument(uri, scopes, accesses = [], unitSymbols = []) {
    this.removeEntries(uri);
    const shape = shapeOf(scopes);
    if (this.shapes.get(uri) !== shape) {
      this.shapes.set(uri, shape);
      this.version++;
    }
    const declared = [];
    for (const scope of scopes) {
      if (!UNIT_KINDS.has(scope.category)) continue;
      const entry = {
        name: scope.name,
        kind: scope.category,
        uri,
        range: scope.range,
        selectionRange: scope.selectionRange,
        ports: scope.ports,
        parameters: scope.parameters,
        symbols: scope.symbols,
        instances: scope.instances,
        accesses: [],
        headerText: scope.headerText,
        baseClass: scope.baseClass,
        imports: scope.imports ?? []
      };
      const list = this.byName.get(scope.name);
      if (list) list.push(entry);
      else this.byName.set(scope.name, [entry]);
      declared.push(scope.name);
    }
    this.byUri.set(uri, declared);
    if (unitSymbols.length > 0) this.unitSymbols.set(uri, unitSymbols);
    else this.unitSymbols.delete(uri);
    this.source.set(uri, { accesses, scopes });
    this.resolveAll();
  }
  /**
   * What each document declared, kept so accesses can be rebuilt whenever the
   * index changes. Indexing order must not change the result.
   */
  source = /* @__PURE__ */ new Map();
  /**
   * Recomputes the accesses of every indexed document.
   *
   * Called after each `replaceDocument` because a newly indexed module can be
   * the target of an instantiation in a file that was indexed earlier.
   */
  resolveAll() {
    for (const [uri, { accesses, scopes }] of this.source) {
      const entries = (this.byUri.get(uri) ?? []).flatMap((name) => this.byName.get(name) ?? []).filter((entry) => entry.uri === uri);
      for (const entry of entries) {
        const scope = scopes.find((s) => s.name === entry.name);
        const own = scope ? accesses.filter((a) => a.scopeId === scope.id) : [];
        const cross = scope ? this.portBoundaryAccesses(scope) : [];
        entry.accesses = [...own, ...cross];
      }
    }
  }
  /**
   * Drives and loads implied by `u_sub (.a(net))` style connections.
   *
   * Seen from the net: a net reaching a submodule's input port is loaded by
   * that submodule, and a net on its output port is driven by it. Without the
   * submodule's port directions there is nothing to classify, so those
   * connections are left out rather than guessed.
   */
  portBoundaryAccesses(scope) {
    const out = [];
    const visit = (current) => {
      for (const instance of current.instances) {
        const entry = this.get(instance.typeName);
        if (!entry) continue;
        const directions = new Map(entry.ports.map((p) => [p.name, p.direction]));
        for (const binding of instance.connections) {
          const direction = binding.portName ? directions.get(binding.portName) : void 0;
          if (!direction) continue;
          const kind = direction === "input" ? "load" : direction === "output" ? "drive" : void 0;
          if (!kind) continue;
          const name = rootNameOf(binding.valueText);
          if (!name) continue;
          out.push({
            name,
            scopeId: current.id,
            kind,
            range: binding.range,
            source: direction === "input" ? "instance_input" : "instance_output",
            // `instance_input` names the port the net reaches, not the
            // direction of the access itself.
            detail: `${instance.instanceName}.${binding.portName}`,
            port: binding.portName
          });
        }
      }
      for (const child of current.children) visit(child);
    };
    visit(scope);
    return out;
  }
  removeDocument(uri) {
    this.removeEntries(uri);
    this.unitSymbols.delete(uri);
    if (this.shapes.delete(uri)) this.version++;
  }
  /** Drops the entries a document contributed, leaving everything else intact. */
  removeEntries(uri) {
    this.source.delete(uri);
    for (const name of this.byUri.get(uri) ?? []) {
      const list = this.byName.get(name);
      if (!list) continue;
      const kept = list.filter((e) => e.uri !== uri);
      if (kept.length === 0) this.byName.delete(name);
      else this.byName.set(name, kept);
    }
    this.byUri.delete(uri);
  }
  /**
   * What a document leaves in the compilation unit, for the file that includes
   * it.
   *
   * A header is not a design unit, so this is the only way a `typedef` written
   * above the first `module` can be found -- and without it every use of that
   * type in the including file is an unknown identifier, which is exactly what a
   * package or a shared header looks like from the outside.
   */
  unitDeclarations(uri) {
    return this.unitSymbols.get(uri) ?? [];
  }
  /** Compilation-unit routines and members visible inside C::method bodies. */
  externalDeclarations(owner) {
    if (owner) {
      const entry = this.resolve(owner);
      if (!entry) return [];
      return this.classMembers(owner).map((symbol) => ({
        symbol,
        uri: this.units().find((unit) => unit.symbols.includes(symbol) || unit.parameters.includes(symbol))?.uri ?? entry.uri
      }));
    }
    return [...this.unitSymbols].flatMap(
      ([uri, symbols]) => symbols.filter((s) => s.category === "task" || s.category === "function").map((symbol) => ({ symbol, uri }))
    );
  }
  /** First declaration of `name`, used when a single target is expected. */
  get(name) {
    return this.byName.get(name)?.[0];
  }
  /**
   * The entry for a module name, preferring the one written in a given file.
   *
   * A name may legitimately be declared more than once -- a guarded variant, or
   * a test file that reuses `top`. Asking for `top` while editing one of them
   * and getting the other one's definition is silently wrong, so a caller that
   * knows which file it is working in says so here.
   */
  resolve(name, uri) {
    const entries = this.byName.get(name);
    if (!entries) return void 0;
    if (uri) {
      const exact = entries.find((entry) => entry.uri === uri);
      if (exact) return exact;
    }
    return entries[0];
  }
  /**
  * Folded values of a package's parameters, following its own imports.
  *
  * Width folding needs numbers, not declarations: `output logic [C_PKT_DAT_W-1:0]`
  * is only 32 bits if the analyzer knows what `C_PKT_DAT_W` is, and that is one
  * file over -- possibly several, if the package re-exports another.
  *
  * Only names that already carry a folded value are included. An expression the
  * evaluator could not reduce is left out rather than approximated, so a width
  * stays unknown instead of becoming a plausible wrong number.
  */
  parameterValues(packageName) {
    const out = /* @__PURE__ */ new Map();
    const walk = (entry2, seen, hops) => {
      if (hops > MAX_IMPORT_HOPS || seen.has(entry2.name)) return;
      seen.add(entry2.name);
      for (const symbol of entry2.parameters) {
        if (symbol.resolvedValue === void 0) continue;
        if (!out.has(symbol.name)) out.set(symbol.name, symbol.resolvedValue);
      }
      for (const imported of entry2.imports) {
        if (!imported.wildcard) continue;
        const next = this.get(imported.packageName);
        if (next) walk(next, seen, hops + 1);
      }
    };
    const entry = this.get(packageName);
    if (entry) walk(entry, /* @__PURE__ */ new Set(), 0);
    return out;
  }
  all(name) {
    return this.byName.get(name) ?? [];
  }
  /**
   * Every class declared anywhere in the workspace.
   *
   * The analyzer needs this to tell a class handle from a one-bit net: the
   * `Packet` in `Packet pkt;` is only knowable from outside the file being
   * read, since the class usually sits in another one.
   */
  classNames() {
    const names = /* @__PURE__ */ new Set();
    for (const [name, entries] of this.byName) {
      if (entries.some((entry) => entry.kind === "class")) names.add(name);
    }
    return names;
  }
  /**
   * Everything an object of `className` can see, its own members first.
   *
   * A subclass inherits its base's properties and methods, so the walk follows
   * `extends` up the chain. The base may be in another file, and may itself be
   * missing from the index, which is why the walk stops rather than recursing
   * forever.
   */
  classMembers(className, seen = /* @__PURE__ */ new Set()) {
    const entry = this.get(className);
    if (!entry || seen.has(className)) return [];
    seen.add(className);
    const own = [...entry.parameters, ...entry.symbols];
    const inherited = entry.baseClass ? this.classMembers(entry.baseClass, seen) : [];
    return [...own, ...inherited.filter((s) => !own.some((local) => local.name === s.name))];
  }
  /**
   * Every indexed design unit, across all files and names.
   *
   * The Signal Tracer walks this to find the instantiations of a module, which
   * is the only way to follow a net upwards.
   */
  allEntries() {
    return [...this.byName.values()].flat();
  }
  locations(name) {
    return this.all(name).map((e) => ({ uri: e.uri, range: e.selectionRange }));
  }
  /** Every design unit in the workspace, for the completion list. */
  units() {
    const out = [];
    for (const list of this.byName.values()) out.push(...list);
    return out;
  }
};
function shapeOf(scopes) {
  const parts = [];
  for (const scope of scopes) {
    if (!UNIT_KINDS.has(scope.category)) continue;
    parts.push(`${scope.category} ${scope.name}`);
    for (const instance of scope.instances) parts.push(`${scope.name} > ${instance.typeName}`);
  }
  return parts.join("\n");
}

// src/server/workspaceIndex.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = __toESM(require("node:path"));
var MAX_REPORTED_MACROS = 200;
var MAX_INCLUDE_ROUNDS = 8;
var DEFAULT_INDEX_OPTIONS = {
  // Must cover every extension the package declares as SystemVerilog or Verilog.
  // `.svp` holds package definitions, and leaving it out meant a package in a
  // `.svp` file was opened, highlighted and watched by the editor while its
  // parameters stayed invisible to every lookup that crosses a file boundary.
  include: ["**/*.sv", "**/*.svh", "**/*.svp", "**/*.v", "**/*.vh"],
  exclude: ["**/node_modules/**", "**/.git/**", "**/build/**", "**/out/**"],
  maxFiles: 5e3
};
function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          pattern += "(?:.*/)?";
          i += 2;
        } else {
          pattern += ".*";
          i += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if ("\\^$.|+()[]{}".includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  return new RegExp(`^${pattern}$`);
}
var WorkspaceIndexer = class {
  constructor(parser2, catalog, options = DEFAULT_INDEX_OPTIONS, includes = new IncludeResolver()) {
    this.parser = parser2;
    this.catalog = catalog;
    this.options = options;
    this.includes = includes;
    this.includeRes = options.include.map(globToRegExp);
    this.excludeRes = options.exclude.map(globToRegExp);
  }
  parser;
  catalog;
  options;
  includes;
  includeRes;
  excludeRes;
  indexed = 0;
  truncated = false;
  /**
   * Class names across the whole workspace.
   *
   * Analysis needs them to recognise `Packet pkt;` as an object rather than a
   * one-bit net, and the file declaring `Packet` may be read *after* the file
   * that uses it. So the walk reads first and parses second.
   */
  classNames = /* @__PURE__ */ new Set();
  /** Every macro defined in the workspace, so any file can expand any of them. */
  macroTable = /* @__PURE__ */ new Map();
  /** Headers an `include` named and the walk has not read yet. */
  pendingIncludes = /* @__PURE__ */ new Set();
  /** Files this indexer has actually parsed, so none is read twice. */
  indexedPaths = /* @__PURE__ */ new Set();
  /**
   * Macro calls the workspace never defines, and where they were seen.
   *
   * `include` is not followed, so a macro that lives in a file the editor
   * cannot reach -- a vendor library, a file list outside the workspace -- is
   * invisible, and every signal it declares reads as undeclared. That looks
   * like a tool bug from inside the editor, so the names are recorded and
   * logged rather than left to be guessed at.
   */
  unresolvedMacros = /* @__PURE__ */ new Map();
  /** Macro calls with no definition, as `name -> files that call it`. */
  get undefinedMacros() {
    return this.unresolvedMacros;
  }
  get filesIndexed() {
    return this.indexed;
  }
  get wasTruncated() {
    return this.truncated;
  }
  /**
   * Reads `folders` into the index, adding to whatever is already there.
   *
   * Additive on purpose. The workspace root is indexed once at startup, and
   * then a folder is indexed again as soon as a file in it is opened -- and
   * opening `rtl/pattern_generator.v` must not erase what `common/tmr.v`
   * contributed. Clearing here threw away every macro and class name learned
   * from the rest of the project, and the file that had just been read lost
   * all thirty-five of its macro-declared signals.
   *
   * A fresh pass over everything is not needed when settings change: the
   * server builds a new indexer for that, which starts empty on its own.
   */
  async indexFolders(folders) {
    let count = 0;
    for (const folder of folders) {
      this.includes.noteRoot(folder);
      const files = await this.collect(folder);
      for (const file of files) {
        for (const name of classNamesIn(file.text)) this.classNames.add(name);
        this.readMacros(file);
      }
      for (const file of files) {
        this.parse(file);
        count++;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    count += await this.indexReachedIncludes();
    return count;
  }
  /**
   * Reads the files an `include` named and the folder walk never visited.
   *
   * A header does not have to be under an indexed folder to be part of the
   * design: a package sits wherever the project keeps its packages, and the
   * include that names it is often the only thing that says where. Following it
   * is the difference between `` cfg_pkg::WIDTH `` resolving and the file
   * declaring an undeclared module, and nothing else in the index would find it.
   *
   * Only files reachable from a resolved include are read, so this cannot walk
   * the filesystem -- the paths come from source, and every one of them is
   * checked against the exclude patterns first.
   */
  async indexReachedIncludes() {
    let total = 0;
    for (let round = 0; round < MAX_INCLUDE_ROUNDS; round++) {
      const wanted = [];
      for (const file of this.pendingIncludes) {
        if (this.indexedPaths.has(file)) continue;
        wanted.push(file);
      }
      this.pendingIncludes.clear();
      if (wanted.length === 0) break;
      total += await this.readIncluded(wanted);
    }
    return total;
  }
  /**
   * Reads and analyses a set of headers, learning from all of them first.
   *
   * The same two-pass order the folder walk uses: a macro defined in one header
   * is used by another, and the answer must not depend on which was reached
   * first.
   */
  async readIncluded(absolutePaths) {
    const read = [];
    for (const absolute of absolutePaths) {
      const text = await this.read(absolute);
      if (text !== void 0) read.push({ absolute, uri: pathToUri(absolute), text });
    }
    for (const file of read) {
      this.includes.noteFile(file.absolute);
      for (const name of classNamesIn(file.text)) this.classNames.add(name);
      this.readMacros(file);
    }
    for (const file of read) {
      this.parse(file);
      await new Promise((resolve) => setImmediate(resolve));
    }
    return read.length;
  }
  /**
   * Resolves the includes of an open document and queues the files they name.
   *
   * The directives come from the document's own analysis, so this costs a map
   * lookup per directive rather than another pass over the tree. With no
   * workspace folder open the walk never sees a folder but the loose file's,
   * and the package it pulls in is the one thing the author is looking at.
   */
  followIncludes(uri, directives) {
    const absolute = uriToPath(uri);
    if (!absolute) return;
    for (const edge of this.includes.noteIncludes(absolute, directives)) {
      if (!this.indexedPaths.has(edge.absolute)) this.pendingIncludes.add(edge.absolute);
    }
  }
  /** Forgets a closed document's edges, so a stale header is not chased. */
  forgetDocument(uri) {
    const absolute = uriToPath(uri);
    if (absolute) this.includes.forget(absolute);
  }
  /**
   * Learns the macros a file defines, before any file is analysed.
   *
   * Collected up front rather than during the parse so that a file sees every
   * macro in the folder no matter which of them the directory walk reached
   * first. Only files that mention a backtick are parsed here, so the extra
   * parse falls on headers -- the one place a `` `define `` lives.
   */
  readMacros(file) {
    if (!file.text.includes("`")) return;
    let tree;
    try {
      tree = this.parser.parse(file.text);
      for (const macro of collectMacros(tree, file.text)) this.macroTable.set(macro.name, macro);
    } catch {
    } finally {
      tree?.delete();
    }
  }
  async collect(root, directory = root, into = []) {
    if (into.length >= this.options.maxFiles) {
      this.truncated = true;
      return into;
    }
    let entries;
    try {
      entries = await import_node_fs2.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return into;
    }
    for (const entry of entries) {
      if (into.length >= this.options.maxFiles) {
        this.truncated = true;
        return into;
      }
      const absolute = import_node_path3.default.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relDir = toPosix(import_node_path3.default.relative(root, absolute)) + "/";
        if (this.excludeRes.some((re) => matchesGlobDir(re, relDir))) continue;
        await this.collect(root, absolute, into);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = toPosix(import_node_path3.default.relative(root, absolute));
      if (!this.includeRes.some((re) => re.test(relative))) continue;
      if (this.excludeRes.some((re) => re.test(relative))) continue;
      this.includes.noteFile(absolute);
      const text = await this.read(absolute);
      if (text !== void 0) into.push({ absolute, uri: pathToUri(absolute), text });
    }
    return into;
  }
  async read(absolute) {
    try {
      const stat = await import_node_fs2.promises.stat(absolute);
      if (stat.size > 4 * 1024 * 1024) return void 0;
      return await import_node_fs2.promises.readFile(absolute, "utf8");
    } catch {
      return void 0;
    }
  }
  parse(file) {
    let tree;
    try {
      tree = this.parser.parse(file.text);
      this.noteUndefinedMacros(tree, file);
      const analysis = analyzeTree(tree, file.text, this.classNames, void 0, this.macros);
      this.includes.noteIncludes(file.absolute, analysis.includes);
      for (const edge of this.includes.includesOf(file.absolute)) {
        if (!this.indexedPaths.has(edge)) this.pendingIncludes.add(edge);
      }
      this.catalog.replaceDocument(
        file.uri,
        analysis.scopes,
        analysis.accesses,
        analysis.unitSymbols
      );
      this.indexed++;
      this.indexedPaths.add(toPosix(file.absolute));
    } catch {
    } finally {
      tree?.delete();
    }
  }
  /**
   * Records macro calls that no file in the workspace defines.
   *
   * The name is not a compiler directive, and it is not in the table, so nothing
   * in the workspace can say what it expands to. Saying so out loud is the
   * difference between "the tool is broken" and "that macro is in a header the
   * editor cannot reach".
   */
  noteUndefinedMacros(tree, file) {
    if (this.unresolvedMacros.size >= MAX_REPORTED_MACROS) return;
    const stack = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.type === "text_macro_usage") {
        const name = node.namedChild(0)?.text ?? "";
        if (name.length > 0 && !this.macroTable.has(name) && !this.unresolvedMacros.has(name)) {
          this.unresolvedMacros.set(name, /* @__PURE__ */ new Set([file.absolute]));
        }
        continue;
      }
      if (node.type === "text_macro_definition") continue;
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i);
        if (child) stack.push(child);
      }
    }
  }
  /**
   * Every macro defined anywhere in the workspace.
   *
   * A macro's definition is rarely in the file that uses it -- usually it is in
   * a header pulled in by a file list the editor cannot see -- so the index is
   * the only place the whole set exists. Kept beside the catalog for the same
   * reason: both are workspace-wide answers that one file cannot give.
   */
  get macros() {
    return this.macroTable;
  }
};
function matchesGlobDir(re, relativeDir) {
  if (re.test(relativeDir)) return true;
  const trimmed = relativeDir.replace(/\/$/, "");
  return re.test(trimmed) || re.test(`${trimmed}/`);
}

// src/server/documentManager.ts
var import_web_tree_sitter2 = require("web-tree-sitter");
function applyEdit(tree, oldText, newText, oldDocument, newDocument) {
  const limit = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < limit && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  tree.edit(
    new import_web_tree_sitter2.Edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition: toPoint(oldDocument.positionAt(start)),
      oldEndPosition: toPoint(oldDocument.positionAt(oldEnd)),
      newEndPosition: toPoint(newDocument.positionAt(newEnd))
    })
  );
}
function toPoint(position) {
  return { row: position.line, column: position.character };
}
var DocumentManager = class {
  constructor(parser2) {
    this.parser = parser2;
  }
  parser;
  entries = /* @__PURE__ */ new Map();
  /**
   * Where to ask for class names declared elsewhere in the workspace.
   *
   * Analysis needs them to tell `Packet pkt;` from a one-bit net, and the
   * answer is usually in a different file. Supplied by the server so this
   * class does not have to know the catalog exists.
   */
  knownClasses = () => /* @__PURE__ */ new Set();
  /**
   * Where to ask for the folded value of a package's parameters.
   *
   * A width written in terms of a package parameter cannot be resolved inside
   * the file that uses it, so the numbers come from the catalog.
   */
  importedParameterValues;
  /**
   * Where to ask for the macros defined anywhere in the workspace.
   *
   * A `` `NAME(args) `` declaration lives in the file that defines the macro and
   * stands for a declaration in the file that uses it, so neither file is
   * enough on its own.
   */
  macros = () => /* @__PURE__ */ new Map();
  update(uri, document) {
    const existing2 = this.entries.get(uri);
    const version = document.version;
    if (existing2 && existing2.version === version) {
      existing2.document = document;
      return existing2;
    }
    const text = document.getText();
    let tree;
    if (existing2) {
      applyEdit(existing2.tree, existing2.document.getText(), text, existing2.document, document);
      tree = this.parser.parse(text, existing2.tree);
      existing2.tree.delete();
    } else {
      tree = this.parser.parse(text);
    }
    const analysis = this.analyze(tree, text);
    const entry = { document, tree, analysis, version };
    this.entries.set(uri, entry);
    return entry;
  }
  /**
   * Analyses a parsed document, running a second pass when the first one
   * revealed classes the caller did not know about.
   *
   * A file that declares `Packet` and also writes `Packet pkt;` cannot decide
   * which is which on the first pass. One extra pass settles it, and only when
   * the file actually declares something new.
   */
  analyze(tree, text) {
    const known = this.knownClasses();
    const values = this.importedParameterValues;
    const macros = this.macros();
    const parse = (fragment) => this.parser.parse(fragment);
    const first = analyzeTree(tree, text, known, values, macros, parse);
    const declaredHere = [...new Set(first.scopes.filter((s) => s.category === "class").map((s) => s.name))].filter(
      (name) => !known.has(name)
    );
    if (declaredHere.length === 0) return first;
    return analyzeTree(tree, text, /* @__PURE__ */ new Set([...known, ...declaredHere]), values, macros, parse);
  }
  /**
  * Re-analyses a document from scratch, ignoring its version.
  *
  * A version check exists to keep a keystroke cheap, which is the right trade
  * while nothing outside the file can change the answer. It is the wrong trade
  * once the workspace index lands: `output logic [C_PKT_DAT_W-1:0]` keeps the
  * same text and gets a different width the moment the package is indexed, and
  * no edit will ever arrive to trigger the update.
  */
  reanalyze(uri) {
    const existing2 = this.entries.get(uri);
    if (!existing2) return void 0;
    const text = existing2.document.getText();
    const tree = this.parser.parse(text);
    existing2.tree.delete();
    existing2.tree = tree;
    existing2.analysis = this.analyze(tree, text);
    return existing2;
  }
  get(uri) {
    return this.entries.get(uri);
  }
  close(uri) {
    const entry = this.entries.get(uri);
    if (!entry) return;
    entry.tree.delete();
    this.entries.delete(uri);
  }
  all() {
    return [...this.entries.values()];
  }
};

// src/server/providers/definition.ts
var import_vscode_languageserver_types = require("vscode-languageserver-types");

// src/server/model.ts
function scopeChain(analysis, position) {
  const matches = analysis.scopesByRange.filter((e) => e.start <= position && position <= e.end);
  return matches.sort((a, b) => a.depth - b.depth).map((e) => e.scope);
}
function visibleSymbols(analysis, position) {
  const chain = scopeChain(analysis, position);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const consider = (sym) => {
    if (seen.has(sym.name)) return;
    seen.add(sym.name);
    out.push(sym);
  };
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i];
    for (const sym of scope.parameters) consider(sym);
    for (const sym of scope.ports) consider(sym);
    for (const sym of scope.symbols) consider(sym);
  }
  return out;
}
function resolveSymbol(analysis, name, position) {
  return visibleSymbols(analysis, position).find((s) => s.name === name);
}
function importsInScope(analysis, position) {
  const chain = scopeChain(analysis, position);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const consider = (list) => {
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

// src/server/locate.ts
function nodeAt(analysis, offset) {
  const root = analysis.parseTree.rootNode;
  for (const probe of [offset, offset - 1]) {
    if (probe < 0 || probe > root.endIndex) continue;
    const node = root.namedDescendantForIndex(probe);
    if (node) return node;
  }
  return null;
}
function identifierAt(analysis, offset) {
  const root = analysis.parseTree.rootNode;
  for (const probe of [offset, offset - 1]) {
    if (probe < 0 || probe > root.endIndex) continue;
    const node = root.namedDescendantForIndex(probe);
    if (node && node.type === "simple_identifier") return node;
  }
  return null;
}

// src/server/imports.ts
function includedDeclarations(uri, catalog, includes) {
  const file = uriToPath(uri);
  if (!file) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const header of includes.closure(file)) {
    const headerUri = pathToUri(header);
    for (const symbol of catalog.unitDeclarations(headerUri)) {
      if (seen.has(symbol.name)) continue;
      seen.add(symbol.name);
      out.push({ symbol, uri: headerUri, header: baseNameOf(header) });
    }
  }
  return out;
}
function includedDeclaration(uri, catalog, includes, name) {
  return includedDeclarations(uri, catalog, includes).find((entry) => entry.symbol.name === name);
}
var MAX_IMPORT_HOPS2 = 8;
function collectFrom(catalog, entry, wanted, out, seen, hops) {
  if (hops > MAX_IMPORT_HOPS2 || seen.has(entry.name)) return;
  seen.add(entry.name);
  for (const symbol of [...entry.parameters, ...entry.ports, ...entry.symbols]) {
    if (wanted !== void 0 && symbol.name !== wanted) continue;
    if (out.some((found) => found.symbol.name === symbol.name)) continue;
    out.push({ symbol, packageName: entry.name, uri: entry.uri });
  }
  for (const imported of entry.imports) {
    if (!imported.wildcard) continue;
    const next = resolvePackage(catalog, imported.packageName, entry.uri);
    if (next) collectFrom(catalog, next, wanted, out, seen, hops + 1);
  }
}
function resolvePackage(catalog, name, nearUri) {
  const entries = catalog.all(name);
  return entries.find((entry) => entry.uri === nearUri) ?? entries[0];
}
function bringsIn(entry, name) {
  return entry.wildcard || entry.explicit.includes(name);
}
function importedMember(analysis, catalog, position, name) {
  const external = externalMembers(analysis, catalog, position).find((s) => s.symbol.name === name);
  if (external) return external;
  for (const entry of importsInScope(analysis, position)) {
    if (!bringsIn(entry, name)) continue;
    const pkg = catalog.resolve(entry.packageName);
    if (!pkg) continue;
    const found = [];
    collectFrom(catalog, pkg, name, found, /* @__PURE__ */ new Set(), 0);
    if (found.length > 0) return found[0];
  }
  return void 0;
}
function importedMembers(analysis, catalog, position) {
  const out = externalMembers(analysis, catalog, position);
  const seen = /* @__PURE__ */ new Set();
  for (const entry of importsInScope(analysis, position)) {
    const pkg = catalog.resolve(entry.packageName);
    if (!pkg) continue;
    if (entry.wildcard) {
      collectFrom(catalog, pkg, void 0, out, seen, 0);
      continue;
    }
    for (const name of entry.explicit) {
      if (!bringsIn(entry, name)) continue;
      collectFrom(catalog, pkg, name, out, /* @__PURE__ */ new Set(), 0);
    }
  }
  return out;
}
function externalMembers(analysis, catalog, position) {
  const chain = scopeChain(analysis, position);
  const implementation = chain.find((scope) => scope.ownerClass);
  const owner = implementation?.ownerClass ?? chain.find((scope) => scope.category === "class")?.name;
  const members = catalog.externalDeclarations(owner).map((member) => ({ ...member, packageName: owner ?? "$unit" }));
  if (owner) members.push(...catalog.externalDeclarations().filter((m) => !members.some((own) => own.symbol.name === m.symbol.name)).map((member) => ({ ...member, packageName: "$unit" })));
  const prototype = implementation ? members.find((m) => m.symbol.name === implementation.name) : void 0;
  if (prototype) members.unshift(...(prototype.symbol.arguments ?? []).map((symbol) => ({
    symbol,
    uri: prototype.uri,
    packageName: owner
  })));
  return members;
}
function baseNameOf(file) {
  const parts = file.split("/");
  return parts[parts.length - 1] ?? file;
}

// src/server/hierarchy.ts
var PATH_WRAPPERS = /* @__PURE__ */ new Set([
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
  "constant_primary"
]);
function pathOf(node) {
  const top = enclosingReference(node);
  if (!top) return void 0;
  const segments = [];
  collect(top, segments);
  return segments.length > 1 ? segments : void 0;
}
function enclosingReference(node) {
  if (!node) return void 0;
  let top = node;
  while (top.parent) {
    const parent = top.parent;
    const byType = PATH_WRAPPERS.has(parent.type);
    const byPosition = parent.startIndex === top.startIndex && parent.text.length > top.text.length;
    if (!byType && !byPosition) break;
    top = parent;
  }
  return pathSegmentsOf(top).length > 1 ? top : void 0;
}
function pathSegmentsOf(top) {
  const segments = [];
  collect(top, segments);
  return segments;
}
function collectScopeResolved(node, into) {
  if (!node.text.includes("::")) return false;
  const expected = node.text.split("::").length;
  const identifiers = [];
  const walk = (current) => {
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
        end: { line: identifier.endPosition.row, character: identifier.endPosition.column }
      }
    });
  }
  return true;
}
function collect(node, into) {
  if (collectScopeResolved(node, into)) return;
  if (node.type === "hierarchical_identifier") {
    for (const child of node.namedChildren) {
      into.push({
        name: child.text,
        range: {
          start: { line: child.startPosition.row, character: child.startPosition.column },
          end: { line: child.endPosition.row, character: child.endPosition.column }
        }
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
  if (node.type !== "select" && head.type === "hierarchical_identifier") {
    collect(head, into);
    return;
  }
  if (node.type === "select") {
    const identifier = head.namedChild(0);
    if (identifier) {
      into.push({
        name: identifier.text,
        range: {
          start: { line: identifier.startPosition.row, character: identifier.startPosition.column },
          end: { line: identifier.endPosition.row, character: identifier.endPosition.column }
        }
      });
    }
    const index = node.namedChildren[1]?.text;
    const last = into[into.length - 1];
    if (last && index) into[into.length - 1] = { ...last, index };
    return;
  }
  if (node.type === "scope_resolution" && head.type !== "simple_identifier") {
    collect(head, into);
    for (const child of node.namedChildren.slice(1)) {
      into.push({
        name: child.text,
        range: {
          start: { line: child.startPosition.row, character: child.startPosition.column },
          end: { line: child.endPosition.row, character: child.endPosition.column }
        }
      });
    }
    return;
  }
  into.push({
    name: head.text,
    range: {
      start: { line: head.startPosition.row, character: head.startPosition.column },
      end: { line: head.endPosition.row, character: head.endPosition.column }
    }
  });
}
function interfaceOfType(typeText, catalog) {
  const last = typeText.replace(/^virtual\s+(?:interface\s+)?/, "").replace(/\s*#\s*\([^]*\)/, "").trim().split("::").pop()?.split(".")[0]?.trim();
  if (!last) return void 0;
  const candidates = catalog.all(last).filter((entry) => entry.kind === "interface");
  return candidates[0];
}
function childNamed(analysis, chain, name) {
  const onChain = new Set(chain.map((scope) => scope.id));
  let found;
  let foundDepth = -1;
  for (const scope of analysis.scopes) {
    if (scope.name !== name || scope.parentId === void 0) continue;
    if (scope.category !== "block" && scope.category !== "function" && scope.category !== "task") continue;
    let depth = 0;
    let parentId = scope.parentId;
    while (parentId !== void 0 && !onChain.has(parentId)) {
      const parent = analysis.scopesById.get(parentId);
      if (!parent) break;
      parentId = parent.parentId;
      depth++;
    }
    if (parentId === void 0 || depth <= foundDepth) continue;
    found = scope;
    foundDepth = depth;
  }
  return found;
}
function resolveNamedBlock(analysis, chain, name) {
  return childNamed(analysis, chain, name);
}
function resolvePath(node, analysis, catalog, documentUri) {
  const result = walkPath(node, analysis, catalog, documentUri);
  if (result === "no-path") return void 0;
  if (!("symbol" in result)) {
    return {
      symbol: MISSING,
      uri: documentUri,
      viaInterface: result.viaInterface,
      missingMember: true,
      missingName: result.missing
    };
  }
  return result;
}
var MISSING = {
  name: "",
  category: "variable",
  typeText: "",
  unpackedDims: [],
  isPort: false,
  scopeId: -1,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
};
function notFound(name, viaInterface) {
  return { missing: name, viaInterface };
}
function walkPath(node, analysis, catalog, documentUri) {
  const segments = pathOf(node);
  if (!segments) return "no-path";
  const offset = node?.startIndex ?? 0;
  const chain = scopeChain(analysis, offset);
  const head = segments[0];
  if (head.name === "this" || head.name === "super") {
    const owner = chain.find((s) => s.ownerClass)?.ownerClass ?? chain.find((s) => s.category === "class")?.name;
    let entry = owner ? catalog.resolve(owner) : void 0;
    if (head.name === "super") entry = entry?.baseClass ? catalog.resolve(entry.baseClass) : void 0;
    if (entry) return intoEntry(entry, segments, 1, catalog, false, head.name);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const instance = chain[i].instances.find((it2) => it2.instanceName === head.name);
    if (instance) {
      return intoInstance(instance.typeName, segments, documentUri, catalog);
    }
    const block = childNamed(analysis, chain, head.name);
    if (block) return intoScope(block, segments, 1, documentUri);
  }
  const local = visibleInChain(chain, head.name) ?? importedMember(analysis, catalog, offset, head.name)?.symbol;
  if (local) {
    if (segments.length === 1) return { symbol: local, uri: documentUri, viaInterface: false };
    if (local.handleOf) {
      const entry = catalog.resolve(local.handleOf);
      if (entry) return intoEntry(entry, segments, 1, catalog, false, head.name);
    }
    const iface = interfaceOfType(local.typeText, catalog);
    if (iface) return intoEntry(iface, segments, 1, catalog, true, head.name);
  }
  const unit = catalog.get(head.name);
  if (unit && segments.length > 1) {
    return intoEntry(unit, segments, 1, catalog, unit.kind === "interface", head.name);
  }
  return "no-path";
}
function intoInstance(typeName, segments, documentUri, catalog) {
  const entry = catalog.resolve(typeName);
  if (!entry) return "no-path";
  return intoEntry(entry, segments, 1, catalog, entry.kind === "interface", segments[0].name);
}
function intoScope(scope, segments, from, documentUri) {
  const member = segments[from];
  if (!member) return "no-path";
  const symbol = findInEntry(scope, member.name);
  if (!symbol) return notFound(member.name, false);
  const resolved = {
    symbol,
    uri: documentUri,
    viaInterface: false,
    instance: scope.name
  };
  const next = segments[from + 1];
  if (!next) return resolved;
  const nested = childNamedLocal(scope, member.name);
  return nested ? intoScope(nested, segments, from + 2, documentUri) : resolved;
}
function childNamedLocal(scope, name) {
  return scope.children.find((child) => child.name === name && child.category === "block");
}
function intoEntry(entry, segments, from, catalog, viaInterface, instance) {
  const member = segments[from];
  if (!member) return "no-path";
  const inherited = entry.kind === "class" ? catalog.externalDeclarations(entry.name).find((s) => s.symbol.name === member.name) : void 0;
  const symbol = entry.kind === "class" ? inherited?.symbol : findInEntry(entry, member.name);
  if (!symbol) {
    return notFound(member.name, viaInterface);
  }
  const resolved = { symbol, uri: inherited?.uri ?? entry.uri, viaInterface, instance };
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
function findInEntry(entry, name) {
  return entry.ports.find((s) => s.name === name) ?? entry.parameters.find((s) => s.name === name) ?? entry.symbols.find((s) => s.name === name);
}
function visibleInChain(chain, name) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i];
    const found = findInEntry(scope, name);
    if (found) return found;
  }
  return void 0;
}

// src/server/providers/definition.ts
function provideDefinition(document, analysis, catalog, offset, includes) {
  const node = identifierAt(analysis, offset);
  if (!node) return null;
  const name = node.text;
  const binding = instanceBindingContext(node);
  if (binding) {
    const entries = catalog.all(binding.typeName);
    const unit = entries.find((e) => e.uri !== document.uri) ?? entries.find((e) => e.uri === document.uri) ?? entries[0];
    const candidates = unit ? binding.kind === "port" ? unit.ports : unit.parameters : [];
    const target = candidates.find((p) => p.name === name);
    if (target && unit) return import_vscode_languageserver_types.Location.create(unit.uri, target.selectionRange);
  }
  const local = resolveSymbol(analysis, name, offset);
  if (local) return import_vscode_languageserver_types.Location.create(document.uri, local.selectionRange);
  if (pathOf(node)) {
    const resolved = resolvePath(node, analysis, catalog, document.uri);
    if (resolved) return import_vscode_languageserver_types.Location.create(resolved.uri, resolved.symbol.selectionRange);
  }
  const imported = importedMember(analysis, catalog, offset, name);
  if (imported) return import_vscode_languageserver_types.Location.create(imported.uri, imported.symbol.selectionRange);
  if (includes) {
    const declared = includedDeclaration(document.uri, catalog, includes, name);
    if (declared) return import_vscode_languageserver_types.Location.create(declared.uri, declared.symbol.selectionRange);
  }
  const locations = catalog.locations(name);
  if (locations.length > 0) return locations;
  return null;
}
function instanceBindingContext(node) {
  const parent = node.parent;
  if (!parent) return void 0;
  if (parent.type !== "named_port_connection" && parent.type !== "named_parameter_assignment") {
    return void 0;
  }
  const first = parent.namedChild(0);
  if (first && first.id !== node.id) return void 0;
  let current = parent;
  while (current) {
    if (current.type === "module_instantiation") {
      const typeName = current.childForFieldName("instance_type")?.text;
      if (!typeName) return void 0;
      return {
        kind: parent.type === "named_port_connection" ? "port" : "parameter",
        typeName
      };
    }
    current = current.parent;
  }
  return void 0;
}

// src/server/symbolFormatting.ts
var import_vscode_languageserver_types2 = require("vscode-languageserver-types");
var CATEGORY_LABEL = {
  port: "Port",
  net: "Net",
  variable: "Variable",
  parameter: "Parameter",
  localparam: "Local parameter",
  typedef: "Type",
  enum: "Enumeration literal",
  genvar: "Genvar",
  task: "Task",
  function: "Function",
  instance: "Instance",
  module: "Module",
  interface: "Interface",
  program: "Program",
  package: "Package",
  class: "Class",
  handle: "Class instance",
  block: "Generate block"
};
function toCompletionKind(category) {
  switch (category) {
    case "port":
      return import_vscode_languageserver_types2.CompletionItemKind.Field;
    case "net":
      return import_vscode_languageserver_types2.CompletionItemKind.Value;
    case "variable":
      return import_vscode_languageserver_types2.CompletionItemKind.Variable;
    case "parameter":
    case "localparam":
    case "genvar":
      return import_vscode_languageserver_types2.CompletionItemKind.Constant;
    case "typedef":
      return import_vscode_languageserver_types2.CompletionItemKind.Class;
    case "enum":
      return import_vscode_languageserver_types2.CompletionItemKind.EnumMember;
    case "task":
      return import_vscode_languageserver_types2.CompletionItemKind.Function;
    case "function":
      return import_vscode_languageserver_types2.CompletionItemKind.Function;
    case "package":
      return import_vscode_languageserver_types2.CompletionItemKind.Module;
    case "class":
      return import_vscode_languageserver_types2.CompletionItemKind.Class;
    case "handle":
      return import_vscode_languageserver_types2.CompletionItemKind.Reference;
    default:
      return import_vscode_languageserver_types2.CompletionItemKind.Value;
  }
}
function formatBits(count) {
  return `${count} ${plural(count, "bit")}`;
}
function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}
function describeSymbol(symbol, options) {
  const parts = [];
  if (symbol.direction) parts.push(symbol.direction);
  if (options.showType && symbol.typeText && symbol.typeText !== symbol.direction) {
    parts.push(symbol.typeText);
  }
  if (options.showWidth) {
    const dims = [];
    if (symbol.packedWidth !== void 0) dims.push(formatBits(symbol.packedWidth));
    if (symbol.unpackedDims.length > 0) {
      const count = symbol.unpackedCount;
      dims.push(
        count !== void 0 ? `${count} ${plural(count, "element")} ${symbol.unpackedDims.join(" ")}` : `array ${symbol.unpackedDims.join(" ")}`
      );
    }
    parts.push(...dims);
  }
  if (symbol.category === "parameter" || symbol.category === "localparam") {
    parts.push(symbol.resolvedValue !== void 0 ? `default ${symbol.resolvedValue}` : "no default");
  }
  return parts.join(" \xB7 ");
}
function declarationText(symbol) {
  if (symbol.arguments) return callableLabel(symbol);
  const direction = symbol.isPort && symbol.direction ? `${symbol.direction} ` : "";
  const packed = symbol.packedRangeText ? ` [${symbol.packedRangeText}]` : "";
  const unpacked = symbol.unpackedDims.join("");
  const init = symbol.initializerText && symbol.category !== "typedef" ? ` = ${symbol.initializerText}` : "";
  return `${direction}${symbol.typeText}${packed} ${symbol.name}${unpacked}${init}`.replace(/\s+/g, " ").trim();
}
function argumentLabel(arg) {
  return [arg.direction ?? "input", arg.typeText, arg.packedRangeText ? `[${arg.packedRangeText}]` : "", arg.name + arg.unpackedDims.join("")].filter(Boolean).join(" ") + (arg.initializerText !== void 0 ? ` = ${arg.initializerText}` : "");
}
function callableLabel(symbol) {
  return `${symbol.category} ${symbol.category === "function" ? symbol.typeText + " " : ""}${symbol.name}(${(symbol.arguments ?? []).map(argumentLabel).join(", ")})`;
}
function documentationFor(symbol, options) {
  const lines = [];
  lines.push("```systemverilog");
  lines.push(declarationText(symbol));
  lines.push("```");
  const detail = describeSymbol(symbol, options);
  if (detail) lines.push(`**${detail}**`);
  if (symbol.packedWidth !== void 0) {
    const label = `${symbol.name} is ${formatBits(symbol.packedWidth)} wide`;
    const spread = symbol.unpackedCount !== void 0 && symbol.unpackedCount > 1 ? ` across ${symbol.unpackedCount} ${plural(symbol.unpackedCount, "element")}` : "";
    lines.push("");
    lines.push(`\`${label}\`${spread}.`);
  }
  if (options.usageCount !== void 0 && options.usageCount > 0) {
    lines.push("");
    lines.push(`Referenced ${options.usageCount} ${plural(options.usageCount, "time")} in this file.`);
  }
  if (symbol.doc) {
    lines.push("");
    lines.push(symbol.doc);
  }
  return { kind: "markdown", value: lines.join("\n") };
}

// src/server/providers/hover.ts
function provideHover(document, analysis, catalog, offset, settings, includes) {
  const node = identifierAt(analysis, offset);
  if (!node) return null;
  const name = node.text;
  const path5 = pathOf(node);
  const symbols = visibleSymbols(analysis, offset);
  const symbol = symbols.find((s) => s.name === name);
  if (symbol) {
    const uses = analysis.identifiers.get(name)?.length ?? 0;
    const isDeclaration = symbol.selectionRange.start.line === node.startPosition.row && symbol.selectionRange.start.character === node.startPosition.column;
    const doc = documentationFor(symbol, { ...settings, usageCount: isDeclaration ? uses : uses + 1 });
    const lines = [doc.value];
    if (!isDeclaration) {
      lines.push("", `Declared in \`${symbol.category}\` at line ${symbol.selectionRange.start.line + 1}.`);
    }
    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }
  if (path5) {
    const resolved = resolvePath(node, analysis, catalog, document.uri);
    if (resolved) {
      const doc = documentationFor(resolved.symbol, { ...settings, usageCount: 1 });
      const lines = [doc.value, ""];
      if (resolved.viaInterface) {
        lines.push(`Member of interface instance \`${resolved.instance}\`.`);
      } else if (resolved.instance) {
        lines.push(`Reached through instance \`${resolved.instance}\`.`);
      }
      lines.push(
        `Declared in \`${shortUri(resolved.uri)}\` at line ${resolved.symbol.selectionRange.start.line + 1}.`
      );
      return { contents: { kind: "markdown", value: lines.join("\n") } };
    }
  }
  const imported = importedMember(analysis, catalog, offset, name);
  if (imported) {
    const doc = documentationFor(imported.symbol, { ...settings, usageCount: 1 });
    return {
      contents: {
        kind: "markdown",
        value: [
          doc.value,
          "",
          `Imported from \`${imported.packageName}\` in \`${shortUri(imported.uri)}\` at line ${imported.symbol.selectionRange.start.line + 1}.`
        ].join("\n")
      }
    };
  }
  if (includes) {
    const declared = includedDeclaration(document.uri, catalog, includes, name);
    if (declared) {
      const doc = documentationFor(declared.symbol, { ...settings, usageCount: 1 });
      return {
        contents: {
          kind: "markdown",
          value: [
            doc.value,
            "",
            `Declared in \`${declared.header}\` at line ${declared.symbol.selectionRange.start.line + 1}, included by this file.`
          ].join("\n")
        }
      };
    }
  }
  const unit = catalog.get(name);
  if (unit) {
    const lines = [];
    lines.push("```systemverilog");
    lines.push(headerSummary(unit.name, unit.kind, unit.ports, unit.parameters));
    lines.push("```");
    lines.push("");
    lines.push(`**${unit.kind}** defined in \`${shortUri(unit.uri)}\` at line ${unit.selectionRange.start.line + 1}.`);
    if (unit.ports.length > 0) {
      lines.push("");
      lines.push("| Port | Type | Bits |");
      lines.push("| --- | --- | --- |");
      for (const port of unit.ports) {
        lines.push(
          `| \`${port.name}\` | ${port.direction ?? ""} ${escapePipes(port.typeText)}${port.packedRangeText ? ` [${port.packedRangeText}]` : ""} | ${port.packedWidth ?? "?"} |`
        );
      }
    }
    if (unit.parameters.length > 0) {
      lines.push("");
      lines.push("**Parameters**");
      for (const param of unit.parameters) {
        const detail = describeSymbol(param, settings);
        lines.push(`- \`${declarationText(param)}\`${detail ? ` \u2014 ${detail}` : ""}`);
      }
    }
    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }
  return null;
}
function headerSummary(name, kind, ports, parameters) {
  const paramList = parameters.length > 0 ? `#(${parameters.map((p) => p.name).join(", ")})` : "";
  const portList = ports.length > 0 ? ` (${ports.map((p) => p.name).join(", ")})` : " ()";
  return `${kind} ${name}${paramList}${portList};`;
}
function escapePipes(text) {
  return text.replace(/\|/g, "\\|");
}
function shortUri(uri) {
  const parts = uri.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

// src/server/providers/completion.ts
var import_vscode_languageserver_types4 = require("vscode-languageserver-types");

// src/server/completionData.ts
var import_vscode_languageserver_types3 = require("vscode-languageserver-types");
var KEYWORD_GROUPS = [
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Keyword,
    words: [
      "module",
      "endmodule",
      "macromodule",
      "primitive",
      "endprimitive",
      "package",
      "endpackage",
      "program",
      "endprogram",
      "interface",
      "endinterface",
      "class",
      "endclass",
      "virtual",
      "extends",
      "implements",
      "pure"
    ]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Keyword,
    words: [
      "always",
      "always_ff",
      "always_comb",
      "always_latch",
      "initial",
      "final",
      "begin",
      "end",
      "fork",
      "join",
      "join_any",
      "join_none",
      "if",
      "else",
      "case",
      "casex",
      "casez",
      "endcase",
      "default",
      "for",
      "foreach",
      "while",
      "do",
      "repeat",
      "break",
      "continue",
      "return",
      "forever",
      "wait",
      "disable",
      "assign",
      "deassign",
      "force",
      "release"
    ]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.TypeParameter,
    words: [
      "logic",
      "bit",
      "byte",
      "shortint",
      "int",
      "longint",
      "integer",
      "time",
      "real",
      "shortreal",
      "realtime",
      "reg",
      "wire",
      "tri",
      "wand",
      "wor",
      "supply0",
      "supply1",
      "tri0",
      "tri1",
      "triand",
      "trior",
      "trireg",
      "uwire",
      "interconnect",
      "void",
      "string",
      "chandle",
      "event",
      "genvar"
    ]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Struct,
    words: ["struct", "union", "enum", "packed", "tagged"]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Keyword,
    words: [
      "input",
      "output",
      "inout",
      "ref",
      "const",
      "var",
      "static",
      "automatic",
      "localparam",
      "parameter",
      "local",
      "protected",
      "rand",
      "randc"
    ]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Keyword,
    words: [
      "signed",
      "unsigned",
      "unique",
      "unique0",
      "priority",
      "with",
      "inside",
      "dist",
      "matches",
      "tagged",
      "binsof"
    ]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.TypeParameter,
    words: ["typedef", "enum", "bit", "logic", "class", "interface"]
  },
  {
    kind: import_vscode_languageserver_types3.CompletionItemKind.Module,
    words: ["import", "export", "timeunit", "timeprecision", "celldefine", "endcelldefine", "`include", "`define"]
  }
];
var DIRECTIVES = [
  "`define",
  "`undef",
  "`ifdef",
  "`ifndef",
  "`else",
  "`elsif",
  "`endif",
  "`include",
  "`timescale",
  "`default_nettype",
  "`resetall",
  "`celldefine",
  "`unconnected_drive",
  "`line",
  "`begin_keywords",
  "`end_keywords",
  "`pragma"
];
var SYSTEM_FUNCTIONS = [
  { name: "$clog2", detail: "Returns the integer log2 of the argument." },
  { name: "$bits", detail: "Returns the size of a type or signal in bits." },
  { name: "$size", detail: "Returns the number of elements in an unpacked dimension." },
  { name: "$left", detail: "Shifts a value left, filling with zeros." },
  { name: "$right", detail: "Shifts a value right, filling with zeros." },
  { name: "$signed", detail: "Reinterprets the value as signed." },
  { name: "$unsigned", detail: "Reinterprets the value as unsigned." },
  { name: "$ceil", detail: "Rounds up to the nearest integer." },
  { name: "$floor", detail: "Rounds down to the nearest integer." },
  { name: "$sqrt", detail: "Square root." },
  { name: "$ln", detail: "Natural logarithm." },
  { name: "$log10", detail: "Base-10 logarithm." },
  { name: "$pow", detail: "Raises the first argument to the second." },
  { name: "$urandom", detail: "Pseudo-random number." },
  { name: "$urandom_range", detail: "Pseudo-random number in a range." },
  { name: "$time", detail: "Current simulation time." },
  { name: "$stime", detail: "Simulation time scaled to the module time unit." },
  { name: "$realtime", detail: "Current simulation time as a real." },
  { name: "$countones", detail: "Number of bits set to one." },
  { name: "$onehot", detail: "True when exactly one bit is set." },
  { name: "$onehot0", detail: "True when at most one bit is set." },
  { name: "$isunknown", detail: "True when any bit is x or z." },
  { name: "$past", detail: "Value of an expression in a previous time step." },
  { name: "$rose", detail: "True on a 0 -> 1 transition." },
  { name: "$fell", detail: "True on a 1 -> 0 transition." },
  { name: "$stable", detail: "True when the value did not change." },
  { name: "$display", detail: "Writes values to the simulator output." },
  { name: "$write", detail: "Writes values without a trailing newline." },
  { name: "$monitor", detail: "Prints whenever any monitored argument changes." },
  { name: "$finish", detail: "Ends the simulation." },
  { name: "$stop", detail: "Pauses the simulation." },
  { name: "$fatal", detail: "Assertion failure that ends the simulation." },
  { name: "$error", detail: "Assertion failure." },
  { name: "$warning", detail: "Assertion warning." },
  { name: "$info", detail: "Informational assertion message." },
  { name: "$assertkill", detail: "Ends the simulation on failure." },
  { name: "$sformatf", detail: "Formats arguments into a string." },
  { name: "$typename", detail: "Returns the type name of an expression." }
];
var SNIPPETS = [
  {
    label: "always_ff",
    detail: "Sequential block driven by a clock (non-blocking assignments)",
    body: [
      "always_ff @(posedge ${1:clk} ${2:or negedge rst_n}) begin",
      "	if (!${3:rst_n}) begin",
      "		$4",
      "	end else begin",
      "		$0",
      "	end",
      "end"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "always_ff_simple",
    detail: "Sequential block, clock only, no reset",
    body: ["always_ff @(posedge ${1:clk}) begin", "	$0", "end"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "always_comb",
    detail: "Combinational block",
    body: ["always_comb begin", "	$0", "end"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "always_latch",
    detail: "Latch block (infers a latch unless every path assigns)",
    body: ["always_latch begin", "	$0", "end"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "always_block",
    detail: "Verilog-2001 style always @(*)",
    body: ["always @(*) begin", "	$0", "end"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "module",
    detail: "Module skeleton with parameter and port lists",
    body: [
      "module ${1:name} #(${2:parameter int W = 8}) (",
      "	input  wire            ${3:clk},",
      "	input  wire            ${4:rst_n}",
      ");",
      "",
      "	$0",
      "",
      "endmodule"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Module
  },
  {
    label: "interface",
    detail: "Interface skeleton",
    body: [
      "interface $1_if #(parameter ${2:int} ${3:WIDTH} = ${4:32}) (",
      "	input wire ${5:clk}",
      ");",
      "",
      "	$0",
      "",
      "endinterface"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Interface
  },
  {
    label: "package",
    detail: "Package skeleton",
    body: ["package $1_pkg;", "", "	$0", "", "endpackage"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Module
  },
  {
    label: "typedef_struct",
    detail: "Packed typedef struct",
    body: [
      "typedef struct packed {",
      "	logic [${1:7}:0] ${2:field};",
      "} ${3:my_struct};"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "typedef_enum",
    detail: "Typedef enum with explicit values",
    body: [
      "typedef enum logic [${1:1}:0] {",
      "	${2:IDLE} = 2'b00,",
      "	${3:RUN}  = 2'b01,",
      "	${4:DONE} = 2'b10",
      "} ${5:my_enum};"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "function",
    detail: "Automatic function",
    body: [
      "function automatic ${1:logic} [${2:31}:0] ${3:my_func}(input logic [${2:31}:0] ${4:arg});",
      "	$0",
      "endfunction"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Function
  },
  {
    label: "task",
    detail: "Automatic task",
    body: ["task automatic ${1:my_task}(input logic ${2:arg});", "	$0", "endtask"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Function
  },
  {
    label: "generate_for",
    detail: "Generate for loop",
    body: [
      "genvar ${1:i};",
      "generate",
      "	for (${1:i} = 0; ${1:i} < ${2:N}; ${1:i}++) begin : gen_$1",
      "		$0",
      "	end",
      "endgenerate"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "if_generate",
    detail: "Conditional generate",
    body: [
      "generate",
      "	if (${1:COND}) begin : gen_$1",
      "		$0",
      "	end else begin : gen_else",
      "	end",
      "endgenerate"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "assert_property",
    detail: "Immediate-style concurrent assertion property",
    body: [
      "property ${1:p_name};",
      "	@(posedge ${2:clk}) ${3:expr} |-> ${4:expr2};",
      "endproperty",
      'assert property (${1:p_name}) else $error("${5:assertion failed}");'
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "sva_assert",
    detail: "Simple concurrent assertion",
    body: ["assert property (@(posedge ${1:clk}) ${2:expr} |=> ${3:expr2});"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "cover_property",
    detail: "Concurrent cover point",
    body: ["cover property (@(posedge ${1:clk}) ${2:expr});"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "immediate_assert",
    detail: "Immediate assertion",
    body: ['assert (${1:expr}) else $error("${2:message}");'],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "covergroup",
    detail: "Functional coverage covergroup",
    body: [
      "covergroup ${1:cg}_cov @(posedge ${2:clk});",
      "	${3:cp}: coverpoint ${4:expr} {",
      "		bins low  = {0};",
      "		bins high = {[1:$]};",
      "	}",
      "endgroup"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "clocking_block",
    detail: "Clocking block for testbench synchronisation",
    body: [
      "clocking ${1:cb}_clk @(posedge ${2:clk});",
      "	default input #1step output #1ns;",
      "	input ${3:signal};",
      "endclocking"
    ],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Snippet
  },
  {
    label: "class",
    detail: "Class skeleton",
    body: ["class ${1:my_class}${2: extends base};", "	$0", "endclass"],
    kind: import_vscode_languageserver_types3.CompletionItemKind.Class
  }
];
function staticCompletionItems(options) {
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (item) => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push(item);
  };
  if (options.snippets) {
    for (const snippet of SNIPPETS) {
      push({
        label: snippet.label,
        kind: snippet.kind,
        detail: snippet.detail,
        insertText: Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body,
        insertTextFormat: import_vscode_languageserver_types3.InsertTextFormat.Snippet,
        sortText: `5|${snippet.label}`
      });
    }
  }
  if (options.systemFunctions) {
    for (const fn of SYSTEM_FUNCTIONS) {
      push({
        label: fn.name,
        kind: import_vscode_languageserver_types3.CompletionItemKind.Function,
        detail: fn.detail,
        sortText: `6|${fn.name}`
      });
    }
  }
  for (const macro of DIRECTIVES) {
    push({
      label: macro,
      kind: import_vscode_languageserver_types3.CompletionItemKind.Constant,
      detail: "Compiler directive",
      sortText: `7|${macro}`
    });
  }
  for (const group of KEYWORD_GROUPS) {
    for (const word of group.words) {
      push({ label: word, kind: group.kind, detail: "SystemVerilog keyword", sortText: `8|${word}` });
    }
  }
  return items;
}

// src/server/callables.ts
function resolveCallable(name, analysis, catalog, offset, uri, includes) {
  const parts = name.split(/::|\./);
  const last = parts.pop();
  let symbol;
  if (parts.length === 0) {
    symbol = resolveSymbol(analysis, last, offset) ?? importedMember(analysis, catalog, offset, last)?.symbol ?? (includes ? includedDeclaration(uri, catalog, includes, last)?.symbol : void 0);
  } else {
    const root = parts.shift();
    const local = resolveSymbol(analysis, root, offset) ?? importedMember(analysis, catalog, offset, root)?.symbol;
    const instance = scopeChain(analysis, offset).flatMap((s) => s.instances).find((i) => i.instanceName === root);
    let entry = local?.handleOf ? catalog.resolve(local.handleOf) : local ? interfaceOfType(local.typeText, catalog) : void 0;
    if (root === "this" || root === "super") {
      const chain = scopeChain(analysis, offset);
      const owner = chain.find((s) => s.ownerClass)?.ownerClass ?? chain.find((s) => s.category === "class")?.name;
      entry = owner ? catalog.resolve(owner) : void 0;
      if (root === "super") entry = entry?.baseClass ? catalog.resolve(entry.baseClass) : void 0;
    }
    entry ??= catalog.resolve(instance?.typeName ?? root);
    for (const part of parts) {
      const nested = entry?.instances.find((i) => i.instanceName === part);
      const member = entry?.symbols.find((s) => s.name === part);
      entry = nested ? catalog.resolve(nested.typeName) : member?.handleOf ? catalog.resolve(member.handleOf) : member ? interfaceOfType(member.typeText, catalog) : void 0;
    }
    if (entry) symbol = (entry.kind === "class" ? catalog.classMembers(entry.name) : entry.symbols).find((s) => s.name === last);
  }
  return symbol && (symbol.category === "function" || symbol.category === "task") ? symbol : void 0;
}
function callAt(text, offset) {
  const stack = [];
  let string = false;
  for (let i = 0; i < offset; i++) {
    const char = text[i];
    if (string) {
      if (char === "\\") i++;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < offset && text[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < offset && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") stack.push({ char, start: i, argument: 0, argStart: i + 1 });
    else if (char === ")" || char === "]" || char === "}") stack.pop();
    else if (char === "," && stack.length) {
      const top = stack[stack.length - 1];
      top.argument++;
      top.argStart = i + 1;
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.char !== "(") continue;
    const match = /([A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*)\s*$/.exec(text.slice(0, frame.start));
    if (!match || text[frame.start - match[0].length - 1] === ".") continue;
    const named = /^\s*\.([A-Za-z_]\w*)/.exec(text.slice(frame.argStart, offset))?.[1];
    return { name: match[1], argument: frame.argument, named };
  }
  return void 0;
}
function provideSignatureHelp(document, analysis, catalog, offset, includes) {
  const call = callAt(document.getText(), offset);
  if (!call) return null;
  const routine = resolveCallable(call.name, analysis, catalog, offset, document.uri, includes);
  if (!routine) return null;
  const args = routine.arguments ?? [];
  const namedIndex = call.named ? args.findIndex((a) => a.name === call.named) : -1;
  return {
    signatures: [{ label: callableLabel(routine), parameters: args.map((arg) => ({ label: argumentLabel(arg), documentation: arg.doc })) }],
    activeSignature: 0,
    activeParameter: Math.max(0, Math.min(namedIndex >= 0 ? namedIndex : call.argument, args.length - 1))
  };
}

// src/server/providers/completion.ts
function completionContext(document, analysis, offset) {
  const text = document.getText();
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  return { analysis, document, offset, prefix: text.slice(start, offset), rangeStart: start };
}
function isWordChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}
function provideCompletion(context, documents, catalog, settings, includes) {
  const items = [];
  const call = callAt(context.document.getText(), context.offset);
  if (call && /(?:\(|,)\s*\.\w*$/.test(context.document.getText().slice(0, context.offset))) {
    const routine = resolveCallable(call.name, context.analysis, catalog, context.offset, context.document.uri, includes);
    if (routine) return { isIncomplete: false, items: (routine.arguments ?? []).map((arg) => ({
      label: arg.name,
      kind: import_vscode_languageserver_types4.CompletionItemKind.Property,
      detail: `${arg.direction ?? "input"} ${arg.typeText}`,
      insertText: `${arg.name}(\${1:${arg.name}})`,
      insertTextFormat: import_vscode_languageserver_types4.InsertTextFormat.Snippet
    })) };
  }
  const connection = instantiationContext(context);
  if (connection) {
    return {
      isIncomplete: false,
      items: connectionItems(connection, context, catalog, settings)
    };
  }
  const member = memberAccessContext(context, catalog);
  if (member) {
    return { isIncomplete: false, items: member.items };
  }
  const chain = scopeChain(context.analysis, context.offset);
  const scope = chain[chain.length - 1];
  const symbols = visibleSymbols(context.analysis, context.offset);
  for (const symbol of symbols) {
    if ((symbol.category === "parameter" || symbol.category === "localparam") && !settings.includeParameters) {
      continue;
    }
    items.push(symbolItem(symbol, context, settings, "1"));
  }
  const alreadyOffered = new Set(symbols.map((s) => s.name));
  if (includes) {
    for (const declared of includedDeclarations(context.document.uri, catalog, includes)) {
      if (alreadyOffered.has(declared.symbol.name)) continue;
      alreadyOffered.add(declared.symbol.name);
      const item = symbolItem(declared.symbol, context, settings, "1");
      item.detail = `${item.detail ?? ""} \xB7 ${declared.header}`.trim();
      items.push(item);
    }
  }
  for (const imported of importedMembers(context.analysis, catalog, context.offset)) {
    if (alreadyOffered.has(imported.symbol.name)) continue;
    alreadyOffered.add(imported.symbol.name);
    if ((imported.symbol.category === "parameter" || imported.symbol.category === "localparam") && !settings.includeParameters) {
      continue;
    }
    const item = symbolItem(imported.symbol, context, settings, "1");
    item.detail = `${item.detail ?? ""} \xB7 ${imported.packageName}::`.trim();
    items.push(item);
  }
  if (atInstantiationType(context, scope)) {
    for (const unit of catalog.units()) {
      items.push(unitItem(unit.name, unit.kind, unit.uri, unit.ports, unit.parameters, "0"));
    }
  } else {
    for (const unit of catalog.units()) {
      items.push(unitItem(unit.name, unit.kind, unit.uri, unit.ports, unit.parameters, "3"));
    }
  }
  for (const outer of chain) {
    if (outer.id === scope?.id) continue;
    items.push({
      label: outer.name,
      kind: toCompletionKind(outer.category),
      detail: `${CATEGORY_LABEL[outer.category] ?? outer.category} (enclosing scope)`,
      sortText: `4|${outer.name}`
    });
  }
  if (context.prefix.length > 0) {
    items.push(
      ...staticCompletionItems({ snippets: settings.snippets, systemFunctions: settings.systemFunctions })
    );
  }
  return { isIncomplete: false, items: dedupe(items) };
}
function symbolItem(symbol, context, settings, bucket) {
  const uses = context.analysis.identifiers.get(symbol.name)?.length ?? 0;
  const detail = describeSymbol(symbol, settings);
  const item = {
    label: symbol.name,
    kind: toCompletionKind(symbol.category),
    detail: detail || CATEGORY_LABEL[symbol.category],
    documentation: documentationFor(symbol, { ...settings, usageCount: uses }),
    sortText: `${bucket}|${symbol.category}|${symbol.name}`,
    filterText: symbol.name
  };
  item.insertText = symbol.name;
  applyCallable(item, symbol, context);
  if ((symbol.category === "parameter" || symbol.category === "localparam") && symbol.resolvedValue !== void 0) {
    item.command = {
      title: "Insert resolved value",
      command: "svision.insertResolvedValue",
      arguments: [
        {
          uri: context.document.uri,
          range: { start: context.document.positionAt(context.offset), end: context.document.positionAt(context.offset) },
          name: symbol.name,
          value: String(symbol.resolvedValue)
        }
      ]
    };
  }
  return item;
}
function unitItem(name, kind, uri, ports, parameters, bucket) {
  const portSummary = ports.length > 0 ? ` (${ports.length} ports)` : "";
  const paramSummary = parameters.length > 0 ? ` (${parameters.length} params)` : "";
  return {
    label: name,
    kind: kind === "interface" ? import_vscode_languageserver_types4.CompletionItemKind.Interface : kind === "package" ? import_vscode_languageserver_types4.CompletionItemKind.Module : import_vscode_languageserver_types4.CompletionItemKind.Class,
    detail: `${CATEGORY_LABEL[kind] ?? kind}${portSummary}${paramSummary} \u2014 ${shortUri2(uri)}`,
    sortText: `${bucket}|${kind}|${name}`,
    filterText: name
  };
}
function connectionItems(connection, context, catalog, settings) {
  const unit = catalog.get(connection.typeName);
  if (!unit) {
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
      sortText: `0|${symbol.category}|${symbol.name}`
    };
  });
}
function memberAccessContext(context, catalog) {
  const text = context.document.getText();
  let start = context.rangeStart;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  const dotted = text.slice(Math.max(0, start - 2), start) === "::";
  const delimiter = dotted ? 2 : 1;
  if (start < delimiter) return void 0;
  if ((dotted ? text[start - 2] : text[start - 1]) !== (dotted ? ":" : ".")) return void 0;
  const nameEnd = start - delimiter;
  let nameStart = nameEnd;
  while (nameStart > 0 && isWordChar(text[nameStart - 1])) nameStart--;
  const ownerName = text.slice(nameStart, nameEnd);
  if (!ownerName || !/^[A-Za-z_]/.test(ownerName)) return void 0;
  if (dotted) {
    const pkg = catalog.resolve(ownerName);
    if (!pkg) return void 0;
    return { items: memberItems([...pkg.parameters, ...pkg.ports, ...pkg.symbols], context) };
  }
  const instance = context.analysis.scopes.flatMap((scope) => scope.instances).find((i) => i.instanceName === ownerName);
  if (instance) {
    const entry = catalog.resolve(instance.typeName);
    if (!entry) return void 0;
    const members = entry.kind === "interface" ? [...entry.ports, ...entry.symbols] : entry.ports;
    return { items: memberItems(members, context) };
  }
  const bound = visibleSymbols(context.analysis, context.offset).find((s) => s.name === ownerName);
  const iface = bound ? interfaceOfType(bound.typeText, catalog) : void 0;
  if (iface) {
    return { items: memberItems([...iface.ports, ...iface.symbols], context) };
  }
  const handle = visibleSymbols(context.analysis, context.offset).find(
    (s) => s.name === ownerName && s.handleOf
  );
  if (handle?.handleOf) {
    const members = catalog.classMembers(handle.handleOf);
    if (members.length > 0) return { items: memberItems(members, context) };
  }
  const block = namedBlockScope(context.analysis, context.offset, ownerName);
  if (block) {
    const members = [...block.parameters, ...block.ports, ...block.symbols];
    if (members.length > 0) return { items: memberItems(members, context) };
  }
  return void 0;
}
function namedBlockScope(analysis, offset, name) {
  const enclosing = scopeChain(analysis, offset);
  return resolveNamedBlock(analysis, enclosing, name);
}
function memberItems(members, context) {
  return members.map((symbol) => {
    const item = {
      label: symbol.name,
      kind: toCompletionKind(symbol.category),
      detail: describeSymbol(symbol, { showWidth: true, showType: true })
    };
    if (symbol.doc) item.documentation = symbol.doc;
    applyCallable(item, symbol, context);
    return item;
  });
}
function applyCallable(item, symbol, context) {
  if (symbol.category !== "task" && symbol.category !== "function") return;
  item.detail = callableLabel(symbol);
  if (/^\w*\s*\(/.test(context.document.getText().slice(context.offset))) return;
  item.insertTextFormat = import_vscode_languageserver_types4.InsertTextFormat.Snippet;
  item.insertText = `${symbol.name}(${(symbol.arguments ?? []).map((a, i) => `\${${i + 1}:${a.name}}`).join(", ")})$0`;
  item.command = { title: "Show arguments", command: "editor.action.triggerParameterHints" };
}
var BINDING_TYPES = /* @__PURE__ */ new Set(["named_port_connection", "named_parameter_assignment"]);
function instantiationContext(context) {
  let node = nodeAtOffset(context);
  let instantiation = null;
  while (node) {
    if (node.type === "module_instantiation") {
      instantiation = node;
      break;
    }
    if (node.type === "source_file" || node.type === "module_declaration" || node.type === "interface_declaration") {
      return void 0;
    }
    node = node.parent;
  }
  if (!instantiation) return void 0;
  const typeName = instantiation.childForFieldName("instance_type")?.text;
  if (!typeName) return void 0;
  for (const binding of findBindings(instantiation)) {
    if (binding.startIndex <= context.offset && context.offset <= binding.endIndex) {
      return {
        kind: binding.type === "named_parameter_assignment" ? "parameter" : "port",
        typeName
      };
    }
  }
  return void 0;
}
function* findBindings(instantiation) {
  const stack = [instantiation];
  while (stack.length > 0) {
    const node = stack.pop();
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
function nodeAtOffset(context) {
  return nodeAt(context.analysis, context.offset);
}
function atInstantiationType(context, scope) {
  if (!scope) return false;
  const node = nodeAtOffset(context);
  if (!node) return false;
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "module_instantiation") {
    return parent.childForFieldName("instance_type")?.id === node.id;
  }
  return false;
}
function dedupe(items) {
  const seen = /* @__PURE__ */ new Map();
  for (const item of items) {
    const existing2 = seen.get(item.label);
    if (!existing2 || (item.sortText ?? "") < (existing2.sortText ?? "")) {
      seen.set(item.label, item);
    }
  }
  return [...seen.values()];
}
function shortUri2(uri) {
  const parts = uri.split(/[\\/]/);
  return parts.slice(-2).join("/");
}

// src/server/providers/diagnostics.ts
var import_vscode_languageserver_types5 = require("vscode-languageserver-types");
var BUILTIN_NAMES = /* @__PURE__ */ new Set([
  "this",
  "super",
  "null",
  "rand",
  "randc",
  "local",
  "protected",
  "static",
  "automatic",
  "void",
  "error",
  "warning",
  "info",
  "fatal",
  "assert",
  "cover",
  "default",
  "disable",
  "fork",
  "join",
  "join_any",
  "join_none",
  "program",
  "time",
  "string",
  "real",
  "realtime",
  "integer",
  "genvar",
  "edge"
]);
var PREPROCESSOR_PARENTS = /* @__PURE__ */ new Set([
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
  "list_of_formal_arguments"
]);
var ASSIGNMENT_TYPES2 = /* @__PURE__ */ new Set([
  "blocking_assignment",
  "nonblocking_assignment",
  "net_assignment",
  "operator_assignment"
]);
var STATEMENT_WRAPPERS = /* @__PURE__ */ new Set(["statement", "statement_item", "statement_or_null"]);
var SEVERITY = {
  error: import_vscode_languageserver_types5.DiagnosticSeverity.Error,
  warning: import_vscode_languageserver_types5.DiagnosticSeverity.Warning,
  info: import_vscode_languageserver_types5.DiagnosticSeverity.Information,
  hint: import_vscode_languageserver_types5.DiagnosticSeverity.Hint
};
function computeDiagnostics(document, analysis, catalog, settings, includes) {
  if (!settings.enable) return [];
  const diagnostics = [];
  const tree = analysis.parseTree;
  const included = includes ? new Map(
    includedDeclarations(document.uri.toString(), catalog, includes).map((entry) => [
      entry.symbol.name,
      entry
    ])
  ) : void 0;
  const env = buildEnv(analysis);
  const assignedIn = /* @__PURE__ */ new Map();
  for (const node of iterate2(tree.rootNode)) {
    if ((node.type === "ERROR" || node.isMissing) && !causedByMacro(node)) {
      diagnostics.push(syntaxDiagnostic(node));
    }
    if (isSequentialBlock(node) || isCombinational(node)) {
      collectAssignments(node, assignedIn);
    }
    if (ASSIGNMENT_TYPES2.has(node.type) && settings.widthMismatch) {
      const diagnostic = widthDiagnostic(node, env);
      if (diagnostic) diagnostics.push(diagnostic);
    }
    if (node.type === "simple_identifier" && settings.unknownIdentifiers) {
      const diagnostic = unknownDiagnostic(
        analysis,
        node,
        catalog,
        document.uri.toString(),
        included
      );
      if (diagnostic) diagnostics.push(diagnostic);
    }
    if (settings.blockingInSequential && isSequentialBlock(node)) {
      const inner = firstBlockingAssignment(node);
      if (inner) {
        diagnostics.push({
          severity: SEVERITY.warning,
          range: nodeRange(inner),
          message: "Blocking assignment (=) inside always_ff infers race-prone logic; use non-blocking (<=).",
          source: "svision",
          code: "sequential-blocking"
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
function assignmentParts(node) {
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
function mentionsIdentifier(node, name) {
  for (const inner of iterate2(node)) {
    if (inner.type === "simple_identifier" && inner.text === name) return true;
  }
  return false;
}
function lvalueName2(node) {
  if (!node) return void 0;
  if (node.type === "simple_identifier") return node.text;
  if (node.type === "hierarchical_identifier") return lvalueName2(node.namedChild(0) ?? null);
  if (node.type === "select" || node.type === "bit_select" || node.type === "part_select_range" || node.type === "variable_lvalue" || node.type === "net_lvalue" || node.type === "primary") {
    return lvalueName2(node.namedChildren[0] ?? null);
  }
  return void 0;
}
function assignedNamesWithin(node) {
  const names = /* @__PURE__ */ new Set();
  for (const inner of iterate2(node)) {
    if (!ASSIGNMENT_TYPES2.has(inner.type)) continue;
    const name = lvalueName2(assignmentParts(inner).left);
    if (name) names.add(name);
  }
  return names;
}
function firstBlockingAssignment(node) {
  for (const inner of iterate2(node)) {
    if (inner.type === "blocking_assignment") return inner;
  }
  return void 0;
}
var STRANDED_KEYWORDS = /* @__PURE__ */ new Set([
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
  "assign"
]);
var TRIVIA_TEXT = /* @__PURE__ */ new Set(["", ";", ":"]);
function causedByMacro(node) {
  const keyword = node.text.trim();
  if (!keyword || keyword.split(/\s/)[0] !== keyword) return false;
  if (!STRANDED_KEYWORDS.has(keyword)) return false;
  const parent = node.parent;
  if (!parent) return false;
  let before2 = node.previousSibling;
  while (before2 && isTrivia(before2)) before2 = before2.previousSibling;
  if (before2 && holdsMacroInvocation(before2)) return true;
  let after2 = node.nextSibling;
  while (after2 && isTrivia(after2)) after2 = after2.nextSibling;
  return after2 ? holdsMacroInvocation(after2) : false;
}
function isTrivia(node) {
  if (node.type.endsWith("_comment")) return true;
  return TRIVIA_TEXT.has(node.text.trim());
}
function holdsMacroInvocation(node) {
  if (node.type === "text_macro_usage") return true;
  for (const child of node.children) {
    if (holdsMacroInvocation(child)) return true;
  }
  return false;
}
function syntaxDiagnostic(node) {
  if (node.isMissing) {
    return {
      severity: SEVERITY.error,
      range: nodeRange(node),
      message: `Missing \`${node.type}\` before this position.`,
      source: "svision",
      code: "syntax-missing"
    };
  }
  const snippet = node.text.split("\n")[0].slice(0, 40);
  return {
    severity: SEVERITY.error,
    range: nodeRange(node),
    message: `Unexpected syntax \`${snippet}\`.`,
    source: "svision",
    code: "syntax-error"
  };
}
function widthDiagnostic(node, env) {
  const { left, right } = assignmentParts(node);
  if (!left || !right) return null;
  if (env.isHandle?.(lvalueName2(left) ?? "")) return null;
  const leftWidth = widthOf(left, env);
  const rightWidth = widthOf(right, env);
  if (leftWidth === void 0 || rightWidth === void 0) return null;
  if (leftWidth === rightWidth) return null;
  if (leftWidth >= rightWidth) return null;
  const target = lvalueName2(left);
  if (target && mentionsIdentifier(right, target)) return null;
  const name = target ?? "the target";
  const lost = rightWidth - leftWidth;
  return {
    severity: SEVERITY.warning,
    range: nodeRange(node),
    message: `Assignment truncates: '${name}' is ${pluralBits(leftWidth)} but the right-hand side is ${pluralBits(rightWidth)}. The upper ${lost} ${plural2(lost, "bit")} ${lost === 1 ? "is" : "are"} discarded.`,
    source: "svision",
    code: "width-mismatch"
  };
}
function plural2(count, word) {
  return count === 1 ? word : `${word}s`;
}
function pluralBits(count) {
  return `${count} ${plural2(count, "bit")}`;
}
function unknownDiagnostic(analysis, node, catalog, uri, included) {
  const name = node.text;
  if (name.startsWith("$")) return null;
  if (BUILTIN_NAMES.has(name)) return null;
  const whole = enclosingReference(node);
  if (whole) {
    const resolved = resolvePath(whole, analysis, catalog, uri);
    if (!resolved) {
    } else if (!resolved.missingMember) {
      return null;
    } else if (resolved.missingName === name) {
      return {
        severity: SEVERITY.warning,
        range: nodeRange(node),
        message: `Unknown member \`${name}\`. ` + (resolved.viaInterface ? "The interface" : "The scope") + ` reached through \`${whole.text.split(".")[0]}\` does not declare it.`,
        source: "svision",
        code: "unknown-identifier"
      };
    } else {
      return null;
    }
  }
  if (isStructuralPosition(node)) return null;
  if (importedMember(analysis, catalog, node.startIndex, name)) return null;
  if (included?.has(name)) return null;
  if (isDeclaredHere(analysis, name, node.startIndex)) return null;
  if (catalog.get(name)) return null;
  return {
    severity: SEVERITY.warning,
    range: nodeRange(node),
    message: `Unknown identifier \`${name}\`. It is not declared in this scope or any enclosing scope.`,
    source: "svision",
    code: "unknown-identifier"
  };
}
function sensitivityDiagnostic(node) {
  const keywordText = alwaysKeyword(node);
  if (keywordText === "always_comb" || keywordText === "always_latch" || keywordText === "always_ff") {
    return null;
  }
  if (!keywordText.startsWith("always")) return null;
  let eventControl;
  for (const inner of iterate2(node)) {
    if (inner.type === "event_control") {
      eventControl = inner;
      break;
    }
  }
  if (!eventControl) return null;
  if (eventControl.text.includes("*")) return null;
  if (eventControl.text.includes("posedge") || eventControl.text.includes("negedge")) {
    return null;
  }
  const declared = /* @__PURE__ */ new Set();
  for (const id of iterate2(eventControl)) {
    if (id.type === "simple_identifier") declared.add(id.text);
  }
  if (declared.size === 0) return null;
  const lvalues = [];
  for (const inner of iterate2(node)) {
    if (!ASSIGNMENT_TYPES2.has(inner.type)) continue;
    const { left } = assignmentParts(inner);
    if (left) lvalues.push(left);
  }
  const read = /* @__PURE__ */ new Set();
  for (const id of iterate2(node)) {
    if (id.type !== "simple_identifier") continue;
    if (isInside(id, eventControl)) continue;
    if (lvalues.some((lvalue) => isInside(id, lvalue))) continue;
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
    code: "implicit-sensitivity"
  };
}
function latchDiagnostics(node, assignedIn) {
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
      code: "latch-inference"
    }
  ];
}
function collectAssignments(node, into) {
  into.set(node.id, assignedNamesWithin(node));
}
function bodyStatements(node) {
  let body = node.namedChildren.find((c) => c.type !== "always_keyword");
  while (body && STATEMENT_WRAPPERS.has(body.type) && body.namedChildCount === 1) {
    body = body.namedChild(0);
  }
  if (!body) return [];
  if (body.type === "seq_block") return [...body.namedChildren];
  const inner = unwrapStatement(body);
  return inner ? [inner] : [body];
}
function unwrapStatement(node) {
  let current = node;
  for (let i = 0; i < 16; i++) {
    if (STATEMENT_WRAPPERS.has(current.type) && current.namedChildCount === 1) {
      current = current.namedChild(0);
      continue;
    }
    if (current.type === "seq_block") return current;
    return current;
  }
  return current;
}
function guaranteedAssignments(block) {
  let certain = null;
  for (const statement of bodyStatements(block)) {
    const names = guaranteedIn(statement);
    certain = certain === null ? names : intersect(certain, names);
  }
  return certain ?? /* @__PURE__ */ new Set();
}
function guaranteedIn(statement) {
  if (ASSIGNMENT_TYPES2.has(statement.type)) {
    const name = lvalueName2(assignmentParts(statement).left);
    return name ? /* @__PURE__ */ new Set([name]) : /* @__PURE__ */ new Set();
  }
  if (statement.type === "conditional_statement") {
    return guaranteedByConditional(statement);
  }
  if (statement.type === "case_statement") {
    return guaranteedByCase(statement);
  }
  const inner = unwrapStatement(statement);
  if (inner && inner !== statement) {
    let certain = null;
    const nested = inner.type === "seq_block" ? inner.namedChildren : [inner];
    for (const child of nested) {
      const names = guaranteedIn(child);
      certain = certain === null ? names : intersect(certain, names);
    }
    return certain ?? /* @__PURE__ */ new Set();
  }
  return /* @__PURE__ */ new Set();
}
function guaranteedByConditional(statement) {
  const arms = conditionalArms(statement);
  if (arms.length === 0) return /* @__PURE__ */ new Set();
  const last = arms[arms.length - 1];
  if (!precededByElse(statement, last.body)) return /* @__PURE__ */ new Set();
  let acc = null;
  for (const arm of arms) {
    const names = assignedNamesWithin(arm.body);
    acc = acc === null ? names : intersect(acc, names);
  }
  return acc ?? /* @__PURE__ */ new Set();
}
function conditionalArms(statement) {
  const arms = [];
  for (const child of statement.children) {
    if (child.isNamed && child.type === "statement_or_null") {
      arms.push({ body: child });
    }
  }
  return arms;
}
function guaranteedByCase(statement) {
  const items = statement.namedChildren.filter((c) => c.type === "case_item");
  if (items.length === 0) return /* @__PURE__ */ new Set();
  const hasDefault = items.some(
    (item) => item.children.some((k) => !k.isNamed && (k.type === "default" || k.type === "default:"))
  );
  if (!hasDefault) return /* @__PURE__ */ new Set();
  let acc = null;
  for (const item of items) {
    const names = assignedNamesWithin(item);
    acc = acc === null ? names : intersect(acc, names);
  }
  return acc ?? /* @__PURE__ */ new Set();
}
function precededByElse(parent, child) {
  const index = parent.children.findIndex((c) => c.id === child.id);
  if (index <= 0) return false;
  const previous = parent.children[index - 1];
  return !previous.isNamed && previous.type === "else";
}
function isInside(node, ancestor) {
  let current = node;
  while (current) {
    if (current.id === ancestor.id) return true;
    current = current.parent;
  }
  return false;
}
function intersect(a, b) {
  const out = /* @__PURE__ */ new Set();
  for (const value of a) {
    if (b.has(value)) out.add(value);
  }
  return out;
}
function alwaysKeyword(node) {
  return node.namedChildren.find((c) => c.type === "always_keyword")?.text.trim() ?? "";
}
function isSequentialBlock(node) {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_ff";
}
function isCombinational(node) {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_comb";
}
function* iterate2(root) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    yield node;
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
}
function nodeRange(node) {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column }
  };
}
function isStructuralPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "enum_name_declaration") return true;
  if (parent.type === "package_declaration" || parent.type === "module_declaration" || parent.type === "interface_declaration") {
    return true;
  }
  if (PREPROCESSOR_PARENTS.has(parent.type)) return true;
  if (parent.type.endsWith("_directive") || parent.type.endsWith("_condition")) return true;
  if (parent.type.endsWith("_header")) return true;
  if (parent.type === "hierarchical_identifier" && parent.namedChild(0)?.id !== node.id) return true;
  if (parent.type === "scoped_identifier" || parent.type === "class_type") return true;
  if (parent.type === "package_import_item" || parent.type === "package_scope") return true;
  if (parent.type === "module_instantiation" && parent.childForFieldName("instance_type")?.id === node.id) {
    return true;
  }
  if (parent.type === "name_of_instance" || parent.type === "simple_identifier_with_escaped_id") {
    return true;
  }
  if (parent.type === "named_port_connection" || parent.type === "named_parameter_assignment") return true;
  if (parent.type === "cast" || parent.type === "signing" || parent.type === "data_type") return true;
  if (parent.type === "assignment_pattern_expression") return true;
  return false;
}
function insideHierarchicalIdentifier(node) {
  let current = node;
  while (current) {
    if (current.type === "hierarchical_identifier") {
      const segments = current.namedChildren.filter(
        (c) => c.type === "simple_identifier" || c.type === "select"
      ).length;
      if (segments > 1) return true;
    }
    current = current.parent;
  }
  return false;
}
function isDeclaredHere(analysis, name, offset) {
  if (visibleSymbols(analysis, offset).some((s) => s.name === name)) return true;
  const chain = scopeChain(analysis, offset);
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i];
    if (scope.instances.some((instance) => instance.instanceName === name)) return true;
  }
  return false;
}
function buildEnv(analysis) {
  const paramValues = /* @__PURE__ */ new Map();
  const widths = /* @__PURE__ */ new Map();
  const handles = /* @__PURE__ */ new Set();
  for (const scope of analysis.scopes) {
    for (const param of scope.parameters) {
      if (param.resolvedValue !== void 0) paramValues.set(param.name, param.resolvedValue);
    }
    for (const port of scope.ports) {
      if (port.packedWidth !== void 0) widths.set(port.name, port.packedWidth);
    }
    for (const symbol of scope.symbols) {
      if (symbol.resolvedValue !== void 0) paramValues.set(symbol.name, symbol.resolvedValue);
      if (symbol.packedWidth !== void 0) widths.set(symbol.name, symbol.packedWidth);
      if (symbol.handleOf) handles.add(symbol.name);
    }
  }
  return {
    lookup: (name) => paramValues.get(name),
    symbolWidth: (name) => widths.get(name),
    isHandle: (name) => handles.has(name)
  };
}
function dedupeDiagnostics(diagnostics) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const d of diagnostics) {
    const key = `${d.range.start.line}:${d.range.start.character}:${d.code ?? ""}:${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out.sort(
    (a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character
  );
}

// test/callables.test.ts
var parser;
(0, import_node_test.before)(async () => {
  parser = await VerilogParser.create();
});
(0, import_node_test.after)(() => parser.dispose());
var IFACE = `interface bus_if(input logic clk);
 logic [7:0] data;
 modport sink(input data);
 task automatic drive(input int count, output logic done); done = count > 0; endtask
endinterface`;
var CLASS = `class dsp_test;
 virtual bus_if vif;
 int amplitude;
 extern task generate_triangle_wave(input int count, output int result);
 extern function int calculate(input int x);
endclass`;
var BODY = `task automatic dsp_test::generate_triangle_wave(input int count, output int result);
 int sum;
 for (int i=0; i<count; i++) begin sum += i; end
 result = calculate(sum) + amplitude;
 vif.data = sum;
endtask
function automatic int dsp_test::calculate(input int x);
 int temp;
 temp = x + amplitude;
 return temp;
endfunction`;
async function project(source, extras = {}) {
  const root = (0, import_node_fs3.mkdtempSync)(import_node_path4.default.join((0, import_node_os.tmpdir)(), "svision-callables-"));
  const files = { "interfaces/bus_if.sv": IFACE, "headers/dsp_test.svh": CLASS, "bodies/triangle.sv": BODY, ...extras, "rtl/use.sv": source };
  for (const [file, text] of Object.entries(files)) {
    const full = import_node_path4.default.join(root, file);
    (0, import_node_fs3.mkdirSync)(import_node_path4.default.dirname(full), { recursive: true });
    (0, import_node_fs3.writeFileSync)(full, text);
  }
  const catalog = new Catalog();
  const indexer = new WorkspaceIndexer(parser, catalog);
  await indexer.indexFolders([root]);
  const uri = pathToUri(import_node_path4.default.join(root, "rtl/use.sv"));
  const document = import_vscode_languageserver_textdocument.TextDocument.create(uri, "systemverilog", 1, source);
  const manager = new DocumentManager(parser);
  manager.knownClasses = () => catalog.classNames();
  const { analysis } = manager.update(uri, document);
  const at = (needle) => source.lastIndexOf(needle) + needle.length;
  const complete = (needle) => provideCompletion(
    completionContext(document, analysis, at(needle)),
    manager,
    catalog,
    { showWidth: true, showType: true, snippets: true, systemFunctions: false, includeParameters: true },
    indexer.includes
  ).items;
  return { root, uri, document, analysis, catalog, indexer, manager, at, complete };
}
(0, import_node_test.it)("resolves cross-file interface ports, modports and instance members without includes", async () => {
  const p = await project(`module use_it(bus_if.sink bus);
 bus_if actual();
 initial begin bus.data = actual.data; end
endmodule`);
  for (const needle of ["bus.data", "actual.data"]) {
    const target = provideDefinition(p.document, p.analysis, p.catalog, p.at(needle) - 1);
    import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "interfaces/bus_if.sv")));
  }
  import_strict.default.ok(p.complete("bus.").some((i) => i.label === "data"));
  import_strict.default.ok(p.complete("actual.").some((i) => i.label === "drive"));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("reads extern prototypes with ordered arguments and return types", async () => {
  const p = await project("module m; endmodule");
  const members = p.catalog.classMembers("dsp_test");
  import_strict.default.deepEqual(members.find((s) => s.name === "generate_triangle_wave")?.arguments?.map((a) => a.name), ["count", "result"]);
  import_strict.default.equal(members.find((s) => s.name === "calculate")?.typeText, "int");
  p.manager.close(p.uri);
});
(0, import_node_test.it)("resolves class fields, sibling methods and virtual interfaces inside out-of-block bodies", async () => {
  const p = await project(BODY);
  const diagnostics = computeDiagnostics(p.document, p.analysis, p.catalog, {
    enable: true,
    unknownIdentifiers: true,
    widthMismatch: false,
    blockingInSequential: false,
    implicitSensitivity: false,
    latchDetection: false
  });
  import_strict.default.deepEqual(diagnostics.map((d) => d.message), []);
  const definition = provideDefinition(p.document, p.analysis, p.catalog, p.at("calculate(sum") - 5);
  import_strict.default.ok(definition);
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("vif.data") - 1);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "interfaces/bus_if.sv")));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("exposes prototype arguments when an external implementation omits them", async () => {
  const p = await project("task automatic dsp_test::generate_triangle_wave(); result = count; endtask");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("count") - 1);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "headers/dsp_test.svh")));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("keeps local declarations and for variables in task/function bodies", async () => {
  const tree = parser.parse(BODY);
  const analysis = analyzeTree(tree, BODY);
  import_strict.default.deepEqual(analysis.scopes.find((s) => s.category === "task")?.symbols.map((s) => s.name), ["sum", "i"]);
  import_strict.default.ok(analysis.scopes.find((s) => s.category === "function")?.symbols.some((s) => s.name === "temp"));
  tree.delete();
});
(0, import_node_test.it)("reads non-ANSI task arguments and inherited ANSI argument types", async () => {
  const source = `task old_style; input int a,b; output logic [7:0] q; q=a+b; endtask
function int add(input int a,b); return a+b; endfunction`;
  const tree = parser.parse(source);
  const analysis = analyzeTree(tree, source);
  import_strict.default.deepEqual(analysis.unitSymbols.find((s) => s.name === "old_style")?.arguments?.map((a) => a.name), ["a", "b", "q"]);
  import_strict.default.deepEqual(analysis.unitSymbols.find((s) => s.name === "add")?.arguments?.map((a) => a.typeText), ["int", "int"]);
  tree.delete();
});
(0, import_node_test.it)("completes external class, interface and free routines with argument placeholders", async () => {
  const p = await project(`module m(bus_if bus);
 initial begin dsp_test::generate_triangle_wave(1, 2); bus.drive(1, ready); helper(3); end
endmodule`, { "helpers/helper.sv": "function int helper(input int value); return value; endfunction" });
  import_strict.default.match(p.complete("dsp_test::generate_triangle_wave").find((i) => i.label === "generate_triangle_wave")?.detail ?? "", /input int count/);
  import_strict.default.match(p.complete("bus.drive").find((i) => i.label === "drive")?.detail ?? "", /output logic done/);
  const helper = p.complete("helper").find((i) => i.label === "helper");
  import_strict.default.ok(helper);
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("helper") - 1);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "helpers/helper.sv")));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("inserts callable snippets and shows the active argument while typing", async () => {
  const p = await project(`module m; initial dsp_test::generate_triangle_wave; endmodule`);
  const item = p.complete("dsp_test::generate_triangle_wave").find((i) => i.label === "generate_triangle_wave");
  import_strict.default.equal(item?.insertText, "generate_triangle_wave(${1:count}, ${2:result})$0");
  const text = "module m; initial dsp_test::generate_triangle_wave(3, ";
  const doc = import_vscode_languageserver_textdocument.TextDocument.create(p.uri, "systemverilog", 2, text);
  const help = provideSignatureHelp(doc, p.analysis, p.catalog, text.length);
  import_strict.default.equal(help?.activeParameter, 1);
  import_strict.default.match(help?.signatures[0]?.label ?? "", /output int result/);
  p.manager.close(p.uri);
});
(0, import_node_test.it)("offers named arguments, and signature help follows the argument name", async () => {
  const text = "module m; initial dsp_test::generate_triangle_wave(.res";
  const p = await project(text);
  import_strict.default.ok(p.complete(".res").some((i) => i.label === "result"));
  const named = text.replace(".res", ".result(");
  const doc = import_vscode_languageserver_textdocument.TextDocument.create(p.uri, "systemverilog", 2, named);
  import_strict.default.equal(provideSignatureHelp(doc, p.analysis, p.catalog, named.length)?.activeParameter, 1);
  p.manager.close(p.uri);
});
(0, import_node_test.it)("counts only top-level commas in calls", () => {
  import_strict.default.equal(callAt('f(g(1, 2), {a,b}, "c,d", ', 27)?.argument, 3);
  const text = "f(a /* , */, // ,\n b, ";
  import_strict.default.equal(callAt(text, text.length)?.argument, 2);
});
(0, import_node_test.it)("resolves imported package routines and shows argument defaults", async () => {
  const p = await project(`module m; import math_pkg::*; initial scale(2, 3); endmodule`, {
    "packages/math.sv": `package math_pkg;
 function automatic int scale(input int value, input int gain=4); return value*gain; endfunction
endpackage`
  });
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("scale") - 1);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "packages/math.sv")));
  const help = provideSignatureHelp(p.document, p.analysis, p.catalog, p.at("scale(2, "));
  import_strict.default.equal(help?.activeParameter, 1);
  import_strict.default.match(help?.signatures[0]?.label ?? "", /gain = 4/);
  const hover = provideHover(p.document, p.analysis, p.catalog, p.at("scale") - 1, { showType: true, showWidth: true });
  import_strict.default.match(JSON.stringify(hover), /input int value/);
  p.manager.close(p.uri);
});
(0, import_node_test.it)("makes included free tasks callable from another file", async () => {
  const p = await project('`include "../helpers/drive.svh"\nmodule m; initial pulse(1); endmodule', {
    "helpers/drive.svh": "task automatic pulse(input int cycles); int remaining; remaining=cycles; endtask"
  });
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("pulse") - 1, p.indexer.includes);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "helpers/drive.svh")));
  import_strict.default.match(p.complete("pulse").find((i) => i.label === "pulse")?.detail ?? "", /cycles/);
  p.manager.close(p.uri);
});
(0, import_node_test.it)("keeps declarations local to the task rather than leaking them to its caller", async () => {
  const p = await project(`module m;
 task work(input int argument); int only_here; only_here=argument; endtask
 initial work(1);
endmodule`);
  import_strict.default.ok(!p.complete("work(1)").some((i) => i.label === "only_here" || i.label === "argument"));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("resolves inherited methods to the file declaring them and prefers overrides", async () => {
  const p = await project(`class Derived extends Base;
 function int value(input int local_arg); return local_arg; endfunction
endclass
module m; Derived obj; initial obj.base_task(1); endmodule`, {
    "base/base.sv": "class Base; task base_task(input int cycles); endtask function int value(input int x); return x; endfunction endclass"
  });
  import_strict.default.equal(p.catalog.classMembers("Derived").find((s) => s.name === "value")?.arguments?.[0]?.name, "local_arg");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("obj.base_task") - 1);
  import_strict.default.ok(target, "an inherited task call must resolve");
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "base/base.sv")));
  p.manager.close(p.uri);
});
(0, import_node_test.it)("follows this through a virtual interface in an external method body", async () => {
  const p = await project("task dsp_test::generate_triangle_wave(); this.vif.data = count; endtask");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("this.vif.data") - 1);
  import_strict.default.ok(target);
  import_strict.default.equal(target.uri, pathToUri(import_node_path4.default.join(p.root, "interfaces/bus_if.sv")));
  p.manager.close(p.uri);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vdGVzdC9jYWxsYWJsZXMudGVzdC50cyIsICIuLi9zcmMvc2VydmVyL3Zlcmlsb2dQYXJzZXIudHMiLCAiLi4vc3JjL3NlcnZlci9ldmFsLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvdHJlZXMudHMiLCAiLi4vc3JjL3NlcnZlci9zaWduYWxBY2Nlc3MudHMiLCAiLi4vc3JjL3NlcnZlci9pbmNsdWRlcy50cyIsICIuLi9zcmMvc2VydmVyL3BhdGhzLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvbWFjcm9zLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvYW5hbHl6ZXIudHMiLCAiLi4vc3JjL3NlcnZlci9jYXRhbG9nLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvd29ya3NwYWNlSW5kZXgudHMiLCAiLi4vc3JjL3NlcnZlci9kb2N1bWVudE1hbmFnZXIudHMiLCAiLi4vc3JjL3NlcnZlci9wcm92aWRlcnMvZGVmaW5pdGlvbi50cyIsICIuLi9zcmMvc2VydmVyL21vZGVsLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvbG9jYXRlLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvaW1wb3J0cy50cyIsICIuLi9zcmMvc2VydmVyL2hpZXJhcmNoeS50cyIsICIuLi9zcmMvc2VydmVyL3N5bWJvbEZvcm1hdHRpbmcudHMiLCAiLi4vc3JjL3NlcnZlci9wcm92aWRlcnMvaG92ZXIudHMiLCAiLi4vc3JjL3NlcnZlci9wcm92aWRlcnMvY29tcGxldGlvbi50cyIsICIuLi9zcmMvc2VydmVyL2NvbXBsZXRpb25EYXRhLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvY2FsbGFibGVzLnRzIiwgIi4uL3NyYy9zZXJ2ZXIvcHJvdmlkZXJzL2RpYWdub3N0aWNzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgYXNzZXJ0IGZyb20gXCJub2RlOmFzc2VydC9zdHJpY3RcIjtcbmltcG9ydCB7IG1rZGlyU3luYywgbWtkdGVtcFN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgdG1wZGlyIH0gZnJvbSBcIm5vZGU6b3NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGJlZm9yZSwgYWZ0ZXIsIGl0IH0gZnJvbSBcIm5vZGU6dGVzdFwiO1xuaW1wb3J0IHsgVGV4dERvY3VtZW50IH0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10ZXh0ZG9jdW1lbnRcIjtcbmltcG9ydCB7IFZlcmlsb2dQYXJzZXIgfSBmcm9tIFwiLi4vc3JjL3NlcnZlci92ZXJpbG9nUGFyc2VyLmpzXCI7XG5pbXBvcnQgeyBhbmFseXplVHJlZSB9IGZyb20gXCIuLi9zcmMvc2VydmVyL2FuYWx5emVyLmpzXCI7XG5pbXBvcnQgeyBDYXRhbG9nIH0gZnJvbSBcIi4uL3NyYy9zZXJ2ZXIvY2F0YWxvZy5qc1wiO1xuaW1wb3J0IHsgV29ya3NwYWNlSW5kZXhlciwgcGF0aFRvVXJpIH0gZnJvbSBcIi4uL3NyYy9zZXJ2ZXIvd29ya3NwYWNlSW5kZXguanNcIjtcbmltcG9ydCB7IERvY3VtZW50TWFuYWdlciB9IGZyb20gXCIuLi9zcmMvc2VydmVyL2RvY3VtZW50TWFuYWdlci5qc1wiO1xuaW1wb3J0IHsgcHJvdmlkZURlZmluaXRpb24gfSBmcm9tIFwiLi4vc3JjL3NlcnZlci9wcm92aWRlcnMvZGVmaW5pdGlvbi5qc1wiO1xuaW1wb3J0IHsgcHJvdmlkZUhvdmVyIH0gZnJvbSBcIi4uL3NyYy9zZXJ2ZXIvcHJvdmlkZXJzL2hvdmVyLmpzXCI7XG5pbXBvcnQgeyBjb21wbGV0aW9uQ29udGV4dCwgcHJvdmlkZUNvbXBsZXRpb24gfSBmcm9tIFwiLi4vc3JjL3NlcnZlci9wcm92aWRlcnMvY29tcGxldGlvbi5qc1wiO1xuaW1wb3J0IHsgY29tcHV0ZURpYWdub3N0aWNzIH0gZnJvbSBcIi4uL3NyYy9zZXJ2ZXIvcHJvdmlkZXJzL2RpYWdub3N0aWNzLmpzXCI7XG5pbXBvcnQgeyBwcm92aWRlU2lnbmF0dXJlSGVscCwgY2FsbEF0IH0gZnJvbSBcIi4uL3NyYy9zZXJ2ZXIvY2FsbGFibGVzLmpzXCI7XG5cbmxldCBwYXJzZXI6IFZlcmlsb2dQYXJzZXI7XG5iZWZvcmUoYXN5bmMgKCkgPT4geyBwYXJzZXIgPSBhd2FpdCBWZXJpbG9nUGFyc2VyLmNyZWF0ZSgpOyB9KTtcbmFmdGVyKCgpID0+IHBhcnNlci5kaXNwb3NlKCkpO1xuXG5jb25zdCBJRkFDRSA9IGBpbnRlcmZhY2UgYnVzX2lmKGlucHV0IGxvZ2ljIGNsayk7XG4gbG9naWMgWzc6MF0gZGF0YTtcbiBtb2Rwb3J0IHNpbmsoaW5wdXQgZGF0YSk7XG4gdGFzayBhdXRvbWF0aWMgZHJpdmUoaW5wdXQgaW50IGNvdW50LCBvdXRwdXQgbG9naWMgZG9uZSk7IGRvbmUgPSBjb3VudCA+IDA7IGVuZHRhc2tcbmVuZGludGVyZmFjZWA7XG5jb25zdCBDTEFTUyA9IGBjbGFzcyBkc3BfdGVzdDtcbiB2aXJ0dWFsIGJ1c19pZiB2aWY7XG4gaW50IGFtcGxpdHVkZTtcbiBleHRlcm4gdGFzayBnZW5lcmF0ZV90cmlhbmdsZV93YXZlKGlucHV0IGludCBjb3VudCwgb3V0cHV0IGludCByZXN1bHQpO1xuIGV4dGVybiBmdW5jdGlvbiBpbnQgY2FsY3VsYXRlKGlucHV0IGludCB4KTtcbmVuZGNsYXNzYDtcbmNvbnN0IEJPRFkgPSBgdGFzayBhdXRvbWF0aWMgZHNwX3Rlc3Q6OmdlbmVyYXRlX3RyaWFuZ2xlX3dhdmUoaW5wdXQgaW50IGNvdW50LCBvdXRwdXQgaW50IHJlc3VsdCk7XG4gaW50IHN1bTtcbiBmb3IgKGludCBpPTA7IGk8Y291bnQ7IGkrKykgYmVnaW4gc3VtICs9IGk7IGVuZFxuIHJlc3VsdCA9IGNhbGN1bGF0ZShzdW0pICsgYW1wbGl0dWRlO1xuIHZpZi5kYXRhID0gc3VtO1xuZW5kdGFza1xuZnVuY3Rpb24gYXV0b21hdGljIGludCBkc3BfdGVzdDo6Y2FsY3VsYXRlKGlucHV0IGludCB4KTtcbiBpbnQgdGVtcDtcbiB0ZW1wID0geCArIGFtcGxpdHVkZTtcbiByZXR1cm4gdGVtcDtcbmVuZGZ1bmN0aW9uYDtcblxuYXN5bmMgZnVuY3Rpb24gcHJvamVjdChzb3VyY2U6IHN0cmluZywgZXh0cmFzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30pIHtcbiAgY29uc3Qgcm9vdCA9IG1rZHRlbXBTeW5jKHBhdGguam9pbih0bXBkaXIoKSwgXCJzdmlzaW9uLWNhbGxhYmxlcy1cIikpO1xuICBjb25zdCBmaWxlcyA9IHsgXCJpbnRlcmZhY2VzL2J1c19pZi5zdlwiOiBJRkFDRSwgXCJoZWFkZXJzL2RzcF90ZXN0LnN2aFwiOiBDTEFTUywgXCJib2RpZXMvdHJpYW5nbGUuc3ZcIjogQk9EWSwgLi4uZXh0cmFzLCBcInJ0bC91c2Uuc3ZcIjogc291cmNlIH07XG4gIGZvciAoY29uc3QgW2ZpbGUsIHRleHRdIG9mIE9iamVjdC5lbnRyaWVzKGZpbGVzKSkge1xuICAgIGNvbnN0IGZ1bGwgPSBwYXRoLmpvaW4ocm9vdCwgZmlsZSk7XG4gICAgbWtkaXJTeW5jKHBhdGguZGlybmFtZShmdWxsKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgd3JpdGVGaWxlU3luYyhmdWxsLCB0ZXh0KTtcbiAgfVxuICBjb25zdCBjYXRhbG9nID0gbmV3IENhdGFsb2coKTtcbiAgY29uc3QgaW5kZXhlciA9IG5ldyBXb3Jrc3BhY2VJbmRleGVyKHBhcnNlciwgY2F0YWxvZyk7XG4gIGF3YWl0IGluZGV4ZXIuaW5kZXhGb2xkZXJzKFtyb290XSk7XG4gIGNvbnN0IHVyaSA9IHBhdGhUb1VyaShwYXRoLmpvaW4ocm9vdCwgXCJydGwvdXNlLnN2XCIpKTtcbiAgY29uc3QgZG9jdW1lbnQgPSBUZXh0RG9jdW1lbnQuY3JlYXRlKHVyaSwgXCJzeXN0ZW12ZXJpbG9nXCIsIDEsIHNvdXJjZSk7XG4gIGNvbnN0IG1hbmFnZXIgPSBuZXcgRG9jdW1lbnRNYW5hZ2VyKHBhcnNlcik7XG4gIG1hbmFnZXIua25vd25DbGFzc2VzID0gKCkgPT4gY2F0YWxvZy5jbGFzc05hbWVzKCk7XG4gIGNvbnN0IHsgYW5hbHlzaXMgfSA9IG1hbmFnZXIudXBkYXRlKHVyaSwgZG9jdW1lbnQpO1xuICBjb25zdCBhdCA9IChuZWVkbGU6IHN0cmluZykgPT4gc291cmNlLmxhc3RJbmRleE9mKG5lZWRsZSkgKyBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBjb21wbGV0ZSA9IChuZWVkbGU6IHN0cmluZykgPT4gcHJvdmlkZUNvbXBsZXRpb24oXG4gICAgY29tcGxldGlvbkNvbnRleHQoZG9jdW1lbnQsIGFuYWx5c2lzLCBhdChuZWVkbGUpKSwgbWFuYWdlciwgY2F0YWxvZyxcbiAgICB7IHNob3dXaWR0aDogdHJ1ZSwgc2hvd1R5cGU6IHRydWUsIHNuaXBwZXRzOiB0cnVlLCBzeXN0ZW1GdW5jdGlvbnM6IGZhbHNlLCBpbmNsdWRlUGFyYW1ldGVyczogdHJ1ZSB9LCBpbmRleGVyLmluY2x1ZGVzLFxuICApLml0ZW1zO1xuICByZXR1cm4geyByb290LCB1cmksIGRvY3VtZW50LCBhbmFseXNpcywgY2F0YWxvZywgaW5kZXhlciwgbWFuYWdlciwgYXQsIGNvbXBsZXRlIH07XG59XG5cbml0KFwicmVzb2x2ZXMgY3Jvc3MtZmlsZSBpbnRlcmZhY2UgcG9ydHMsIG1vZHBvcnRzIGFuZCBpbnN0YW5jZSBtZW1iZXJzIHdpdGhvdXQgaW5jbHVkZXNcIiwgYXN5bmMgKCkgPT4ge1xuICBjb25zdCBwID0gYXdhaXQgcHJvamVjdChgbW9kdWxlIHVzZV9pdChidXNfaWYuc2luayBidXMpO1xuIGJ1c19pZiBhY3R1YWwoKTtcbiBpbml0aWFsIGJlZ2luIGJ1cy5kYXRhID0gYWN0dWFsLmRhdGE7IGVuZFxuZW5kbW9kdWxlYCk7XG4gIGZvciAoY29uc3QgbmVlZGxlIG9mIFtcImJ1cy5kYXRhXCIsIFwiYWN0dWFsLmRhdGFcIl0pIHtcbiAgICBjb25zdCB0YXJnZXQgPSBwcm92aWRlRGVmaW5pdGlvbihwLmRvY3VtZW50LCBwLmFuYWx5c2lzLCBwLmNhdGFsb2csIHAuYXQobmVlZGxlKSAtIDEpIGFzIHsgdXJpOiBzdHJpbmcgfTtcbiAgICBhc3NlcnQuZXF1YWwodGFyZ2V0LnVyaSwgcGF0aFRvVXJpKHBhdGguam9pbihwLnJvb3QsIFwiaW50ZXJmYWNlcy9idXNfaWYuc3ZcIikpKTtcbiAgfVxuICBhc3NlcnQub2socC5jb21wbGV0ZShcImJ1cy5cIikuc29tZSgoaSkgPT4gaS5sYWJlbCA9PT0gXCJkYXRhXCIpKTtcbiAgYXNzZXJ0Lm9rKHAuY29tcGxldGUoXCJhY3R1YWwuXCIpLnNvbWUoKGkpID0+IGkubGFiZWwgPT09IFwiZHJpdmVcIikpO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG5cbml0KFwicmVhZHMgZXh0ZXJuIHByb3RvdHlwZXMgd2l0aCBvcmRlcmVkIGFyZ3VtZW50cyBhbmQgcmV0dXJuIHR5cGVzXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcCA9IGF3YWl0IHByb2plY3QoXCJtb2R1bGUgbTsgZW5kbW9kdWxlXCIpO1xuICBjb25zdCBtZW1iZXJzID0gcC5jYXRhbG9nLmNsYXNzTWVtYmVycyhcImRzcF90ZXN0XCIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKG1lbWJlcnMuZmluZCgocykgPT4gcy5uYW1lID09PSBcImdlbmVyYXRlX3RyaWFuZ2xlX3dhdmVcIik/LmFyZ3VtZW50cz8ubWFwKChhKSA9PiBhLm5hbWUpLCBbXCJjb3VudFwiLCBcInJlc3VsdFwiXSk7XG4gIGFzc2VydC5lcXVhbChtZW1iZXJzLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gXCJjYWxjdWxhdGVcIik/LnR5cGVUZXh0LCBcImludFwiKTtcbiAgcC5tYW5hZ2VyLmNsb3NlKHAudXJpKTtcbn0pO1xuXG5pdChcInJlc29sdmVzIGNsYXNzIGZpZWxkcywgc2libGluZyBtZXRob2RzIGFuZCB2aXJ0dWFsIGludGVyZmFjZXMgaW5zaWRlIG91dC1vZi1ibG9jayBib2RpZXNcIiwgYXN5bmMgKCkgPT4ge1xuICBjb25zdCBwID0gYXdhaXQgcHJvamVjdChCT0RZKTtcbiAgY29uc3QgZGlhZ25vc3RpY3MgPSBjb21wdXRlRGlhZ25vc3RpY3MocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCB7XG4gICAgZW5hYmxlOiB0cnVlLCB1bmtub3duSWRlbnRpZmllcnM6IHRydWUsIHdpZHRoTWlzbWF0Y2g6IGZhbHNlLFxuICAgIGJsb2NraW5nSW5TZXF1ZW50aWFsOiBmYWxzZSwgaW1wbGljaXRTZW5zaXRpdml0eTogZmFsc2UsIGxhdGNoRGV0ZWN0aW9uOiBmYWxzZSxcbiAgfSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoZGlhZ25vc3RpY3MubWFwKChkKSA9PiBkLm1lc3NhZ2UpLCBbXSk7XG4gIGNvbnN0IGRlZmluaXRpb24gPSBwcm92aWRlRGVmaW5pdGlvbihwLmRvY3VtZW50LCBwLmFuYWx5c2lzLCBwLmNhdGFsb2csIHAuYXQoXCJjYWxjdWxhdGUoc3VtXCIpIC0gNSk7XG4gIGFzc2VydC5vayhkZWZpbml0aW9uKTtcbiAgY29uc3QgdGFyZ2V0ID0gcHJvdmlkZURlZmluaXRpb24ocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBwLmF0KFwidmlmLmRhdGFcIikgLSAxKSBhcyB7IHVyaTogc3RyaW5nIH07XG4gIGFzc2VydC5lcXVhbCh0YXJnZXQudXJpLCBwYXRoVG9VcmkocGF0aC5qb2luKHAucm9vdCwgXCJpbnRlcmZhY2VzL2J1c19pZi5zdlwiKSkpO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG5cbml0KFwiZXhwb3NlcyBwcm90b3R5cGUgYXJndW1lbnRzIHdoZW4gYW4gZXh0ZXJuYWwgaW1wbGVtZW50YXRpb24gb21pdHMgdGhlbVwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHAgPSBhd2FpdCBwcm9qZWN0KFwidGFzayBhdXRvbWF0aWMgZHNwX3Rlc3Q6OmdlbmVyYXRlX3RyaWFuZ2xlX3dhdmUoKTsgcmVzdWx0ID0gY291bnQ7IGVuZHRhc2tcIik7XG4gIGNvbnN0IHRhcmdldCA9IHByb3ZpZGVEZWZpbml0aW9uKHAuZG9jdW1lbnQsIHAuYW5hbHlzaXMsIHAuY2F0YWxvZywgcC5hdChcImNvdW50XCIpIC0gMSkgYXMgeyB1cmk6IHN0cmluZyB9O1xuICBhc3NlcnQuZXF1YWwodGFyZ2V0LnVyaSwgcGF0aFRvVXJpKHBhdGguam9pbihwLnJvb3QsIFwiaGVhZGVycy9kc3BfdGVzdC5zdmhcIikpKTtcbiAgcC5tYW5hZ2VyLmNsb3NlKHAudXJpKTtcbn0pO1xuXG5pdChcImtlZXBzIGxvY2FsIGRlY2xhcmF0aW9ucyBhbmQgZm9yIHZhcmlhYmxlcyBpbiB0YXNrL2Z1bmN0aW9uIGJvZGllc1wiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHRyZWUgPSBwYXJzZXIucGFyc2UoQk9EWSk7XG4gIGNvbnN0IGFuYWx5c2lzID0gYW5hbHl6ZVRyZWUodHJlZSwgQk9EWSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYW5hbHlzaXMuc2NvcGVzLmZpbmQoKHMpID0+IHMuY2F0ZWdvcnkgPT09IFwidGFza1wiKT8uc3ltYm9scy5tYXAoKHMpID0+IHMubmFtZSksIFtcInN1bVwiLCBcImlcIl0pO1xuICBhc3NlcnQub2soYW5hbHlzaXMuc2NvcGVzLmZpbmQoKHMpID0+IHMuY2F0ZWdvcnkgPT09IFwiZnVuY3Rpb25cIik/LnN5bWJvbHMuc29tZSgocykgPT4gcy5uYW1lID09PSBcInRlbXBcIikpO1xuICB0cmVlLmRlbGV0ZSgpO1xufSk7XG5cbml0KFwicmVhZHMgbm9uLUFOU0kgdGFzayBhcmd1bWVudHMgYW5kIGluaGVyaXRlZCBBTlNJIGFyZ3VtZW50IHR5cGVzXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3Qgc291cmNlID0gYHRhc2sgb2xkX3N0eWxlOyBpbnB1dCBpbnQgYSxiOyBvdXRwdXQgbG9naWMgWzc6MF0gcTsgcT1hK2I7IGVuZHRhc2tcbmZ1bmN0aW9uIGludCBhZGQoaW5wdXQgaW50IGEsYik7IHJldHVybiBhK2I7IGVuZGZ1bmN0aW9uYDtcbiAgY29uc3QgdHJlZSA9IHBhcnNlci5wYXJzZShzb3VyY2UpO1xuICBjb25zdCBhbmFseXNpcyA9IGFuYWx5emVUcmVlKHRyZWUsIHNvdXJjZSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYW5hbHlzaXMudW5pdFN5bWJvbHMuZmluZCgocykgPT4gcy5uYW1lID09PSBcIm9sZF9zdHlsZVwiKT8uYXJndW1lbnRzPy5tYXAoKGEpID0+IGEubmFtZSksIFtcImFcIiwgXCJiXCIsIFwicVwiXSk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYW5hbHlzaXMudW5pdFN5bWJvbHMuZmluZCgocykgPT4gcy5uYW1lID09PSBcImFkZFwiKT8uYXJndW1lbnRzPy5tYXAoKGEpID0+IGEudHlwZVRleHQpLCBbXCJpbnRcIiwgXCJpbnRcIl0pO1xuICB0cmVlLmRlbGV0ZSgpO1xufSk7XG5cbml0KFwiY29tcGxldGVzIGV4dGVybmFsIGNsYXNzLCBpbnRlcmZhY2UgYW5kIGZyZWUgcm91dGluZXMgd2l0aCBhcmd1bWVudCBwbGFjZWhvbGRlcnNcIiwgYXN5bmMgKCkgPT4ge1xuICBjb25zdCBwID0gYXdhaXQgcHJvamVjdChgbW9kdWxlIG0oYnVzX2lmIGJ1cyk7XG4gaW5pdGlhbCBiZWdpbiBkc3BfdGVzdDo6Z2VuZXJhdGVfdHJpYW5nbGVfd2F2ZSgxLCAyKTsgYnVzLmRyaXZlKDEsIHJlYWR5KTsgaGVscGVyKDMpOyBlbmRcbmVuZG1vZHVsZWAsIHsgXCJoZWxwZXJzL2hlbHBlci5zdlwiOiBcImZ1bmN0aW9uIGludCBoZWxwZXIoaW5wdXQgaW50IHZhbHVlKTsgcmV0dXJuIHZhbHVlOyBlbmRmdW5jdGlvblwiIH0pO1xuICBhc3NlcnQubWF0Y2gocC5jb21wbGV0ZShcImRzcF90ZXN0OjpnZW5lcmF0ZV90cmlhbmdsZV93YXZlXCIpLmZpbmQoKGkpID0+IGkubGFiZWwgPT09IFwiZ2VuZXJhdGVfdHJpYW5nbGVfd2F2ZVwiKT8uZGV0YWlsID8/IFwiXCIsIC9pbnB1dCBpbnQgY291bnQvKTtcbiAgYXNzZXJ0Lm1hdGNoKHAuY29tcGxldGUoXCJidXMuZHJpdmVcIikuZmluZCgoaSkgPT4gaS5sYWJlbCA9PT0gXCJkcml2ZVwiKT8uZGV0YWlsID8/IFwiXCIsIC9vdXRwdXQgbG9naWMgZG9uZS8pO1xuICBjb25zdCBoZWxwZXIgPSBwLmNvbXBsZXRlKFwiaGVscGVyXCIpLmZpbmQoKGkpID0+IGkubGFiZWwgPT09IFwiaGVscGVyXCIpO1xuICBhc3NlcnQub2soaGVscGVyKTtcbiAgY29uc3QgdGFyZ2V0ID0gcHJvdmlkZURlZmluaXRpb24ocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBwLmF0KFwiaGVscGVyXCIpIC0gMSkgYXMgeyB1cmk6IHN0cmluZyB9O1xuICBhc3NlcnQuZXF1YWwodGFyZ2V0LnVyaSwgcGF0aFRvVXJpKHBhdGguam9pbihwLnJvb3QsIFwiaGVscGVycy9oZWxwZXIuc3ZcIikpKTtcbiAgcC5tYW5hZ2VyLmNsb3NlKHAudXJpKTtcbn0pO1xuXG5pdChcImluc2VydHMgY2FsbGFibGUgc25pcHBldHMgYW5kIHNob3dzIHRoZSBhY3RpdmUgYXJndW1lbnQgd2hpbGUgdHlwaW5nXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcCA9IGF3YWl0IHByb2plY3QoYG1vZHVsZSBtOyBpbml0aWFsIGRzcF90ZXN0OjpnZW5lcmF0ZV90cmlhbmdsZV93YXZlOyBlbmRtb2R1bGVgKTtcbiAgY29uc3QgaXRlbSA9IHAuY29tcGxldGUoXCJkc3BfdGVzdDo6Z2VuZXJhdGVfdHJpYW5nbGVfd2F2ZVwiKS5maW5kKChpKSA9PiBpLmxhYmVsID09PSBcImdlbmVyYXRlX3RyaWFuZ2xlX3dhdmVcIik7XG4gIGFzc2VydC5lcXVhbChpdGVtPy5pbnNlcnRUZXh0LCBcImdlbmVyYXRlX3RyaWFuZ2xlX3dhdmUoJHsxOmNvdW50fSwgJHsyOnJlc3VsdH0pJDBcIik7XG4gIGNvbnN0IHRleHQgPSBcIm1vZHVsZSBtOyBpbml0aWFsIGRzcF90ZXN0OjpnZW5lcmF0ZV90cmlhbmdsZV93YXZlKDMsIFwiO1xuICBjb25zdCBkb2MgPSBUZXh0RG9jdW1lbnQuY3JlYXRlKHAudXJpLCBcInN5c3RlbXZlcmlsb2dcIiwgMiwgdGV4dCk7XG4gIGNvbnN0IGhlbHAgPSBwcm92aWRlU2lnbmF0dXJlSGVscChkb2MsIHAuYW5hbHlzaXMsIHAuY2F0YWxvZywgdGV4dC5sZW5ndGgpO1xuICBhc3NlcnQuZXF1YWwoaGVscD8uYWN0aXZlUGFyYW1ldGVyLCAxKTtcbiAgYXNzZXJ0Lm1hdGNoKGhlbHA/LnNpZ25hdHVyZXNbMF0/LmxhYmVsID8/IFwiXCIsIC9vdXRwdXQgaW50IHJlc3VsdC8pO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG5cbml0KFwib2ZmZXJzIG5hbWVkIGFyZ3VtZW50cywgYW5kIHNpZ25hdHVyZSBoZWxwIGZvbGxvd3MgdGhlIGFyZ3VtZW50IG5hbWVcIiwgYXN5bmMgKCkgPT4ge1xuICBjb25zdCB0ZXh0ID0gXCJtb2R1bGUgbTsgaW5pdGlhbCBkc3BfdGVzdDo6Z2VuZXJhdGVfdHJpYW5nbGVfd2F2ZSgucmVzXCI7XG4gIGNvbnN0IHAgPSBhd2FpdCBwcm9qZWN0KHRleHQpO1xuICBhc3NlcnQub2socC5jb21wbGV0ZShcIi5yZXNcIikuc29tZSgoaSkgPT4gaS5sYWJlbCA9PT0gXCJyZXN1bHRcIikpO1xuICBjb25zdCBuYW1lZCA9IHRleHQucmVwbGFjZShcIi5yZXNcIiwgXCIucmVzdWx0KFwiKTtcbiAgY29uc3QgZG9jID0gVGV4dERvY3VtZW50LmNyZWF0ZShwLnVyaSwgXCJzeXN0ZW12ZXJpbG9nXCIsIDIsIG5hbWVkKTtcbiAgYXNzZXJ0LmVxdWFsKHByb3ZpZGVTaWduYXR1cmVIZWxwKGRvYywgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBuYW1lZC5sZW5ndGgpPy5hY3RpdmVQYXJhbWV0ZXIsIDEpO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG5cbml0KFwiY291bnRzIG9ubHkgdG9wLWxldmVsIGNvbW1hcyBpbiBjYWxsc1wiLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChjYWxsQXQoJ2YoZygxLCAyKSwge2EsYn0sIFwiYyxkXCIsICcsIDI3KT8uYXJndW1lbnQsIDMpO1xuICBjb25zdCB0ZXh0ID0gXCJmKGEgLyogLCAqLywgLy8gLFxcbiBiLCBcIjtcbiAgYXNzZXJ0LmVxdWFsKGNhbGxBdCh0ZXh0LCB0ZXh0Lmxlbmd0aCk/LmFyZ3VtZW50LCAyKTtcbn0pO1xuXG5pdChcInJlc29sdmVzIGltcG9ydGVkIHBhY2thZ2Ugcm91dGluZXMgYW5kIHNob3dzIGFyZ3VtZW50IGRlZmF1bHRzXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcCA9IGF3YWl0IHByb2plY3QoYG1vZHVsZSBtOyBpbXBvcnQgbWF0aF9wa2c6Oio7IGluaXRpYWwgc2NhbGUoMiwgMyk7IGVuZG1vZHVsZWAsIHtcbiAgICBcInBhY2thZ2VzL21hdGguc3ZcIjogYHBhY2thZ2UgbWF0aF9wa2c7XG4gZnVuY3Rpb24gYXV0b21hdGljIGludCBzY2FsZShpbnB1dCBpbnQgdmFsdWUsIGlucHV0IGludCBnYWluPTQpOyByZXR1cm4gdmFsdWUqZ2FpbjsgZW5kZnVuY3Rpb25cbmVuZHBhY2thZ2VgLFxuICB9KTtcbiAgY29uc3QgdGFyZ2V0ID0gcHJvdmlkZURlZmluaXRpb24ocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBwLmF0KFwic2NhbGVcIikgLSAxKSBhcyB7IHVyaTogc3RyaW5nIH07XG4gIGFzc2VydC5lcXVhbCh0YXJnZXQudXJpLCBwYXRoVG9VcmkocGF0aC5qb2luKHAucm9vdCwgXCJwYWNrYWdlcy9tYXRoLnN2XCIpKSk7XG4gIGNvbnN0IGhlbHAgPSBwcm92aWRlU2lnbmF0dXJlSGVscChwLmRvY3VtZW50LCBwLmFuYWx5c2lzLCBwLmNhdGFsb2csIHAuYXQoXCJzY2FsZSgyLCBcIikpO1xuICBhc3NlcnQuZXF1YWwoaGVscD8uYWN0aXZlUGFyYW1ldGVyLCAxKTtcbiAgYXNzZXJ0Lm1hdGNoKGhlbHA/LnNpZ25hdHVyZXNbMF0/LmxhYmVsID8/IFwiXCIsIC9nYWluID0gNC8pO1xuICBjb25zdCBob3ZlciA9IHByb3ZpZGVIb3ZlcihwLmRvY3VtZW50LCBwLmFuYWx5c2lzLCBwLmNhdGFsb2csIHAuYXQoXCJzY2FsZVwiKSAtIDEsIHsgc2hvd1R5cGU6IHRydWUsIHNob3dXaWR0aDogdHJ1ZSB9KTtcbiAgYXNzZXJ0Lm1hdGNoKEpTT04uc3RyaW5naWZ5KGhvdmVyKSwgL2lucHV0IGludCB2YWx1ZS8pO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG5cbml0KFwibWFrZXMgaW5jbHVkZWQgZnJlZSB0YXNrcyBjYWxsYWJsZSBmcm9tIGFub3RoZXIgZmlsZVwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHAgPSBhd2FpdCBwcm9qZWN0KCdgaW5jbHVkZSBcIi4uL2hlbHBlcnMvZHJpdmUuc3ZoXCJcXG5tb2R1bGUgbTsgaW5pdGlhbCBwdWxzZSgxKTsgZW5kbW9kdWxlJywge1xuICAgIFwiaGVscGVycy9kcml2ZS5zdmhcIjogXCJ0YXNrIGF1dG9tYXRpYyBwdWxzZShpbnB1dCBpbnQgY3ljbGVzKTsgaW50IHJlbWFpbmluZzsgcmVtYWluaW5nPWN5Y2xlczsgZW5kdGFza1wiLFxuICB9KTtcbiAgY29uc3QgdGFyZ2V0ID0gcHJvdmlkZURlZmluaXRpb24ocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBwLmF0KFwicHVsc2VcIikgLSAxLCBwLmluZGV4ZXIuaW5jbHVkZXMpIGFzIHsgdXJpOiBzdHJpbmcgfTtcbiAgYXNzZXJ0LmVxdWFsKHRhcmdldC51cmksIHBhdGhUb1VyaShwYXRoLmpvaW4ocC5yb290LCBcImhlbHBlcnMvZHJpdmUuc3ZoXCIpKSk7XG4gIGFzc2VydC5tYXRjaChwLmNvbXBsZXRlKFwicHVsc2VcIikuZmluZCgoaSkgPT4gaS5sYWJlbCA9PT0gXCJwdWxzZVwiKT8uZGV0YWlsID8/IFwiXCIsIC9jeWNsZXMvKTtcbiAgcC5tYW5hZ2VyLmNsb3NlKHAudXJpKTtcbn0pO1xuXG5pdChcImtlZXBzIGRlY2xhcmF0aW9ucyBsb2NhbCB0byB0aGUgdGFzayByYXRoZXIgdGhhbiBsZWFraW5nIHRoZW0gdG8gaXRzIGNhbGxlclwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHAgPSBhd2FpdCBwcm9qZWN0KGBtb2R1bGUgbTtcbiB0YXNrIHdvcmsoaW5wdXQgaW50IGFyZ3VtZW50KTsgaW50IG9ubHlfaGVyZTsgb25seV9oZXJlPWFyZ3VtZW50OyBlbmR0YXNrXG4gaW5pdGlhbCB3b3JrKDEpO1xuZW5kbW9kdWxlYCk7XG4gIGFzc2VydC5vayghcC5jb21wbGV0ZShcIndvcmsoMSlcIikuc29tZSgoaSkgPT4gaS5sYWJlbCA9PT0gXCJvbmx5X2hlcmVcIiB8fCBpLmxhYmVsID09PSBcImFyZ3VtZW50XCIpKTtcbiAgcC5tYW5hZ2VyLmNsb3NlKHAudXJpKTtcbn0pO1xuXG5pdChcInJlc29sdmVzIGluaGVyaXRlZCBtZXRob2RzIHRvIHRoZSBmaWxlIGRlY2xhcmluZyB0aGVtIGFuZCBwcmVmZXJzIG92ZXJyaWRlc1wiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHAgPSBhd2FpdCBwcm9qZWN0KGBjbGFzcyBEZXJpdmVkIGV4dGVuZHMgQmFzZTtcbiBmdW5jdGlvbiBpbnQgdmFsdWUoaW5wdXQgaW50IGxvY2FsX2FyZyk7IHJldHVybiBsb2NhbF9hcmc7IGVuZGZ1bmN0aW9uXG5lbmRjbGFzc1xubW9kdWxlIG07IERlcml2ZWQgb2JqOyBpbml0aWFsIG9iai5iYXNlX3Rhc2soMSk7IGVuZG1vZHVsZWAsIHtcbiAgICBcImJhc2UvYmFzZS5zdlwiOiBcImNsYXNzIEJhc2U7IHRhc2sgYmFzZV90YXNrKGlucHV0IGludCBjeWNsZXMpOyBlbmR0YXNrIGZ1bmN0aW9uIGludCB2YWx1ZShpbnB1dCBpbnQgeCk7IHJldHVybiB4OyBlbmRmdW5jdGlvbiBlbmRjbGFzc1wiLFxuICB9KTtcbiAgYXNzZXJ0LmVxdWFsKHAuY2F0YWxvZy5jbGFzc01lbWJlcnMoXCJEZXJpdmVkXCIpLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gXCJ2YWx1ZVwiKT8uYXJndW1lbnRzPy5bMF0/Lm5hbWUsIFwibG9jYWxfYXJnXCIpO1xuICBjb25zdCB0YXJnZXQgPSBwcm92aWRlRGVmaW5pdGlvbihwLmRvY3VtZW50LCBwLmFuYWx5c2lzLCBwLmNhdGFsb2csIHAuYXQoXCJvYmouYmFzZV90YXNrXCIpIC0gMSkgYXMgeyB1cmk6IHN0cmluZyB9O1xuICBhc3NlcnQub2sodGFyZ2V0LCBcImFuIGluaGVyaXRlZCB0YXNrIGNhbGwgbXVzdCByZXNvbHZlXCIpO1xuICBhc3NlcnQuZXF1YWwodGFyZ2V0LnVyaSwgcGF0aFRvVXJpKHBhdGguam9pbihwLnJvb3QsIFwiYmFzZS9iYXNlLnN2XCIpKSk7XG4gIHAubWFuYWdlci5jbG9zZShwLnVyaSk7XG59KTtcblxuaXQoXCJmb2xsb3dzIHRoaXMgdGhyb3VnaCBhIHZpcnR1YWwgaW50ZXJmYWNlIGluIGFuIGV4dGVybmFsIG1ldGhvZCBib2R5XCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgcCA9IGF3YWl0IHByb2plY3QoXCJ0YXNrIGRzcF90ZXN0OjpnZW5lcmF0ZV90cmlhbmdsZV93YXZlKCk7IHRoaXMudmlmLmRhdGEgPSBjb3VudDsgZW5kdGFza1wiKTtcbiAgY29uc3QgdGFyZ2V0ID0gcHJvdmlkZURlZmluaXRpb24ocC5kb2N1bWVudCwgcC5hbmFseXNpcywgcC5jYXRhbG9nLCBwLmF0KFwidGhpcy52aWYuZGF0YVwiKSAtIDEpIGFzIHsgdXJpOiBzdHJpbmcgfTtcbiAgYXNzZXJ0Lm9rKHRhcmdldCk7XG4gIGFzc2VydC5lcXVhbCh0YXJnZXQudXJpLCBwYXRoVG9VcmkocGF0aC5qb2luKHAucm9vdCwgXCJpbnRlcmZhY2VzL2J1c19pZi5zdlwiKSkpO1xuICBwLm1hbmFnZXIuY2xvc2UocC51cmkpO1xufSk7XG4iLCAiaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCI7XG5cbmltcG9ydCB7IExhbmd1YWdlLCBQYXJzZXIsIHR5cGUgTm9kZSwgdHlwZSBUcmVlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG4vKipcbiAqIE93bnMgdGhlIHNpbmdsZSB0cmVlLXNpdHRlciBydW50aW1lIGFuZCB0aGUgU3lzdGVtVmVyaWxvZyBncmFtbWFyLCBhbmQgaGFuZHNcbiAqIG91dCBwYXJzZXJzLiBUcmVlLXNpdHRlciBwYXJzZXJzIGFyZSBjaGVhcCB0byBjbG9uZSBidXQgc2hhcmUgdGhlIGxvYWRlZFxuICogbGFuZ3VhZ2UsIHNvIHdlIGluaXRpYWxpc2Ugb25jZSBwZXIgcHJvY2Vzcy5cbiAqL1xuZXhwb3J0IGNsYXNzIFZlcmlsb2dQYXJzZXIge1xuICBwcml2YXRlIHN0YXRpYyBsYW5ndWFnZTogTGFuZ3VhZ2UgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc3RhdGljIGluaXRQcm9taXNlOiBQcm9taXNlPExhbmd1YWdlPiB8IHVuZGVmaW5lZDtcblxuICBwcml2YXRlIHJlYWRvbmx5IGxhbmd1YWdlOiBMYW5ndWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBwYXJzZXI6IFBhcnNlcjtcblxuICBwcml2YXRlIGNvbnN0cnVjdG9yKGxhbmd1YWdlOiBMYW5ndWFnZSkge1xuICAgIHRoaXMubGFuZ3VhZ2UgPSBsYW5ndWFnZTtcbiAgICB0aGlzLnBhcnNlciA9IG5ldyBQYXJzZXIoKTtcbiAgICB0aGlzLnBhcnNlci5zZXRMYW5ndWFnZShsYW5ndWFnZSk7XG4gIH1cblxuICBzdGF0aWMgYXN5bmMgY3JlYXRlKCk6IFByb21pc2U8VmVyaWxvZ1BhcnNlcj4ge1xuICAgIGNvbnN0IGxhbmd1YWdlID0gYXdhaXQgVmVyaWxvZ1BhcnNlci5sb2FkTGFuZ3VhZ2UoKTtcbiAgICByZXR1cm4gbmV3IFZlcmlsb2dQYXJzZXIobGFuZ3VhZ2UpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgbG9hZExhbmd1YWdlKCk6IFByb21pc2U8TGFuZ3VhZ2U+IHtcbiAgICBpZiAoVmVyaWxvZ1BhcnNlci5sYW5ndWFnZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShWZXJpbG9nUGFyc2VyLmxhbmd1YWdlKTtcbiAgICB9XG4gICAgaWYgKCFWZXJpbG9nUGFyc2VyLmluaXRQcm9taXNlKSB7XG4gICAgICBWZXJpbG9nUGFyc2VyLmluaXRQcm9taXNlID0gKGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gd2ViLXRyZWUtc2l0dGVyIHNoaXBzIGl0cyBvd24gY29yZSBydW50aW1lIGFsb25nc2lkZSB0aGUgZ3JhbW1hcjsgYm90aFxuICAgICAgICAvLyBtdXN0IGJlIGFkZHJlc3NhYmxlIG9uIGRpc2ssIHNvIHJlc29sdmUgdGhlbSB0aHJvdWdoIHJlcXVpcmUuXG4gICAgICAgIGF3YWl0IFBhcnNlci5pbml0KHtcbiAgICAgICAgICBsb2NhdGVGaWxlOiAoKSA9PiByZXF1aXJlLnJlc29sdmUoXCJ3ZWItdHJlZS1zaXR0ZXIvd2ViLXRyZWUtc2l0dGVyLndhc21cIiksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB3YXNtID0gcmVxdWlyZS5yZXNvbHZlKFwidHJlZS1zaXR0ZXItc3lzdGVtdmVyaWxvZy90cmVlLXNpdHRlci1zeXN0ZW12ZXJpbG9nLndhc21cIik7XG4gICAgICAgIGNvbnN0IGxhbmd1YWdlID0gYXdhaXQgTGFuZ3VhZ2UubG9hZCh3YXNtKTtcbiAgICAgICAgVmVyaWxvZ1BhcnNlci5sYW5ndWFnZSA9IGxhbmd1YWdlO1xuICAgICAgICByZXR1cm4gbGFuZ3VhZ2U7XG4gICAgICB9KSgpO1xuICAgIH1cbiAgICByZXR1cm4gVmVyaWxvZ1BhcnNlci5pbml0UHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYHRleHRgLCByZXVzaW5nIHRoZSBwcmV2aW91cyBwYXJzZSBmb3IgaW5jcmVtZW50YWwgdXBkYXRlcyB3aGVuIHRoZVxuICAgKiBjYWxsZXIgc3VwcGxpZXMgdGhlIGNvcnJlc3BvbmRpbmcgb2xkIHRyZWUuXG4gICAqL1xuICBwYXJzZSh0ZXh0OiBzdHJpbmcsIG9sZFRyZWU/OiBUcmVlKTogVHJlZSB7XG4gICAgY29uc3QgdHJlZSA9IHRoaXMucGFyc2VyLnBhcnNlKHRleHQsIG9sZFRyZWUpO1xuICAgIGlmICh0cmVlKSByZXR1cm4gdHJlZTtcbiAgICAvLyBTaG91bGQgbm90IGhhcHBlbjogU3lzdGVtVmVyaWxvZyBhY2NlcHRzIGFueSBpbnB1dCwgaW5jbHVkaW5nIGdhcmJhZ2UuXG4gICAgY29uc3QgZmFsbGJhY2sgPSB0aGlzLnBhcnNlci5wYXJzZSh0ZXh0KTtcbiAgICBpZiAoIWZhbGxiYWNrKSB0aHJvdyBuZXcgRXJyb3IoXCJ0cmVlLXNpdHRlciBmYWlsZWQgdG8gcHJvZHVjZSBhIHRyZWVcIik7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG5cbiAgZ2V0TGFuZ3VhZ2UoKTogTGFuZ3VhZ2Uge1xuICAgIHJldHVybiB0aGlzLmxhbmd1YWdlO1xuICB9XG5cbiAgLyoqIFRoZSBub2RlIGNvdmVyaW5nIGBvZmZzZXRgLCBwcmVmZXJyaW5nIHRoZSBpbm5lcm1vc3QgbmFtZWQgbm9kZS4gKi9cbiAgbm9kZUF0KHRyZWU6IFRyZWUsIG9mZnNldDogbnVtYmVyKTogTm9kZSB8IG51bGwge1xuICAgIGNvbnN0IHJvb3QgPSB0cmVlLnJvb3ROb2RlO1xuICAgIGlmIChvZmZzZXQgPCAwIHx8IG9mZnNldCA+IHJvb3QuZW5kSW5kZXgpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHJhdyA9IHJvb3QubmFtZWREZXNjZW5kYW50Rm9ySW5kZXgob2Zmc2V0KTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIG51bGw7XG4gICAgLy8gYG5hbWVkRGVzY2VuZGFudEZvckluZGV4YCBjYW4gbGFuZCBvbiBhIG5vZGUgdGhhdCBtZXJlbHkgdG91Y2hlcyB0aGUgb2Zmc2V0LlxuICAgIHJldHVybiByYXcuc3RhcnRJbmRleCA8PSBvZmZzZXQgJiYgb2Zmc2V0IDwgcmF3LmVuZEluZGV4ID8gcmF3IDogKHJhdy5wYXJlbnQgPz8gcmF3KTtcbiAgfVxuXG4gIGRpc3Bvc2UoKTogdm9pZCB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMucGFyc2VyLmRlbGV0ZSgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogcGFyc2VyIGFscmVhZHkgdG9ybiBkb3duICovXG4gICAgfVxuICB9XG59XG5cbi8qKiBBYnNvbHV0ZSBwYXRoIG9mIHRoZSBleHRlbnNpb24gcm9vdCwgdXNlZCBmb3IgZGlhZ25vc3RpY3MgaW4gdGhlIHN0YXR1cyBiYXIuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0ZW5zaW9uUm9vdCgpOiBzdHJpbmcge1xuICByZXR1cm4gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLlwiKTtcbn0iLCAiaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG4vKipcbiAqIENvbnN0YW50LWV4cHJlc3Npb24gZXZhbHVhdGlvbiBmb3IgU3lzdGVtVmVyaWxvZy5cbiAqXG4gKiBFdmVyeXRoaW5nIGhlcmUgaXMgZGVsaWJlcmF0ZWx5IGNvbnNlcnZhdGl2ZTogd2hlbiBhIHZhbHVlIGNhbm5vdCBiZSBmb2xkZWRcbiAqIHdpdGggY2VydGFpbnR5IHRoZSBmdW5jdGlvbnMgcmV0dXJuIGB1bmRlZmluZWRgIHJhdGhlciB0aGFuIGd1ZXNzaW5nLiBUaGF0XG4gKiBtYXR0ZXJzIGJlY2F1c2UgdGhlIHJlc3VsdHMgZmVlZCB1c2VyLXZpc2libGUgd2lkdGhzLCBhbmQgYSB3cm9uZyB3aWR0aCBpcyBmYXJcbiAqIHdvcnNlIHRoYW4gbm8gd2lkdGguXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBFdmFsRW52IHtcbiAgLyoqIFZhbHVlIG9mIGEgcGFyYW1ldGVyIC8gbG9jYWxwYXJhbSAvIGdlbnZhciwgaWYga25vd24uICovXG4gIGxvb2t1cChuYW1lOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIC8qKiBCaXQgd2lkdGggb2YgYSBkZWNsYXJlZCBuZXQgb3IgdmFyaWFibGUsIGlmIGtub3duLiAqL1xuICBzeW1ib2xXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIC8qKlxuICAgKiBUcnVlIGZvciBhIGNsYXNzIG9iamVjdCBoYW5kbGUsIHdoaWNoIGhhcyBubyBiaXQgd2lkdGguXG4gICAqXG4gICAqIEEgaGFuZGxlIGhhcyBubyB3aWR0aCBvZiBpdHMgb3duIC0tIHZhbHVlcyByZWFjaCBpdCB0aHJvdWdoIGl0cyBtZW1iZXJzIC0tXG4gICAqIHNvIHdpZHRoIGFyaXRobWV0aWMgaGFzIHRvIGxlYXZlIGl0IGFsb25lIHJhdGhlciB0aGFuIHRyZWF0IGl0IGFzIDEgYml0LlxuICAgKi9cbiAgaXNIYW5kbGU/KG5hbWU6IHN0cmluZyk6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjb25zdCBFTVBUWV9FTlY6IEV2YWxFbnYgPSB7IGxvb2t1cDogKCkgPT4gdW5kZWZpbmVkLCBzeW1ib2xXaWR0aDogKCkgPT4gdW5kZWZpbmVkIH07XG5cbi8qKiBCaW5hcnkgb3BlcmF0b3JzLCBsb3dlc3QgYmluZGluZyBwb3dlciBsYXN0LiAqL1xuY29uc3QgUFJFQ0VERU5DRTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgXCJ8fFwiOiAxLFxuICBcIiYmXCI6IDIsXG4gIFwifFwiOiAzLFxuICBcIn58XCI6IDMsXG4gIFwiXlwiOiA0LFxuICBcIn5eXCI6IDQsXG4gIFwiXn5cIjogNCxcbiAgXCImXCI6IDUsXG4gIFwiPT1cIjogNixcbiAgXCIhPVwiOiA2LFxuICBcIj09PVwiOiA2LFxuICBcIiE9PVwiOiA2LFxuICBcIj09P1wiOiA2LFxuICBcIiE9P1wiOiA2LFxuICBcIjxcIjogNyxcbiAgXCI8PVwiOiA3LFxuICBcIj5cIjogNyxcbiAgXCI+PVwiOiA3LFxuICBcIjw8XCI6IDgsXG4gIFwiPj5cIjogOCxcbiAgXCI8PDxcIjogOCxcbiAgXCI+Pj5cIjogOCxcbiAgXCIrXCI6IDksXG4gIFwiLVwiOiA5LFxuICBcIipcIjogMTAsXG4gIFwiL1wiOiAxMCxcbiAgXCIlXCI6IDEwLFxuICBcIioqXCI6IDExLFxufTtcblxuLyoqIE5vZGUgdHlwZXMgdGhhdCBtZXJlbHkgd3JhcCBhIHNpbmdsZSBleHByZXNzaW9uLiAqL1xuY29uc3QgV1JBUFBFUlMgPSBuZXcgU2V0KFtcbiAgXCJleHByZXNzaW9uXCIsXG4gIFwiY29uc3RhbnRfZXhwcmVzc2lvblwiLFxuICBcImNvbnN0YW50X3ByaW1hcnlcIixcbiAgXCJtaW50eXBtYXhfZXhwcmVzc2lvblwiLFxuICBcImNvbnN0YW50X21pbnR5cG1heF9leHByZXNzaW9uXCIsXG4gIFwicHJpbWFyeVwiLFxuICBcImRhdGFfdHlwZV9vcl9pbXBsaWNpdFwiLFxuICBcImV4cHJlc3Npb25fb3JfZGlzdFwiLFxuICBcInVuYXJ5X2V4cHJlc3Npb25cIixcbiAgXCJwYXJlbnRoZXNpemVkX2V4cHJlc3Npb25cIixcbiAgXCJuZXRfbHZhbHVlXCIsXG4gIFwidmFyaWFibGVfbHZhbHVlXCIsXG4gIFwicGFyYW1fZXhwcmVzc2lvblwiLFxuICBcImNvbnN0YW50X3JhbmdlXCIsXG5dKTtcblxuLyoqIENvbXBhcmlzb24gYW5kIGxvZ2ljYWwgb3BlcmF0b3JzIGFsd2F5cyB5aWVsZCBhIDEtYml0IHJlc3VsdC4gKi9cbmNvbnN0IENPTVBBUklTT04gPSBuZXcgU2V0KFtcIj09XCIsIFwiIT1cIiwgXCI9PT1cIiwgXCIhPT1cIiwgXCI9PT9cIiwgXCIhPT9cIiwgXCI8XCIsIFwiPD1cIiwgXCI+XCIsIFwiPj1cIiwgXCImJlwiLCBcInx8XCJdKTtcbmNvbnN0IExPR0lDQUwgPSBuZXcgU2V0KFtcIiYmXCIsIFwifHxcIl0pO1xuY29uc3QgQklUV0lTRSA9IG5ldyBTZXQoW1wiJlwiLCBcInxcIiwgXCJeXCIsIFwifl5cIiwgXCJeflwiXSk7XG5cbi8qKiBTaGFsbG93IHNjYW4gZm9yIGEgdG9wLWxldmVsIGJpbmFyeSBvcGVyYXRvciBjaGlsZC4gKi9cbmZ1bmN0aW9uIGZpbmRPcGVyYXRvcihub2RlOiBOb2RlKTogeyBpbmRleDogbnVtYmVyOyBvcDogc3RyaW5nOyBwcmVjOiBudW1iZXIgfSB8IHVuZGVmaW5lZCB7XG4gIGxldCBiZXN0OiB7IGluZGV4OiBudW1iZXI7IG9wOiBzdHJpbmc7IHByZWM6IG51bWJlciB9IHwgdW5kZWZpbmVkO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG5vZGUuY2hpbGRDb3VudDsgaSsrKSB7XG4gICAgY29uc3QgY2hpbGQgPSBub2RlLmNoaWxkKGkpO1xuICAgIGlmICghY2hpbGQgfHwgY2hpbGQuaXNOYW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcHJlYyA9IFBSRUNFREVOQ0VbY2hpbGQudHlwZV07XG4gICAgaWYgKHByZWMgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgLy8gTG93ZXN0IHByZWNlZGVuY2Ugd2luczsgdGllcyByZXNvbHZlIHRvIHRoZSBsZWZ0LW1vc3Qgb3BlcmF0b3IgKGxlZnQgYXNzb2MpLlxuICAgIGlmICghYmVzdCB8fCBwcmVjIDwgYmVzdC5wcmVjKSB7XG4gICAgICBiZXN0ID0geyBpbmRleDogaSwgb3A6IGNoaWxkLnR5cGUsIHByZWMgfTtcbiAgICAgIGlmIChwcmVjID09PSAxKSBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJlc3Q7XG59XG5cbi8qKiBMYXN0IG5vbi10cml2aWFsIGNoaWxkLCB1c2VkIGFzIHRoZSBmYWxsYmFjayBvcGVyYW5kIG9mIGEgdW5hcnkgb3BlcmF0b3IuICovXG5mdW5jdGlvbiBvcGVyYW5kQ2hpbGQobm9kZTogTm9kZSk6IE5vZGUgfCB1bmRlZmluZWQge1xuICBjb25zdCBuYW1lZCA9IG5vZGUubmFtZWRDaGlsZHJlbjtcbiAgaWYgKG5hbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIG5hbWVkW25hbWVkLmxlbmd0aCAtIDFdO1xufVxuXG4vKiogU3RyaXBzIHdyYXBwZXIgbGF5ZXJzIHVudGlsIGEgbm9kZSB3aXRoIHJlYWwgc3RydWN0dXJlIGlzIHJlYWNoZWQuICovXG5mdW5jdGlvbiB1bndyYXAobm9kZTogTm9kZSk6IE5vZGUge1xuICBsZXQgY3VycmVudCA9IG5vZGU7XG4gIC8vIEJvdW5kZWQgdG8gYXZvaWQgcGF0aG9sb2dpY2FsIG5lc3RpbmcgaW4gbWFsZm9ybWVkIGlucHV0LlxuICBmb3IgKGxldCBpID0gMDsgaSA8IDY0OyBpKyspIHtcbiAgICBpZiAoY3VycmVudC5uYW1lZENoaWxkQ291bnQgPT09IDEgJiYgV1JBUFBFUlMuaGFzKGN1cnJlbnQudHlwZSkpIHtcbiAgICAgIGNvbnN0IGlubmVyID0gY3VycmVudC5uYW1lZENoaWxkKDApO1xuICAgICAgaWYgKCFpbm5lcikgYnJlYWs7XG4gICAgICBjdXJyZW50ID0gaW5uZXI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYnJlYWs7XG4gIH1cbiAgcmV0dXJuIGN1cnJlbnQ7XG59XG5cbmNvbnN0IFNJWkVfUkUgPSAvXihcXGQrKT8nXFxzKltzU10/KFtib2RoQk9ESF0pXFxzKihbMC05YS1mQS1GeFh6Wl9dKykkLztcbmNvbnN0IFBMQUlOX1JFID0gL15bMC05XVswLTlfXSokLztcbmNvbnN0IFVOQkFTRURfUkUgPSAvXidcXHMqW3NTXT8oWzAxeFh6Wl0pJC87XG5jb25zdCBCQVNFRF9PTkxZX1JFID0gL14nKD86W3NTXT8pKFtib2RoQk9ESF0pXFxzKihbMC05YS1mQS1GeFh6Wl9dKykkLztcblxuLyoqIFBhcnNlcyBhIG51bWVyaWMgbGl0ZXJhbCdzIHRleHQuIFJldHVybnMgdmFsdWUgYW5kIGRlY2xhcmVkIGJpdCBzaXplLiAqL1xuZnVuY3Rpb24gcGFyc2VMaXRlcmFsKHRleHQ6IHN0cmluZyk6IHsgdmFsdWU6IG51bWJlcjsgc2l6ZT86IG51bWJlciB9IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcyA9IHRleHQudHJpbSgpLnJlcGxhY2UoL18vZywgXCJcIik7XG5cbiAgY29uc3QgdW5iYXNlZCA9IFVOQkFTRURfUkUuZXhlYyhzKTtcbiAgaWYgKHVuYmFzZWQpIHtcbiAgICBjb25zdCBjaCA9IHVuYmFzZWRbMV0hLnRvTG93ZXJDYXNlKCk7XG4gICAgcmV0dXJuIHsgdmFsdWU6IGNoID09PSBcIjFcIiA/IDEgOiAwLCBzaXplOiAxIH07XG4gIH1cblxuICBjb25zdCBzaXplZCA9IFNJWkVfUkUuZXhlYyhzKTtcbiAgaWYgKHNpemVkKSB7XG4gICAgY29uc3Qgc2l6ZSA9IHNpemVkWzFdID8gcGFyc2VJbnQoc2l6ZWRbMV0sIDEwKSA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBiYXNlID0gc2l6ZWRbMl0hLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZGlnaXRzID0gc2l6ZWRbM10hO1xuICAgIGNvbnN0IHJhZGl4ID0gYmFzZSA9PT0gXCJiXCIgPyAyIDogYmFzZSA9PT0gXCJvXCIgPyA4IDogYmFzZSA9PT0gXCJoXCIgPyAxNiA6IDEwO1xuICAgIC8vIHgveiBkaWdpdHMgbWFrZSB0aGUgdmFsdWUgb25seSBwYXJ0aWFsbHkga25vd247IGZvbGQgdGhlbSB0byAwLlxuICAgIGlmICgvW3hYelpdLy50ZXN0KGRpZ2l0cykpIHtcbiAgICAgIHJldHVybiB7IHZhbHVlOiAwLCBzaXplIH07XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VJbnQoZGlnaXRzLCByYWRpeCk7XG4gICAgaWYgKE51bWJlci5pc05hTih2YWx1ZSkpIHJldHVybiB7IHZhbHVlOiAwLCBzaXplIH07XG4gICAgcmV0dXJuIHsgdmFsdWUsIHNpemUgfTtcbiAgfVxuXG4gIGlmIChQTEFJTl9SRS50ZXN0KHMpKSB7XG4gICAgcmV0dXJuIHsgdmFsdWU6IHBhcnNlSW50KHMsIDEwKSB9O1xuICB9XG5cbiAgLy8gYCdoRkZgIHdpdGggbm8gZXhwbGljaXQgc2l6ZS5cbiAgY29uc3QgYmFzZWQgPSBCQVNFRF9PTkxZX1JFLmV4ZWMocyk7XG4gIGlmIChiYXNlZCkge1xuICAgIGNvbnN0IGJhc2UgPSBiYXNlZFsxXSEudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBkaWdpdHMgPSBiYXNlZFsyXSE7XG4gICAgaWYgKC9beFh6Wl0vLnRlc3QoZGlnaXRzKSkgcmV0dXJuIHsgdmFsdWU6IDAgfTtcbiAgICBjb25zdCByYWRpeCA9IGJhc2UgPT09IFwiYlwiID8gMiA6IGJhc2UgPT09IFwib1wiID8gOCA6IGJhc2UgPT09IFwiaFwiID8gMTYgOiAxMDtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlSW50KGRpZ2l0cywgcmFkaXgpO1xuICAgIHJldHVybiBOdW1iZXIuaXNOYU4odmFsdWUpID8gdW5kZWZpbmVkIDogeyB2YWx1ZSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqIEJ1aWx0LWluIHN5c3RlbSBmdW5jdGlvbnMgd29ydGggZm9sZGluZyBmb3Igd2lkdGggY29tcHV0YXRpb24uICovXG5mdW5jdGlvbiBjYWxsU3lzdGVtRnVuY3Rpb24obm9kZTogTm9kZSwgZW52OiBFdmFsRW52KTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgdGV4dCA9IG5vZGUudGV4dC50cmltKCk7XG4gIGNvbnN0IG1hdGNoID0gL15cXCQoW0EtWmEtel9dW0EtWmEtejAtOV8kXSopXFxzKlxcKChbXFxzXFxTXSopXFwpJC8uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgbmFtZSA9IG1hdGNoWzFdIS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBhcmdUZXh0ID0gbWF0Y2hbMl0hLnRyaW0oKTtcblxuICBzd2l0Y2ggKG5hbWUpIHtcbiAgICBjYXNlIFwiY2xvZzJcIjoge1xuICAgICAgaWYgKGFyZ1RleHQgPT09IFwiXCIpIHJldHVybiAwO1xuICAgICAgY29uc3QgYXJnID0gZXZhbHVhdGVUZXh0KGFyZ1RleHQsIGVudik7XG4gICAgICBpZiAoYXJnID09PSB1bmRlZmluZWQgfHwgYXJnIDw9IDEpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gTWF0aC5jZWlsKE1hdGgubG9nMihhcmcpKTtcbiAgICB9XG4gICAgY2FzZSBcImNlaWxcIjoge1xuICAgICAgY29uc3QgYXJnID0gZXZhbHVhdGVUZXh0KGFyZ1RleHQsIGVudik7XG4gICAgICByZXR1cm4gYXJnID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBNYXRoLmNlaWwoYXJnKTtcbiAgICB9XG4gICAgY2FzZSBcImZsb29yXCI6IHtcbiAgICAgIGNvbnN0IGFyZyA9IGV2YWx1YXRlVGV4dChhcmdUZXh0LCBlbnYpO1xuICAgICAgcmV0dXJuIGFyZyA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogTWF0aC5mbG9vcihhcmcpO1xuICAgIH1cbiAgICBjYXNlIFwiYml0c1wiOiB7XG4gICAgICBpZiAoIWFyZ1RleHQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAvLyBgJGJpdHModHlwZV9vcl9zaWduYWwpYCAtLSBvbmx5IHJlc29sdmFibGUgdGhyb3VnaCBhIHN5bWJvbCB3aWR0aC5cbiAgICAgIGNvbnN0IGNsZWFuZWQgPSBhcmdUZXh0LnJlcGxhY2UoL15cXFtbXlxcXV0qXFxdXFxzKi8sIFwiXCIpO1xuICAgICAgcmV0dXJuIGVudi5zeW1ib2xXaWR0aChjbGVhbmVkKTtcbiAgICB9XG4gICAgY2FzZSBcInNpemVcIjoge1xuICAgICAgaWYgKCFhcmdUZXh0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIGVudi5zeW1ib2xXaWR0aChhcmdUZXh0LnJlcGxhY2UoL15cXFtbXlxcXV0qXFxdXFxzKi8sIFwiXCIpKTtcbiAgICB9XG4gICAgY2FzZSBcImxlZnRcIjoge1xuICAgICAgY29uc3QgYXJncyA9IGFyZ1RleHQuc3BsaXQoXCIsXCIpO1xuICAgICAgY29uc3QgdmFsdWUgPSBldmFsdWF0ZVRleHQoYXJnc1swXSA/PyBcIlwiLCBlbnYpO1xuICAgICAgY29uc3Qgd2lkdGggPSBldmFsdWF0ZVRleHQoYXJnc1sxXSA/PyBcIlwiLCBlbnYpO1xuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgd2lkdGggPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IG1hc2sgPSB3aWR0aCA+PSAzMiA/IDB4ZmZmZmZmZmYgOiAoMSA8PCB3aWR0aCkgLSAxO1xuICAgICAgcmV0dXJuICh2YWx1ZSA8PCB3aWR0aCkgJiBtYXNrO1xuICAgIH1cbiAgICBjYXNlIFwicmlnaHRcIjoge1xuICAgICAgY29uc3QgYXJncyA9IGFyZ1RleHQuc3BsaXQoXCIsXCIpO1xuICAgICAgY29uc3QgdmFsdWUgPSBldmFsdWF0ZVRleHQoYXJnc1swXSA/PyBcIlwiLCBlbnYpO1xuICAgICAgY29uc3Qgd2lkdGggPSBldmFsdWF0ZVRleHQoYXJnc1sxXSA/PyBcIlwiLCBlbnYpO1xuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgd2lkdGggPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB2YWx1ZSA+Pj4gd2lkdGg7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogRXZhbHVhdGVzIGEgY29uc3RhbnQgZXhwcmVzc2lvbiB0byBhbiBpbnRlZ2VyLlxuICogUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIHRoZSB2YWx1ZSBjYW5ub3QgYmUgZGV0ZXJtaW5lZCBleGFjdGx5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGUobm9kZTogTm9kZSB8IG51bGwgfCB1bmRlZmluZWQsIGVudjogRXZhbEVudik6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICghbm9kZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgY3VycmVudCA9IHVud3JhcChub2RlKTtcblxuICBjb25zdCBvcCA9IGZpbmRPcGVyYXRvcihjdXJyZW50KTtcbiAgaWYgKG9wKSB7XG4gICAgY29uc3QgbGVmdE5vZGUgPSBjdXJyZW50LmNoaWxkKG9wLmluZGV4IC0gMSk7XG4gICAgY29uc3QgcmlnaHROb2RlID0gY3VycmVudC5jaGlsZChvcC5pbmRleCArIDEpO1xuICAgIGlmICghbGVmdE5vZGUgfHwgIXJpZ2h0Tm9kZSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIExvZ2ljYWwgb3BlcmF0b3JzIHNob3J0LWNpcmN1aXQsIHNvIGEgMCBsaHMgaXMgZW5vdWdoIHRvIGRlY2lkZS5cbiAgICBpZiAoTE9HSUNBTC5oYXMob3Aub3ApKSB7XG4gICAgICBjb25zdCBsZWZ0ID0gZXZhbHVhdGUobGVmdE5vZGUsIGVudik7XG4gICAgICBjb25zdCByaWdodCA9IGV2YWx1YXRlKHJpZ2h0Tm9kZSwgZW52KTtcbiAgICAgIGlmIChsZWZ0ID09PSB1bmRlZmluZWQgfHwgcmlnaHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBhcHBseShvcC5vcCwgbGVmdCwgcmlnaHQpO1xuICAgIH1cblxuICAgIGNvbnN0IGxlZnQgPSBldmFsdWF0ZShsZWZ0Tm9kZSwgZW52KTtcbiAgICBjb25zdCByaWdodCA9IGV2YWx1YXRlKHJpZ2h0Tm9kZSwgZW52KTtcbiAgICBpZiAobGVmdCA9PT0gdW5kZWZpbmVkIHx8IHJpZ2h0ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGFwcGx5KG9wLm9wLCBsZWZ0LCByaWdodCk7XG4gIH1cblxuICAvLyBVbmFyeSBvcGVyYXRvcnMuXG4gIGlmIChjdXJyZW50LmNoaWxkQ291bnQgPj0gMiAmJiAhY3VycmVudC5jaGlsZCgwKSEuaXNOYW1lZCkge1xuICAgIGNvbnN0IHRva2VuID0gY3VycmVudC5jaGlsZCgwKSEudHlwZTtcbiAgICBpZiAodG9rZW4gPT09IFwiLVwiIHx8IHRva2VuID09PSBcIitcIiB8fCB0b2tlbiA9PT0gXCJ+XCIgfHwgdG9rZW4gPT09IFwiIVwiKSB7XG4gICAgICBjb25zdCBvcGVyYW5kID0gb3BlcmFuZENoaWxkKGN1cnJlbnQpO1xuICAgICAgaWYgKCFvcGVyYW5kKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgdmFsdWUgPSBldmFsdWF0ZShvcGVyYW5kLCBlbnYpO1xuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICBpZiAodG9rZW4gPT09IFwiLVwiKSByZXR1cm4gLXZhbHVlO1xuICAgICAgaWYgKHRva2VuID09PSBcIn5cIikgcmV0dXJuIH52YWx1ZTtcbiAgICAgIGlmICh0b2tlbiA9PT0gXCIhXCIpIHJldHVybiB2YWx1ZSA9PT0gMCA/IDEgOiAwO1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikge1xuICAgIGNvbnN0IHZhbHVlID0gZW52Lmxvb2t1cChjdXJyZW50LnRleHQpO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdmFsdWU7XG4gICAgLy8gQSBiYXJlIGlkZW50aWZpZXIgbWF5IGFsc28gYmUgYSAxLWJpdCBzaWduYWw7IHRoYXQgaXMgYSB3aWR0aCwgbm90IGEgdmFsdWUuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAoY3VycmVudC50eXBlLmluY2x1ZGVzKFwiZnVuY3Rpb25fY2FsbFwiKSB8fCBjdXJyZW50LnR5cGUgPT09IFwic3lzdGVtX3RmX2NhbGxcIikge1xuICAgIHJldHVybiBjYWxsU3lzdGVtRnVuY3Rpb24oY3VycmVudCwgZW52KTtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwiY29uY2F0ZW5hdGlvblwiKSB7XG4gICAgLy8gQ29uY2F0ZW5hdGlvbiB2YWx1ZSA9IGxvdyBiaXRzIGxhc3QuXG4gICAgbGV0IHZhbHVlID0gMDtcbiAgICBsZXQgc2hpZnQgPSAwO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY3VycmVudC5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCBwYXJ0ID0gZXZhbHVhdGUoY2hpbGQsIGVudik7XG4gICAgICBpZiAocGFydCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgcGFydFdpZHRoID0gd2lkdGhPZihjaGlsZCwgZW52KSA/PyAzMjtcbiAgICAgIHZhbHVlIHw9IHBhcnQgPDwgc2hpZnQ7XG4gICAgICBzaGlmdCArPSBwYXJ0V2lkdGg7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwicHJpbWFyeV9saXRlcmFsXCIgfHwgY3VycmVudC50eXBlID09PSBcImludGVncmFsX251bWJlclwiIHx8IGN1cnJlbnQudHlwZSA9PT0gXCJudW1iZXJcIikge1xuICAgIHJldHVybiBwYXJzZUxpdGVyYWwoY3VycmVudC50ZXh0KT8udmFsdWU7XG4gIH1cblxuICAvLyBMYXN0IHJlc29ydDogYSBzaW5nbGUtY2hpbGQgd3JhcHBlciB0aGUgdGFibGVzIGFib3ZlIGRpZCBub3QgbmFtZS5cbiAgaWYgKGN1cnJlbnQubmFtZWRDaGlsZENvdW50ID09PSAxKSB7XG4gICAgY29uc3QgaW5uZXIgPSBjdXJyZW50Lm5hbWVkQ2hpbGQoMCk7XG4gICAgaWYgKGlubmVyICYmIGlubmVyLmlkICE9PSBjdXJyZW50LmlkKSByZXR1cm4gZXZhbHVhdGUoaW5uZXIsIGVudik7XG4gIH1cblxuICBjb25zdCBsaXRlcmFsID0gcGFyc2VMaXRlcmFsKGN1cnJlbnQudGV4dCk7XG4gIHJldHVybiBsaXRlcmFsPy52YWx1ZTtcbn1cblxuLyoqXG4gKiBGb2xkcyBhIGNvbnN0YW50IGV4cHJlc3Npb24gZ2l2ZW4gYXMgc291cmNlIHRleHQuXG4gKlxuICogVXNlZCBmb3IgdGhlIHBhcnRzIG9mIGEgZGVjbGFyYXRpb24gdGhhdCB0aGUgYW5hbHl6ZXIga2VlcHMgYXMgdGV4dCAoZGVmYXVsdFxuICogdmFsdWVzLCBwYWNrZWQgcmFuZ2Ugc3RyaW5ncykgcmF0aGVyIHRoYW4gYXMgc3ludGF4IG5vZGVzLiBMaWtlIHtAbGlua1xuICogZXZhbHVhdGV9LCBpdCByZXR1cm5zIGB1bmRlZmluZWRgIHdoZW5ldmVyIHRoZSB2YWx1ZSBpcyBub3QgY2VydGFpbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlVGV4dCh0ZXh0OiBzdHJpbmcsIGVudjogRXZhbEVudik6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHRyaW1tZWQgPSB0ZXh0LnRyaW0oKTtcbiAgaWYgKCF0cmltbWVkKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIGBwa2c6OlBBUkFNYCBpcyBhIHBhcmFtZXRlciBuYW1lZCBpbiBhbm90aGVyIGZpbGUuIFRoZSBwYWNrYWdlIHF1YWxpZmllciBpc1xuICAvLyBub3QgYXJpdGhtZXRpYyAtLSBpdCBvbmx5IHNheXMgd2hlcmUgdGhlIG5hbWUgbGl2ZXMgLS0gc28gaXQgaXMgZHJvcHBlZCBhbmRcbiAgLy8gdGhlIG5hbWUgbG9va2VkIHVwIG9uIGl0cyBvd24uIFRoZSBhbmFseXplciBzZWVkZWQgdGhlIHZhbHVlIGZyb20gdGhlXG4gIC8vIGNhdGFsb2cgYmVmb3JlIGNhbGxpbmcsIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIGxvb2t1cCBiZWxvdyBzdWNjZWVkLlxuICBjb25zdCBxdWFsaWZpZWQgPSAvXltBLVphLXpfXVxcdyo6OihbQS1aYS16X11cXHcqKSQvLmV4ZWModHJpbW1lZCk7XG4gIGlmIChxdWFsaWZpZWQpIHJldHVybiBlbnYubG9va3VwPy4ocXVhbGlmaWVkWzFdISk7XG5cbiAgaWYgKGVudi5sb29rdXApIHtcbiAgICBjb25zdCBkaXJlY3QgPSBlbnYubG9va3VwKHRyaW1tZWQpO1xuICAgIGlmIChkaXJlY3QgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGRpcmVjdDtcbiAgfVxuXG4gIGNvbnN0IGxpdGVyYWwgPSBwYXJzZUxpdGVyYWwodHJpbW1lZC5yZXBsYWNlKC9fL2csIFwiXCIpKTtcbiAgaWYgKGxpdGVyYWwpIHJldHVybiBsaXRlcmFsLnZhbHVlO1xuXG4gIC8vICRjbG9nMig8ZXhwcj4pXG4gIGNvbnN0IGNsb2cgPSAvXlxcJGNsb2cyXFxzKlxcKChbXFxzXFxTXSopXFwpJC8uZXhlYyh0cmltbWVkKTtcbiAgaWYgKGNsb2cpIHtcbiAgICBjb25zdCBhcmcgPSBldmFsdWF0ZVRleHQoY2xvZ1sxXSEsIGVudik7XG4gICAgaWYgKGFyZyA9PT0gdW5kZWZpbmVkIHx8IGFyZyA8PSAxKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBNYXRoLmNlaWwoTWF0aC5sb2cyKGFyZykpO1xuICB9XG5cbiAgY29uc3QgcGFyZW50aGVzaXNlZCA9IC9eXFwoXFxzKihbXFxzXFxTXSopXFxzKlxcKSQvLmV4ZWModHJpbW1lZCk7XG4gIGlmIChwYXJlbnRoZXNpc2VkKSByZXR1cm4gZXZhbHVhdGVUZXh0KHBhcmVudGhlc2lzZWRbMV0hLCBlbnYpO1xuXG4gIC8vIFVuYXJ5IHNpZ24uXG4gIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCItXCIpKSB7XG4gICAgY29uc3QgdmFsdWUgPSBldmFsdWF0ZVRleHQodHJpbW1lZC5zbGljZSgxKSwgZW52KTtcbiAgICByZXR1cm4gdmFsdWUgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IC12YWx1ZTtcbiAgfVxuICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiK1wiKSkgcmV0dXJuIGV2YWx1YXRlVGV4dCh0cmltbWVkLnNsaWNlKDEpLCBlbnYpO1xuXG4gIC8vIEEgYmFyZSBpZGVudGlmaWVyIGlzIGEgcGFyYW1ldGVyIG9yIGEgMS1iaXQgc2lnbmFsLCBuZXZlciBhIHVzYWJsZSBudW1iZXIuXG4gIGlmICgvXltBLVphLXpfXVtBLVphLXowLTlfJF0qJC8udGVzdCh0cmltbWVkKSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBiaW5hcnkgPSBmaW5kVG9wTGV2ZWxCaW5hcnkodHJpbW1lZCk7XG4gIGlmIChiaW5hcnkpIHtcbiAgICBjb25zdCBsZWZ0ID0gZXZhbHVhdGVUZXh0KHRyaW1tZWQuc2xpY2UoMCwgYmluYXJ5LmluZGV4KSwgZW52KTtcbiAgICBjb25zdCByaWdodCA9IGV2YWx1YXRlVGV4dCh0cmltbWVkLnNsaWNlKGJpbmFyeS5pbmRleCArIGJpbmFyeS5vcC5sZW5ndGgpLCBlbnYpO1xuICAgIGlmIChsZWZ0ID09PSB1bmRlZmluZWQgfHwgcmlnaHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYXBwbHkoYmluYXJ5Lm9wLCBsZWZ0LCByaWdodCk7XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKiogQmluYXJ5IG9wZXJhdG9ycyBjb25zaWRlcmVkIHdoZW4gc3BsaXR0aW5nIGFuIGV4cHJlc3Npb24gd3JpdHRlbiBhcyB0ZXh0LiAqL1xuY29uc3QgVEVYVF9PUEVSQVRPUlMgPSBbXCI8PFwiLCBcIj4+XCIsIFwiK1wiLCBcIi1cIiwgXCIqXCIsIFwiL1wiLCBcIiVcIiwgXCImXCIsIFwifFwiLCBcIl5cIl07XG5cbi8qKlxuICogU3BsaXRzIG9uIHRoZSBsb3dlc3QtcHJlY2VkZW5jZSB0b3AtbGV2ZWwgb3BlcmF0b3IsIHJlc3BlY3RpbmcgcGFyZW50aGVzZXMuXG4gKiBSZXR1cm5zIHRoZSByaWdodC1tb3N0IHN1Y2ggb3BlcmF0b3Igc28gdGhlIGxlZnQgb3BlcmFuZCBpcyB0aGUgbGFyZ2VzdCB0ZXJtLlxuICovXG5mdW5jdGlvbiBmaW5kVG9wTGV2ZWxCaW5hcnkodGV4dDogc3RyaW5nKTogeyBpbmRleDogbnVtYmVyOyBvcDogc3RyaW5nIH0gfCB1bmRlZmluZWQge1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgYmVzdDogeyBpbmRleDogbnVtYmVyOyBvcDogc3RyaW5nOyBwcmVjOiBudW1iZXIgfSB8IHVuZGVmaW5lZDtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHRleHQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaGFyID0gdGV4dFtpXSE7XG4gICAgaWYgKGNoYXIgPT09IFwiKFwiKSBkZXB0aCsrO1xuICAgIGVsc2UgaWYgKGNoYXIgPT09IFwiKVwiKSBkZXB0aC0tO1xuICAgIGVsc2UgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBjb25zdCB0d28gPSB0ZXh0LnNsaWNlKGksIGkgKyAyKTtcbiAgICAgIGNvbnN0IG9wID0gVEVYVF9PUEVSQVRPUlMuaW5jbHVkZXModHdvKSA/IHR3byA6IFRFWFRfT1BFUkFUT1JTLmluY2x1ZGVzKGNoYXIpID8gY2hhciA6IHVuZGVmaW5lZDtcbiAgICAgIGlmICghb3ApIGNvbnRpbnVlO1xuICAgICAgLy8gQSBsZWFkaW5nIGArYC9gLWAgaXMgYSBzaWduLCBub3QgYW4gb3BlcmF0b3IuXG4gICAgICBpZiAoaSA9PT0gMCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IHByZWMgPSBQUkVDRURFTkNFW29wXSA/PyAwO1xuICAgICAgaWYgKCFiZXN0IHx8IHByZWMgPD0gYmVzdC5wcmVjKSBiZXN0ID0geyBpbmRleDogaSwgb3AsIHByZWMgfTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmVzdCA/IHsgaW5kZXg6IGJlc3QuaW5kZXgsIG9wOiBiZXN0Lm9wIH0gOiB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGFwcGx5KG9wOiBzdHJpbmcsIGxlZnQ6IG51bWJlciwgcmlnaHQ6IG51bWJlcik6IG51bWJlciB7XG4gIHN3aXRjaCAob3ApIHtcbiAgICBjYXNlIFwiK1wiOiByZXR1cm4gbGVmdCArIHJpZ2h0O1xuICAgIGNhc2UgXCItXCI6IHJldHVybiBsZWZ0IC0gcmlnaHQ7XG4gICAgY2FzZSBcIipcIjogcmV0dXJuIGxlZnQgKiByaWdodDtcbiAgICBjYXNlIFwiL1wiOiByZXR1cm4gcmlnaHQgPT09IDAgPyB1bmRlZmluZWQhIDogTWF0aC50cnVuYyhsZWZ0IC8gcmlnaHQpO1xuICAgIGNhc2UgXCIlXCI6IHJldHVybiByaWdodCA9PT0gMCA/IHVuZGVmaW5lZCEgOiBsZWZ0ICUgcmlnaHQ7XG4gICAgY2FzZSBcIioqXCI6IHJldHVybiBsZWZ0ICoqIHJpZ2h0O1xuICAgIGNhc2UgXCI8PFwiOiByZXR1cm4gbGVmdCA8PCByaWdodDtcbiAgICBjYXNlIFwiPj5cIjogcmV0dXJuIGxlZnQgPj4gcmlnaHQ7XG4gICAgY2FzZSBcIjw8PFwiOiByZXR1cm4gbGVmdCA8PCByaWdodDtcbiAgICBjYXNlIFwiPj4+XCI6IHJldHVybiBsZWZ0ID4+PiByaWdodDtcbiAgICBjYXNlIFwiJlwiOiByZXR1cm4gbGVmdCAmIHJpZ2h0O1xuICAgIGNhc2UgXCJ8XCI6IHJldHVybiBsZWZ0IHwgcmlnaHQ7XG4gICAgY2FzZSBcIl5cIjogcmV0dXJuIGxlZnQgXiByaWdodDtcbiAgICBjYXNlIFwifl5cIjpcbiAgICBjYXNlIFwiXn5cIjogcmV0dXJuIH4obGVmdCBeIHJpZ2h0KTtcbiAgICBjYXNlIFwiJiZcIjogcmV0dXJuIGxlZnQgIT09IDAgJiYgcmlnaHQgIT09IDAgPyAxIDogMDtcbiAgICBjYXNlIFwifHxcIjogcmV0dXJuIGxlZnQgIT09IDAgfHwgcmlnaHQgIT09IDAgPyAxIDogMDtcbiAgICBjYXNlIFwiPT1cIjogcmV0dXJuIGxlZnQgPT09IHJpZ2h0ID8gMSA6IDA7XG4gICAgY2FzZSBcIiE9XCI6IHJldHVybiBsZWZ0ICE9PSByaWdodCA/IDEgOiAwO1xuICAgIGNhc2UgXCI9PT1cIjogcmV0dXJuIGxlZnQgPT09IHJpZ2h0ID8gMSA6IDA7XG4gICAgY2FzZSBcIiE9PVwiOiByZXR1cm4gbGVmdCAhPT0gcmlnaHQgPyAxIDogMDtcbiAgICBjYXNlIFwiPT0/XCI6IHJldHVybiBsZWZ0ID09PSByaWdodCA/IDEgOiAwO1xuICAgIGNhc2UgXCIhPT9cIjogcmV0dXJuIGxlZnQgIT09IHJpZ2h0ID8gMSA6IDA7XG4gICAgY2FzZSBcIjxcIjogcmV0dXJuIGxlZnQgPCByaWdodCA/IDEgOiAwO1xuICAgIGNhc2UgXCI8PVwiOiByZXR1cm4gbGVmdCA8PSByaWdodCA/IDEgOiAwO1xuICAgIGNhc2UgXCI+XCI6IHJldHVybiBsZWZ0ID4gcmlnaHQgPyAxIDogMDtcbiAgICBjYXNlIFwiPj1cIjogcmV0dXJuIGxlZnQgPj0gcmlnaHQgPyAxIDogMDtcbiAgICBkZWZhdWx0OiByZXR1cm4gdW5kZWZpbmVkITtcbiAgfVxufVxuXG4vKipcbiAqIEJpdCB3aWR0aCBvZiBhbiBleHByZXNzaW9uLCB1c2VkIGZvciBhc3NpZ25tZW50IHdpZHRoIGNoZWNrcyBhbmQgZm9yXG4gKiBhbm5vdGF0aW5nIGluZmVycmVkIHN1Yi1leHByZXNzaW9ucy4gUmV0dXJucyBgdW5kZWZpbmVkYCB3aGVuIHVua25vd24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aWR0aE9mKG5vZGU6IE5vZGUgfCBudWxsIHwgdW5kZWZpbmVkLCBlbnY6IEV2YWxFbnYpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAoIW5vZGUpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGN1cnJlbnQgPSB1bndyYXAobm9kZSk7XG5cbiAgY29uc3Qgb3AgPSBmaW5kT3BlcmF0b3IoY3VycmVudCk7XG4gIGlmIChvcCkge1xuICAgIGlmIChDT01QQVJJU09OLmhhcyhvcC5vcCkpIHJldHVybiAxO1xuICAgIGlmIChMT0dJQ0FMLmhhcyhvcC5vcCkpIHJldHVybiAxO1xuICAgIGNvbnN0IGxlZnQgPSB3aWR0aE9mKGN1cnJlbnQuY2hpbGQob3AuaW5kZXggLSAxKSwgZW52KTtcbiAgICBjb25zdCByaWdodCA9IHdpZHRoT2YoY3VycmVudC5jaGlsZChvcC5pbmRleCArIDEpLCBlbnYpO1xuICAgIGlmIChCSVRXSVNFLmhhcyhvcC5vcCkpIHtcbiAgICAgIGlmIChsZWZ0ID09PSB1bmRlZmluZWQgfHwgcmlnaHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiBNYXRoLm1heChsZWZ0LCByaWdodCk7XG4gICAgfVxuICAgIGlmIChsZWZ0ID09PSB1bmRlZmluZWQgfHwgcmlnaHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gTWF0aC5tYXgobGVmdCwgcmlnaHQpO1xuICB9XG5cbiAgaWYgKGN1cnJlbnQuY2hpbGRDb3VudCA+PSAyICYmICFjdXJyZW50LmNoaWxkKDApIS5pc05hbWVkKSB7XG4gICAgY29uc3QgdG9rZW4gPSBjdXJyZW50LmNoaWxkKDApIS50eXBlO1xuICAgIGlmICh0b2tlbiA9PT0gXCIhXCIgKSByZXR1cm4gMTtcbiAgICBpZiAodG9rZW4gPT09IFwiflwiKSByZXR1cm4gd2lkdGhPZihvcGVyYW5kQ2hpbGQoY3VycmVudCksIGVudik7XG4gICAgaWYgKHRva2VuID09PSBcIi1cIiB8fCB0b2tlbiA9PT0gXCIrXCIpIHJldHVybiB3aWR0aE9mKG9wZXJhbmRDaGlsZChjdXJyZW50KSwgZW52KTtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikge1xuICAgIHJldHVybiBlbnYuc3ltYm9sV2lkdGgoY3VycmVudC50ZXh0KTtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikge1xuICAgIC8vIGBhLmIuY2AgLS0gcmVzb2x2ZSB0aHJvdWdoIHRoZSBsZWZ0bW9zdCBzZWdtZW50LlxuICAgIGNvbnN0IGZpcnN0ID0gY3VycmVudC5uYW1lZENoaWxkKDApO1xuICAgIHJldHVybiBmaXJzdCA/IHdpZHRoT2YoZmlyc3QsIGVudikgOiB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAoY3VycmVudC50eXBlID09PSBcInNlbGVjdFwiIHx8IGN1cnJlbnQudHlwZSA9PT0gXCJiaXRfc2VsZWN0XCIgfHwgY3VycmVudC50eXBlID09PSBcInBhcnRfc2VsZWN0X3JhbmdlXCIpIHtcbiAgICBjb25zdCByYW5nZU5vZGUgPSBjdXJyZW50Lm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlID09PSBcImNvbnN0YW50X3JhbmdlXCIgfHwgYy50eXBlID09PSBcImNvbnN0YW50X2V4cHJlc3Npb25cIik7XG4gICAgaWYgKCFyYW5nZU5vZGUpIHJldHVybiAxOyAvLyBzaW5nbGUtYml0IHNlbGVjdFxuICAgIHJldHVybiByYW5nZVdpZHRoKHJhbmdlTm9kZSwgZW52KTtcbiAgfVxuXG4gIGlmIChjdXJyZW50LnR5cGUgPT09IFwiY29uc3RhbnRfcmFuZ2VcIikge1xuICAgIHJldHVybiByYW5nZVdpZHRoKGN1cnJlbnQsIGVudik7XG4gIH1cblxuICBpZiAoY3VycmVudC50eXBlID09PSBcImNvbmNhdGVuYXRpb25cIikge1xuICAgIC8vIFJlcGxpY2F0aW9uIGB7IE4geyBleHByIH0gfWA6IHRoZSBpbm5lciBjb25jYXRlbmF0aW9uIGhhcyBhIGNvdW50XG4gICAgLy8gZXhwcmVzc2lvbiBhbmQgdGhlIHJlcGxpY2F0ZWQgZXhwcmVzc2lvbiBhcyBpdHMgZmlyc3QgdHdvIG5hbWVkIGNoaWxkcmVuLlxuICAgIGNvbnN0IHJhdyA9IGN1cnJlbnQudGV4dC50cmltKCk7XG4gICAgaWYgKC9eXFx7XFxzKltefVxcc10rXFxzKlxcey8udGVzdChyYXcpKSB7XG4gICAgICBjb25zdCBjb3VudCA9IGV2YWx1YXRlVGV4dChyYXcuc2xpY2UoMSkudHJpbSgpLnNwbGl0KC9cXHMrLylbMF0gPz8gXCJcIiwgZW52KTtcbiAgICAgIGlmIChjb3VudCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgaW5uZXIgPSBjdXJyZW50Lm5hbWVkQ2hpbGQoMSk7XG4gICAgICBjb25zdCBpbm5lcldpZHRoID0gaW5uZXIgPyAod2lkdGhPZihpbm5lciwgZW52KSA/PyAzMikgOiAzMjtcbiAgICAgIHJldHVybiBjb3VudCAqIGlubmVyV2lkdGg7XG4gICAgfVxuXG4gICAgbGV0IHRvdGFsID0gMDtcbiAgICBsZXQgc2VlbiA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY3VycmVudC5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBjb25zdCB3ID0gd2lkdGhPZihjaGlsZCwgZW52KTtcbiAgICAgIGlmICh3ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB0b3RhbCArPSB3O1xuICAgICAgc2VlbiA9IHRydWU7XG4gICAgfVxuICAgIHJldHVybiBzZWVuID8gdG90YWwgOiB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAoY3VycmVudC50eXBlID09PSBcInByaW1hcnlfbGl0ZXJhbFwiIHx8IGN1cnJlbnQudHlwZSA9PT0gXCJpbnRlZ3JhbF9udW1iZXJcIiB8fCBjdXJyZW50LnR5cGUgPT09IFwibnVtYmVyXCIpIHtcbiAgICBjb25zdCBsaXRlcmFsID0gcGFyc2VMaXRlcmFsKGN1cnJlbnQudGV4dCk7XG4gICAgaWYgKCFsaXRlcmFsKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChsaXRlcmFsLnNpemUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGxpdGVyYWwuc2l6ZTtcbiAgICAvLyBVbnNpemVkIGxpdGVyYWxzIHRha2UgdGhlIHdpZHRoIG9mIHRoZSBjb250ZXh0OyAzMiBpcyB0aGUgU1YgZGVmYXVsdC5cbiAgICByZXR1cm4gMzI7XG4gIH1cblxuICBpZiAoY3VycmVudC50eXBlLmluY2x1ZGVzKFwiZnVuY3Rpb25fY2FsbFwiKSB8fCBjdXJyZW50LnR5cGUgPT09IFwic3lzdGVtX3RmX2NhbGxcIikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFdpZHRoIHNwYW5uZWQgYnkgYSBkaW1lbnNpb24gbm9kZTogYFttc2I6bHNiXWAsIGBbc2l6ZV1gLCBvciBhXG4gKiBgcGFja2VkX2RpbWVuc2lvbmAgLyBgdW5wYWNrZWRfZGltZW5zaW9uYCAvIGBzZWxlY3RgIHRoYXQgd3JhcHMgb25lIG9mIHRob3NlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VXaWR0aChub2RlOiBOb2RlLCBlbnY6IEV2YWxFbnYpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICAvLyBEaW1lbnNpb25zIG5lc3QgdGhlaXIgcmFuZ2Ugb25lIGxldmVsIGRvd24sIHNvIGRlc2NlbmQgZmlyc3QuXG4gIGlmIChub2RlLnR5cGUgPT09IFwicGFja2VkX2RpbWVuc2lvblwiIHx8IG5vZGUudHlwZSA9PT0gXCJ1bnBhY2tlZF9kaW1lbnNpb25cIiB8fCBub2RlLnR5cGUgPT09IFwic2VsZWN0XCIpIHtcbiAgICBjb25zdCBpbm5lciA9IG5vZGUubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwiY29uc3RhbnRfcmFuZ2VcIik7XG4gICAgaWYgKCFpbm5lcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gcmFuZ2VXaWR0aChpbm5lciwgZW52KTtcbiAgfVxuXG4gIGNvbnN0IG5hbWVkID0gbm9kZS5uYW1lZENoaWxkcmVuO1xuICBpZiAobmFtZWQubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIC8vIENvbG9uIGZvcm06IG1zYjpsc2IuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbm9kZS5jaGlsZENvdW50OyBpKyspIHtcbiAgICBjb25zdCBjaGlsZCA9IG5vZGUuY2hpbGQoaSk7XG4gICAgaWYgKGNoaWxkICYmICFjaGlsZC5pc05hbWVkICYmIGNoaWxkLnR5cGUgPT09IFwiOlwiKSB7XG4gICAgICBjb25zdCBtc2IgPSBldmFsdWF0ZShub2RlLmNoaWxkKGkgLSAxKSwgZW52KTtcbiAgICAgIGNvbnN0IGxzYiA9IGV2YWx1YXRlKG5vZGUuY2hpbGQoaSArIDEpLCBlbnYpO1xuICAgICAgaWYgKG1zYiA9PT0gdW5kZWZpbmVkIHx8IGxzYiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIE1hdGguYWJzKG1zYiAtIGxzYikgKyAxO1xuICAgIH1cbiAgfVxuXG4gIC8vIFNpbmdsZSBmb3JtOiBbZXhwcl0gLS0gYW4gaW1wbGljaXQgWzpleHByXSwgc28gc2l6ZSA9PSBleHByICsgMS5cbiAgY29uc3QgdmFsdWUgPSBldmFsdWF0ZShuYW1lZFswXSEsIGVudik7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gdmFsdWUgKyAxO1xufVxuXG4vKiogV2lkdGggb2YgYSBwYWNrZWQgcmFuZ2Ugd3JpdHRlbiBhcyB0ZXh0LCBlLmcuIGBXSURUSC0xOjBgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpZHRoT2ZUZXh0KHRleHQ6IHN0cmluZywgZW52OiBFdmFsRW52KTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgdCA9IHRleHQudHJpbSgpO1xuICBpZiAoIXQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGNvbG9uID0gaW5kZXhPZlRvcExldmVsQ29sb24odCk7XG4gIGlmIChjb2xvbiA+PSAwKSB7XG4gICAgY29uc3QgbXNiID0gZXZhbHVhdGVUZXh0KHQuc2xpY2UoMCwgY29sb24pLCBlbnYpO1xuICAgIGNvbnN0IGxzYiA9IGV2YWx1YXRlVGV4dCh0LnNsaWNlKGNvbG9uICsgMSksIGVudik7XG4gICAgaWYgKG1zYiA9PT0gdW5kZWZpbmVkIHx8IGxzYiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBNYXRoLmFicyhtc2IgLSBsc2IpICsgMTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IGV2YWx1YXRlVGV4dCh0LCBlbnYpO1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHVlICsgMTtcbn1cblxuLyoqXG4gKiBUaGUgaW5kZXggb2YgdGhlIGA6YCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGVuZHMgb2YgYSByYW5nZS5cbiAqXG4gKiBgcGtnOjpQQVJBTWAgaXMgc2tpcHBlZDogdGhlIHNjb3BlLXJlc29sdXRpb24gb3BlcmF0b3IgaXMgbm90IGEgcmFuZ2UsIGFuZFxuICogdGFraW5nIGl0cyBmaXJzdCBjb2xvbiB3b3VsZCBzcGxpdCBgc2Fsc2EyX2RzcF9wa2c6OldJRFRILTE6MGAgaW50byBhIHBhY2thZ2VcbiAqIG5hbWUgYW5kIGEgbm9uc2Vuc2UgcmVtYWluZGVyLCBzbyBldmVyeSBxdWFsaWZpZWQgd2lkdGggY2FtZSBvdXQgdW5rbm93bi5cbiAqL1xuZnVuY3Rpb24gaW5kZXhPZlRvcExldmVsQ29sb24odGV4dDogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGRlcHRoID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0ZXh0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSB0ZXh0W2ldO1xuICAgIGlmIChjaCA9PT0gXCIoXCIgfHwgY2ggPT09IFwiW1wiIHx8IGNoID09PSBcIntcIikgZGVwdGgrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gXCIpXCIgfHwgY2ggPT09IFwiXVwiIHx8IGNoID09PSBcIn1cIikgZGVwdGgtLTtcbiAgICBlbHNlIGlmIChjaCA9PT0gXCI6XCIgJiYgZGVwdGggPT09IDApIHtcbiAgICAgIC8vIGA6OmAgaXMgYSBzY29wZSByZXNvbHV0aW9uOyBvbmx5IGEgbG9uZSBjb2xvbiBlbmRzIGEgcmFuZ2UuXG4gICAgICBpZiAodGV4dFtpICsgMV0gPT09IFwiOlwiKSB7XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gaTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIC0xO1xufVxuXG4vKiogTnVtYmVyIG9mIGVsZW1lbnRzIGRlc2NyaWJlZCBieSB1bnBhY2tlZCBkaW1lbnNpb25zLCBlLmcuIGBbRC0xOjBdWzc6MF1gLiAqL1xuLyoqXG4gKiBIb3cgbWFueSBlbGVtZW50cyBhbiBhcnJheSBvZiB0aGUgZ2l2ZW4gdW5wYWNrZWQgZGltZW5zaW9ucyBob2xkcy5cbiAqXG4gKiBBIGRpbWVuc2lvbiBpcyBlaXRoZXIgYSByYW5nZSwgYFs3OjBdYCwgb3IgYSBzaXplLCBgW0RFUFRIXWAuIFRoZSB0d28gYXJlXG4gKiBub3QgdGhlIHNhbWUgbnVtYmVyOiBgWzc6MF1gIGlzIDggZWxlbWVudHMgd2hpbGUgYFs4XWAgaXMgOCBhcyB3ZWxsLCBidXQgYVxuICogcmFuZ2UgaXMgYSBkaWZmZXJlbmNlIHBsdXMgb25lIGFuZCBhIHNpemUgaXMgdGhlIHZhbHVlIGl0c2VsZi4gRm9sZGluZyBhIHNpemVcbiAqIGFzIGEgcmFuZ2Ugd291bGQgdHVybiBhIDQtZWxlbWVudCBhcnJheSBpbnRvIDUsIHdoaWNoIHRoZSBOYXZpZ2F0b3IgdGhlblxuICogcmVwb3J0cyBhcyBgNSB4IDMyIGJpdHNgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdW5wYWNrZWRDb3VudChkaW1zOiBzdHJpbmdbXSwgZW52OiBFdmFsRW52KTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKGRpbXMubGVuZ3RoID09PSAwKSByZXR1cm4gMTtcbiAgbGV0IHRvdGFsID0gMTtcbiAgZm9yIChjb25zdCBkaW0gb2YgZGltcykge1xuICAgIGNvbnN0IGlubmVyID0gZGltLnRyaW0oKS5yZXBsYWNlKC9eXFxbLywgXCJcIikucmVwbGFjZSgvXFxdJC8sIFwiXCIpO1xuICAgIGNvbnN0IGNvdW50ID0gaW5kZXhPZlRvcExldmVsQ29sb24oaW5uZXIpID49IDBcbiAgICAgID8gd2lkdGhPZlRleHQoaW5uZXIsIGVudilcbiAgICAgIDogZXZhbHVhdGVUZXh0KGlubmVyLCBlbnYpO1xuICAgIGlmIChjb3VudCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHRvdGFsICo9IGNvdW50O1xuICB9XG4gIHJldHVybiB0b3RhbDtcbn0iLCAiaW1wb3J0IHR5cGUgeyBQb3NpdGlvbiwgUmFuZ2UgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5pbXBvcnQgdHlwZSB7IE5vZGUgfSBmcm9tIFwid2ViLXRyZWUtc2l0dGVyXCI7XG5cbi8qKlxuICogVHJlZS1zaXR0ZXIgaGVscGVycyBzaGFyZWQgYnkgZGlhZ25vc3RpY3MsIHRoZSBzaWduYWwtYWNjZXNzIGNvbGxlY3RvciBhbmRcbiAqIHRoZSBoaWVyYXJjaHkgdG9vbHMuIENlbnRyYWxpc2VkIHNvIHRoZSBub2RlLXR5cGUga25vd2xlZGdlIHRoYXQgdG9va1xuICogc2V2ZXJhbCBkZWJ1Z2dpbmcgcm91bmRzIHRvIHBpbiBkb3duIGxpdmVzIGluIGV4YWN0bHkgb25lIHBsYWNlLlxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l0aW9uKHA6IHsgcm93OiBudW1iZXI7IGNvbHVtbjogbnVtYmVyIH0pOiBQb3NpdGlvbiB7XG4gIHJldHVybiB7IGxpbmU6IHAucm93LCBjaGFyYWN0ZXI6IHAuY29sdW1uIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b1JhbmdlKG5vZGU6IE5vZGUpOiBSYW5nZSB7XG4gIHJldHVybiB7XG4gICAgc3RhcnQ6IHRvUG9zaXRpb24obm9kZS5zdGFydFBvc2l0aW9uKSxcbiAgICBlbmQ6IHRvUG9zaXRpb24obm9kZS5lbmRQb3NpdGlvbiksXG4gIH07XG59XG5cbi8qKiBEZXB0aC1maXJzdCB3YWxrIG92ZXIgZXZlcnkgbm9kZSwgaW5jbHVkaW5nIGFub255bW91cyBvbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uKiBpdGVyYXRlKHJvb3Q6IE5vZGUpOiBHZW5lcmF0b3I8Tm9kZT4ge1xuICBjb25zdCBzdGFjazogTm9kZVtdID0gW3Jvb3RdO1xuICB3aGlsZSAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IG5vZGUgPSBzdGFjay5wb3AoKSE7XG4gICAgeWllbGQgbm9kZTtcbiAgICBmb3IgKGxldCBpID0gbm9kZS5jaGlsZENvdW50IC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGNoaWxkID0gbm9kZS5jaGlsZChpKTtcbiAgICAgIGlmIChjaGlsZCkgc3RhY2sucHVzaChjaGlsZCk7XG4gICAgfVxuICB9XG59XG5cbi8qKiBBc3NpZ25tZW50IG5vZGUgdHlwZXMsIGluIGFsbCB0aGVpciBzcGVsbGluZ3MuICovXG5leHBvcnQgY29uc3QgQVNTSUdOTUVOVF9UWVBFUyA9IG5ldyBTZXQoW1xuICBcImJsb2NraW5nX2Fzc2lnbm1lbnRcIixcbiAgXCJub25ibG9ja2luZ19hc3NpZ25tZW50XCIsXG4gIFwibmV0X2Fzc2lnbm1lbnRcIixcbiAgXCJvcGVyYXRvcl9hc3NpZ25tZW50XCIsXG5dKTtcblxuLyoqXG4gKiBTcGxpdHMgYW4gYXNzaWdubWVudCBpbnRvIGl0cyBsdmFsdWUgYW5kIHZhbHVlLlxuICpcbiAqIEFzc2lnbm1lbnQgbm9kZXMgY2Fycnkgbm8gTFNQIGZpZWxkcywgc28gdGhlIG9wZXJhbmRzIGhhdmUgdG8gYmUgZm91bmQgYnlcbiAqIG5vZGUgdHlwZS4gYGJsb2NraW5nX2Fzc2lnbm1lbnRgIC8gYG5vbmJsb2NraW5nX2Fzc2lnbm1lbnRgIHdyYXAgdGhlIHJlYWxcbiAqIGBvcGVyYXRvcl9hc3NpZ25tZW50YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2lnbm1lbnRQYXJ0cyhub2RlOiBOb2RlKTogeyBsZWZ0OiBOb2RlIHwgbnVsbDsgcmlnaHQ6IE5vZGUgfCBudWxsIH0ge1xuICBsZXQgdGFyZ2V0ID0gbm9kZTtcbiAgaWYgKHRhcmdldC50eXBlID09PSBcImJsb2NraW5nX2Fzc2lnbm1lbnRcIiB8fCB0YXJnZXQudHlwZSA9PT0gXCJub25ibG9ja2luZ19hc3NpZ25tZW50XCIpIHtcbiAgICBjb25zdCBpbm5lciA9IHRhcmdldC5uYW1lZENoaWxkcmVuLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gXCJvcGVyYXRvcl9hc3NpZ25tZW50XCIpO1xuICAgIGlmIChpbm5lcikgdGFyZ2V0ID0gaW5uZXI7XG4gIH1cblxuICBjb25zdCBuYW1lZCA9IHRhcmdldC5uYW1lZENoaWxkcmVuO1xuICBjb25zdCBsdmFsdWUgPSBuYW1lZC5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwidmFyaWFibGVfbHZhbHVlXCIgfHwgYy50eXBlID09PSBcIm5ldF9sdmFsdWVcIik7XG4gIGNvbnN0IHZhbHVlID0gbmFtZWQuZmluZCgoYykgPT4gYy50eXBlID09PSBcImV4cHJlc3Npb25cIik7XG5cbiAgaWYgKGx2YWx1ZSAmJiB2YWx1ZSkgcmV0dXJuIHsgbGVmdDogbHZhbHVlLCByaWdodDogdmFsdWUgfTtcbiAgcmV0dXJuIHsgbGVmdDogbmFtZWRbMF0gPz8gbnVsbCwgcmlnaHQ6IG5hbWVkWzFdID8/IG51bGwgfTtcbn1cblxuLyoqIFRydWUgd2hlbiBgbmFtZWAgYXBwZWFycyBhbnl3aGVyZSBpbiB0aGUgc3VidHJlZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZW50aW9uc0lkZW50aWZpZXIobm9kZTogTm9kZSwgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgaW5uZXIgb2YgaXRlcmF0ZShub2RlKSkge1xuICAgIGlmIChpbm5lci50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgJiYgaW5uZXIudGV4dCA9PT0gbmFtZSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogUm9vdCBpZGVudGlmaWVyIG9mIGFuIGx2YWx1ZSwgaWdub3JpbmcgYml0IGFuZCBwYXJ0IHNlbGVjdHMuICovXG5leHBvcnQgZnVuY3Rpb24gbHZhbHVlTmFtZShub2RlOiBOb2RlIHwgbnVsbCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICghbm9kZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKG5vZGUudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKSByZXR1cm4gbm9kZS50ZXh0O1xuICBpZiAobm9kZS50eXBlID09PSBcImhpZXJhcmNoaWNhbF9pZGVudGlmaWVyXCIpIHJldHVybiBsdmFsdWVOYW1lKG5vZGUubmFtZWRDaGlsZCgwKSA/PyBudWxsKTtcbiAgaWYgKFxuICAgIG5vZGUudHlwZSA9PT0gXCJzZWxlY3RcIiB8fFxuICAgIG5vZGUudHlwZSA9PT0gXCJiaXRfc2VsZWN0XCIgfHxcbiAgICBub2RlLnR5cGUgPT09IFwicGFydF9zZWxlY3RfcmFuZ2VcIiB8fFxuICAgIG5vZGUudHlwZSA9PT0gXCJ2YXJpYWJsZV9sdmFsdWVcIiB8fFxuICAgIG5vZGUudHlwZSA9PT0gXCJuZXRfbHZhbHVlXCIgfHxcbiAgICBub2RlLnR5cGUgPT09IFwicHJpbWFyeVwiXG4gICkge1xuICAgIHJldHVybiBsdmFsdWVOYW1lKG5vZGUubmFtZWRDaGlsZHJlblswXSA/PyBudWxsKTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKiogSWRlbnRpZmllciBub2RlcyB3aG9zZSBmaXJzdCBuYW1lZCBjaGlsZCBpcyB0aGUgY2FsbGVkIHN1YnJvdXRpbmUuICovXG5mdW5jdGlvbiBpc0NhbGxUYXJnZXQobm9kZTogTm9kZSk6IGJvb2xlYW4ge1xuICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgaWYgKCFwYXJlbnQpIHJldHVybiBmYWxzZTtcbiAgaWYgKHBhcmVudC50eXBlICE9PSBcImZ1bmN0aW9uX2NhbGxcIiAmJiBwYXJlbnQudHlwZSAhPT0gXCJzeXN0ZW1fdGZfY2FsbFwiKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBwYXJlbnQubmFtZWRDaGlsZCgwKT8uaWQgPT09IG5vZGUuaWQ7XG59XG5cbi8qKlxuICogRXZlcnkgc2lnbmFsIG5hbWVkIGJ5IGFuIGV4cHJlc3Npb24sIHJlZHVjZWQgdG8gaXRzIHJvb3Q6IGBhLmJbM11gIGFuZFxuICogYGFgIGJvdGggeWllbGQgYGFgLCBiZWNhdXNlIHRoZSB0cmFjZXIgcmVhc29ucyBhYm91dCB3aG9sZSBuZXRzLlxuICpcbiAqIFN1YnJvdXRpbmUgbmFtZXMgYXJlIHNraXBwZWQgLS0gY2FsbGluZyBhIHRhc2sgaXMgbm90IGEgc2lnbmFsIGxvYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByb290SWRlbnRpZmllcnMobm9kZTogTm9kZSB8IG51bGwpOiBOb2RlW10ge1xuICBjb25zdCBmb3VuZDogTm9kZVtdID0gW107XG5cbiAgY29uc3QgdmlzaXQgPSAoY3VycmVudDogTm9kZSwgZGVwdGg6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIC8vIE9ubHkgdGhlIGxlYWRpbmcgaWRlbnRpZmllciBvZiBhIGhpZXJhcmNoaWNhbCBuYW1lIGlzIHRoZSBuZXQuXG4gICAgaWYgKGRlcHRoID4gMCAmJiBjdXJyZW50LnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikge1xuICAgICAgY29uc3Qgcm9vdCA9IGN1cnJlbnQubmFtZWRDaGlsZCgwKTtcbiAgICAgIGlmIChyb290KSB2aXNpdChyb290LCBkZXB0aCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChjdXJyZW50LnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIiAmJiAhaXNDYWxsVGFyZ2V0KGN1cnJlbnQpKSB7XG4gICAgICBmb3VuZC5wdXNoKGN1cnJlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGN1cnJlbnQubmFtZWRDaGlsZHJlbikgdmlzaXQoY2hpbGQsIGRlcHRoICsgMSk7XG4gIH07XG5cbiAgaWYgKG5vZGUpIHZpc2l0KG5vZGUsIDApO1xuICByZXR1cm4gZm91bmQ7XG59XG5cbi8qKiBUZXh0IG9mIHRoZSBgYWx3YXlzYCB2YXJpYW50LCBlLmcuIGBhbHdheXNfZmZgLCBvciBgYWx3YXlzYC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhbHdheXNLZXl3b3JkKG5vZGU6IE5vZGUpOiBzdHJpbmcge1xuICBjb25zdCB0ZXh0ID0gbm9kZS5jaGlsZCgwKT8udGV4dCA/PyBcIlwiO1xuICByZXR1cm4gdGV4dCA9PT0gXCJhbHdheXNcIiA/IFwiYWx3YXlzXCIgOiB0ZXh0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNTZXF1ZW50aWFsQmxvY2sobm9kZTogTm9kZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gbm9kZS50eXBlID09PSBcImFsd2F5c19jb25zdHJ1Y3RcIiAmJiBhbHdheXNLZXl3b3JkKG5vZGUpID09PSBcImFsd2F5c19mZlwiO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDb21iaW5hdGlvbmFsKG5vZGU6IE5vZGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vZGUudHlwZSA9PT0gXCJhbHdheXNfY29uc3RydWN0XCIgJiYgYWx3YXlzS2V5d29yZChub2RlKSA9PT0gXCJhbHdheXNfY29tYlwiO1xufVxuXG4vKiogTm9kZXMgdGhhdCBtZXJlbHkgd3JhcCBhIG5lc3RlZCBzdGF0ZW1lbnQuICovXG5leHBvcnQgY29uc3QgU1RBVEVNRU5UX1dSQVBQRVJTID0gbmV3IFNldChbXCJzdGF0ZW1lbnRcIiwgXCJzdGF0ZW1lbnRfaXRlbVwiLCBcInN0YXRlbWVudF9vcl9udWxsXCJdKTtcblxuLyoqIEZpcnN0IGxpbmUgb2YgdGV4dCwgdHJpbW1lZCwgZm9yIHNpbmdsZS1saW5lIGRpc3BsYXkgbGFiZWxzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpcnN0TGluZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lID0gdGV4dC5zcGxpdChcIlxcblwiLCAxKVswXSA/PyB0ZXh0O1xuICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDgwID8gYCR7dHJpbW1lZC5zbGljZSgwLCA3OSl9XHUyMDI2YCA6IHRyaW1tZWQ7XG59IiwgImltcG9ydCB0eXBlIHsgTm9kZSB9IGZyb20gXCJ3ZWItdHJlZS1zaXR0ZXJcIjtcblxuaW1wb3J0IHR5cGUge1xuICBBY2Nlc3NLaW5kLFxuICBBY2Nlc3NTb3VyY2UsXG4gIEFuYWx5c2lzLFxuICBIZGxTY29wZSxcbiAgSGRsU3ltYm9sLFxuICBJZGVudGlmaWVyVXNlLFxuICBQb3J0RGlyZWN0aW9uLFxuICBTaWduYWxBY2Nlc3MsXG4gIFN5bWJvbENhdGVnb3J5LFxufSBmcm9tIFwiLi9tb2RlbC5qc1wiO1xuaW1wb3J0IHsgQVNTSUdOTUVOVF9UWVBFUywgZmlyc3RMaW5lLCBsdmFsdWVOYW1lLCB0b1JhbmdlIH0gZnJvbSBcIi4vdHJlZXMuanNcIjtcblxuZXhwb3J0IHR5cGUgeyBBY2Nlc3NLaW5kLCBBY2Nlc3NTb3VyY2UsIFNpZ25hbEFjY2VzcyB9IGZyb20gXCIuL21vZGVsLmpzXCI7XG5cbi8qKlxuICogRXZlcnkgaWRlbnRpZmllciByZWZlcmVuY2UgYW5kIGV2ZXJ5IGRyaXZlL2xvYWQgYSBkb2N1bWVudCBkZWNsYXJlcywgZm91bmQgaW5cbiAqIGEgc2luZ2xlIHRyYXZlcnNhbC5cbiAqXG4gKiBUaGUgZWFybGllciB2ZXJzaW9uIHdhbGtlZCB0aGUgdHJlZSBvbmNlIHRvIGxpc3QgaWRlbnRpZmllciByZWZlcmVuY2VzIGFuZFxuICogdGhlbiwgZm9yIGVhY2ggb2YgdGhlbSwgcmUtZm91bmQgaXRzIG5vZGUgYnkgc2VhcmNoaW5nIGRvd24gZnJvbSB0aGUgcm9vdCAtLVxuICogY29udmVydGluZyBhbiBMU1AgcG9zaXRpb24gYmFjayB0byBhIGJ5dGUgb2Zmc2V0IGJ5IHJlYWRpbmcgdGhlIGRvY3VtZW50IG9uZVxuICogY2hhcmFjdGVyIGF0IGEgdGltZSB0aHJvdWdoIHRoZSBXQVNNIGJvdW5kYXJ5LiBPbiBhIDI1MC1saW5lIG1vZHVsZSB0aGF0IHdhc1xuICogOTUgbXMgb2YgdGhlIDEwMCBtcyBhbiBhbmFseXNpcyB0b29rLCBhbmQgaXQgcmFuIG9uIGV2ZXJ5IGtleXN0cm9rZS5cbiAqXG4gKiBFdmVyeXRoaW5nIGJvdGggY29uc3VtZXJzIG5lZWQgaXMgYWxyZWFkeSB2aXNpYmxlIHdoaWxlIHdhbGtpbmc6IHRoZVxuICogYW5jZXN0b3JzIG9uIHRoZSBzdGFjayBzYXkgd2hldGhlciBhIG5hbWUgaXMgYmVpbmcgZHJpdmVuLCB3aGV0aGVyIGl0IHNpdHMgaW5cbiAqIGFuIGBhc3NpZ25gIG9yIGluc2lkZSBhbiBpbnN0YW50aWF0aW9uLCBhbmQgd2hpY2ggc3RhdGVtZW50IGl0IGJlbG9uZ3MgdG8uXG4gKiBTbyB0aGUgd2FsayBpcyBkb25lIG9uY2UgYW5kIG5vdGhpbmcgaXMgbG9va2VkIHVwIGFmdGVyd2FyZHMgLS0gYW5kIGJlY2F1c2UgYVxuICogcmVmZXJlbmNlICppcyogdGhlIHRoaW5nIHRoZSB0cmFjZXIgY2xhc3NpZmllcywgdGhlIHR3byByZXN1bHRzIGNvbWUgZnJvbSB0aGVcbiAqIHNhbWUgdmlzaXQgcmF0aGVyIHRoYW4gZnJvbSB0d28gd2Fsa3Mgb2YgdGhlIHNhbWUgdHJlZS5cbiAqL1xuXG4vKiogV2hhdCBvbmUgdHJhdmVyc2FsIG9mIHRoZSBkb2N1bWVudCB5aWVsZHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlZmVyZW5jZXMge1xuICAvKiogRXZlcnkgbmFtZSAqdXNlZCogaW4gdGhlIGRvY3VtZW50LCBkZWNsYXJhdGlvbnMgZXhjbHVkZWQuICovXG4gIHJlYWRvbmx5IHVzZXM6IElkZW50aWZpZXJVc2VbXTtcbiAgLyoqIEV2ZXJ5IGRyaXZlIGFuZCBsb2FkLCBmb3IgdGhlIFNpZ25hbCBUcmFjZXIuICovXG4gIHJlYWRvbmx5IGFjY2Vzc2VzOiBTaWduYWxBY2Nlc3NbXTtcbn1cblxuLyoqIENvbnN0cnVjdHMgdGhhdCBlbmQgYSBzdGF0ZW1lbnQ6IGEgcmVmZXJlbmNlIGFib3ZlIHRoZW0gaXMgb3V0IG9mIGNvbnRleHQuICovXG5jb25zdCBTQ09QRV9CT1VOREFSSUVTID0gbmV3IFNldChbXG4gIFwibW9kdWxlX2RlY2xhcmF0aW9uXCIsXG4gIFwiaW50ZXJmYWNlX2RlY2xhcmF0aW9uXCIsXG4gIFwicHJvZ3JhbV9kZWNsYXJhdGlvblwiLFxuICBcInBhY2thZ2VfZGVjbGFyYXRpb25cIixcbiAgXCJjbGFzc19kZWNsYXJhdGlvblwiLFxuICBcImdlbmVyYXRlXCIsXG4gIFwiZ2VuZXJhdGVfcmVnaW9uXCIsXG5dKTtcblxuLyoqIFN5bWJvbCBjYXRlZ29yaWVzIHRoYXQgY2FycnkgYSB2YWx1ZSB0aGUgdHJhY2VyIHNob3VsZCBmb2xsb3cuICovXG5jb25zdCBTSUdOQUxfQ0FURUdPUklFUyA9IG5ldyBTZXQ8U3ltYm9sQ2F0ZWdvcnk+KFtcIm5ldFwiLCBcInZhcmlhYmxlXCIsIFwicG9ydFwiXSk7XG5cbi8qKlxuICogTm9kZXMgd2hvc2UgaWRlbnRpZmllcnMgYXJlIGRlY2xhcmF0aW9ucywgbm90IHJlZmVyZW5jZXMuXG4gKlxuICogQW4gZW51bSBsaXRlcmFsIGluc2lkZSBgZW51bSB7SURMRSwgUlVOfWAgaXMgcGFydCBvZiBhIGRlY2xhcmF0aW9uLiBDb3VudGluZ1xuICogaXQgYXMgYSB1c2Ugd291bGQgcmVwb3J0IGV2ZXJ5IGVudW0gbWVtYmVyIGFzIGFuIHVuZGVjbGFyZWQgaWRlbnRpZmllciBhbmRcbiAqIG9mZmVyIHRoZW0gYXMgY29tcGxldGlvbnMgb2YgdGhpbmdzIHRoYXQgZG8gbm90IGV4aXN0LlxuICovXG5jb25zdCBERUNMQVJBVElPTl9PTkxZX1RZUEVTID0gbmV3IFNldChbXCJlbnVtX25hbWVfZGVjbGFyYXRpb25cIl0pO1xuXG4vKipcbiAqIFByZXByb2Nlc3NvciBub2Rlcywgd2hvc2UgdGV4dCBpcyBub3QgY29kZSB0aGUgYXV0aG9yIHdyb3RlIGhlcmUuXG4gKlxuICogYE5BTUVgLCBgUkFOR0VgIGFuZCBgQVNTSUdOTUVOVGAgaW5zaWRlIGBgIGBkZWZpbmUgVE1SKE5BTUUsIFJBTkdFLFxuICogQVNTSUdOTUVOVCkgYGAgYXJlIHRoZSBtYWNybydzICpmb3JtYWwgYXJndW1lbnRzKiwgbm90IHVuZGVjbGFyZWQgc2lnbmFscy5cbiAqIENvdW50aW5nIHRoZW0gYXMgcmVmZXJlbmNlcyByZXBvcnRlZCBldmVyeSBvbmUgb2YgdGhlbSBhcyBhbiB1bmtub3duXG4gKiBpZGVudGlmaWVyIC0tIHR3ZW50eSBmaW5kaW5ncyBpbiBhIHNpbmdsZSBoZWFkZXIgZmlsZS4gQSBtYWNybyBib2R5IGlzIG5vdFxuICogSERMIHVudGlsIHNvbWVib2R5IGNhbGxzIGl0LCBzbyB0aGUgdHJhdmVyc2FsIGRvZXMgbm90IGRlc2NlbmQgaW50byBpdC5cbiAqXG4gKiBBIG1hY3JvICppbnZvY2F0aW9uKiBpcyB0aGUgb3Bwb3NpdGUgY2FzZSBhbmQgaXMgZGVsaWJlcmF0ZWx5IGFic2VudCBmcm9tXG4gKiB0aGlzIHNldDogYGAgYFRNUihyZF9wdCwscmRfcHRfbmV4dCkgYGAgbmFtZXMgcmVhbCBzaWduYWxzIGluIGl0cyBhcmd1bWVudHMsXG4gKiBhbmQgdGhvc2UgYXJlIHRoZSBvbmVzIHRoZSB0cmFjZXIgc2hvdWxkIGZvbGxvdy5cbiAqL1xuY29uc3QgUFJFUFJPQ0VTU09SX1RZUEVTID0gbmV3IFNldChbXG4gIFwidGV4dF9tYWNyb19kZWZpbml0aW9uXCIsXG4gIFwiY29uZGl0aW9uYWxfY29tcGlsYXRpb25fZGlyZWN0aXZlXCIsXG4gIFwiaW5jbHVkZV9jb21waWxlcl9kaXJlY3RpdmVcIixcbiAgXCJ1bmRlZmluZV9jb21waWxlcl9kaXJlY3RpdmVcIixcbiAgXCJjb21waWxlcl9kaXJlY3RpdmVcIixcbl0pO1xuXG4vKiogRGlyZWN0aW9uIGltcGxpZXMgcmVhZC93cml0ZSBhY3Jvc3MgYSBwb3J0IGJvdW5kYXJ5LiAqL1xuZnVuY3Rpb24gYm91bmRhcnlLaW5kKGRpcmVjdGlvbjogUG9ydERpcmVjdGlvbiB8IHVuZGVmaW5lZCk6IEFjY2Vzc0tpbmQgfCB1bmRlZmluZWQge1xuICBpZiAoZGlyZWN0aW9uID09PSBcImlucHV0XCIpIHJldHVybiBcImRyaXZlXCI7XG4gIGlmIChkaXJlY3Rpb24gPT09IFwib3V0cHV0XCIgfHwgZGlyZWN0aW9uID09PSBcImlub3V0XCIpIHJldHVybiBcImxvYWRcIjtcbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqIFBvcnQgZGVjbGFyYXRpb25zIG9mIGV2ZXJ5IG1vZHVsZSBhbmQgaW50ZXJmYWNlIGluIHRoZSBkb2N1bWVudC4gKi9cbmZ1bmN0aW9uIHBvcnREZWNsYXJhdGlvbnMoYW5hbHlzaXM6IEFuYWx5c2lzKTogeyBzeW1ib2w6IEhkbFN5bWJvbDsgc2NvcGVJZDogbnVtYmVyIH1bXSB7XG4gIGNvbnN0IG91dDogeyBzeW1ib2w6IEhkbFN5bWJvbDsgc2NvcGVJZDogbnVtYmVyIH1bXSA9IFtdO1xuICBjb25zdCB3YWxrID0gKHNjb3BlczogcmVhZG9ubHkgSGRsU2NvcGVbXSk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3Qgc2NvcGUgb2Ygc2NvcGVzKSB7XG4gICAgICBmb3IgKGNvbnN0IHN5bWJvbCBvZiBzY29wZS5wb3J0cykge1xuICAgICAgICBpZiAoIWJvdW5kYXJ5S2luZChzeW1ib2wuZGlyZWN0aW9uKSkgY29udGludWU7XG4gICAgICAgIG91dC5wdXNoKHsgc3ltYm9sLCBzY29wZUlkOiBzY29wZS5pZCB9KTtcbiAgICAgIH1cbiAgICAgIHdhbGsoc2NvcGUuY2hpbGRyZW4pO1xuICAgIH1cbiAgfTtcbiAgd2FsayhhbmFseXNpcy5zY29wZXMpO1xuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIEV2ZXJ5IHNpZ25hbCBuYW1lIHRoZSBkb2N1bWVudCBkZWNsYXJlcywgYXMgb25lIHNldC5cbiAqXG4gKiBUaGUgcHJldmlvdXMgcGVyLW5hbWUgbG9va3VwIHdhbGtlZCBhIHNjb3BlJ3Mgc3ltYm9sIGxpc3QgZm9yIGV2ZXJ5XG4gKiByZWZlcmVuY2U7IHdpdGggYSBmZXcgaHVuZHJlZCByZWZlcmVuY2VzIGFnYWluc3QgYSBmZXcgaHVuZHJlZCBzeW1ib2xzIHRoYXRcbiAqIGlzIHF1YWRyYXRpYyBpbiB0aGUgc2l6ZSBvZiB0aGUgZmlsZS4gQSBzaW5nbGUgc2V0IGFuc3dlcnMgaXQgaW4gY29uc3RhbnRcbiAqIHRpbWUsIGF0IHRoZSBjb3N0IG9mIG5vdCBkaXN0aW5ndWlzaGluZyBhIGxvY2FsIG5hbWUgZnJvbSBhIG5lc3RlZCBvbmUgLS1cbiAqIHdoaWNoIG9ubHkgZXZlciB0dXJucyBhIG5vbi1zaWduYWwgaW50byBhIHRyYWNlZCBvbmUsIGFuZCBldmVyeSBuYW1lIGhlcmUgaXNcbiAqIGFscmVhZHkgY2hlY2tlZCBhZ2FpbnN0IHRoZSBkZWNsYXJhdGlvbiB0YWJsZXMgd2hlbiBpdCBpcyByZWNvcmRlZC5cbiAqL1xuZnVuY3Rpb24gZGVjbGFyZWRTaWduYWxOYW1lcyhhbmFseXNpczogQW5hbHlzaXMpOiBTZXQ8c3RyaW5nPiB7XG4gIGNvbnN0IG5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHdhbGsgPSAoc2NvcGVzOiByZWFkb25seSBIZGxTY29wZVtdKTogdm9pZCA9PiB7XG4gICAgZm9yIChjb25zdCBzY29wZSBvZiBzY29wZXMpIHtcbiAgICAgIGZvciAoY29uc3Qgc3ltYm9sIG9mIHNjb3BlLnBvcnRzKSBpZiAoU0lHTkFMX0NBVEVHT1JJRVMuaGFzKHN5bWJvbC5jYXRlZ29yeSkpIG5hbWVzLmFkZChzeW1ib2wubmFtZSk7XG4gICAgICBmb3IgKGNvbnN0IHN5bWJvbCBvZiBzY29wZS5zeW1ib2xzKSBpZiAoU0lHTkFMX0NBVEVHT1JJRVMuaGFzKHN5bWJvbC5jYXRlZ29yeSkpIG5hbWVzLmFkZChzeW1ib2wubmFtZSk7XG4gICAgICB3YWxrKHNjb3BlLmNoaWxkcmVuKTtcbiAgICB9XG4gIH07XG4gIHdhbGsoYW5hbHlzaXMuc2NvcGVzKTtcbiAgcmV0dXJuIG5hbWVzO1xufVxuXG4vKipcbiAqIFNjb3BlcyBpbmRleGVkIGJ5IHRoZSBieXRlIG9mZnNldCB0aGV5IHN0YXJ0IGF0LlxuICpcbiAqIFRoZSB3YWxrIHB1c2hlcyBhIHNjb3BlIHdoZW4gaXQgcmVhY2hlcyBpdHMgZmlyc3QgYnl0ZSBhbmQgcG9wcyBpdCBvbiB0aGUgd2F5XG4gKiBvdXQsIHdoaWNoIGlzIGhvdyBlYWNoIHJlZmVyZW5jZSBnZXRzIGl0cyBlbmNsb3Npbmcgc2NvcGUgd2l0aG91dCBhc2tpbmcgdGhlXG4gKiBhbmFseXplciB0byBzZWFyY2ggYSByYW5nZSBsaXN0IGZvciBldmVyeSBpZGVudGlmaWVyLiBUaGUgcmFuZ2UgaW5kZXggYWxyZWFkeVxuICogc3RvcmVzIHRob3NlIGJ5dGUgb2Zmc2V0cywgc28gbm8gcG9zaXRpb24gaXMgY29udmVydGVkIGJhY2sgaGVyZS5cbiAqL1xuZnVuY3Rpb24gc2NvcGVzQnlTdGFydChhbmFseXNpczogQW5hbHlzaXMpOiBNYXA8bnVtYmVyLCBIZGxTY29wZVtdPiB7XG4gIGNvbnN0IGJ5U3RhcnQgPSBuZXcgTWFwPG51bWJlciwgSGRsU2NvcGVbXT4oKTtcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBhbmFseXNpcy5zY29wZXNCeVJhbmdlKSB7XG4gICAgY29uc3QgbGlzdCA9IGJ5U3RhcnQuZ2V0KGVudHJ5LnN0YXJ0KTtcbiAgICBpZiAobGlzdCkgbGlzdC5wdXNoKGVudHJ5LnNjb3BlKTtcbiAgICBlbHNlIGJ5U3RhcnQuc2V0KGVudHJ5LnN0YXJ0LCBbZW50cnkuc2NvcGVdKTtcbiAgfVxuICByZXR1cm4gYnlTdGFydDtcbn1cblxuLyoqXG4gKiBDb2xsZWN0cyBldmVyeSBkcml2ZSBhbmQgbG9hZCBkZWNsYXJlZCBkaXJlY3RseSBpbiB0aGUgZG9jdW1lbnQ6IGFzc2lnbm1lbnRzLFxuICogZGVjbGFyYXRpb24gaW5pdGlhbGlzZXJzIGFuZCBwb3J0IGRlY2xhcmF0aW9ucy5cbiAqXG4gKiBJbnN0YW5jZSBjb25uZWN0aW9ucyBhcmUgZGVsaWJlcmF0ZWx5ICpub3QqIGhhbmRsZWQgaGVyZS4gUmVzb2x2aW5nIG9uZSBuZWVkc1xuICogdGhlIHBvcnQgZGlyZWN0aW9uIG9mIHRoZSBpbnN0YW50aWF0ZWQgbW9kdWxlLCB3aGljaCBsaXZlcyBpbiB0aGUgY2F0YWxvZyAtLVxuICogYW5kIHRoZSBjYXRhbG9nIGlzIGJ1aWx0IGZyb20gdGhpcyBhbmFseXNpcy4gUmVzb2x2aW5nIHRoZW0gbGF0ZXIsIGFnYWluc3QgYVxuICogZmluaXNoZWQgY2F0YWxvZywga2VlcHMgdGhhdCBkZXBlbmRlbmN5IG9uZS1kaXJlY3Rpb25hbC5cbiAqXG4gKiBgdGV4dGAgaXMgdGhlIGRvY3VtZW50J3Mgc291cmNlLCBwYXNzZWQgaW4gc28gYSBub2RlJ3MgY2hhcmFjdGVycyBjYW4gYmVcbiAqIHNsaWNlZCBvdXQgb2YgaXQgcmF0aGVyIHRoYW4gcmVhZCBiYWNrIHRocm91Z2ggdGhlIFdBU00gYm91bmRhcnkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2xsZWN0UmVmZXJlbmNlcyhhbmFseXNpczogQW5hbHlzaXMsIHRleHQ6IHN0cmluZyk6IFJlZmVyZW5jZXMge1xuICBjb25zdCBhY2Nlc3NlczogU2lnbmFsQWNjZXNzW10gPSBbXTtcbiAgY29uc3QgdXNlczogSWRlbnRpZmllclVzZVtdID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3Qgc2lnbmFsTmFtZXMgPSBkZWNsYXJlZFNpZ25hbE5hbWVzKGFuYWx5c2lzKTtcbiAgY29uc3Qgc2NvcGVTdGFydHMgPSBzY29wZXNCeVN0YXJ0KGFuYWx5c2lzKTtcbiAgY29uc3QgZGVjbGFyYXRpb25zID0gYW5hbHlzaXMuZGVjbGFyYXRpb25OYW1lcztcblxuICBjb25zdCBzbGljZSA9IChub2RlOiBOb2RlKTogc3RyaW5nID0+IHRleHQuc2xpY2Uobm9kZS5zdGFydEluZGV4LCBub2RlLmVuZEluZGV4KTtcblxuICAvKipcbiAgICogUmVjb3JkcyBvbmUgYWNjZXNzLCBkcm9wcGluZyBuYW1lcyB0aGF0IGFyZSBub3Qgc2lnbmFscyBpbiB0aGlzIGRvY3VtZW50LlxuICAgKlxuICAgKiBgc2l0ZUtleWAgaWRlbnRpZmllcyB0aGUgc3RhdGVtZW50IHJhdGhlciB0aGFuIHRoZSBpbmRpdmlkdWFsIHJlYWQsIHNvIGFcbiAgICogc2lnbmFsIHJlYWQgdHdpY2UgaW4gb25lIGV4cHJlc3Npb24gKGB3cHRyW0FXLTFdICE9IHJwdHJbQVctMV1gKSBpcyBsaXN0ZWRcbiAgICogb25jZSAtLSBhIHRyYWNlciB3YW50cyB0aGUgc3RhdGVtZW50IHRoYXQgdG91Y2hlcyBpdCwgbm90IGV2ZXJ5IG1lbnRpb24uXG4gICAqL1xuICBjb25zdCByZWNvcmQgPSAoXG4gICAgbm9kZTogTm9kZSxcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgc2NvcGVJZDogbnVtYmVyLFxuICAgIGtpbmQ6IEFjY2Vzc0tpbmQsXG4gICAgc291cmNlOiBBY2Nlc3NTb3VyY2UsXG4gICAgZGV0YWlsOiBzdHJpbmcsXG4gICAgc2l0ZUtleTogc3RyaW5nLFxuICApOiB2b2lkID0+IHtcbiAgICAvLyBgQVctMWAgaXMgYSBwYXJhbWV0ZXIgcmVhZCwgbm90IGEgbmV0OyBrZWVwIHRoZSB0cmFjZXIgdG8gcmVhbCBzaWduYWxzLlxuICAgIGlmICghc2lnbmFsTmFtZXMuaGFzKG5hbWUpKSByZXR1cm47XG5cbiAgICBjb25zdCBrZXkgPSBgJHtuYW1lfXwke2tpbmR9fCR7c291cmNlfXwke3NpdGVLZXl9YDtcbiAgICBpZiAoc2Vlbi5oYXMoa2V5KSkgcmV0dXJuO1xuICAgIHNlZW4uYWRkKGtleSk7XG5cbiAgICBhY2Nlc3Nlcy5wdXNoKHsgbmFtZSwgc2NvcGVJZCwga2luZCwgcmFuZ2U6IHRvUmFuZ2Uobm9kZSksIHNvdXJjZSwgZGV0YWlsIH0pO1xuICB9O1xuXG4gIGZvciAoY29uc3QgeyBzeW1ib2wsIHNjb3BlSWQgfSBvZiBwb3J0RGVjbGFyYXRpb25zKGFuYWx5c2lzKSkge1xuICAgIGNvbnN0IGtpbmQgPSBib3VuZGFyeUtpbmQoc3ltYm9sLmRpcmVjdGlvbik7XG4gICAgaWYgKCFraW5kKSBjb250aW51ZTtcblxuICAgIC8vIFRoZSBzeW1ib2wgY2FycmllcyBhIFJhbmdlLCBub3QgYSBOb2RlOyBzeW50aGVzaXNlIHRoZSByZWNvcmQgZGlyZWN0bHkuXG4gICAgYWNjZXNzZXMucHVzaCh7XG4gICAgICBuYW1lOiBzeW1ib2wubmFtZSxcbiAgICAgIHNjb3BlSWQsXG4gICAgICBraW5kLFxuICAgICAgcmFuZ2U6IHN5bWJvbC5zZWxlY3Rpb25SYW5nZSxcbiAgICAgIHNvdXJjZToga2luZCA9PT0gXCJkcml2ZVwiID8gXCJwb3J0X2lucHV0XCIgOiBcInBvcnRfb3V0cHV0XCIsXG4gICAgICBkZXRhaWw6IGtpbmQgPT09IFwiZHJpdmVcIiA/IFwiaW5wdXQgcG9ydFwiIDogXCJvdXRwdXQgcG9ydFwiLFxuICAgICAgcG9ydDogc3ltYm9sLm5hbWUsXG4gICAgfSk7XG4gIH1cblxuICAvLyAtLS0gdGhlIHNpbmdsZSB0cmF2ZXJzYWwgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvL1xuICAvLyBgcGF0aGAgaXMgdGhlIGNoYWluIG9mIGFuY2VzdG9ycyBvZiB0aGUgbm9kZSBiZWluZyBleGFtaW5lZC4gUmVhZGluZyBpdFxuICAvLyBhbnN3ZXJzIGV2ZXJ5IFwiaXMgdGhpcyBpbnNpZGUgYW4gYXNzaWduIC8gYW4gaW5zdGFudGlhdGlvbiAvIGEgc3RhdGVtZW50XCJcbiAgLy8gcXVlc3Rpb24gd2l0aG91dCB0b3VjaGluZyB0aGUgdHJlZSBhZ2FpbiwgYmVjYXVzZSB0aG9zZSBub2RlcyB3ZXJlIGFscmVhZHlcbiAgLy8gdmlzaXRlZCBvbiB0aGUgd2F5IGRvd24uXG5cbiAgY29uc3QgcGF0aDogTm9kZVtdID0gW107XG4gIC8qKiBTY29wZSBzdGFjaywgcGFyYWxsZWwgdG8gYHBhdGhgOyB0aGUgbGFzdCBlbnRyeSBpcyB0aGUgaW5uZXJtb3N0IHNjb3BlLiAqL1xuICBjb25zdCBzY29wZVN0YWNrOiBIZGxTY29wZVtdID0gW107XG5cbiAgY29uc3Qgb25FbnRlciA9IChub2RlOiBOb2RlKTogdm9pZCA9PiB7XG4gICAgcGF0aC5wdXNoKG5vZGUpO1xuXG4gICAgY29uc3Qgb3BlbmVkID0gc2NvcGVTdGFydHMuZ2V0KG5vZGUuc3RhcnRJbmRleCk7XG4gICAgaWYgKG9wZW5lZCkgc2NvcGVTdGFjay5wdXNoKC4uLm9wZW5lZCk7XG4gIH07XG5cbiAgY29uc3Qgb25MZWF2ZSA9IChub2RlOiBOb2RlKTogdm9pZCA9PiB7XG4gICAgcGF0aC5wb3AoKTtcbiAgICBjb25zdCBvcGVuZWQgPSBzY29wZVN0YXJ0cy5nZXQobm9kZS5zdGFydEluZGV4KTtcbiAgICBpZiAob3BlbmVkKSBzY29wZVN0YWNrLmxlbmd0aCAtPSBvcGVuZWQubGVuZ3RoO1xuICB9O1xuXG4gIC8qKiBUcnVlIHdoZW4gYSBgY29udGludW91c19hc3NpZ25gIGVuY2xvc2VzIHRoZSBjdXJyZW50IG5vZGUuICovXG4gIGNvbnN0IGluc2lkZUNvbnRpbnVvdXNBc3NpZ24gPSAoKTogYm9vbGVhbiA9PiB7XG4gICAgZm9yIChsZXQgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHR5cGUgPSBwYXRoW2ldIS50eXBlO1xuICAgICAgaWYgKHR5cGUgPT09IFwiY29udGludW91c19hc3NpZ25cIikgcmV0dXJuIHRydWU7XG4gICAgICBpZiAoU0NPUEVfQk9VTkRBUklFUy5oYXModHlwZSkpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBUcnVlIHdoZW4gdGhlIGN1cnJlbnQgbm9kZSBzaXRzIGluc2lkZSBhbiBpbnN0YW50aWF0aW9uLlxuICAgKlxuICAgKiBOYW1lcyB0aGVyZSBhcmUgcG9ydCBjb25uZWN0aW9ucyByYXRoZXIgdGhhbiBzaWduYWxzIHRoZSBtb2R1bGUgYm9keSByZWFkc1xuICAgKiBvciB3cml0ZXMsIGFuZCB0aGV5IGFyZSByZXBvcnRlZCBvbmNlIHRoZSBwb3J0IGRpcmVjdGlvbnMgYXJlIGtub3duLlxuICAgKi9cbiAgY29uc3QgaW5zaWRlSW5zdGFudGlhdGlvbiA9ICgpOiBib29sZWFuID0+IHtcbiAgICBmb3IgKGxldCBpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgdHlwZSA9IHBhdGhbaV0hLnR5cGU7XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2luc3RhbmNlXCIgfHxcbiAgICAgICAgdHlwZSA9PT0gXCJtb2R1bGVfaW5zdGFudGlhdGlvblwiIHx8XG4gICAgICAgIHR5cGUgPT09IFwibGlzdF9vZl9wb3J0X2Nvbm5lY3Rpb25zXCJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmIChTQ09QRV9CT1VOREFSSUVTLmhhcyh0eXBlKSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH07XG5cbiAgLyoqIFRoZSBhc3NpZ25tZW50IGx2YWx1ZSB0aGUgY3VycmVudCBub2RlIHNpdHMgaW5zaWRlLCBpZiBhbnkuICovXG4gIGNvbnN0IGVuY2xvc2luZ0x2YWx1ZSA9ICgpOiBOb2RlIHwgdW5kZWZpbmVkID0+IHtcbiAgICBmb3IgKGxldCBpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgdHlwZSA9IHBhdGhbaV0hLnR5cGU7XG4gICAgICBpZiAodHlwZSA9PT0gXCJ2YXJpYWJsZV9sdmFsdWVcIiB8fCB0eXBlID09PSBcIm5ldF9sdmFsdWVcIikgcmV0dXJuIHBhdGhbaV07XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH07XG5cbiAgLyoqIFRoZSBuZWFyZXN0IGVuY2xvc2luZyBhc3NpZ25tZW50LCB1c2VkIHRvIGRlc2NyaWJlIGEgd3JpdGUuICovXG4gIGNvbnN0IGVuY2xvc2luZ0Fzc2lnbm1lbnQgPSAoKTogTm9kZSB8IHVuZGVmaW5lZCA9PiB7XG4gICAgZm9yIChsZXQgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IHR5cGUgPSBwYXRoW2ldIS50eXBlO1xuICAgICAgaWYgKEFTU0lHTk1FTlRfVFlQRVMuaGFzKHR5cGUpKSByZXR1cm4gcGF0aFtpXTtcbiAgICAgIGlmIChTQ09QRV9CT1VOREFSSUVTLmhhcyh0eXBlKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfTtcblxuICAvKipcbiAgICogVGhlIHN0YXRlbWVudCB0aGUgY3VycmVudCBub2RlIGJlbG9uZ3MgdG8sIHdoaWNoIGlzIHdoYXQgc2hvdWxkIGJlIHNob3duOlxuICAgKiBgYWx3YXlzX2ZmIEAocG9zZWRnZSBjbGspIHEgPD0gZDtgIHJlcG9ydHMgdGhlIHdob2xlIGFsd2F5cyBibG9jayByYXRoZXJcbiAgICogdGhhbiBqdXN0IHRoZSBhc3NpZ25tZW50IGJ1cmllZCBpbnNpZGUgaXRzIHdyYXBwZXIgbm9kZXMuXG4gICAqL1xuICBjb25zdCBlbmNsb3NpbmdTdGF0ZW1lbnQgPSAoKTogTm9kZSB8IHVuZGVmaW5lZCA9PiB7XG4gICAgZm9yIChsZXQgaSA9IHBhdGgubGVuZ3RoIC0gMjsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGlmIChTQ09QRV9CT1VOREFSSUVTLmhhcyhwYXRoW2ldIS50eXBlKSkgcmV0dXJuIHBhdGhbaSArIDFdO1xuICAgIH1cbiAgICByZXR1cm4gcGF0aFswXTtcbiAgfTtcblxuICAvKipcbiAgICogSWRlbnRpZmllcyB0aGUgKnBvaW50KiBhbiBhY2Nlc3MgaGFwcGVucyBhdCwgZm9yIGRlZHVwbGljYXRpb24uXG4gICAqXG4gICAqIGBwYCByZWFkIHR3aWNlIGluIGAocCA9PSBxKSB8fCAocCAhPSBxKWAgaXMgb25lIGxvZ2ljYWwgbG9hZCwgc28gdGhlIGtleVxuICAgKiBjbGltYnMgdG8gdGhlIG91dGVybW9zdCBiaW5hcnkgZXhwcmVzc2lvbi4gQnV0IGBpZiAoZCkgcSA9IGQ7YCBpcyB0d29cbiAgICogcG9pbnRzLCBhbmQgdGhvc2Ugc2l0IHVuZGVyIGRpZmZlcmVudCBgY29uZGl0aW9uYWxfc3RhdGVtZW50YCBicmFuY2hlcywgc29cbiAgICogdGhlIHdhbGsgc3RvcHMgYXQgYSBzdGF0ZW1lbnQgb3IgYSBibG9jayBib3VuZGFyeS5cbiAgICovXG4gIGNvbnN0IHNpdGVLZXlGb3IgPSAobm9kZTogTm9kZSk6IHN0cmluZyA9PiB7XG4gICAgbGV0IGtleTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgZm9yIChsZXQgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBwYXRoW2ldITtcbiAgICAgIGlmIChBQ0NFU1NfUE9JTlRfVFlQRVMuaGFzKGN1cnJlbnQudHlwZSkpIHtcbiAgICAgICAgLy8gQSBzdGF0ZW1lbnQgYm91bmRhcnkgd2luczogZG8gbm90IGNsaW1iIHBhc3QgaXQuXG4gICAgICAgIGtleSA9IGAke2N1cnJlbnQudHlwZX1AJHtjdXJyZW50LnN0YXJ0SW5kZXh9YDtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAoU0NPUEVfQk9VTkRBUklFUy5oYXMoY3VycmVudC50eXBlKSkgYnJlYWs7XG4gICAgICBpZiAoIUVYUFJFU1NJT05fV1JBUFBFUlMuaGFzKGN1cnJlbnQudHlwZSkpIHtcbiAgICAgICAga2V5ID0gYCR7Y3VycmVudC50eXBlfUAke2N1cnJlbnQuc3RhcnRJbmRleH1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBrZXkgPz8gYG5vZGVAJHtub2RlLnN0YXJ0SW5kZXh9YDtcbiAgfTtcblxuICAvKipcbiAgICogQSBvbmUtbGluZSBkZXNjcmlwdGlvbiBvZiB0aGUgYWNjZXNzLlxuICAgKlxuICAgKiBJbnNpZGUgYW4gYGFsd2F5c2AgYmxvY2sgdGhlIGhlYWRlciBzYXlzIG5vdGhpbmcgYWJvdXQgd2hpY2ggc3RhdGVtZW50XG4gICAqIHRvdWNoZWQgdGhlIHNpZ25hbCwgc28gdGhlIGFzc2lnbm1lbnQgaXMgc2hvd24gaW5zdGVhZCBhbmQgdGhlIGVuY2xvc2luZ1xuICAgKiBibG9jayBpcyBuYW1lZC4gT3V0c2lkZSBvbmUsIHRoZSBzdGF0ZW1lbnQgaXMgYWxyZWFkeSB0aGUgdXNlZnVsIHRoaW5nLlxuICAgKi9cbiAgY29uc3QgZGVzY3JpYmVBY2Nlc3MgPSAoKTogc3RyaW5nID0+IHtcbiAgICBjb25zdCBzdGF0ZW1lbnQgPSBlbmNsb3NpbmdTdGF0ZW1lbnQoKTtcbiAgICBpZiAoIXN0YXRlbWVudCkgcmV0dXJuIFwiXCI7XG5cbiAgICAvLyBgYXNzaWduIHkgPSBhICYgYjtgIGlzIGFscmVhZHkgYSBjb21wbGV0ZSBzdGF0ZW1lbnQ7IGtlZXAgaXQuXG4gICAgaWYgKHN0YXRlbWVudC50eXBlID09PSBcImNvbnRpbnVvdXNfYXNzaWduXCIpIHJldHVybiBmaXJzdExpbmUoc2xpY2Uoc3RhdGVtZW50KSk7XG5cbiAgICBjb25zdCBhc3NpZ25tZW50ID0gZW5jbG9zaW5nQXNzaWdubWVudCgpO1xuICAgIGlmIChhc3NpZ25tZW50ICYmIGFzc2lnbm1lbnQuaWQgIT09IHN0YXRlbWVudC5pZCkgcmV0dXJuIGZpcnN0TGluZShzbGljZShhc3NpZ25tZW50KSk7XG5cbiAgICByZXR1cm4gZmlyc3RMaW5lKHNsaWNlKHN0YXRlbWVudCkpO1xuICB9O1xuXG4gIGNvbnN0IHZpc2l0ID0gKG5vZGU6IE5vZGUpOiB2b2lkID0+IHtcbiAgICBvbkVudGVyKG5vZGUpO1xuXG4gICAgaWYgKG5vZGUudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiICYmICFkZWNsYXJhdGlvbnMuaGFzKG5vZGUuaWQpKSB7XG4gICAgICBjb25zdCBuYW1lID0gc2xpY2Uobm9kZSk7XG4gICAgICBjb25zdCBzY29wZUlkID0gc2NvcGVTdGFja1tzY29wZVN0YWNrLmxlbmd0aCAtIDFdPy5pZCA/PyAtMTtcblxuICAgICAgdXNlcy5wdXNoKHsgbmFtZSwgcmFuZ2U6IHRvUmFuZ2Uobm9kZSksIGNvbnRleHQ6IG5vZGUucGFyZW50Py50eXBlID8/IG5vZGUudHlwZSwgc2NvcGVJZCB9KTtcblxuICAgICAgLy8gQSBuYW1lIGluc2lkZSBhbiBpbnN0YW50aWF0aW9uJ3MgcG9ydCBsaXN0IGlzIHRoZSBwb3J0IGJvdW5kYXJ5LCBub3QgYVxuICAgICAgLy8gcmVhZCBvZiB0aGUgbW9kdWxlIGJvZHkuXG4gICAgICBpZiAoIWluc2lkZUluc3RhbnRpYXRpb24oKSkge1xuICAgICAgICBjb25zdCBsdmFsdWUgPSBlbmNsb3NpbmdMdmFsdWUoKTtcbiAgICAgICAgY29uc3QgaXNEcml2ZSA9IGx2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIGx2YWx1ZU5hbWUobHZhbHVlKSA9PT0gbmFtZTtcblxuICAgICAgICAvLyBCb3RoIHNpZGVzIG9mIGFuIGBhc3NpZ25gIGJlbG9uZyB0byBhIGNvbnRpbnVvdXMgYXNzaWdubWVudDsgb25seVxuICAgICAgICAvLyBwcm9jZWR1cmFsIGNvZGUgcmVwb3J0cyBhIHByb2NlZHVyYWwgYXNzaWdubWVudC5cbiAgICAgICAgY29uc3Qgc291cmNlOiBBY2Nlc3NTb3VyY2UgPSBpbnNpZGVDb250aW51b3VzQXNzaWduKClcbiAgICAgICAgICA/IFwiY29udGludW91c19hc3NpZ25cIlxuICAgICAgICAgIDogXCJwcm9jZWR1cmFsX2Fzc2lnbm1lbnRcIjtcblxuICAgICAgICByZWNvcmQoXG4gICAgICAgICAgbm9kZSxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHNjb3BlSWQsXG4gICAgICAgICAgaXNEcml2ZSA/IFwiZHJpdmVcIiA6IFwibG9hZFwiLFxuICAgICAgICAgIHNvdXJjZSxcbiAgICAgICAgICBkZXNjcmliZUFjY2VzcygpLFxuICAgICAgICAgIHNpdGVLZXlGb3Iobm9kZSksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IG5vZGUuY2hpbGRDb3VudCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAvLyBBIG5vZGUgdHlwZSB3aG9zZSBpZGVudGlmaWVycyBhcmUgYWxsIGRlY2xhcmF0aW9ucyBpcyBub3QgZGVzY2VuZGVkXG4gICAgICAvLyBpbnRvIGF0IGFsbCwgc28gaXRzIG1lbWJlcnMgYXJlIG5ldmVyIG1pc3Rha2VuIGZvciByZWZlcmVuY2VzLiBUaGVcbiAgICAgIC8vIHNhbWUgaG9sZHMgZm9yIHRoZSBwcmVwcm9jZXNzb3I6IGEgbWFjcm8ncyBib2R5IGlzIHRleHQsIG5vdCBjb2RlLlxuICAgICAgaWYgKERFQ0xBUkFUSU9OX09OTFlfVFlQRVMuaGFzKG5vZGUudHlwZSkgfHwgUFJFUFJPQ0VTU09SX1RZUEVTLmhhcyhub2RlLnR5cGUpKSBicmVhaztcbiAgICAgIGNvbnN0IGNoaWxkID0gbm9kZS5jaGlsZChpKTtcbiAgICAgIGlmIChjaGlsZCkgdmlzaXQoY2hpbGQpO1xuICAgIH1cblxuICAgIG9uTGVhdmUobm9kZSk7XG4gIH07XG5cbiAgdmlzaXQoYW5hbHlzaXMucGFyc2VUcmVlLnJvb3ROb2RlKTtcblxuICByZXR1cm4geyB1c2VzLCBhY2Nlc3NlcyB9O1xufVxuXG4vKiogV3JhcHBlciBub2RlcyB0aGF0IGFkZCBzdHJ1Y3R1cmUgd2l0aG91dCBiZWluZyBhIGRpc3RpbmN0IGFjY2VzcyBwb2ludC4gKi9cbmNvbnN0IEVYUFJFU1NJT05fV1JBUFBFUlMgPSBuZXcgU2V0KFtcInByaW1hcnlcIiwgXCJtaW50eXBtYXhfZXhwcmVzc2lvblwiLCBcImhpZXJhcmNoaWNhbF9pZGVudGlmaWVyXCJdKTtcblxuLyoqXG4gKiBOb2RlIHR5cGVzIHRoYXQgZW5kIGEgY2hhaW4gb2YgZXhwcmVzc2lvbnMuXG4gKlxuICogQSBgY29uZGl0aW9uYWxfc3RhdGVtZW50YCBpcyB0aGUgYm91bmRhcnkgdGhhdCBrZWVwcyBgaWYgKGQpYCBhbmQgYHEgPSBkYFxuICogYXMgdHdvIHNlcGFyYXRlIGFjY2VzcyBwb2ludHMsIHdoaWxlIGEgYmFyZSBiaW5hcnkgYGV4cHJlc3Npb25gIGtlZXBzXG4gKiBgcCA9PSBxYCBhbmQgYHAgIT0gcWAgaW5zaWRlIHRoZSBzYW1lIG9uZS5cbiAqL1xuY29uc3QgQUNDRVNTX1BPSU5UX1RZUEVTID0gbmV3IFNldChbXG4gIFwibmV0X2Fzc2lnbm1lbnRcIixcbiAgXCJvcGVyYXRvcl9hc3NpZ25tZW50XCIsXG4gIFwiYmxvY2tpbmdfYXNzaWdubWVudFwiLFxuICBcIm5vbmJsb2NraW5nX2Fzc2lnbm1lbnRcIixcbiAgXCJjb25kaXRpb25hbF9zdGF0ZW1lbnRcIixcbiAgXCJjYXNlX3N0YXRlbWVudFwiLFxuICBcImFsd2F5c19jb25zdHJ1Y3RcIixcbiAgXCJpbml0aWFsX2NvbnN0cnVjdFwiLFxuICBcImZpbmFsX2NvbnN0cnVjdFwiLFxuICBcImxvb3Bfc3RhdGVtZW50XCIsXG4gIFwiYWx3YXlzX2tleXdvcmRcIixcbiAgXCJuZXRfcG9ydF90eXBlXCIsXG5dKTtcblxuLyoqXG4gKiBUaGUgc2lnbmFsIGEgcG9ydCBiaW5kaW5nIHJlZmVycyB0by5cbiAqXG4gKiBgLmRpbihwdXNoX2RhdGEpYCBuYW1lcyBgcHVzaF9kYXRhYDsgYC5kaW4ocHVzaF9kYXRhWzM6MF0pYCBzdGlsbCByZWZlcnMgdG9cbiAqIHRoZSBuZXQgYHB1c2hfZGF0YWA7IGEgYmFyZSBleHByZXNzaW9uIGxpa2UgYC5jbGtgIChpbXBsaWNpdCkgaXMgbGVmdCBhbG9uZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJvb3ROYW1lT2YoZXhwcmVzc2lvbjogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbWF0Y2ggPSAvXlxccyooW0EtWmEtel9dW0EtWmEtejAtOV8kXSopLy5leGVjKGV4cHJlc3Npb24pO1xuICByZXR1cm4gbWF0Y2g/LlsxXTtcbn1cblxuLyoqIEFjY2Vzc2VzIG9mIGBuYW1lYCwgc3BsaXQgYnkgZGlyZWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnRpdGlvbkFjY2VzcyhcbiAgYWNjZXNzZXM6IHJlYWRvbmx5IFNpZ25hbEFjY2Vzc1tdLFxuICBuYW1lOiBzdHJpbmcsXG4pOiB7IGRyaXZlcnM6IFNpZ25hbEFjY2Vzc1tdOyBsb2FkczogU2lnbmFsQWNjZXNzW10gfSB7XG4gIGNvbnN0IGRyaXZlcnM6IFNpZ25hbEFjY2Vzc1tdID0gW107XG4gIGNvbnN0IGxvYWRzOiBTaWduYWxBY2Nlc3NbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgYWNjZXNzIG9mIGFjY2Vzc2VzKSB7XG4gICAgaWYgKGFjY2Vzcy5uYW1lICE9PSBuYW1lKSBjb250aW51ZTtcbiAgICAoYWNjZXNzLmtpbmQgPT09IFwiZHJpdmVcIiA/IGRyaXZlcnMgOiBsb2FkcykucHVzaChhY2Nlc3MpO1xuICB9XG5cbiAgcmV0dXJuIHsgZHJpdmVycywgbG9hZHMgfTtcbn1cblxuLyoqIEFsbCBkaXN0aW5jdCBzaWduYWwgbmFtZXMgYW4gYWNjZXNzIGxpc3QgbWVudGlvbnMsIHNvcnRlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhY2Nlc3NOYW1lcyhhY2Nlc3NlczogcmVhZG9ubHkgU2lnbmFsQWNjZXNzW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgYWNjZXNzIG9mIGFjY2Vzc2VzKSBuYW1lcy5hZGQoYWNjZXNzLm5hbWUpO1xuICByZXR1cm4gWy4uLm5hbWVzXS5zb3J0KCk7XG59IiwgImltcG9ydCB7IHN0YXRTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcblxuaW1wb3J0IHR5cGUgeyBSYW5nZSB9IGZyb20gXCJ2c2NvZGUtbGFuZ3VhZ2VzZXJ2ZXItdHlwZXNcIjtcbmltcG9ydCB0eXBlIHsgTm9kZSB9IGZyb20gXCJ3ZWItdHJlZS1zaXR0ZXJcIjtcblxuaW1wb3J0IHsgZm9sZGVkLCB0b1Bvc2l4IH0gZnJvbSBcIi4vcGF0aHMuanNcIjtcblxuLyoqXG4gKiBGaW5kaW5nIHRoZSBmaWxlIGEgYGAgYGluY2x1ZGUgYGAgbmFtZXMuXG4gKlxuICogVGhlIGRpcmVjdGl2ZSBpcyBhICpzdHJpbmcqLCBub3QgYSBwYXRoIHRoZSBlZGl0b3IgY2FuIGZvbGxvdzogaXQgc2F5c1xuICogYFwicGtnL2NmZ19wa2cuc3ZoXCJgLCBhbmQgbm90aGluZyBpbiB0aGUgd29ya3NwYWNlIHNheXMgd2hldGhlciB0aGF0IGlzXG4gKiByZWxhdGl2ZSB0byB0aGUgZmlsZSBkb2luZyB0aGUgaW5jbHVkaW5nLCByZWxhdGl2ZSB0byB0aGUgcHJvamVjdCByb290LCBvciBhXG4gKiBuYW1lIHRoYXQgb25seSBleGlzdHMgaW4gYSB2ZW5kb3IgbGlicmFyeS4gQSBjb21waWxlciBpcyB0b2xkIHdpdGggYCtpbmNkaXIrYFxuICogYW5kIGEgZmlsZSBsaXN0OyB0aGUgZWRpdG9yIGhhcyBuZWl0aGVyLCBhbmQgZ3Vlc3Npbmcgd3JvbmcgaXMgd2hhdCBsZWF2ZXNcbiAqIGBgIGNmZ19wa2c6OldJRFRIIGBgIHVucmVzb2x2YWJsZSB3aGlsZSB0aGUgcGFja2FnZSBzaXRzIHR3byBmb2xkZXJzIG92ZXIuXG4gKlxuICogU28gdGhlIHJlc29sdmVyIHRyaWVzIHRoZSBzcGVsbGluZ3MgYSBjb21waWxlciB3b3VsZCBoYXZlIGJlZW4gZ2l2ZW4sIGluIGFuXG4gKiBvcmRlciB0aGF0IG1ha2VzIGVhY2ggb25lIHdpbiBvbmx5IHdoZW4gaXQgaXMgcmlnaHQsIGFuZCBmYWxscyBiYWNrIHRvIGFcbiAqIHNlYXJjaCBvdmVyIGV2ZXJ5IGZpbGUgdGhlIHdvcmtzcGFjZSBpbmRleCBoYXMgYWxyZWFkeSBzZWVuLiBUaGUgZmFsbGJhY2sgaXNcbiAqIHRoZSBwb2ludDogXCJ0aGUgaGVhZGVyIGlzIHNvbWV3aGVyZSBpbiB0aGlzIHByb2plY3RcIiBpcyB0cnVlIGZhciBtb3JlIG9mdGVuXG4gKiB0aGFuIFwidGhlIGhlYWRlciBpcyBuZXh0IHRvIHRoZSBmaWxlIHRoYXQgaW5jbHVkZXMgaXRcIi5cbiAqL1xuXG4vKiogT25lIGBgIGBpbmNsdWRlIGBgIHdyaXR0ZW4gaW4gYSBmaWxlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbmNsdWRlRGlyZWN0aXZlIHtcbiAgLyoqIFRoZSBuYW1lIGFzIHdyaXR0ZW4sIHdpdGhvdXQgcXVvdGVzIG9yIGFuZ2xlIGJyYWNrZXRzLiAqL1xuICByZWFkb25seSB0YXJnZXQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFRydWUgZm9yIGBgIGBpbmNsdWRlIDxuYW1lPiBgYCwgZmFsc2UgZm9yIGBgIGBpbmNsdWRlIFwibmFtZVwiIGBgLlxuICAgKlxuICAgKiBUaGUgdHdvIGFyZSBub3QgdGhlIHNhbWUgcXVlc3Rpb246IGEgcXVvdGVkIGluY2x1ZGUgaXMgcmVzb2x2ZWQgYWdhaW5zdCB0aGVcbiAgICogZGlyZWN0b3J5IG9mIHRoZSBmaWxlIHRoYXQgd3JpdGVzIGl0LCB3aGlsZSBhbiBhbmdsZS1icmFja2V0ZWQgb25lIGlzIGFcbiAgICogbGlicmFyeSBpbmNsdWRlIGFuZCBpcyAqbmV2ZXIqIHJlbGF0aXZlIHRvIHRoYXQgZGlyZWN0b3J5LiBUcnlpbmcgdGhlXG4gICAqIGluY2x1ZGluZyBmaWxlJ3MgZm9sZGVyIGZvciBhIGA8Li4uPmAgaW5jbHVkZSBpbnZlbnRzIGEgZmlsZSBhIGNvbXBpbGVyXG4gICAqIHdvdWxkIG5ldmVyIHJlYWQuXG4gICAqL1xuICByZWFkb25seSBzeXN0ZW1MaWI6IGJvb2xlYW47XG4gIC8qKiBXaG9sZSBkaXJlY3RpdmUsIGJhY2t0aWNrIGluY2x1ZGVkLCBmb3IgdGhlIGRpYWdub3N0aWMgdGhhdCBuYW1lcyBpdC4gKi9cbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xufVxuXG4vKiogQW4gaW5jbHVkZSB0aGF0IHJlc29sdmVkIHRvIGEgZmlsZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRJbmNsdWRlIHtcbiAgLyoqIEFic29sdXRlIHBvc2l4IHBhdGggb2YgdGhlIGluY2x1ZGVkIGZpbGUuICovXG4gIHJlYWRvbmx5IGFic29sdXRlOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGRpcmVjdGl2ZTogSW5jbHVkZURpcmVjdGl2ZTtcbn1cblxuLyoqIEhvdyBtYW55IHBhcmVudCBmb2xkZXJzIGFyZSB0cmllZCB3aGVuIHJlc29sdmluZyBhIHJlbGF0aXZlIGluY2x1ZGUuICovXG5jb25zdCBNQVhfQVNDRU5UID0gNDtcblxuLyoqXG4gKiBUaGUgZGlyZWN0aXZlIHdyaXR0ZW4gb24gb25lIG5vZGUsIG9yIHVuZGVmaW5lZCB3aGVuIHRoZSBub2RlIGlzIG5vdCBvbmUuXG4gKlxuICogUmVhZCBwZXIgbm9kZSByYXRoZXIgdGhhbiBieSB3YWxraW5nIHRoZSB0cmVlIHNlcGFyYXRlbHk6IHRoZSBhbmFseXNlciBhbHJlYWR5XG4gKiBjcm9zc2VzIGV2ZXJ5IG5vZGUgb25jZSwgYW5kIGEgc2Vjb25kIHBhc3MgdG8gZmluZCB0aGUgaGFuZGZ1bCBvZiBsaW5lcyB0aGF0XG4gKiBjaGFuZ2UgcmFyZWx5IGNvc3QgYSBxdWFydGVyIG9mIHRoZSBhbmFseXNpcyBvbiBhIDQwMC1saW5lIG1vZHVsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRJbmNsdWRlKG5vZGU6IE5vZGUpOiBJbmNsdWRlRGlyZWN0aXZlIHwgdW5kZWZpbmVkIHtcbiAgaWYgKG5vZGUudHlwZSAhPT0gXCJpbmNsdWRlX2NvbXBpbGVyX2RpcmVjdGl2ZVwiKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIGNvbnN0IHJlYWQgPSByZWFkVGFyZ2V0KG5vZGUpO1xuICBpZiAoIXJlYWQpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgcmV0dXJuIHtcbiAgICB0YXJnZXQ6IHJlYWQudGFyZ2V0LFxuICAgIHN5c3RlbUxpYjogcmVhZC5zeXN0ZW1MaWIsXG4gICAgcmFuZ2U6IHtcbiAgICAgIHN0YXJ0OiB7IGxpbmU6IG5vZGUuc3RhcnRQb3NpdGlvbi5yb3csIGNoYXJhY3Rlcjogbm9kZS5zdGFydFBvc2l0aW9uLmNvbHVtbiB9LFxuICAgICAgZW5kOiB7IGxpbmU6IG5vZGUuZW5kUG9zaXRpb24ucm93LCBjaGFyYWN0ZXI6IG5vZGUuZW5kUG9zaXRpb24uY29sdW1uIH0sXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgbmFtZSBhbiBgaW5jbHVkZV9jb21waWxlcl9kaXJlY3RpdmVgIGNhcnJpZXMuXG4gKlxuICogVGhlIGdyYW1tYXIga2VlcHMgdGhlIG5hbWUgaW4gYHF1b3RlZF9zdHJpbmdgIGZvciBgXCIuLi5cImAgYW5kIGluXG4gKiBgc3lzdGVtX2xpYl9zdHJpbmdgIGZvciBgPC4uLj5gLCBlYWNoIHdpdGggaXRzIHB1bmN0dWF0aW9uIGFzIHNlcGFyYXRlXG4gKiBjaGlsZHJlbiwgc28gdGhlIG5hbWUgaXMgcmVhZCBmcm9tIHRoZSBkaXJlY3RpdmUncyB0ZXh0LlxuICovXG5mdW5jdGlvbiByZWFkVGFyZ2V0KG5vZGU6IE5vZGUpOiB7IHRhcmdldDogc3RyaW5nOyBzeXN0ZW1MaWI6IGJvb2xlYW4gfSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHRleHQgPSBub2RlLnRleHQucmVwbGFjZSgvXlxccypgaW5jbHVkZVxccyovLCBcIlwiKS50cmltKCk7XG5cbiAgY29uc3QgYW5nbGUgPSAvXjwoW14+XSopPi8uZXhlYyh0ZXh0KTtcbiAgaWYgKGFuZ2xlKSByZXR1cm4geyB0YXJnZXQ6IChhbmdsZVsxXSA/PyBcIlwiKS50cmltKCksIHN5c3RlbUxpYjogdHJ1ZSB9O1xuXG4gIGNvbnN0IHF1b3RlZCA9IC9eXCIoW15cIl0qKVwiLy5leGVjKHRleHQpO1xuICBpZiAocXVvdGVkKSByZXR1cm4geyB0YXJnZXQ6IChxdW90ZWRbMV0gPz8gXCJcIikudHJpbSgpLCBzeXN0ZW1MaWI6IGZhbHNlIH07XG5cbiAgLy8gQSBtYWNybyBpbiB0aGUgbmFtZSAtLSBgYCBgaW5jbHVkZSBgU09NRV9QQVRIIGBgIC0tIG5hbWVzIGEgcGF0aCBub2JvZHkgY2FuXG4gIC8vIGtub3cgdW50aWwgdGhlIG1hY3JvIGlzIGV4cGFuZGVkLiBMZWZ0IHVucmVzb2x2ZWQgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBUaGUgd29ya3NwYWNlJ3MgYW5zd2VyIHRvIFwid2hlcmUgaXMgdGhpcyBoZWFkZXJcIi5cbiAqXG4gKiBFdmVyeXRoaW5nIGl0IGtub3dzIGlzIGFjY3VtdWxhdGVkIGFzIGZpbGVzIGFyZSBpbmRleGVkLCBzbyBhIGxvb2t1cCB0aGF0XG4gKiBtaXNzZXMgZWFybHkgaW4gdGhlIHNlc3Npb24gc3RhcnRzIHN1Y2NlZWRpbmcgb25jZSB0aGUgd2FsayBoYXMgcGFzc2VkIHRoZVxuICogZm9sZGVyIGhvbGRpbmcgdGhlIGhlYWRlci4gVGhhdCBpcyB3aHkgdGhlIHNlcnZlciByZXNvbHZlcyBhbiBvcGVuIGRvY3VtZW50J3NcbiAqIGluY2x1ZGVzIGFnYWluIGFmdGVyIGluZGV4aW5nIGluc3RlYWQgb2Ygb25seSB3aGVuIGl0IGlzIG9wZW5lZC5cbiAqL1xuZXhwb3J0IGNsYXNzIEluY2x1ZGVSZXNvbHZlciB7XG4gIC8qKiBGb2xkZXJzIGEgc2VhcmNoIHN0YXJ0cyBmcm9tOiB0aGUgd29ya3NwYWNlIHJvb3RzIGFuZCB0aGVpciBhbmNlc3RvcnMuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgcm9vdHM6IHN0cmluZ1tdID0gW107XG4gIC8qKiBBYnNvbHV0ZSBwb3NpeCBwYXRocyBvZiBldmVyeSBmaWxlIHRoZSBpbmRleCBoYXMgcmVhZC4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAvKiogTG93ZXJjYXNlZCBiYXNlbmFtZSAtPiBhYnNvbHV0ZSBwYXRocywgZm9yIGEgbmFtZS1vbmx5IGxvb2t1cC4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBieUJhc2VuYW1lID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZ1tdPigpO1xuICAvKiogQWJzb2x1dGUgcGF0aCAtPiB0aGUgaW5jbHVkZXMgdGhhdCBmaWxlIHJlc29sdmVkIHRvLiAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGVkZ2VzID0gbmV3IE1hcDxzdHJpbmcsIFJlc29sdmVkSW5jbHVkZVtdPigpO1xuICAvKipcbiAgICogUmVzb2x2ZWQgbmFtZXMsIHdpdGggdGhlIGdlbmVyYXRpb24gdGhleSB3ZXJlIGFuc3dlcmVkIGluLlxuICAgKlxuICAgKiBBIG1pc3MgaGFzIHRvIGJlIHJlLXRyaWVkIG9uY2UgdGhlIGluZGV4IGhhcyBsZWFybmVkIG1vcmUgZmlsZXMgLS0gdGhlXG4gICAqIGhlYWRlciBtYXkgc2ltcGx5IG5vdCBoYXZlIGJlZW4gcmVhZCB5ZXQgLS0gc28gYW4gYW5zd2VyIGlzIG9ubHkgcmV1c2VkXG4gICAqIHdoaWxlIHRoZSBzZXQgb2Yga25vd24gZmlsZXMgaXMgdGhlIG9uZSBpdCB3YXMgY29tcHV0ZWQgYWdhaW5zdC5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgYW5zd2VycyA9IG5ldyBNYXA8c3RyaW5nLCB7IGdlbmVyYXRpb246IG51bWJlcjsgaGl0Pzogc3RyaW5nIH0+KCk7XG4gIC8qKiBJbmNyZW1lbnRlZCB3aGVuZXZlciBhIGZpbGUgb3IgYSByb290IGlzIGxlYXJuZWQuICovXG4gIHByaXZhdGUgZ2VuZXJhdGlvbiA9IDA7XG4gIC8qKiBJbmNsdWRlIG5hbWVzIG5vdGhpbmcgY291bGQgYmUgZm91bmQgZm9yLCBhbmQgdGhlIGZpbGVzIHRoYXQgYXNrLiAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHVucmVzb2x2ZWQgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG5cbiAgLyoqIFJlZ2lzdGVycyBhIGZvbGRlciBhIHJlbGF0aXZlIGluY2x1ZGUgaXMgdHJpZWQgYWdhaW5zdC4gKi9cbiAgbm90ZVJvb3QoZGlyZWN0b3J5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBhYnNvbHV0ZSA9IHRvUG9zaXgocGF0aC5ub3JtYWxpemUoZGlyZWN0b3J5KSk7XG4gICAgaWYgKHRoaXMucm9vdHMuaW5jbHVkZXMoYWJzb2x1dGUpKSByZXR1cm47XG4gICAgdGhpcy5yb290cy5wdXNoKGFic29sdXRlKTtcbiAgICB0aGlzLmdlbmVyYXRpb24rKztcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBmaWxlIHRoZSBpbmRleCBoYXMgcmVhZCwgc28gYSBsYXRlciBpbmNsdWRlIGNhbiBuYW1lIGl0LlxuICAgKlxuICAgKiBUaGlzIGlzIHdoYXQgbWFrZXMgXCJ0aGUgaGVhZGVyIGlzIHNvbWV3aGVyZSBpbiB0aGlzIHByb2plY3RcIiBhbnN3ZXJhYmxlOiB0aGVcbiAgICogd2FsayB0ZWFjaGVzIHRoZSByZXNvbHZlciBhYm91dCBldmVyeSBmaWxlIGl0IHBhc3NlcywgYW5kIGFuIGluY2x1ZGUgdHlwZWRcbiAgICogbG9uZyBhZnRlcndhcmRzIGNhbiBzdGlsbCBiZSBwbGFjZWQgYnkgcGF0aCBvciBieSBuYW1lLlxuICAgKi9cbiAgbm90ZUZpbGUoYWJzb2x1dGU6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGZpbGUgPSB0b1Bvc2l4KHBhdGgubm9ybWFsaXplKGFic29sdXRlKSk7XG4gICAgaWYgKHRoaXMuZmlsZXMuaGFzKGZpbGUpKSByZXR1cm47XG5cbiAgICB0aGlzLmZpbGVzLmFkZChmaWxlKTtcblxuICAgIGNvbnN0IGtleSA9IHBhdGgucG9zaXguYmFzZW5hbWUoZmlsZSkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLmJ5QmFzZW5hbWUuZ2V0KGtleSk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goZmlsZSk7XG4gICAgZWxzZSB0aGlzLmJ5QmFzZW5hbWUuc2V0KGtleSwgW2ZpbGVdKTtcblxuICAgIHRoaXMuZ2VuZXJhdGlvbisrO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGV2ZXJ5IGluY2x1ZGUgd3JpdHRlbiBpbiBvbmUgZmlsZSBhbmQgcmVtZW1iZXJzIHRoZSBlZGdlcy5cbiAgICpcbiAgICogYGZpbGVgIGlzIHRoZSBpbmNsdWRpbmcgZmlsZSdzIGFic29sdXRlIHBhdGgsIGJlY2F1c2UgdGhhdCBkaXJlY3RvcnkgaXNcbiAgICogd2hhdCBhIHF1b3RlZCBuYW1lIGlzIHJlc29sdmVkIGFnYWluc3QuIFJldHVybnMgd2hhdCB0aGUgZmlsZSByZWFjaGVzLCBzb1xuICAgKiB0aGUgY2FsbGVyIGNhbiBpbmRleCB3aGF0ZXZlciB0aGUgd29ya3NwYWNlIHdhbGsgZGlkIG5vdCByZWFjaCBpdHNlbGYuXG4gICAqL1xuICBub3RlSW5jbHVkZXMoZmlsZTogc3RyaW5nLCBkaXJlY3RpdmVzOiByZWFkb25seSBJbmNsdWRlRGlyZWN0aXZlW10pOiBSZXNvbHZlZEluY2x1ZGVbXSB7XG4gICAgY29uc3Qgc291cmNlID0gdG9Qb3NpeChwYXRoLm5vcm1hbGl6ZShmaWxlKSk7XG4gICAgY29uc3QgZnJvbSA9IHBhdGgucG9zaXguZGlybmFtZShzb3VyY2UpO1xuICAgIGNvbnN0IG91dDogUmVzb2x2ZWRJbmNsdWRlW10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgZGlyZWN0aXZlIG9mIGRpcmVjdGl2ZXMpIHtcbiAgICAgIGNvbnN0IGhpdCA9IHRoaXMuYW5zd2VyKGRpcmVjdGl2ZSwgZnJvbSk7XG4gICAgICBpZiAoaGl0KSB7XG4gICAgICAgIC8vIE5vdGVkIGJlZm9yZSB0aGUgZWRnZSBpcyBzdG9yZWQ6IGFuIGluY2x1ZGVkIGhlYWRlciBpcyBhIGZpbGUgb2YgdGhlXG4gICAgICAgIC8vIHByb2plY3QsIGFuZCB0aGUgbmV4dCBkb2N1bWVudCB0aGF0IGluY2x1ZGVzIHNvbWV0aGluZyByZWxhdGl2ZSB0byBpdFxuICAgICAgICAvLyBkZXNlcnZlcyB0aGUgc2FtZSBzZWFyY2ggdGhlIHdhbGsgd291bGQgaGF2ZSBnaXZlbi5cbiAgICAgICAgdGhpcy5ub3RlRmlsZShoaXQpO1xuICAgICAgICAvLyBBIG5hbWUgdGhhdCBjb3VsZCBub3QgYmUgcGxhY2VkIGVhcmxpZXIgbWF5IGJlIHBsYWNlYWJsZSBub3cgdGhhdCB0aGVcbiAgICAgICAgLy8gd2FsayBoYXMgcmVhZCB0aGUgZm9sZGVyIGhvbGRpbmcgaXQsIGFuZCBhIHN0YWxlIGNvbXBsYWludCBhYm91dCBhXG4gICAgICAgIC8vIGhlYWRlciB0aGF0IGlzIHJpZ2h0IHRoZXJlIGlzIHdvcnNlIHRoYW4gc2lsZW5jZS5cbiAgICAgICAgdGhpcy51bnJlc29sdmVkLmRlbGV0ZShkaXJlY3RpdmUudGFyZ2V0KTtcbiAgICAgICAgb3V0LnB1c2goeyBhYnNvbHV0ZTogaGl0LCBkaXJlY3RpdmUgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhc2tlcnMgPSB0aGlzLnVucmVzb2x2ZWQuZ2V0KGRpcmVjdGl2ZS50YXJnZXQpO1xuICAgICAgaWYgKGFza2VycykgYXNrZXJzLmFkZChzb3VyY2UpO1xuICAgICAgZWxzZSB0aGlzLnVucmVzb2x2ZWQuc2V0KGRpcmVjdGl2ZS50YXJnZXQsIG5ldyBTZXQoW3NvdXJjZV0pKTtcbiAgICB9XG5cbiAgICB0aGlzLmVkZ2VzLnNldChzb3VyY2UsIG91dCk7XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuXG4gIC8qKiBGb3JnZXRzIGEgZmlsZSdzIGVkZ2VzLCBzbyBhbiBlZGl0ZWQgaW5jbHVkZSBpcyBsb29rZWQgdXAgYWdhaW4uICovXG4gIGZvcmdldChmaWxlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmVkZ2VzLmRlbGV0ZSh0b1Bvc2l4KHBhdGgubm9ybWFsaXplKGZpbGUpKSk7XG4gIH1cblxuICAvKiogRmlsZXMgbmFtZWQgYnkgYGAgYGluY2x1ZGUgYGAgaW4gYGZpbGVgLCBhYnNvbHV0ZSBwYXRocy4gKi9cbiAgaW5jbHVkZXNPZihmaWxlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuICh0aGlzLmVkZ2VzLmdldCh0b1Bvc2l4KHBhdGgubm9ybWFsaXplKGZpbGUpKSkgPz8gW10pLm1hcCgoZWRnZSkgPT4gZWRnZS5hYnNvbHV0ZSk7XG4gIH1cblxuICAvKipcbiAgICogRXZlcnkgZmlsZSBgZmlsZWAgcmVhY2hlcyB0aHJvdWdoIGluY2x1ZGVzLCB0cmFuc2l0aXZlbHkuXG4gICAqXG4gICAqIEhlYWRlcnMgaW5jbHVkZSBoZWFkZXJzLCBhbmQgdGhlIG9uZSB0aGF0IGRlY2xhcmVzIHRoZSB0eXBlIGlzIG9mdGVuIHRoZVxuICAgKiBmdXJ0aGVzdCBhd2F5LiBUaGUgYHNlZW5gIHNldCBpcyB3aGF0IHN0b3BzIGEgcGFpciBvZiBoZWFkZXJzIHRoYXQgaW5jbHVkZVxuICAgKiBlYWNoIG90aGVyIC0tIG5vdCB1bmhlYXJkIG9mIGJlaGluZCBhbiBgaWZuZGVmYCBndWFyZCAtLSBmcm9tIGxvb3BpbmcuXG4gICAqL1xuICBjbG9zdXJlKGZpbGU6IHN0cmluZywgbGltaXQgPSA2NCk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBzdGFydCA9IHRvUG9zaXgocGF0aC5ub3JtYWxpemUoZmlsZSkpO1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oW3N0YXJ0XSk7XG4gICAgY29uc3QgcXVldWUgPSBbc3RhcnRdO1xuXG4gICAgd2hpbGUgKHF1ZXVlLmxlbmd0aCA+IDAgJiYgc2Vlbi5zaXplIDw9IGxpbWl0KSB7XG4gICAgICBjb25zdCBjdXJyZW50ID0gcXVldWUuc2hpZnQoKSE7XG4gICAgICBmb3IgKGNvbnN0IGVkZ2Ugb2YgdGhpcy5lZGdlcy5nZXQoY3VycmVudCkgPz8gW10pIHtcbiAgICAgICAgaWYgKHNlZW4uaGFzKGVkZ2UuYWJzb2x1dGUpKSBjb250aW51ZTtcbiAgICAgICAgc2Vlbi5hZGQoZWRnZS5hYnNvbHV0ZSk7XG4gICAgICAgIHF1ZXVlLnB1c2goZWRnZS5hYnNvbHV0ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgc2Vlbi5kZWxldGUoc3RhcnQpO1xuICAgIHJldHVybiBbLi4uc2Vlbl07XG4gIH1cblxuICAvKipcbiAgICogSW5jbHVkZSBuYW1lcyBub3RoaW5nIGNvdWxkIGJlIGZvdW5kIGZvciwgYW5kIHRoZSBmaWxlcyB0aGF0IGFzayBmb3IgdGhlbS5cbiAgICpcbiAgICogUmVwb3J0ZWQgaW4gdGhlIGxvZyBiZWNhdXNlIGEgbWlzc2luZyBoZWFkZXIgaXMgaW52aXNpYmxlIG90aGVyd2lzZTogZXZlcnlcbiAgICogbWFjcm8gaXQgd291bGQgaGF2ZSBkZWNsYXJlZCB0aGVuIHJlYWRzIGFzIGFuIHVua25vd24gbmFtZSwgYW5kIHRoZSBzeW1wdG9tXG4gICAqIHBvaW50cyBhdCB0aGUgZXh0ZW5zaW9uIHJhdGhlciB0aGFuIGF0IHRoZSBmaWxlIGxpc3QuXG4gICAqL1xuICBnZXQgbWlzc2luZygpOiBSZWFkb25seU1hcDxzdHJpbmcsIFJlYWRvbmx5U2V0PHN0cmluZz4+IHtcbiAgICByZXR1cm4gdGhpcy51bnJlc29sdmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBmaWxlIGFuIGluY2x1ZGUgbmFtZXMsIG9yIHVuZGVmaW5lZC5cbiAgICpcbiAgICogUmV1c2VkIG9ubHkgd2hpbGUgdGhlIHNldCBvZiBrbm93biBmaWxlcyBpcyB0aGUgb25lIHRoZSBhbnN3ZXIgY2FtZSBmcm9tOiBhXG4gICAqIG1pc3MgaGFzIHRvIGJlIHJlLXRyaWVkIG9uY2UgdGhlIGluZGV4IGhhcyByZWFkIG1vcmUsIGJlY2F1c2UgdGhlIGhlYWRlciBtYXlcbiAgICogc2ltcGx5IG5vdCBoYXZlIGJlZW4gcmVhY2hlZCB5ZXQuXG4gICAqL1xuICBwcml2YXRlIGFuc3dlcihkaXJlY3RpdmU6IEluY2x1ZGVEaXJlY3RpdmUsIGZyb206IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgdGFyZ2V0ID0gZGlyZWN0aXZlLnRhcmdldC50cmltKCk7XG4gICAgY29uc3Qga2V5ID0gYCR7ZnJvbX18JHt0YXJnZXR9fCR7ZGlyZWN0aXZlLnN5c3RlbUxpYiA/IFwiPFwiIDogJ1wiJ31gO1xuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMuYW5zd2Vycy5nZXQoa2V5KTtcbiAgICBpZiAoY2FjaGVkICYmIGNhY2hlZC5nZW5lcmF0aW9uID09PSB0aGlzLmdlbmVyYXRpb24pIHJldHVybiBjYWNoZWQuaGl0O1xuXG4gICAgY29uc3QgaGl0ID0gdGhpcy5zZWFyY2godGFyZ2V0LCBmcm9tLCBkaXJlY3RpdmUuc3lzdGVtTGliKTtcbiAgICB0aGlzLmFuc3dlcnMuc2V0KGtleSwgeyBnZW5lcmF0aW9uOiB0aGlzLmdlbmVyYXRpb24sIGhpdCB9KTtcbiAgICByZXR1cm4gaGl0O1xuICB9XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRoZSBmaWxlIGZvciBgbmFtZWAgaXMsIHRyaWVkIGluIHRoZSBvcmRlciBhIGNvbXBpbGVyIHdvdWxkIGJlIHRvbGQuXG4gICAqXG4gICAqIEJlc2lkZSB0aGUgZmlsZSB0aGF0IHdyb3RlIGl0LCB0aGVuIHVwIHRoZSBmb2xkZXIgdHJlZSwgdGhlbiBhdCBhIHdvcmtzcGFjZVxuICAgKiByb290LCB0aGVuIGFueXdoZXJlIGluIHRoZSBwcm9qZWN0IGJ5IHBhdGggc3VmZml4LCBhbmQgZmluYWxseSBieSBiYXJlIGZpbGVcbiAgICogbmFtZS4gRWFjaCBzdGVwIGlzIHJlYWNoZWQgb25seSB3aGVuIHRoZSBvbmUgYmVmb3JlIGl0IGZvdW5kIG5vdGhpbmcsIHNvIGFcbiAgICogbmFtZSB3aXRoIGFuIGV4YWN0IGFuc3dlciBhbHdheXMgZ2V0cyBpdC5cbiAgICovXG4gIHByaXZhdGUgc2VhcmNoKG5hbWU6IHN0cmluZywgZnJvbTogc3RyaW5nLCBzeXN0ZW1MaWI6IGJvb2xlYW4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBpZiAocGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSByZXR1cm4gZXhpc3RpbmcodHJpbW1lZCk7XG5cbiAgICAvLyBBIHF1b3RlZCBpbmNsdWRlIGlzIHJlbGF0aXZlIHRvIHRoZSBmaWxlIHRoYXQgd3JpdGVzIGl0LiBBblxuICAgIC8vIGFuZ2xlLWJyYWNrZXRlZCBvbmUgaXMgYSBsaWJyYXJ5IGluY2x1ZGUgYW5kIHRoZSBpbmNsdWRpbmcgZmlsZSdzIGZvbGRlclxuICAgIC8vIGlzIG5vdCBhIGNhbmRpZGF0ZTogYSBjb3B5IG9mIGBkdXQuc3ZoYCBzaXR0aW5nIG5leHQgdG8gYSBtb2R1bGUgZG9lcyBub3RcbiAgICAvLyBiZWNvbWUgdGhlIGxpYnJhcnkncyB2ZXJzaW9uIGJlY2F1c2Ugc29tZWJvZHkgd3JvdGUgYDxkdXQuc3ZoPmAuXG4gICAgaWYgKCFzeXN0ZW1MaWIpIHtcbiAgICAgIGNvbnN0IGJlc2lkZSA9IGV4aXN0aW5nKHBhdGgucmVzb2x2ZShmcm9tLCB0cmltbWVkKSk7XG4gICAgICBpZiAoYmVzaWRlKSByZXR1cm4gYmVzaWRlO1xuICAgIH1cblxuICAgIC8vIFVwd2FyZHMuIGAuLi9wa2cvY2ZnX3BrZy5zdmhgIGFuZCBgcGtnL2NmZ19wa2cuc3ZoYCB3cml0dGVuIGZyb20gdGhyZWVcbiAgICAvLyBmb2xkZXJzIGRlZXAgYXJlIHRoZSB0d28gc3BlbGxpbmdzIGEgcHJvamVjdCByZWFsbHkgdXNlcywgYW5kIGJvdGggYXJlXG4gICAgLy8gYW5zd2VyZWQgYnkgdHJ5aW5nIHRoZSBlbmNsb3NpbmcgZm9sZGVycy5cbiAgICBsZXQgZGlyZWN0b3J5ID0gZnJvbTtcbiAgICBmb3IgKGxldCBsZXZlbCA9IDA7IGxldmVsIDwgTUFYX0FTQ0VOVDsgbGV2ZWwrKykge1xuICAgICAgY29uc3QgcGFyZW50ID0gcGF0aC5kaXJuYW1lKGRpcmVjdG9yeSk7XG4gICAgICBpZiAocGFyZW50ID09PSBkaXJlY3RvcnkpIGJyZWFrO1xuICAgICAgZGlyZWN0b3J5ID0gcGFyZW50O1xuXG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBleGlzdGluZyhwYXRoLnJlc29sdmUoZGlyZWN0b3J5LCB0cmltbWVkKSk7XG4gICAgICBpZiAoY2FuZGlkYXRlKSByZXR1cm4gY2FuZGlkYXRlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3Qgcm9vdCBvZiB0aGlzLnJvb3RzKSB7XG4gICAgICBjb25zdCBjYW5kaWRhdGUgPSBleGlzdGluZyhwYXRoLnJlc29sdmUocm9vdCwgdHJpbW1lZCkpO1xuICAgICAgaWYgKGNhbmRpZGF0ZSkgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgICB9XG5cbiAgICBjb25zdCBzdWZmaXggPSBgLyR7Zm9sZGVkKHRyaW1tZWQpfWA7XG4gICAgbGV0IHNoYWxsb3dlc3Q6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5maWxlcykge1xuICAgICAgaWYgKCFmaWxlLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoc3VmZml4KSkgY29udGludWU7XG4gICAgICAvLyBUaGUgc2hhbGxvd2VzdCBtYXRjaCB3aW5zOiB0d28gZm9sZGVycyBjYW4gZWFjaCBob2xkIGEgYGRlZmluZXMuc3ZoYCxcbiAgICAgIC8vIGFuZCB0aGUgb25lIGNsb3NlciB0byB0aGUgcHJvamVjdCByb290IGlzIHRoZSBvbmUgdGhlIGZpbGUgbGlzdCBtZWFudC5cbiAgICAgIGlmICghc2hhbGxvd2VzdCB8fCBmaWxlLmxlbmd0aCA8IHNoYWxsb3dlc3QubGVuZ3RoKSBzaGFsbG93ZXN0ID0gZmlsZTtcbiAgICB9XG4gICAgaWYgKHNoYWxsb3dlc3QpIHJldHVybiBzaGFsbG93ZXN0O1xuXG4gICAgLy8gQSBiYXJlIGZpbGUgbmFtZSwgYnV0IG9ubHkgd2hlbiB0aGUgcHJvamVjdCBob2xkcyBleGFjdGx5IG9uZSBvZiB0aGVtLlxuICAgIC8vIFRoaXMgaXMgd2hhdCBhbiBpbmNsdWRlIHBhdGggZG9lcyBmb3IgdGhlIGNvbW1vbiBgYCBgaW5jbHVkZVxuICAgIC8vIFwiZGVmaW5lcy5zdmhcIiBgYDsgdHdvIGZpbGVzIG9mIHRoYXQgbmFtZSBhcmUgYW1iaWd1b3VzLCBhbmQgcGlja2luZyBvbmVcbiAgICAvLyB3b3VsZCByZXNvbHZlIHRvIGEgaGVhZGVyIHRoZSBhdXRob3IgbmV2ZXIgd3JvdGUuXG4gICAgY29uc3QgYnlOYW1lID0gdGhpcy5ieUJhc2VuYW1lLmdldChwYXRoLnBvc2l4LmJhc2VuYW1lKGZvbGRlZCh0cmltbWVkKSkpO1xuICAgIGlmIChieU5hbWUgJiYgYnlOYW1lLmxlbmd0aCA9PT0gMSkgcmV0dXJuIGJ5TmFtZVswXTtcblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cblxuLyoqIEEgcmVhZGFibGUgcmVndWxhciBmaWxlIGF0IGBjYW5kaWRhdGVgLCBhcyBhIHBvc2l4IHBhdGgsIG9yIG5vdGhpbmcuICovXG5mdW5jdGlvbiBleGlzdGluZyhjYW5kaWRhdGU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhjYW5kaWRhdGUpLmlzRmlsZSgpKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiB0b1Bvc2l4KHBhdGgubm9ybWFsaXplKGNhbmRpZGF0ZSkpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG4iLCAiaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiO1xuXG4vKipcbiAqIEZpbGVzeXN0ZW0gcGF0aHMgYW5kIGBmaWxlOi8vYCB1cmlzLCBpbiBvbmUgcGxhY2UuXG4gKlxuICogVGhlIHR3byBhcmUgbm90IGludGVyY2hhbmdlYWJsZSwgYW5kIGdldHRpbmcgaXQgd3JvbmcgaXMgc2lsZW50OiBhIGxvb2t1cFxuICoga2V5ZWQgYnkgYSBwYXRoIGZhaWxzIGFnYWluc3QgYSBjYXRhbG9nIGtleWVkIGJ5IGEgdXJpIGFuZCB0aGUgYW5zd2VyIGlzXG4gKiBzaW1wbHkgXCJub3QgZm91bmRcIi4gRXZlcnkgbW9kdWxlIHRoYXQgaGFzIHRvIHRyYW5zbGF0ZSBiZXR3ZWVuIHRoZSB0d28gLS0gdGhlXG4gKiB3b3Jrc3BhY2Ugd2FsaywgdGhlIGluY2x1ZGUgcmVzb2x2ZXIsIHRoZSB0b3AtbW9kdWxlIHNlYXJjaCAtLSBnb2VzIHRocm91Z2hcbiAqIGhlcmUgc28gdGhleSBhbGwgYWdyZWUgb24gdGhlIHNwZWxsaW5nLlxuICovXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsdWUuc3BsaXQocGF0aC5zZXApLmpvaW4oXCIvXCIpO1xufVxuXG4vKipcbiAqIE1pbmltYWwgYGZpbGU6Ly9gIFVSSSBlbmNvZGVyIHRoYXQgaGFuZGxlcyBXaW5kb3dzIGRyaXZlIGxldHRlcnMuXG4gKlxuICogVGhlIHBhdGggc2VnbWVudHMgYXJlIGpvaW5lZCBvbnRvIGFuIGVtcHR5IHNjaGVtZSwgYW5kIHRoZSBsZWFkaW5nIHNsYXNoIGlzXG4gKiB0YWtlbiBmcm9tIHRoZSBwYXRoIGl0c2VsZjogcHJlZml4aW5nIGBmaWxlOi8vYCBvbnRvIGFuIGFscmVhZHktYWJzb2x1dGUgcGF0aFxuICogeWllbGRzIGBmaWxlOi8vLy8uLi5gLCB3aGljaCBpcyBhIGRpZmZlcmVudCBVUkkgZnJvbSBgZmlsZTovLy8uLi5gIGFuZCBtYWtlc1xuICogZXZlcnkgbG9va3VwIGJ5IHVyaSBtaXNzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGF0aFRvVXJpKGFic29sdXRlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpc2VkID0gdG9Qb3NpeChhYnNvbHV0ZSk7XG4gIGNvbnN0IGVuY29kZWQgPSBub3JtYWxpc2VkXG4gICAgLnNwbGl0KFwiL1wiKVxuICAgIC5maWx0ZXIoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID4gMClcbiAgICAubWFwKGVuY29kZVVSSUNvbXBvbmVudClcbiAgICAuam9pbihcIi9cIik7XG5cbiAgY29uc3QgZHJpdmUgPSAvXihbQS1aYS16XSk6Ly5leGVjKGVuY29kZWQpO1xuICBpZiAoZHJpdmUpIHJldHVybiBgZmlsZTovLy8ke2VuY29kZWQucmVwbGFjZSgvXihbQS1aYS16XSk6LywgXCIlMjQxOlwiKX1gO1xuXG4gIHJldHVybiBgZmlsZTovLy8ke2VuY29kZWR9YDtcbn1cblxuLyoqXG4gKiBUaGUgZmlsZXN5c3RlbSBwYXRoIGJlaGluZCBhIGBmaWxlOi8vYCB1cmksIG9yIHVuZGVmaW5lZCBmb3IgYW55dGhpbmcgZWxzZS5cbiAqXG4gKiBBIGRvY3VtZW50IGNhbiBhbHNvIGJlIGB1bnRpdGxlZDpgIG9yIGxpdmUgaW4gYSB2aXJ0dWFsIGZpbGVzeXN0ZW0sIGFuZCB0aGVyZVxuICogaXMgbm8gZGlyZWN0b3J5IHRvIHNlYXJjaCB1cHdhcmRzIGZyb20gLS0gc28gdGhvc2UgcmV0dXJuIG5vdGhpbmcgcmF0aGVyIHRoYW5cbiAqIGEgcGF0aCB0aGF0IGNhbm5vdCBiZSByZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdXJpVG9QYXRoKHVyaTogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCF1cmkuc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgZGVjb2RlZCA9IGRlY29kZVVSSUNvbXBvbmVudCh1cmkuc2xpY2UoXCJmaWxlOi8vXCIubGVuZ3RoKSk7XG4gIC8vIGBwYXRoVG9VcmlgIG5ldmVyIGVtaXRzIG1vcmUgdGhhbiBvbmUgbGVhZGluZyBzbGFzaCwgYnV0IGEgdXJpIHdyaXR0ZW4gYnlcbiAgLy8gaGFuZCBvciBieSBhbm90aGVyIGVkaXRvciBjYW4sIGFuZCBgL2EvL2JgIGlzIG5vdCBhIHBhdGggbm9kZSBjYW4gcmVhZC5cbiAgY29uc3QgYWJzb2x1dGUgPSBkZWNvZGVkLnN0YXJ0c1dpdGgoXCIvXCIpID8gZGVjb2RlZCA6IGAvJHtkZWNvZGVkfWA7XG4gIHJldHVybiBwYXRoLm5vcm1hbGl6ZShhYnNvbHV0ZSk7XG59XG5cbi8qKiBMb3dlcmNhc2VkIHBhdGgsIGZvciB0aGUgY2FzZS1pbnNlbnNpdGl2ZSBjb21wYXJpc29ucyBhIHByb2plY3QgbmVlZHMuICovXG5leHBvcnQgZnVuY3Rpb24gZm9sZGVkKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdG9Qb3NpeCh2YWx1ZSkudG9Mb3dlckNhc2UoKTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IE5vZGUsIFRyZWUgfSBmcm9tIFwid2ViLXRyZWUtc2l0dGVyXCI7XG5cbi8qKlxuICogVGV4dCBtYWNyb3MuXG4gKlxuICogYGAgYE5PVE1SSU5TVCgoQ0hBTlctMSksMCxjaGFuX21hc2spOyBgYCBpcyBhIGRlY2xhcmF0aW9uIHdyaXR0ZW4gYnkgYVxuICogcHJlcHJvY2Vzc29yLCBub3QgYnkgdGhlIGF1dGhvciwgYW5kIHdpdGhvdXQgZXhwYW5zaW9uIGl0IGRlY2xhcmVzIG5vdGhpbmc6XG4gKiB0aGUgbW9kdWxlJ3Mgc2lnbmFscyBnbyBtaXNzaW5nIGFuZCBldmVyeSB1c2Ugb2YgdGhlbSBpcyByZXBvcnRlZCBhcyBhblxuICogdW5rbm93biBpZGVudGlmaWVyLlxuICpcbiAqIFRoaXMgaXMgbm90IGEgcHJlcHJvY2Vzc29yIC0tIGBpbmNsdWRlYCBpcyBub3QgZm9sbG93ZWQsIGB1bmRlZmAgaXMgaG9ub3VyZWRcbiAqIGJ1dCBub3RoaW5nIGVsc2UgaXMgc2ltdWxhdGVkLCBhbmQgYGlmZGVmYCBpcyByZXNvbHZlZCBieSBwaWNraW5nIGEgYnJhbmNoXG4gKiByYXRoZXIgdGhhbiBieSBldmFsdWF0aW5nIGEgY29uZGl0aW9uIG5vYm9keSBoYXMgdG9sZCB1cyB0aGUgdmFsdWUgb2YuIFdoYXQgaXRcbiAqIGRvZXMgaXMgZW5vdWdoIGZvciB0aGUgZGVjbGFyYXRpb24gYSBtYWNybyBzdGFuZHMgZm9yLCB3aGljaCBpcyB0aGUgcGFydCB0aGF0XG4gKiBoYXMgdG8gYmUgcmlnaHQgZm9yIGhvdmVyLCB3aWR0aHMgYW5kIG5hdmlnYXRpb24uXG4gKi9cblxuLyoqIE9uZSBgYCBgZGVmaW5lIGBgLCB3aXRoIGl0cyBmb3JtYWwgYXJndW1lbnRzIGFuZCBpdHMgYm9keS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFjcm9EZWYge1xuICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gIC8qKiBGb3JtYWwgYXJndW1lbnQgbmFtZXMsIGluIG9yZGVyLiBFbXB0eSBmb3IgYW4gb2JqZWN0LWxpa2UgbWFjcm8uICovXG4gIHJlYWRvbmx5IHBhcmFtczogcmVhZG9ubHkgc3RyaW5nW107XG4gIHJlYWRvbmx5IGJvZHk6IHN0cmluZztcbn1cblxuLyoqIEV2ZXJ5IG1hY3JvIGtub3duIHRvIHRoZSB3b3Jrc3BhY2UuICovXG5leHBvcnQgdHlwZSBNYWNyb1RhYmxlID0gTWFwPHN0cmluZywgTWFjcm9EZWY+O1xuXG4vKiogSG93IGRlZXAgYSBjaGFpbiBvZiBtYWNyb3MgaXMgZm9sbG93ZWQgYmVmb3JlIGdpdmluZyB1cC4gKi9cbmNvbnN0IE1BWF9FWFBBTlNJT05fREVQVEggPSA4O1xuXG4vKipcbiAqIFJlYWRzIHRoZSBtYWNyb3MgZGVmaW5lZCBpbiBvbmUgZG9jdW1lbnQuXG4gKlxuICogYGlmZGVmYCBicmFuY2hlcyBhcmUgY29sbGVjdGVkIHJhdGhlciB0aGFuIGV2YWx1YXRlZDogd2hldGhlciBgUkVNT1ZFX1RNUmBcbiAqIGlzIHNldCBpcyBub3Qga25vd2FibGUgZnJvbSB0aGUgc291cmNlIGFsb25lLCBhbmQgYSBtYWNybyBkZWZpbmVkIGluIGVpdGhlclxuICogYnJhbmNoIGlzIG9uZSB0aGUgYXV0aG9yIGV4cGVjdHMgdG8gYmUgYXZhaWxhYmxlLiBXaGVyZSBib3RoIGJyYW5jaGVzIGRlZmluZVxuICogdGhlIHNhbWUgbmFtZSwgdGhlIGxhdGVyIG9uZSB3aW5zLCB3aGljaCBpcyB0aGUgYGVsc2VgIC0tIHRoZSBicmFuY2ggdGFrZW5cbiAqIHdoZW4gdGhlIGZlYXR1cmUgaXMgbm90IGVuYWJsZWQsIGFuZCB0aGUgb25lIG1vc3QgUlRMIHJlbGllcyBvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RNYWNyb3ModHJlZTogVHJlZSwgc291cmNlOiBzdHJpbmcpOiBNYWNyb0RlZltdIHtcbiAgY29uc3Qgb3V0OiBNYWNyb0RlZltdID0gW107XG4gIGNvbnN0IHN0YWNrOiBOb2RlW10gPSBbdHJlZS5yb290Tm9kZV07XG5cbiAgd2hpbGUgKHN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBub2RlID0gc3RhY2sucG9wKCkhO1xuXG4gICAgaWYgKG5vZGUudHlwZSA9PT0gXCJ0ZXh0X21hY3JvX2RlZmluaXRpb25cIikge1xuICAgICAgY29uc3QgZGVmID0gcmVhZERlZmluaXRpb24obm9kZSwgc291cmNlKTtcbiAgICAgIGlmIChkZWYpIHtcbiAgICAgICAgLy8gTGF0ZXIgZGVmaW5pdGlvbnMgb2YgdGhlIHNhbWUgbmFtZSB3aW46IGBpZmRlZmAgZmlyc3QsIGBlbHNlYCBhZnRlci5cbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBvdXQuZmluZEluZGV4KChtKSA9PiBtLm5hbWUgPT09IGRlZi5uYW1lKTtcbiAgICAgICAgaWYgKGV4aXN0aW5nID49IDApIG91dFtleGlzdGluZ10gPSBkZWY7XG4gICAgICAgIGVsc2Ugb3V0LnB1c2goZGVmKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChub2RlLnR5cGUgPT09IFwidW5kZWZpbmVfY29tcGlsZXJfZGlyZWN0aXZlXCIpIHtcbiAgICAgIC8vIEZvdW5kIGJ5IHJlYWRpbmcgdGhlIG5vZGUgbmFtZXM6IHRoZSBncmFtbWFyIGNhbGxzIHRoaXNcbiAgICAgIC8vIGB1bmRlZmluZV9jb21waWxlcl9kaXJlY3RpdmVgLCBub3QgYHVuZGVmYC5cbiAgICAgIGNvbnN0IG5hbWUgPSBub2RlLm5hbWVkQ2hpbGQoMCk/LnRleHQgPz8gXCJcIjtcbiAgICAgIGNvbnN0IGluZGV4ID0gb3V0LmZpbmRJbmRleCgobSkgPT4gbS5uYW1lID09PSBuYW1lKTtcbiAgICAgIGlmIChpbmRleCA+PSAwKSBvdXQuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSBub2RlLmNoaWxkQ291bnQgLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgY2hpbGQgPSBub2RlLmNoaWxkKGkpO1xuICAgICAgaWYgKGNoaWxkKSBzdGFjay5wdXNoKGNoaWxkKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiByZWFkRGVmaW5pdGlvbihub2RlOiBOb2RlLCBzb3VyY2U6IHN0cmluZyk6IE1hY3JvRGVmIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbmFtZU5vZGUgPSBmaW5kQ2hpbGQobm9kZSwgXCJ0ZXh0X21hY3JvX25hbWVcIik7XG4gIGNvbnN0IGJvZHlOb2RlID0gZmluZENoaWxkKG5vZGUsIFwibWFjcm9fdGV4dFwiKTtcbiAgaWYgKCFuYW1lTm9kZSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBUaGUgbmFtZSBub2RlIGhvbGRzIGBOQU1FYCBvciBgTkFNRShhLGIsYylgOyB0aGUgcGFyYW1ldGVycyBsaXZlIGluc2lkZVxuICAvLyBpdCwgc28gdGhleSBhcmUgcmVhZCBmcm9tIHRoZSB0ZXh0IHJhdGhlciB0aGFuIGZyb20gYSBmaWVsZC5cbiAgY29uc3QgaGVhZGVyID0gc291cmNlLnNsaWNlKG5hbWVOb2RlLnN0YXJ0SW5kZXgsIG5hbWVOb2RlLmVuZEluZGV4KTtcbiAgY29uc3QgbWF0Y2ggPSAvXihbQS1aYS16X11cXHcqKVxccyooPzpcXCgoW14pXSopXFwpKT8vLmV4ZWMoaGVhZGVyKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBwYXJhbXMgPSAobWF0Y2hbMl0gPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgLmZpbHRlcigocCkgPT4gcC5sZW5ndGggPiAwICYmIHAgIT09IFwiPVwiKTtcblxuICByZXR1cm4ge1xuICAgIG5hbWU6IG1hdGNoWzFdISxcbiAgICBwYXJhbXMsXG4gICAgYm9keTogYm9keU5vZGUgPyBzb3VyY2Uuc2xpY2UoYm9keU5vZGUuc3RhcnRJbmRleCwgYm9keU5vZGUuZW5kSW5kZXgpIDogXCJcIixcbiAgfTtcbn1cblxuZnVuY3Rpb24gZmluZENoaWxkKG5vZGU6IE5vZGUsIHR5cGU6IHN0cmluZyk6IE5vZGUgfCBudWxsIHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2RlLmNoaWxkQ291bnQ7IGkrKykge1xuICAgIGNvbnN0IGNoaWxkID0gbm9kZS5jaGlsZChpKTtcbiAgICBpZiAoY2hpbGQ/LnR5cGUgPT09IHR5cGUpIHJldHVybiBjaGlsZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUZXh0IHByb2R1Y2VkIGJ5IGV4cGFuZGluZyBhIG1hY3JvLCB3aXRoIGEgbWFwIGJhY2sgdG8gdGhlIG9yaWdpbmFsIHNvdXJjZS5cbiAqXG4gKiBBIG1hY3JvIGJvZHkgaXMgd3JpdHRlbiBpbiB0aGUgZmlsZSB0aGF0IGRlZmluZXMgaXQgYnV0IGRlY2xhcmVzIHRoaW5ncyBpblxuICogdGhlIGZpbGUgdGhhdCB1c2VzIGl0LCBzbyBldmVyeSBjaGFyYWN0ZXIgb2YgdGhlIGV4cGFuc2lvbiBoYXMgdG8gcG9pbnQgYXRcbiAqIHRoZSBpbnZvY2F0aW9uIHRoYXQgY2F1c2VkIGl0LiBIb3ZlciBhbmQgZ28tdG8tZGVmaW5pdGlvbiBhcmUgbWVhbmluZ2xlc3NcbiAqIG90aGVyd2lzZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFeHBhbnNpb24ge1xuICByZWFkb25seSB0ZXh0OiBzdHJpbmc7XG4gIC8qKiBGb3IgZWFjaCBjaGFyYWN0ZXIgb2YgYHRleHRgLCBpdHMgb2Zmc2V0IGluIHRoZSBvcmlnaW5hbCBzb3VyY2UuICovXG4gIHJlYWRvbmx5IG9yaWdpbjogbnVtYmVyW107XG59XG5cbi8qKlxuICogRXhwYW5kcyBgYCBgTkFNRSBgYCBhbmQgYGAgYE5BTUUoYXJncykgYGAgaW4gYHRleHRgLlxuICpcbiAqIGBvcmlnaW5CYXNlYCBpcyB3aGVyZSBgdGV4dGAgc3RhcnRzIGluIHRoZSBvcmlnaW5hbCBzb3VyY2UsIHNvIHRoZSBtYXAgY29tZXNcbiAqIG91dCBhYnNvbHV0ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZChcbiAgdGV4dDogc3RyaW5nLFxuICBtYWNyb3M6IE1hY3JvVGFibGUsXG4gIG9yaWdpbkJhc2U6IG51bWJlcixcbiAgZGVwdGggPSAwLFxuKTogRXhwYW5zaW9uIHtcbiAgbGV0IG91dCA9IFwiXCI7XG4gIGNvbnN0IG9yaWdpbjogbnVtYmVyW10gPSBbXTtcblxuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdGV4dC5sZW5ndGgpIHtcbiAgICBjb25zdCBjaCA9IHRleHRbaV07XG5cbiAgICBpZiAoY2ggPT09IFwiYFwiICYmIHRleHRbaSArIDFdID09PSBcImBcIikge1xuICAgICAgLy8gYGAgYGBfVE1SIGBgIC0tIHRva2VuIHBhc3RpbmcuIFRoZSBiYWNrdGlja3MgYXJvdW5kIHRoZSBzdWZmaXggZ28sIGFuZFxuICAgICAgLy8gd2hhdCByZW1haW5zIGlzIGFwcGVuZGVkIHRvIHRoZSB0b2tlbiBiZWZvcmUgaXQsIHdoaWNoIGlzIHdoYXQgdGhlXG4gICAgICAvLyBhdXRob3Igd3JvdGU6IGBOQU1FYGBfVE1SYCBtZWFucyBgTkFNRV9UTVJgLlxuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoID09PSBcImBcIikge1xuICAgICAgY29uc3QgbWF0Y2ggPSAvXmBcXHMqKFtBLVphLXpfXVxcdyopXFxzKi8uZXhlYyh0ZXh0LnNsaWNlKGkpKTtcbiAgICAgIGNvbnN0IG5hbWUgPSBtYXRjaD8uWzFdO1xuICAgICAgaWYgKCFuYW1lKSB7XG4gICAgICAgIC8vIEEgZGlyZWN0aXZlIHJhdGhlciB0aGFuIGEgbWFjcm8gY2FsbC4gTGVmdCBhbG9uZTogdGhlIGFuYWx5c2VyIHJlYWRzXG4gICAgICAgIC8vIGRpcmVjdGl2ZXMgc2VwYXJhdGVseSBhbmQgcmV3cml0aW5nIHRoZW0gd291bGQgaGlkZSB0aGVtLlxuICAgICAgICBjb25zdCBsaXRlcmFsID0gL15gXFxzKltBLVphLXpfXVxcdyovLmV4ZWModGV4dC5zbGljZShpKSkhWzBdO1xuICAgICAgICBmb3IgKGxldCBrID0gMDsgayA8IGxpdGVyYWwubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgICBvdXQgKz0gbGl0ZXJhbFtrXSE7XG4gICAgICAgICAgb3JpZ2luLnB1c2gob3JpZ2luQmFzZSArIGkgKyBrKTtcbiAgICAgICAgfVxuICAgICAgICBpICs9IGxpdGVyYWwubGVuZ3RoO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2FsbFN0YXJ0ID0gaTtcbiAgICAgIGNvbnN0IGRlZiA9IG1hY3Jvcy5nZXQobmFtZSk7XG5cbiAgICAgIGlmICghZGVmKSB7XG4gICAgICAgIGNvbnN0IGxpdGVyYWwgPSBtYXRjaCFbMF07XG4gICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgbGl0ZXJhbC5sZW5ndGg7IGsrKykge1xuICAgICAgICAgIG91dCArPSBsaXRlcmFsW2tdITtcbiAgICAgICAgICBvcmlnaW4ucHVzaChvcmlnaW5CYXNlICsgaSArIGspO1xuICAgICAgICB9XG4gICAgICAgIGkgKz0gbGl0ZXJhbC5sZW5ndGg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhcmdzID0gcmVhZEFyZ3VtZW50cyh0ZXh0LCBpICsgbWF0Y2ghWzBdLmxlbmd0aCk7XG4gICAgICBjb25zdCBleHBhbmRlZEJvZHkgPSBzdWJzdGl0dXRlKGRlZiwgYXJncywgZGVwdGgpO1xuXG4gICAgICBpZiAoZGVwdGggPCBNQVhfRVhQQU5TSU9OX0RFUFRIICYmIGV4cGFuZGVkQm9keSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvbnN0IGlubmVyID0gZXhwYW5kKGV4cGFuZGVkQm9keS50ZXh0LCBtYWNyb3MsIGNhbGxTdGFydCwgZGVwdGggKyAxKTtcbiAgICAgICAgLy8gVGhlIGlubmVyIG1hcCBpcyByZWxhdGl2ZSB0byB0aGUgb3JpZ2luYWwgY2FsbDsgcmUtYmFzZSBpdCBvbnRvIHRoZVxuICAgICAgICAvLyBib2R5IHRleHQgaXQgY2FtZSBmcm9tLlxuICAgICAgICBvdXQgKz0gaW5uZXIudGV4dDtcbiAgICAgICAgZm9yIChjb25zdCBvZmZzZXQgb2YgaW5uZXIub3JpZ2luKSBvcmlnaW4ucHVzaChjYWxsU3RhcnQgKyBvZmZzZXQpO1xuICAgICAgICBpID0gYXJncy5lbmQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsaXRlcmFsID0gdGV4dC5zbGljZShjYWxsU3RhcnQsIGFyZ3MuZW5kKTtcbiAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgbGl0ZXJhbC5sZW5ndGg7IGsrKykge1xuICAgICAgICBvdXQgKz0gbGl0ZXJhbFtrXSE7XG4gICAgICAgIG9yaWdpbi5wdXNoKG9yaWdpbkJhc2UgKyBjYWxsU3RhcnQgKyBrKTtcbiAgICAgIH1cbiAgICAgIGkgPSBhcmdzLmVuZDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIG91dCArPSBjaDtcbiAgICBvcmlnaW4ucHVzaChvcmlnaW5CYXNlICsgaSk7XG4gICAgaSsrO1xuICB9XG5cbiAgcmV0dXJuIHsgdGV4dDogb3V0LCBvcmlnaW4gfTtcbn1cblxuaW50ZXJmYWNlIEFyZ3Mge1xuICByZWFkb25seSBhcmdzOiBzdHJpbmdbXTtcbiAgLyoqIE9mZnNldCBqdXN0IHBhc3QgdGhlIGNsb3NpbmcgcGFyZW50aGVzaXMgb2YgdGhlIGNhbGwsIGlmIHRoZXJlIHdhcyBvbmUuICovXG4gIHJlYWRvbmx5IGVuZDogbnVtYmVyO1xufVxuXG4vKiogUmVhZHMgdGhlIGFjdHVhbCBhcmd1bWVudHMgb2YgYSBtYWNybyBjYWxsIHN0YXJ0aW5nIGF0IGBhdGAuICovXG5mdW5jdGlvbiByZWFkQXJndW1lbnRzKHRleHQ6IHN0cmluZywgYXQ6IG51bWJlcik6IEFyZ3Mge1xuICBsZXQgaSA9IGF0O1xuICB3aGlsZSAoaSA8IHRleHQubGVuZ3RoICYmIC9cXHMvLnRlc3QodGV4dFtpXSEpKSBpKys7XG4gIGlmICh0ZXh0W2ldICE9PSBcIihcIikgcmV0dXJuIHsgYXJnczogW10sIGVuZDogaSB9O1xuXG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBzdGFydCA9IGkgKyAxO1xuICBjb25zdCBhcmdzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoOyBpIDwgdGV4dC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gdGV4dFtpXSE7XG4gICAgaWYgKGNoID09PSBcIihcIikgZGVwdGgrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gXCIpXCIpIHtcbiAgICAgIGRlcHRoLS07XG4gICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgYXJncy5wdXNoKHRleHQuc2xpY2Uoc3RhcnQsIGkpKTtcbiAgICAgICAgaSsrO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGNoID09PSBcIixcIiAmJiBkZXB0aCA9PT0gMSkge1xuICAgICAgYXJncy5wdXNoKHRleHQuc2xpY2Uoc3RhcnQsIGkpKTtcbiAgICAgIHN0YXJ0ID0gaSArIDE7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHsgYXJncywgZW5kOiBpIH07XG59XG5cbmludGVyZmFjZSBTdWJzdGl0dXRlZCB7XG4gIHJlYWRvbmx5IHRleHQ6IHN0cmluZztcbiAgLyoqIE9mZnNldCB3aXRoaW4gYHRleHRgIHdoZXJlIHRoZSBleHBhbmRlZCBib2R5IHN0YXJ0cy4gKi9cbiAgcmVhZG9ubHkgc3RhcnQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBSZXBsYWNlcyB0aGUgZm9ybWFsIGFyZ3VtZW50cyBvZiBhIG1hY3JvIHdpdGggdGhlIGFjdHVhbCBvbmVzLlxuICpcbiAqIEEgcGFyYW1ldGVyIGlzIG9ubHkgc3Vic3RpdHV0ZWQgYXMgYSB3aG9sZSB3b3JkLiBgTkFNRWAgaW5zaWRlIGBOQU1FX1RNUmAgaXNcbiAqIGEgZGlmZmVyZW50IGlkZW50aWZpZXIsIGFuZCByZXdyaXRpbmcgaXQgd291bGQgaW52ZW50IGEgc3ltYm9sIHRoZSBhdXRob3JcbiAqIG5ldmVyIHdyb3RlLlxuICovXG5mdW5jdGlvbiBzdWJzdGl0dXRlKGRlZjogTWFjcm9EZWYsIGNhbGw6IEFyZ3MsIGRlcHRoOiBudW1iZXIpOiBTdWJzdGl0dXRlZCB8IHVuZGVmaW5lZCB7XG4gIGlmIChkZWYucGFyYW1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgdGV4dDogZGVmLmJvZHksIHN0YXJ0OiAwIH07XG5cbiAgbGV0IG91dCA9IGRlZi5ib2R5O1xuICBsZXQgb2Zmc2V0ID0gMDtcblxuICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgZGVmLnBhcmFtcy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICBjb25zdCBmb3JtYWwgPSBkZWYucGFyYW1zW2luZGV4XSE7XG4gICAgY29uc3QgYWN0dWFsID0gY2FsbC5hcmdzW2luZGV4XT8udHJpbSgpID8/IFwiXCI7XG5cbiAgICBjb25zdCBwYXR0ZXJuID0gbmV3IFJlZ0V4cChgXFxcXGIke2VzY2FwZVJlZ0V4cChmb3JtYWwpfVxcXFxiYCwgXCJnXCIpO1xuICAgIG91dCA9IG91dC5yZXBsYWNlKHBhdHRlcm4sICgpID0+IHtcbiAgICAgIGNvbnN0IHdyaXR0ZW4gPSBhY3R1YWw7XG4gICAgICBvZmZzZXQgKz0gd3JpdHRlbi5sZW5ndGggLSBmb3JtYWwubGVuZ3RoO1xuICAgICAgcmV0dXJuIHdyaXR0ZW47XG4gICAgfSk7XG4gIH1cblxuICB2b2lkIG9mZnNldDtcbiAgdm9pZCBkZXB0aDtcbiAgcmV0dXJuIHsgdGV4dDogb3V0LCBzdGFydDogMCB9O1xufVxuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIik7XG59IiwgImltcG9ydCB0eXBlIHsgTm9kZSwgVHJlZSB9IGZyb20gXCJ3ZWItdHJlZS1zaXR0ZXJcIjtcbmltcG9ydCB0eXBlIHsgUG9zaXRpb24sIFJhbmdlIH0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10eXBlc1wiO1xuXG5pbXBvcnQgeyBldmFsdWF0ZVRleHQsIHJhbmdlV2lkdGgsIHVucGFja2VkQ291bnQsIHdpZHRoT2ZUZXh0LCB0eXBlIEV2YWxFbnYgfSBmcm9tIFwiLi9ldmFsLmpzXCI7XG5pbXBvcnQgdHlwZSB7XG4gIEFuYWx5c2lzLFxuICBIZGxJbnN0YW5jZSxcbiAgSGRsU2NvcGUsXG4gIEhkbFN5bWJvbCxcbiAgSWRlbnRpZmllclVzZSxcbiAgUGFja2FnZUltcG9ydCxcbiAgUG9ydEJpbmRpbmcsXG4gIFBvcnREaXJlY3Rpb24sXG4gIFNjb3BlQ2F0ZWdvcnksXG4gIFNjb3BlSW5kZXhFbnRyeSxcbiAgU3ltYm9sQ2F0ZWdvcnksXG59IGZyb20gXCIuL21vZGVsLmpzXCI7XG5pbXBvcnQgeyBjb2xsZWN0UmVmZXJlbmNlcyB9IGZyb20gXCIuL3NpZ25hbEFjY2Vzcy5qc1wiO1xuaW1wb3J0IHsgcmVhZEluY2x1ZGUsIHR5cGUgSW5jbHVkZURpcmVjdGl2ZSB9IGZyb20gXCIuL2luY2x1ZGVzLmpzXCI7XG5pbXBvcnQgeyBleHBhbmQsIHR5cGUgTWFjcm9UYWJsZSB9IGZyb20gXCIuL21hY3Jvcy5qc1wiO1xuaW1wb3J0IHsgaXRlcmF0ZSB9IGZyb20gXCIuL3RyZWVzLmpzXCI7XG5cbi8qIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqXG4gKiBTbWFsbCBub2RlIGhlbHBlcnNcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5mdW5jdGlvbiB0b1Bvc2l0aW9uKHA6IHsgcm93OiBudW1iZXI7IGNvbHVtbjogbnVtYmVyIH0pOiBQb3NpdGlvbiB7XG4gIHJldHVybiB7IGxpbmU6IHAucm93LCBjaGFyYWN0ZXI6IHAuY29sdW1uIH07XG59XG5cbmZ1bmN0aW9uIHRvUmFuZ2Uobm9kZTogTm9kZSk6IFJhbmdlIHtcbiAgcmV0dXJuIHtcbiAgICBzdGFydDogdG9Qb3NpdGlvbihub2RlLnN0YXJ0UG9zaXRpb24pLFxuICAgIGVuZDogdG9Qb3NpdGlvbihub2RlLmVuZFBvc2l0aW9uKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uKG5vZGU6IE5vZGUpOiBSYW5nZSB7XG4gIHJldHVybiB7XG4gICAgc3RhcnQ6IHRvUG9zaXRpb24obm9kZS5zdGFydFBvc2l0aW9uKSxcbiAgICBlbmQ6IHRvUG9zaXRpb24obm9kZS5lbmRQb3NpdGlvbiksXG4gIH07XG59XG5cbi8qKiBGaXJzdCBkZXNjZW5kYW50IG9mIGB0eXBlYCwgYnJlYWR0aC1maXJzdCwgb3IgbnVsbC4gKi9cbmZ1bmN0aW9uIGZpbmRDaGlsZChub2RlOiBOb2RlLCB0eXBlOiBzdHJpbmcpOiBOb2RlIHwgbnVsbCB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5uYW1lZENoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLnR5cGUgPT09IHR5cGUpIHJldHVybiBjaGlsZDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIEZpcnN0IGRlc2NlbmRhbnQgb2YgYHR5cGVgLCBzZWFyY2hpbmcgYnJlYWR0aC1maXJzdCwgb3IgbnVsbC4gKi9cbmZ1bmN0aW9uIGZpbmREZXNjZW5kYW50KG5vZGU6IE5vZGUsIHR5cGU6IHN0cmluZywgbWF4RGVwdGggPSA0KTogTm9kZSB8IG51bGwge1xuICBsZXQgZnJvbnRpZXI6IE5vZGVbXSA9IG5vZGUubmFtZWRDaGlsZHJlbjtcbiAgZm9yIChsZXQgZGVwdGggPSAwOyBkZXB0aCA8IG1heERlcHRoICYmIGZyb250aWVyLmxlbmd0aCA+IDA7IGRlcHRoKyspIHtcbiAgICBjb25zdCBuZXh0OiBOb2RlW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZyb250aWVyKSB7XG4gICAgICBpZiAoY2hpbGQudHlwZSA9PT0gdHlwZSkgcmV0dXJuIGNoaWxkO1xuICAgICAgbmV4dC5wdXNoKC4uLmNoaWxkLm5hbWVkQ2hpbGRyZW4pO1xuICAgIH1cbiAgICBmcm9udGllciA9IG5leHQ7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGZpbmRDaGlsZHJlbihub2RlOiBOb2RlLCB0eXBlOiBzdHJpbmcpOiBOb2RlW10ge1xuICByZXR1cm4gbm9kZS5uYW1lZENoaWxkcmVuLmZpbHRlcigoYykgPT4gYy50eXBlID09PSB0eXBlKTtcbn1cblxuLyoqXG4gKiBBIHBvcnQgcmVjb3ZlcmVkIGZyb20gYSBWZXJpbG9nLTE5OTUgYm9keSBkZWNsYXJhdGlvbiwgY2FycnlpbmcgdGhlIGlkIG9mXG4gKiB0aGUgaWRlbnRpZmllciBpdCBjYW1lIGZyb20gc28gaXQgY2FuIGJlIHJlZ2lzdGVyZWQgYXMgYSBkZWNsYXJhdGlvbi5cbiAqL1xuaW50ZXJmYWNlIExlZ2FjeVBvcnQgZXh0ZW5kcyBQZW5kaW5nU3ltYm9sIHtcbiAgZGVjbGFyYXRpb25JZDogbnVtYmVyO1xufVxuXG4vKipcbiAqIFJlYWRzIFZlcmlsb2ctMTk5NSBwb3J0IGRlY2xhcmF0aW9ucyBvdXQgb2YgYSBtb2R1bGUgYm9keS5cbiAqXG4gKiBgaW5wdXQgWzU6MF0gcmdfYWRkO2AgYW5kIGBvdXRwdXQgcmVnIFsxMjowXSBLMSwgSzI7YCBkZWNsYXJlIHBvcnRzIHdob3NlXG4gKiBkaXJlY3Rpb24sIHR5cGUgYW5kIHJhbmdlIG9ubHkgZXhpc3QgaGVyZS4gT25seSBuYW1lcyB0aGUgaGVhZGVyIGFsc28gbGlzdHNcbiAqIGJlY29tZSBwb3J0czogYSBib2R5IGRlY2xhcmF0aW9uIGFic2VudCBmcm9tIHRoZSBoZWFkZXIgaXMgYW4gaW50ZXJuYWwgbmV0LlxuICovXG5mdW5jdGlvbiBwYXJzZUxlZ2FjeVBvcnRzKGJvZHk6IE5vZGUsIGhlYWRlck5hbWVzOiBSZWFkb25seVNldDxzdHJpbmc+KTogTGVnYWN5UG9ydFtdIHtcbiAgY29uc3Qgb3V0OiBMZWdhY3lQb3J0W10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5vZGUgb2YgaXRlcmF0ZShib2R5KSkge1xuICAgIGlmIChub2RlLnR5cGUgIT09IFwicG9ydF9kZWNsYXJhdGlvblwiKSBjb250aW51ZTtcblxuICAgIC8vIGBwb3J0X2RlY2xhcmF0aW9uYCB3cmFwcyBhbiBgaW5wdXRfZGVjbGFyYXRpb25gIC8gYG91dHB1dF9kZWNsYXJhdGlvbmAsXG4gICAgLy8gd2hpY2ggaXMgd2hlcmUgdGhlIGRpcmVjdGlvbiwgdHlwZSBhbmQgaWRlbnRpZmllciBsaXN0IGFjdHVhbGx5IGxpdmUuXG4gICAgY29uc3QgaW5uZXIgPSBub2RlLm5hbWVkQ2hpbGQoMCk7XG4gICAgaWYgKCFpbm5lcikgY29udGludWU7XG5cbiAgICBjb25zdCBkaXJlY3Rpb24gPSBwYXJzZURpcmVjdGlvbihpbm5lci5jaGlsZHJlbi5maW5kKChjKSA9PiAhYy5pc05hbWVkKT8udGV4dCA/PyBcIlwiKTtcbiAgICBpZiAoIWRpcmVjdGlvbikgY29udGludWU7XG5cbiAgICAvLyBgaW5wdXQgWzU6MF0gcmdfYWRkYCBkZWNsYXJlcyB0aGUgcmFuZ2UgYXMgdGhlIG5ldCdzIG93biBkaW1lbnNpb247XG4gICAgLy8gYG91dHB1dCByZWcgWzEyOjBdIEsxYCBwdXRzIGl0IGluc2lkZSBhIGB2YXJpYWJsZV9wb3J0X3R5cGVgLlxuICAgIGNvbnN0IHBvcnRUeXBlID0gaW5uZXIubmFtZWRDaGlsZHJlbi5maW5kKFxuICAgICAgKGMpID0+IGMudHlwZSA9PT0gXCJuZXRfcG9ydF90eXBlXCIgfHwgYy50eXBlID09PSBcInZhcmlhYmxlX3BvcnRfdHlwZVwiLFxuICAgICk7XG5cbiAgICBjb25zdCBwYWNrZWREaW0gPSBwb3J0VHlwZSA/IGZpbmREZXNjZW5kYW50KHBvcnRUeXBlLCBcInBhY2tlZF9kaW1lbnNpb25cIiwgMikgOiBudWxsO1xuXG4gICAgLy8gYG91dHB1dCByZWcgWzEyOjBdIHFgIC0tIGByZWdgIHNheXMgdGhlIHN0b3JhZ2UgY2xhc3MsIG5vdCB0aGUgdHlwZSwgc29cbiAgICAvLyBpdCBtdXN0IG5vdCBlbmQgdXAgaW4gYHR5cGVUZXh0YCB3aGVyZSBob3ZlciB3b3VsZCBkaXNwbGF5IGl0IGFzIG9uZS5cbiAgICBjb25zdCBzcGxpdCA9IHBvcnRUeXBlID8gc3BsaXRQYWNrZWRUZXh0KHBvcnRUeXBlLnRleHQpIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IHR5cGVUZXh0ID0gc3BsaXRcbiAgICAgID8gc3BsaXQudHlwZSAmJiAhL14ocmVnfGxvZ2ljfHdpcmV8Yml0fGludGVnZXJ8aW50fHZhcikkLy50ZXN0KHNwbGl0LnR5cGUpXG4gICAgICAgID8gc3BsaXQudHlwZVxuICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgcGFja2VkUmFuZ2VUZXh0ID0gaW5uZXJPZihwYWNrZWREaW0pID8/IHNwbGl0Py5yYW5nZTtcblxuICAgIGNvbnN0IGlkZW50aWZpZXJMaXN0ID0gaW5uZXIubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUuc3RhcnRzV2l0aChcImxpc3Rfb2ZfXCIpKTtcbiAgICBpZiAoIWlkZW50aWZpZXJMaXN0KSBjb250aW51ZTtcblxuICAgIGZvciAoY29uc3QgbmFtZU5vZGUgb2YgaWRlbnRpZmllckxpc3QubmFtZWRDaGlsZHJlbikge1xuICAgICAgaWYgKG5hbWVOb2RlLnR5cGUgIT09IFwic2ltcGxlX2lkZW50aWZpZXJcIiAmJiBuYW1lTm9kZS50eXBlICE9PSBcInBvcnRfaWRlbnRpZmllclwiKSBjb250aW51ZTtcbiAgICAgIGlmICghaGVhZGVyTmFtZXMuaGFzKG5hbWVOb2RlLnRleHQpKSBjb250aW51ZTtcblxuICAgICAgb3V0LnB1c2goe1xuICAgICAgICBuYW1lOiBuYW1lTm9kZS50ZXh0LFxuICAgICAgICBjYXRlZ29yeTogXCJwb3J0XCIsXG4gICAgICAgIHR5cGVUZXh0OiB0eXBlVGV4dCA/PyBcIlwiLFxuICAgICAgICBwYWNrZWRSYW5nZVRleHQsXG4gICAgICAgIHBhY2tlZFJhbmdlTm9kZTogcGFja2VkRGltLFxuICAgICAgICB1bnBhY2tlZERpbXM6IFtdLFxuICAgICAgICBkaXJlY3Rpb24sXG4gICAgICAgIGlzUG9ydDogdHJ1ZSxcbiAgICAgICAgc2NvcGVJZDogLTEsXG4gICAgICAgIHJhbmdlOiB0b1JhbmdlKG5vZGUpLFxuICAgICAgICBzZWxlY3Rpb25SYW5nZTogc2VsZWN0aW9uKG5hbWVOb2RlKSxcbiAgICAgICAgZGVjbGFyYXRpb25JZDogbmFtZU5vZGUuaWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogVGV4dCBvZiBgbm9kZWAgd2l0aCBzdXJyb3VuZGluZyB3aGl0ZXNwYWNlIHJlbW92ZWQuICovXG5mdW5jdGlvbiBub2RlVGV4dChub2RlOiBOb2RlIHwgbnVsbCB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlID8gbm9kZS50ZXh0LnRyaW0oKSA6IFwiXCI7XG59XG5cbi8qKiBJbm5lciB0ZXh0IG9mIGEgYnJhY2tldGVkIG5vZGUsIGUuZy4gYFs3OjBdYCAtPiBgNzowYC4gKi9cbmZ1bmN0aW9uIGlubmVyT2Yobm9kZTogTm9kZSB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAoIW5vZGUpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHJhdyA9IG5vZGUudGV4dC50cmltKCk7XG4gIGlmIChyYXcuc3RhcnRzV2l0aChcIltcIikgJiYgcmF3LmVuZHNXaXRoKFwiXVwiKSkgcmV0dXJuIHJhdy5zbGljZSgxLCAtMSkudHJpbSgpO1xuICByZXR1cm4gcmF3O1xufVxuXG4vKipcbiAqIFNwbGl0cyBhIHRyYWlsaW5nIHBhY2tlZCBkaW1lbnNpb24gb2ZmIGEgdHlwZSB3cml0dGVuIGFzIGEgc2luZ2xlIHRva2VuLlxuICpcbiAqIGBuZXRfcG9ydF90eXBlYCBub2RlcyBzdWNoIGFzIGB3aXJlIFs3OjBdYCBjYXJyeSBubyBjaGlsZCBub2RlIGZvciB0aGVcbiAqIGRpbWVuc2lvbiwgc28gdGhlIHJhbmdlIGhhcyB0byBiZSByZWNvdmVyZWQgZnJvbSB0aGUgdGV4dC5cbiAqL1xuZnVuY3Rpb24gc3BsaXRQYWNrZWRUZXh0KHRleHQ6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHsgdHlwZTogc3RyaW5nOyByYW5nZT86IHN0cmluZyB9IHtcbiAgaWYgKCF0ZXh0KSByZXR1cm4geyB0eXBlOiBcIlwiIH07XG4gIGNvbnN0IG1hdGNoID0gL1xcW1xccyooW15cXF1dKj8pXFxzKlxcXS8uZXhlYyh0ZXh0KTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIHsgdHlwZTogdGV4dC50cmltKCkgfTtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAodGV4dC5zbGljZSgwLCBtYXRjaC5pbmRleCkgKyB0ZXh0LnNsaWNlKG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoKSkudHJpbSgpLFxuICAgIHJhbmdlOiBtYXRjaFsxXSxcbiAgfTtcbn1cblxuLyoqXG4gKiBUZXh0IG9mIGFuIGluaXRpYWxpemVyIC8gYmluZGluZyB2YWx1ZS5cbiAqXG4gKiBEZWNsYXJhdGlvbnMgY2FycnkgdGhlIHZhbHVlIGFzIGV2ZXJ5dGhpbmcgYWZ0ZXIgYD1gOyBuYW1lZCBiaW5kaW5ncyBzdWNoIGFzXG4gKiBgLnBvcnQoc2lnbmFsKWAgY2FycnkgaXQgYmV0d2VlbiB0aGUgcGFyZW50aGVzZXMgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gdmFsdWVUZXh0KG5vZGU6IE5vZGUpOiBzdHJpbmcge1xuICBjb25zdCBvcGVuID0gbm9kZS5jaGlsZHJlbi5maW5kSW5kZXgoKGMpID0+ICFjLmlzTmFtZWQgJiYgYy50eXBlID09PSBcIihcIik7XG4gIGlmIChvcGVuID49IDApIHtcbiAgICByZXR1cm4gbm9kZS5jaGlsZHJlbi5zbGljZShvcGVuICsgMSwgLTEpLm1hcCgoYykgPT4gYy50ZXh0KS5qb2luKFwiXCIpLnRyaW0oKTtcbiAgfVxuICBjb25zdCBlcXVhbHMgPSBub2RlLmNoaWxkcmVuLmZpbmRJbmRleCgoYykgPT4gIWMuaXNOYW1lZCAmJiBjLnR5cGUgPT09IFwiPVwiKTtcbiAgaWYgKGVxdWFscyA+PSAwKSB7XG4gICAgcmV0dXJuIG5vZGUuY2hpbGRyZW4uc2xpY2UoZXF1YWxzICsgMSkubWFwKChjKSA9PiBjLnRleHQpLmpvaW4oXCJcIikudHJpbSgpO1xuICB9XG4gIHJldHVybiBcIlwiO1xufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogU2NvcGUga2luZHNcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5jb25zdCBTQ09QRV9LSU5EUzogUmVjb3JkPHN0cmluZywgU2NvcGVDYXRlZ29yeSB8IHVuZGVmaW5lZD4gPSB7XG4gIG1vZHVsZV9kZWNsYXJhdGlvbjogXCJtb2R1bGVcIixcbiAgaW50ZXJmYWNlX2RlY2xhcmF0aW9uOiBcImludGVyZmFjZVwiLFxuICBwcm9ncmFtX2RlY2xhcmF0aW9uOiBcInByb2dyYW1cIixcbiAgcGFja2FnZV9kZWNsYXJhdGlvbjogXCJwYWNrYWdlXCIsXG4gIGNsYXNzX2RlY2xhcmF0aW9uOiBcImNsYXNzXCIsXG4gIGZ1bmN0aW9uX2RlY2xhcmF0aW9uOiBcImZ1bmN0aW9uXCIsXG4gIHRhc2tfZGVjbGFyYXRpb246IFwidGFza1wiLFxuICBnZW5lcmF0ZV9ibG9jazogXCJibG9ja1wiLFxuICBnZW5lcmF0ZV9yZWdpb246IFwiYmxvY2tcIixcbiAgYmVnaW5fZ2VuZXJhdGVfYmxvY2s6IFwiYmxvY2tcIixcbn07XG5cbi8qKlxuICogUHJvY2VkdXJhbCBibG9ja3MgdGhhdCBhcmUgYSBzY29wZSBvbmx5IHdoZW4gdGhleSBhcmUgbmFtZWQuXG4gKlxuICogYGJlZ2luIDogbmFtZSAuLi4gZW5kYCBpcyBhZGRyZXNzYWJsZSBhcyBgbmFtZS5zaWduYWxgLCBzbyBpdCBoYXMgdG8gYmUgYVxuICogc2NvcGUuIEEgYmFyZSBgYmVnaW4gLi4uIGVuZGAgaXMgbm90IGFkZHJlc3NhYmxlIGJ5IGFueXRoaW5nLCBhbmQgbWFraW5nIG9uZSBhXG4gKiBzY29wZSBjb3N0cyBldmVyeSBsYXRlciBsb29rdXAgYSByYW5nZSB0byBmaWx0ZXI6IGEgMjQzLWxpbmUgbW9kdWxlIGVuZGVkIHVwXG4gKiB3aXRoIDU1IHNjb3BlcyBpbnN0ZWFkIG9mIGEgZG96ZW4sIGFuZCBgc2NvcGVDaGFpbmAgaXMgY2FsbGVkIG9uIGV2ZXJ5XG4gKiBrZXlzdHJva2UuIFNvIGFuIHVubmFtZWQgYmxvY2sgY29udHJpYnV0ZXMgaXRzIGRlY2xhcmF0aW9ucyB0byB0aGUgZW5jbG9zaW5nXG4gKiBzY29wZSBpbnN0ZWFkIG9mIGdldHRpbmcgb25lIG9mIGl0cyBvd24uXG4gKi9cbmNvbnN0IFBST0NFRFVSQUxfQkxPQ0tTID0gbmV3IFNldChbXCJzZXFfYmxvY2tcIiwgXCJwYXJfYmxvY2tcIl0pO1xuXG5jb25zdCBIRUFERVJfVFlQRVMgPSBuZXcgU2V0KFtcbiAgXCJtb2R1bGVfYW5zaV9oZWFkZXJcIixcbiAgXCJtb2R1bGVfbm9uYW5zaV9oZWFkZXJcIixcbiAgXCJpbnRlcmZhY2VfYW5zaV9oZWFkZXJcIixcbiAgXCJpbnRlcmZhY2Vfbm9uYW5zaV9oZWFkZXJcIixcbiAgXCJwcm9ncmFtX2Fuc2lfaGVhZGVyXCIsXG4gIFwicHJvZ3JhbV9ub25hbnNpX2hlYWRlclwiLFxuICBcInBhY2thZ2VfaGVhZGVyXCIsXG5dKTtcblxuLyoqXG4gKiBUaGUgc2NvcGVzIGEgbmFtZSBoYXMgdG8gYmUgcmVhY2hhYmxlIGZyb20uXG4gKlxuICogQSBuYW1lZCBibG9jayBpcyB2aXNpYmxlIHRvIHRoZSB3aG9sZSBkZXNpZ24gdW5pdCBhcm91bmQgaXQsIG5vdCBqdXN0IHRvIGl0c1xuICogaW1tZWRpYXRlIHBhcmVudCwgc28gdGhlIGNoYWluIG9mIGRlY2xhcmF0aW9ucyBzdG9wcyBoZXJlLlxuICovXG5jb25zdCBERVNJR05fVU5JVFMgPSBuZXcgU2V0PFNjb3BlQ2F0ZWdvcnk+KFtcbiAgXCJtb2R1bGVcIixcbiAgXCJpbnRlcmZhY2VcIixcbiAgXCJwcm9ncmFtXCIsXG4gIFwicGFja2FnZVwiLFxuICBcImNsYXNzXCIsXG5dKTtcblxuLyoqXG4gKiBOb2RlcyB0aGF0IG9ubHkgd3JhcCB0aGUgaXRlbXMgb2YgYSBzY29wZSwgd2l0aCBub3RoaW5nIG9mIHRoZWlyIG93bi5cbiAqXG4gKiBGbGF0dGVuaW5nIHRoZW0gaXMgd2hhdCBsZXRzIGEgZGVjbGFyYXRpb24gaW5zaWRlIHRoZW0gYmUgcmVhZCBhcyBhXG4gKiBkZWNsYXJhdGlvbiBvZiB0aGUgc2NvcGUgdGhhdCBlbmNsb3NlcyB0aGVtLiBUaGUgZ2VuZXJhdGUgY29uc3RydWN0cyBiZWxvbmdcbiAqIGhlcmUgZm9yIHRoZSBzYW1lIHJlYXNvbiBgcGFja2FnZV9pdGVtYCBkb2VzIC0tIGBnZW5lcmF0ZV9yZWdpb24gPiBjb25kaXRpb25hbF9cbiAqIGdlbmVyYXRlX2NvbnN0cnVjdCA+IGlmX2dlbmVyYXRlX2NvbnN0cnVjdCA+IGdlbmVyYXRlX2Jsb2NrYCBpcyBmb3VyIGxldmVscyBvZlxuICogd3JhcHBlciBhcm91bmQgb25lIGJsb2NrLCBhbmQgc3RvcHBpbmcgYXQgdGhlIGZpcnN0IG9uZSBsZWF2ZXMgdGhlIGJsb2NrXG4gKiBpdHNlbGYgdW52aXNpdGVkLlxuICovXG5jb25zdCBJVEVNX1dSQVBQRVJTID0gbmV3IFNldChbXG4gIFwicGFja2FnZV9pdGVtXCIsXG4gIFwiY2xhc3NfaXRlbVwiLFxuICBcImNoZWNrZXJfaXRlbVwiLFxuICBcImNvbmZpZ19kZWNsYXJhdGlvblwiLFxuICAvLyBWZXJpbG9nLTE5OTU6IHdpdGggYSBub24tQU5TSSBoZWFkZXIsIGV2ZXJ5IGRlY2xhcmF0aW9uIGluIHRoZSBib2R5IGlzXG4gIC8vIHdyYXBwZWQgaW4gYSBgbW9kdWxlX2l0ZW1gLiBXaXRob3V0IHRoZXNlLCBgcGFyYW1ldGVyIGludGVnZXIgREFUQVcgPSAxMjtgXG4gIC8vIHdyaXR0ZW4gYWZ0ZXIgYG1vZHVsZSBtIChhKTtgIGlzIG5ldmVyIHJlYWNoZWQgLS0gYSB3aG9sZSBkZXNpZ24gZGlhbGVjdFxuICAvLyBsb3NlcyBpdHMgcGFyYW1ldGVycywgYW5kIG9ubHkgaXRzIHBvcnRzIHN1cnZpdmUsIGJlY2F1c2UgdGhvc2UgYXJlIHJlYWRcbiAgLy8gZnJvbSB0aGUgYm9keSBieSBhIHNlcGFyYXRlIHBhdGguXG4gIFwibW9kdWxlX2l0ZW1cIixcbiAgXCJpbnRlcmZhY2VfaXRlbVwiLFxuICBcInByb2dyYW1faXRlbVwiLFxuICAvLyBTdGF0ZW1lbnRzLiBBIG5hbWVkIGJsb2NrIGlzIHJlYWNoZWQgb25seSBieSBkZXNjZW5kaW5nIHRocm91Z2ggdGhlc2U6XG4gIC8vIGBpbml0aWFsIGJlZ2luIDogbmFtZWAgaXMgYGluaXRpYWxfY29uc3RydWN0ID4gc3RhdGVtZW50X29yX251bGwgPlxuICAvLyBzdGF0ZW1lbnQgPiBzdGF0ZW1lbnRfaXRlbSA+IHNlcV9ibG9ja2AsIGFuZCBzdG9wcGluZyBhbnkgZWFybGllciBsZWF2ZXMgdGhlXG4gIC8vIGJsb2NrIHVub3BlbmVkIGFuZCBldmVyeSBzaWduYWwgaW5zaWRlIGl0IHVuZGVjbGFyZWQuXG4gIFwiaW5pdGlhbF9jb25zdHJ1Y3RcIixcbiAgXCJmaW5hbF9jb25zdHJ1Y3RcIixcbiAgXCJhbHdheXNfY29uc3RydWN0XCIsXG4gIFwicHJvY2VkdXJhbF90aW1pbmdfY29udHJvbF9zdGF0ZW1lbnRcIixcbiAgXCJzdGF0ZW1lbnRfb3JfbnVsbFwiLFxuICBcInN0YXRlbWVudFwiLFxuICBcInN0YXRlbWVudF9pdGVtXCIsXG4gIFwiYmxvY2tfc3RhdGVtZW50X29yX251bGxcIixcbiAgLy8gQSB0YXNrIG9yIGZ1bmN0aW9uIGJvZHkuIFdpdGhvdXQgdGhlc2UsIGV2ZXJ5dGhpbmcgZGVjbGFyZWQgaW5zaWRlIG9uZSBpc1xuICAvLyBpbnZpc2libGU6IGB0YXNrIGF1dG9tYXRpYyBkcml2ZTsgbG9naWMgWzc6MF0gYTsgLi4uIGVuZHRhc2tgIG9wZW5zIGEgc2NvcGVcbiAgLy8gZm9yIGBkcml2ZWAgYnV0IG5ldmVyIHdhbGtzIGludG8gdGhlIGJvZHkgdGhhdCBob2xkcyBpdCwgc28gZXZlcnkgbG9jYWxcbiAgLy8gdmFyaWFibGUgcmVhZHMgYXMgdW5kZWNsYXJlZCBhbmQgZXZlcnkgY2FsbCBpbnNpZGUgaXQgaXMgdW5jaGVja2VkLlxuICBcInRhc2tfYm9keV9kZWNsYXJhdGlvblwiLFxuICBcImZ1bmN0aW9uX2JvZHlfZGVjbGFyYXRpb25cIixcbiAgLy8gYGxvZ2ljIGE7YCBpbnNpZGUgYSB0YXNrIGFycml2ZXMgYXMgYHRmX2l0ZW1fZGVjbGFyYXRpb24gPiBibG9ja19pdGVtX1xuICAvLyBkZWNsYXJhdGlvbiA+IGRhdGFfZGVjbGFyYXRpb25gIGluIG9uZSBncmFtbWFyIGFuZCBhc1xuICAvLyBgYmxvY2tfaXRlbV9kZWNsYXJhdGlvbiA+IGRhdGFfZGVjbGFyYXRpb25gIGluIGFub3RoZXIsIHNvIGJvdGggd3JhcHBlcnNcbiAgLy8gaGF2ZSB0byBiZSBmbGF0dGVuZWQgZm9yIGVpdGhlciB0byBiZSByZWFkLlxuICBcInRmX2l0ZW1fZGVjbGFyYXRpb25cIixcbiAgXCJmdW5jdGlvbl9zdGF0ZW1lbnRfb3JfbnVsbFwiLFxuICBcImZ1bmN0aW9uX3N0YXRlbWVudFwiLFxuICBcImNvbmRpdGlvbmFsX3N0YXRlbWVudFwiLFxuICBcImxvb3Bfc3RhdGVtZW50XCIsXG4gIFwiY2FzZV9zdGF0ZW1lbnRcIixcbiAgXCJjYXNlX2l0ZW1cIixcbl0pO1xuXG4vKipcbiAqIFRydWUgd2hlbiBhIG5vZGUgb25seSB3cmFwcyB0aGUgaXRlbXMgb2YgdGhlIHNjb3BlIHRoYXQgZW5jbG9zZXMgaXQuXG4gKlxuICogVGhlIGdlbmVyYXRlIGNvbnN0cnVjdHMgYXJlIG1hdGNoZWQgYnkgc2hhcGUgcmF0aGVyIHRoYW4gYnkgYSBoYW5kLXdyaXR0ZW5cbiAqIGxpc3QsIGJlY2F1c2UgdGhlaXIgbmFtZXMgYXJlIG5vdCBndWVzc2FibGU6IHRoZSBncmFtbWFyIGNhbGxzIGEgYGZvcmBcbiAqIGNvbnN0cnVjdCBgbG9vcF9nZW5lcmF0ZV9jb25zdHJ1Y3RgIGFuZCBhIGNhc2UgYXJtIGBjYXNlX2dlbmVyYXRlX2l0ZW1gLCBhbmRcbiAqIGFuIGVhcmxpZXIgYXR0ZW1wdCB0aGF0IGxpc3RlZCBgZm9yX2dlbmVyYXRlX2NvbnN0cnVjdGAgc2lsZW50bHkgbWF0Y2hlZFxuICogbm90aGluZyAtLSBldmVyeSBgYmVnaW4gOiBuYW1lYCBpbnNpZGUgYSBnZW5lcmF0ZSBsb29wIHdlbnQgdW5vcGVuZWQsIGFuZFxuICogbm90aGluZyBzYWlkIHNvLlxuICpcbiAqIEEgbm9kZSBpcyBhIHdyYXBwZXIgd2hlbiBpdCBpcyBvbmUgb2YgdGhlIGtub3duIG9uZXMsIG9yIHdoZW4gaXRzIHR5cGUgc2F5c1xuICogXCJnZW5lcmF0ZVwiIHdpdGhvdXQgYmVpbmcgYSBnZW5lcmF0ZSBzY29wZSBvciBhIGtleXdvcmQgb2YgaXRzIG93bi5cbiAqL1xuZnVuY3Rpb24gaXNUcmFuc3BhcmVudFdyYXBwZXIodHlwZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIC8vIE1lbW9pc2VkIGJlY2F1c2UgdGhlIGFuc3dlciBkZXBlbmRzIG9ubHkgb24gdGhlIG5vZGUgdHlwZSwgYW5kIGEgZG9jdW1lbnRcbiAgLy8gaGFzIGEgZmV3IGRvemVuIGRpc3RpbmN0IHR5cGVzIGFnYWluc3QgdGhvdXNhbmRzIG9mIG5vZGVzLiBXaXRob3V0IHRoaXMgdGhlXG4gIC8vIHN1YnN0cmluZyBzY2FuIHJ1bnMgb24gZXZlcnkgbm9kZSBvZiBldmVyeSB0cmF2ZXJzYWwuXG4gIGNvbnN0IGNhY2hlZCA9IHdyYXBwZXJWZXJkaWN0cy5nZXQodHlwZSk7XG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcblxuICBjb25zdCB2ZXJkaWN0ID0gSVRFTV9XUkFQUEVSUy5oYXModHlwZSlcbiAgICA/IHRydWVcbiAgICA6ICF0eXBlLmluY2x1ZGVzKFwiZ2VuZXJhdGVcIilcbiAgICAgID8gZmFsc2VcbiAgICAgIDogIUdFTkVSQVRFX1NDT1BFUy5oYXModHlwZSkgJiYgdHlwZSAhPT0gXCJnZW5lcmF0ZVwiICYmIHR5cGUgIT09IFwiZW5kZ2VuZXJhdGVcIjtcblxuICB3cmFwcGVyVmVyZGljdHMuc2V0KHR5cGUsIHZlcmRpY3QpO1xuICByZXR1cm4gdmVyZGljdDtcbn1cblxuY29uc3Qgd3JhcHBlclZlcmRpY3RzID0gbmV3IE1hcDxzdHJpbmcsIGJvb2xlYW4+KCk7XG5cbi8qKiBUaGUgZ2VuZXJhdGUgbm9kZSB0eXBlcyB0aGF0IGFyZSBzY29wZXMgcmF0aGVyIHRoYW4gd3JhcHBlcnMuICovXG5jb25zdCBHRU5FUkFURV9TQ09QRVMgPSBuZXcgU2V0KFtcImdlbmVyYXRlX3JlZ2lvblwiLCBcImdlbmVyYXRlX2Jsb2NrXCIsIFwiYmVnaW5fZ2VuZXJhdGVfYmxvY2tcIl0pO1xuXG4vKipcbiAqIFRoZSBub2RlIHRoYXQgY2FycmllcyBhIHNjb3BlJ3MgbmFtZSwgcG9ydHMgYW5kIGhlYWRlciBwYXJhbWV0ZXJzLlxuICpcbiAqIFJldHVybnMgbnVsbCB3aGVuIHRoZXJlIGlzIG5vIHN1Y2ggbm9kZTogYHBhY2thZ2UgcDtgIGFuZCBgY2xhc3MgQztgIHB1dCB0aGVcbiAqIG5hbWUgZGlyZWN0bHkgb24gdGhlIGRlY2xhcmF0aW9uIGFuZCBoYXZlIG5vIGhlYWRlciBub2RlIGF0IGFsbC4gRmFsbGluZyBiYWNrXG4gKiB0byB0aGUgZGVjbGFyYXRpb24gaXRzZWxmIHdvdWxkIGJlIHdyb25nLCBiZWNhdXNlIGl0cyBjaGlsZHJlbiBpbmNsdWRlIHRoZVxuICogd2hvbGUgYm9keSAtLSBzY2FubmluZyBpdCBmb3IgaGVhZGVyIHBhcmFtZXRlcnMgY291bnRzIGV2ZXJ5IGRlY2xhcmF0aW9uIGluXG4gKiB0aGUgYm9keSBhIHNlY29uZCB0aW1lLlxuICovXG5mdW5jdGlvbiBzY29wZUhlYWRlcihzY29wZU5vZGU6IE5vZGUpOiBOb2RlIHwgbnVsbCB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2Ygc2NvcGVOb2RlLm5hbWVkQ2hpbGRyZW4pIHtcbiAgICBpZiAoSEVBREVSX1RZUEVTLmhhcyhjaGlsZC50eXBlKSkgcmV0dXJuIGNoaWxkO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogVGhlIGlkZW50aWZpZXIgdGhhdCBuYW1lcyBhIHNjb3BlLCB3aGVyZXZlciB0aGUgZ3JhbW1hciBwdXQgaXQuICovXG5mdW5jdGlvbiBzY29wZU5hbWVOb2RlKHNjb3BlTm9kZTogTm9kZSwgaGVhZGVyOiBOb2RlIHwgbnVsbCk6IE5vZGUgfCBudWxsIHtcbiAgY29uc3QgbmFtZWQgPSBoZWFkZXI/LmNoaWxkRm9yRmllbGROYW1lKFwibmFtZVwiKSA/PyBzY29wZU5vZGUuY2hpbGRGb3JGaWVsZE5hbWUoXCJuYW1lXCIpO1xuICBpZiAobmFtZWQpIHJldHVybiBuYW1lZDtcblxuICAvLyBgcGFja2FnZWAgLyBgY2xhc3NgIG5hbWUgdGhlbXNlbHZlcyB3aXRoIGEgYmFyZSBpZGVudGlmaWVyIGNoaWxkLlxuICBjb25zdCBkaXJlY3QgPSBzY29wZU5vZGUubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIik7XG4gIGlmIChkaXJlY3QpIHJldHVybiBkaXJlY3Q7XG5cbiAgLy8gQSBmdW5jdGlvbiBvciB0YXNrIGJ1cmllcyBpdHMgbmFtZSBpbnNpZGUgdGhlIGJvZHkgZGVjbGFyYXRpb24sIG9uZSBsZXZlbFxuICAvLyBiZWxvdyB0aGUgcmV0dXJuIHR5cGUuXG4gIGNvbnN0IGJvZHkgPSBzY29wZU5vZGUubmFtZWRDaGlsZHJlbi5maW5kKFxuICAgIChjKSA9PiBjLnR5cGUgPT09IFwiZnVuY3Rpb25fYm9keV9kZWNsYXJhdGlvblwiIHx8IGMudHlwZSA9PT0gXCJ0YXNrX2JvZHlfZGVjbGFyYXRpb25cIixcbiAgKTtcbiAgcmV0dXJuIGJvZHk/Lm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpID8/IG51bGw7XG59XG5cbi8qKlxuICogVGhlIGNsYXNzIG5hbWUgaW4gYSB0eXBlIHBvc2l0aW9uLCB3aGVuIHRoZSB0eXBlIGlzIGEgY2xhc3MuXG4gKlxuICogYFBhY2tldCAjKDgpIHBrdDtgIHB1dHMgdGhlIG5hbWUgaW5zaWRlIGEgYGNsYXNzX3R5cGVgLCBuZXh0IHRvIHRoZSBwYXJhbWV0ZXJcbiAqIG92ZXJyaWRlczsgYFBhY2tldCBwa3Q7YCBoYXMgbm8gYGNsYXNzX3R5cGVgIGF0IGFsbCBhbmQgdGhlIG5hbWUgKmlzKiB0aGVcbiAqIHR5cGUuIEJvdGggc3BlbGxpbmdzIG1lYW4gdGhlIHNhbWUgZGVjbGFyYXRpb24sIGFuZCBuZWl0aGVyIGNhbiBiZSByZWFkIG9mZlxuICogdGhlIHR5cGUncyB0ZXh0IC0tIGZvciB0aGUgcGFyYW1ldGVyaXNlZCBmb3JtIHRoYXQgdGV4dCBpcyBgUGFja2V0ICMoOClgLlxuICogUmV0dXJuaW5nIG51bGwgbGVhdmVzIHRoZSBkZWNsYXJhdGlvbiB0byBiZSByZWFkIGFzIGFuIG9yZGluYXJ5IG5ldC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NUeXBlTmFtZSh0eXBlTm9kZTogTm9kZSB8IG51bGwsIGtub3duQ2xhc3NlczogUmVhZG9ubHlTZXQ8c3RyaW5nPik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBjbGFzc1R5cGUgPSB0eXBlTm9kZSA/IGZpbmRDaGlsZCh0eXBlTm9kZSwgXCJjbGFzc190eXBlXCIpIDogbnVsbDtcbiAgY29uc3QgbmFtZWQgPSBjbGFzc1R5cGU/Lm5hbWVkQ2hpbGQoMCk7XG4gIGlmIChuYW1lZD8udHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKSByZXR1cm4gbmFtZWQudGV4dDtcblxuICBjb25zdCBiYXJlID0gdHlwZU5vZGU/Lm5hbWVkQ2hpbGQoMCk7XG4gIGlmIChiYXJlPy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgJiYga25vd25DbGFzc2VzLmhhcyhiYXJlLnRleHQpKSByZXR1cm4gYmFyZS50ZXh0O1xuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogVGhlIHR5cGUgbmFtZSBpbiBgZXh0ZW5kcyA8Y2xhc3NfdHlwZT5gLCB3aXRob3V0IGl0cyBwYXJhbWV0ZXIgb3ZlcnJpZGVzLiAqL1xuZnVuY3Rpb24gYmFzZUNsYXNzTmFtZShjbGFzc05vZGU6IE5vZGUpOiBOb2RlIHwgbnVsbCB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgY2xhc3NOb2RlLm5hbWVkQ2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQudHlwZSAhPT0gXCJjbGFzc190eXBlXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGZpcnN0ID0gY2hpbGQubmFtZWRDaGlsZCgwKTtcbiAgICBpZiAoZmlyc3Q/LnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikgcmV0dXJuIGZpcnN0O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogQW5hbHl6ZXJcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5pbnRlcmZhY2UgTXV0YWJsZVNjb3BlIHtcbiAgaWQ6IG51bWJlcjtcbiAgbmFtZTogc3RyaW5nO1xuICBjYXRlZ29yeTogU2NvcGVDYXRlZ29yeTtcbiAgcGFyZW50SWQ/OiBudW1iZXI7XG4gIHJhbmdlOiBSYW5nZTtcbiAgc2VsZWN0aW9uUmFuZ2U6IFJhbmdlO1xuICBoZWFkZXJUZXh0OiBzdHJpbmc7XG4gIHBhcmFtZXRlcnM6IEhkbFN5bWJvbFtdO1xuICBwb3J0czogSGRsU3ltYm9sW107XG4gIHN5bWJvbHM6IEhkbFN5bWJvbFtdO1xuICBpbnN0YW5jZXM6IEhkbEluc3RhbmNlW107XG4gIGNoaWxkcmVuOiBIZGxTY29wZVtdO1xuICBkZXB0aDogbnVtYmVyO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbiAgYmFzZUNsYXNzPzogc3RyaW5nO1xuICBvd25lckNsYXNzPzogc3RyaW5nO1xuICBpbXBvcnRzPzogUGFja2FnZUltcG9ydFtdO1xufVxuXG4vKipcbiAqIERlY2xhcmF0aW9ucyB0aGF0IGhhdmUgbm8gd2lkdGggb2YgdGhlaXIgb3duLlxuICpcbiAqIEEgbWV0aG9kJ3MgcmV0dXJuIHR5cGUgaXMgbm90IHRoZSBtZXRob2QncyB3aWR0aCwgYSB0eXBlIGhhcyBub25lIGF0IGFsbCwgYW5kXG4gKiBhbiBvYmplY3QgaGFuZGxlIGlzIG9ubHkgYSByZWZlcmVuY2UgLS0gaXRzIHZhbHVlcyBsaXZlIGluIGl0cyBtZW1iZXJzLiBTYXlpbmdcbiAqIGAxIGJpdGAgZm9yIGFueSBvZiB0aGVtIHdvdWxkIGJlIGEgZmFjdCB0aGF0IGlzIG1lcmVseSB0cnVlIG9mIHRoZSBsYW5ndWFnZVxuICogYW5kIGZhbHNlIG9mIHRoZSBjb2RlLlxuICovXG5jb25zdCBXSURUSExFU1MgPSBuZXcgU2V0PFN5bWJvbENhdGVnb3J5PihbXG4gIFwiZnVuY3Rpb25cIixcbiAgXCJ0YXNrXCIsXG4gIFwidHlwZWRlZlwiLFxuICBcImNsYXNzXCIsXG4gIFwiaGFuZGxlXCIsXG4gIFwicGFja2FnZVwiLFxuICBcIm1vZHVsZVwiLFxuICBcImludGVyZmFjZVwiLFxuICBcInByb2dyYW1cIixcbiAgXCJnZW52YXJcIixcbl0pO1xuXG4vKiogU3ltYm9sIHVuZGVyIGNvbnN0cnVjdGlvbjogcmF3IHRleHQgZmlyc3QsIHdpZHRocyByZXNvbHZlZCBhZnRlcndhcmRzLiAqL1xuaW50ZXJmYWNlIFBlbmRpbmdTeW1ib2wgZXh0ZW5kcyBPbWl0PEhkbFN5bWJvbCwgXCJwYWNrZWRXaWR0aFwiIHwgXCJ1bnBhY2tlZENvdW50XCI+IHtcbiAgLyoqIEtlcHQgc28gd2lkdGhzIGNhbiBiZSBmb2xkZWQgZnJvbSB0aGUgc3ludGF4IHRyZWUsIG5vdCBqdXN0IGZyb20gdGV4dC4gKi9cbiAgcGFja2VkUmFuZ2VOb2RlPzogTm9kZSB8IG51bGw7XG59XG5cbmNsYXNzIEFuYWx5emVyIHtcbiAgcHJpdmF0ZSBsaW5lczogc3RyaW5nW107XG4gIHByaXZhdGUgbmV4dFNjb3BlSWQgPSAxO1xuICBwcml2YXRlIHJlYWRvbmx5IHNjb3BlczogTXV0YWJsZVNjb3BlW10gPSBbXTtcbiAgLyoqIE5vZGUgaWRzIHRoYXQgYXJlIGRlY2xhcmF0aW9uIG5hbWVzLCBzbyB0aGV5IGFyZSBub3QgY291bnRlZCBhcyB1c2VzLiAqL1xuICByZWFkb25seSBkZWNsYXJhdGlvbk5hbWVzID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgdXNlczogSWRlbnRpZmllclVzZVtdID0gW107XG4gIC8qKiBJbXBvcnRzIG91dHNpZGUgYW55IHNjb3BlLCBpLmUuIGF0IGNvbXBpbGF0aW9uLXVuaXQgbGV2ZWwuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZUltcG9ydHM6IFBhY2thZ2VJbXBvcnRbXSA9IFtdO1xuICAvKiogRmlsZXMgdGhpcyBkb2N1bWVudCBwdWxscyBpbiB3aXRoIGFuIGBpbmNsdWRlLCBpbiBzb3VyY2Ugb3JkZXIuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgaW5jbHVkZXM6IEluY2x1ZGVEaXJlY3RpdmVbXSA9IFtdO1xuICAvKipcbiAgICogRGVjbGFyYXRpb25zIG91dHNpZGUgYW55IHNjb3BlOiB0aGUgY29tcGlsYXRpb24gdW5pdCdzIG93biB2b2NhYnVsYXJ5LlxuICAgKlxuICAgKiBBIGhlYWRlciB0aGF0IHdyaXRlcyBgdHlwZWRlZiBzdHJ1Y3QgcGFja2VkIHsuLi59IGhkcl90O2AgYWJvdmUgaXRzIGZpcnN0XG4gICAqIG1vZHVsZSBpcyBoYW5kaW5nIHRoYXQgdHlwZSB0byBldmVyeSBmaWxlIHRoYXQgaW5jbHVkZXMgaXQsIGFuZCB0aGVyZSBpcyBub1xuICAgKiBzY29wZSB0byBsZWF2ZSBpdCBpbiAtLSB0aGUgaGVhZGVyIGhhcyBubyBtb2R1bGUuIEtlZXBpbmcgdGhlbSBoZXJlIGlzIHdoYXRcbiAgICogbGV0cyB0aGUgZmlsZSB0aGF0IGluY2x1ZGVzIGl0IHJlc29sdmUgdGhlIG5hbWUgYXQgYWxsLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSB1bml0U3ltYm9sczogUGVuZGluZ1N5bWJvbFtdID0gW107XG4gIC8qKlxuICAgKiBDbGFzcyBuYW1lcyBrbm93biBiZWZvcmUgdGhpcyBmaWxlIHdhcyByZWFkLCBwbHVzIHRoZSBvbmVzIGl0IGRlY2xhcmVzLlxuICAgKlxuICAgKiBEZWNpZGluZyB3aGV0aGVyIGBQYWNrZXQgcGt0O2AgaXMgYW4gb2JqZWN0IG9yIGEgb25lLWJpdCBuZXQgcmVxdWlyZXNcbiAgICoga25vd2luZyBgUGFja2V0YCBpcyBhIGNsYXNzLCBhbmQgdGhhdCBhbnN3ZXIgdXN1YWxseSBsaXZlcyBpbiBhbm90aGVyIGZpbGUuXG4gICAqL1xuICByZWFkb25seSBjbGFzc05hbWVzOiBTZXQ8c3RyaW5nPjtcbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBmb2xkZWQgdmFsdWVzIG9mIGEgcGFja2FnZSdzIHBhcmFtZXRlcnMsIGZvciBgaW1wb3J0IHBrZzo6KmAuXG4gICAqXG4gICAqIFN1cHBsaWVkIGJ5IHRoZSBjYWxsZXIgYmVjYXVzZSB0aGUgYW5hbHl6ZXIgZGVsaWJlcmF0ZWx5IGtub3dzIG5vdGhpbmdcbiAgICogYWJvdXQgdGhlIHdvcmtzcGFjZTogYSBwYWNrYWdlIHVzdWFsbHkgbGl2ZXMgaW4gYW5vdGhlciBmaWxlLCBhbmQgYSB3aWR0aFxuICAgKiBsaWtlIGBbQ19QS1RfREFUX1ctMTowXWAgY2Fubm90IGJlIGZvbGRlZCB3aXRob3V0IGl0cyB2YWx1ZS5cbiAgICovXG4gIHJlYWRvbmx5IGltcG9ydGVkUGFyYW1ldGVyVmFsdWVzOlxuICAgIHwgKChwYWNrYWdlTmFtZTogc3RyaW5nKSA9PiBSZWFkb25seU1hcDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQpXG4gICAgfCB1bmRlZmluZWQ7XG5cbiAgLyoqIE1hY3JvcyBrbm93biB0byB0aGUgd29ya3NwYWNlLCBmb3IgZXhwYW5kaW5nIGBOQU1FKGFyZ3MpIGRlY2xhcmF0aW9ucy4gKi9cbiAgcmVhZG9ubHkgbWFjcm9zOiBNYWNyb1RhYmxlO1xuICAvKiogUGFyc2VzIGFuIGV4cGFuZGVkIG1hY3JvIGJvZHkuIFN1cHBsaWVkIGJ5IHRoZSBjYWxsZXIgdGhhdCBvd25zIGEgcGFyc2VyLiAqL1xuICByZWFkb25seSBwYXJzZUZyYWdtZW50OiAoKHRleHQ6IHN0cmluZykgPT4gVHJlZSkgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgdGV4dDogc3RyaW5nLFxuICAgIGtub3duQ2xhc3NlczogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKSxcbiAgICBpbXBvcnRlZFBhcmFtZXRlclZhbHVlcz86IChwYWNrYWdlTmFtZTogc3RyaW5nKSA9PiBSZWFkb25seU1hcDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQsXG4gICAgbWFjcm9zOiBNYWNyb1RhYmxlID0gbmV3IE1hcCgpLFxuICAgIHBhcnNlRnJhZ21lbnQ/OiAodGV4dDogc3RyaW5nKSA9PiBUcmVlLFxuICApIHtcbiAgICB0aGlzLmxpbmVzID0gdGV4dC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIHRoaXMuY2xhc3NOYW1lcyA9IG5ldyBTZXQoa25vd25DbGFzc2VzKTtcbiAgICB0aGlzLmltcG9ydGVkUGFyYW1ldGVyVmFsdWVzID0gaW1wb3J0ZWRQYXJhbWV0ZXJWYWx1ZXM7XG4gICAgdGhpcy5tYWNyb3MgPSBtYWNyb3M7XG4gICAgdGhpcy5wYXJzZUZyYWdtZW50ID0gcGFyc2VGcmFnbWVudDtcbiAgfVxuXG4gIHJ1bih0cmVlOiBUcmVlKTogQW5hbHlzaXNCYXNlIHtcbiAgICB0aGlzLnZpc2l0U2NvcGVDaGlsZHJlbih0cmVlLnJvb3ROb2RlLCB1bmRlZmluZWQsIDApO1xuICAgIGZvciAoY29uc3Qgc2NvcGUgb2YgdGhpcy5zY29wZXMpIHtcbiAgICAgIGlmIChzY29wZS5jYXRlZ29yeSA9PT0gXCJjbGFzc1wiKSB0aGlzLmNsYXNzTmFtZXMuYWRkKHNjb3BlLm5hbWUpO1xuICAgIH1cblxuICAgIC8vIFJlc29sdmUgZm9sZGVkIGNvbnN0YW50cyBvbmNlIGV2ZXJ5IHNjb3BlIGlzIHBvcHVsYXRlZC5cbiAgICBmb3IgKGNvbnN0IHNjb3BlIG9mIHRoaXMuc2NvcGVzKSB0aGlzLnJlc29sdmVTY29wZShzY29wZSk7XG4gICAgdGhpcy5yZXNvbHZlVW5pdFN5bWJvbHMoKTtcblxuICAgIGNvbnN0IHNjb3Blc0J5SWQgPSBuZXcgTWFwPG51bWJlciwgSGRsU2NvcGU+KCk7XG4gICAgY29uc3Qgc2NvcGVzQnlSYW5nZTogU2NvcGVJbmRleEVudHJ5W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHMgb2YgdGhpcy5zY29wZXMpIHtcbiAgICAgIHNjb3Blc0J5SWQuc2V0KHMuaWQsIHMpO1xuICAgICAgc2NvcGVzQnlSYW5nZS5wdXNoKHsgc2NvcGU6IHMsIHN0YXJ0OiBzLnN0YXJ0LCBlbmQ6IHMuZW5kLCBkZXB0aDogcy5kZXB0aCB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBpZGVudGlmaWVycyA9IG5ldyBNYXA8c3RyaW5nLCBJZGVudGlmaWVyVXNlW10+KCk7XG4gICAgZm9yIChjb25zdCB1c2Ugb2YgdGhpcy51c2VzKSB7XG4gICAgICBjb25zdCBsaXN0ID0gaWRlbnRpZmllcnMuZ2V0KHVzZS5uYW1lKTtcbiAgICAgIGlmIChsaXN0KSBsaXN0LnB1c2godXNlKTtcbiAgICAgIGVsc2UgaWRlbnRpZmllcnMuc2V0KHVzZS5uYW1lLCBbdXNlXSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgIHJldHVybiB7XG4gICAgICBzY29wZXM6IHRoaXMuc2NvcGVzLFxuICAgICAgc2NvcGVzQnlJZCxcbiAgICAgIHNjb3Blc0J5UmFuZ2UsXG4gICAgICBwYXJzZVRyZWU6IHRyZWUsXG4gICAgICBkdXJhdGlvbk1zOiBNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhcnQpLFxuICAgICAgaW1wb3J0czogdGhpcy5maWxlSW1wb3J0cyxcbiAgICAgIGluY2x1ZGVzOiB0aGlzLmluY2x1ZGVzLFxuICAgICAgY2xhc3NOYW1lczogdGhpcy5jbGFzc05hbWVzLFxuICAgICAgZGVjbGFyYXRpb25OYW1lczogdGhpcy5kZWNsYXJhdGlvbk5hbWVzLFxuICAgICAgdW5pdFN5bWJvbHM6IHRoaXMudW5pdFN5bWJvbHMgYXMgSGRsU3ltYm9sW10sXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGb2xkcyB3aWR0aHMgZm9yIHdoYXQgdGhlIGNvbXBpbGF0aW9uIHVuaXQgZGVjbGFyZXMuXG4gICAqXG4gICAqIFRoZSBzYW1lIHR3byBwYXNzZXMgYHJlc29sdmVTY29wZWAgcnVucywgb3ZlciBhIHNjb3BlIHRoYXQgZXhpc3RzIG9ubHkgdG8gYmVcbiAgICogcmVzb2x2ZWQ6IGEgaGVhZGVyJ3MgYHR5cGVkZWYgbG9naWMgWzc6MF0gYnl0ZV90O2AgaGFzIHRvIGtub3cgaXRzIHdpZHRoXG4gICAqIGJlZm9yZSB0aGUgZmlsZSB0aGF0IGluY2x1ZGVzIGl0IGNhbiBzaG93IG9uZS5cbiAgICovXG4gIHByaXZhdGUgcmVzb2x2ZVVuaXRTeW1ib2xzKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnVuaXRTeW1ib2xzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgaG9sZGVyOiBNdXRhYmxlU2NvcGUgPSB7XG4gICAgICBpZDogMCxcbiAgICAgIG5hbWU6IFwiXCIsXG4gICAgICBjYXRlZ29yeTogXCJwYWNrYWdlXCIsXG4gICAgICByYW5nZTogeyBzdGFydDogeyBsaW5lOiAwLCBjaGFyYWN0ZXI6IDAgfSwgZW5kOiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9IH0sXG4gICAgICBzZWxlY3Rpb25SYW5nZTogeyBzdGFydDogeyBsaW5lOiAwLCBjaGFyYWN0ZXI6IDAgfSwgZW5kOiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9IH0sXG4gICAgICBoZWFkZXJUZXh0OiBcIlwiLFxuICAgICAgcGFyYW1ldGVyczogW10sXG4gICAgICBwb3J0czogW10sXG4gICAgICBzeW1ib2xzOiB0aGlzLnVuaXRTeW1ib2xzLFxuICAgICAgaW5zdGFuY2VzOiBbXSxcbiAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgIGRlcHRoOiAwLFxuICAgICAgc3RhcnQ6IDAsXG4gICAgICBlbmQ6IDAsXG4gICAgfTtcblxuICAgIHRoaXMucmVzb2x2ZVNjb3BlKGhvbGRlcik7XG4gIH1cblxuICAvKipcbiAgICogRXZlcnkgY2xhc3MgZGVjbGFyZWQgaW4gdGhpcyBmaWxlLlxuICAgKlxuICAgKiBUaGUgY2FsbGVyIG1heSBuZWVkIHRvIGFuYWx5c2UgYWdhaW4gb25jZSBpdCBsZWFybnMgdGhlc2U6IGEgZmlsZSB0aGF0XG4gICAqIGRlY2xhcmVzIGBQYWNrZXRgIGFuZCBhbHNvIHdyaXRlcyBgUGFja2V0IHBrdDtgIGNhbm5vdCBrbm93IHdoaWNoIGlzIHdoaWNoXG4gICAqIHVudGlsIHRoZSBjbGFzcyBkZWNsYXJhdGlvbiBoYXMgYmVlbiByZWFkLlxuICAgKi9cbiAgY2xhc3Nlc0hlcmUoKTogU2V0PHN0cmluZz4ge1xuICAgIGNvbnN0IG5hbWVzID0gbmV3IFNldCh0aGlzLmNsYXNzTmFtZXMpO1xuICAgIGZvciAoY29uc3Qgc2NvcGUgb2YgdGhpcy5zY29wZXMpIHtcbiAgICAgIGlmIChzY29wZS5jYXRlZ29yeSA9PT0gXCJjbGFzc1wiKSBuYW1lcy5hZGQoc2NvcGUubmFtZSk7XG4gICAgfVxuICAgIHJldHVybiBuYW1lcztcbiAgfVxuXG4gIC8qIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICAgKiBTY29wZSB0cmF2ZXJzYWxcbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gIC8qKlxuICAgKiBWaXNpdHMgdGhlIGRpcmVjdCBjaGlsZHJlbiBvZiBhIHNjb3BlLCBmbGF0dGVuaW5nIGBwYWNrYWdlX2l0ZW1gLFxuICAgKiBgY2xhc3NfaXRlbWAgYW5kIHNpbWlsYXIgd3JhcHBlcnMgc28gdGhlaXIgY29udGVudHMgYXJlIHNlZW4gYXNcbiAgICogZGVjbGFyYXRpb25zIG9mIHRoZSBlbmNsb3Npbmcgc2NvcGUuXG4gICAqL1xuICBwcml2YXRlIHZpc2l0U2NvcGVDaGlsZHJlbihub2RlOiBOb2RlLCBwYXJlbnRJZDogbnVtYmVyIHwgdW5kZWZpbmVkLCBkZXB0aDogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3Qgc3RhY2s6IE5vZGVbXSA9IFsuLi5ub2RlLm5hbWVkQ2hpbGRyZW5dLnJldmVyc2UoKTtcbiAgICB3aGlsZSAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgY2hpbGQgPSBzdGFjay5wb3AoKSE7XG4gICAgICBpZiAoaXNUcmFuc3BhcmVudFdyYXBwZXIoY2hpbGQudHlwZSkpIHtcbiAgICAgICAgc3RhY2sucHVzaCguLi5bLi4uY2hpbGQubmFtZWRDaGlsZHJlbl0ucmV2ZXJzZSgpKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB0aGlzLnZpc2l0Tm9kZShjaGlsZCwgcGFyZW50SWQsIGRlcHRoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHZpc2l0Tm9kZShub2RlOiBOb2RlLCBwYXJlbnRJZDogbnVtYmVyIHwgdW5kZWZpbmVkLCBkZXB0aDogbnVtYmVyKTogdm9pZCB7XG4gICAgLy8gRnVuY3Rpb25zIGFuZCB0YXNrcyBhcmUgaGFuZGxlZCBiZWZvcmUgdGhlIGdlbmVyaWMgc2NvcGUgZGlzcGF0Y2g6IHRoZXlcbiAgICAvLyBhcmUgc2NvcGVzLCBidXQgdGhleSBhbHNvIGhhdmUgdG8gYmUgKmRlY2xhcmVkKiBpbiB3aGF0ZXZlciBlbmNsb3Nlc1xuICAgIC8vIHRoZW0sIGFuZCB0aGUgZ2VuZXJpYyBwYXRoIG9ubHkgb3BlbnMgYSBzY29wZS5cbiAgICBpZiAobm9kZS50eXBlID09PSBcImZ1bmN0aW9uX2RlY2xhcmF0aW9uXCIgfHwgbm9kZS50eXBlID09PSBcInRhc2tfZGVjbGFyYXRpb25cIikge1xuICAgICAgY29uc3QgbmFtZU5vZGUgPSBzY29wZU5hbWVOb2RlKG5vZGUsIHNjb3BlSGVhZGVyKG5vZGUpKTtcbiAgICAgIGlmIChuYW1lTm9kZSkgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG4gICAgICB0aGlzLmRlY2xhcmVNZXRob2Qobm9kZSwgdGhpcy5zY29wZUF0KHBhcmVudElkKSwgbmFtZU5vZGU/LnRleHQgPz8gXCI8YW5vbnltb3VzPlwiLCB7XG4gICAgICAgIGRvYzogdGhpcy5kb2NCZWZvcmUobm9kZSksXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBBIHByb2NlZHVyYWwgYmxvY2sgaXMgYSBzY29wZSBvbmx5IHdoZW4gaXQgaXMgbmFtZWQ7IHNlZVxuICAgIC8vIFBST0NFRFVSQUxfQkxPQ0tTIGZvciB3aHkgYW4gdW5uYW1lZCBvbmUgaXMgbm90LlxuICAgIGlmIChQUk9DRURVUkFMX0JMT0NLUy5oYXMobm9kZS50eXBlKSkge1xuICAgICAgY29uc3QgbGFiZWwgPSBzY29wZU5hbWVOb2RlKG5vZGUsIG51bGwpO1xuICAgICAgaWYgKCFsYWJlbCkge1xuICAgICAgICB0aGlzLnZpc2l0U2NvcGVDaGlsZHJlbihub2RlLCBwYXJlbnRJZCwgZGVwdGgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQobGFiZWwuaWQpO1xuICAgICAgdGhpcy5vcGVuU2NvcGUobm9kZSwgXCJibG9ja1wiLCBwYXJlbnRJZCwgZGVwdGgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGtpbmQgPSBTQ09QRV9LSU5EU1tub2RlLnR5cGVdO1xuICAgIGlmIChraW5kKSB7XG4gICAgICB0aGlzLm9wZW5TY29wZShub2RlLCBraW5kLCBwYXJlbnRJZCwgZGVwdGgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGN1cnJlbnRTY29wZSA9IHBhcmVudElkICE9PSB1bmRlZmluZWQgPyB0aGlzLnNjb3Blcy5maW5kKChzKSA9PiBzLmlkID09PSBwYXJlbnRJZCkgOiB1bmRlZmluZWQ7XG5cbiAgICBzd2l0Y2ggKG5vZGUudHlwZSkge1xuICAgICAgY2FzZSBcInRmX3BvcnRfZGVjbGFyYXRpb25cIjoge1xuICAgICAgICBpZiAoIWN1cnJlbnRTY29wZSkgcmV0dXJuO1xuICAgICAgICBjb25zdCBsaXN0ID0gZmluZENoaWxkKG5vZGUsIFwibGlzdF9vZl90Zl92YXJpYWJsZV9pZGVudGlmaWVyc1wiKTtcbiAgICAgICAgY29uc3QgdHlwZSA9IGZpbmRDaGlsZChub2RlLCBcImRhdGFfdHlwZV9vcl9pbXBsaWNpdFwiKTtcbiAgICAgICAgY29uc3Qgc3BsaXQgPSBzcGxpdFBhY2tlZFRleHQodHlwZT8udGV4dCk7XG4gICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IHBhcnNlRGlyZWN0aW9uKGZpbmRDaGlsZChub2RlLCBcInRmX3BvcnRfZGlyZWN0aW9uXCIpPy50ZXh0ID8/IFwiaW5wdXRcIik7XG4gICAgICAgIGZvciAoY29uc3QgbmFtZSBvZiBsaXN0ID8gZmluZENoaWxkcmVuKGxpc3QsIFwic2ltcGxlX2lkZW50aWZpZXJcIikgOiBbXSkge1xuICAgICAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQobmFtZS5pZCk7XG4gICAgICAgICAgY3VycmVudFNjb3BlLnBvcnRzLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogbmFtZS50ZXh0LCBjYXRlZ29yeTogXCJwb3J0XCIsIHR5cGVUZXh0OiBzcGxpdC50eXBlIHx8IFwibG9naWNcIixcbiAgICAgICAgICAgIHBhY2tlZFJhbmdlVGV4dDogc3BsaXQucmFuZ2UsIGRpcmVjdGlvbiwgdW5wYWNrZWREaW1zOiBbXSwgaXNQb3J0OiB0cnVlLFxuICAgICAgICAgICAgc2NvcGVJZDogY3VycmVudFNjb3BlLmlkLCByYW5nZTogdG9SYW5nZShub2RlKSwgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihuYW1lKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwicGFyYW1ldGVyX2RlY2xhcmF0aW9uXCI6XG4gICAgICBjYXNlIFwibG9jYWxfcGFyYW1ldGVyX2RlY2xhcmF0aW9uXCI6IHtcbiAgICAgICAgY29uc3QgaXNMb2NhbCA9IG5vZGUudHlwZSA9PT0gXCJsb2NhbF9wYXJhbWV0ZXJfZGVjbGFyYXRpb25cIjtcbiAgICAgICAgZm9yIChjb25zdCBzeW0gb2YgdGhpcy5wYXJzZVBhcmFtRGVjbGFyYXRpb24obm9kZSwgY3VycmVudFNjb3BlLCBpc0xvY2FsKSkge1xuICAgICAgICAgIHRoaXMuZGVjbGFyZShjdXJyZW50U2NvcGUsIHN5bSwgaXNMb2NhbCA/IFwibG9jYWxwYXJhbVwiIDogXCJwYXJhbWV0ZXJcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FzZSBcIm5ldF9kZWNsYXJhdGlvblwiOiB7XG4gICAgICAgIHRoaXMucGFyc2VOZXREZWNsYXJhdGlvbihub2RlLCBjdXJyZW50U2NvcGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwiZ2VudmFyX2RlY2xhcmF0aW9uXCI6IHtcbiAgICAgICAgZm9yIChjb25zdCBpZGVudCBvZiBmaW5kQ2hpbGRyZW4oZmluZENoaWxkKG5vZGUsIFwibGlzdF9vZl9nZW52YXJfaWRlbnRpZmllcnNcIikgPz8gbm9kZSwgXCJzaW1wbGVfaWRlbnRpZmllclwiKSkge1xuICAgICAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQoaWRlbnQuaWQpO1xuICAgICAgICAgIHRoaXMuZGVjbGFyZShjdXJyZW50U2NvcGUsIHtcbiAgICAgICAgICAgIG5hbWU6IGlkZW50LnRleHQsXG4gICAgICAgICAgICBjYXRlZ29yeTogXCJnZW52YXJcIixcbiAgICAgICAgICAgIHR5cGVUZXh0OiBcImdlbnZhclwiLFxuICAgICAgICAgICAgdW5wYWNrZWREaW1zOiBbXSxcbiAgICAgICAgICAgIGlzUG9ydDogZmFsc2UsXG4gICAgICAgICAgICBzY29wZUlkOiBjdXJyZW50U2NvcGU/LmlkID8/IC0xLFxuICAgICAgICAgICAgcmFuZ2U6IHRvUmFuZ2Uobm9kZSksXG4gICAgICAgICAgICBzZWxlY3Rpb25SYW5nZTogc2VsZWN0aW9uKGlkZW50KSxcbiAgICAgICAgICB9LCBcImdlbnZhclwiKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwidGV4dF9tYWNyb191c2FnZVwiOiB7XG4gICAgICAgIC8vIEEgZGVjbGFyYXRpb24gd3JpdHRlbiBieSBhIHByZXByb2Nlc3NvcjogYGAgYE5PVE1SSU5TVCgoVy0xKSwwLHgpOyBgYFxuICAgICAgICAvLyBzdGFuZHMgZm9yIGByZWcgW1ctMTowXSB4YC4gTGVmdCBhbG9uZSBpdCBkZWNsYXJlcyBub3RoaW5nLCBhbmQgZXZlcnlcbiAgICAgICAgLy8gdXNlIG9mIGB4YCByZWFkcyBhcyBhbiB1bmtub3duIGlkZW50aWZpZXIuXG4gICAgICAgIHRoaXMuZGVjbGFyZUZyb21NYWNybyhub2RlLCBjdXJyZW50U2NvcGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwiYmxvY2tfaXRlbV9kZWNsYXJhdGlvblwiOiB7XG4gICAgICAgIC8vIGBiZWdpbiA6IG5hbWUgbG9naWMgWzc6MF0gc2NyYXRjaDsgLi4uIGVuZGAgLS0gYSBkZWNsYXJhdGlvbiB3cml0dGVuXG4gICAgICAgIC8vIGluc2lkZSBhIG5hbWVkIGJsb2NrLiBUaGUgaW5uZXIgbm9kZSBpcyB0aGUgc2FtZSBzaGFwZSB0aGUgbW9kdWxlIHBhdGhcbiAgICAgICAgLy8gYWxyZWFkeSBrbm93cyBob3cgdG8gcmVhZC5cbiAgICAgICAgY29uc3QgaW5uZXIgPSBmaW5kQ2hpbGQobm9kZSwgXCJkYXRhX2RlY2xhcmF0aW9uXCIpO1xuICAgICAgICBpZiAoaW5uZXIpIHRoaXMucGFyc2VEYXRhRGVjbGFyYXRpb24oaW5uZXIsIGN1cnJlbnRTY29wZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJkYXRhX2RlY2xhcmF0aW9uXCI6IHtcbiAgICAgICAgdGhpcy5wYXJzZURhdGFEZWNsYXJhdGlvbihub2RlLCBjdXJyZW50U2NvcGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwibW9kdWxlX2luc3RhbnRpYXRpb25cIjoge1xuICAgICAgICBjb25zdCBpbnN0ID0gdGhpcy5wYXJzZUluc3RhbnRpYXRpb24obm9kZSwgY3VycmVudFNjb3BlKTtcbiAgICAgICAgaWYgKGluc3QgJiYgY3VycmVudFNjb3BlKSBjdXJyZW50U2NvcGUuaW5zdGFuY2VzLnB1c2goaW5zdCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJjbGFzc19wcm9wZXJ0eVwiOiB7XG4gICAgICAgIC8vIGByYW5kIGJpdCBbNzowXSBwYXlsb2FkO2AgYW5kIGBzdGF0aWMgaW50IGNvdW50ID0gMDtgIGFyZSBkYXRhXG4gICAgICAgIC8vIGRlY2xhcmF0aW9ucyB3ZWFyaW5nIGEgY2xhc3MgbWVtYmVyJ3MgcXVhbGlmaWVycy4gVGhlIGlubmVyIG5vZGUgaXNcbiAgICAgICAgLy8gdGhlIHNhbWUgc2hhcGUgdGhlIG1vZHVsZSBwYXRoIGFscmVhZHkga25vd3MgaG93IHRvIHJlYWQuXG4gICAgICAgIGNvbnN0IGlubmVyID0gZmluZENoaWxkKG5vZGUsIFwiZGF0YV9kZWNsYXJhdGlvblwiKTtcbiAgICAgICAgaWYgKGlubmVyKSB7XG4gICAgICAgICAgY29uc3QgcXVhbGlmaWVycyA9IHRoaXMuY2xhc3NRdWFsaWZpZXJzKG5vZGUpO1xuICAgICAgICAgIHRoaXMucGFyc2VEYXRhRGVjbGFyYXRpb24oaW5uZXIsIGN1cnJlbnRTY29wZSwgcXVhbGlmaWVycyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FzZSBcImNsYXNzX21ldGhvZFwiOiB7XG4gICAgICAgIC8vIEEgZnVuY3Rpb24gb3IgdGFzayB3cml0dGVuIGFzIGEgY2xhc3MgbWVtYmVyLiBJdCBpcyBkZWNsYXJlZCBhcyBhXG4gICAgICAgIC8vIHN5bWJvbCBzbyBgcGt0LmlzX3ZhbGlkKClgIHJlc29sdmVzIGFuZCBjb21wbGV0ZXMsIGFuZCBvcGVuZWQgYXMgYVxuICAgICAgICAvLyBzY29wZSBzbyBnby10by1kZWZpbml0aW9uIGxhbmRzIGluc2lkZSB0aGUgYm9keS5cbiAgICAgICAgY29uc3QgaW5uZXIgPVxuICAgICAgICAgIGZpbmRDaGlsZChub2RlLCBcImNsYXNzX2NvbnN0cnVjdG9yX2RlY2xhcmF0aW9uXCIpID8/XG4gICAgICAgICAgZmluZENoaWxkKG5vZGUsIFwiZnVuY3Rpb25fZGVjbGFyYXRpb25cIikgPz9cbiAgICAgICAgICBmaW5kQ2hpbGQobm9kZSwgXCJ0YXNrX2RlY2xhcmF0aW9uXCIpID8/XG4gICAgICAgICAgZmluZENoaWxkKG5vZGUsIFwidGFza19wcm90b3R5cGVcIikgPz9cbiAgICAgICAgICBmaW5kQ2hpbGQobm9kZSwgXCJmdW5jdGlvbl9wcm90b3R5cGVcIik7XG4gICAgICAgIGlmICghaW5uZXIpIHJldHVybjtcblxuICAgICAgICBjb25zdCBpc0NvbnN0cnVjdG9yID0gaW5uZXIudHlwZSA9PT0gXCJjbGFzc19jb25zdHJ1Y3Rvcl9kZWNsYXJhdGlvblwiO1xuICAgICAgICBjb25zdCBuYW1lTm9kZSA9IGlzQ29uc3RydWN0b3IgPyBudWxsIDogc2NvcGVOYW1lTm9kZShpbm5lciwgc2NvcGVIZWFkZXIoaW5uZXIpKTtcbiAgICAgICAgY29uc3QgbWV0aG9kTmFtZSA9IGlzQ29uc3RydWN0b3IgPyBcIm5ld1wiIDogbmFtZU5vZGU/LnRleHQgPz8gXCI8YW5vbnltb3VzPlwiO1xuXG4gICAgICAgIGlmIChuYW1lTm9kZSkgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG5cbiAgICAgICAgdGhpcy5kZWNsYXJlTWV0aG9kKGlubmVyLCBjdXJyZW50U2NvcGUsIG1ldGhvZE5hbWUsIHtcbiAgICAgICAgICBxdWFsaWZpZXJzOiB0aGlzLmNsYXNzUXVhbGlmaWVycyhub2RlKSxcbiAgICAgICAgICBkb2M6IHRoaXMuZG9jQmVmb3JlKG5vZGUpLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FzZSBcImZ1bmN0aW9uX2RlY2xhcmF0aW9uXCI6XG4gICAgICBjYXNlIFwidGFza19kZWNsYXJhdGlvblwiOiB7XG4gICAgICAgIC8vIEEgbW9kdWxlLWxldmVsIGZ1bmN0aW9uIG9yIHRhc2suIERlY2xhcmluZyBpdCBpcyB3aGF0IG1ha2VzIGEgY2FsbFxuICAgICAgICAvLyByZXNvbHZlIGFuZCBjb21wbGV0ZTsgb3BlbmluZyBpdCBpcyB3aGF0IG1ha2VzIGl0cyBhcmd1bWVudHMgYW5kIGJvZHlcbiAgICAgICAgLy8gbmF2aWdhYmxlLlxuICAgICAgICBjb25zdCBuYW1lTm9kZSA9IHNjb3BlTmFtZU5vZGUobm9kZSwgc2NvcGVIZWFkZXIobm9kZSkpO1xuICAgICAgICBjb25zdCBuYW1lID0gbmFtZU5vZGU/LnRleHQgPz8gXCI8YW5vbnltb3VzPlwiO1xuXG4gICAgICAgIGlmIChuYW1lTm9kZSkgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG5cbiAgICAgICAgdGhpcy5kZWNsYXJlTWV0aG9kKG5vZGUsIGN1cnJlbnRTY29wZSwgbmFtZSwgeyBkb2M6IHRoaXMuZG9jQmVmb3JlKG5vZGUpIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjYXNlIFwiY2xhc3NfY29uc3RydWN0b3JfZGVjbGFyYXRpb25cIjoge1xuICAgICAgICAvLyBUaGUga2V5d29yZCBgbmV3YCBpcyBhIHRva2VuLCBub3QgYW4gaWRlbnRpZmllciwgc28gdGhlcmUgaXMgbm8gbmFtZVxuICAgICAgICAvLyBub2RlIHRvIHJlYWQgLS0gYW5kIG5vdGhpbmcgdG8gbWFyayBhcyBhIGRlY2xhcmF0aW9uLlxuICAgICAgICB0aGlzLmRlY2xhcmVNZXRob2Qobm9kZSwgY3VycmVudFNjb3BlLCBcIm5ld1wiLCB7IGRvYzogdGhpcy5kb2NCZWZvcmUobm9kZSkgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJpbmNsdWRlX2NvbXBpbGVyX2RpcmVjdGl2ZVwiOiB7XG4gICAgICAgIC8vIFdoaWNoIGZpbGVzIHRoaXMgb25lIHB1bGxzIGluLiBOb3RoaW5nIGluIHRoZSBmaWxlIGNhbiBiZSByZXNvbHZlZFxuICAgICAgICAvLyB3aXRob3V0IHRoZW0gLS0gYSBwYWNrYWdlIHRoZSBpbmNsdWRlIG5hbWVzIGlzIG9mdGVuIGluIGEgZm9sZGVyIHRoZVxuICAgICAgICAvLyB3YWxrIG5ldmVyIHJlYWNoZXMgLS0gYW5kIHRoaXMgdHJhdmVyc2FsIGFscmVhZHkgdmlzaXRzIHRoZSBub2RlLCBzb1xuICAgICAgICAvLyByZWFkaW5nIHRoZSBkaXJlY3RpdmUgaGVyZSBjb3N0cyBub3RoaW5nIGV4dHJhLlxuICAgICAgICBjb25zdCBkaXJlY3RpdmUgPSByZWFkSW5jbHVkZShub2RlKTtcbiAgICAgICAgaWYgKGRpcmVjdGl2ZSkgdGhpcy5pbmNsdWRlcy5wdXNoKGRpcmVjdGl2ZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJmb3JfaW5pdGlhbGl6YXRpb25cIjoge1xuICAgICAgICBmb3IgKGNvbnN0IGRlY2xhcmF0aW9uIG9mIG5vZGUubmFtZWRDaGlsZHJlbikge1xuICAgICAgICAgIGlmIChkZWNsYXJhdGlvbi50eXBlICE9PSBcImZvcl92YXJpYWJsZV9kZWNsYXJhdGlvblwiKSBjb250aW51ZTtcbiAgICAgICAgICBjb25zdCB0eXBlID0gZmluZENoaWxkKGRlY2xhcmF0aW9uLCBcImRhdGFfdHlwZVwiKTtcbiAgICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgZmluZENoaWxkcmVuKGRlY2xhcmF0aW9uLCBcInNpbXBsZV9pZGVudGlmaWVyXCIpKSB7XG4gICAgICAgICAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWUuaWQpO1xuICAgICAgICAgICAgdGhpcy5kZWNsYXJlKGN1cnJlbnRTY29wZSwge1xuICAgICAgICAgICAgICBuYW1lOiBuYW1lLnRleHQsIGNhdGVnb3J5OiBcInZhcmlhYmxlXCIsIHR5cGVUZXh0OiB0eXBlPy50ZXh0ID8/IFwiaW50XCIsXG4gICAgICAgICAgICAgIHVucGFja2VkRGltczogW10sIGlzUG9ydDogZmFsc2UsIHNjb3BlSWQ6IGN1cnJlbnRTY29wZT8uaWQgPz8gLTEsXG4gICAgICAgICAgICAgIHJhbmdlOiB0b1JhbmdlKGRlY2xhcmF0aW9uKSwgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihuYW1lKSxcbiAgICAgICAgICAgIH0sIFwidmFyaWFibGVcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJwYWNrYWdlX2ltcG9ydF9kZWNsYXJhdGlvblwiOiB7XG4gICAgICAgIC8vIGBpbXBvcnRgIG5vcm1hbGx5IGFycml2ZXMgd3JhcHBlZCBpbiBhIGBkYXRhX2RlY2xhcmF0aW9uYCwgd2hpY2hcbiAgICAgICAgLy8gYHBhcnNlRGF0YURlY2xhcmF0aW9uYCBoYW5kbGVzLiBSZWFjaGluZyBpdCBiYXJlIG1lYW5zIHRoZSB3cmFwcGVyIGlzXG4gICAgICAgIC8vIG1pc3NpbmcsIGFuZCBkcm9wcGluZyB0aGUgaW1wb3J0IHdvdWxkIHNpbGVudGx5IGxvc2UgbmFtZXMuXG4gICAgICAgIGNvbnN0IGltcG9ydHMgPSB0aGlzLnBhcnNlUGFja2FnZUltcG9ydHMobm9kZSk7XG4gICAgICAgIHRoaXMuZmlsZUltcG9ydHMucHVzaCguLi5pbXBvcnRzKTtcbiAgICAgICAgaWYgKGN1cnJlbnRTY29wZSkge1xuICAgICAgICAgIChjdXJyZW50U2NvcGUgYXMgeyBpbXBvcnRzPzogUGFja2FnZUltcG9ydFtdIH0pLmltcG9ydHMgPSBbXG4gICAgICAgICAgICAuLi4oY3VycmVudFNjb3BlLmltcG9ydHMgPz8gW10pLFxuICAgICAgICAgICAgLi4uaW1wb3J0cyxcbiAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhlIHF1YWxpZmllcnMgb24gYSBjbGFzcyBtZW1iZXIsIGluIHNvdXJjZSBvcmRlci5cbiAgICpcbiAgICogVGhleSBzaXQgaW4gZGlmZmVyZW50IHdyYXBwZXIgbm9kZXMgZGVwZW5kaW5nIG9uIHRoZSBrZXl3b3JkIC0tXG4gICAqIGByYW5kb21fcXVhbGlmaWVyYCBmb3IgYHJhbmRgLCBgY2xhc3NfaXRlbV9xdWFsaWZpZXJgIGZvciBgc3RhdGljYCxcbiAgICogYGxvY2FsYC9gcHJvdGVjdGVkYCBhcmUgYmFyZSB0b2tlbnMgLS0gc28gdGhleSBhcmUgcmVhZCBmcm9tIHRoZSBtZW1iZXInc1xuICAgKiBvd24gY2hpbGRyZW4gcmF0aGVyIHRoYW4gZnJvbSBhIGZpeGVkIHNldCBvZiBmaWVsZHMuXG4gICAqL1xuICBwcml2YXRlIGNsYXNzUXVhbGlmaWVycyhub2RlOiBOb2RlKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5vZGUuY2hpbGRyZW4pIHtcbiAgICAgIGlmIChjaGlsZC50eXBlID09PSBcImRhdGFfZGVjbGFyYXRpb25cIikgY29udGludWU7XG5cbiAgICAgIGlmIChcbiAgICAgICAgY2hpbGQudHlwZSA9PT0gXCJjbGFzc19pdGVtX3F1YWxpZmllclwiIHx8XG4gICAgICAgIGNoaWxkLnR5cGUgPT09IFwicmFuZG9tX3F1YWxpZmllclwiIHx8XG4gICAgICAgIGNoaWxkLnR5cGUgPT09IFwiY29uc3RfcXVhbGlmaWVyXCJcbiAgICAgICkge1xuICAgICAgICAvLyBUaGUgd3JhcHBlciBob2xkcyBvbmx5IGtleXdvcmQgdG9rZW5zLCBhbmQgdGhvc2UgYXJlICphbm9ueW1vdXMqIGFzXG4gICAgICAgIC8vIGZhciBhcyB0aGUgdHJlZSBpcyBjb25jZXJuZWQgLS0gYHJhbmRgIGFuZCBgc3RhdGljYCBuZXZlciBhcHBlYXIgYXNcbiAgICAgICAgLy8gbmFtZWQgY2hpbGRyZW4gLS0gc28gdGhlIHdyYXBwZXIncyBvd24gdGV4dCBpcyB0aGUgcXVhbGlmaWVyLlxuICAgICAgICBmb3IgKGNvbnN0IHdvcmQgb2YgY2hpbGQudGV4dC5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKSkgb3V0LnB1c2god29yZCk7XG4gICAgICB9IGVsc2UgaWYgKGNoaWxkLnR5cGUgPT09IFwibG9jYWxcIiB8fCBjaGlsZC50eXBlID09PSBcInByb3RlY3RlZFwiKSB7XG4gICAgICAgIG91dC5wdXNoKGNoaWxkLnRleHQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGEgZnVuY3Rpb24gb3IgdGFzayBpbiBpdHMgZW5jbG9zaW5nIHNjb3BlIGFuZCBvcGVucyBhIHNjb3BlIGZvciBpdC5cbiAgICpcbiAgICogQm90aCBoYWx2ZXMgYXJlIG5lZWRlZCBhbmQgbmVpdGhlciBpcyBlbm91Z2ggYWxvbmU6IHdpdGhvdXQgdGhlIHN5bWJvbCxcbiAgICogYGFkZCgxLCAyKWAgbmVpdGhlciByZXNvbHZlcyBub3IgY29tcGxldGVzLCBhbmQgd2l0aG91dCB0aGUgc2NvcGUgdGhlXG4gICAqIGFyZ3VtZW50cyBhbmQgdGhlIGJvZHkgc3RheSBpbnZpc2libGUgdG8gZ28tdG8tZGVmaW5pdGlvbi5cbiAgICovXG4gIHByaXZhdGUgZGVjbGFyZU1ldGhvZChcbiAgICBub2RlOiBOb2RlLFxuICAgIGVuY2xvc2luZzogTXV0YWJsZVNjb3BlIHwgdW5kZWZpbmVkLFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBleHRyYXM6IHsgcXVhbGlmaWVycz86IHN0cmluZ1tdOyBkb2M/OiBzdHJpbmcgfSxcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgaXNUYXNrID0gbm9kZS50eXBlID09PSBcInRhc2tfZGVjbGFyYXRpb25cIiB8fCBub2RlLnR5cGUgPT09IFwidGFza19wcm90b3R5cGVcIjtcbiAgICBjb25zdCBpc0NvbnN0cnVjdG9yID0gbm9kZS50eXBlID09PSBcImNsYXNzX2NvbnN0cnVjdG9yX2RlY2xhcmF0aW9uXCI7XG4gICAgY29uc3QgY2F0ZWdvcnk6IFN5bWJvbENhdGVnb3J5ID0gaXNUYXNrID8gXCJ0YXNrXCIgOiBcImZ1bmN0aW9uXCI7XG5cbiAgICAvLyBUaGUgZGVjbGFyZWQgcmV0dXJuIHR5cGUgaXMgd2hhdCBhIGNhbGwgc2l0ZSB3YW50cyB0byBrbm93IC0tIG5vdCB0aGVcbiAgICAvLyB3aG9sZSBkZWNsYXJhdGlvbiwgYW5kIGZvciBhIGNvbnN0cnVjdG9yIHRoZXJlIGlzIG5vIHR5cGUgYXQgYWxsLlxuICAgIGNvbnN0IHJldHVyblR5cGUgPSBpc0NvbnN0cnVjdG9yXG4gICAgICA/IFwiY29uc3RydWN0b3JcIlxuICAgICAgOiBub2RlVGV4dChmaW5kRGVzY2VuZGFudChub2RlLCBcImRhdGFfdHlwZV9vcl92b2lkXCIsIDIpID8/IHVuZGVmaW5lZCkgfHwgXCJ2b2lkXCI7XG5cbiAgICBjb25zdCBuYW1lTm9kZSA9IHNjb3BlTmFtZU5vZGUobm9kZSwgc2NvcGVIZWFkZXIobm9kZSkpO1xuICAgIGlmIChuYW1lTm9kZSkgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG4gICAgY29uc3QgYm9keSA9IGZpbmRDaGlsZChub2RlLCBcInRhc2tfYm9keV9kZWNsYXJhdGlvblwiKSA/PyBmaW5kQ2hpbGQobm9kZSwgXCJmdW5jdGlvbl9ib2R5X2RlY2xhcmF0aW9uXCIpO1xuICAgIGNvbnN0IG93bmVyTm9kZSA9IGJvZHkgPyBmaW5kQ2hpbGQoYm9keSwgXCJjbGFzc19zY29wZVwiKSA6IG51bGw7XG4gICAgY29uc3Qgb3duZXJDbGFzcyA9IG93bmVyTm9kZT8udGV4dC5yZXBsYWNlKC86OiQvLCBcIlwiKS50cmltKCk7XG5cbiAgICBjb25zdCBtZXRob2Q6IFBlbmRpbmdTeW1ib2wgPSB7XG4gICAgICBuYW1lLFxuICAgICAgY2F0ZWdvcnksXG4gICAgICB0eXBlVGV4dDogcmV0dXJuVHlwZSxcbiAgICAgIHVucGFja2VkRGltczogW10sXG4gICAgICBpc1BvcnQ6IGZhbHNlLFxuICAgICAgc2NvcGVJZDogZW5jbG9zaW5nPy5pZCA/PyAtMSxcbiAgICAgIHJhbmdlOiB0b1JhbmdlKG5vZGUpLFxuICAgICAgc2VsZWN0aW9uUmFuZ2U6IG5hbWVOb2RlID8gc2VsZWN0aW9uKG5hbWVOb2RlKSA6IHRvUmFuZ2Uobm9kZSksXG4gICAgICBkb2M6IGV4dHJhcy5kb2MsXG4gICAgICAuLi4oZXh0cmFzLnF1YWxpZmllcnM/Lmxlbmd0aCA/IHsgcXVhbGlmaWVyczogZXh0cmFzLnF1YWxpZmllcnMgfSA6IHt9KSxcbiAgICB9O1xuICAgIGNvbnN0IGJlZm9yZSA9IHRoaXMuc2NvcGVzLmxlbmd0aDtcbiAgICB0aGlzLm9wZW5TY29wZShcbiAgICAgIG5vZGUsXG4gICAgICBpc1Rhc2sgPyBcInRhc2tcIiA6IFwiZnVuY3Rpb25cIixcbiAgICAgIGVuY2xvc2luZz8uaWQsXG4gICAgICAoZW5jbG9zaW5nPy5kZXB0aCA/PyAtMSkgKyAxLFxuICAgICAgbmFtZSxcbiAgICApO1xuICAgIGNvbnN0IG1ldGhvZFNjb3BlID0gdGhpcy5zY29wZXNbYmVmb3JlXTtcbiAgICBpZiAobWV0aG9kU2NvcGUpIHtcbiAgICAgIG1ldGhvZFNjb3BlLm93bmVyQ2xhc3MgPSBvd25lckNsYXNzO1xuICAgICAgKG1ldGhvZCBhcyB7IGFyZ3VtZW50cz86IHJlYWRvbmx5IEhkbFN5bWJvbFtdIH0pLmFyZ3VtZW50cyA9IG1ldGhvZFNjb3BlLnBvcnRzO1xuICAgIH1cbiAgICAvLyBBIHF1YWxpZmllZCBpbXBsZW1lbnRhdGlvbiBiZWxvbmdzIHRvIGl0cyBjbGFzcywgbm90IHRvICR1bml0LlxuICAgIGlmICghb3duZXJDbGFzcykgdGhpcy5kZWNsYXJlKGVuY2xvc2luZywgbWV0aG9kLCBjYXRlZ29yeSk7XG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgd2hhdCBhIG1hY3JvIGludm9jYXRpb24gaW4gZGVjbGFyYXRpb24gcG9zaXRpb24gc3RhbmRzIGZvci5cbiAgICpcbiAgICogYGAgYE5PVE1SSU5TVCgoQ0hBTlctMSksMCxjaGFuX21hc2spOyBgYCBleHBhbmRzIHRvIGByZWcgW0NIQU5XLTE6MF1cbiAgICogY2hhbl9tYXNrYCwgd2hpY2ggaXMgYW4gb3JkaW5hcnkgZGVjbGFyYXRpb24gb25jZSB0aGUgcHJlcHJvY2Vzc29yIGlzIGRvbmVcbiAgICogd2l0aCBpdC4gVGhlIGV4cGFuc2lvbiBpcyBwYXJzZWQgYXMgaXRzIG93biBsaXR0bGUgZG9jdW1lbnQgYW5kIHJlYWQgd2l0aFxuICAgKiB0aGUgc2FtZSBkZWNsYXJhdGlvbiBwYXJzZXJzIGFzIHRoZSBmaWxlIGl0c2VsZiwgdGhlbiBhbmNob3JlZCBhdCB0aGVcbiAgICogaW52b2NhdGlvbiBzbyBob3ZlciBhbmQgZ28tdG8tZGVmaW5pdGlvbiBsYW5kIHdoZXJlIHRoZSBhdXRob3IgY2FuIHNlZVxuICAgKiB0aGVtLlxuICAgKlxuICAgKiBBIG1hY3JvIHRoZSB3b3Jrc3BhY2UgZG9lcyBub3QgZGVmaW5lIGlzIGxlZnQgY29tcGxldGVseSBhbG9uZTogdGhlIHBvaW50XG4gICAqIGlzIHRvIHJlYWQgd2hhdCBpcyB3cml0dGVuLCBhbmQgYSBtYWNybyBmcm9tIGFuIHVucmVhZCBpbmNsdWRlIHdvdWxkXG4gICAqIG90aGVyd2lzZSBiZWNvbWUgYSBzaWxlbnRseSBpbnZlbnRlZCBkZWNsYXJhdGlvbi5cbiAgICovXG4gIHByaXZhdGUgZGVjbGFyZUZyb21NYWNybyhub2RlOiBOb2RlLCBzY29wZTogTXV0YWJsZVNjb3BlIHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgY29uc3QgcGFyc2UgPSB0aGlzLnBhcnNlRnJhZ21lbnQ7XG4gICAgaWYgKCFwYXJzZSB8fCAhc2NvcGUgfHwgdGhpcy5tYWNyb3Muc2l6ZSA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgaW52b2NhdGlvbiA9IG5vZGUudGV4dDtcbiAgICBjb25zdCBuYW1lID0gL15gXFxzKihbQS1aYS16X11cXHcqKS8uZXhlYyhpbnZvY2F0aW9uKT8uWzFdO1xuICAgIGlmICghbmFtZSB8fCAhdGhpcy5tYWNyb3MuaGFzKG5hbWUpKSByZXR1cm47XG5cbiAgICBjb25zdCB7IHRleHQgfSA9IGV4cGFuZChpbnZvY2F0aW9uLCB0aGlzLm1hY3Jvcywgbm9kZS5zdGFydEluZGV4KTtcbiAgICAvLyBBIG1hY3JvIGJvZHkgcmFyZWx5IGNhcnJpZXMgaXRzIG93biB0ZXJtaW5hdGluZyBzZW1pY29sb24gLS0gdGhlIGNvbW1vblxuICAgIC8vIGZvcm0gaXMgYGRlZmluZSBYKGEsYixuKSByZWcgW2E6Yl0gbmAgLS0gc28gdGhlIGRlY2xhcmF0aW9uIG9ubHkgcGFyc2VzXG4gICAgLy8gd2l0aCBvbmUgYXBwZW5kZWQuXG4gICAgY29uc3Qgc291cmNlID0gYCR7dGV4dC50cmltRW5kKCl9O2A7XG5cbiAgICBsZXQgZnJhZ21lbnQ6IFRyZWU7XG4gICAgdHJ5IHtcbiAgICAgIGZyYWdtZW50ID0gcGFyc2Uoc291cmNlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBhbmNob3IgPSB0b1JhbmdlKG5vZGUpO1xuICAgIGNvbnN0IGNvbGxlY3RlZCA9IHRoaXMuY29sbGVjdEZyb21GcmFnbWVudChmcmFnbWVudCwgc291cmNlKTtcblxuICAgIGZvciAoY29uc3Qgc3ltYm9sIG9mIGNvbGxlY3RlZC5zeW1ib2xzKSB7XG4gICAgICAvLyBSZS1hbmNob3JlZCBvbnRvIHRoZSBpbnZvY2F0aW9uOiB0aGUgZXhwYW5zaW9uJ3MgY29vcmRpbmF0ZXMgbWVhblxuICAgICAgLy8gbm90aGluZyBpbiB0aGUgZmlsZSB0aGUgYXV0aG9yIGlzIHJlYWRpbmcuXG4gICAgICAoc3ltYm9sIGFzIHsgcmFuZ2U6IFJhbmdlIH0pLnJhbmdlID0gYW5jaG9yO1xuICAgICAgKHN5bWJvbCBhcyB7IHNlbGVjdGlvblJhbmdlOiBSYW5nZSB9KS5zZWxlY3Rpb25SYW5nZSA9IGFuY2hvcjtcblxuICAgICAgLy8gVGhlIG5vZGUgdGhlIHJhbmdlIHdhcyByZWFkIGZyb20gYmVsb25ncyB0byB0aGUgZnJhZ21lbnQncyB0cmVlLCB3aGljaFxuICAgICAgLy8gaXMgZnJlZWQgYmVsb3cuIFRoZSB0ZXh0IHN1cnZpdmVzIGl0LCBhbmQgdGhlIHRleHQgaXMgZW5vdWdoIHRvIGZvbGQgYVxuICAgICAgLy8gd2lkdGggZnJvbSAtLSBob2xkaW5nIHRoZSBub2RlIHdvdWxkIGxlYXZlIGEgZGFuZ2xpbmcgcG9pbnRlciB0aGF0XG4gICAgICAvLyBjcmFzaGVzIHRoZSB3aWR0aCBwYXNzIHRoZSBtb21lbnQgdGhlIGV4cGFuc2lvbiBpcyByZWxlYXNlZC5cbiAgICAgIChzeW1ib2wgYXMgUGVuZGluZ1N5bWJvbCkucGFja2VkUmFuZ2VOb2RlID0gbnVsbDtcblxuICAgICAgdGhpcy5kZWNsYXJlKHNjb3BlLCBzeW1ib2wsIHN5bWJvbC5jYXRlZ29yeSk7XG4gICAgfVxuXG4gICAgLy8gQSBtYWNybyBtYXkgaW5zdGFudGlhdGUgbW9kdWxlcyBhcyB3ZWxsIGFzIGRlY2xhcmluZyBzaWduYWxzIC0tIHRoZVxuICAgIC8vIGNvbW1vbiBzaGFwZSBkZWNsYXJlcyBhIHdpcmUsIGEgc2hhZG93IGNvcHkgb2YgaXQgYW5kIGEgdm90aW5nIGJsb2NrIG92ZXJcbiAgICAvLyB0aGUgY29weS4gTGVhdmluZyB0aGUgaW5zdGFuY2Ugb3V0IHdvdWxkIHNob3cgdGhlIHNpZ25hbHMgYW5kIGhpZGUgdGhlXG4gICAgLy8gdGhpbmcgdGhhdCByZWFkcyB0aGVtLlxuICAgIGZvciAoY29uc3QgaW5zdGFuY2Ugb2YgY29sbGVjdGVkLmluc3RhbmNlcykge1xuICAgICAgc2NvcGUuaW5zdGFuY2VzLnB1c2goeyAuLi5pbnN0YW5jZSwgcmFuZ2U6IGFuY2hvciwgdHlwZVJhbmdlOiBhbmNob3IgfSk7XG4gICAgfVxuXG4gICAgZnJhZ21lbnQuZGVsZXRlKCk7XG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyYXRpb25zIG9mIGFuIGV4cGFuZGVkIG1hY3JvIGJvZHksIHJlYWQgYnkgYSB0aHJvd2F3YXkgYW5hbHl6ZXIuXG4gICAqXG4gICAqIFRoZSBib2R5IGlzIGEgZGlmZmVyZW50IGRvY3VtZW50IHdpdGggZGlmZmVyZW50IGNvb3JkaW5hdGVzLCBzbyBpdCBnZXRzXG4gICAqIGl0cyBvd24gYW5hbHl6ZXIgcG9pbnRlZCBhdCBhIHNjcmF0Y2ggc2NvcGUuIE9ubHkgdGhlIGRlY2xhcmF0aW9ucyBhcmVcbiAgICogd2FudGVkOyByZWZlcmVuY2VzLCB3aWR0aHMgYW5kIGFjY2Vzc2VzIG9mIHRoZSBleHBhbnNpb24gYXJlIHRoZSBjYWxsZXInc1xuICAgKiBidXNpbmVzcywgbm90IHRoaXMgb25lJ3MuXG4gICAqL1xuICBwcml2YXRlIGNvbGxlY3RGcm9tRnJhZ21lbnQoXG4gICAgZnJhZ21lbnQ6IFRyZWUsXG4gICAgc291cmNlOiBzdHJpbmcsXG4gICk6IHsgc3ltYm9sczogSGRsU3ltYm9sW107IGluc3RhbmNlczogSGRsSW5zdGFuY2VbXSB9IHtcbiAgICBjb25zdCBzaGFkb3cgPSB0aGlzLmZyYWdtZW50QW5hbHl6ZXIoKTtcblxuICAgIGNvbnN0IHNjcmF0Y2g6IE11dGFibGVTY29wZSA9IHtcbiAgICAgIGlkOiAwLFxuICAgICAgbmFtZTogXCI8bWFjcm8+XCIsXG4gICAgICBjYXRlZ29yeTogXCJtb2R1bGVcIixcbiAgICAgIHJhbmdlOiB7IHN0YXJ0OiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9LCBlbmQ6IHsgbGluZTogMCwgY2hhcmFjdGVyOiAwIH0gfSxcbiAgICAgIHNlbGVjdGlvblJhbmdlOiB7IHN0YXJ0OiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9LCBlbmQ6IHsgbGluZTogMCwgY2hhcmFjdGVyOiAwIH0gfSxcbiAgICAgIGhlYWRlclRleHQ6IFwiXCIsXG4gICAgICBwYXJhbWV0ZXJzOiBbXSxcbiAgICAgIHBvcnRzOiBbXSxcbiAgICAgIHN5bWJvbHM6IFtdLFxuICAgICAgaW5zdGFuY2VzOiBbXSxcbiAgICAgIGNoaWxkcmVuOiBbXSxcbiAgICAgIGRlcHRoOiAwLFxuICAgICAgc3RhcnQ6IDAsXG4gICAgICBlbmQ6IHNvdXJjZS5sZW5ndGgsXG4gICAgfTtcblxuICAgIC8vIEV2ZXJ5dGhpbmcgdGhlIGJvZHkgZGVjbGFyZXMgaXMgd2FudGVkOyBub3RoaW5nIGl0IHJlZmVyZW5jZXMgaXMuXG4gICAgc2hhZG93LnJlc2V0Rm9yKHNvdXJjZSk7XG4gICAgc2hhZG93LnNjb3Blcy5wdXNoKHNjcmF0Y2gpO1xuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBmcmFnbWVudC5yb290Tm9kZS5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBzaGFkb3cudmlzaXROb2RlKGNoaWxkLCBzY3JhdGNoLmlkLCAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3ltYm9sczogWy4uLnNjcmF0Y2gucGFyYW1ldGVycywgLi4uc2NyYXRjaC5wb3J0cywgLi4uc2NyYXRjaC5zeW1ib2xzXSxcbiAgICAgIGluc3RhbmNlczogc2NyYXRjaC5pbnN0YW5jZXMsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgYW5hbHl6ZXIgdGhhdCByZWFkcyBtYWNybyBleHBhbnNpb25zLCBidWlsdCBvbmNlIGFuZCByZXVzZWQuXG4gICAqXG4gICAqIEEgZmlsZSBjYW4gaG9sZCB0aG91c2FuZHMgb2YgbWFjcm8gY2FsbHMuIEJ1aWxkaW5nIGFuIGFuYWx5emVyIHBlciBjYWxsXG4gICAqIGNvc3QgbW9yZSB0aGFuIHBhcnNpbmcgdGhlIGV4cGFuc2lvbiBkaWQgLS0gbWVhc3VyZWQgYXQgMC4wNCBtcyBwZXJcbiAgICogaW52b2NhdGlvbiBhZ2FpbnN0IDAuMDEzIG1zIGZvciB0aGUgcGFyc2UgLS0gc28gdGhlIHN0YXRlIGlzIHJlc2V0IGJldHdlZW5cbiAgICogYm9kaWVzIGluc3RlYWQgb2YgdGhlIG9iamVjdCBiZWluZyByZWJ1aWx0LlxuICAgKi9cbiAgcHJpdmF0ZSBmcmFnbWVudEFuYWx5emVyKCk6IEFuYWx5emVyIHtcbiAgICB0aGlzLmZyYWdtZW50ID8/PSBuZXcgQW5hbHl6ZXIoXG4gICAgICBcIlwiLFxuICAgICAgdGhpcy5jbGFzc05hbWVzLFxuICAgICAgdGhpcy5pbXBvcnRlZFBhcmFtZXRlclZhbHVlcyxcbiAgICAgIHRoaXMubWFjcm9zLFxuICAgICAgdGhpcy5wYXJzZUZyYWdtZW50LFxuICAgICk7XG4gICAgcmV0dXJuIHRoaXMuZnJhZ21lbnQ7XG4gIH1cblxuICBwcml2YXRlIGZyYWdtZW50OiBBbmFseXplciB8IHVuZGVmaW5lZDtcblxuICAvKiogQ2xlYXJzIGV2ZXJ5dGhpbmcgYnV0IHRoZSBjb25maWd1cmF0aW9uLCB0byByZWFkIGEgZGlmZmVyZW50IGJvZHkuICovXG4gIHByaXZhdGUgcmVzZXRGb3IodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5zY29wZXMubGVuZ3RoID0gMDtcbiAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuY2xlYXIoKTtcbiAgICB0aGlzLnVzZXMubGVuZ3RoID0gMDtcbiAgICB0aGlzLmZpbGVJbXBvcnRzLmxlbmd0aCA9IDA7XG4gICAgdGhpcy5uZXh0U2NvcGVJZCA9IDE7XG4gICAgdGhpcy5saW5lcyA9IHRleHQuc3BsaXQoL1xccj9cXG4vKTtcbiAgfVxuXG4gIC8qKiBgaW1wb3J0IHBrZzo6KjtgIGFuZCBgaW1wb3J0IHBrZzo6QSwgcGtnOjpCO2AgKi9cbiAgcHJpdmF0ZSBwYXJzZVBhY2thZ2VJbXBvcnRzKG5vZGU6IE5vZGUpOiBQYWNrYWdlSW1wb3J0W10ge1xuICAgIGNvbnN0IG91dDogUGFja2FnZUltcG9ydFtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2Ygbm9kZS5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBpZiAoaXRlbS50eXBlICE9PSBcInBhY2thZ2VfaW1wb3J0X2l0ZW1cIikgY29udGludWU7XG5cbiAgICAgIGNvbnN0IG5hbWVzID0gaXRlbS5uYW1lZENoaWxkcmVuLmZpbHRlcigoYykgPT4gYy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpO1xuICAgICAgY29uc3QgaGVhZCA9IG5hbWVzWzBdO1xuICAgICAgaWYgKCFoZWFkKSBjb250aW51ZTtcbiAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQoaGVhZC5pZCk7XG5cbiAgICAgIGNvbnN0IHdpbGRjYXJkID0gaXRlbS50ZXh0LmluY2x1ZGVzKFwiKlwiKTtcbiAgICAgIGNvbnN0IGV4cGxpY2l0ID0gd2lsZGNhcmRcbiAgICAgICAgPyBbXVxuICAgICAgICA6IG5hbWVzLnNsaWNlKDEpLm1hcCgoYykgPT4ge1xuICAgICAgICAgICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChjLmlkKTtcbiAgICAgICAgICAgIHJldHVybiBjLnRleHQ7XG4gICAgICAgICAgfSk7XG5cbiAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgcGFja2FnZU5hbWU6IGhlYWQudGV4dCxcbiAgICAgICAgd2lsZGNhcmQsXG4gICAgICAgIGV4cGxpY2l0LFxuICAgICAgICByYW5nZTogdG9SYW5nZShpdGVtKSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICBwcml2YXRlIG9wZW5TY29wZShcbiAgICBub2RlOiBOb2RlLFxuICAgIGtpbmQ6IFNjb3BlQ2F0ZWdvcnksXG4gICAgcGFyZW50SWQ6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBkZXB0aDogbnVtYmVyLFxuICAgIC8qKiBOYW1lIGZvciBzY29wZXMgdGhlIGdyYW1tYXIgZG9lcyBub3QgbmFtZSwgZS5nLiBhIGNsYXNzIG1ldGhvZC4gKi9cbiAgICBuYW1lT3ZlcnJpZGU/OiBzdHJpbmcsXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGhlYWRlciA9IHNjb3BlSGVhZGVyKG5vZGUpO1xuICAgIGNvbnN0IG5hbWVOb2RlID0gc2NvcGVOYW1lTm9kZShub2RlLCBoZWFkZXIpO1xuICAgIGNvbnN0IG5hbWUgPSBuYW1lT3ZlcnJpZGUgPz8gKG5hbWVOb2RlID8gbmFtZU5vZGUudGV4dCA6IGA8YW5vbnltb3VzICR7a2luZH0+YCk7XG4gICAgaWYgKG5hbWVOb2RlKSB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWVOb2RlLmlkKTtcblxuICAgIGNvbnN0IHNjb3BlOiBNdXRhYmxlU2NvcGUgPSB7XG4gICAgICBpZDogdGhpcy5uZXh0U2NvcGVJZCsrLFxuICAgICAgbmFtZSxcbiAgICAgIGNhdGVnb3J5OiBraW5kLFxuICAgICAgcGFyZW50SWQsXG4gICAgICByYW5nZTogdG9SYW5nZShub2RlKSxcbiAgICAgIHNlbGVjdGlvblJhbmdlOiBuYW1lTm9kZSA/IHNlbGVjdGlvbihuYW1lTm9kZSkgOiB0b1JhbmdlKG5vZGUpLFxuICAgICAgaGVhZGVyVGV4dDogaGVhZGVyID8gaGVhZGVyLnRleHQuc2xpY2UoMCwgNDAwKSA6IG5vZGUudGV4dC5zbGljZSgwLCAyMDApLFxuICAgICAgcGFyYW1ldGVyczogW10sXG4gICAgICBwb3J0czogW10sXG4gICAgICBzeW1ib2xzOiBbXSxcbiAgICAgIGluc3RhbmNlczogW10sXG4gICAgICBjaGlsZHJlbjogW10sXG4gICAgICBkZXB0aCxcbiAgICAgIHN0YXJ0OiBub2RlLnN0YXJ0SW5kZXgsXG4gICAgICBlbmQ6IG5vZGUuZW5kSW5kZXgsXG4gICAgfTtcblxuICAgIC8vIGBjbGFzcyBEZXJpdmVkIGV4dGVuZHMgUGFja2V0ICMoMTYpO2AgLS0gdGhlIGJhc2UncyBtZW1iZXJzIGFyZSB0aGlzXG4gICAgLy8gY2xhc3MncyBtZW1iZXJzIHRvbywgYW5kIHRoZSBiYXNlIGlzIHVzdWFsbHkgaW4gYW5vdGhlciBmaWxlLlxuICAgIGNvbnN0IGJhc2UgPSBraW5kID09PSBcImNsYXNzXCIgPyBiYXNlQ2xhc3NOYW1lKG5vZGUpIDogbnVsbDtcbiAgICBpZiAoYmFzZSkge1xuICAgICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChiYXNlLmlkKTtcbiAgICAgIHNjb3BlLmJhc2VDbGFzcyA9IGJhc2UudGV4dDtcbiAgICB9XG5cbiAgICB0aGlzLnNjb3Blcy5wdXNoKHNjb3BlKTtcblxuICAgIGNvbnN0IHBhcmVudCA9IHBhcmVudElkICE9PSB1bmRlZmluZWQgPyB0aGlzLnNjb3Blcy5maW5kKChzKSA9PiBzLmlkID09PSBwYXJlbnRJZCkgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHBhcmVudCkgcGFyZW50LmNoaWxkcmVuLnB1c2goc2NvcGUgYXMgSGRsU2NvcGUpO1xuXG4gICAgLy8gQSBmdW5jdGlvbiBvciB0YXNrIGRlY2xhcmVzIGl0cyBhcmd1bWVudHMgaW4gYSBgdGZfcG9ydF9saXN0YCwgbm90IGluIGFcbiAgICAvLyBoZWFkZXIgbm9kZS4gYGlucHV0IGludCBhLCBvdXRwdXQgbG9naWMgcWAgaGFzIHRvIGJlY29tZSByZWFsIHBvcnRzLCBvclxuICAgIC8vIHRoZSBhcmd1bWVudCBuYW1lcyBpbnNpZGUgdGhlIGJvZHkgbG9vayB1bmRlY2xhcmVkLlxuICAgIGlmIChraW5kID09PSBcImZ1bmN0aW9uXCIgfHwga2luZCA9PT0gXCJ0YXNrXCIpIHtcbiAgICAgIGZvciAoY29uc3QgcG9ydCBvZiB0aGlzLnBhcnNlVGZQb3J0TGlzdChub2RlLCBzY29wZSkpIHtcbiAgICAgICAgc2NvcGUucG9ydHMucHVzaChwb3J0KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGhlYWRlcikge1xuICAgICAgLy8gYG1vZHVsZSBtIGltcG9ydCBwOjoqOyAoIC4uLiApO2BcbiAgICAgIC8vXG4gICAgICAvLyBUaGUgaW1wb3J0IHNpdHMgYmV0d2VlbiB0aGUgbW9kdWxlIG5hbWUgYW5kIHRoZSBwb3J0IGxpc3QsIHNvIGl0IGlzIGFcbiAgICAgIC8vIGNoaWxkIG9mIHRoZSBoZWFkZXIgbm9kZSBhbmQgbm90IG9mIHRoZSBib2R5IC0tIG5vdGhpbmcgZWxzZSBpbiB0aGVcbiAgICAgIC8vIHRyYXZlcnNhbCBldmVyIHNlZXMgaXQuIERlc2lnbnMgdGhhdCB3cml0ZSB0aGVpciBwb3J0cyB0aGlzIHdheSBkZXBlbmRcbiAgICAgIC8vIG9uIHRob3NlIG5hbWVzIGJlaW5nIHZpc2libGUgKmluIHRoZSBwb3J0IGxpc3QgaXRzZWxmKiwgd2hpY2ggaXMgd2h5XG4gICAgICAvLyBtaXNzaW5nIHRoaXMgbGVhdmVzIGV2ZXJ5IHBhcmFtZXRlciB1c2VkIGluIGEgd2lkdGggdW5kZWNsYXJlZC5cbiAgICAgIGNvbnN0IGhlYWRlckltcG9ydHMgPSBmaW5kQ2hpbGRyZW4oaGVhZGVyLCBcInBhY2thZ2VfaW1wb3J0X2RlY2xhcmF0aW9uXCIpO1xuICAgICAgaWYgKGhlYWRlckltcG9ydHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBpbXBvcnRzID0gaGVhZGVySW1wb3J0cy5mbGF0TWFwKChub2RlKSA9PiB0aGlzLnBhcnNlUGFja2FnZUltcG9ydHMobm9kZSkpO1xuICAgICAgICAoc2NvcGUgYXMgeyBpbXBvcnRzPzogUGFja2FnZUltcG9ydFtdIH0pLmltcG9ydHMgPSBbXG4gICAgICAgICAgLi4uKHNjb3BlLmltcG9ydHMgPz8gW10pLFxuICAgICAgICAgIC4uLmltcG9ydHMsXG4gICAgICAgIF07XG4gICAgICB9XG5cbiAgICAgIC8vIEhlYWRlci1kZWNsYXJlZCBwYXJhbWV0ZXJzIGFuZCBwb3J0cyBiZWxvbmcgdG8gdGhpcyBzY29wZS4gU2NvcGVzIHdpdGhcbiAgICAgIC8vIG5vIGhlYWRlciBub2RlIChgcGFja2FnZWAsIGBjbGFzc2ApIGRlY2xhcmUgZXZlcnl0aGluZyBpbiB0aGVpciBib2R5LFxuICAgICAgLy8gd2hpY2ggdGhlIHRyYXZlcnNhbCBiZWxvdyBwaWNrcyB1cC5cbiAgICAgIGZvciAoY29uc3QgcGFyYW1EZWNsIG9mIHRoaXMuZmluZFBhcmFtRGVjbGFyYXRpb25zKGhlYWRlcikpIHtcbiAgICAgICAgZm9yIChjb25zdCBzeW0gb2YgdGhpcy5wYXJzZVBhcmFtRGVjbGFyYXRpb24ocGFyYW1EZWNsLCBzY29wZSwgZmFsc2UpKSB7XG4gICAgICAgICAgc2NvcGUucGFyYW1ldGVycy5wdXNoKHN5bSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3Qgc3ltIG9mIHRoaXMucGFyc2VQb3J0TGlzdChoZWFkZXIsIHNjb3BlLCBub2RlKSkge1xuICAgICAgICBzY29wZS5wb3J0cy5wdXNoKHN5bSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChraW5kID09PSBcImNsYXNzXCIpIHtcbiAgICAgIC8vIGBjbGFzcyBQYWNrZXQgIyhwYXJhbWV0ZXIgaW50IFcgPSA4KWAga2VlcHMgaXRzIHBhcmFtZXRlciBsaXN0IGluIGFcbiAgICAgIC8vIGBwYXJhbWV0ZXJfcG9ydF9saXN0YCBkaXJlY3RseSBvbiB0aGUgZGVjbGFyYXRpb24sIHdpdGggbm8gaGVhZGVyIG5vZGVcbiAgICAgIC8vIHRvIHJlYWQgaXQgZnJvbS5cbiAgICAgIGNvbnN0IHBhcmFtTGlzdCA9IGZpbmRDaGlsZChub2RlLCBcInBhcmFtZXRlcl9wb3J0X2xpc3RcIik7XG4gICAgICBpZiAocGFyYW1MaXN0KSB7XG4gICAgICAgIGZvciAoY29uc3QgcGFyYW1EZWNsIG9mIHRoaXMuZmluZFBhcmFtRGVjbGFyYXRpb25zKHBhcmFtTGlzdCkpIHtcbiAgICAgICAgICBmb3IgKGNvbnN0IHN5bSBvZiB0aGlzLnBhcnNlUGFyYW1EZWNsYXJhdGlvbihwYXJhbURlY2wsIHNjb3BlLCBmYWxzZSkpIHtcbiAgICAgICAgICAgIHNjb3BlLnBhcmFtZXRlcnMucHVzaChzeW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEEgbmFtZWQgYmxvY2sgaXMgcmVhY2hhYmxlIGFzIGBibG9ja19uYW1lLnNpZ25hbGAgZnJvbSBhbnl3aGVyZSBpbiB0aGVcbiAgICAvLyBkZXNpZ24gdW5pdCB0aGF0IGVuY2xvc2VzIGl0LCBzbyBpdHMgbmFtZSBpcyBkZWNsYXJlZCBpbiBldmVyeSBlbmNsb3NpbmdcbiAgICAvLyBzY29wZSB1cCB0byB0aGF0IHVuaXQgLS0gbm90IG9ubHkgaW4gaXRzIGltbWVkaWF0ZSBwYXJlbnQuIEEgYmxvY2sgaW5zaWRlXG4gICAgLy8gYSBgZ2VuZXJhdGVgIGlzIGEgZ3JhbmRjaGlsZCBvZiB0aGUgbW9kdWxlLCBhbmQgYGdibGsubGFuZWAgd3JpdHRlbiBmcm9tXG4gICAgLy8gdGhlIG1vZHVsZSdzIGJvZHkgaGFzIHRvIHJlc29sdmUuXG4gICAgaWYgKGtpbmQgPT09IFwiYmxvY2tcIiAmJiBuYW1lTm9kZSkge1xuICAgICAgY29uc3QgZW50cnk6IFBlbmRpbmdTeW1ib2wgPSB7XG4gICAgICAgIG5hbWU6IG5hbWVOb2RlLnRleHQsXG4gICAgICAgIGNhdGVnb3J5OiBcImJsb2NrXCIsXG4gICAgICAgIHR5cGVUZXh0OiBcImJsb2NrXCIsXG4gICAgICAgIHVucGFja2VkRGltczogW10sXG4gICAgICAgIGlzUG9ydDogZmFsc2UsXG4gICAgICAgIHNjb3BlSWQ6IC0xLFxuICAgICAgICByYW5nZTogdG9SYW5nZShub2RlKSxcbiAgICAgICAgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihuYW1lTm9kZSksXG4gICAgICAgIGRvYzogdGhpcy5kb2NCZWZvcmUobm9kZSksXG4gICAgICB9O1xuXG4gICAgICBmb3IgKGxldCBvd25lciA9IHBhcmVudCBhcyBNdXRhYmxlU2NvcGUgfCB1bmRlZmluZWQ7IG93bmVyOyApIHtcbiAgICAgICAgdGhpcy5kZWNsYXJlKG93bmVyLCB7IC4uLmVudHJ5LCBzY29wZUlkOiBvd25lci5pZCB9LCBcImJsb2NrXCIpO1xuICAgICAgICAvLyBTdG9wIGF0IHRoZSBkZXNpZ24gdW5pdDogcGFzdCBpdCwgdGhlIGJsb2NrIGlzIG5vdCBpbiBzY29wZS5cbiAgICAgICAgaWYgKERFU0lHTl9VTklUUy5oYXMob3duZXIuY2F0ZWdvcnkpKSBicmVhaztcbiAgICAgICAgb3duZXIgPSBvd25lci5wYXJlbnRJZCAhPT0gdW5kZWZpbmVkID8gdGhpcy5zY29wZXMuZmluZCgocykgPT4gcy5pZCA9PT0gb3duZXIhLnBhcmVudElkKSA6IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnZpc2l0U2NvcGVDaGlsZHJlbihub2RlLCBzY29wZS5pZCwgZGVwdGggKyAxKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgYXJndW1lbnRzIG9mIGEgZnVuY3Rpb24gb3IgdGFzaywgcmVhZCBhcyBwb3J0cy5cbiAgICpcbiAgICogYHRhc2sgZHJpdmUoaW5wdXQgbG9naWMgZW4sIG91dHB1dCBsb2dpYyBxKTtgIGFuZFxuICAgKiBgZnVuY3Rpb24gaW50IGFkZChpbnB1dCBpbnQgYSwgaW5wdXQgaW50IGIpO2AgYm90aCBwdXQgdGhlaXIgYXJndW1lbnRzIGluIGFcbiAgICogYHRmX3BvcnRfbGlzdGAsIG9uZSBgdGZfcG9ydF9pdGVtYCBlYWNoLCB3aXRoIHRoZSBkaXJlY3Rpb24gaW4gYVxuICAgKiBgdGZfcG9ydF9kaXJlY3Rpb25gIHNpYmxpbmcuIEFuIGFyZ3VtZW50IHdyaXR0ZW4gd2l0aG91dCBhIGRpcmVjdGlvblxuICAgKiAoYHRhc2sgdChpbnB1dCBpbnQgYSk7YCBpcyBmaW5lLCBgZnVuY3Rpb24gZihpbnQgYSk7YCBpcyBub3QpIHN0aWxsIG5lZWRzIGFcbiAgICogbmFtZSwgYW5kIGEgcGxhaW4gYGludCBhYCBpcyBhIGB0Zl92YXJpYWJsZV9pZGVudGlmaWVyYCByYXRoZXIgdGhhbiBhIHBvcnQuXG4gICAqL1xuICBwcml2YXRlIHBhcnNlVGZQb3J0TGlzdChub2RlOiBOb2RlLCBzY29wZTogTXV0YWJsZVNjb3BlKTogUGVuZGluZ1N5bWJvbFtdIHtcbiAgICBjb25zdCBvdXQ6IFBlbmRpbmdTeW1ib2xbXSA9IFtdO1xuXG4gICAgLy8gYHRmX3BvcnRfbGlzdGAgaXMgYSBjaGlsZCBvZiBgZnVuY3Rpb25fYm9keV9kZWNsYXJhdGlvbmAsIHNvIGl0IGlzIG9uZSBsZXZlbFxuICAgIC8vIGJlbG93IHRoZSBkZWNsYXJhdGlvbiBub2RlOyBhIGNvbnN0cnVjdG9yIG5hbWVzIGl0cyBhcmd1bWVudHMgZGlmZmVyZW50bHkuXG4gICAgY29uc3QgbGlzdHM6IE5vZGVbXSA9IFtdO1xuICAgIGNvbnN0IGNvbGxlY3RMaXN0cyA9IChjdXJyZW50OiBOb2RlLCBkZXB0aDogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgICBpZiAoZGVwdGggPiAzKSByZXR1cm47XG4gICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGN1cnJlbnQubmFtZWRDaGlsZHJlbikge1xuICAgICAgICBpZiAoY2hpbGQudHlwZSA9PT0gXCJ0Zl9wb3J0X2xpc3RcIiB8fCBjaGlsZC50eXBlID09PSBcImNsYXNzX2NvbnN0cnVjdG9yX2FyZ19saXN0XCIpIHtcbiAgICAgICAgICBsaXN0cy5wdXNoKGNoaWxkKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb2xsZWN0TGlzdHMoY2hpbGQsIGRlcHRoICsgMSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGNvbGxlY3RMaXN0cyhub2RlLCAwKTtcblxuICAgIGZvciAoY29uc3QgbGlzdCBvZiBsaXN0cykge1xuICAgICAgbGV0IGluaGVyaXRlZFR5cGUgPSBcImxvZ2ljXCI7XG4gICAgICBsZXQgaW5oZXJpdGVkRGlyZWN0aW9uOiBQb3J0RGlyZWN0aW9uID0gXCJpbnB1dFwiO1xuICAgICAgbGV0IGluaGVyaXRlZFJhbmdlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgbGlzdC5uYW1lZENoaWxkcmVuKSB7XG4gICAgICAgIGlmIChpdGVtLnR5cGUgIT09IFwidGZfcG9ydF9pdGVtXCIgJiYgaXRlbS50eXBlICE9PSBcImNsYXNzX2NvbnN0cnVjdG9yX2FyZ1wiKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcG9ydEl0ZW0gPSBpdGVtLnR5cGUgPT09IFwiY2xhc3NfY29uc3RydWN0b3JfYXJnXCIgPyBmaW5kQ2hpbGQoaXRlbSwgXCJ0Zl9wb3J0X2l0ZW1cIikgOiBpdGVtO1xuICAgICAgICBpZiAoIXBvcnRJdGVtKSBjb250aW51ZTtcblxuICAgICAgICBjb25zdCBuYW1lTm9kZSA9IHBvcnRJdGVtLm5hbWVkQ2hpbGRyZW4uZmluZChcbiAgICAgICAgICAoYykgPT4gYy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgfHwgYy50eXBlID09PSBcInRmX3ZhcmlhYmxlX2lkZW50aWZpZXJcIixcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFuYW1lTm9kZSkgY29udGludWU7XG4gICAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQobmFtZU5vZGUuaWQpO1xuXG4gICAgICAgIGNvbnN0IHR5cGVOb2RlID0gZmluZENoaWxkKHBvcnRJdGVtLCBcImRhdGFfdHlwZV9vcl9pbXBsaWNpdFwiKTtcbiAgICAgICAgY29uc3QgZGlyZWN0aW9uTm9kZSA9IGZpbmRDaGlsZChwb3J0SXRlbSwgXCJ0Zl9wb3J0X2RpcmVjdGlvblwiKTtcbiAgICAgICAgaWYgKGRpcmVjdGlvbk5vZGUpIHtcbiAgICAgICAgICBpbmhlcml0ZWREaXJlY3Rpb24gPSBwYXJzZURpcmVjdGlvbihkaXJlY3Rpb25Ob2RlLnRleHQpID8/IFwiaW5wdXRcIjtcbiAgICAgICAgICBpbmhlcml0ZWRUeXBlID0gXCJsb2dpY1wiO1xuICAgICAgICAgIGluaGVyaXRlZFJhbmdlID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhY2tlZERpbSA9IHR5cGVOb2RlID8gZmluZERlc2NlbmRhbnQodHlwZU5vZGUsIFwicGFja2VkX2RpbWVuc2lvblwiLCAzKSA6IG51bGw7XG4gICAgICAgIGNvbnN0IGZyb21UZXh0ID0gdHlwZU5vZGUgJiYgIXBhY2tlZERpbSA/IHNwbGl0UGFja2VkVGV4dChub2RlVGV4dCh0eXBlTm9kZSkpIDogbnVsbDtcbiAgICAgICAgY29uc3QgdHlwZVRleHQgPSBwYWNrZWREaW1cbiAgICAgICAgICA/IHN0cmlwUGFja2VkKG5vZGVUZXh0KHR5cGVOb2RlKSwgcGFja2VkRGltLnRleHQpXG4gICAgICAgICAgOiAoZnJvbVRleHQ/LnR5cGUgPz8gKHR5cGVOb2RlID8gbm9kZVRleHQodHlwZU5vZGUpIDogdW5kZWZpbmVkKSA/PyBcIlwiKTtcbiAgICAgICAgaWYgKHR5cGVOb2RlICYmIHR5cGVOb2RlLnRleHQudHJpbSgpKSB7XG4gICAgICAgICAgaW5oZXJpdGVkVHlwZSA9IHR5cGVUZXh0IHx8IFwibG9naWNcIjtcbiAgICAgICAgICBpbmhlcml0ZWRSYW5nZSA9IGlubmVyT2YocGFja2VkRGltID8/IHVuZGVmaW5lZCkgPz8gZnJvbVRleHQ/LnJhbmdlO1xuICAgICAgICB9XG5cbiAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgIG5hbWU6IG5hbWVOb2RlLnRleHQsXG4gICAgICAgICAgY2F0ZWdvcnk6IFwicG9ydFwiLFxuICAgICAgICAgIHR5cGVUZXh0OiBpbmhlcml0ZWRUeXBlLFxuICAgICAgICAgIHBhY2tlZFJhbmdlVGV4dDogaW5oZXJpdGVkUmFuZ2UsXG4gICAgICAgICAgcGFja2VkUmFuZ2VOb2RlOiBwYWNrZWREaW0gPz8gbnVsbCxcbiAgICAgICAgICB1bnBhY2tlZERpbXM6IHBvcnRJdGVtLm5hbWVkQ2hpbGRyZW5cbiAgICAgICAgICAgIC5maWx0ZXIoKGMpID0+IGMudHlwZSA9PT0gXCJ1bnBhY2tlZF9kaW1lbnNpb25cIilcbiAgICAgICAgICAgIC5tYXAoKGQpID0+IGQudGV4dCksXG4gICAgICAgICAgZGlyZWN0aW9uOiBpbmhlcml0ZWREaXJlY3Rpb24sXG4gICAgICAgICAgaXNQb3J0OiB0cnVlLFxuICAgICAgICAgIHNjb3BlSWQ6IHNjb3BlLmlkLFxuICAgICAgICAgIHJhbmdlOiB0b1JhbmdlKHBvcnRJdGVtKSxcbiAgICAgICAgICBzZWxlY3Rpb25SYW5nZTogc2VsZWN0aW9uKG5hbWVOb2RlKSxcbiAgICAgICAgICBkb2M6IHRoaXMuZG9jQmVmb3JlKHBvcnRJdGVtKSxcbiAgICAgICAgICBpbml0aWFsaXplclRleHQ6IHBvcnRJdGVtLnRleHQuaW5jbHVkZXMoXCI9XCIpID8gcG9ydEl0ZW0udGV4dC5zbGljZShwb3J0SXRlbS50ZXh0LmluZGV4T2YoXCI9XCIpICsgMSkudHJpbSgpIDogdW5kZWZpbmVkLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgLyoqIFRoZSBtdXRhYmxlIHNjb3BlIGEgYHBhcmVudElkYCByZWZlcnMgdG8sIGlmIGl0IGlzIHN0aWxsIG9wZW4uICovXG4gIHByaXZhdGUgc2NvcGVBdChwYXJlbnRJZDogbnVtYmVyIHwgdW5kZWZpbmVkKTogTXV0YWJsZVNjb3BlIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gcGFyZW50SWQgIT09IHVuZGVmaW5lZCA/IHRoaXMuc2NvcGVzLmZpbmQoKHMpID0+IHMuaWQgPT09IHBhcmVudElkKSA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByaXZhdGUgZmluZFBhcmFtRGVjbGFyYXRpb25zKGhlYWRlcjogTm9kZSk6IE5vZGVbXSB7XG4gICAgY29uc3QgZm91bmQ6IE5vZGVbXSA9IFtdO1xuICAgIGNvbnN0IHdhbGsgPSAobjogTm9kZSkgPT4ge1xuICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBuLm5hbWVkQ2hpbGRyZW4pIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGNoaWxkLnR5cGUgPT09IFwicGFyYW1ldGVyX2RlY2xhcmF0aW9uXCIgfHxcbiAgICAgICAgICBjaGlsZC50eXBlID09PSBcImxvY2FsX3BhcmFtZXRlcl9kZWNsYXJhdGlvblwiIHx8XG4gICAgICAgICAgY2hpbGQudHlwZSA9PT0gXCJwYXJhbWV0ZXJfcG9ydF9kZWNsYXJhdGlvblwiXG4gICAgICAgICkge1xuICAgICAgICAgIGNvbnN0IHRhcmdldCA9IGNoaWxkLnR5cGUgPT09IFwicGFyYW1ldGVyX3BvcnRfZGVjbGFyYXRpb25cIlxuICAgICAgICAgICAgPyBmaW5kQ2hpbGQoY2hpbGQsIFwicGFyYW1ldGVyX2RlY2xhcmF0aW9uXCIpXG4gICAgICAgICAgICA6IGNoaWxkO1xuICAgICAgICAgIGlmICh0YXJnZXQpIGZvdW5kLnB1c2godGFyZ2V0KTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICB3YWxrKGNoaWxkKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHdhbGsoaGVhZGVyKTtcbiAgICByZXR1cm4gZm91bmQ7XG4gIH1cblxuICAvKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICpcbiAgICogRGVjbGFyYXRpb24gcGFyc2Vyc1xuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgcHJpdmF0ZSBwYXJzZVBhcmFtRGVjbGFyYXRpb24obm9kZTogTm9kZSwgc2NvcGU6IE11dGFibGVTY29wZSB8IHVuZGVmaW5lZCwgaXNMb2NhbDogYm9vbGVhbik6IFBlbmRpbmdTeW1ib2xbXSB7XG4gICAgY29uc3QgdHlwZU5vZGUgPSBmaW5kQ2hpbGQobm9kZSwgXCJkYXRhX3R5cGVfb3JfaW1wbGljaXRcIik7XG4gICAgY29uc3QgdHlwZVRleHQgPSBub2RlVGV4dCh0eXBlTm9kZSkgfHwgXCJwYXJhbWV0ZXJcIjtcbiAgICBjb25zdCBvdXQ6IFBlbmRpbmdTeW1ib2xbXSA9IFtdO1xuXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSBmaW5kQ2hpbGQobm9kZSwgXCJsaXN0X29mX3BhcmFtX2Fzc2lnbm1lbnRzXCIpO1xuICAgIGlmICghYXNzaWdubWVudHMpIHJldHVybiBvdXQ7XG5cbiAgICBmb3IgKGNvbnN0IGFzc2lnbm1lbnQgb2YgYXNzaWdubWVudHMubmFtZWRDaGlsZHJlbikge1xuICAgICAgY29uc3QgbmFtZU5vZGUgPSBhc3NpZ25tZW50Lm5hbWVkQ2hpbGQoMCk7XG4gICAgICBpZiAoIW5hbWVOb2RlIHx8IG5hbWVOb2RlLnR5cGUgIT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikgY29udGludWU7XG4gICAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWVOb2RlLmlkKTtcblxuICAgICAgb3V0LnB1c2goe1xuICAgICAgICBuYW1lOiBuYW1lTm9kZS50ZXh0LFxuICAgICAgICBjYXRlZ29yeTogaXNMb2NhbCA/IFwibG9jYWxwYXJhbVwiIDogXCJwYXJhbWV0ZXJcIixcbiAgICAgICAgdHlwZVRleHQsXG4gICAgICAgIHVucGFja2VkRGltczogW10sXG4gICAgICAgIGlzUG9ydDogZmFsc2UsXG4gICAgICAgIHNjb3BlSWQ6IHNjb3BlPy5pZCA/PyAtMSxcbiAgICAgICAgcmFuZ2U6IHRvUmFuZ2UoYXNzaWdubWVudCksXG4gICAgICAgIHNlbGVjdGlvblJhbmdlOiBzZWxlY3Rpb24obmFtZU5vZGUpLFxuICAgICAgICBpbml0aWFsaXplclRleHQ6IHZhbHVlVGV4dChhc3NpZ25tZW50KSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBwb3J0cyBvZiBhIG1vZHVsZSwgaW4gZWl0aGVyIGRpYWxlY3QuXG4gICAqXG4gICAqIEFOU0kgc3R5bGUgZGVjbGFyZXMgZXZlcnl0aGluZyBpbiB0aGUgaGVhZGVyOlxuICAgKiBgbW9kdWxlIG0oaW5wdXQgd2lyZSBbNzowXSBhLCBvdXRwdXQgcmVnIGIpO2BcbiAgICpcbiAgICogVmVyaWxvZy0xOTk1IHN0eWxlIGxpc3RzIGJhcmUgbmFtZXMgaW4gdGhlIGhlYWRlciBhbmQgZGVjbGFyZXMgdGhlbSBpbiB0aGVcbiAgICogYm9keTogYG1vZHVsZSBtKGEsIGIpOyBpbnB1dCBbNzowXSBhOyBvdXRwdXQgcmVnIGI7YC4gVGhlIGhlYWRlciB0aGVuIHNheXNcbiAgICogbm90aGluZyBhYm91dCBkaXJlY3Rpb24sIHdpZHRoIG9yIHR5cGUsIHNvIHRoZSBib2R5J3MgYHBvcnRfZGVjbGFyYXRpb25gXG4gICAqIG5vZGVzIGFyZSB0aGUgb25seSBzb3VyY2Ugb2YgdHJ1dGguXG4gICAqL1xuICBwcml2YXRlIHBhcnNlUG9ydExpc3QoaGVhZGVyOiBOb2RlLCBzY29wZTogTXV0YWJsZVNjb3BlLCBib2R5OiBOb2RlIHwgdW5kZWZpbmVkKTogUGVuZGluZ1N5bWJvbFtdIHtcbiAgICAvLyBBTlNJIGhlYWRlcnMgY2FycnkgdGhlIGRlY2xhcmF0aW9ucyB0aGVtc2VsdmVzOyBub24tQU5TSSBoZWFkZXJzIGNhcnJ5XG4gICAgLy8gYmFyZSBuYW1lcyBpbiBhIGBsaXN0X29mX3BvcnRzYCBhbmQgc2F5IG5vdGhpbmcgZWxzZS5cbiAgICBjb25zdCBwb3J0TGlzdCA9IGhlYWRlci5uYW1lZENoaWxkcmVuLmZpbmQoXG4gICAgICAoYykgPT5cbiAgICAgICAgYy50eXBlID09PSBcImxpc3Rfb2ZfcG9ydF9kZWNsYXJhdGlvbnNcIiB8fFxuICAgICAgICBjLnR5cGUgPT09IFwibGlzdF9vZl90Zl9wb3J0c1wiIHx8XG4gICAgICAgIGMudHlwZSA9PT0gXCJsaXN0X29mX3BvcnRzXCIsXG4gICAgKTtcbiAgICBpZiAoIXBvcnRMaXN0KSByZXR1cm4gW107XG5cbiAgICBjb25zdCBvdXQ6IFBlbmRpbmdTeW1ib2xbXSA9IFtdO1xuXG4gICAgLy8gSW4gYW4gQU5TSSBwb3J0IGxpc3QgYSBiYXJlIGRpcmVjdGlvbiBhcHBsaWVzIHRvIGV2ZXJ5IGZvbGxvd2luZyBuYW1lXG4gICAgLy8gdW50aWwgYW5vdGhlciBkaXJlY3Rpb24gYXBwZWFycywgc28gYGlucHV0IGEsIGIsIGNgIG1ha2VzIGFsbCB0aHJlZVxuICAgIC8vIGlucHV0cyBvZiB0aGUgc2FtZSAocG9zc2libHkgaW1wbGljaXQpIHR5cGUuXG4gICAgbGV0IGluaGVyaXRlZERpcmVjdGlvbjogUG9ydERpcmVjdGlvbiB8IHVuZGVmaW5lZDtcbiAgICBsZXQgaW5oZXJpdGVkVHlwZVRleHQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgaW5oZXJpdGVkUGFja2VkUmFuZ2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgaW5oZXJpdGVkUGFja2VkTm9kZTogTm9kZSB8IG51bGwgPSBudWxsO1xuXG4gICAgZm9yIChjb25zdCBwb3J0Tm9kZSBvZiBwb3J0TGlzdC5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBpZiAocG9ydE5vZGUudHlwZSAhPT0gXCJhbnNpX3BvcnRfZGVjbGFyYXRpb25cIiAmJiBwb3J0Tm9kZS50eXBlICE9PSBcImFuc2lfdGZfcG9ydF9kZWNsYXJhdGlvblwiKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgaGVhZGVyTm9kZSA9IHBvcnROb2RlLm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlLmVuZHNXaXRoKFwiX3BvcnRfaGVhZGVyXCIpKTtcbiAgICAgIGNvbnN0IHR5cGVTZWFyY2hSb290ID0gaGVhZGVyTm9kZSA/PyBwb3J0Tm9kZTtcblxuICAgICAgY29uc3QgZGlyZWN0aW9uTm9kZSA9IGZpbmREZXNjZW5kYW50KHR5cGVTZWFyY2hSb290LCBcInBvcnRfZGlyZWN0aW9uXCIsIDIpO1xuICAgICAgY29uc3QgdHlwZUhvbGRlciA9XG4gICAgICAgIGZpbmREZXNjZW5kYW50KHR5cGVTZWFyY2hSb290LCBcImRhdGFfdHlwZVwiLCAzKSA/P1xuICAgICAgICBmaW5kRGVzY2VuZGFudCh0eXBlU2VhcmNoUm9vdCwgXCJuZXRfcG9ydF90eXBlXCIsIDMpID8/XG4gICAgICAgIGZpbmREZXNjZW5kYW50KHR5cGVTZWFyY2hSb290LCBcIm5ldF90eXBlXCIsIDMpO1xuXG4gICAgICAvLyBgYnVzX2lmLnNsYXZlIGJ1c2AgLS0gYSBwb3J0IHdob3NlIHR5cGUgaXMgYW4gaW50ZXJmYWNlLCBvcHRpb25hbGx5XG4gICAgICAvLyB0aHJvdWdoIGEgbW9kcG9ydC4gVGhlIHR5cGUgaXMgdGhlIHdob2xlIGhlYWRlciwgYmVjYXVzZSBgYnVzLmRhdGFgXG4gICAgICAvLyBoYXMgdG8ga25vdyB3aGljaCBpbnRlcmZhY2UgYGJ1c2AgaXMgYmVmb3JlIGl0IGNhbiBmaW5kIGBkYXRhYDsgYSBwb3J0XG4gICAgICAvLyB3aXRoIG5vIHR5cGUgcmVjb3JkZWQgaXMgZXhhY3RseSB0aGUgcG9ydCB0aGF0IGNhbm5vdCBiZSBmb2xsb3dlZC5cbiAgICAgIGlmIChoZWFkZXJOb2RlPy50eXBlID09PSBcImludGVyZmFjZV9wb3J0X2hlYWRlclwiKSB7XG4gICAgICAgIGluaGVyaXRlZERpcmVjdGlvbiA9IHVuZGVmaW5lZDtcbiAgICAgICAgaW5oZXJpdGVkVHlwZVRleHQgPSBoZWFkZXJOb2RlLnRleHQ7XG4gICAgICAgIGluaGVyaXRlZFBhY2tlZFJhbmdlID0gdW5kZWZpbmVkO1xuICAgICAgICBpbmhlcml0ZWRQYWNrZWROb2RlID0gbnVsbDtcbiAgICAgIH0gZWxzZSBpZiAoZGlyZWN0aW9uTm9kZSkge1xuICAgICAgICBpbmhlcml0ZWREaXJlY3Rpb24gPSBwYXJzZURpcmVjdGlvbihkaXJlY3Rpb25Ob2RlLnRleHQpO1xuICAgICAgICBpbmhlcml0ZWRUeXBlVGV4dCA9IHVuZGVmaW5lZDtcbiAgICAgICAgaW5oZXJpdGVkUGFja2VkUmFuZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgIGluaGVyaXRlZFBhY2tlZE5vZGUgPSBudWxsO1xuICAgICAgfVxuXG4gICAgICAvLyBQcmVmZXIgdGhlIHN0cnVjdHVyZWQgZGltZW5zaW9uOyBmYWxsIGJhY2sgdG8gdGhlIHRleHQgd2hlbiB0aGUgdHlwZVxuICAgICAgLy8gYXJyaXZlZCBhcyBhIHNpbmdsZSB0b2tlbiwgYXMgbmV0IHBvcnRzIGRvLlxuICAgICAgY29uc3QgcGFja2VkRGltID0gdHlwZUhvbGRlciA/IGZpbmREZXNjZW5kYW50KHR5cGVIb2xkZXIsIFwicGFja2VkX2RpbWVuc2lvblwiLCAyKSA6IG51bGw7XG4gICAgICBjb25zdCBmcm9tVGV4dCA9IHR5cGVIb2xkZXIgJiYgIXBhY2tlZERpbSA/IHNwbGl0UGFja2VkVGV4dCh0eXBlSG9sZGVyLnRleHQpIDogbnVsbDtcblxuICAgICAgaWYgKHR5cGVIb2xkZXIpIHtcbiAgICAgICAgLy8gYGlucHV0IFsxMTowXSBhYCBkZWNsYXJlcyBubyB0eXBlIGF0IGFsbCwgb25seSBhIHJhbmdlLCBzbyBhbiBlbXB0eVxuICAgICAgICAvLyB0eXBlIGhlcmUgbXVzdCBzdGF5IGVtcHR5IHJhdGhlciB0aGFuIGZhbGxpbmcgYmFjayB0byB0aGUgcmFuZ2UgdGV4dC5cbiAgICAgICAgY29uc3QgZGVjbGFyZWQgPSBmcm9tVGV4dFxuICAgICAgICAgID8gZnJvbVRleHQudHlwZSB8fCB1bmRlZmluZWRcbiAgICAgICAgICA6IHN0cmlwUGFja2VkKHR5cGVIb2xkZXIudGV4dCwgcGFja2VkRGltPy50ZXh0KSB8fCB1bmRlZmluZWQ7XG5cbiAgICAgICAgaW5oZXJpdGVkVHlwZVRleHQgPSBkZWNsYXJlZDtcbiAgICAgICAgaW5oZXJpdGVkUGFja2VkUmFuZ2UgPSBpbm5lck9mKHBhY2tlZERpbSA/PyB1bmRlZmluZWQpID8/IGZyb21UZXh0Py5yYW5nZTtcbiAgICAgICAgaW5oZXJpdGVkUGFja2VkTm9kZSA9IHBhY2tlZERpbSA/PyBudWxsO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkaXJlY3Rpb24gPSBwYXJzZURpcmVjdGlvbihkaXJlY3Rpb25Ob2RlID8gZGlyZWN0aW9uTm9kZS50ZXh0IDogXCJcIikgPz8gaW5oZXJpdGVkRGlyZWN0aW9uO1xuICAgICAgLy8gQW4gaW1wbGljaXQgcG9ydCBkZWNsYXJlcyBubyB0eXBlIG9mIGl0cyBvd247IGB0eXBlVGV4dGAgc3RheXMgZW1wdHlcbiAgICAgIC8vIGFuZCB0aGUgZGlyZWN0aW9uIGlzIHdoYXQgZ2V0cyBkaXNwbGF5ZWQuXG4gICAgICBjb25zdCB0eXBlVGV4dCA9IGluaGVyaXRlZFR5cGVUZXh0ID8/IFwiXCI7XG4gICAgICBjb25zdCBwYWNrZWRSYW5nZVRleHQgPSBpbmhlcml0ZWRQYWNrZWRSYW5nZTtcblxuICAgICAgLy8gQSBkZWNsYXJhdGlvbiBjYW4gbmFtZSBzZXZlcmFsIHBvcnRzIChgaW5wdXQgYSwgYmApOyB0aGUgYHBvcnRfbmFtZWBcbiAgICAgIC8vIGZpZWxkIG9ubHkgcG9pbnRzIGF0IHRoZSBmaXJzdCwgc28gZXZlcnkgaWRlbnRpZmllciBpcyBjb2xsZWN0ZWQuXG4gICAgICBjb25zdCBuYW1lTm9kZXMgPSBwb3J0Tm9kZS5uYW1lZENoaWxkcmVuLmZpbHRlcigoYykgPT4gYy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpO1xuICAgICAgZm9yIChjb25zdCBuYW1lTm9kZSBvZiBuYW1lTm9kZXMpIHtcbiAgICAgICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG4gICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICBuYW1lOiBuYW1lTm9kZS50ZXh0LFxuICAgICAgICAgIGNhdGVnb3J5OiBcInBvcnRcIixcbiAgICAgICAgICB0eXBlVGV4dCxcbiAgICAgICAgICBwYWNrZWRSYW5nZVRleHQsXG4gICAgICAgICAgcGFja2VkUmFuZ2VOb2RlOiBpbmhlcml0ZWRQYWNrZWROb2RlLFxuICAgICAgICAgIHVucGFja2VkRGltczogZmluZENoaWxkcmVuKHBvcnROb2RlLCBcInVucGFja2VkX2RpbWVuc2lvblwiKS5tYXAoKGQpID0+IGQudGV4dCksXG4gICAgICAgICAgZGlyZWN0aW9uLFxuICAgICAgICAgIGlzUG9ydDogdHJ1ZSxcbiAgICAgICAgICBzY29wZUlkOiBzY29wZS5pZCxcbiAgICAgICAgICByYW5nZTogdG9SYW5nZShwb3J0Tm9kZSksXG4gICAgICAgICAgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihuYW1lTm9kZSksXG4gICAgICAgICAgZG9jOiB0aGlzLmRvY0JlZm9yZShwb3J0Tm9kZSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFZlcmlsb2ctMTk5NTogdGhlIGhlYWRlciBsaXN0cyBiYXJlIG5hbWVzLCBhbmQgdGhlIGJvZHkgZGVjbGFyZXMgdGhlbS5cbiAgICAvLyBUaG9zZSBkZWNsYXJhdGlvbnMgYXJlIGFscmVhZHkgcGFyc2VkIGFzIG5ldHMgb3IgdmFyaWFibGVzLCBzbyBoZXJlXG4gICAgLy8gdGhleSBhcmUgb25seSBwcm9tb3RlZCB0byBwb3J0cyAtLSBhIHBvcnQgaXMgYSBuZXQgb3IgdmFyaWFibGUgdGhhdCBpc1xuICAgIC8vIGFsc28gcmVhY2hhYmxlIGZyb20gb3V0c2lkZSB0aGUgbW9kdWxlLlxuICAgIC8vXG4gICAgLy8gT25seSBmb3IgYSBub24tQU5TSSBoZWFkZXI6IGBsaXN0X29mX3BvcnRzYCBjYXJyaWVzIGJhcmUgbmFtZXMsIHdoaWxlXG4gICAgLy8gYGxpc3Rfb2ZfcG9ydF9kZWNsYXJhdGlvbnNgIG1lYW5zIHRoZSBoZWFkZXIgYWxyZWFkeSBzYWlkIGV2ZXJ5dGhpbmcgYW5kXG4gICAgLy8gdGhlIGxvb3AgYWJvdmUgaGFzIHRoZSBhbnN3ZXIuXG4gICAgaWYgKGJvZHkgJiYgcG9ydExpc3Q/LnR5cGUgPT09IFwibGlzdF9vZl9wb3J0c1wiKSB7XG4gICAgICBjb25zdCBoZWFkZXJOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBwb3J0TGlzdC5uYW1lZENoaWxkcmVuKSB7XG4gICAgICAgIGlmIChjaGlsZC50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgfHwgY2hpbGQudHlwZSA9PT0gXCJwb3J0XCIpIHtcbiAgICAgICAgICBoZWFkZXJOYW1lcy5hZGQoY2hpbGQudGV4dCk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBpbm5lciBvZiBpdGVyYXRlKGNoaWxkKSkge1xuICAgICAgICAgIGlmIChpbm5lci50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpIGhlYWRlck5hbWVzLmFkZChpbm5lci50ZXh0KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm9tb3RlZCA9IHBhcnNlTGVnYWN5UG9ydHMoYm9keSwgaGVhZGVyTmFtZXMpO1xuICAgICAgb3V0LnB1c2goLi4ucHJvbW90ZWQpO1xuICAgICAgZm9yIChjb25zdCBzeW1ib2wgb2YgcHJvbW90ZWQpIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQoc3ltYm9sLmRlY2xhcmF0aW9uSWQpO1xuICAgIH1cbiAgICByZXR1cm4gb3V0O1xuICB9XG5cbiAgcHJpdmF0ZSBwYXJzZURhdGFEZWNsYXJhdGlvbihcbiAgICBub2RlOiBOb2RlLFxuICAgIHNjb3BlOiBNdXRhYmxlU2NvcGUgfCB1bmRlZmluZWQsXG4gICAgcXVhbGlmaWVycz86IHJlYWRvbmx5IHN0cmluZ1tdLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCB0eXBlRGVjbCA9IGZpbmRDaGlsZChub2RlLCBcInR5cGVfZGVjbGFyYXRpb25cIik7XG4gICAgaWYgKHR5cGVEZWNsKSB7XG4gICAgICB0aGlzLnBhcnNlVHlwZURlY2xhcmF0aW9uKHR5cGVEZWNsLCBzY29wZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgaW1wb3J0RGVjbCA9IGZpbmRDaGlsZChub2RlLCBcInBhY2thZ2VfaW1wb3J0X2RlY2xhcmF0aW9uXCIpO1xuICAgIGlmIChpbXBvcnREZWNsKSB7XG4gICAgICBjb25zdCBpbXBvcnRzID0gdGhpcy5wYXJzZVBhY2thZ2VJbXBvcnRzKGltcG9ydERlY2wpO1xuXG4gICAgICAvLyBgaW1wb3J0YCBtYXkgc2l0IGF0IGNvbXBpbGF0aW9uLXVuaXQgbGV2ZWwsIG91dHNpZGUgYW55IHNjb3BlLCBzbyB0aGVcbiAgICAgIC8vIGZpbGUncyBvd24gaW1wb3J0cyBhcmUga2VwdCB0b28gYW5kIHZpc2liaWxpdHkgY2hlY2tzIGJvdGggbGlzdHMuXG4gICAgICB0aGlzLmZpbGVJbXBvcnRzLnB1c2goLi4uaW1wb3J0cyk7XG5cbiAgICAgIGlmIChzY29wZSkge1xuICAgICAgICAoc2NvcGUgYXMgeyBpbXBvcnRzPzogUGFja2FnZUltcG9ydFtdIH0pLmltcG9ydHMgPSBbLi4uKHNjb3BlLmltcG9ydHMgPz8gW10pLCAuLi5pbXBvcnRzXTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGZpbmRDaGlsZHJlbihpbXBvcnREZWNsLCBcInBhY2thZ2VfaW1wb3J0X2l0ZW1cIikpIHtcbiAgICAgICAgY29uc3QgaWRlbnQgPSBpdGVtLm5hbWVkQ2hpbGQoMCk7XG4gICAgICAgIGlmICghaWRlbnQpIGNvbnRpbnVlO1xuICAgICAgICAvLyBUaGUgaW1wb3J0ZWQgcGFja2FnZSBuYW1lIGlzIGEgcmVmZXJlbmNlLCBub3QgYSBkZWNsYXJhdGlvbi5cbiAgICAgICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChpZGVudC5pZCk7XG4gICAgICAgIGlmIChzY29wZSAmJiB0aGlzLnNjb3Blcy5maW5kKChzKSA9PiBzLmlkID09PSBzY29wZS5pZCk/Lm5hbWUgPT09IGlkZW50LnRleHQpIGNvbnRpbnVlO1xuICAgICAgICB0aGlzLmRlY2xhcmUoc2NvcGUsIHtcbiAgICAgICAgICBuYW1lOiBpZGVudC50ZXh0LFxuICAgICAgICAgIGNhdGVnb3J5OiBcInBhY2thZ2VcIixcbiAgICAgICAgICB0eXBlVGV4dDogYHBhY2thZ2UgJHtub2RlVGV4dChpdGVtKS5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKX1gLFxuICAgICAgICAgIHVucGFja2VkRGltczogW10sXG4gICAgICAgICAgaXNQb3J0OiBmYWxzZSxcbiAgICAgICAgICBzY29wZUlkOiBzY29wZT8uaWQgPz8gLTEsXG4gICAgICAgICAgcmFuZ2U6IHRvUmFuZ2UoaXRlbSksXG4gICAgICAgICAgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihpZGVudCksXG4gICAgICAgICAgZG9jOiBcIkltcG9ydGVkIHBhY2thZ2UgLS0gbWVtYmVycyBhcmUgYWNjZXNzaWJsZSBhcyBgcGtnOjptZW1iZXJgLlwiLFxuICAgICAgICB9LCBcInBhY2thZ2VcIik7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdHlwZU5vZGUgPSBmaW5kQ2hpbGQobm9kZSwgXCJkYXRhX3R5cGVfb3JfaW1wbGljaXRcIik7XG4gICAgY29uc3QgZGF0YVR5cGVOb2RlID0gdHlwZU5vZGUgPyBmaW5kQ2hpbGQodHlwZU5vZGUsIFwiZGF0YV90eXBlXCIpID8/IHR5cGVOb2RlIDogbnVsbDtcblxuICAgIC8vIFNlYXJjaCBmb3IgdGhlIGRpbWVuc2lvbiByYXRoZXIgdGhhbiBhc3N1bWluZyBhIGZpeGVkIG5lc3RpbmcsIGFuZCBmYWxsXG4gICAgLy8gYmFjayB0byB0aGUgdGV4dCB3aGVuIHRoZSB0eXBlIGFycml2ZWQgYXMgYSBzaW5nbGUgdG9rZW4uXG4gICAgY29uc3QgcGFja2VkRGltID0gZGF0YVR5cGVOb2RlID8gZmluZERlc2NlbmRhbnQoZGF0YVR5cGVOb2RlLCBcInBhY2tlZF9kaW1lbnNpb25cIiwgMykgOiBudWxsO1xuICAgIGNvbnN0IGZyb21UZXh0ID0gZGF0YVR5cGVOb2RlICYmICFwYWNrZWREaW0gPyBzcGxpdFBhY2tlZFRleHQoZGF0YVR5cGVOb2RlLnRleHQpIDogbnVsbDtcblxuICAgIGNvbnN0IHR5cGVUZXh0ID1cbiAgICAgIChwYWNrZWREaW0gPyBzdHJpcFBhY2tlZChkYXRhVHlwZU5vZGUhLnRleHQsIHBhY2tlZERpbS50ZXh0KSA6IChmcm9tVGV4dD8udHlwZSA/PyBkYXRhVHlwZU5vZGU/LnRleHQgPz8gXCJcIikpIHx8XG4gICAgICAodHlwZU5vZGU/LnRleHQudHJpbSgpID8/IFwibG9naWNcIik7XG4gICAgY29uc3QgcGFja2VkUmFuZ2VUZXh0ID0gaW5uZXJPZihwYWNrZWREaW0gPz8gdW5kZWZpbmVkKSA/PyBmcm9tVGV4dD8ucmFuZ2U7XG5cbiAgICBmb3IgKGNvbnN0IFtjYXRlZ29yeSwgbGlzdE5hbWUsIGFzc2lnbm1lbnRUeXBlXSBvZiBbXG4gICAgICBbXCJ2YXJpYWJsZVwiLCBcImxpc3Rfb2ZfdmFyaWFibGVfZGVjbF9hc3NpZ25tZW50c1wiLCBcInZhcmlhYmxlX2RlY2xfYXNzaWdubWVudFwiXSxcbiAgICAgIFtcInZhcmlhYmxlXCIsIFwibGlzdF9vZl92YXJpYWJsZV9pZGVudGlmaWVyc1wiLCBcInZhcmlhYmxlX2lkZW50aWZpZXJcIl0sXG4gICAgICBbXCJuZXRcIiwgXCJsaXN0X29mX25ldF9kZWNsX2Fzc2lnbm1lbnRzXCIsIFwibmV0X2RlY2xfYXNzaWdubWVudFwiXSxcbiAgICBdIGFzIGNvbnN0KSB7XG4gICAgICBjb25zdCBsaXN0ID0gZmluZENoaWxkKG5vZGUsIGxpc3ROYW1lKTtcbiAgICAgIGlmICghbGlzdCkgY29udGludWU7XG5cbiAgICAgIGZvciAoY29uc3QgYXNzaWdubWVudCBvZiBsaXN0Lm5hbWVkQ2hpbGRyZW4pIHtcbiAgICAgICAgaWYgKGFzc2lnbm1lbnQudHlwZSAhPT0gYXNzaWdubWVudFR5cGUpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBuYW1lTm9kZSA9IGFzc2lnbm1lbnQubmFtZWRDaGlsZCgwKTtcbiAgICAgICAgaWYgKCFuYW1lTm9kZSB8fCBuYW1lTm9kZS50eXBlICE9PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpIGNvbnRpbnVlO1xuICAgICAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWVOb2RlLmlkKTtcblxuICAgICAgICBjb25zdCB1bnBhY2tlZERpbXMgPSBhc3NpZ25tZW50Lm5hbWVkQ2hpbGRyZW4uZmlsdGVyKChjKSA9PiBjLnR5cGUgPT09IFwidW5wYWNrZWRfZGltZW5zaW9uXCIpO1xuXG4gICAgICAgIC8vIGBQYWNrZXQgcGt0O2AgaXMgYW4gb2JqZWN0LCBub3QgYSB2ZWN0b3IuIERlY2lkaW5nIHRoYXQgbmVlZHMgdG8ga25vd1xuICAgICAgICAvLyB3aGF0IGBQYWNrZXRgIGlzLCB3aGljaCB0aGUgZmlsZSBiZWluZyByZWFkIHVzdWFsbHkgY2Fubm90IHNheS5cbiAgICAgICAgY29uc3QgY2xhc3NOYW1lID0gY2xhc3NUeXBlTmFtZShkYXRhVHlwZU5vZGUgPz8gdHlwZU5vZGUsIHRoaXMuY2xhc3NOYW1lcyk7XG4gICAgICAgIGNvbnN0IGhhbmRsZU9mID0gY2xhc3NOYW1lICYmIHRoaXMuY2xhc3NOYW1lcy5oYXMoY2xhc3NOYW1lKSA/IGNsYXNzTmFtZSA6IHVuZGVmaW5lZDtcblxuICAgICAgICB0aGlzLmRlY2xhcmUoc2NvcGUsIHtcbiAgICAgICAgICBuYW1lOiBuYW1lTm9kZS50ZXh0LFxuICAgICAgICAgIGNhdGVnb3J5OiBoYW5kbGVPZiA/IFwiaGFuZGxlXCIgOiAoY2F0ZWdvcnkgYXMgU3ltYm9sQ2F0ZWdvcnkpLFxuICAgICAgICAgIHR5cGVUZXh0LFxuICAgICAgICAgIHBhY2tlZFJhbmdlVGV4dDogaGFuZGxlT2YgPyB1bmRlZmluZWQgOiBwYWNrZWRSYW5nZVRleHQsXG4gICAgICAgICAgcGFja2VkUmFuZ2VOb2RlOiBoYW5kbGVPZiA/IG51bGwgOiAocGFja2VkRGltID8/IG51bGwpLFxuICAgICAgICAgIHVucGFja2VkRGltczogaGFuZGxlT2YgPyBbXSA6IHVucGFja2VkRGltcy5tYXAoKGQpID0+IGQudGV4dCksXG4gICAgICAgICAgaXNQb3J0OiBmYWxzZSxcbiAgICAgICAgICBzY29wZUlkOiBzY29wZT8uaWQgPz8gLTEsXG4gICAgICAgICAgcmFuZ2U6IHRvUmFuZ2UoYXNzaWdubWVudCksXG4gICAgICAgICAgc2VsZWN0aW9uUmFuZ2U6IHNlbGVjdGlvbihuYW1lTm9kZSksXG4gICAgICAgICAgaW5pdGlhbGl6ZXJUZXh0OiB2YWx1ZVRleHQoYXNzaWdubWVudCksXG4gICAgICAgICAgZG9jOiB0aGlzLmRvY0JlZm9yZShub2RlKSxcbiAgICAgICAgICAuLi4ocXVhbGlmaWVycz8ubGVuZ3RoID8geyBxdWFsaWZpZXJzIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGhhbmRsZU9mID8geyBoYW5kbGVPZiB9IDoge30pLFxuICAgICAgICB9LCBoYW5kbGVPZiA/IFwiaGFuZGxlXCIgOiAoY2F0ZWdvcnkgYXMgU3ltYm9sQ2F0ZWdvcnkpKTtcbiAgICAgIH1cbiAgICAgIGlmIChsaXN0KSBicmVhaztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHBhcnNlVHlwZURlY2xhcmF0aW9uKHR5cGVEZWNsOiBOb2RlLCBzY29wZTogTXV0YWJsZVNjb3BlIHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgY29uc3QgbmFtZU5vZGUgPSB0eXBlRGVjbC5jaGlsZEZvckZpZWxkTmFtZShcInR5cGVfbmFtZVwiKTtcbiAgICBpZiAoIW5hbWVOb2RlKSByZXR1cm47XG4gICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChuYW1lTm9kZS5pZCk7XG5cbiAgICBjb25zdCBkYXRhVHlwZU5vZGUgPSBmaW5kQ2hpbGQodHlwZURlY2wsIFwiZGF0YV90eXBlXCIpO1xuICAgIC8vIFRoZSBgZW51bWAga2V5d29yZCBpcyBhbiBhbm9ueW1vdXMgbm9kZSB3aXRoIG5vIGNoaWxkcmVuOyB0aGUgbGl0ZXJhbHNcbiAgICAvLyBhcmUgaXRzIHNpYmxpbmdzIHVuZGVyIGBkYXRhX3R5cGVgLiBTbyBhbiBlbnVtIGlzIGRldGVjdGVkIGJ5IGl0c1xuICAgIC8vIGxpdGVyYWxzLCBub3QgYnkgdGhlIGtleXdvcmQuXG4gICAgY29uc3QgZW51bUxpdGVyYWxzID0gZGF0YVR5cGVOb2RlID8gZmluZENoaWxkcmVuKGRhdGFUeXBlTm9kZSwgXCJlbnVtX25hbWVfZGVjbGFyYXRpb25cIikgOiBbXTtcbiAgICBjb25zdCBwYWNrZWREaW0gPSBkYXRhVHlwZU5vZGVcbiAgICAgID8gZGF0YVR5cGVOb2RlLm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlID09PSBcInBhY2tlZF9kaW1lbnNpb25cIilcbiAgICAgIDogbnVsbDtcblxuICAgIC8vIEEgdHlwZWRlZiBvZiBhIGJhcmUgaWRlbnRpZmllciBpcyBhbiBhbGlhczsgcmVjb3JkIHRoZSBhbGlhc2VkIG5hbWUuXG4gICAgY29uc3QgYWxpYXMgPSBkYXRhVHlwZU5vZGUgJiYgZGF0YVR5cGVOb2RlLm5hbWVkQ2hpbGRDb3VudCA9PT0gMVxuICAgICAgPyBkYXRhVHlwZU5vZGUubmFtZWRDaGlsZCgwKVxuICAgICAgOiBudWxsO1xuXG4gICAgY29uc3QgaXNFbnVtID0gZW51bUxpdGVyYWxzLmxlbmd0aCA+IDA7XG5cbiAgICB0aGlzLmRlY2xhcmUoc2NvcGUsIHtcbiAgICAgIG5hbWU6IG5hbWVOb2RlLnRleHQsXG4gICAgICBjYXRlZ29yeTogXCJ0eXBlZGVmXCIsXG4gICAgICB0eXBlVGV4dDogaXNFbnVtXG4gICAgICAgID8gXCJlbnVtXCJcbiAgICAgICAgOiBzdHJpcFBhY2tlZChhbGlhcz8udGV4dCA/PyBkYXRhVHlwZU5vZGU/LnRleHQsIHBhY2tlZERpbT8udGV4dCkgfHwgXCJ0eXBlZGVmXCIsXG4gICAgICBwYWNrZWRSYW5nZVRleHQ6IGlzRW51bSA/IGlubmVyT2YocGFja2VkRGltID8/IHVuZGVmaW5lZCkgOiB1bmRlZmluZWQsXG4gICAgICBwYWNrZWRSYW5nZU5vZGU6IHBhY2tlZERpbSA/PyBudWxsLFxuICAgICAgdW5wYWNrZWREaW1zOiBbXSxcbiAgICAgIGlzUG9ydDogZmFsc2UsXG4gICAgICBzY29wZUlkOiBzY29wZT8uaWQgPz8gLTEsXG4gICAgICByYW5nZTogdG9SYW5nZSh0eXBlRGVjbCksXG4gICAgICBzZWxlY3Rpb25SYW5nZTogc2VsZWN0aW9uKG5hbWVOb2RlKSxcbiAgICAgIGRvYzogdGhpcy5kb2NCZWZvcmUodHlwZURlY2wpLFxuICAgIH0sIFwidHlwZWRlZlwiKTtcblxuICAgIC8vIEVudW0gbGl0ZXJhbHMgbGl2ZSBpbiB0aGUgZW5jbG9zaW5nIHNjb3BlIGluIFN5c3RlbVZlcmlsb2cuXG4gICAgZm9yIChjb25zdCBtZW1iZXIgb2YgZW51bUxpdGVyYWxzKSB7XG4gICAgICAgIGNvbnN0IGlkZW50ID0gbWVtYmVyLm5hbWVkQ2hpbGQoMCk7XG4gICAgICAgIGlmICghaWRlbnQpIGNvbnRpbnVlO1xuICAgICAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKGlkZW50LmlkKTtcbiAgICAgICAgdGhpcy5kZWNsYXJlKHNjb3BlLCB7XG4gICAgICAgICAgbmFtZTogaWRlbnQudGV4dCxcbiAgICAgICAgICBjYXRlZ29yeTogXCJlbnVtXCIsXG4gICAgICAgICAgdHlwZVRleHQ6IG5hbWVOb2RlLnRleHQsXG4gICAgICAgICAgdW5wYWNrZWREaW1zOiBbXSxcbiAgICAgICAgICBpc1BvcnQ6IGZhbHNlLFxuICAgICAgICAgIHNjb3BlSWQ6IHNjb3BlPy5pZCA/PyAtMSxcbiAgICAgICAgICByYW5nZTogdG9SYW5nZShtZW1iZXIpLFxuICAgICAgICAgIHNlbGVjdGlvblJhbmdlOiBzZWxlY3Rpb24oaWRlbnQpLFxuICAgICAgICB9LCBcImVudW1cIik7XG4gICAgfVxuXG4gICAgLy8gU3RydWN0IGFuZCB1bmlvbiBtZW1iZXJzIGFyZSBmaWVsZHMgb2YgdGhlIHR5cGUsIG5vdCBzaWduYWxzIG9mIHRoZVxuICAgIC8vIHNjb3BlLiBUaGV5IGFyZSByZWNvcmRlZCBzbyBob3ZlcmluZyBvbmUgb2YgdGhlbSB3b3JrcyBhbmQgc28gdGhlXG4gICAgLy8gdW5rbm93bi1pZGVudGlmaWVyIGNoZWNrIGtub3dzIHRoZSBuYW1lIGlzIGRlY2xhcmVkLlxuICAgIGlmIChkYXRhVHlwZU5vZGUpIHRoaXMuZGVjbGFyZVN0cnVjdE1lbWJlcnMoZGF0YVR5cGVOb2RlLCBuYW1lTm9kZS50ZXh0LCBzY29wZSk7XG4gIH1cblxuICAvKipcbiAgICogUmVjb3JkcyB0aGUgZmllbGRzIG9mIGEgYHN0cnVjdGAgLyBgdW5pb25gIHR5cGVkZWYuXG4gICAqXG4gICAqIFRoZXkgYXJlIGF0dGFjaGVkIHRvIHRoZSBzY29wZSB0aGF0IGRlY2xhcmVzIHRoZSB0eXBlLCB3aGljaCBpcyBob3dcbiAgICogYHZhbGlkYCBhbmQgYGRhdGFgIGluIGB0eXBlZGVmIHN0cnVjdCBwYWNrZWQgeyAuLi4gfSBlbnRyeV90O2Agc3RvcCBiZWluZ1xuICAgKiByZXBvcnRlZCBhcyB1bmRlY2xhcmVkLlxuICAgKi9cbiAgcHJpdmF0ZSBkZWNsYXJlU3RydWN0TWVtYmVycyhkYXRhVHlwZTogTm9kZSwgdHlwZU5hbWU6IHN0cmluZywgc2NvcGU6IE11dGFibGVTY29wZSB8IHVuZGVmaW5lZCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgbWVtYmVyIG9mIGZpbmRDaGlsZHJlbihkYXRhVHlwZSwgXCJzdHJ1Y3RfdW5pb25fbWVtYmVyXCIpKSB7XG4gICAgICAvLyBgbG9naWMgWzc6MF0gZGF0YTtgIGlzIGEgYGRhdGFfdHlwZV9vcl92b2lkYCBmb2xsb3dlZCBieSBhIGxpc3Qgb2ZcbiAgICAgIC8vIGRlY2xhcmF0b3JzLCBzbyB0aGUgbmFtZXMgYXJlIG5vdCB0aGUgbWVtYmVyJ3MgZmlyc3QgY2hpbGRyZW4uIEFcbiAgICAgIC8vIHNpbmdsZSBtZW1iZXIgY2FuIGRlY2xhcmUgc2V2ZXJhbDogYGxvZ2ljIHZhbGlkLCBkaXJ0eTtgLlxuICAgICAgY29uc3QgYXNzaWdubWVudHMgPSBmaW5kQ2hpbGQobWVtYmVyLCBcImxpc3Rfb2ZfdmFyaWFibGVfZGVjbF9hc3NpZ25tZW50c1wiKTtcbiAgICAgIGlmICghYXNzaWdubWVudHMpIGNvbnRpbnVlO1xuXG4gICAgICBmb3IgKGNvbnN0IGFzc2lnbm1lbnQgb2YgZmluZENoaWxkcmVuKGFzc2lnbm1lbnRzLCBcInZhcmlhYmxlX2RlY2xfYXNzaWdubWVudFwiKSkge1xuICAgICAgICBjb25zdCBpZGVudCA9IGFzc2lnbm1lbnQubmFtZWRDaGlsZCgwKTtcbiAgICAgICAgaWYgKCFpZGVudCB8fCBpZGVudC50eXBlICE9PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpIGNvbnRpbnVlO1xuXG4gICAgICAgIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQoaWRlbnQuaWQpO1xuICAgICAgICB0aGlzLmRlY2xhcmUoc2NvcGUsIHtcbiAgICAgICAgICBuYW1lOiBpZGVudC50ZXh0LFxuICAgICAgICAgIGNhdGVnb3J5OiBcInZhcmlhYmxlXCIsXG4gICAgICAgICAgdHlwZVRleHQ6IHR5cGVOYW1lLFxuICAgICAgICAgIHVucGFja2VkRGltczogW10sXG4gICAgICAgICAgaXNQb3J0OiBmYWxzZSxcbiAgICAgICAgICBzY29wZUlkOiBzY29wZT8uaWQgPz8gLTEsXG4gICAgICAgICAgcmFuZ2U6IHRvUmFuZ2UobWVtYmVyKSxcbiAgICAgICAgICBzZWxlY3Rpb25SYW5nZTogc2VsZWN0aW9uKGlkZW50KSxcbiAgICAgICAgfSwgXCJ2YXJpYWJsZVwiKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHBhcnNlTmV0RGVjbGFyYXRpb24obm9kZTogTm9kZSwgc2NvcGU6IE11dGFibGVTY29wZSB8IHVuZGVmaW5lZCk6IHZvaWQge1xuICAgIGNvbnN0IG5ldFR5cGVOb2RlID0gZmluZENoaWxkKG5vZGUsIFwibmV0X3R5cGVcIik7XG4gICAgY29uc3QgbmV0VHlwZSA9IG5vZGVUZXh0KG5ldFR5cGVOb2RlKSB8fCBcIndpcmVcIjtcblxuICAgIC8vIGBQYWNrZXQgcGt0O2AgaGFzIG5vIGBuZXRfdHlwZWAgYXQgYWxsOiB0aGUgZ3JhbW1hciBwdXRzIHRoZSBjbGFzcyBuYW1lXG4gICAgLy8gc3RyYWlnaHQgb24gdGhlIGRlY2xhcmF0aW9uLCBhbmQgbm90aGluZyBoZXJlIGtub3dzIHdoYXQgaXQgaXMgdW50aWwgdGhlXG4gICAgLy8gY2F0YWxvZyBzYXlzIGBQYWNrZXRgIGlzIGEgY2xhc3MuXG4gICAgY29uc3QgYmFyZVR5cGVOb2RlID0gbmV0VHlwZU5vZGUgPyBudWxsIDogKG5vZGUubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikgPz8gbnVsbCk7XG4gICAgY29uc3QgY2xhc3NOYW1lID0gYmFyZVR5cGVOb2RlICYmIHRoaXMuY2xhc3NOYW1lcy5oYXMoYmFyZVR5cGVOb2RlLnRleHQpID8gYmFyZVR5cGVOb2RlLnRleHQgOiB1bmRlZmluZWQ7XG4gICAgaWYgKGJhcmVUeXBlTm9kZSkgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZChiYXJlVHlwZU5vZGUuaWQpO1xuXG4gICAgLy8gVGhlIHBhY2tlZCByYW5nZSBpcyBub3QgaW5zaWRlIGBuZXRfdHlwZWA6IHRoZSBncmFtbWFyIHB1dHMgaXQgaW4gYVxuICAgIC8vIHNpYmxpbmcgYGRhdGFfdHlwZV9vcl9pbXBsaWNpdGAsIGFsb25nc2lkZSBhbnkgYHNpZ25lZGAgbW9kaWZpZXIuXG4gICAgY29uc3QgcmFuZ2VIb2xkZXIgPSBmaW5kQ2hpbGQobm9kZSwgXCJkYXRhX3R5cGVfb3JfaW1wbGljaXRcIik7XG4gICAgY29uc3QgcGFja2VkRGltID0gcmFuZ2VIb2xkZXIgPyBmaW5kRGVzY2VuZGFudChyYW5nZUhvbGRlciwgXCJwYWNrZWRfZGltZW5zaW9uXCIsIDIpIDogbnVsbDtcbiAgICBjb25zdCBmcm9tVGV4dCA9IHJhbmdlSG9sZGVyICYmICFwYWNrZWREaW0gPyBzcGxpdFBhY2tlZFRleHQobm9kZVRleHQocmFuZ2VIb2xkZXIpKSA6IG51bGw7XG5cbiAgICBjb25zdCBtb2RpZmllciA9IHBhY2tlZERpbVxuICAgICAgPyBzdHJpcFBhY2tlZChub2RlVGV4dChyYW5nZUhvbGRlciksIHBhY2tlZERpbS50ZXh0KVxuICAgICAgOiAoZnJvbVRleHQ/LnR5cGUgPz8gXCJcIik7XG4gICAgY29uc3QgcGFja2VkUmFuZ2VUZXh0ID0gaW5uZXJPZihwYWNrZWREaW0gPz8gdW5kZWZpbmVkKSA/PyBmcm9tVGV4dD8ucmFuZ2U7XG5cbiAgICAvLyBUaGUgbm9kZSB0eXBlIGlzIGBkcml2ZV9zdHJlbmd0aGAsIG5vdCBgbmV0X3N0cmVuZ3RoYC5cbiAgICBjb25zdCBzdHJlbmd0aE5vZGUgPSBmaW5kQ2hpbGQobm9kZSwgXCJkcml2ZV9zdHJlbmd0aFwiKTtcbiAgICBjb25zdCB0eXBlVGV4dCA9IGNsYXNzTmFtZSA/PyBbbmV0VHlwZSwgbW9kaWZpZXIsIG5vZGVUZXh0KHN0cmVuZ3RoTm9kZSldLmZpbHRlcihCb29sZWFuKS5qb2luKFwiIFwiKTtcblxuICAgIGNvbnN0IGxpc3QgPSBmaW5kQ2hpbGQobm9kZSwgXCJsaXN0X29mX25ldF9kZWNsX2Fzc2lnbm1lbnRzXCIpO1xuICAgIGlmICghbGlzdCkgcmV0dXJuO1xuXG4gICAgZm9yIChjb25zdCBhc3NpZ25tZW50IG9mIGxpc3QubmFtZWRDaGlsZHJlbikge1xuICAgICAgaWYgKGFzc2lnbm1lbnQudHlwZSAhPT0gXCJuZXRfZGVjbF9hc3NpZ25tZW50XCIpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgbmFtZU5vZGUgPSBhc3NpZ25tZW50Lm5hbWVkQ2hpbGQoMCk7XG4gICAgICBpZiAoIW5hbWVOb2RlIHx8IG5hbWVOb2RlLnR5cGUgIT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikgY29udGludWU7XG4gICAgICB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWVOb2RlLmlkKTtcblxuICAgICAgdGhpcy5kZWNsYXJlKHNjb3BlLCB7XG4gICAgICAgIG5hbWU6IG5hbWVOb2RlLnRleHQsXG4gICAgICAgIGNhdGVnb3J5OiBjbGFzc05hbWUgPyBcImhhbmRsZVwiIDogXCJuZXRcIixcbiAgICAgICAgdHlwZVRleHQsXG4gICAgICAgIC8vIEEgaGFuZGxlIGhhcyBubyB3aWR0aCBvZiBpdHMgb3duOyBpdHMgbWVtYmVycyBjYXJyeSB0aGUgdmFsdWVzLlxuICAgICAgICBwYWNrZWRSYW5nZVRleHQ6IGNsYXNzTmFtZSA/IHVuZGVmaW5lZCA6IHBhY2tlZFJhbmdlVGV4dCxcbiAgICAgICAgcGFja2VkUmFuZ2VOb2RlOiBjbGFzc05hbWUgPyBudWxsIDogKHBhY2tlZERpbSA/PyBudWxsKSxcbiAgICAgICAgdW5wYWNrZWREaW1zOiBjbGFzc05hbWUgPyBbXSA6IGZpbmRDaGlsZHJlbihhc3NpZ25tZW50LCBcInVucGFja2VkX2RpbWVuc2lvblwiKS5tYXAoKGQpID0+IGQudGV4dCksXG4gICAgICAgIGlzUG9ydDogZmFsc2UsXG4gICAgICAgIHNjb3BlSWQ6IHNjb3BlPy5pZCA/PyAtMSxcbiAgICAgICAgcmFuZ2U6IHRvUmFuZ2UoYXNzaWdubWVudCksXG4gICAgICAgIHNlbGVjdGlvblJhbmdlOiBzZWxlY3Rpb24obmFtZU5vZGUpLFxuICAgICAgICBpbml0aWFsaXplclRleHQ6IHZhbHVlVGV4dChhc3NpZ25tZW50KSxcbiAgICAgICAgZG9jOiB0aGlzLmRvY0JlZm9yZShub2RlKSxcbiAgICAgICAgLi4uKGNsYXNzTmFtZSA/IHsgaGFuZGxlT2Y6IGNsYXNzTmFtZSB9IDoge30pLFxuICAgICAgfSwgY2xhc3NOYW1lID8gXCJoYW5kbGVcIiA6IFwibmV0XCIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGFyc2VJbnN0YW50aWF0aW9uKG5vZGU6IE5vZGUsIHNjb3BlOiBNdXRhYmxlU2NvcGUgfCB1bmRlZmluZWQpOiBIZGxJbnN0YW5jZSB8IG51bGwge1xuICAgIGNvbnN0IHR5cGVOb2RlID0gbm9kZS5jaGlsZEZvckZpZWxkTmFtZShcImluc3RhbmNlX3R5cGVcIik7XG4gICAgaWYgKCF0eXBlTm9kZSkgcmV0dXJuIG51bGw7XG4gICAgdGhpcy5kZWNsYXJhdGlvbk5hbWVzLmFkZCh0eXBlTm9kZS5pZCk7XG5cbiAgICBjb25zdCBoaWVySW5zdGFuY2UgPSBub2RlLm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlID09PSBcImhpZXJhcmNoaWNhbF9pbnN0YW5jZVwiKTtcbiAgICBjb25zdCBuYW1lT2ZJbnN0YW5jZSA9IGhpZXJJbnN0YW5jZVxuICAgICAgPyBmaW5kQ2hpbGQoaGllckluc3RhbmNlLCBcIm5hbWVfb2ZfaW5zdGFuY2VcIik/Lm5hbWVkQ2hpbGQoMClcbiAgICAgIDogbnVsbDtcbiAgICBpZiAobmFtZU9mSW5zdGFuY2UpIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQobmFtZU9mSW5zdGFuY2UuaWQpO1xuXG4gICAgY29uc3QgcGFyYW1ldGVyT3ZlcnJpZGVzOiBQb3J0QmluZGluZ1tdID0gW107XG4gICAgY29uc3QgcHZhID0gbm9kZS5uYW1lZENoaWxkcmVuLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gXCJwYXJhbWV0ZXJfdmFsdWVfYXNzaWdubWVudFwiKTtcbiAgICBpZiAocHZhKSB7XG4gICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgcHZhLm5hbWVkQ2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBhc3NpZ25tZW50IG9mIGl0ZW0ubmFtZWRDaGlsZHJlbikge1xuICAgICAgICAgIGlmIChhc3NpZ25tZW50LnR5cGUgPT09IFwibmFtZWRfcGFyYW1ldGVyX2Fzc2lnbm1lbnRcIikge1xuICAgICAgICAgICAgY29uc3QgbmFtZUlkID0gYXNzaWdubWVudC5uYW1lZENoaWxkcmVuLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKTtcbiAgICAgICAgICAgIGlmIChuYW1lSWQpIHRoaXMuZGVjbGFyYXRpb25OYW1lcy5hZGQobmFtZUlkLmlkKTtcbiAgICAgICAgICAgIHBhcmFtZXRlck92ZXJyaWRlcy5wdXNoKHtcbiAgICAgICAgICAgICAgcG9ydE5hbWU6IG5hbWVJZD8udGV4dCxcbiAgICAgICAgICAgICAgdmFsdWVUZXh0OiB2YWx1ZVRleHQoYXNzaWdubWVudCksXG4gICAgICAgICAgICAgIHJhbmdlOiB0b1JhbmdlKGFzc2lnbm1lbnQpLFxuICAgICAgICAgICAgICBuYW1lUmFuZ2U6IG5hbWVJZCA/IHNlbGVjdGlvbihuYW1lSWQpIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhcmFtZXRlck92ZXJyaWRlcy5wdXNoKHtcbiAgICAgICAgICAgICAgdmFsdWVUZXh0OiB2YWx1ZVRleHQoYXNzaWdubWVudCksXG4gICAgICAgICAgICAgIHJhbmdlOiB0b1JhbmdlKGFzc2lnbm1lbnQpLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgY29ubmVjdGlvbnM6IFBvcnRCaW5kaW5nW10gPSBbXTtcbiAgICBjb25zdCBwb3J0TGlzdCA9IGhpZXJJbnN0YW5jZVxuICAgICAgPyBoaWVySW5zdGFuY2UubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwibGlzdF9vZl9wb3J0X2Nvbm5lY3Rpb25zXCIpXG4gICAgICA6IG51bGw7XG4gICAgaWYgKHBvcnRMaXN0KSB7XG4gICAgICBmb3IgKGNvbnN0IGNvbm4gb2YgcG9ydExpc3QubmFtZWRDaGlsZHJlbikge1xuICAgICAgICBpZiAoY29ubi50eXBlID09PSBcIm5hbWVkX3BvcnRfY29ubmVjdGlvblwiKSB7XG4gICAgICAgICAgY29uc3QgbmFtZUlkID0gY29ubi5uYW1lZENoaWxkcmVuLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKTtcbiAgICAgICAgICBpZiAobmFtZUlkKSB0aGlzLmRlY2xhcmF0aW9uTmFtZXMuYWRkKG5hbWVJZC5pZCk7XG4gICAgICAgICAgY29ubmVjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICBwb3J0TmFtZTogbmFtZUlkPy50ZXh0LFxuICAgICAgICAgICAgdmFsdWVUZXh0OiB2YWx1ZVRleHQoY29ubiksXG4gICAgICAgICAgICByYW5nZTogdG9SYW5nZShjb25uKSxcbiAgICAgICAgICAgIG5hbWVSYW5nZTogbmFtZUlkID8gc2VsZWN0aW9uKG5hbWVJZCkgOiB1bmRlZmluZWQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoY29ubi50eXBlID09PSBcIm9yZGVyZWRfcG9ydF9jb25uZWN0aW9uXCIpIHtcbiAgICAgICAgICBjb25uZWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgIHZhbHVlVGV4dDogY29ubi5uYW1lZENoaWxkcmVuLm1hcCgoYykgPT4gYy50ZXh0KS5qb2luKFwiIFwiKS50cmltKCksXG4gICAgICAgICAgICByYW5nZTogdG9SYW5nZShjb25uKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChjb25uLnR5cGUgPT09IFwid2lsZGNhcmRfcG9ydF9jb25uZWN0aW9uXCIpIHtcbiAgICAgICAgICBjb25uZWN0aW9ucy5wdXNoKHsgdmFsdWVUZXh0OiBcIipcIiwgcmFuZ2U6IHRvUmFuZ2UoY29ubikgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZU5hbWU6IHR5cGVOb2RlLnRleHQsXG4gICAgICBpbnN0YW5jZU5hbWU6IG5hbWVPZkluc3RhbmNlPy50ZXh0ID8/IFwiXCIsXG4gICAgICByYW5nZTogdG9SYW5nZShub2RlKSxcbiAgICAgIHR5cGVSYW5nZTogc2VsZWN0aW9uKHR5cGVOb2RlKSxcbiAgICAgIHBhcmFtZXRlck92ZXJyaWRlcyxcbiAgICAgIGNvbm5lY3Rpb25zLFxuICAgIH07XG4gIH1cblxuICAvKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICpcbiAgICogQ29uc3RhbnQgZm9sZGluZ1xuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbiAgLyoqXG4gICAqIFNlZWRzIGBwYXJhbVZhbHVlc2Agd2l0aCB0aGUgcGFyYW1ldGVycyBhIHNjb3BlIGNhbiBzZWUgZnJvbSBvdGhlciBmaWxlcy5cbiAgICpcbiAgICogVHdvIHdheXMgYSBzY29wZSByZWFjaGVzIGFub3RoZXIgZmlsZSwgYW5kIGJvdGggbmVlZCB0aGUgc2FtZSBudW1iZXJzOlxuICAgKlxuICAgKiAgLSBgaW1wb3J0IHBrZzo6KmAsIHdoaWNoIGJyaW5ncyBpbiBldmVyeXRoaW5nIHRoZSBwYWNrYWdlIGRlY2xhcmVzIGFuZFxuICAgKiAgICBldmVyeXRoaW5nIHRoZSBwYWNrYWdlIGl0c2VsZiBpbXBvcnRlZDtcbiAgICogIC0gYSBxdWFsaWZpZWQgcmVmZXJlbmNlLCBgbG9naWMgW3BrZzo6V0lEVEgtMTowXWAsIHdoaWNoIG5hbWVzIHRoZSBwYWNrYWdlXG4gICAqICAgIGF0IGV2ZXJ5IHVzZSBhbmQgbmVlZHMgbm8gaW1wb3J0IGF0IGFsbC5cbiAgICpcbiAgICogVGhlIHF1YWxpZmllZCBmb3JtIGlzIGZvdW5kIGJ5IHJlYWRpbmcgdGhlIHNjb3BlJ3Mgb3duIGRlY2xhcmF0aW9ucyByYXRoZXJcbiAgICogdGhhbiB0aGUgdHJlZTogdGhlIHBhY2thZ2UgbmFtZSBpcyBhbHJlYWR5IHNpdHRpbmcgaW4gdGhlIHJhbmdlIHRleHQsIGFuZFxuICAgKiBzY2FubmluZyBmb3IgaXQgY29zdHMgbm90aGluZyBjb21wYXJlZCB3aXRoIHJlc29sdmluZyB0aGUgZXhwcmVzc2lvbi5cbiAgICovXG4gIHByaXZhdGUgc2VlZEltcG9ydGVkVmFsdWVzKHNjb3BlOiBNdXRhYmxlU2NvcGUpOiBNYXA8c3RyaW5nLCBudW1iZXI+IHtcbiAgICBjb25zdCByZXNvbHZlID0gdGhpcy5pbXBvcnRlZFBhcmFtZXRlclZhbHVlcztcbiAgICBjb25zdCBvdXQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGlmICghcmVzb2x2ZSkgcmV0dXJuIG91dDtcblxuICAgIGNvbnN0IHBhY2thZ2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHNjb3BlLmltcG9ydHMgPz8gW10pIHtcbiAgICAgIGlmIChlbnRyeS53aWxkY2FyZCkgcGFja2FnZXMuYWRkKGVudHJ5LnBhY2thZ2VOYW1lKTtcbiAgICB9XG5cbiAgICAvLyBgW3BrZzo6V0lEVEgtMTowXWAgYW5kIGBwa2c6OnN0YXRlX2VgIGJvdGggbmFtZSB0aGUgcGFja2FnZSBpbiB0ZXh0LlxuICAgIGZvciAoY29uc3QgZGVjbGFyYXRpb24gb2YgWy4uLnNjb3BlLnBvcnRzLCAuLi5zY29wZS5zeW1ib2xzLCAuLi5zY29wZS5wYXJhbWV0ZXJzXSkge1xuICAgICAgZm9yIChjb25zdCB0ZXh0IG9mIFtkZWNsYXJhdGlvbi5wYWNrZWRSYW5nZVRleHQsIGRlY2xhcmF0aW9uLnR5cGVUZXh0XSkge1xuICAgICAgICBpZiAoIXRleHQpIGNvbnRpbnVlO1xuICAgICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIHRleHQubWF0Y2hBbGwoL1xcYihbQS1aYS16X11cXHcqKTo6L2cpKSB7XG4gICAgICAgICAgcGFja2FnZXMuYWRkKG1hdGNoWzFdISk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgcGFja2FnZXMpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIHJlc29sdmUobmFtZSkgPz8gW10pIHtcbiAgICAgICAgaWYgKCFvdXQuaGFzKGtleSkpIG91dC5zZXQoa2V5LCB2YWx1ZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVTY29wZShzY29wZTogTXV0YWJsZVNjb3BlKTogdm9pZCB7XG4gICAgY29uc3QgcGFyYW1WYWx1ZXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuXG4gICAgLy8gUGFyYW1ldGVycyBicm91Z2h0IGluIGJ5IGBpbXBvcnQgcGtnOjoqYCBhcmUgY29uc3RhbnQtZm9sZGFibGUgZXhhY3RseVxuICAgIC8vIGxpa2UgbG9jYWwgb25lcy4gV2l0aG91dCBzZWVkaW5nIHRoZW0gaGVyZSwgYSBwb3J0IHdyaXR0ZW5cbiAgICAvLyBgb3V0cHV0IGxvZ2ljIFtDX1BLVF9EQVRfVy0xOjBdIHBgIHN0YXlzIHdpZHRobGVzcyAtLSB0aGUgbmFtZSByZXNvbHZlcyxcbiAgICAvLyBidXQgdGhlIGJpdCBjb3VudCB0aGF0IGNvbXBsZXRpb24gYW5kIGhvdmVyIHNob3cgbmV2ZXIgYXBwZWFycywgd2hpY2hcbiAgICAvLyByZWFkcyBhcyBcInRoZSBwYWNrYWdlIHBhcmFtZXRlciB3YXMgbm90IHJlY29nbmlzZWRcIi5cbiAgICAvL1xuICAgIC8vIFRoZXkgZ28gaW4gYSBzZXBhcmF0ZSBtYXAsIGNvbnN1bHRlZCBvbmx5IGFzIGEgZmFsbGJhY2ssIHNvIGEgbG9jYWxcbiAgICAvLyBkZWNsYXJhdGlvbiBvZiB0aGUgc2FtZSBuYW1lIHNoYWRvd3MgdGhlIGltcG9ydGVkIG9uZSB0aGUgd2F5IFNWIHNheXMgaXRcbiAgICAvLyBzaG91bGQuXG4gICAgY29uc3QgaW1wb3J0ZWQgPSB0aGlzLnNlZWRJbXBvcnRlZFZhbHVlcyhzY29wZSk7XG5cbiAgICAvLyBQYXJhbWV0ZXJzIG1heSByZWZlcmVuY2UgZWFybGllciBwYXJhbWV0ZXJzLCBzbyBpdGVyYXRlIHRvIGEgZml4ZWQgcG9pbnQuXG4gICAgY29uc3QgcGVuZGluZyA9IFsuLi5zY29wZS5wYXJhbWV0ZXJzLCAuLi5zY29wZS5zeW1ib2xzLmZpbHRlcigocykgPT4gcy5jYXRlZ29yeSA9PT0gXCJsb2NhbHBhcmFtXCIgfHwgcy5jYXRlZ29yeSA9PT0gXCJwYXJhbWV0ZXJcIildO1xuICAgIGZvciAobGV0IHBhc3MgPSAwOyBwYXNzIDwgODsgcGFzcysrKSB7XG4gICAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuICAgICAgZm9yIChjb25zdCBzeW0gb2YgcGVuZGluZykge1xuICAgICAgICBpZiAocGFyYW1WYWx1ZXMuaGFzKHN5bS5uYW1lKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdGhpcy5ldmFsdWF0ZVN5bWJvbFZhbHVlKHN5bSwgcGFyYW1WYWx1ZXMsIGltcG9ydGVkKTtcbiAgICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBwYXJhbVZhbHVlcy5zZXQoc3ltLm5hbWUsIHZhbHVlKTtcbiAgICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKCFjaGFuZ2VkKSBicmVhaztcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2xXaWR0aHMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGVudjogRXZhbEVudiA9IHtcbiAgICAgIC8vIEEgbG9jYWwgZGVjbGFyYXRpb24gc2hhZG93cyBhbiBpbXBvcnRlZCBvbmUgb2YgdGhlIHNhbWUgbmFtZSwgc28gdGhlXG4gICAgICAvLyBsb2NhbCBtYXAgaXMgY29uc3VsdGVkIGZpcnN0IGFuZCB0aGUgaW1wb3J0ZWQgb25lIG9ubHkgZmlsbHMgdGhlIGdhcHMuXG4gICAgICBsb29rdXA6IChuYW1lKSA9PiBwYXJhbVZhbHVlcy5nZXQobmFtZSkgPz8gaW1wb3J0ZWQuZ2V0KG5hbWUpLFxuICAgICAgc3ltYm9sV2lkdGg6IChuYW1lKSA9PiBzeW1ib2xXaWR0aHMuZ2V0KG5hbWUpLFxuICAgIH07XG5cbiAgICBjb25zdCByZXNvbHZlID0gKHN5bTogSGRsU3ltYm9sKTogdm9pZCA9PiB7XG4gICAgICBpZiAoc3ltLnJlc29sdmVkVmFsdWUgPT09IHVuZGVmaW5lZCAmJiBwYXJhbVZhbHVlcy5oYXMoc3ltLm5hbWUpKSB7XG4gICAgICAgIChzeW0gYXMgeyByZXNvbHZlZFZhbHVlPzogbnVtYmVyIH0pLnJlc29sdmVkVmFsdWUgPSBwYXJhbVZhbHVlcy5nZXQoc3ltLm5hbWUpO1xuICAgICAgfVxuXG4gICAgICAvLyBBIG1ldGhvZCwgYSB0eXBlIGFuZCBhbiBvYmplY3QgaGFuZGxlIGhhdmUgbm8gd2lkdGggb2YgdGhlaXIgb3duLiBBXG4gICAgICAvLyBmdW5jdGlvbidzIGBiaXRgIGlzIGl0cyAqcmV0dXJuKiB0eXBlLCBub3QgdGhlIHdpZHRoIG9mIHRoZSBtZXRob2QsIGFuZFxuICAgICAgLy8gc2hvd2luZyBgMSBiaXRgIG5leHQgdG8gYSBtZXRob2QgaXMgc2ltcGx5IHdyb25nLlxuICAgICAgaWYgKFdJRFRITEVTUy5oYXMoc3ltLmNhdGVnb3J5KSkgcmV0dXJuO1xuXG4gICAgICBjb25zdCByYW5nZU5vZGUgPSAoc3ltIGFzIFBlbmRpbmdTeW1ib2wpLnBhY2tlZFJhbmdlTm9kZTtcblxuICAgICAgbGV0IHBhY2tlZFdpZHRoOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAocmFuZ2VOb2RlKSBwYWNrZWRXaWR0aCA9IHJhbmdlV2lkdGgocmFuZ2VOb2RlLCBlbnYpO1xuICAgICAgaWYgKHBhY2tlZFdpZHRoID09PSB1bmRlZmluZWQgJiYgc3ltLnBhY2tlZFJhbmdlVGV4dCkgcGFja2VkV2lkdGggPSB3aWR0aE9mVGV4dChzeW0ucGFja2VkUmFuZ2VUZXh0LCBlbnYpO1xuICAgICAgaWYgKHR5cGVvZiBwYWNrZWRXaWR0aCAhPT0gXCJudW1iZXJcIikgcGFja2VkV2lkdGggPSB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIEEgdmVjdG9yIHdpdGggbm8gZGVjbGFyZWQgcmFuZ2UgaXMgb25lIGJpdCB3aWRlLCBhbmQgdGhhdCBpcyBhIGZhY3RcbiAgICAgIC8vIHJhdGhlciB0aGFuIGEgZ3Vlc3MsIHNvIGl0IGlzIHN0YXRlZCBleHBsaWNpdGx5IGluc3RlYWQgb2YgYmVpbmcgbGVmdFxuICAgICAgLy8gYmxhbmsuIE9ubHkgd2hlbiBubyByYW5nZSB3YXMgZGVjbGFyZWQgYXQgYWxsOiBhbiB1bnJlc29sdmVkIHJhbmdlXG4gICAgICAvLyBtZWFucyB0aGUgd2lkdGggaXMgZ2VudWluZWx5IHVua25vd24gYW5kIG11c3Qgc3RheSB1bmtub3duLlxuICAgICAgY29uc3QgZGVjbGFyZXNSYW5nZSA9IHJhbmdlTm9kZSAhPSBudWxsIHx8IHN5bS5wYWNrZWRSYW5nZVRleHQgIT09IHVuZGVmaW5lZDtcbiAgICAgIGlmIChwYWNrZWRXaWR0aCA9PT0gdW5kZWZpbmVkICYmICFkZWNsYXJlc1JhbmdlKSB7XG4gICAgICAgIHBhY2tlZFdpZHRoID0gaW1wbGljaXRXaWR0aChzeW0udHlwZVRleHQpO1xuICAgICAgfVxuXG4gICAgICBpZiAocGFja2VkV2lkdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAoc3ltIGFzIHsgcGFja2VkV2lkdGg/OiBudW1iZXIgfSkucGFja2VkV2lkdGggPSBwYWNrZWRXaWR0aDtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNvdW50ID0gdW5wYWNrZWRDb3VudChzeW0udW5wYWNrZWREaW1zLCBlbnYpO1xuICAgICAgaWYgKGNvdW50ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgKHN5bSBhcyB7IHVucGFja2VkQ291bnQ/OiBudW1iZXIgfSkudW5wYWNrZWRDb3VudCA9IGNvdW50O1xuICAgICAgfVxuICAgICAgaWYgKHBhY2tlZFdpZHRoICE9PSB1bmRlZmluZWQpIHN5bWJvbFdpZHRocy5zZXQoc3ltLm5hbWUsIHBhY2tlZFdpZHRoKTtcbiAgICB9O1xuXG4gICAgLy8gVHdvIHBhc3NlcyBzbyBzaWduYWxzIGNhbiByZWZlcmVuY2UgZWFjaCBvdGhlcidzIHdpZHRocyB2aWEgZXhwcmVzc2lvbnMuXG4gICAgZm9yIChsZXQgcGFzcyA9IDA7IHBhc3MgPCAzOyBwYXNzKyspIHtcbiAgICAgIGZvciAoY29uc3Qgc3ltIG9mIHNjb3BlLnBvcnRzKSByZXNvbHZlKHN5bSk7XG4gICAgICBmb3IgKGNvbnN0IHN5bSBvZiBzY29wZS5zeW1ib2xzKSByZXNvbHZlKHN5bSk7XG4gICAgfVxuXG4gICAgLy8gU3RvcmUgYmFjayB0aGUgZm9sZGVkIHBhcmFtZXRlciB2YWx1ZXMuXG4gICAgZm9yIChjb25zdCBzeW0gb2Ygc2NvcGUucGFyYW1ldGVycykge1xuICAgICAgY29uc3QgdmFsdWUgPSBwYXJhbVZhbHVlcy5nZXQoc3ltLm5hbWUpO1xuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIChzeW0gYXMgeyByZXNvbHZlZFZhbHVlPzogbnVtYmVyIH0pLnJlc29sdmVkVmFsdWUgPSB2YWx1ZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGV2YWx1YXRlU3ltYm9sVmFsdWUoXG4gICAgc3ltOiBIZGxTeW1ib2wsXG4gICAgcGFyYW1zOiBNYXA8c3RyaW5nLCBudW1iZXI+LFxuICAgIGltcG9ydGVkOiBNYXA8c3RyaW5nLCBudW1iZXI+LFxuICApOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICAgIC8vIFBhcmFtZXRlciBkZWZhdWx0cyBhcmUga2VwdCBhcyB0ZXh0OyBmb2xkIHRoZW0gYWdhaW5zdCB0aGUgcGFyYW1ldGVyc1xuICAgIC8vIHJlc29sdmVkIHNvIGZhciwgcmVwZWF0aW5nIHRoZSBwYXNzIHVudGlsIHRoZSBzZXQgc3RvcHMgZ3Jvd2luZy4gQSBsb2NhbFxuICAgIC8vIHBhcmFtZXRlciBtYXkgd2VsbCBiZSB3cml0dGVuIGluIHRlcm1zIG9mIGFuIGltcG9ydGVkIG9uZS5cbiAgICByZXR1cm4gZXZhbHVhdGVUZXh0KHN5bS5pbml0aWFsaXplclRleHQgPz8gXCJcIiwge1xuICAgICAgbG9va3VwOiAobmFtZSkgPT4gcGFyYW1zLmdldChuYW1lKSA/PyBpbXBvcnRlZC5nZXQobmFtZSksXG4gICAgICBzeW1ib2xXaWR0aDogKCkgPT4gdW5kZWZpbmVkLFxuICAgIH0pO1xuICB9XG5cbiAgLyogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqXG4gICAqIEhlbHBlcnNcbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4gIHByaXZhdGUgZGVjbGFyZShzY29wZTogTXV0YWJsZVNjb3BlIHwgdW5kZWZpbmVkLCBzeW06IFBlbmRpbmdTeW1ib2wsIGNhdGVnb3J5OiBTeW1ib2xDYXRlZ29yeSk6IHZvaWQge1xuICAgIGNvbnN0IGZ1bGw6IFBlbmRpbmdTeW1ib2wgPSB7IC4uLnN5bSwgY2F0ZWdvcnkgfTtcbiAgICAvLyBObyBzY29wZSBtZWFucyB0aGUgZGVjbGFyYXRpb24gYmVsb25ncyB0byB0aGUgY29tcGlsYXRpb24gdW5pdCAtLSBhIGhlYWRlclxuICAgIC8vIGFib3ZlIGl0cyBmaXJzdCBtb2R1bGUsIG9yIGEgYHR5cGVkZWZgIHdyaXR0ZW4gYmVmb3JlIGFueSBkZXNpZ24gdW5pdCBhdFxuICAgIC8vIGFsbC4gRHJvcHBpbmcgaXQgaXMgd2hhdCBtYWRlIGV2ZXJ5IHVzZSBvZiBhbiBpbmNsdWRlZCB0eXBlIHVua25vd24uXG4gICAgaWYgKCFzY29wZSkge1xuICAgICAgdGhpcy51bml0U3ltYm9scy5wdXNoKGZ1bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoY2F0ZWdvcnkgPT09IFwicGFyYW1ldGVyXCIgfHwgY2F0ZWdvcnkgPT09IFwibG9jYWxwYXJhbVwiKSB7XG4gICAgICBzY29wZS5wYXJhbWV0ZXJzLnB1c2goZnVsbCBhcyBIZGxTeW1ib2wpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzY29wZS5zeW1ib2xzLnB1c2goZnVsbCBhcyBIZGxTeW1ib2wpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBMZWFkaW5nIGNvbW1lbnQgYmxvY2sgaW1tZWRpYXRlbHkgYWJvdmUgYG5vZGVgLCBpZiBhbnkuICovXG4gIHByaXZhdGUgZG9jQmVmb3JlKG5vZGU6IE5vZGUpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHJvdyA9IG5vZGUuc3RhcnRQb3NpdGlvbi5yb3cgLSAxO1xuICAgIGlmIChyb3cgPCAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSByb3c7IGkgPj0gMCAmJiBsaW5lcy5sZW5ndGggPCAxMjsgaS0tKSB7XG4gICAgICBjb25zdCBsaW5lID0gdGhpcy5saW5lc1tpXSA/PyBcIlwiO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgaWYgKHRyaW1tZWQgPT09IFwiXCIpIHtcbiAgICAgICAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGFsbG93IG9uZSBibGFuayBsaW5lIGJlZm9yZSB0aGUgZG9jIGJsb2NrXG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi8vXCIpKSBsaW5lcy51bnNoaWZ0KHRyaW1tZWQucmVwbGFjZSgvXlxcL1xcL1xccz8vLCBcIlwiKSk7XG4gICAgICBlbHNlIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIvKlwiKSB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoXCIqXCIpKSBsaW5lcy51bnNoaWZ0KHRyaW1tZWQucmVwbGFjZSgvXlxcL1xcKisvLCBcIlwiKS5yZXBsYWNlKC9cXCorXFwvJC8sIFwiXCIpKTtcbiAgICAgIGVsc2UgYnJlYWs7XG4gICAgfVxuICAgIGNvbnN0IGRvYyA9IGxpbmVzLmpvaW4oXCJcXG5cIikudHJpbSgpO1xuICAgIHJldHVybiBkb2MubGVuZ3RoID4gMCA/IGRvYyA6IHVuZGVmaW5lZDtcbiAgfVxufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogRnJlZSBoZWxwZXJzXG4gKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLyoqXG4gKiBXaWR0aHMgaW1wbGllZCBieSBhIGJhc2UgdHlwZSB3aGVuIHRoZSBkZWNsYXJhdGlvbiBjYXJyaWVzIG5vIHBhY2tlZCByYW5nZS5cbiAqXG4gKiBBIHZlY3RvciBvciBuZXQgd2l0aCBubyByYW5nZSBpcyBvbmUgYml0LCBhbmQgdGhlIGludGVnZXIgZmFtaWx5IGhhcyBhXG4gKiBmaXhlZCB3aWR0aCBkZWZpbmVkIGJ5IHRoZSBsYW5ndWFnZS4gVHlwZXMgdGhhdCBhcmUgbm90IGxpc3RlZCBoZXJlIC0tXG4gKiB1c2VyIHR5cGVkZWZzLCBjbGFzc2VzLCBgcmVhbGAgLS0gc3RheSB1bmtub3duIHJhdGhlciB0aGFuIGJlaW5nIGd1ZXNzZWQuXG4gKi9cbmNvbnN0IElNUExJQ0lUX1dJRFRIUzogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHtcbiAgYml0OiAxLFxuICBsb2dpYzogMSxcbiAgcmVnOiAxLFxuICB3aXJlOiAxLFxuICB1d2lyZTogMSxcbiAgdHJpOiAxLFxuICB0cmkwOiAxLFxuICB0cmkxOiAxLFxuICB0cmlhbmQ6IDEsXG4gIHRyaW9yOiAxLFxuICB0cmlyZWc6IDEsXG4gIHdhbmQ6IDEsXG4gIHdvcjogMSxcbiAgc3VwcGx5MDogMSxcbiAgc3VwcGx5MTogMSxcbiAgYnl0ZTogOCxcbiAgc2hvcnRpbnQ6IDE2LFxuICBpbnQ6IDMyLFxuICBpbnRlZ2VyOiAzMixcbiAgbG9uZ2ludDogNjQsXG4gIHRpbWU6IDY0LFxufTtcblxuLyoqIFdpZHRoIGltcGxpZWQgYnkgYHR5cGVUZXh0YCBhbG9uZSwgb3IgdW5kZWZpbmVkIHdoZW4gaXQgY2Fubm90IGJlIGtub3duLiAqL1xuZnVuY3Rpb24gaW1wbGljaXRXaWR0aCh0eXBlVGV4dDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgLy8gQSBkZWNsYXJhdGlvbiB3aXRoIG5vIHR5cGUgYXQgYWxsIGlzIG9uZSBiaXQgd2lkZTogaW4gVmVyaWxvZy0xOTk1IGFuXG4gIC8vIGBpbnB1dCBiO2AgaW4gdGhlIGJvZHkgaXMgaW1wbGljaXRseSBhIHNjYWxhciB3aXJlLiBTYXlpbmcgbm90aGluZyB0aGVyZVxuICAvLyB3b3VsZCBsZWF2ZSBhIHBsYWluIGlucHV0IHBvcnQgd2l0aCBubyB3aWR0aCBhdCBhbGwsIHdoaWNoIHJlYWRzIGFzIFwibm90XG4gIC8vIHVuZGVyc3Rvb2RcIiByYXRoZXIgdGhhbiBcIm9uZSBiaXRcIi5cbiAgaWYgKCF0eXBlVGV4dCB8fCAhdHlwZVRleHQudHJpbSgpKSByZXR1cm4gMTtcbiAgLy8gYHdpcmUgc2lnbmVkYCwgYHJlZ2AsIGB3aXJlIChzdHJvbmcwLCB3ZWFrMSlgIGFsbCBzdGFydCB3aXRoIHRoZSBiYXNlIHR5cGUuXG4gIGNvbnN0IGJhc2UgPSB0eXBlVGV4dC50cmltKCkuc3BsaXQoL1tcXHMoXS8pWzBdIS50b0xvd2VyQ2FzZSgpO1xuICAvLyBBbiBvd24tcHJvcGVydHkgY2hlY2ssIG5vdCBhIHBsYWluIGluZGV4OiBhIGJhc2UgdHlwZSBuYW1lZCBgY29uc3RydWN0b3JgXG4gIC8vIG9yIGB0b1N0cmluZ2Agd291bGQgb3RoZXJ3aXNlIHBpY2sgdXAgdGhlIGluaGVyaXRlZCBtZW1iZXIgYW5kIGJlIHR5cGVkIGFzXG4gIC8vIGEgZnVuY3Rpb24gcmF0aGVyIHRoYW4gYSB3aWR0aC5cbiAgcmV0dXJuIE9iamVjdC5oYXNPd24oSU1QTElDSVRfV0lEVEhTLCBiYXNlKSA/IElNUExJQ0lUX1dJRFRIU1tiYXNlXSA6IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VEaXJlY3Rpb24odGV4dDogc3RyaW5nKTogUG9ydERpcmVjdGlvbiB8IHVuZGVmaW5lZCB7XG4gIHN3aXRjaCAodGV4dC50cmltKCkpIHtcbiAgICBjYXNlIFwiaW5wdXRcIjogcmV0dXJuIFwiaW5wdXRcIjtcbiAgICBjYXNlIFwib3V0cHV0XCI6IHJldHVybiBcIm91dHB1dFwiO1xuICAgIGNhc2UgXCJpbm91dFwiOiByZXR1cm4gXCJpbm91dFwiO1xuICAgIGNhc2UgXCJyZWZcIjogcmV0dXJuIFwicmVmXCI7XG4gICAgY2FzZSBcImludGVyZmFjZVwiOiByZXR1cm4gXCJpbnRlcmZhY2VcIjtcbiAgICBkZWZhdWx0OiByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbmZ1bmN0aW9uIHN0cmlwUGFja2VkKHR5cGVUZXh0OiBzdHJpbmcgfCB1bmRlZmluZWQsIHBhY2tlZFRleHQ6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XG4gIGlmICghdHlwZVRleHQpIHJldHVybiBcIlwiO1xuICBsZXQgb3V0ID0gdHlwZVRleHQ7XG4gIGlmIChwYWNrZWRUZXh0KSBvdXQgPSBvdXQuc3BsaXQocGFja2VkVGV4dCkuam9pbihcIlwiKTtcbiAgcmV0dXJuIG91dC50cmltKCk7XG59XG5cblxuLyoqXG4gKiBXaGF0IHRoZSBkZWNsYXJhdGlvbiBwYXNzIGFsb25lIGNhbiBwcm9kdWNlLiBgdXNlc2AsIGBpZGVudGlmaWVyc2AgYW5kXG4gKiBgYWNjZXNzZXNgIG5lZWQgdGhlIHdob2xlIGRvY3VtZW50LCBzbyBgYW5hbHl6ZVRyZWVgIGZpbGxzIHRoZW0gaW4uXG4gKi9cbnR5cGUgQW5hbHlzaXNCYXNlID0gT21pdDxBbmFseXNpcywgXCJ1c2VzXCIgfCBcImlkZW50aWZpZXJzXCIgfCBcImFjY2Vzc2VzXCI+O1xuXG4vKipcbiAqIENsYXNzIG5hbWVzIGRlY2xhcmVkIGluIGEgc291cmNlIGZpbGUsIGZvdW5kIHdpdGhvdXQgcGFyc2luZyBpdC5cbiAqXG4gKiBUaGUgaW5kZXhlciBuZWVkcyBldmVyeSBmaWxlJ3MgY2xhc3NlcyAqYmVmb3JlKiBpdCBhbmFseXNlcyBhbnkgb2YgdGhlbTpcbiAqIGRlY2lkaW5nIHRoYXQgYFBhY2tldCBwa3Q7YCBpcyBhbiBvYmplY3QgbmVlZHMgdG8ga25vdyB0aGF0IGBQYWNrZXRgIGlzIGFcbiAqIGNsYXNzLCBhbmQgdGhlIGZpbGUgZGVjbGFyaW5nIGl0IG1heSBiZSByZWFkIGxhdGVyIGluIHRoZSB3YWxrLiBBIHNlY29uZFxuICogcGFyc2Ugb2YgZXZlcnkgZmlsZSB3b3VsZCBiZSBjb3JyZWN0IGFuZCBleHBlbnNpdmU7IHRoZSBkZWNsYXJhdGlvbiBpc1xuICogc3ludGFjdGljYWxseSB1bm1pc3Rha2FibGUsIHNvIGEgc2NhbiBvZiB0aGUgcmF3IHRleHQgaXMgZW5vdWdoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xhc3NOYW1lc0luKHRleHQ6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgY29uc3QgbmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgLy8gYGNsYXNzIENgLCBgdmlydHVhbCBjbGFzcyBDYCwgYGludGVyZmFjZSBjbGFzcyBDYCwgd2l0aCBvcHRpb25hbFxuICAvLyBgIyguLi4pYCBhbmQgYGV4dGVuZHMgLi4uYCBhZnRlcndhcmRzIC0tIG5vbmUgb2Ygd2hpY2ggYWZmZWN0IHRoZSBuYW1lLlxuICBjb25zdCBwYXR0ZXJuID0gLyg/Ol58W1xcczt9XSkoPzooPzp2aXJ0dWFsfGludGVyZmFjZXxsb2NhbClcXHMrKSpjbGFzc1xccysoW0EtWmEtel9dXFx3KikvZztcblxuICBmb3IgKGNvbnN0IG1hdGNoIG9mIHRleHQubWF0Y2hBbGwocGF0dGVybikpIHtcbiAgICBjb25zdCBuYW1lID0gbWF0Y2hbMV07XG4gICAgaWYgKG5hbWUpIG5hbWVzLmFkZChuYW1lKTtcbiAgfVxuXG4gIHJldHVybiBuYW1lcztcbn1cblxuLyoqXG4gKiBBbmFseXNlcyBvbmUgZG9jdW1lbnQuXG4gKiBga25vd25DbGFzc2VzYCBjYXJyaWVzIHRoZSBjbGFzcyBuYW1lcyB0aGUgd29ya3NwYWNlIGhhcyBhbHJlYWR5IGluZGV4ZWQuIEl0XG4gKiBpcyB3aGF0IGxldHMgYFBhY2tldCBwa3Q7YCBiZSByZWNvZ25pc2VkIGFzIGFuIG9iamVjdCByYXRoZXIgdGhhbiBhIG9uZS1iaXRcbiAqIG5ldCwgYW5kIHBhc3NpbmcgdGhlIHNhbWUgc2V0IGJhY2sgaXMgaG93IGEgZmlsZSB0aGF0IGRlY2xhcmVzIGl0cyBvd24gY2xhc3Nlc1xuICogZ2V0cyBhbmFseXNlZCBjb3JyZWN0bHk6IHRoZSBmaXJzdCBwYXNzIGZpbmRzIHRoZW0sIGEgc2Vjb25kIHBhc3Mgd2l0aCB0aGVtIGluXG4gKiBoYW5kIGNsYXNzaWZpZXMgdGhlIGRlY2xhcmF0aW9ucyB0aGF0IHVzZSB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYW5hbHl6ZVRyZWUoXG4gIHRyZWU6IFRyZWUsXG4gIHRleHQ6IHN0cmluZyxcbiAga25vd25DbGFzc2VzOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldCgpLFxuICBpbXBvcnRlZFBhcmFtZXRlclZhbHVlcz86IChwYWNrYWdlTmFtZTogc3RyaW5nKSA9PiBSZWFkb25seU1hcDxzdHJpbmcsIG51bWJlcj4gfCB1bmRlZmluZWQsXG4gIG1hY3JvczogTWFjcm9UYWJsZSA9IG5ldyBNYXAoKSxcbiAgcGFyc2VGcmFnbWVudD86ICh0ZXh0OiBzdHJpbmcpID0+IFRyZWUsXG4pOiBBbmFseXNpcyB7XG4gIGNvbnN0IGFuYWx5emVyID0gbmV3IEFuYWx5emVyKHRleHQsIGtub3duQ2xhc3NlcywgaW1wb3J0ZWRQYXJhbWV0ZXJWYWx1ZXMsIG1hY3JvcywgcGFyc2VGcmFnbWVudCk7XG4gIGNvbnN0IGJhc2UgPSBhbmFseXplci5ydW4odHJlZSk7XG5cbiAgLy8gUmVmZXJlbmNlcyBhbmQgYWNjZXNzZXMgY29tZSBmcm9tIG9uZSB0cmF2ZXJzYWw6IGEgcmVmZXJlbmNlICppcyogdGhlIHRoaW5nXG4gIC8vIHRoZSB0cmFjZXIgY2xhc3NpZmllcywgc28gd2Fsa2luZyB0aGUgdHJlZSB0d2ljZSBtZWFudCBwYXlpbmcgdGhlIFdBU01cbiAgLy8gYm91bmRhcnkgY29zdCB0d2ljZSBmb3IgdGhlIHNhbWUgbm9kZXMuXG4gIGNvbnN0IGRyYWZ0ID0geyAuLi5iYXNlLCB1c2VzOiBbXSwgaWRlbnRpZmllcnM6IG5ldyBNYXAoKSwgYWNjZXNzZXM6IFtdIH0gYXMgdW5rbm93biBhcyBBbmFseXNpcztcbiAgY29uc3QgeyB1c2VzLCBhY2Nlc3NlcyB9ID0gY29sbGVjdFJlZmVyZW5jZXMoZHJhZnQsIHRleHQpO1xuXG4gIGNvbnN0IGlkZW50aWZpZXJzID0gbmV3IE1hcDxzdHJpbmcsIElkZW50aWZpZXJVc2VbXT4oKTtcbiAgZm9yIChjb25zdCB1c2Ugb2YgdXNlcykge1xuICAgIGNvbnN0IGxpc3QgPSBpZGVudGlmaWVycy5nZXQodXNlLm5hbWUpO1xuICAgIGlmIChsaXN0KSBsaXN0LnB1c2godXNlKTtcbiAgICBlbHNlIGlkZW50aWZpZXJzLnNldCh1c2UubmFtZSwgW3VzZV0pO1xuICB9XG5cbiAgcmV0dXJuIHsgLi4uYmFzZSwgdXNlcywgaWRlbnRpZmllcnMsIGFjY2Vzc2VzIH07XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBMb2NhdGlvbiwgUmFuZ2UgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5cbmltcG9ydCB0eXBlIHsgSGRsSW5zdGFuY2UsIEhkbFNjb3BlLCBIZGxTeW1ib2wsIFBhY2thZ2VJbXBvcnQsIFNpZ25hbEFjY2VzcyB9IGZyb20gXCIuL21vZGVsLmpzXCI7XG5pbXBvcnQgeyByb290TmFtZU9mIH0gZnJvbSBcIi4vc2lnbmFsQWNjZXNzLmpzXCI7XG5cbi8qKiBBIGRlc2lnbiB1bml0IChtb2R1bGUgLyBpbnRlcmZhY2UgLyBwYWNrYWdlIC8gcHJvZ3JhbSAvIGNsYXNzKSBmb3VuZCBhbnl3aGVyZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0YWxvZ0VudHJ5IHtcbiAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICByZWFkb25seSBraW5kOiBIZGxTY29wZVtcImNhdGVnb3J5XCJdO1xuICByZWFkb25seSB1cmk6IHN0cmluZztcbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICByZWFkb25seSBzZWxlY3Rpb25SYW5nZTogUmFuZ2U7XG4gIHJlYWRvbmx5IHBvcnRzOiBIZGxTeW1ib2xbXTtcbiAgcmVhZG9ubHkgcGFyYW1ldGVyczogSGRsU3ltYm9sW107XG4gIC8qKlxuICAgKiBTaWduYWxzLCB0eXBlZGVmcywgZ2VudmFycyBhbmQgZW51bSBsaXRlcmFscyBkZWNsYXJlZCBpbiB0aGUgdW5pdCdzIGJvZHkuXG4gICAqXG4gICAqIE5lZWRlZCB0byBhbnN3ZXIgYERVVF9pZi5hZGNfaW5gOiBhbiBpbnRlcmZhY2UgaW5zdGFuY2UncyBtZW1iZXJzIGFyZSBub3RcbiAgICogcG9ydHMgb2YgdGhlIGVuY2xvc2luZyBtb2R1bGUsIHRoZXkgYXJlIG9yZGluYXJ5IGRlY2xhcmF0aW9ucyBpbnNpZGUgdGhlXG4gICAqIGludGVyZmFjZS5cbiAgICovXG4gIHJlYWRvbmx5IHN5bWJvbHM6IEhkbFN5bWJvbFtdO1xuICAvKipcbiAgICogSW5zdGFuY2VzIGRlY2xhcmVkIGluc2lkZSB0aGlzIHVuaXQuIEtlcHQgc28gdGhlIGhpZXJhcmNoeSB2aWV3IGNhbiB3YWxrXG4gICAqIHRoZSB3aG9sZSBkZXNpZ24gd2l0aG91dCByZS1wYXJzaW5nIGV2ZXJ5IGZpbGUgaXQgcGFzc2VzIHRocm91Z2guXG4gICAqL1xuICByZWFkb25seSBpbnN0YW5jZXM6IEhkbEluc3RhbmNlW107XG4gIC8qKlxuICAgKiBEcml2ZXMgYW5kIGxvYWRzIGRlY2xhcmVkIGluc2lkZSB0aGlzIHVuaXQsIHJlc29sdmVkIGFnYWluc3QgdGhlIHdvcmtzcGFjZVxuICAgKiBpbmRleC4gVGhlIFNpZ25hbCBUcmFjZXIgd2Fsa3MgdGhlc2UgdG8gZm9sbG93IGEgbmV0IGFjcm9zcyBtb2R1bGVzLlxuICAgKi9cbiAgcmVhZG9ubHkgYWNjZXNzZXM6IFNpZ25hbEFjY2Vzc1tdO1xuICByZWFkb25seSBoZWFkZXJUZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBGb3IgYSBjbGFzcywgdGhlIGNsYXNzIGl0IGV4dGVuZHMuXG4gICAqXG4gICAqIE1lbWJlcnMgb2YgdGhlIGJhc2UgYXJlIG1lbWJlcnMgb2YgdGhlIHN1YmNsYXNzLCBhbmQgdGhlIGJhc2UgaXMgb2Z0ZW4gaW5cbiAgICogYW5vdGhlciBmaWxlLCBzbyB0aGlzIGlzIHJlY29yZGVkIHJhdGhlciB0aGFuIG1lcmdlZC5cbiAgICovXG4gIHJlYWRvbmx5IGJhc2VDbGFzcz86IHN0cmluZztcbiAgLyoqXG4gICAqIFBhY2thZ2VzIHRoaXMgdW5pdCBpbXBvcnRzLlxuICAgKlxuICAgKiBBIHBhY2thZ2UgdGhhdCBkb2VzIGBpbXBvcnQgb3RoZXI6OipgIHJlLWV4cG9ydHMgYG90aGVyYCdzIG1lbWJlcnMgaW5cbiAgICogcHJhY3RpY2UgLS0gZXZlcnkgZGVzaWduIGRvZXMgaXQsIGFuZCBjb2RlIGRvd25zdHJlYW0gb2YgaXQgcmVsaWVzIG9uIGl0IC0tXG4gICAqIHNvIGEgbG9va3VwIHRoYXQgc3RvcHBlZCBhdCB0aGUgZmlyc3QgaW1wb3J0IHdvdWxkIG1pc3MgaGFsZiB0aGUgbmFtZXMgYVxuICAgKiBgaW1wb3J0IGNmZ19wa2c6OipgIGlzIGV4cGVjdGVkIHRvIGJyaW5nIGluLlxuICAgKi9cbiAgcmVhZG9ubHkgaW1wb3J0czogcmVhZG9ubHkgUGFja2FnZUltcG9ydFtdO1xufVxuXG4vKipcbiAqIFNjb3BlcyB0aGF0IHJlcHJlc2VudCBhIHJldXNhYmxlIGRlc2lnbiB1bml0IHJhdGhlciB0aGFuIGFuIGlubGluZSBibG9jay5cbiAqXG4gKiBgY2xhc3NgIGJlbG9uZ3MgaGVyZSBmb3IgdGhlIHNhbWUgcmVhc29uIGBwYWNrYWdlYCBkb2VzOiBib3RoIGFyZSBuYW1lZCB0eXBlc1xuICogZGVjbGFyZWQgaW4gb25lIGZpbGUgYW5kIHJlZmVyZW5jZWQgZnJvbSBhbm90aGVyLCBzbyBgUGFja2V0IHBrdDtgIG5lZWRzIHRoZVxuICogY2F0YWxvZyB0byBzYXkgd2hhdCBgUGFja2V0YCBpcy5cbiAqL1xuY29uc3QgVU5JVF9LSU5EUyA9IG5ldyBTZXQ8SGRsU2NvcGVbXCJjYXRlZ29yeVwiXT4oW1xuICBcIm1vZHVsZVwiLFxuICBcImludGVyZmFjZVwiLFxuICBcInByb2dyYW1cIixcbiAgXCJwYWNrYWdlXCIsXG4gIFwiY2xhc3NcIixcbl0pO1xuXG4vKiogSG93IGZhciBhIHBhY2thZ2UncyBpbXBvcnQgY2hhaW4gaXMgZm9sbG93ZWQuICovXG5jb25zdCBNQVhfSU1QT1JUX0hPUFMgPSA4O1xuXG4vKipcbiAqIFdvcmtzcGFjZS13aWRlIGluZGV4IG9mIGRlc2lnbiB1bml0cy4gVGhpcyBpcyB3aGF0IG1ha2VzIFwiZ28gdG8gZGVmaW5pdGlvblwiXG4gKiBvbiBhbiBpbnN0YW50aWF0aW9uLCBhbmQgY29tcGxldGlvbiBvZiBtb2R1bGUgbmFtZXMsIHdvcmsgYWNyb3NzIGZpbGVzLlxuICpcbiAqIEEgbmFtZSBtYXkgbGVnaXRpbWF0ZWx5IGJlIGRlY2xhcmVkIG1vcmUgdGhhbiBvbmNlIChndWFyZGVkIHZhcmlhbnRzLCBvciBhXG4gKiB2ZW5kb3IgbGlicmFyeSBwbHVzIGEgbG9jYWwgd3JhcHBlciksIHNvIGRlY2xhcmF0aW9ucyBhcmUgc3RvcmVkIGFzIGEgbGlzdFxuICogYW5kIGFsbCBvZiB0aGVtIGFyZSBvZmZlcmVkLlxuICovXG5leHBvcnQgY2xhc3MgQ2F0YWxvZyB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIENhdGFsb2dFbnRyeVtdPigpO1xuICAvKiogdXJpIC0+IG5hbWVzIGRlY2xhcmVkIGJ5IHRoYXQgZG9jdW1lbnQsIHNvIHJlbW92YWwgaXMgZXhhY3QuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgYnlVcmkgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nW10+KCk7XG4gIC8qKlxuICAgKiB1cmkgLT4gZGVjbGFyYXRpb25zIHRoYXQgYmVsb25nIHRvIG5vIHNjb3BlLCBpLmUuIHdoYXQgYSBoZWFkZXIgbGVhdmVzXG4gICAqIGJlaGluZCBpbiB0aGUgY29tcGlsYXRpb24gdW5pdC5cbiAgICpcbiAgICogYHR5cGVkZWYgc3RydWN0IHsuLi59IGhkcl90O2AgYW5kIHRoZSBsaXRlcmFscyBvZiBhbiBgZW51bWAgd3JpdHRlbiBhYm92ZVxuICAgKiB0aGUgZmlyc3QgYG1vZHVsZWAgYXJlIHZpc2libGUgdG8gZXZlcnkgdW5pdCBpbiB0aGUgZmlsZSB0aGF0IGluY2x1ZGVzIHRoZVxuICAgKiBoZWFkZXIuIE5vIHNjb3BlIG93bnMgdGhlbSwgc28gbm90aGluZyBlbHNlIGNhbiBiZSBhc2tlZCB3aGVyZSB0aGV5IGFyZS5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgdW5pdFN5bWJvbHMgPSBuZXcgTWFwPHN0cmluZywgcmVhZG9ubHkgSGRsU3ltYm9sW10+KCk7XG4gIC8qKiB1cmkgLT4gdGhlIHNoYXBlIG9mIHdoYXQgdGhlIGRvY3VtZW50IGRlY2xhcmVzLCB0byBzcG90IGEgcmVhbCBjaGFuZ2UuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgc2hhcGVzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgLyoqXG4gICAqIEJ1bXBlZCBvbmx5IHdoZW4gYSBkb2N1bWVudCdzICpzaGFwZSogY2hhbmdlcy5cbiAgICpcbiAgICogQSBkZXNpZ24gdW5pdCdzIG5hbWUsIGl0cyBraW5kIGFuZCB3aGF0IGl0IGluc3RhbnRpYXRlcyBhcmUgdGhlIHN0cnVjdHVyZVxuICAgKiB0aGUgd29ya3NwYWNlIGFuc3dlcnMgcXVlc3Rpb25zIGFib3V0OyBhIHJlbmFtZWQgc2lnbmFsIGlzIG5vdC4gQW55dGhpbmdcbiAgICogY2FjaGVkIGFnYWluc3QgdGhlIHdvcmtzcGFjZSAtLSB0aGUgdG9wIG9mIHRoZSBkZXNpZ24sIHdoaWNoIG1vZHVsZSByZWFjaGVzXG4gICAqIHdoaWNoIC0tIGlzIGtleWVkIG9uIHRoaXMsIHNvIGEga2V5c3Ryb2tlIGNvc3RzIG5vdGhpbmcgYW5kIGEgbmV3IHN1Ym1vZHVsZVxuICAgKiBjb3N0cyBvbmUgcmVidWlsZC5cbiAgICovXG4gIHByaXZhdGUgdmVyc2lvbiA9IDA7XG5cbiAgLyoqIENoYW5nZXMgd2hlbmV2ZXIgdGhlIGRlc2lnbiBpdHNlbGYgZG9lcy4gU2VlIGB2ZXJzaW9uYC4gKi9cbiAgZ2V0IHN0cnVjdHVyZVZlcnNpb24oKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy52ZXJzaW9uO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYnVpbGRzIHRoZSBlbnRyaWVzIGNvbnRyaWJ1dGVkIGJ5IGEgc2luZ2xlIGRvY3VtZW50LlxuICAgKlxuICAgKiBQb3J0LWJvdW5kYXJ5IGFjY2Vzc2VzIG5lZWQgdGhlIGRpcmVjdGlvbiBvZiB0aGUgKmluc3RhbnRpYXRlZCogbW9kdWxlLFxuICAgKiB3aGljaCBtYXkgbGl2ZSBpbiBhbm90aGVyIGZpbGUgdGhhdCBoYXMgbm90IGJlZW4gaW5kZXhlZCB5ZXQuIFJlc29sdXRpb24gaXNcbiAgICogdGhlcmVmb3JlIGEgc2VwYXJhdGUgcGFzczogdGhpcyBtZXRob2Qgb25seSByZWNvcmRzIHdoYXQgdGhlIGRvY3VtZW50IHNheXMsXG4gICAqIGFuZCBgcmVzb2x2ZUFsbGAgcmVidWlsZHMgZXZlcnkgZW50cnkncyBhY2Nlc3NlcyBmcm9tIHRoZSBmaW5pc2hlZCBpbmRleC5cbiAgICovXG4gIHJlcGxhY2VEb2N1bWVudChcbiAgICB1cmk6IHN0cmluZyxcbiAgICBzY29wZXM6IEhkbFNjb3BlW10sXG4gICAgYWNjZXNzZXM6IHJlYWRvbmx5IFNpZ25hbEFjY2Vzc1tdID0gW10sXG4gICAgdW5pdFN5bWJvbHM6IHJlYWRvbmx5IEhkbFN5bWJvbFtdID0gW10sXG4gICk6IHZvaWQge1xuICAgIHRoaXMucmVtb3ZlRW50cmllcyh1cmkpO1xuXG4gICAgY29uc3Qgc2hhcGUgPSBzaGFwZU9mKHNjb3Blcyk7XG4gICAgaWYgKHRoaXMuc2hhcGVzLmdldCh1cmkpICE9PSBzaGFwZSkge1xuICAgICAgdGhpcy5zaGFwZXMuc2V0KHVyaSwgc2hhcGUpO1xuICAgICAgdGhpcy52ZXJzaW9uKys7XG4gICAgfVxuXG4gICAgY29uc3QgZGVjbGFyZWQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHNjb3BlIG9mIHNjb3Blcykge1xuICAgICAgaWYgKCFVTklUX0tJTkRTLmhhcyhzY29wZS5jYXRlZ29yeSkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZW50cnk6IENhdGFsb2dFbnRyeSA9IHtcbiAgICAgICAgbmFtZTogc2NvcGUubmFtZSxcbiAgICAgICAga2luZDogc2NvcGUuY2F0ZWdvcnksXG4gICAgICAgIHVyaSxcbiAgICAgICAgcmFuZ2U6IHNjb3BlLnJhbmdlLFxuICAgICAgICBzZWxlY3Rpb25SYW5nZTogc2NvcGUuc2VsZWN0aW9uUmFuZ2UsXG4gICAgICAgIHBvcnRzOiBzY29wZS5wb3J0cyxcbiAgICAgICAgcGFyYW1ldGVyczogc2NvcGUucGFyYW1ldGVycyxcbiAgICAgICAgc3ltYm9sczogc2NvcGUuc3ltYm9scyxcbiAgICAgICAgaW5zdGFuY2VzOiBzY29wZS5pbnN0YW5jZXMsXG4gICAgICAgIGFjY2Vzc2VzOiBbXSxcbiAgICAgICAgaGVhZGVyVGV4dDogc2NvcGUuaGVhZGVyVGV4dCxcbiAgICAgICAgYmFzZUNsYXNzOiBzY29wZS5iYXNlQ2xhc3MsXG4gICAgICAgIGltcG9ydHM6IHNjb3BlLmltcG9ydHMgPz8gW10sXG4gICAgICB9O1xuICAgICAgY29uc3QgbGlzdCA9IHRoaXMuYnlOYW1lLmdldChzY29wZS5uYW1lKTtcbiAgICAgIGlmIChsaXN0KSBsaXN0LnB1c2goZW50cnkpO1xuICAgICAgZWxzZSB0aGlzLmJ5TmFtZS5zZXQoc2NvcGUubmFtZSwgW2VudHJ5XSk7XG4gICAgICBkZWNsYXJlZC5wdXNoKHNjb3BlLm5hbWUpO1xuICAgIH1cblxuICAgIHRoaXMuYnlVcmkuc2V0KHVyaSwgZGVjbGFyZWQpO1xuICAgIGlmICh1bml0U3ltYm9scy5sZW5ndGggPiAwKSB0aGlzLnVuaXRTeW1ib2xzLnNldCh1cmksIHVuaXRTeW1ib2xzKTtcbiAgICBlbHNlIHRoaXMudW5pdFN5bWJvbHMuZGVsZXRlKHVyaSk7XG4gICAgdGhpcy5zb3VyY2Uuc2V0KHVyaSwgeyBhY2Nlc3Nlcywgc2NvcGVzIH0pO1xuICAgIHRoaXMucmVzb2x2ZUFsbCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFdoYXQgZWFjaCBkb2N1bWVudCBkZWNsYXJlZCwga2VwdCBzbyBhY2Nlc3NlcyBjYW4gYmUgcmVidWlsdCB3aGVuZXZlciB0aGVcbiAgICogaW5kZXggY2hhbmdlcy4gSW5kZXhpbmcgb3JkZXIgbXVzdCBub3QgY2hhbmdlIHRoZSByZXN1bHQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHNvdXJjZSA9IG5ldyBNYXA8XG4gICAgc3RyaW5nLFxuICAgIHsgYWNjZXNzZXM6IHJlYWRvbmx5IFNpZ25hbEFjY2Vzc1tdOyBzY29wZXM6IHJlYWRvbmx5IEhkbFNjb3BlW10gfVxuICA+KCk7XG5cbiAgLyoqXG4gICAqIFJlY29tcHV0ZXMgdGhlIGFjY2Vzc2VzIG9mIGV2ZXJ5IGluZGV4ZWQgZG9jdW1lbnQuXG4gICAqXG4gICAqIENhbGxlZCBhZnRlciBlYWNoIGByZXBsYWNlRG9jdW1lbnRgIGJlY2F1c2UgYSBuZXdseSBpbmRleGVkIG1vZHVsZSBjYW4gYmVcbiAgICogdGhlIHRhcmdldCBvZiBhbiBpbnN0YW50aWF0aW9uIGluIGEgZmlsZSB0aGF0IHdhcyBpbmRleGVkIGVhcmxpZXIuXG4gICAqL1xuICByZXNvbHZlQWxsKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgW3VyaSwgeyBhY2Nlc3Nlcywgc2NvcGVzIH1dIG9mIHRoaXMuc291cmNlKSB7XG4gICAgICBjb25zdCBlbnRyaWVzID0gKHRoaXMuYnlVcmkuZ2V0KHVyaSkgPz8gW10pXG4gICAgICAgIC5mbGF0TWFwKChuYW1lKSA9PiB0aGlzLmJ5TmFtZS5nZXQobmFtZSkgPz8gW10pXG4gICAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS51cmkgPT09IHVyaSk7XG5cbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgICBjb25zdCBzY29wZSA9IHNjb3Blcy5maW5kKChzKSA9PiBzLm5hbWUgPT09IGVudHJ5Lm5hbWUpO1xuICAgICAgICBjb25zdCBvd24gPSBzY29wZSA/IGFjY2Vzc2VzLmZpbHRlcigoYSkgPT4gYS5zY29wZUlkID09PSBzY29wZS5pZCkgOiBbXTtcbiAgICAgICAgY29uc3QgY3Jvc3MgPSBzY29wZSA/IHRoaXMucG9ydEJvdW5kYXJ5QWNjZXNzZXMoc2NvcGUpIDogW107XG4gICAgICAgIChlbnRyeSBhcyB7IGFjY2Vzc2VzOiBTaWduYWxBY2Nlc3NbXSB9KS5hY2Nlc3NlcyA9IFsuLi5vd24sIC4uLmNyb3NzXTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRHJpdmVzIGFuZCBsb2FkcyBpbXBsaWVkIGJ5IGB1X3N1YiAoLmEobmV0KSlgIHN0eWxlIGNvbm5lY3Rpb25zLlxuICAgKlxuICAgKiBTZWVuIGZyb20gdGhlIG5ldDogYSBuZXQgcmVhY2hpbmcgYSBzdWJtb2R1bGUncyBpbnB1dCBwb3J0IGlzIGxvYWRlZCBieVxuICAgKiB0aGF0IHN1Ym1vZHVsZSwgYW5kIGEgbmV0IG9uIGl0cyBvdXRwdXQgcG9ydCBpcyBkcml2ZW4gYnkgaXQuIFdpdGhvdXQgdGhlXG4gICAqIHN1Ym1vZHVsZSdzIHBvcnQgZGlyZWN0aW9ucyB0aGVyZSBpcyBub3RoaW5nIHRvIGNsYXNzaWZ5LCBzbyB0aG9zZVxuICAgKiBjb25uZWN0aW9ucyBhcmUgbGVmdCBvdXQgcmF0aGVyIHRoYW4gZ3Vlc3NlZC5cbiAgICovXG4gIHByaXZhdGUgcG9ydEJvdW5kYXJ5QWNjZXNzZXMoc2NvcGU6IEhkbFNjb3BlKTogU2lnbmFsQWNjZXNzW10ge1xuICAgIGNvbnN0IG91dDogU2lnbmFsQWNjZXNzW10gPSBbXTtcbiAgICBjb25zdCB2aXNpdCA9IChjdXJyZW50OiBIZGxTY29wZSk6IHZvaWQgPT4ge1xuICAgICAgZm9yIChjb25zdCBpbnN0YW5jZSBvZiBjdXJyZW50Lmluc3RhbmNlcykge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuZ2V0KGluc3RhbmNlLnR5cGVOYW1lKTtcbiAgICAgICAgaWYgKCFlbnRyeSkgY29udGludWU7XG5cbiAgICAgICAgY29uc3QgZGlyZWN0aW9ucyA9IG5ldyBNYXAoZW50cnkucG9ydHMubWFwKChwKSA9PiBbcC5uYW1lLCBwLmRpcmVjdGlvbl0pKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGJpbmRpbmcgb2YgaW5zdGFuY2UuY29ubmVjdGlvbnMpIHtcbiAgICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBiaW5kaW5nLnBvcnROYW1lID8gZGlyZWN0aW9ucy5nZXQoYmluZGluZy5wb3J0TmFtZSkgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgaWYgKCFkaXJlY3Rpb24pIGNvbnRpbnVlO1xuXG4gICAgICAgICAgLy8gQSBuZXQgZmVlZGluZyBhbiBpbnB1dCBwb3J0IGlzIGJlaW5nICpyZWFkKiBieSB0aGUgc3VibW9kdWxlLCBhbmQgYSBuZXRcbiAgICAgICAgICAvLyBvbiBhbiBvdXRwdXQgcG9ydCBpcyBiZWluZyAqd3JpdHRlbiogYnkgaXQuIFRoZSBwb2ludCBvZiB2aWV3IGlzXG4gICAgICAgICAgLy8gYWx3YXlzIHRoZSBuZXQgaW4gdGhpcyBtb2R1bGUsIG5vdCB0aGUgcG9ydC5cbiAgICAgICAgICBjb25zdCBraW5kID1cbiAgICAgICAgICAgIGRpcmVjdGlvbiA9PT0gXCJpbnB1dFwiID8gXCJsb2FkXCIgOiBkaXJlY3Rpb24gPT09IFwib3V0cHV0XCIgPyBcImRyaXZlXCIgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgaWYgKCFraW5kKSBjb250aW51ZTtcblxuICAgICAgICAgIGNvbnN0IG5hbWUgPSByb290TmFtZU9mKGJpbmRpbmcudmFsdWVUZXh0KTtcbiAgICAgICAgICBpZiAoIW5hbWUpIGNvbnRpbnVlO1xuXG4gICAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgIHNjb3BlSWQ6IGN1cnJlbnQuaWQsXG4gICAgICAgICAgICBraW5kLFxuICAgICAgICAgICAgcmFuZ2U6IGJpbmRpbmcucmFuZ2UsXG4gICAgICAgICAgICBzb3VyY2U6IGRpcmVjdGlvbiA9PT0gXCJpbnB1dFwiID8gXCJpbnN0YW5jZV9pbnB1dFwiIDogXCJpbnN0YW5jZV9vdXRwdXRcIixcbiAgICAgICAgICAgIC8vIGBpbnN0YW5jZV9pbnB1dGAgbmFtZXMgdGhlIHBvcnQgdGhlIG5ldCByZWFjaGVzLCBub3QgdGhlXG4gICAgICAgICAgICAvLyBkaXJlY3Rpb24gb2YgdGhlIGFjY2VzcyBpdHNlbGYuXG4gICAgICAgICAgICBkZXRhaWw6IGAke2luc3RhbmNlLmluc3RhbmNlTmFtZX0uJHtiaW5kaW5nLnBvcnROYW1lfWAsXG4gICAgICAgICAgICBwb3J0OiBiaW5kaW5nLnBvcnROYW1lLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGN1cnJlbnQuY2hpbGRyZW4pIHZpc2l0KGNoaWxkKTtcbiAgICB9O1xuXG4gICAgdmlzaXQoc2NvcGUpO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cblxuICByZW1vdmVEb2N1bWVudCh1cmk6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMucmVtb3ZlRW50cmllcyh1cmkpO1xuICAgIHRoaXMudW5pdFN5bWJvbHMuZGVsZXRlKHVyaSk7XG4gICAgaWYgKHRoaXMuc2hhcGVzLmRlbGV0ZSh1cmkpKSB0aGlzLnZlcnNpb24rKztcbiAgfVxuXG4gIC8qKiBEcm9wcyB0aGUgZW50cmllcyBhIGRvY3VtZW50IGNvbnRyaWJ1dGVkLCBsZWF2aW5nIGV2ZXJ5dGhpbmcgZWxzZSBpbnRhY3QuICovXG4gIHByaXZhdGUgcmVtb3ZlRW50cmllcyh1cmk6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuc291cmNlLmRlbGV0ZSh1cmkpO1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmJ5VXJpLmdldCh1cmkpID8/IFtdKSB7XG4gICAgICBjb25zdCBsaXN0ID0gdGhpcy5ieU5hbWUuZ2V0KG5hbWUpO1xuICAgICAgaWYgKCFsaXN0KSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGtlcHQgPSBsaXN0LmZpbHRlcigoZSkgPT4gZS51cmkgIT09IHVyaSk7XG4gICAgICBpZiAoa2VwdC5sZW5ndGggPT09IDApIHRoaXMuYnlOYW1lLmRlbGV0ZShuYW1lKTtcbiAgICAgIGVsc2UgdGhpcy5ieU5hbWUuc2V0KG5hbWUsIGtlcHQpO1xuICAgIH1cbiAgICB0aGlzLmJ5VXJpLmRlbGV0ZSh1cmkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFdoYXQgYSBkb2N1bWVudCBsZWF2ZXMgaW4gdGhlIGNvbXBpbGF0aW9uIHVuaXQsIGZvciB0aGUgZmlsZSB0aGF0IGluY2x1ZGVzXG4gICAqIGl0LlxuICAgKlxuICAgKiBBIGhlYWRlciBpcyBub3QgYSBkZXNpZ24gdW5pdCwgc28gdGhpcyBpcyB0aGUgb25seSB3YXkgYSBgdHlwZWRlZmAgd3JpdHRlblxuICAgKiBhYm92ZSB0aGUgZmlyc3QgYG1vZHVsZWAgY2FuIGJlIGZvdW5kIC0tIGFuZCB3aXRob3V0IGl0IGV2ZXJ5IHVzZSBvZiB0aGF0XG4gICAqIHR5cGUgaW4gdGhlIGluY2x1ZGluZyBmaWxlIGlzIGFuIHVua25vd24gaWRlbnRpZmllciwgd2hpY2ggaXMgZXhhY3RseSB3aGF0IGFcbiAgICogcGFja2FnZSBvciBhIHNoYXJlZCBoZWFkZXIgbG9va3MgbGlrZSBmcm9tIHRoZSBvdXRzaWRlLlxuICAgKi9cbiAgdW5pdERlY2xhcmF0aW9ucyh1cmk6IHN0cmluZyk6IHJlYWRvbmx5IEhkbFN5bWJvbFtdIHtcbiAgICByZXR1cm4gdGhpcy51bml0U3ltYm9scy5nZXQodXJpKSA/PyBbXTtcbiAgfVxuXG4gIC8qKiBDb21waWxhdGlvbi11bml0IHJvdXRpbmVzIGFuZCBtZW1iZXJzIHZpc2libGUgaW5zaWRlIEM6Om1ldGhvZCBib2RpZXMuICovXG4gIGV4dGVybmFsRGVjbGFyYXRpb25zKG93bmVyPzogc3RyaW5nKTogeyBzeW1ib2w6IEhkbFN5bWJvbDsgdXJpOiBzdHJpbmcgfVtdIHtcbiAgICBpZiAob3duZXIpIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5yZXNvbHZlKG93bmVyKTtcbiAgICAgIGlmICghZW50cnkpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiB0aGlzLmNsYXNzTWVtYmVycyhvd25lcikubWFwKChzeW1ib2wpID0+ICh7XG4gICAgICAgIHN5bWJvbCxcbiAgICAgICAgdXJpOiB0aGlzLnVuaXRzKCkuZmluZCgodW5pdCkgPT4gdW5pdC5zeW1ib2xzLmluY2x1ZGVzKHN5bWJvbCkgfHwgdW5pdC5wYXJhbWV0ZXJzLmluY2x1ZGVzKHN5bWJvbCkpPy51cmkgPz8gZW50cnkudXJpLFxuICAgICAgfSkpO1xuICAgIH1cbiAgICByZXR1cm4gWy4uLnRoaXMudW5pdFN5bWJvbHNdLmZsYXRNYXAoKFt1cmksIHN5bWJvbHNdKSA9PlxuICAgICAgc3ltYm9scy5maWx0ZXIoKHMpID0+IHMuY2F0ZWdvcnkgPT09IFwidGFza1wiIHx8IHMuY2F0ZWdvcnkgPT09IFwiZnVuY3Rpb25cIikubWFwKChzeW1ib2wpID0+ICh7IHN5bWJvbCwgdXJpIH0pKSxcbiAgICApO1xuICB9XG5cbiAgLyoqIEZpcnN0IGRlY2xhcmF0aW9uIG9mIGBuYW1lYCwgdXNlZCB3aGVuIGEgc2luZ2xlIHRhcmdldCBpcyBleHBlY3RlZC4gKi9cbiAgZ2V0KG5hbWU6IHN0cmluZyk6IENhdGFsb2dFbnRyeSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuYnlOYW1lLmdldChuYW1lKT8uWzBdO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBlbnRyeSBmb3IgYSBtb2R1bGUgbmFtZSwgcHJlZmVycmluZyB0aGUgb25lIHdyaXR0ZW4gaW4gYSBnaXZlbiBmaWxlLlxuICAgKlxuICAgKiBBIG5hbWUgbWF5IGxlZ2l0aW1hdGVseSBiZSBkZWNsYXJlZCBtb3JlIHRoYW4gb25jZSAtLSBhIGd1YXJkZWQgdmFyaWFudCwgb3JcbiAgICogYSB0ZXN0IGZpbGUgdGhhdCByZXVzZXMgYHRvcGAuIEFza2luZyBmb3IgYHRvcGAgd2hpbGUgZWRpdGluZyBvbmUgb2YgdGhlbVxuICAgKiBhbmQgZ2V0dGluZyB0aGUgb3RoZXIgb25lJ3MgZGVmaW5pdGlvbiBpcyBzaWxlbnRseSB3cm9uZywgc28gYSBjYWxsZXIgdGhhdFxuICAgKiBrbm93cyB3aGljaCBmaWxlIGl0IGlzIHdvcmtpbmcgaW4gc2F5cyBzbyBoZXJlLlxuICAgKi9cbiAgcmVzb2x2ZShuYW1lOiBzdHJpbmcsIHVyaT86IHN0cmluZyk6IENhdGFsb2dFbnRyeSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZW50cmllcyA9IHRoaXMuYnlOYW1lLmdldChuYW1lKTtcbiAgICBpZiAoIWVudHJpZXMpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHVyaSkge1xuICAgICAgY29uc3QgZXhhY3QgPSBlbnRyaWVzLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS51cmkgPT09IHVyaSk7XG4gICAgICBpZiAoZXhhY3QpIHJldHVybiBleGFjdDtcbiAgICB9XG4gICAgcmV0dXJuIGVudHJpZXNbMF07XG4gIH1cblxuICAvKipcbiAqIEZvbGRlZCB2YWx1ZXMgb2YgYSBwYWNrYWdlJ3MgcGFyYW1ldGVycywgZm9sbG93aW5nIGl0cyBvd24gaW1wb3J0cy5cbiAqXG4gKiBXaWR0aCBmb2xkaW5nIG5lZWRzIG51bWJlcnMsIG5vdCBkZWNsYXJhdGlvbnM6IGBvdXRwdXQgbG9naWMgW0NfUEtUX0RBVF9XLTE6MF1gXG4gKiBpcyBvbmx5IDMyIGJpdHMgaWYgdGhlIGFuYWx5emVyIGtub3dzIHdoYXQgYENfUEtUX0RBVF9XYCBpcywgYW5kIHRoYXQgaXMgb25lXG4gKiBmaWxlIG92ZXIgLS0gcG9zc2libHkgc2V2ZXJhbCwgaWYgdGhlIHBhY2thZ2UgcmUtZXhwb3J0cyBhbm90aGVyLlxuICpcbiAqIE9ubHkgbmFtZXMgdGhhdCBhbHJlYWR5IGNhcnJ5IGEgZm9sZGVkIHZhbHVlIGFyZSBpbmNsdWRlZC4gQW4gZXhwcmVzc2lvbiB0aGVcbiAqIGV2YWx1YXRvciBjb3VsZCBub3QgcmVkdWNlIGlzIGxlZnQgb3V0IHJhdGhlciB0aGFuIGFwcHJveGltYXRlZCwgc28gYSB3aWR0aFxuICogc3RheXMgdW5rbm93biBpbnN0ZWFkIG9mIGJlY29taW5nIGEgcGxhdXNpYmxlIHdyb25nIG51bWJlci5cbiAqL1xucGFyYW1ldGVyVmFsdWVzKHBhY2thZ2VOYW1lOiBzdHJpbmcpOiBSZWFkb25seU1hcDxzdHJpbmcsIG51bWJlcj4ge1xuICBjb25zdCBvdXQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBjb25zdCB3YWxrID0gKGVudHJ5OiBDYXRhbG9nRW50cnksIHNlZW46IFNldDxzdHJpbmc+LCBob3BzOiBudW1iZXIpOiB2b2lkID0+IHtcbiAgICBpZiAoaG9wcyA+IE1BWF9JTVBPUlRfSE9QUyB8fCBzZWVuLmhhcyhlbnRyeS5uYW1lKSkgcmV0dXJuO1xuICAgIHNlZW4uYWRkKGVudHJ5Lm5hbWUpO1xuXG4gICAgZm9yIChjb25zdCBzeW1ib2wgb2YgZW50cnkucGFyYW1ldGVycykge1xuICAgICAgaWYgKHN5bWJvbC5yZXNvbHZlZFZhbHVlID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFvdXQuaGFzKHN5bWJvbC5uYW1lKSkgb3V0LnNldChzeW1ib2wubmFtZSwgc3ltYm9sLnJlc29sdmVkVmFsdWUpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgaW1wb3J0ZWQgb2YgZW50cnkuaW1wb3J0cykge1xuICAgICAgaWYgKCFpbXBvcnRlZC53aWxkY2FyZCkgY29udGludWU7XG4gICAgICBjb25zdCBuZXh0ID0gdGhpcy5nZXQoaW1wb3J0ZWQucGFja2FnZU5hbWUpO1xuICAgICAgaWYgKG5leHQpIHdhbGsobmV4dCwgc2VlbiwgaG9wcyArIDEpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBlbnRyeSA9IHRoaXMuZ2V0KHBhY2thZ2VOYW1lKTtcbiAgaWYgKGVudHJ5KSB3YWxrKGVudHJ5LCBuZXcgU2V0KCksIDApO1xuICByZXR1cm4gb3V0O1xufVxuXG5hbGwobmFtZTogc3RyaW5nKTogQ2F0YWxvZ0VudHJ5W10ge1xuICAgIHJldHVybiB0aGlzLmJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gIH1cblxuICAvKipcbiAgICogRXZlcnkgY2xhc3MgZGVjbGFyZWQgYW55d2hlcmUgaW4gdGhlIHdvcmtzcGFjZS5cbiAgICpcbiAgICogVGhlIGFuYWx5emVyIG5lZWRzIHRoaXMgdG8gdGVsbCBhIGNsYXNzIGhhbmRsZSBmcm9tIGEgb25lLWJpdCBuZXQ6IHRoZVxuICAgKiBgUGFja2V0YCBpbiBgUGFja2V0IHBrdDtgIGlzIG9ubHkga25vd2FibGUgZnJvbSBvdXRzaWRlIHRoZSBmaWxlIGJlaW5nXG4gICAqIHJlYWQsIHNpbmNlIHRoZSBjbGFzcyB1c3VhbGx5IHNpdHMgaW4gYW5vdGhlciBvbmUuXG4gICAqL1xuICBjbGFzc05hbWVzKCk6IFNldDxzdHJpbmc+IHtcbiAgICBjb25zdCBuYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIGVudHJpZXNdIG9mIHRoaXMuYnlOYW1lKSB7XG4gICAgICBpZiAoZW50cmllcy5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJjbGFzc1wiKSkgbmFtZXMuYWRkKG5hbWUpO1xuICAgIH1cbiAgICByZXR1cm4gbmFtZXM7XG4gIH1cblxuICAvKipcbiAgICogRXZlcnl0aGluZyBhbiBvYmplY3Qgb2YgYGNsYXNzTmFtZWAgY2FuIHNlZSwgaXRzIG93biBtZW1iZXJzIGZpcnN0LlxuICAgKlxuICAgKiBBIHN1YmNsYXNzIGluaGVyaXRzIGl0cyBiYXNlJ3MgcHJvcGVydGllcyBhbmQgbWV0aG9kcywgc28gdGhlIHdhbGsgZm9sbG93c1xuICAgKiBgZXh0ZW5kc2AgdXAgdGhlIGNoYWluLiBUaGUgYmFzZSBtYXkgYmUgaW4gYW5vdGhlciBmaWxlLCBhbmQgbWF5IGl0c2VsZiBiZVxuICAgKiBtaXNzaW5nIGZyb20gdGhlIGluZGV4LCB3aGljaCBpcyB3aHkgdGhlIHdhbGsgc3RvcHMgcmF0aGVyIHRoYW4gcmVjdXJzaW5nXG4gICAqIGZvcmV2ZXIuXG4gICAqL1xuICBjbGFzc01lbWJlcnMoY2xhc3NOYW1lOiBzdHJpbmcsIHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKSk6IEhkbFN5bWJvbFtdIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZ2V0KGNsYXNzTmFtZSk7XG4gICAgaWYgKCFlbnRyeSB8fCBzZWVuLmhhcyhjbGFzc05hbWUpKSByZXR1cm4gW107XG4gICAgc2Vlbi5hZGQoY2xhc3NOYW1lKTtcblxuICAgIGNvbnN0IG93biA9IFsuLi5lbnRyeS5wYXJhbWV0ZXJzLCAuLi5lbnRyeS5zeW1ib2xzXTtcbiAgICBjb25zdCBpbmhlcml0ZWQgPSBlbnRyeS5iYXNlQ2xhc3MgPyB0aGlzLmNsYXNzTWVtYmVycyhlbnRyeS5iYXNlQ2xhc3MsIHNlZW4pIDogW107XG5cbiAgICAvLyBUaGUgc3ViY2xhc3MgZGVjbGFyYXRpb24gc2hhZG93cyB0aGUgYmFzZSdzLCB3aGljaCBpcyB3aGF0IFNWIHNheXMuXG4gICAgcmV0dXJuIFsuLi5vd24sIC4uLmluaGVyaXRlZC5maWx0ZXIoKHMpID0+ICFvd24uc29tZSgobG9jYWwpID0+IGxvY2FsLm5hbWUgPT09IHMubmFtZSkpXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBFdmVyeSBpbmRleGVkIGRlc2lnbiB1bml0LCBhY3Jvc3MgYWxsIGZpbGVzIGFuZCBuYW1lcy5cbiAgICpcbiAgICogVGhlIFNpZ25hbCBUcmFjZXIgd2Fsa3MgdGhpcyB0byBmaW5kIHRoZSBpbnN0YW50aWF0aW9ucyBvZiBhIG1vZHVsZSwgd2hpY2hcbiAgICogaXMgdGhlIG9ubHkgd2F5IHRvIGZvbGxvdyBhIG5ldCB1cHdhcmRzLlxuICAgKi9cbiAgYWxsRW50cmllcygpOiBDYXRhbG9nRW50cnlbXSB7XG4gICAgcmV0dXJuIFsuLi50aGlzLmJ5TmFtZS52YWx1ZXMoKV0uZmxhdCgpO1xuICB9XG5cbiAgbG9jYXRpb25zKG5hbWU6IHN0cmluZyk6IExvY2F0aW9uW10ge1xuICAgIHJldHVybiB0aGlzLmFsbChuYW1lKS5tYXAoKGUpID0+ICh7IHVyaTogZS51cmksIHJhbmdlOiBlLnNlbGVjdGlvblJhbmdlIH0pKTtcbiAgfVxuXG4gIC8qKiBFdmVyeSBkZXNpZ24gdW5pdCBpbiB0aGUgd29ya3NwYWNlLCBmb3IgdGhlIGNvbXBsZXRpb24gbGlzdC4gKi9cbiAgdW5pdHMoKTogQ2F0YWxvZ0VudHJ5W10ge1xuICAgIGNvbnN0IG91dDogQ2F0YWxvZ0VudHJ5W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGxpc3Qgb2YgdGhpcy5ieU5hbWUudmFsdWVzKCkpIG91dC5wdXNoKC4uLmxpc3QpO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cbn1cblxuLyoqXG4gKiBXaGF0IGEgZG9jdW1lbnQgZGVjbGFyZXMsIGFzIG9uZSBjb21wYXJhYmxlIHN0cmluZy5cbiAqXG4gKiBPbmx5IHRoZSBwYXJ0cyB0aGF0IGNhbiBjaGFuZ2UgdGhlIHNoYXBlIG9mIHRoZSBkZXNpZ24gYXJlIHJlYWQ6IHdoaWNoIHVuaXRzXG4gKiBleGlzdCwgYW5kIHdoaWNoIG1vZHVsZXMgZWFjaCBvbmUgaW5zdGFudGlhdGVzLiBFdmVyeXRoaW5nIGVsc2UgYSBmaWxlIGRlY2xhcmVzXG4gKiAtLSBzaWduYWxzLCB3aWR0aHMsIGJvZGllcyAtLSBsZWF2ZXMgdGhpcyBzdHJpbmcgdW50b3VjaGVkLCB3aGljaCBpcyB3aGF0XG4gKiBrZWVwcyBhIGtleXN0cm9rZSBmcm9tIGludmFsaWRhdGluZyB0aGUgd29ya3NwYWNlLXdpZGUgYW5zd2VycyBidWlsdCBvbiB0b3Agb2ZcbiAqIGl0LlxuICovXG5mdW5jdGlvbiBzaGFwZU9mKHNjb3BlczogcmVhZG9ubHkgSGRsU2NvcGVbXSk6IHN0cmluZyB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3Qgc2NvcGUgb2Ygc2NvcGVzKSB7XG4gICAgaWYgKCFVTklUX0tJTkRTLmhhcyhzY29wZS5jYXRlZ29yeSkpIGNvbnRpbnVlO1xuICAgIHBhcnRzLnB1c2goYCR7c2NvcGUuY2F0ZWdvcnl9ICR7c2NvcGUubmFtZX1gKTtcbiAgICBmb3IgKGNvbnN0IGluc3RhbmNlIG9mIHNjb3BlLmluc3RhbmNlcykgcGFydHMucHVzaChgJHtzY29wZS5uYW1lfSA+ICR7aW5zdGFuY2UudHlwZU5hbWV9YCk7XG4gIH1cblxuICByZXR1cm4gcGFydHMuam9pbihcIlxcblwiKTtcbn1cbiIsICJpbXBvcnQgeyBwcm9taXNlcyBhcyBmcyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwibm9kZTpwYXRoXCI7XG5cbmltcG9ydCB0eXBlIHsgTm9kZSB9IGZyb20gXCJ3ZWItdHJlZS1zaXR0ZXJcIjtcblxuaW1wb3J0IHsgYW5hbHl6ZVRyZWUsIGNsYXNzTmFtZXNJbiB9IGZyb20gXCIuL2FuYWx5emVyLmpzXCI7XG5pbXBvcnQgeyBjb2xsZWN0TWFjcm9zLCB0eXBlIE1hY3JvVGFibGUgfSBmcm9tIFwiLi9tYWNyb3MuanNcIjtcbmltcG9ydCB7IENhdGFsb2cgfSBmcm9tIFwiLi9jYXRhbG9nLmpzXCI7XG5pbXBvcnQgeyBJbmNsdWRlUmVzb2x2ZXIsIHR5cGUgSW5jbHVkZURpcmVjdGl2ZSB9IGZyb20gXCIuL2luY2x1ZGVzLmpzXCI7XG5pbXBvcnQgeyBwYXRoVG9VcmksIHRvUG9zaXgsIHVyaVRvUGF0aCB9IGZyb20gXCIuL3BhdGhzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IFZlcmlsb2dQYXJzZXIgfSBmcm9tIFwiLi92ZXJpbG9nUGFyc2VyLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhPcHRpb25zIHtcbiAgaW5jbHVkZTogc3RyaW5nW107XG4gIGV4Y2x1ZGU6IHN0cmluZ1tdO1xuICAvKiogU2FmZXR5IHZhbHZlIHNvIGEgaHVnZSByZXBvIGNhbm5vdCBzdGFsbCB0aGUgc2VydmVyIG9uIHN0YXJ0dXAuICovXG4gIG1heEZpbGVzOiBudW1iZXI7XG59XG5cbi8qKiBIb3cgbWFueSB1bmRlZmluZWQgbWFjcm8gbmFtZXMgYXJlIHJlbWVtYmVyZWQgYmVmb3JlIGdpdmluZyB1cCBvbiB0aGUgbGlzdC4gKi9cbmNvbnN0IE1BWF9SRVBPUlRFRF9NQUNST1MgPSAyMDA7XG5cbi8qKlxuICogSG93IG1hbnkgcGFzc2VzIG9mIGhlYWRlciByZWFkaW5nIG9uZSBpbmNsdWRlIGNoYWluIG1heSB0YWtlLlxuICpcbiAqIEhlYWRlcnMgaW5jbHVkZSBoZWFkZXJzLCBzbyBhIHBhc3MgdGhhdCByZWFkcyBvbmUgbGVhdmVzIG1vcmUgdG8gcmVhZC4gQSByZWFsXG4gKiBjaGFpbiBpcyBhIGhhbmRmdWwgZGVlcDsgdGhlIGJvdW5kIGlzIHdoYXQgc3RvcHMgYSBwYWlyIG9mIGhlYWRlcnMgdGhhdFxuICogaW5jbHVkZSBlYWNoIG90aGVyIGZyb20gbG9vcGluZy5cbiAqL1xuY29uc3QgTUFYX0lOQ0xVREVfUk9VTkRTID0gODtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfSU5ERVhfT1BUSU9OUzogSW5kZXhPcHRpb25zID0ge1xuICAvLyBNdXN0IGNvdmVyIGV2ZXJ5IGV4dGVuc2lvbiB0aGUgcGFja2FnZSBkZWNsYXJlcyBhcyBTeXN0ZW1WZXJpbG9nIG9yIFZlcmlsb2cuXG4gIC8vIGAuc3ZwYCBob2xkcyBwYWNrYWdlIGRlZmluaXRpb25zLCBhbmQgbGVhdmluZyBpdCBvdXQgbWVhbnQgYSBwYWNrYWdlIGluIGFcbiAgLy8gYC5zdnBgIGZpbGUgd2FzIG9wZW5lZCwgaGlnaGxpZ2h0ZWQgYW5kIHdhdGNoZWQgYnkgdGhlIGVkaXRvciB3aGlsZSBpdHNcbiAgLy8gcGFyYW1ldGVycyBzdGF5ZWQgaW52aXNpYmxlIHRvIGV2ZXJ5IGxvb2t1cCB0aGF0IGNyb3NzZXMgYSBmaWxlIGJvdW5kYXJ5LlxuICBpbmNsdWRlOiBbXCIqKi8qLnN2XCIsIFwiKiovKi5zdmhcIiwgXCIqKi8qLnN2cFwiLCBcIioqLyoudlwiLCBcIioqLyoudmhcIl0sXG4gIGV4Y2x1ZGU6IFtcIioqL25vZGVfbW9kdWxlcy8qKlwiLCBcIioqLy5naXQvKipcIiwgXCIqKi9idWlsZC8qKlwiLCBcIioqL291dC8qKlwiXSxcbiAgbWF4RmlsZXM6IDUwMDAsXG59O1xuXG4vKiogQ29udmVydHMgYSBnbG9iIHdpdGggYCpgLCBgKipgIGFuZCBgP2AgaW50byBhbiBhbmNob3JlZCByZWd1bGFyIGV4cHJlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCBwYXR0ZXJuID0gXCJcIjtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2hhciA9IGdsb2JbaV0hO1xuICAgIGlmIChjaGFyID09PSBcIipcIikge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSBcIipcIikge1xuICAgICAgICBpZiAoZ2xvYltpICsgMl0gPT09IFwiL1wiKSB7XG4gICAgICAgICAgcGF0dGVybiArPSBcIig/Oi4qLyk/XCI7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHBhdHRlcm4gKz0gXCIuKlwiO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGF0dGVybiArPSBcIlteL10qXCI7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoYXIgPT09IFwiP1wiKSB7XG4gICAgICBwYXR0ZXJuICs9IFwiW14vXVwiO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChcIlxcXFxeJC58KygpW117fVwiLmluY2x1ZGVzKGNoYXIpKSB7XG4gICAgICBwYXR0ZXJuICs9IGBcXFxcJHtjaGFyfWA7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcGF0dGVybiArPSBjaGFyO1xuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtwYXR0ZXJufSRgKTtcbn1cblxuLyoqIE9uZSBmaWxlIHJlYWQgYnkgdGhlIHdhbGssIGhlbGQgdW50aWwgdGhlIHdob2xlIHdvcmtzcGFjZSBpcyBrbm93bi4gKi9cbmludGVyZmFjZSBQZW5kaW5nRmlsZSB7XG4gIHJlYWRvbmx5IGFic29sdXRlOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHVyaTogc3RyaW5nO1xuICByZWFkb25seSB0ZXh0OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQnVpbGRzIHRoZSBjcm9zcy1maWxlIGRlc2lnbi11bml0IGNhdGFsb2cuXG4gKlxuICogUnVucyBvbmNlIGF0IHN0YXJ0dXAgYW5kIGlzIHJlZnJlc2hlZCB3aGVuIGEgd29ya3NwYWNlIGZvbGRlciBpcyBhZGRlZC4gT3BlblxuICogZG9jdW1lbnRzIGFyZSBhbHdheXMgaW5kZXhlZCBzZXBhcmF0ZWx5IGFzIHRoZXkgY2hhbmdlLCBzbyBhIHN0YWxlIGRpc2sgaW5kZXhcbiAqIG5ldmVyIGJsb2NrcyBuYXZpZ2F0aW9uIGluIHRoZSBmaWxlIHRoZSB1c2VyIGlzIGVkaXRpbmcuXG4gKi9cbmV4cG9ydCBjbGFzcyBXb3Jrc3BhY2VJbmRleGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpbmNsdWRlUmVzOiBSZWdFeHBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBleGNsdWRlUmVzOiBSZWdFeHBbXTtcbiAgcHJpdmF0ZSBpbmRleGVkID0gMDtcbiAgcHJpdmF0ZSB0cnVuY2F0ZWQgPSBmYWxzZTtcbiAgLyoqXG4gICAqIENsYXNzIG5hbWVzIGFjcm9zcyB0aGUgd2hvbGUgd29ya3NwYWNlLlxuICAgKlxuICAgKiBBbmFseXNpcyBuZWVkcyB0aGVtIHRvIHJlY29nbmlzZSBgUGFja2V0IHBrdDtgIGFzIGFuIG9iamVjdCByYXRoZXIgdGhhbiBhXG4gICAqIG9uZS1iaXQgbmV0LCBhbmQgdGhlIGZpbGUgZGVjbGFyaW5nIGBQYWNrZXRgIG1heSBiZSByZWFkICphZnRlciogdGhlIGZpbGVcbiAgICogdGhhdCB1c2VzIGl0LiBTbyB0aGUgd2FsayByZWFkcyBmaXJzdCBhbmQgcGFyc2VzIHNlY29uZC5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgY2xhc3NOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIC8qKiBFdmVyeSBtYWNybyBkZWZpbmVkIGluIHRoZSB3b3Jrc3BhY2UsIHNvIGFueSBmaWxlIGNhbiBleHBhbmQgYW55IG9mIHRoZW0uICovXG4gIHByaXZhdGUgcmVhZG9ubHkgbWFjcm9UYWJsZTogTWFjcm9UYWJsZSA9IG5ldyBNYXAoKTtcblxuICAvKiogSGVhZGVycyBhbiBgaW5jbHVkZWAgbmFtZWQgYW5kIHRoZSB3YWxrIGhhcyBub3QgcmVhZCB5ZXQuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgcGVuZGluZ0luY2x1ZGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIC8qKiBGaWxlcyB0aGlzIGluZGV4ZXIgaGFzIGFjdHVhbGx5IHBhcnNlZCwgc28gbm9uZSBpcyByZWFkIHR3aWNlLiAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGluZGV4ZWRQYXRocyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIC8qKlxuICAgKiBNYWNybyBjYWxscyB0aGUgd29ya3NwYWNlIG5ldmVyIGRlZmluZXMsIGFuZCB3aGVyZSB0aGV5IHdlcmUgc2Vlbi5cbiAgICpcbiAgICogYGluY2x1ZGVgIGlzIG5vdCBmb2xsb3dlZCwgc28gYSBtYWNybyB0aGF0IGxpdmVzIGluIGEgZmlsZSB0aGUgZWRpdG9yXG4gICAqIGNhbm5vdCByZWFjaCAtLSBhIHZlbmRvciBsaWJyYXJ5LCBhIGZpbGUgbGlzdCBvdXRzaWRlIHRoZSB3b3Jrc3BhY2UgLS0gaXNcbiAgICogaW52aXNpYmxlLCBhbmQgZXZlcnkgc2lnbmFsIGl0IGRlY2xhcmVzIHJlYWRzIGFzIHVuZGVjbGFyZWQuIFRoYXQgbG9va3NcbiAgICogbGlrZSBhIHRvb2wgYnVnIGZyb20gaW5zaWRlIHRoZSBlZGl0b3IsIHNvIHRoZSBuYW1lcyBhcmUgcmVjb3JkZWQgYW5kXG4gICAqIGxvZ2dlZCByYXRoZXIgdGhhbiBsZWZ0IHRvIGJlIGd1ZXNzZWQgYXQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHVucmVzb2x2ZWRNYWNyb3MgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG5cbiAgLyoqIE1hY3JvIGNhbGxzIHdpdGggbm8gZGVmaW5pdGlvbiwgYXMgYG5hbWUgLT4gZmlsZXMgdGhhdCBjYWxsIGl0YC4gKi9cbiAgZ2V0IHVuZGVmaW5lZE1hY3JvcygpOiBSZWFkb25seU1hcDxzdHJpbmcsIFJlYWRvbmx5U2V0PHN0cmluZz4+IHtcbiAgICByZXR1cm4gdGhpcy51bnJlc29sdmVkTWFjcm9zO1xuICB9XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBwYXJzZXI6IFZlcmlsb2dQYXJzZXIsXG4gICAgcmVhZG9ubHkgY2F0YWxvZzogQ2F0YWxvZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IEluZGV4T3B0aW9ucyA9IERFRkFVTFRfSU5ERVhfT1BUSU9OUyxcbiAgICAvKipcbiAgICAgKiBTaGFyZWQgYWNyb3NzIGluZGV4ZXIgaW5zdGFuY2VzIG9uIHB1cnBvc2UuXG4gICAgICpcbiAgICAgKiBUaGUgc2VydmVyIGJ1aWxkcyBhIHNlY29uZCBpbmRleGVyIHdoZW4gc2V0dGluZ3MgYXJyaXZlIHdpdGggdGhlXG4gICAgICogaGFuZHNoYWtlLCBhbmQgYSBmcmVzaCByZXNvbHZlciB3b3VsZCBzdGFydCBrbm93aW5nIG5vdGhpbmcgLS0gdGhlXG4gICAgICogaW5jbHVkZXMgcmVzb2x2ZWQgZHVyaW5nIHN0YXJ0dXAgd291bGQgYmUgZm9yZ290dGVuLCBhbmQgdGhlIHNlY29uZCBwYXNzXG4gICAgICogd291bGQgaGF2ZSB0byBsZWFybiB0aGUgc2FtZSBhbnN3ZXJzIGFnYWluLlxuICAgICAqL1xuICAgIHJlYWRvbmx5IGluY2x1ZGVzOiBJbmNsdWRlUmVzb2x2ZXIgPSBuZXcgSW5jbHVkZVJlc29sdmVyKCksXG4gICkge1xuICAgIHRoaXMuaW5jbHVkZVJlcyA9IG9wdGlvbnMuaW5jbHVkZS5tYXAoZ2xvYlRvUmVnRXhwKTtcbiAgICB0aGlzLmV4Y2x1ZGVSZXMgPSBvcHRpb25zLmV4Y2x1ZGUubWFwKGdsb2JUb1JlZ0V4cCk7XG4gIH1cblxuICBnZXQgZmlsZXNJbmRleGVkKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXhlZDtcbiAgfVxuXG4gIGdldCB3YXNUcnVuY2F0ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMudHJ1bmNhdGVkO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGBmb2xkZXJzYCBpbnRvIHRoZSBpbmRleCwgYWRkaW5nIHRvIHdoYXRldmVyIGlzIGFscmVhZHkgdGhlcmUuXG4gICAqXG4gICAqIEFkZGl0aXZlIG9uIHB1cnBvc2UuIFRoZSB3b3Jrc3BhY2Ugcm9vdCBpcyBpbmRleGVkIG9uY2UgYXQgc3RhcnR1cCwgYW5kXG4gICAqIHRoZW4gYSBmb2xkZXIgaXMgaW5kZXhlZCBhZ2FpbiBhcyBzb29uIGFzIGEgZmlsZSBpbiBpdCBpcyBvcGVuZWQgLS0gYW5kXG4gICAqIG9wZW5pbmcgYHJ0bC9wYXR0ZXJuX2dlbmVyYXRvci52YCBtdXN0IG5vdCBlcmFzZSB3aGF0IGBjb21tb24vdG1yLnZgXG4gICAqIGNvbnRyaWJ1dGVkLiBDbGVhcmluZyBoZXJlIHRocmV3IGF3YXkgZXZlcnkgbWFjcm8gYW5kIGNsYXNzIG5hbWUgbGVhcm5lZFxuICAgKiBmcm9tIHRoZSByZXN0IG9mIHRoZSBwcm9qZWN0LCBhbmQgdGhlIGZpbGUgdGhhdCBoYWQganVzdCBiZWVuIHJlYWQgbG9zdFxuICAgKiBhbGwgdGhpcnR5LWZpdmUgb2YgaXRzIG1hY3JvLWRlY2xhcmVkIHNpZ25hbHMuXG4gICAqXG4gICAqIEEgZnJlc2ggcGFzcyBvdmVyIGV2ZXJ5dGhpbmcgaXMgbm90IG5lZWRlZCB3aGVuIHNldHRpbmdzIGNoYW5nZTogdGhlXG4gICAqIHNlcnZlciBidWlsZHMgYSBuZXcgaW5kZXhlciBmb3IgdGhhdCwgd2hpY2ggc3RhcnRzIGVtcHR5IG9uIGl0cyBvd24uXG4gICAqL1xuICBhc3luYyBpbmRleEZvbGRlcnMoZm9sZGVyczogc3RyaW5nW10pOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGxldCBjb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBmb2xkZXJzKSB7XG4gICAgICB0aGlzLmluY2x1ZGVzLm5vdGVSb290KGZvbGRlcik7XG5cbiAgICAgIC8vIFJlYWQgZXZlcnkgZmlsZSwgbGVhcm4gZXZlcnkgY2xhc3MgbmFtZSBhbmQgZXZlcnkgbWFjcm8sIHRoZW4gcGFyc2UuXG4gICAgICAvLyBEb2luZyBpdCB0aGUgb3RoZXIgd2F5IHJvdW5kIG1ha2VzIHRoZSBhbnN3ZXIgZGVwZW5kIG9uIGRpcmVjdG9yeVxuICAgICAgLy8gb3JkZXIsIHdoaWNoIGlzIGV4YWN0bHkgdGhlIGtpbmQgb2YgYnVnIHRoYXQgb25seSBzaG93cyB1cCBvbiBzb21lb25lXG4gICAgICAvLyBlbHNlJ3MgbWFjaGluZS5cbiAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgdGhpcy5jb2xsZWN0KGZvbGRlcik7XG4gICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGNsYXNzTmFtZXNJbihmaWxlLnRleHQpKSB0aGlzLmNsYXNzTmFtZXMuYWRkKG5hbWUpO1xuICAgICAgICB0aGlzLnJlYWRNYWNyb3MoZmlsZSk7XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgICB0aGlzLnBhcnNlKGZpbGUpO1xuICAgICAgICBjb3VudCsrO1xuICAgICAgICAvLyBIYW5kIHRoZSBldmVudCBsb29wIGJhY2sgYmV0d2VlbiBmaWxlcy5cbiAgICAgICAgLy9cbiAgICAgICAgLy8gUGFyc2luZyBpcyBzeW5jaHJvbm91cyBhbmQgQ1BVLWJvdW5kLCBzbyBhIGZldyBodW5kcmVkIGZpbGVzIHdvdWxkXG4gICAgICAgIC8vIG90aGVyd2lzZSBiZSBvbmUgbG9uZyBibG9jayBpbiB3aGljaCB0aGUgc2VydmVyIGFuc3dlcnMgbm90aGluZzogbm9cbiAgICAgICAgLy8gaG92ZXIsIG5vIGNvbXBsZXRpb24sIGFuZCB0aGUgZWRpdG9yJ3Mgb3duIHJlcXVlc3RzIHF1ZXVlIHVwIGJlaGluZFxuICAgICAgICAvLyB0aGUgaW5kZXguIFlpZWxkaW5nIGNvc3RzIGEgZmV3IG1pY3Jvc2Vjb25kcyBwZXIgZmlsZSBhbmQgdHVybnMgYVxuICAgICAgICAvLyB2aXNpYmxlIHN0YWxsIGludG8gYSBiYWNrZ3JvdW5kIHRhc2suXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiBzZXRJbW1lZGlhdGUocmVzb2x2ZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhlYWRlcnMgcmVhY2hlZCBvbmx5IHRocm91Z2ggYW4gYGluY2x1ZGVgIGFyZSBwYXJ0IG9mIHRoZSB3b3Jrc3BhY2UsIGFuZFxuICAgIC8vIHdoYXRldmVyIHRoZXkgZGVjbGFyZSBpcyBleGFjdGx5IHdoYXQgdGhlIGZpbGVzIGluY2x1ZGluZyB0aGVtIGFyZVxuICAgIC8vIG1pc3NpbmcuIFJlYWRpbmcgdGhlbSBoZXJlIGlzIHdoYXQgY2xvc2VzIHRoYXQgZ2FwIGJlZm9yZSB0aGUgb3BlblxuICAgIC8vIGRvY3VtZW50cyBhcmUgcmUtYW5hbHlzZWQuXG4gICAgY291bnQgKz0gYXdhaXQgdGhpcy5pbmRleFJlYWNoZWRJbmNsdWRlcygpO1xuXG4gICAgcmV0dXJuIGNvdW50O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIHRoZSBmaWxlcyBhbiBgaW5jbHVkZWAgbmFtZWQgYW5kIHRoZSBmb2xkZXIgd2FsayBuZXZlciB2aXNpdGVkLlxuICAgKlxuICAgKiBBIGhlYWRlciBkb2VzIG5vdCBoYXZlIHRvIGJlIHVuZGVyIGFuIGluZGV4ZWQgZm9sZGVyIHRvIGJlIHBhcnQgb2YgdGhlXG4gICAqIGRlc2lnbjogYSBwYWNrYWdlIHNpdHMgd2hlcmV2ZXIgdGhlIHByb2plY3Qga2VlcHMgaXRzIHBhY2thZ2VzLCBhbmQgdGhlXG4gICAqIGluY2x1ZGUgdGhhdCBuYW1lcyBpdCBpcyBvZnRlbiB0aGUgb25seSB0aGluZyB0aGF0IHNheXMgd2hlcmUuIEZvbGxvd2luZyBpdFxuICAgKiBpcyB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIGBgIGNmZ19wa2c6OldJRFRIIGBgIHJlc29sdmluZyBhbmQgdGhlIGZpbGVcbiAgICogZGVjbGFyaW5nIGFuIHVuZGVjbGFyZWQgbW9kdWxlLCBhbmQgbm90aGluZyBlbHNlIGluIHRoZSBpbmRleCB3b3VsZCBmaW5kIGl0LlxuICAgKlxuICAgKiBPbmx5IGZpbGVzIHJlYWNoYWJsZSBmcm9tIGEgcmVzb2x2ZWQgaW5jbHVkZSBhcmUgcmVhZCwgc28gdGhpcyBjYW5ub3Qgd2Fsa1xuICAgKiB0aGUgZmlsZXN5c3RlbSAtLSB0aGUgcGF0aHMgY29tZSBmcm9tIHNvdXJjZSwgYW5kIGV2ZXJ5IG9uZSBvZiB0aGVtIGlzXG4gICAqIGNoZWNrZWQgYWdhaW5zdCB0aGUgZXhjbHVkZSBwYXR0ZXJucyBmaXJzdC5cbiAgICovXG4gIGFzeW5jIGluZGV4UmVhY2hlZEluY2x1ZGVzKCk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgbGV0IHRvdGFsID0gMDtcblxuICAgIC8vIEhlYWRlcnMgaW5jbHVkZSBoZWFkZXJzLCBhbmQgdGhlIG9uZSB0aGF0IGRlY2xhcmVzIHRoZSB0eXBlIGlzIG9mdGVuIHRoZVxuICAgIC8vIGZ1cnRoZXN0IGF3YXkgLS0gc28gYSBwYXNzIHRoYXQgcmVhZCBhIGhlYWRlciBsZWF2ZXMgbW9yZSB0byByZWFkLiBUaGVcbiAgICAvLyByb3VuZHMgYXJlIGJvdW5kZWQgYnkgdGhlIGRlcHRoIG9mIGFueSByZWFsIGNoYWluLCBub3QgYnkgdGhlIGZpbGUgY291bnQuXG4gICAgZm9yIChsZXQgcm91bmQgPSAwOyByb3VuZCA8IE1BWF9JTkNMVURFX1JPVU5EUzsgcm91bmQrKykge1xuICAgICAgY29uc3Qgd2FudGVkOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMucGVuZGluZ0luY2x1ZGVzKSB7XG4gICAgICAgIGlmICh0aGlzLmluZGV4ZWRQYXRocy5oYXMoZmlsZSkpIGNvbnRpbnVlO1xuICAgICAgICB3YW50ZWQucHVzaChmaWxlKTtcbiAgICAgIH1cbiAgICAgIHRoaXMucGVuZGluZ0luY2x1ZGVzLmNsZWFyKCk7XG4gICAgICBpZiAod2FudGVkLmxlbmd0aCA9PT0gMCkgYnJlYWs7XG5cbiAgICAgIHRvdGFsICs9IGF3YWl0IHRoaXMucmVhZEluY2x1ZGVkKHdhbnRlZCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRvdGFsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGFuZCBhbmFseXNlcyBhIHNldCBvZiBoZWFkZXJzLCBsZWFybmluZyBmcm9tIGFsbCBvZiB0aGVtIGZpcnN0LlxuICAgKlxuICAgKiBUaGUgc2FtZSB0d28tcGFzcyBvcmRlciB0aGUgZm9sZGVyIHdhbGsgdXNlczogYSBtYWNybyBkZWZpbmVkIGluIG9uZSBoZWFkZXJcbiAgICogaXMgdXNlZCBieSBhbm90aGVyLCBhbmQgdGhlIGFuc3dlciBtdXN0IG5vdCBkZXBlbmQgb24gd2hpY2ggd2FzIHJlYWNoZWRcbiAgICogZmlyc3QuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlYWRJbmNsdWRlZChhYnNvbHV0ZVBhdGhzOiByZWFkb25seSBzdHJpbmdbXSk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3QgcmVhZDogUGVuZGluZ0ZpbGVbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgYWJzb2x1dGUgb2YgYWJzb2x1dGVQYXRocykge1xuICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHRoaXMucmVhZChhYnNvbHV0ZSk7XG4gICAgICBpZiAodGV4dCAhPT0gdW5kZWZpbmVkKSByZWFkLnB1c2goeyBhYnNvbHV0ZSwgdXJpOiBwYXRoVG9VcmkoYWJzb2x1dGUpLCB0ZXh0IH0pO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiByZWFkKSB7XG4gICAgICB0aGlzLmluY2x1ZGVzLm5vdGVGaWxlKGZpbGUuYWJzb2x1dGUpO1xuICAgICAgZm9yIChjb25zdCBuYW1lIG9mIGNsYXNzTmFtZXNJbihmaWxlLnRleHQpKSB0aGlzLmNsYXNzTmFtZXMuYWRkKG5hbWUpO1xuICAgICAgdGhpcy5yZWFkTWFjcm9zKGZpbGUpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiByZWFkKSB7XG4gICAgICB0aGlzLnBhcnNlKGZpbGUpO1xuICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHNldEltbWVkaWF0ZShyZXNvbHZlKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlYWQubGVuZ3RoO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBpbmNsdWRlcyBvZiBhbiBvcGVuIGRvY3VtZW50IGFuZCBxdWV1ZXMgdGhlIGZpbGVzIHRoZXkgbmFtZS5cbiAgICpcbiAgICogVGhlIGRpcmVjdGl2ZXMgY29tZSBmcm9tIHRoZSBkb2N1bWVudCdzIG93biBhbmFseXNpcywgc28gdGhpcyBjb3N0cyBhIG1hcFxuICAgKiBsb29rdXAgcGVyIGRpcmVjdGl2ZSByYXRoZXIgdGhhbiBhbm90aGVyIHBhc3Mgb3ZlciB0aGUgdHJlZS4gV2l0aCBub1xuICAgKiB3b3Jrc3BhY2UgZm9sZGVyIG9wZW4gdGhlIHdhbGsgbmV2ZXIgc2VlcyBhIGZvbGRlciBidXQgdGhlIGxvb3NlIGZpbGUncyxcbiAgICogYW5kIHRoZSBwYWNrYWdlIGl0IHB1bGxzIGluIGlzIHRoZSBvbmUgdGhpbmcgdGhlIGF1dGhvciBpcyBsb29raW5nIGF0LlxuICAgKi9cbiAgZm9sbG93SW5jbHVkZXModXJpOiBzdHJpbmcsIGRpcmVjdGl2ZXM6IHJlYWRvbmx5IEluY2x1ZGVEaXJlY3RpdmVbXSk6IHZvaWQge1xuICAgIGNvbnN0IGFic29sdXRlID0gdXJpVG9QYXRoKHVyaSk7XG4gICAgaWYgKCFhYnNvbHV0ZSkgcmV0dXJuO1xuXG4gICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuaW5jbHVkZXMubm90ZUluY2x1ZGVzKGFic29sdXRlLCBkaXJlY3RpdmVzKSkge1xuICAgICAgaWYgKCF0aGlzLmluZGV4ZWRQYXRocy5oYXMoZWRnZS5hYnNvbHV0ZSkpIHRoaXMucGVuZGluZ0luY2x1ZGVzLmFkZChlZGdlLmFic29sdXRlKTtcbiAgICB9XG4gIH1cblxuICAvKiogRm9yZ2V0cyBhIGNsb3NlZCBkb2N1bWVudCdzIGVkZ2VzLCBzbyBhIHN0YWxlIGhlYWRlciBpcyBub3QgY2hhc2VkLiAqL1xuICBmb3JnZXREb2N1bWVudCh1cmk6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGFic29sdXRlID0gdXJpVG9QYXRoKHVyaSk7XG4gICAgaWYgKGFic29sdXRlKSB0aGlzLmluY2x1ZGVzLmZvcmdldChhYnNvbHV0ZSk7XG4gIH1cblxuICAvKipcbiAgICogTGVhcm5zIHRoZSBtYWNyb3MgYSBmaWxlIGRlZmluZXMsIGJlZm9yZSBhbnkgZmlsZSBpcyBhbmFseXNlZC5cbiAgICpcbiAgICogQ29sbGVjdGVkIHVwIGZyb250IHJhdGhlciB0aGFuIGR1cmluZyB0aGUgcGFyc2Ugc28gdGhhdCBhIGZpbGUgc2VlcyBldmVyeVxuICAgKiBtYWNybyBpbiB0aGUgZm9sZGVyIG5vIG1hdHRlciB3aGljaCBvZiB0aGVtIHRoZSBkaXJlY3Rvcnkgd2FsayByZWFjaGVkXG4gICAqIGZpcnN0LiBPbmx5IGZpbGVzIHRoYXQgbWVudGlvbiBhIGJhY2t0aWNrIGFyZSBwYXJzZWQgaGVyZSwgc28gdGhlIGV4dHJhXG4gICAqIHBhcnNlIGZhbGxzIG9uIGhlYWRlcnMgLS0gdGhlIG9uZSBwbGFjZSBhIGBgIGBkZWZpbmUgYGAgbGl2ZXMuXG4gICAqL1xuICBwcml2YXRlIHJlYWRNYWNyb3MoZmlsZTogUGVuZGluZ0ZpbGUpOiB2b2lkIHtcbiAgICBpZiAoIWZpbGUudGV4dC5pbmNsdWRlcyhcImBcIikpIHJldHVybjtcblxuICAgIGxldCB0cmVlOiBSZXR1cm5UeXBlPFZlcmlsb2dQYXJzZXJbXCJwYXJzZVwiXT4gfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIHRyZWUgPSB0aGlzLnBhcnNlci5wYXJzZShmaWxlLnRleHQpO1xuICAgICAgZm9yIChjb25zdCBtYWNybyBvZiBjb2xsZWN0TWFjcm9zKHRyZWUsIGZpbGUudGV4dCkpIHRoaXMubWFjcm9UYWJsZS5zZXQobWFjcm8ubmFtZSwgbWFjcm8pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQSBtYWxmb3JtZWQgZmlsZSBtdXN0IG5vdCBhYm9ydCB0aGUgd2hvbGUgaW5kZXguXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRyZWU/LmRlbGV0ZSgpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29sbGVjdChyb290OiBzdHJpbmcsIGRpcmVjdG9yeSA9IHJvb3QsIGludG86IFBlbmRpbmdGaWxlW10gPSBbXSk6IFByb21pc2U8UGVuZGluZ0ZpbGVbXT4ge1xuICAgIGlmIChpbnRvLmxlbmd0aCA+PSB0aGlzLm9wdGlvbnMubWF4RmlsZXMpIHtcbiAgICAgIHRoaXMudHJ1bmNhdGVkID0gdHJ1ZTtcbiAgICAgIHJldHVybiBpbnRvO1xuICAgIH1cblxuICAgIGxldCBlbnRyaWVzO1xuICAgIHRyeSB7XG4gICAgICBlbnRyaWVzID0gYXdhaXQgZnMucmVhZGRpcihkaXJlY3RvcnksIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBpbnRvOyAvLyB1bnJlYWRhYmxlIGRpcmVjdG9yeTogc2tpcCBzaWxlbnRseVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgaWYgKGludG8ubGVuZ3RoID49IHRoaXMub3B0aW9ucy5tYXhGaWxlcykge1xuICAgICAgICB0aGlzLnRydW5jYXRlZCA9IHRydWU7XG4gICAgICAgIHJldHVybiBpbnRvO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhYnNvbHV0ZSA9IHBhdGguam9pbihkaXJlY3RvcnksIGVudHJ5Lm5hbWUpO1xuXG4gICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAvLyBDaGVhcCBwcmUtZmlsdGVyIGJlZm9yZSByZWN1cnNpbmcuXG4gICAgICAgIGNvbnN0IHJlbERpciA9IHRvUG9zaXgocGF0aC5yZWxhdGl2ZShyb290LCBhYnNvbHV0ZSkpICsgXCIvXCI7XG4gICAgICAgIGlmICh0aGlzLmV4Y2x1ZGVSZXMuc29tZSgocmUpID0+IG1hdGNoZXNHbG9iRGlyKHJlLCByZWxEaXIpKSkgY29udGludWU7XG4gICAgICAgIGF3YWl0IHRoaXMuY29sbGVjdChyb290LCBhYnNvbHV0ZSwgaW50byk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWVudHJ5LmlzRmlsZSgpKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgcmVsYXRpdmUgPSB0b1Bvc2l4KHBhdGgucmVsYXRpdmUocm9vdCwgYWJzb2x1dGUpKTtcbiAgICAgIGlmICghdGhpcy5pbmNsdWRlUmVzLnNvbWUoKHJlKSA9PiByZS50ZXN0KHJlbGF0aXZlKSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHRoaXMuZXhjbHVkZVJlcy5zb21lKChyZSkgPT4gcmUudGVzdChyZWxhdGl2ZSkpKSBjb250aW51ZTtcblxuICAgICAgLy8gTm90ZWQgYmVmb3JlIHRoZSBmaWxlIGlzIHJlYWQ6IGEgbmFtZSBpbiB0aGlzIGZvbGRlciBpcyByZXNvbHZhYmxlIGV2ZW5cbiAgICAgIC8vIGlmIHRoZSBmaWxlIGl0c2VsZiB0dXJucyBvdXQgdG8gYmUgdW5yZWFkYWJsZSwgYW5kIHRoZSBuZXh0IGRvY3VtZW50XG4gICAgICAvLyB0aGF0IGluY2x1ZGVzIHNvbWV0aGluZyBmcm9tIGhlcmUgZGVzZXJ2ZXMgdGhlIHNhbWUgc2VhcmNoLlxuICAgICAgdGhpcy5pbmNsdWRlcy5ub3RlRmlsZShhYnNvbHV0ZSk7XG5cbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCB0aGlzLnJlYWQoYWJzb2x1dGUpO1xuICAgICAgaWYgKHRleHQgIT09IHVuZGVmaW5lZCkgaW50by5wdXNoKHsgYWJzb2x1dGUsIHVyaTogcGF0aFRvVXJpKGFic29sdXRlKSwgdGV4dCB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gaW50bztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZChhYnNvbHV0ZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzLnN0YXQoYWJzb2x1dGUpO1xuICAgICAgLy8gU2tpcCBhbnl0aGluZyBhIGh1bWFuIGNvdWxkIG5vdCBwbGF1c2libHkgd2FudCBwYXJzZWQuXG4gICAgICBpZiAoc3RhdC5zaXplID4gNCAqIDEwMjQgKiAxMDI0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgcmV0dXJuIGF3YWl0IGZzLnJlYWRGaWxlKGFic29sdXRlLCBcInV0ZjhcIik7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGFyc2UoZmlsZTogUGVuZGluZ0ZpbGUpOiB2b2lkIHtcbiAgICBsZXQgdHJlZTogUmV0dXJuVHlwZTxWZXJpbG9nUGFyc2VyW1wicGFyc2VcIl0+IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICB0cmVlID0gdGhpcy5wYXJzZXIucGFyc2UoZmlsZS50ZXh0KTtcblxuICAgICAgLy8gYHJlYWRNYWNyb3NgIGFscmVhZHkgY29sbGVjdGVkIGV2ZXJ5IG1hY3JvIGluIHRoZSBmb2xkZXIgYmVmb3JlIHRoaXNcbiAgICAgIC8vIGxvb3Agc3RhcnRlZCwgc28gYnkgbm93IHRoZSB0YWJsZSBpcyBjb21wbGV0ZTogYSBgTkFNRShhcmdzKVxuICAgICAgLy8gZGVjbGFyYXRpb24gaGVyZSBjYW4gc3RhbmQgZm9yIHNvbWV0aGluZyBhIGhlYWRlciBkZWZpbmVzLCB3aGljaGV2ZXJcbiAgICAgIC8vIG9yZGVyIHRoZSBkaXJlY3Rvcnkgd2FsayBwcm9kdWNlZC5cbiAgICAgIHRoaXMubm90ZVVuZGVmaW5lZE1hY3Jvcyh0cmVlLCBmaWxlKTtcblxuICAgICAgY29uc3QgYW5hbHlzaXMgPSBhbmFseXplVHJlZSh0cmVlLCBmaWxlLnRleHQsIHRoaXMuY2xhc3NOYW1lcywgdW5kZWZpbmVkLCB0aGlzLm1hY3Jvcyk7XG5cbiAgICAgIC8vIFdoYXQgdGhpcyBmaWxlIHB1bGxzIGluLCByZWFkIGZyb20gdGhlIHNhbWUgdHJhdmVyc2FsLiBUaGUgaGVhZGVycyBhcmVcbiAgICAgIC8vIHF1ZXVlZCB3aGV0aGVyIG9yIG5vdCB0aGUgd2FsayB3aWxsIHJlYWNoIHRoZW06IG9uZSBpbnNpZGUgdGhlIGZvbGRlclxuICAgICAgLy8gYmVpbmcgcmVhZCBpcyBkcm9wcGVkIGFnYWluIGJlbG93LCBvbmUgb3V0c2lkZSBpdCBpcyByZWFkIGFmdGVyLlxuICAgICAgdGhpcy5pbmNsdWRlcy5ub3RlSW5jbHVkZXMoZmlsZS5hYnNvbHV0ZSwgYW5hbHlzaXMuaW5jbHVkZXMpO1xuICAgICAgZm9yIChjb25zdCBlZGdlIG9mIHRoaXMuaW5jbHVkZXMuaW5jbHVkZXNPZihmaWxlLmFic29sdXRlKSkge1xuICAgICAgICBpZiAoIXRoaXMuaW5kZXhlZFBhdGhzLmhhcyhlZGdlKSkgdGhpcy5wZW5kaW5nSW5jbHVkZXMuYWRkKGVkZ2UpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmNhdGFsb2cucmVwbGFjZURvY3VtZW50KFxuICAgICAgICBmaWxlLnVyaSxcbiAgICAgICAgYW5hbHlzaXMuc2NvcGVzLFxuICAgICAgICBhbmFseXNpcy5hY2Nlc3NlcyxcbiAgICAgICAgYW5hbHlzaXMudW5pdFN5bWJvbHMsXG4gICAgICApO1xuICAgICAgdGhpcy5pbmRleGVkKys7XG4gICAgICB0aGlzLmluZGV4ZWRQYXRocy5hZGQodG9Qb3NpeChmaWxlLmFic29sdXRlKSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBIG1hbGZvcm1lZCBmaWxlIG11c3Qgbm90IGFib3J0IHRoZSB3aG9sZSBpbmRleC5cbiAgICB9IGZpbmFsbHkge1xuICAgICAgdHJlZT8uZGVsZXRlKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlY29yZHMgbWFjcm8gY2FsbHMgdGhhdCBubyBmaWxlIGluIHRoZSB3b3Jrc3BhY2UgZGVmaW5lcy5cbiAgICpcbiAgICogVGhlIG5hbWUgaXMgbm90IGEgY29tcGlsZXIgZGlyZWN0aXZlLCBhbmQgaXQgaXMgbm90IGluIHRoZSB0YWJsZSwgc28gbm90aGluZ1xuICAgKiBpbiB0aGUgd29ya3NwYWNlIGNhbiBzYXkgd2hhdCBpdCBleHBhbmRzIHRvLiBTYXlpbmcgc28gb3V0IGxvdWQgaXMgdGhlXG4gICAqIGRpZmZlcmVuY2UgYmV0d2VlbiBcInRoZSB0b29sIGlzIGJyb2tlblwiIGFuZCBcInRoYXQgbWFjcm8gaXMgaW4gYSBoZWFkZXIgdGhlXG4gICAqIGVkaXRvciBjYW5ub3QgcmVhY2hcIi5cbiAgICovXG4gIHByaXZhdGUgbm90ZVVuZGVmaW5lZE1hY3Jvcyh0cmVlOiBSZXR1cm5UeXBlPFZlcmlsb2dQYXJzZXJbXCJwYXJzZVwiXT4sIGZpbGU6IFBlbmRpbmdGaWxlKTogdm9pZCB7XG4gICAgaWYgKHRoaXMudW5yZXNvbHZlZE1hY3Jvcy5zaXplID49IE1BWF9SRVBPUlRFRF9NQUNST1MpIHJldHVybjtcblxuICAgIGNvbnN0IHN0YWNrOiBOb2RlW10gPSBbdHJlZS5yb290Tm9kZSBhcyBOb2RlXTtcbiAgICB3aGlsZSAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgbm9kZSA9IHN0YWNrLnBvcCgpITtcblxuICAgICAgaWYgKG5vZGUudHlwZSA9PT0gXCJ0ZXh0X21hY3JvX3VzYWdlXCIpIHtcbiAgICAgICAgY29uc3QgbmFtZSA9IG5vZGUubmFtZWRDaGlsZCgwKT8udGV4dCA/PyBcIlwiO1xuICAgICAgICAvLyBBIGRpcmVjdGl2ZSAoYGlmZGVmLCBgaW5jbHVkZSkgaXMgbm90IGEgbWFjcm8gY2FsbCwgc28gaXQgbmV2ZXJcbiAgICAgICAgLy8gcmVhY2hlcyBoZXJlOyBhbnl0aGluZyBuYW1lZCBpcyBhIGNhbGwgdGhhdCBub3RoaW5nIGNhbiBleHBhbmQuXG4gICAgICAgIGlmIChuYW1lLmxlbmd0aCA+IDAgJiYgIXRoaXMubWFjcm9UYWJsZS5oYXMobmFtZSkgJiYgIXRoaXMudW5yZXNvbHZlZE1hY3Jvcy5oYXMobmFtZSkpIHtcbiAgICAgICAgICB0aGlzLnVucmVzb2x2ZWRNYWNyb3Muc2V0KG5hbWUsIG5ldyBTZXQoW2ZpbGUuYWJzb2x1dGVdKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLnR5cGUgPT09IFwidGV4dF9tYWNyb19kZWZpbml0aW9uXCIpIGNvbnRpbnVlO1xuXG4gICAgICBmb3IgKGxldCBpID0gbm9kZS5jaGlsZENvdW50IC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgY29uc3QgY2hpbGQgPSBub2RlLmNoaWxkKGkpO1xuICAgICAgICBpZiAoY2hpbGQpIHN0YWNrLnB1c2goY2hpbGQgYXMgTm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEV2ZXJ5IG1hY3JvIGRlZmluZWQgYW55d2hlcmUgaW4gdGhlIHdvcmtzcGFjZS5cbiAgICpcbiAgICogQSBtYWNybydzIGRlZmluaXRpb24gaXMgcmFyZWx5IGluIHRoZSBmaWxlIHRoYXQgdXNlcyBpdCAtLSB1c3VhbGx5IGl0IGlzIGluXG4gICAqIGEgaGVhZGVyIHB1bGxlZCBpbiBieSBhIGZpbGUgbGlzdCB0aGUgZWRpdG9yIGNhbm5vdCBzZWUgLS0gc28gdGhlIGluZGV4IGlzXG4gICAqIHRoZSBvbmx5IHBsYWNlIHRoZSB3aG9sZSBzZXQgZXhpc3RzLiBLZXB0IGJlc2lkZSB0aGUgY2F0YWxvZyBmb3IgdGhlIHNhbWVcbiAgICogcmVhc29uOiBib3RoIGFyZSB3b3Jrc3BhY2Utd2lkZSBhbnN3ZXJzIHRoYXQgb25lIGZpbGUgY2Fubm90IGdpdmUuXG4gICAqL1xuICBnZXQgbWFjcm9zKCk6IE1hY3JvVGFibGUge1xuICAgIHJldHVybiB0aGlzLm1hY3JvVGFibGU7XG4gIH1cbn1cblxuLyoqIEEgdHJhaWxpbmctc2xhc2ggZGlyZWN0b3J5IHNob3VsZCBhbHNvIG1hdGNoIGV4Y2x1ZGUgcGF0dGVybnMgd3JpdHRlbiBiYXJlLiAqL1xuZnVuY3Rpb24gbWF0Y2hlc0dsb2JEaXIocmU6IFJlZ0V4cCwgcmVsYXRpdmVEaXI6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAocmUudGVzdChyZWxhdGl2ZURpcikpIHJldHVybiB0cnVlO1xuICBjb25zdCB0cmltbWVkID0gcmVsYXRpdmVEaXIucmVwbGFjZSgvXFwvJC8sIFwiXCIpO1xuICByZXR1cm4gcmUudGVzdCh0cmltbWVkKSB8fCByZS50ZXN0KGAke3RyaW1tZWR9L2ApO1xufVxuXG5leHBvcnQgeyBwYXRoVG9VcmksIHRvUG9zaXggfSBmcm9tIFwiLi9wYXRocy5qc1wiOyIsICJpbXBvcnQgeyBUZXh0RG9jdW1lbnQgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXRleHRkb2N1bWVudFwiO1xuaW1wb3J0IHR5cGUgeyBQb3NpdGlvbiB9IGZyb20gXCJ2c2NvZGUtbGFuZ3VhZ2VzZXJ2ZXItdHlwZXNcIjtcbmltcG9ydCB7IEVkaXQsIHR5cGUgUG9pbnQsIHR5cGUgVHJlZSB9IGZyb20gXCJ3ZWItdHJlZS1zaXR0ZXJcIjtcblxuaW1wb3J0IHsgYW5hbHl6ZVRyZWUgfSBmcm9tIFwiLi9hbmFseXplci5qc1wiO1xuaW1wb3J0IHR5cGUgeyBNYWNyb1RhYmxlIH0gZnJvbSBcIi4vbWFjcm9zLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEFuYWx5c2lzIH0gZnJvbSBcIi4vbW9kZWwuanNcIjtcbmltcG9ydCB0eXBlIHsgVmVyaWxvZ1BhcnNlciB9IGZyb20gXCIuL3Zlcmlsb2dQYXJzZXIuanNcIjtcblxuaW50ZXJmYWNlIERvY3VtZW50RW50cnkge1xuICBkb2N1bWVudDogVGV4dERvY3VtZW50O1xuICB0cmVlOiBUcmVlO1xuICBhbmFseXNpczogQW5hbHlzaXM7XG4gIHZlcnNpb246IG51bWJlcjtcbn1cblxuLyoqXG4gKiBUZWxscyB0cmVlLXNpdHRlciBob3cgYG5ld1RleHRgIGRpZmZlcnMgZnJvbSBgb2xkVGV4dGAuXG4gKlxuICogVGhlIGNsaWVudCBzZW5kcyB0aGUgd2hvbGUgZG9jdW1lbnQgb24gZXZlcnkgY2hhbmdlLCBzbyB0aGUgZGlmZmVyZW5jZSBtYXlcbiAqIHNwYW4gc2V2ZXJhbCBkaXNqb2ludCBlZGl0cy4gV3JhcHBpbmcgdGhlbSBpbiBvbmUgZW5jbG9zaW5nIHJhbmdlIGlzIGFsd2F5c1xuICogdmFsaWQgYW5kIG9ubHkgY29zdHMgdHJlZS1zaXR0ZXIgYSBsaXR0bGUgZXh0cmEgcmUtcGFyc2luZy5cbiAqL1xuZnVuY3Rpb24gYXBwbHlFZGl0KFxuICB0cmVlOiBUcmVlLFxuICBvbGRUZXh0OiBzdHJpbmcsXG4gIG5ld1RleHQ6IHN0cmluZyxcbiAgb2xkRG9jdW1lbnQ6IFRleHREb2N1bWVudCxcbiAgbmV3RG9jdW1lbnQ6IFRleHREb2N1bWVudCxcbik6IHZvaWQge1xuICBjb25zdCBsaW1pdCA9IE1hdGgubWluKG9sZFRleHQubGVuZ3RoLCBuZXdUZXh0Lmxlbmd0aCk7XG5cbiAgbGV0IHN0YXJ0ID0gMDtcbiAgd2hpbGUgKHN0YXJ0IDwgbGltaXQgJiYgb2xkVGV4dFtzdGFydF0gPT09IG5ld1RleHRbc3RhcnRdKSBzdGFydCsrO1xuXG4gIGxldCBvbGRFbmQgPSBvbGRUZXh0Lmxlbmd0aDtcbiAgbGV0IG5ld0VuZCA9IG5ld1RleHQubGVuZ3RoO1xuICB3aGlsZSAob2xkRW5kID4gc3RhcnQgJiYgbmV3RW5kID4gc3RhcnQgJiYgb2xkVGV4dFtvbGRFbmQgLSAxXSA9PT0gbmV3VGV4dFtuZXdFbmQgLSAxXSkge1xuICAgIG9sZEVuZC0tO1xuICAgIG5ld0VuZC0tO1xuICB9XG5cbiAgdHJlZS5lZGl0KFxuICAgIG5ldyBFZGl0KHtcbiAgICAgIHN0YXJ0SW5kZXg6IHN0YXJ0LFxuICAgICAgb2xkRW5kSW5kZXg6IG9sZEVuZCxcbiAgICAgIG5ld0VuZEluZGV4OiBuZXdFbmQsXG4gICAgICBzdGFydFBvc2l0aW9uOiB0b1BvaW50KG9sZERvY3VtZW50LnBvc2l0aW9uQXQoc3RhcnQpKSxcbiAgICAgIG9sZEVuZFBvc2l0aW9uOiB0b1BvaW50KG9sZERvY3VtZW50LnBvc2l0aW9uQXQob2xkRW5kKSksXG4gICAgICBuZXdFbmRQb3NpdGlvbjogdG9Qb2ludChuZXdEb2N1bWVudC5wb3NpdGlvbkF0KG5ld0VuZCkpLFxuICAgIH0pLFxuICApO1xufVxuXG4vKiogTFNQIHBvc2l0aW9ucyBhcmUgYHtsaW5lLCBjaGFyYWN0ZXJ9YDsgdHJlZS1zaXR0ZXIgcG9pbnRzIGFyZSBge3JvdywgY29sdW1ufWAuICovXG5mdW5jdGlvbiB0b1BvaW50KHBvc2l0aW9uOiBQb3NpdGlvbik6IFBvaW50IHtcbiAgcmV0dXJuIHsgcm93OiBwb3NpdGlvbi5saW5lLCBjb2x1bW46IHBvc2l0aW9uLmNoYXJhY3RlciB9O1xufVxuXG4vKipcbiAqIE93bnMgZXZlcnkgb3BlbiBTeXN0ZW1WZXJpbG9nIGRvY3VtZW50IHRvZ2V0aGVyIHdpdGggaXRzIHBhcnNlIHRyZWUgYW5kXG4gKiBzZW1hbnRpYyBhbmFseXNpcy4gUmUtcGFyc2VzIGluY3JlbWVudGFsbHkgc28gdHlwaW5nIHN0YXlzIGNoZWFwLlxuICovXG5leHBvcnQgY2xhc3MgRG9jdW1lbnRNYW5hZ2VyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBlbnRyaWVzID0gbmV3IE1hcDxzdHJpbmcsIERvY3VtZW50RW50cnk+KCk7XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIGFzayBmb3IgY2xhc3MgbmFtZXMgZGVjbGFyZWQgZWxzZXdoZXJlIGluIHRoZSB3b3Jrc3BhY2UuXG4gICAqXG4gICAqIEFuYWx5c2lzIG5lZWRzIHRoZW0gdG8gdGVsbCBgUGFja2V0IHBrdDtgIGZyb20gYSBvbmUtYml0IG5ldCwgYW5kIHRoZVxuICAgKiBhbnN3ZXIgaXMgdXN1YWxseSBpbiBhIGRpZmZlcmVudCBmaWxlLiBTdXBwbGllZCBieSB0aGUgc2VydmVyIHNvIHRoaXNcbiAgICogY2xhc3MgZG9lcyBub3QgaGF2ZSB0byBrbm93IHRoZSBjYXRhbG9nIGV4aXN0cy5cbiAgICovXG4gIGtub3duQ2xhc3NlczogKCkgPT4gUmVhZG9ubHlTZXQ8c3RyaW5nPiA9ICgpID0+IG5ldyBTZXQoKTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gYXNrIGZvciB0aGUgZm9sZGVkIHZhbHVlIG9mIGEgcGFja2FnZSdzIHBhcmFtZXRlcnMuXG4gICAqXG4gICAqIEEgd2lkdGggd3JpdHRlbiBpbiB0ZXJtcyBvZiBhIHBhY2thZ2UgcGFyYW1ldGVyIGNhbm5vdCBiZSByZXNvbHZlZCBpbnNpZGVcbiAgICogdGhlIGZpbGUgdGhhdCB1c2VzIGl0LCBzbyB0aGUgbnVtYmVycyBjb21lIGZyb20gdGhlIGNhdGFsb2cuXG4gICAqL1xuICBpbXBvcnRlZFBhcmFtZXRlclZhbHVlczpcbiAgICB8ICgocGFja2FnZU5hbWU6IHN0cmluZykgPT4gUmVhZG9ubHlNYXA8c3RyaW5nLCBudW1iZXI+IHwgdW5kZWZpbmVkKVxuICAgIHwgdW5kZWZpbmVkO1xuXG4gIC8qKlxuICAgKiBXaGVyZSB0byBhc2sgZm9yIHRoZSBtYWNyb3MgZGVmaW5lZCBhbnl3aGVyZSBpbiB0aGUgd29ya3NwYWNlLlxuICAgKlxuICAgKiBBIGBgIGBOQU1FKGFyZ3MpIGBgIGRlY2xhcmF0aW9uIGxpdmVzIGluIHRoZSBmaWxlIHRoYXQgZGVmaW5lcyB0aGUgbWFjcm8gYW5kXG4gICAqIHN0YW5kcyBmb3IgYSBkZWNsYXJhdGlvbiBpbiB0aGUgZmlsZSB0aGF0IHVzZXMgaXQsIHNvIG5laXRoZXIgZmlsZSBpc1xuICAgKiBlbm91Z2ggb24gaXRzIG93bi5cbiAgICovXG4gIG1hY3JvczogKCkgPT4gTWFjcm9UYWJsZSA9ICgpID0+IG5ldyBNYXAoKTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHBhcnNlcjogVmVyaWxvZ1BhcnNlcikge31cblxuICB1cGRhdGUodXJpOiBzdHJpbmcsIGRvY3VtZW50OiBUZXh0RG9jdW1lbnQpOiBEb2N1bWVudEVudHJ5IHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZW50cmllcy5nZXQodXJpKTtcbiAgICBjb25zdCB2ZXJzaW9uID0gZG9jdW1lbnQudmVyc2lvbjtcblxuICAgIGlmIChleGlzdGluZyAmJiBleGlzdGluZy52ZXJzaW9uID09PSB2ZXJzaW9uKSB7XG4gICAgICBleGlzdGluZy5kb2N1bWVudCA9IGRvY3VtZW50O1xuICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGNvbnN0IHRleHQgPSBkb2N1bWVudC5nZXRUZXh0KCk7XG4gICAgbGV0IHRyZWU6IFRyZWU7XG5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIC8vIFJldXNpbmcgYSB0cmVlIGlzIG9ubHkgc291bmQgYWZ0ZXIgdGVsbGluZyB0cmVlLXNpdHRlciB3aGF0IGNoYW5nZWQuXG4gICAgICAvLyBXaXRob3V0IGBlZGl0YCwgaXQgYXNzdW1lcyB0aGUgb2xkIHRyZWUgc3RpbGwgZGVzY3JpYmVzIHRoZSBpbnB1dCBhbmRcbiAgICAgIC8vIHJldXNlcyBzdWJ0cmVlcyBhdCBzdGFsZSBvZmZzZXRzLCB5aWVsZGluZyBzaGlmdGVkLCBjb3JydXB0ZWQgbm9kZXMuXG4gICAgICBhcHBseUVkaXQoZXhpc3RpbmcudHJlZSwgZXhpc3RpbmcuZG9jdW1lbnQuZ2V0VGV4dCgpLCB0ZXh0LCBleGlzdGluZy5kb2N1bWVudCwgZG9jdW1lbnQpO1xuICAgICAgdHJlZSA9IHRoaXMucGFyc2VyLnBhcnNlKHRleHQsIGV4aXN0aW5nLnRyZWUpO1xuICAgICAgZXhpc3RpbmcudHJlZS5kZWxldGUoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdHJlZSA9IHRoaXMucGFyc2VyLnBhcnNlKHRleHQpO1xuICAgIH1cblxuICAgIGNvbnN0IGFuYWx5c2lzID0gdGhpcy5hbmFseXplKHRyZWUsIHRleHQpO1xuXG4gICAgY29uc3QgZW50cnk6IERvY3VtZW50RW50cnkgPSB7IGRvY3VtZW50LCB0cmVlLCBhbmFseXNpcywgdmVyc2lvbiB9O1xuICAgIHRoaXMuZW50cmllcy5zZXQodXJpLCBlbnRyeSk7XG4gICAgcmV0dXJuIGVudHJ5O1xuICB9XG5cbiAgLyoqXG4gICAqIEFuYWx5c2VzIGEgcGFyc2VkIGRvY3VtZW50LCBydW5uaW5nIGEgc2Vjb25kIHBhc3Mgd2hlbiB0aGUgZmlyc3Qgb25lXG4gICAqIHJldmVhbGVkIGNsYXNzZXMgdGhlIGNhbGxlciBkaWQgbm90IGtub3cgYWJvdXQuXG4gICAqXG4gICAqIEEgZmlsZSB0aGF0IGRlY2xhcmVzIGBQYWNrZXRgIGFuZCBhbHNvIHdyaXRlcyBgUGFja2V0IHBrdDtgIGNhbm5vdCBkZWNpZGVcbiAgICogd2hpY2ggaXMgd2hpY2ggb24gdGhlIGZpcnN0IHBhc3MuIE9uZSBleHRyYSBwYXNzIHNldHRsZXMgaXQsIGFuZCBvbmx5IHdoZW5cbiAgICogdGhlIGZpbGUgYWN0dWFsbHkgZGVjbGFyZXMgc29tZXRoaW5nIG5ldy5cbiAgICovXG4gIHByaXZhdGUgYW5hbHl6ZSh0cmVlOiBUcmVlLCB0ZXh0OiBzdHJpbmcpOiBBbmFseXNpcyB7XG4gICAgY29uc3Qga25vd24gPSB0aGlzLmtub3duQ2xhc3NlcygpO1xuICAgIGNvbnN0IHZhbHVlcyA9IHRoaXMuaW1wb3J0ZWRQYXJhbWV0ZXJWYWx1ZXM7XG4gICAgY29uc3QgbWFjcm9zID0gdGhpcy5tYWNyb3MoKTtcbiAgICBjb25zdCBwYXJzZSA9IChmcmFnbWVudDogc3RyaW5nKTogVHJlZSA9PiB0aGlzLnBhcnNlci5wYXJzZShmcmFnbWVudCk7XG5cbiAgICBjb25zdCBmaXJzdCA9IGFuYWx5emVUcmVlKHRyZWUsIHRleHQsIGtub3duLCB2YWx1ZXMsIG1hY3JvcywgcGFyc2UpO1xuXG4gICAgY29uc3QgZGVjbGFyZWRIZXJlID0gWy4uLm5ldyBTZXQoZmlyc3Quc2NvcGVzLmZpbHRlcigocykgPT4gcy5jYXRlZ29yeSA9PT0gXCJjbGFzc1wiKS5tYXAoKHMpID0+IHMubmFtZSkpXS5maWx0ZXIoXG4gICAgICAobmFtZSkgPT4gIWtub3duLmhhcyhuYW1lKSxcbiAgICApO1xuICAgIGlmIChkZWNsYXJlZEhlcmUubGVuZ3RoID09PSAwKSByZXR1cm4gZmlyc3Q7XG5cbiAgICByZXR1cm4gYW5hbHl6ZVRyZWUodHJlZSwgdGV4dCwgbmV3IFNldChbLi4ua25vd24sIC4uLmRlY2xhcmVkSGVyZV0pLCB2YWx1ZXMsIG1hY3JvcywgcGFyc2UpO1xuICB9XG5cbiAgLyoqXG4gKiBSZS1hbmFseXNlcyBhIGRvY3VtZW50IGZyb20gc2NyYXRjaCwgaWdub3JpbmcgaXRzIHZlcnNpb24uXG4gKlxuICogQSB2ZXJzaW9uIGNoZWNrIGV4aXN0cyB0byBrZWVwIGEga2V5c3Ryb2tlIGNoZWFwLCB3aGljaCBpcyB0aGUgcmlnaHQgdHJhZGVcbiAqIHdoaWxlIG5vdGhpbmcgb3V0c2lkZSB0aGUgZmlsZSBjYW4gY2hhbmdlIHRoZSBhbnN3ZXIuIEl0IGlzIHRoZSB3cm9uZyB0cmFkZVxuICogb25jZSB0aGUgd29ya3NwYWNlIGluZGV4IGxhbmRzOiBgb3V0cHV0IGxvZ2ljIFtDX1BLVF9EQVRfVy0xOjBdYCBrZWVwcyB0aGVcbiAqIHNhbWUgdGV4dCBhbmQgZ2V0cyBhIGRpZmZlcmVudCB3aWR0aCB0aGUgbW9tZW50IHRoZSBwYWNrYWdlIGlzIGluZGV4ZWQsIGFuZFxuICogbm8gZWRpdCB3aWxsIGV2ZXIgYXJyaXZlIHRvIHRyaWdnZXIgdGhlIHVwZGF0ZS5cbiAqL1xucmVhbmFseXplKHVyaTogc3RyaW5nKTogRG9jdW1lbnRFbnRyeSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmVudHJpZXMuZ2V0KHVyaSk7XG4gICAgaWYgKCFleGlzdGluZykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IHRleHQgPSBleGlzdGluZy5kb2N1bWVudC5nZXRUZXh0KCk7XG4gICAgY29uc3QgdHJlZSA9IHRoaXMucGFyc2VyLnBhcnNlKHRleHQpO1xuICAgIGV4aXN0aW5nLnRyZWUuZGVsZXRlKCk7XG5cbiAgICBleGlzdGluZy50cmVlID0gdHJlZTtcbiAgICBleGlzdGluZy5hbmFseXNpcyA9IHRoaXMuYW5hbHl6ZSh0cmVlLCB0ZXh0KTtcbiAgICByZXR1cm4gZXhpc3Rpbmc7XG4gIH1cblxuICBnZXQodXJpOiBzdHJpbmcpOiBEb2N1bWVudEVudHJ5IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzLmdldCh1cmkpO1xuICB9XG5cbiAgY2xvc2UodXJpOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cmllcy5nZXQodXJpKTtcbiAgICBpZiAoIWVudHJ5KSByZXR1cm47XG4gICAgZW50cnkudHJlZS5kZWxldGUoKTtcbiAgICB0aGlzLmVudHJpZXMuZGVsZXRlKHVyaSk7XG4gIH1cblxuICBhbGwoKTogRG9jdW1lbnRFbnRyeVtdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuZW50cmllcy52YWx1ZXMoKV07XG4gIH1cbn0iLCAiaW1wb3J0IHsgTG9jYXRpb24sIHR5cGUgUG9zaXRpb24sIHR5cGUgUmFuZ2UsIHR5cGUgVGV4dERvY3VtZW50IH0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10eXBlc1wiO1xuaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG5pbXBvcnQgeyByZXNvbHZlU3ltYm9sLCB0eXBlIEFuYWx5c2lzIH0gZnJvbSBcIi4uL21vZGVsLmpzXCI7XG5pbXBvcnQgeyBpZGVudGlmaWVyQXQgfSBmcm9tIFwiLi4vbG9jYXRlLmpzXCI7XG5pbXBvcnQgeyBwYXRoT2YsIHJlc29sdmVQYXRoIH0gZnJvbSBcIi4uL2hpZXJhcmNoeS5qc1wiO1xuaW1wb3J0IHsgaW1wb3J0ZWRNZW1iZXIsIGluY2x1ZGVkRGVjbGFyYXRpb24gfSBmcm9tIFwiLi4vaW1wb3J0cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBDYXRhbG9nIH0gZnJvbSBcIi4uL2NhdGFsb2cuanNcIjtcbmltcG9ydCB0eXBlIHsgSW5jbHVkZVJlc29sdmVyIH0gZnJvbSBcIi4uL2luY2x1ZGVzLmpzXCI7XG5cbmludGVyZmFjZSBCaW5kaW5nQ29udGV4dCB7XG4gIHJlYWRvbmx5IGtpbmQ6IFwicG9ydFwiIHwgXCJwYXJhbWV0ZXJcIjtcbiAgcmVhZG9ubHkgdHlwZU5hbWU6IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyB0aGUgaWRlbnRpZmllciB1bmRlciB0aGUgY3Vyc29yIHRvIGl0cyBkZWNsYXJhdGlvbi5cbiAqXG4gKiBIYW5kbGVzIGZpdmUgY2FzZXM6XG4gKiAgMS4gYSByZWZlcmVuY2UgdG8gYSBzeW1ib2wgZGVjbGFyZWQgaW4gdGhlIGN1cnJlbnQgZmlsZSxcbiAqICAyLiBhIHJlZmVyZW5jZSB0byBhIGRlc2lnbiB1bml0IChtb2R1bGUgLyBpbnRlcmZhY2UgLyBwYWNrYWdlKSBhbnl3aGVyZSBpblxuICogICAgIHRoZSB3b3Jrc3BhY2UsXG4gKiAgMy4gYSBwb3J0IG9yIHBhcmFtZXRlciBuYW1lIG9uIGFuIGluc3RhbnRpYXRpb24sIHdoaWNoIHJlc29sdmVzIGFnYWluc3QgdGhlXG4gKiAgICAgaW5zdGFudGlhdGVkIHVuaXQncyBpbnRlcmZhY2UgZXZlbiBhY3Jvc3MgZmlsZXMsXG4gKiAgNC4gYSBuYW1lIGEgYGAgYGluY2x1ZGUgYGBkIGhlYWRlciBkZWNsYXJlcywgd2hpY2ggdGhlIGZpbGUgdXNlcyBhcyBpdHMgb3duLFxuICogIDUuIGEgbmFtZSBhbiBgaW1wb3J0YCBtYWtlcyB1c2FibGUgdW5xdWFsaWZpZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm92aWRlRGVmaW5pdGlvbihcbiAgZG9jdW1lbnQ6IFRleHREb2N1bWVudCxcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBvZmZzZXQ6IG51bWJlcixcbiAgaW5jbHVkZXM/OiBJbmNsdWRlUmVzb2x2ZXIsXG4pOiBMb2NhdGlvbiB8IExvY2F0aW9uW10gfCBudWxsIHtcbiAgY29uc3Qgbm9kZSA9IGlkZW50aWZpZXJBdChhbmFseXNpcywgb2Zmc2V0KTtcbiAgaWYgKCFub2RlKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBuYW1lID0gbm9kZS50ZXh0O1xuXG4gIC8vIGAucG9ydChgIG9uIGFuIGluc3RhbnRpYXRpb24gcmVzb2x2ZXMgYWdhaW5zdCB0aGUgaW5zdGFudGlhdGVkIG1vZHVsZS5cbiAgY29uc3QgYmluZGluZyA9IGluc3RhbmNlQmluZGluZ0NvbnRleHQobm9kZSk7XG4gIGlmIChiaW5kaW5nKSB7XG4gICAgLy8gVGhlIG1vZHVsZSBiZWluZyBpbnN0YW50aWF0ZWQgbm9ybWFsbHkgbGl2ZXMgaW4gYW5vdGhlciBmaWxlLCBzbyBhXG4gICAgLy8gc2FtZS1uYW1lZCBkZWNsYXJhdGlvbiBlbHNld2hlcmUgd291bGQgb3RoZXJ3aXNlIHN1cHBseSB0aGUgd3JvbmcgcG9ydFxuICAgIC8vIGRpcmVjdGlvbnMgYW5kIHRoZSB3cm9uZyBjb21wbGV0aW9uIGxpc3QuXG4gICAgY29uc3QgZW50cmllcyA9IGNhdGFsb2cuYWxsKGJpbmRpbmcudHlwZU5hbWUpO1xuICAgIGNvbnN0IHVuaXQgPVxuICAgICAgZW50cmllcy5maW5kKChlKSA9PiBlLnVyaSAhPT0gZG9jdW1lbnQudXJpKSA/P1xuICAgICAgZW50cmllcy5maW5kKChlKSA9PiBlLnVyaSA9PT0gZG9jdW1lbnQudXJpKSA/P1xuICAgICAgZW50cmllc1swXTtcblxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSB1bml0XG4gICAgICA/IGJpbmRpbmcua2luZCA9PT0gXCJwb3J0XCJcbiAgICAgICAgPyB1bml0LnBvcnRzXG4gICAgICAgIDogdW5pdC5wYXJhbWV0ZXJzXG4gICAgICA6IFtdO1xuICAgIGNvbnN0IHRhcmdldCA9IGNhbmRpZGF0ZXMuZmluZCgocCkgPT4gcC5uYW1lID09PSBuYW1lKTtcbiAgICAvLyBUaGUgdW5pdCdzIHVyaSwgbm90IHRoZSBjdXJyZW50IGRvY3VtZW50J3M6IHRoZSBwb3J0IGxpdmVzIGluIHRoZVxuICAgIC8vIG1vZHVsZSdzIGZpbGUsIGFuZCBwYWlyaW5nIGl0cyByYW5nZSB3aXRoIHRoaXMgZmlsZSdzIHVyaSBqdW1wcyB0byBhblxuICAgIC8vIHVucmVsYXRlZCBsaW5lLlxuICAgIGlmICh0YXJnZXQgJiYgdW5pdCkgcmV0dXJuIExvY2F0aW9uLmNyZWF0ZSh1bml0LnVyaSwgdGFyZ2V0LnNlbGVjdGlvblJhbmdlKTtcbiAgfVxuXG4gIC8vIEEgbG9jYWwgZGVjbGFyYXRpb24sIGhvbm91cmluZyBzaGFkb3dpbmcuXG4gIGNvbnN0IGxvY2FsID0gcmVzb2x2ZVN5bWJvbChhbmFseXNpcywgbmFtZSwgb2Zmc2V0KTtcbiAgaWYgKGxvY2FsKSByZXR1cm4gTG9jYXRpb24uY3JlYXRlKGRvY3VtZW50LnVyaSwgbG9jYWwuc2VsZWN0aW9uUmFuZ2UpO1xuXG4gIC8vIGBEVVRfaWYuYWRjX2luYCwgYERVVC51X3N1Yi5zaWdgOiBhIGRvdHRlZCBwYXRoIGludG8gYW5vdGhlciBzY29wZSwgb2Z0ZW5cbiAgLy8gaW4gYW5vdGhlciBmaWxlLiBPbmx5IHdvcnRoIHRyeWluZyBvbmNlIGxvY2FsIGxvb2t1cCBoYXMgZmFpbGVkLCBzbyBhIGxvY2FsXG4gIC8vIHNpZ25hbCBuYW1lZCBgYWRjX2luYCBzdGlsbCB3aW5zLlxuICBpZiAocGF0aE9mKG5vZGUpKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUGF0aChub2RlLCBhbmFseXNpcywgY2F0YWxvZywgZG9jdW1lbnQudXJpKTtcbiAgICAvLyBUaGUgcmVzb2x2ZWQgdXJpLCBub3QgdGhpcyBkb2N1bWVudCdzOiB0aGUgZGVjbGFyYXRpb24gbGl2ZXMgd2hlcmUgaXRcbiAgICAvLyB3YXMgd3JpdHRlbi5cbiAgICBpZiAocmVzb2x2ZWQpIHJldHVybiBMb2NhdGlvbi5jcmVhdGUocmVzb2x2ZWQudXJpLCByZXNvbHZlZC5zeW1ib2wuc2VsZWN0aW9uUmFuZ2UpO1xuICB9XG5cbiAgLy8gYGltcG9ydCBjZmdfcGtnOjoqO2AgdGhlbiBhIGJhcmUgYFdJRFRIYC4gTm90aGluZyBpbiB0aGlzIGZpbGUgZGVjbGFyZXMgaXRcbiAgLy8gYW5kIHRoZXJlIGlzIG5vIHBhdGggdG8gd2FsayAtLSB0aGUgaW1wb3J0IGlzIHRoZSBvbmx5IGxpbmsuXG4gIGNvbnN0IGltcG9ydGVkID0gaW1wb3J0ZWRNZW1iZXIoYW5hbHlzaXMsIGNhdGFsb2csIG9mZnNldCwgbmFtZSk7XG4gIGlmIChpbXBvcnRlZCkgcmV0dXJuIExvY2F0aW9uLmNyZWF0ZShpbXBvcnRlZC51cmksIGltcG9ydGVkLnN5bWJvbC5zZWxlY3Rpb25SYW5nZSk7XG5cbiAgLy8gQSBuYW1lIGEgaGVhZGVyIGRlY2xhcmVzIGFuZCB0aGlzIGZpbGUgcHVsbHMgaW4gd2l0aCBgYCBgaW5jbHVkZSBgYC4gSXQgaXNcbiAgLy8gZGVjbGFyZWQgaW4gYSBmaWxlIHdpdGggbm8gc2NvcGUgdG8gZGVjbGFyZSBpdCBpbiwgc28gd2l0aG91dCBmb2xsb3dpbmcgdGhlXG4gIC8vIGluY2x1ZGUgdGhlcmUgaXMgbm93aGVyZSBsZWZ0IHRvIGxvb2sgLS0gYW5kIGEgYHR5cGVkZWZgIGluIGEgc2hhcmVkIGhlYWRlclxuICAvLyBpcyB0aGUgbW9zdCBvcmRpbmFyeSB0aGluZyBpbiBhIHByb2plY3QuXG4gIGlmIChpbmNsdWRlcykge1xuICAgIGNvbnN0IGRlY2xhcmVkID0gaW5jbHVkZWREZWNsYXJhdGlvbihkb2N1bWVudC51cmksIGNhdGFsb2csIGluY2x1ZGVzLCBuYW1lKTtcbiAgICBpZiAoZGVjbGFyZWQpIHJldHVybiBMb2NhdGlvbi5jcmVhdGUoZGVjbGFyZWQudXJpLCBkZWNsYXJlZC5zeW1ib2wuc2VsZWN0aW9uUmFuZ2UpO1xuICB9XG5cbiAgLy8gQSBkZXNpZ24gdW5pdCByZWZlcmVuY2VkIGJ5IG5hbWUsIHBvc3NpYmx5IGRlY2xhcmVkIG1vcmUgdGhhbiBvbmNlLlxuICBjb25zdCBsb2NhdGlvbnMgPSBjYXRhbG9nLmxvY2F0aW9ucyhuYW1lKTtcbiAgaWYgKGxvY2F0aW9ucy5sZW5ndGggPiAwKSByZXR1cm4gbG9jYXRpb25zO1xuXG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFJlY29nbmlzZXMgdGhlIHBvcnQvcGFyYW1ldGVyIG5hbWUgcG9zaXRpb24gb2YgYSBuYW1lZCBiaW5kaW5nLCBpLmUuIHRoZVxuICogZmlyc3QgaWRlbnRpZmllciBvZiBgLnBvcnQoLi4uKWAgaW5zaWRlIGEgYG1vZHVsZV9pbnN0YW50aWF0aW9uYC5cbiAqL1xuZnVuY3Rpb24gaW5zdGFuY2VCaW5kaW5nQ29udGV4dChub2RlOiBOb2RlKTogQmluZGluZ0NvbnRleHQgfCB1bmRlZmluZWQge1xuICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgaWYgKCFwYXJlbnQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChwYXJlbnQudHlwZSAhPT0gXCJuYW1lZF9wb3J0X2Nvbm5lY3Rpb25cIiAmJiBwYXJlbnQudHlwZSAhPT0gXCJuYW1lZF9wYXJhbWV0ZXJfYXNzaWdubWVudFwiKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8vIE9ubHkgdGhlIGxlYWRpbmcgaWRlbnRpZmllciBpcyB0aGUgcG9ydCBuYW1lOyBhbnl0aGluZyBkZWVwZXIgaXMgYSBzaWduYWwuXG4gIGNvbnN0IGZpcnN0ID0gcGFyZW50Lm5hbWVkQ2hpbGQoMCk7XG4gIGlmIChmaXJzdCAmJiBmaXJzdC5pZCAhPT0gbm9kZS5pZCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBsZXQgY3VycmVudDogTm9kZSB8IG51bGwgPSBwYXJlbnQ7XG4gIHdoaWxlIChjdXJyZW50KSB7XG4gICAgaWYgKGN1cnJlbnQudHlwZSA9PT0gXCJtb2R1bGVfaW5zdGFudGlhdGlvblwiKSB7XG4gICAgICBjb25zdCB0eXBlTmFtZSA9IGN1cnJlbnQuY2hpbGRGb3JGaWVsZE5hbWUoXCJpbnN0YW5jZV90eXBlXCIpPy50ZXh0O1xuICAgICAgaWYgKCF0eXBlTmFtZSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6IHBhcmVudC50eXBlID09PSBcIm5hbWVkX3BvcnRfY29ubmVjdGlvblwiID8gXCJwb3J0XCIgOiBcInBhcmFtZXRlclwiLFxuICAgICAgICB0eXBlTmFtZSxcbiAgICAgIH07XG4gICAgfVxuICAgIGN1cnJlbnQgPSBjdXJyZW50LnBhcmVudDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKiogQWxsIG9jY3VycmVuY2VzIG9mIHRoZSBpZGVudGlmaWVyIHVuZGVyIHRoZSBjdXJzb3Igd2l0aGluIHRoaXMgZG9jdW1lbnQuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvdmlkZVJlZmVyZW5jZXMoXG4gIGRvY3VtZW50OiBUZXh0RG9jdW1lbnQsXG4gIGFuYWx5c2lzOiBBbmFseXNpcyxcbiAgb2Zmc2V0OiBudW1iZXIsXG4gIGluY2x1ZGVEZWNsYXJhdGlvbjogYm9vbGVhbixcbik6IExvY2F0aW9uW10ge1xuICBjb25zdCBub2RlID0gaWRlbnRpZmllckF0KGFuYWx5c2lzLCBvZmZzZXQpO1xuICBpZiAoIW5vZGUpIHJldHVybiBbXTtcblxuICBjb25zdCBuYW1lID0gbm9kZS50ZXh0O1xuICBjb25zdCBzeW1ib2wgPSByZXNvbHZlU3ltYm9sKGFuYWx5c2lzLCBuYW1lLCBvZmZzZXQpO1xuICBjb25zdCBsb2NhdGlvbnM6IExvY2F0aW9uW10gPSBbXTtcblxuICBpZiAoaW5jbHVkZURlY2xhcmF0aW9uICYmIHN5bWJvbCkge1xuICAgIGxvY2F0aW9ucy5wdXNoKExvY2F0aW9uLmNyZWF0ZShkb2N1bWVudC51cmksIHN5bWJvbC5zZWxlY3Rpb25SYW5nZSkpO1xuICB9XG5cbiAgZm9yIChjb25zdCB1c2Ugb2YgYW5hbHlzaXMuaWRlbnRpZmllcnMuZ2V0KG5hbWUpID8/IFtdKSB7XG4gICAgaWYgKHN5bWJvbCAmJiBzYW1lUmFuZ2UodXNlLnJhbmdlLCBzeW1ib2wuc2VsZWN0aW9uUmFuZ2UpKSBjb250aW51ZTtcbiAgICBsb2NhdGlvbnMucHVzaChMb2NhdGlvbi5jcmVhdGUoZG9jdW1lbnQudXJpLCB1c2UucmFuZ2UpKTtcbiAgfVxuXG4gIHJldHVybiBsb2NhdGlvbnM7XG59XG5cbmZ1bmN0aW9uIHNhbWVSYW5nZShhOiBSYW5nZSwgYjogUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICBhLnN0YXJ0LmxpbmUgPT09IGIuc3RhcnQubGluZSAmJlxuICAgIGEuc3RhcnQuY2hhcmFjdGVyID09PSBiLnN0YXJ0LmNoYXJhY3RlciAmJlxuICAgIGEuZW5kLmxpbmUgPT09IGIuZW5kLmxpbmUgJiZcbiAgICBhLmVuZC5jaGFyYWN0ZXIgPT09IGIuZW5kLmNoYXJhY3RlclxuICApO1xufVxuXG5leHBvcnQgdHlwZSB7IFBvc2l0aW9uIH07IiwgImltcG9ydCB0eXBlIHsgUmFuZ2UgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5pbXBvcnQgdHlwZSB7IEluY2x1ZGVEaXJlY3RpdmUgfSBmcm9tIFwiLi9pbmNsdWRlcy5qc1wiO1xuXG4vKiogRGlyZWN0aW9uIG9mIGEgbW9kdWxlL2ludGVyZmFjZSBwb3J0LiAqL1xuZXhwb3J0IHR5cGUgUG9ydERpcmVjdGlvbiA9IFwiaW5wdXRcIiB8IFwib3V0cHV0XCIgfCBcImlub3V0XCIgfCBcInJlZlwiIHwgXCJpbnRlcmZhY2VcIjtcblxuLyoqXG4gKiBDbGFzc2lmaWNhdGlvbiBvZiBhIGRlY2xhcmF0aW9uLiBNYXBwZWQgdG8gTFNQIGBTeW1ib2xLaW5kYCBpbiB0aGUgcHJvdmlkZXJzLFxuICoga2VwdCBIREwtc3BlY2lmaWMgaGVyZSBzbyBob3ZlciBhbmQgY29tcGxldGlvbiBjYW4gc3R5bGUgZWFjaCBjYXRlZ29yeS5cbiAqL1xuZXhwb3J0IHR5cGUgU3ltYm9sQ2F0ZWdvcnkgPVxuICB8IFwicG9ydFwiXG4gIHwgXCJuZXRcIlxuICB8IFwidmFyaWFibGVcIlxuICB8IFwicGFyYW1ldGVyXCJcbiAgfCBcImxvY2FscGFyYW1cIlxuICB8IFwidHlwZWRlZlwiXG4gIHwgXCJlbnVtXCJcbiAgfCBcImdlbnZhclwiXG4gIHwgXCJ0YXNrXCJcbiAgfCBcImZ1bmN0aW9uXCJcbiAgfCBcImluc3RhbmNlXCJcbiAgfCBcIm1vZHVsZVwiXG4gIHwgXCJpbnRlcmZhY2VcIlxuICB8IFwicHJvZ3JhbVwiXG4gIHwgXCJwYWNrYWdlXCJcbiAgfCBcImNsYXNzXCJcbiAgfCBcImhhbmRsZVwiXG4gIHwgXCJibG9ja1wiO1xuXG5leHBvcnQgdHlwZSBTY29wZUNhdGVnb3J5ID0gRXh0cmFjdDxcbiAgU3ltYm9sQ2F0ZWdvcnksXG4gIFwibW9kdWxlXCIgfCBcImludGVyZmFjZVwiIHwgXCJwcm9ncmFtXCIgfCBcInBhY2thZ2VcIiB8IFwiY2xhc3NcIiB8IFwiZnVuY3Rpb25cIiB8IFwidGFza1wiIHwgXCJibG9ja1wiXG4+O1xuXG4vKipcbiAqIEEgZGVjbGFyZWQgSERMIGVudGl0eS4gYHJhbmdlYCBzcGFucyB0aGUgd2hvbGUgZGVjbGFyYXRpb24gKHNvIGZvbGRpbmcgYW5kXG4gKiBcInJldmVhbCByYW5nZVwiIHdvcmspOyBgc2VsZWN0aW9uUmFuZ2VgIGNvdmVycyB0aGUgaWRlbnRpZmllciBhbG9uZSwgd2hpY2ggaXNcbiAqIHdoZXJlIG5hdmlnYXRpb24gdGFyZ2V0cyBsYW5kLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEhkbFN5bWJvbCB7XG4gIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgY2F0ZWdvcnk6IFN5bWJvbENhdGVnb3J5O1xuICAvKiogRGVjbGFyZWQgdHlwZSB2ZXJiYXRpbSwgZS5nLiBgbG9naWMgc2lnbmVkIFs3OjBdYCBvciBgbXlfcGtnOjpjZmdfdGAuICovXG4gIHJlYWRvbmx5IHR5cGVUZXh0OiBzdHJpbmc7XG4gIC8qKiBQYWNrZWQgZGltZW5zaW9uIHZlcmJhdGltLCBlLmcuIGBXSURUSC0xOjBgLiBBYnNlbnQgZm9yIHNjYWxhciBuZXRzLiAqL1xuICByZWFkb25seSBwYWNrZWRSYW5nZVRleHQ/OiBzdHJpbmc7XG4gIC8qKiBQYWNrZWQgd2lkdGggaW4gYml0cyBvbmNlIHBhcmFtZXRlcnMgYXJlIGZvbGRlZDsgdW5kZWZpbmVkIGlmIG5vdCByZXNvbHZhYmxlLiAqL1xuICByZWFkb25seSBwYWNrZWRXaWR0aD86IG51bWJlcjtcbiAgLyoqIFVucGFja2VkIGRpbWVuc2lvbnMgdmVyYmF0aW0sIGUuZy4gYFtcIltERVBUSC0xOjBdXCJdYC4gKi9cbiAgcmVhZG9ubHkgdW5wYWNrZWREaW1zOiBzdHJpbmdbXTtcbiAgLyoqIFRvdGFsIGVsZW1lbnQgY291bnQgYWNyb3NzIHVucGFja2VkIGRpbXMsIHdoZW4gcmVzb2x2YWJsZS4gKi9cbiAgcmVhZG9ubHkgdW5wYWNrZWRDb3VudD86IG51bWJlcjtcbiAgcmVhZG9ubHkgZGlyZWN0aW9uPzogUG9ydERpcmVjdGlvbjtcbiAgcmVhZG9ubHkgaXNQb3J0OiBib29sZWFuO1xuICByZWFkb25seSBzY29wZUlkOiBudW1iZXI7XG4gIHJlYWRvbmx5IHJhbmdlOiBSYW5nZTtcbiAgcmVhZG9ubHkgc2VsZWN0aW9uUmFuZ2U6IFJhbmdlO1xuICAvKiogVmVyYmF0aW0gaW5pdGlhbGl6ZXIgZm9yIHZhcmlhYmxlcywgb3IgZGVmYXVsdCB2YWx1ZSBmb3IgcGFyYW1ldGVycy4gKi9cbiAgcmVhZG9ubHkgaW5pdGlhbGl6ZXJUZXh0Pzogc3RyaW5nO1xuICAvKiogRm9sZGVkIGNvbnN0YW50IGZvciBwYXJhbWV0ZXJzLCB3aGVuIHRoZSBleHByZXNzaW9uIGlzIGZ1bGx5IGV2YWx1YWJsZS4gKi9cbiAgcmVhZG9ubHkgcmVzb2x2ZWRWYWx1ZT86IG51bWJlcjtcbiAgcmVhZG9ubHkgY2hpbGRyZW4/OiBIZGxTeW1ib2xbXTtcbiAgLyoqIENvbW1lbnRzIGltbWVkaWF0ZWx5IHByZWNlZGluZyB0aGUgZGVjbGFyYXRpb24uICovXG4gIHJlYWRvbmx5IGRvYz86IHN0cmluZztcbiAgLyoqXG4gICAqIFZlcmJhdGltIGRlY2xhcmF0aW9uIHF1YWxpZmllcnMsIGUuZy4gYFtcInN0YXRpY1wiLCBcInJhbmRcIl1gLlxuICAgKlxuICAgKiBBIGNsYXNzIG1lbWJlcidzIHF1YWxpZmllcnMgY2hhbmdlIHdoYXQgaXQgbWVhbnMgLS0gYHN0YXRpYyBjb3VudGAgaXMgb25lXG4gICAqIHZhcmlhYmxlIHNoYXJlZCBieSBldmVyeSBvYmplY3QsIGByYW5kIHBheWxvYWRgIGlzIGEgY29uc3RyYWludCB0aGUgc29sdmVyXG4gICAqIGZpbGxzIC0tIHNvIHRoZXkgaGF2ZSB0byBzdXJ2aXZlIGludG8gaG92ZXIgYW5kIGNvbXBsZXRpb24uXG4gICAqL1xuICByZWFkb25seSBxdWFsaWZpZXJzPzogcmVhZG9ubHkgc3RyaW5nW107XG4gIC8qKlxuICAgKiBUaGUgY2xhc3MgdGhpcyBoYW5kbGUgcG9pbnRzIGF0LCB3aGVuIHRoZSBkZWNsYXJhdGlvbiBpcyBgUGFja2V0IHBrdDtgLlxuICAgKlxuICAgKiBTZXQgb25seSB3aGVuIHRoZSB0eXBlIG5hbWUgaXMga25vd24gdG8gYmUgYSBjbGFzcywgc28gYW4gb3JkaW5hcnkgbmV0IGlzXG4gICAqIG5ldmVyIG1pc3Rha2VuIGZvciBhbiBvYmplY3QuXG4gICAqL1xuICByZWFkb25seSBoYW5kbGVPZj86IHN0cmluZztcbiAgLyoqIE9yZGVyZWQgdGFzay9mdW5jdGlvbiBhcmd1bWVudHMsIGluY2x1ZGluZyBkZWZhdWx0cyBhbmQgZGlyZWN0aW9ucy4gKi9cbiAgcmVhZG9ubHkgYXJndW1lbnRzPzogcmVhZG9ubHkgSGRsU3ltYm9sW107XG59XG5cbi8qKiBBIG1vZHVsZS9pbnRlcmZhY2UgaW5zdGFudGlhdGlvbiBzaXRlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBIZGxJbnN0YW5jZSB7XG4gIHJlYWRvbmx5IHR5cGVOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGluc3RhbmNlTmFtZTogc3RyaW5nO1xuICAvKiogV2hvbGUgYHR5cGUgIyguLi4pIGluc3QgKC4uLilgIHN0YXRlbWVudC4gKi9cbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICAvKiogU3BhbiBvZiB0aGUgdHlwZSBuYW1lLCBzbyBkZWZpbml0aW9uIGNhbiBqdW1wIHRvIHRoZSByaWdodCBtb2R1bGUuICovXG4gIHJlYWRvbmx5IHR5cGVSYW5nZTogUmFuZ2U7XG4gIHJlYWRvbmx5IHBhcmFtZXRlck92ZXJyaWRlczogcmVhZG9ubHkgUG9ydEJpbmRpbmdbXTtcbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IHJlYWRvbmx5IFBvcnRCaW5kaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9ydEJpbmRpbmcge1xuICByZWFkb25seSBwb3J0TmFtZT86IHN0cmluZztcbiAgcmVhZG9ubHkgdmFsdWVUZXh0OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJhbmdlOiBSYW5nZTtcbiAgLyoqIFNwYW4gb2YgdGhlIHBvcnQvcGFyYW1ldGVyIG5hbWUgaXRzZWxmLiAqL1xuICByZWFkb25seSBuYW1lUmFuZ2U/OiBSYW5nZTtcbn1cblxuLyoqXG4gKiBXaGVyZSBhIHJlYWQgb3IgYSB3cml0ZSBvZiBhIHNpZ25hbCBjb21lcyBmcm9tLiBUaGlzIGlzIHRoZSBheGlzIHRoZSBTaWduYWxcbiAqIFRyYWNlciBncm91cHMgYnksIHNvIGl0IG5hbWVzICp3aHkqIHRoZSBhY2Nlc3MgaGFwcGVucyByYXRoZXIgdGhhbiBvbmx5IHdoYXRcbiAqIHRoZSBzaWduYWwgaXMgY2FsbGVkLlxuICovXG5leHBvcnQgdHlwZSBBY2Nlc3NTb3VyY2UgPVxuICAvKiogYGFzc2lnbiB4ID0geTtgICovXG4gIHwgXCJjb250aW51b3VzX2Fzc2lnblwiXG4gIC8qKiBgeCA8PSB5O2AgaW5zaWRlIGFuIGFsd2F5cyBibG9jaywgb3IgYSBkZWNsYXJhdGlvbiBpbml0aWFsaXNlci4gKi9cbiAgfCBcInByb2NlZHVyYWxfYXNzaWdubWVudFwiXG4gIC8qKiBUaGUgc2lnbmFsIGlzIHRoaXMgbW9kdWxlJ3MgYGlucHV0YCBwb3J0OiBkcml2ZW4gZnJvbSBvdXRzaWRlLiAqL1xuICB8IFwicG9ydF9pbnB1dFwiXG4gIC8qKiBUaGUgc2lnbmFsIGlzIHRoaXMgbW9kdWxlJ3MgYG91dHB1dGAgcG9ydDogcmVhZCBmcm9tIHRoZSBpbnNpZGUuICovXG4gIHwgXCJwb3J0X291dHB1dFwiXG4gIC8qKiBUaGUgbmV0IHJlYWNoZXMgYW4gaW5wdXQgcG9ydCBvZiBhIHN1Ym1vZHVsZSwgd2hpY2ggcmVhZHMgaXQuICovXG4gIHwgXCJpbnN0YW5jZV9pbnB1dFwiXG4gIC8qKiBUaGUgbmV0IGNvbWVzIGZyb20gYW4gb3V0cHV0IHBvcnQgb2YgYSBzdWJtb2R1bGUsIHdoaWNoIGRyaXZlcyBpdC4gKi9cbiAgfCBcImluc3RhbmNlX291dHB1dFwiO1xuXG5leHBvcnQgdHlwZSBBY2Nlc3NLaW5kID0gXCJkcml2ZVwiIHwgXCJsb2FkXCI7XG5cbi8qKiBPbmUgcmVhZCBvciB3cml0ZSBvZiBvbmUgc2lnbmFsLCB3aXRoIGVub3VnaCBjb250ZXh0IHRvIGV4cGxhaW4gaXRzZWxmLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaWduYWxBY2Nlc3Mge1xuICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNjb3BlSWQ6IG51bWJlcjtcbiAgcmVhZG9ubHkga2luZDogQWNjZXNzS2luZDtcbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICByZWFkb25seSBzb3VyY2U6IEFjY2Vzc1NvdXJjZTtcbiAgLyoqIFNob3J0IGh1bWFuLXJlYWRhYmxlIGV4cGxhbmF0aW9uLCBlLmcuIGBhc3NpZ24gZG91dCA9IC4uLmAuICovXG4gIHJlYWRvbmx5IGRldGFpbDogc3RyaW5nO1xuICAvKiogUG9ydCBuYW1lLCB3aGVuIHRoZSBhY2Nlc3MgY2FtZSBmcm9tIGEgcG9ydCBib3VuZGFyeS4gKi9cbiAgcmVhZG9ubHkgcG9ydD86IHN0cmluZztcbn1cblxuLyoqIEEgbGV4aWNhbCBzY29wZSB0aGF0IG93bnMgc3ltYm9sczogbW9kdWxlLCBpbnRlcmZhY2UsIHBhY2thZ2UsIGNsYXNzLCAuLi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGRsU2NvcGUge1xuICByZWFkb25seSBpZDogbnVtYmVyO1xuICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGNhdGVnb3J5OiBTY29wZUNhdGVnb3J5O1xuICByZWFkb25seSBwYXJlbnRJZD86IG51bWJlcjtcbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICByZWFkb25seSBzZWxlY3Rpb25SYW5nZTogUmFuZ2U7XG4gIC8qKiBWZXJiYXRpbSBoZWFkZXIsIGUuZy4gYG1vZHVsZSBmaWZvICMocGFyYW1ldGVyIGludCBXID0gOCkgKGAuICovXG4gIHJlYWRvbmx5IGhlYWRlclRleHQ6IHN0cmluZztcbiAgcmVhZG9ubHkgcGFyYW1ldGVyczogSGRsU3ltYm9sW107XG4gIHJlYWRvbmx5IHBvcnRzOiBIZGxTeW1ib2xbXTtcbiAgcmVhZG9ubHkgc3ltYm9sczogSGRsU3ltYm9sW107XG4gIHJlYWRvbmx5IGluc3RhbmNlczogSGRsSW5zdGFuY2VbXTtcbiAgcmVhZG9ubHkgY2hpbGRyZW46IEhkbFNjb3BlW107XG4gIC8qKlxuICAgKiBUaGUgY2xhc3MgdGhpcyBvbmUgZXh0ZW5kcywgd2l0aG91dCBpdHMgcGFyYW1ldGVyIG92ZXJyaWRlcy5cbiAgICpcbiAgICogQSBzdWJjbGFzcyBpbmhlcml0cyBldmVyeSBtZW1iZXIgb2YgdGhlIGJhc2UsIHNvIHJlc29sdXRpb24gaGFzIHRvIGtub3dcbiAgICogd2hhdCB0byBsb29rIGJlaGluZDsgdGhlIGJhc2UgbWF5IHdlbGwgbGl2ZSBpbiBhbm90aGVyIGZpbGUuXG4gICAqL1xuICByZWFkb25seSBiYXNlQ2xhc3M/OiBzdHJpbmc7XG4gIC8qKiBPd25lciBvZiBhbiBvdXQtb2YtYmxvY2sgaW1wbGVtZW50YXRpb24gKGB0YXNrIEM6OnJ1bmApLiAqL1xuICByZWFkb25seSBvd25lckNsYXNzPzogc3RyaW5nO1xuICAvKiogUGFja2FnZXMgYnJvdWdodCBpbnRvIHNjb3BlIGJ5IGFuIGBpbXBvcnRgIHN0YXRlbWVudC4gKi9cbiAgcmVhZG9ubHkgaW1wb3J0cz86IHJlYWRvbmx5IFBhY2thZ2VJbXBvcnRbXTtcbn1cblxuLyoqIE9uZSBgaW1wb3J0IHBrZzo6KjtgIG9yIGBpbXBvcnQgcGtnOjpOQU1FO2AgaW5zaWRlIGEgc2NvcGUuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhY2thZ2VJbXBvcnQge1xuICByZWFkb25seSBwYWNrYWdlTmFtZTogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgYHBrZzo6KmAsIGZhbHNlIGZvciBuYW1lZCBpbXBvcnRzLiAqL1xuICByZWFkb25seSB3aWxkY2FyZDogYm9vbGVhbjtcbiAgLyoqIFRoZSBuYW1lcyBsaXN0ZWQgZXhwbGljaXRseSwgd2hlbiB0aGUgaW1wb3J0IGlzIG5vdCBhIHdpbGRjYXJkLiAqL1xuICByZWFkb25seSBleHBsaWNpdDogcmVhZG9ubHkgc3RyaW5nW107XG4gIHJlYWRvbmx5IHJhbmdlOiBSYW5nZTtcbn1cblxuLyoqXG4gKiBFdmVyeSBpZGVudGlmaWVyICpyZWZlcmVuY2UqIGluIGEgZmlsZSwgcmVjb3JkZWQgZHVyaW5nIGFuYWx5c2lzLiBEcml2ZXNcbiAqIFwiZmluZCBhbGwgcmVmZXJlbmNlc1wiIGFuZCB0aGUgdW5rbm93bi1pZGVudGlmaWVyIGRpYWdub3N0aWMgaW4gb25lIHBhc3MuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSWRlbnRpZmllclVzZSB7XG4gIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICAvKiogTm9kZSB0eXBlIG9mIHRoZSByZWZlcmVuY2UsIGUuZy4gYG5ldF9sdmFsdWVgLCBgc2ltcGxlX2lkZW50aWZpZXJgLiAqL1xuICByZWFkb25seSBjb250ZXh0OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNjb3BlSWQ6IG51bWJlcjtcbn1cblxuLyoqIFJlc3VsdCBvZiBhbmFseXNpbmcgb25lIGRvY3VtZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmFseXNpcyB7XG4gIHJlYWRvbmx5IHNjb3BlczogSGRsU2NvcGVbXTtcbiAgcmVhZG9ubHkgc2NvcGVzQnlJZDogTWFwPG51bWJlciwgSGRsU2NvcGU+O1xuICByZWFkb25seSBpZGVudGlmaWVyczogTWFwPHN0cmluZywgSWRlbnRpZmllclVzZVtdPjtcbiAgcmVhZG9ubHkgdXNlczogSWRlbnRpZmllclVzZVtdO1xuICAvKipcbiAgICogRXZlcnkgZHJpdmUgYW5kIGxvYWQgZGVjbGFyZWQgaW4gdGhpcyBkb2N1bWVudCwgd2l0aCB0aGUgcmFuZ2UgcG9pbnRpbmcgYXRcbiAgICogdGhlIHNpZ25hbCBpdHNlbGYuIEluc3RhbmNlIGNvbm5lY3Rpb25zIGFyZSBhZGRlZCBsYXRlciwgb25jZSB0aGUgY2F0YWxvZ1xuICAgKiBjYW4gc3VwcGx5IHBvcnQgZGlyZWN0aW9ucy4gRHJpdmVzIHRoZSBTaWduYWwgVHJhY2VyLlxuICAgKi9cbiAgcmVhZG9ubHkgYWNjZXNzZXM6IFNpZ25hbEFjY2Vzc1tdO1xuICByZWFkb25seSBzY29wZXNCeVJhbmdlOiBTY29wZUluZGV4RW50cnlbXTtcbiAgcmVhZG9ubHkgcGFyc2VUcmVlOiBpbXBvcnQoXCJ3ZWItdHJlZS1zaXR0ZXJcIikuVHJlZTtcbiAgcmVhZG9ubHkgZHVyYXRpb25NczogbnVtYmVyO1xuICAvKipcbiAgICogRXZlcnkgYGltcG9ydGAgaW4gdGhpcyBmaWxlLCBpbmNsdWRpbmcgb25lcyBhdCBjb21waWxhdGlvbi11bml0IGxldmVsXG4gICAqIHdoZXJlIG5vIHNjb3BlIG93bnMgdGhlbS5cbiAgICovXG4gIHJlYWRvbmx5IGltcG9ydHM6IHJlYWRvbmx5IFBhY2thZ2VJbXBvcnRbXTtcbiAgLyoqXG4gICAqIEV2ZXJ5IGBgIGBpbmNsdWRlIGBgIGluIHRoaXMgZmlsZSwgaW4gc291cmNlIG9yZGVyLlxuICAgKlxuICAgKiBXaGF0IHRoZSBmaWxlIHB1bGxzIGluIGRlY2lkZXMgd2hhdCBpdCBjYW4gc2VlOiBhIHBhY2thZ2UgbmFtZWQgYnkgYW5cbiAgICogaW5jbHVkZSBpcyBvZnRlbiBpbiBhIGZvbGRlciB0aGUgd29ya3NwYWNlIHdhbGsgbmV2ZXIgcmVhY2hlcywgYW5kIHRoZVxuICAgKiBkaXJlY3RpdmUgaXMgdGhlIG9ubHkgdGhpbmcgdGhhdCBzYXlzIHNvLlxuICAgKi9cbiAgcmVhZG9ubHkgaW5jbHVkZXM6IHJlYWRvbmx5IEluY2x1ZGVEaXJlY3RpdmVbXTtcbiAgLyoqIENsYXNzIG5hbWVzIGtub3duIHdoZW4gdGhpcyBmaWxlIHdhcyBhbmFseXNlZCwgcGx1cyB0aGUgb25lcyBpdCBkZWNsYXJlcy4gKi9cbiAgcmVhZG9ubHkgY2xhc3NOYW1lczogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqXG4gICAqIElkcyBvZiB0aGUgbm9kZXMgdGhhdCAqZGVjbGFyZSogYSBuYW1lLCBzbyBhIHdhbGsgY2FuIHRlbGwgYSBkZWNsYXJhdGlvblxuICAgKiBmcm9tIGEgcmVmZXJlbmNlIHdpdGhvdXQgYSBzZWNvbmQgcGFzcyBvdmVyIHRoZSB0cmVlLlxuICAgKi9cbiAgcmVhZG9ubHkgZGVjbGFyYXRpb25OYW1lczogUmVhZG9ubHlTZXQ8bnVtYmVyPjtcbiAgLyoqXG4gICAqIERlY2xhcmF0aW9ucyB0aGF0IGJlbG9uZyB0byBubyBzY29wZTogd2hhdCBhIGhlYWRlciBsZWF2ZXMgaW4gdGhlXG4gICAqIGNvbXBpbGF0aW9uIHVuaXQuXG4gICAqXG4gICAqIEEgc2hhcmVkIGhlYWRlciBkZWNsYXJlcyBpdHMgdHlwZXMgYWJvdmUgdGhlIGZpcnN0IGBtb2R1bGVgLCBhbmQgdGhlIGZpbGVcbiAgICogdGhhdCBgYCBgaW5jbHVkZSBgYHMgaXQgdXNlcyB0aGVtIGFzIGlmIHRoZXkgd2VyZSBsb2NhbC4gTm90aGluZyBpbnNpZGUgdGhlXG4gICAqIGluY2x1ZGluZyBkb2N1bWVudCBkZWNsYXJlcyB0aGVtLCBzbyB0aGUgY2F0YWxvZyBoYW5kcyB0aGVtIG92ZXIgZnJvbSB0aGVcbiAgICogaGVhZGVyJ3Mgb3duIGFuYWx5c2lzLlxuICAgKi9cbiAgcmVhZG9ubHkgdW5pdFN5bWJvbHM6IHJlYWRvbmx5IEhkbFN5bWJvbFtdO1xufVxuXG4vKiogQW4gaW50ZXJ2YWwgaW5kZXggb3ZlciBzY29wZSByYW5nZXMsIGZvciBPKGxvZyBuKSBzY29wZSBsb29rdXAgYnkgcG9zaXRpb24uICovXG5leHBvcnQgaW50ZXJmYWNlIFNjb3BlSW5kZXhFbnRyeSB7XG4gIHJlYWRvbmx5IHNjb3BlOiBIZGxTY29wZTtcbiAgcmVhZG9ubHkgc3RhcnQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgZW5kOiBudW1iZXI7XG4gIHJlYWRvbmx5IGRlcHRoOiBudW1iZXI7XG59XG5cbi8qKiBJbmNsdXNpdmUgYW5jZXN0cnkgY2hhaW4sIGlubmVybW9zdCBsYXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNjb3BlQ2hhaW4oYW5hbHlzaXM6IEFuYWx5c2lzLCBwb3NpdGlvbjogbnVtYmVyKTogSGRsU2NvcGVbXSB7XG4gIGNvbnN0IG1hdGNoZXMgPSBhbmFseXNpcy5zY29wZXNCeVJhbmdlLmZpbHRlcigoZSkgPT4gZS5zdGFydCA8PSBwb3NpdGlvbiAmJiBwb3NpdGlvbiA8PSBlLmVuZCk7XG4gIHJldHVybiBtYXRjaGVzLnNvcnQoKGEsIGIpID0+IGEuZGVwdGggLSBiLmRlcHRoKS5tYXAoKGUpID0+IGUuc2NvcGUpO1xufVxuXG4vKiogQWxsIHN5bWJvbHMgdmlzaWJsZSBhdCBgcG9zaXRpb25gLCBpbm5lcm1vc3Qgc2NvcGUgbGFzdCwgZGVkdXBsaWNhdGVkIGJ5IG5hbWUuICovXG5leHBvcnQgZnVuY3Rpb24gdmlzaWJsZVN5bWJvbHMoYW5hbHlzaXM6IEFuYWx5c2lzLCBwb3NpdGlvbjogbnVtYmVyKTogSGRsU3ltYm9sW10ge1xuICBjb25zdCBjaGFpbiA9IHNjb3BlQ2hhaW4oYW5hbHlzaXMsIHBvc2l0aW9uKTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBvdXQ6IEhkbFN5bWJvbFtdID0gW107XG5cbiAgY29uc3QgY29uc2lkZXIgPSAoc3ltOiBIZGxTeW1ib2wpID0+IHtcbiAgICAvLyBQcmVmZXIgdGhlIGlubmVybW9zdCBkZWNsYXJhdGlvbiB3aGVuIGEgbmFtZSBpcyBzaGFkb3dlZC5cbiAgICBpZiAoc2Vlbi5oYXMoc3ltLm5hbWUpKSByZXR1cm47XG4gICAgc2Vlbi5hZGQoc3ltLm5hbWUpO1xuICAgIG91dC5wdXNoKHN5bSk7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IGNoYWluLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgY29uc3Qgc2NvcGUgPSBjaGFpbltpXSE7XG4gICAgZm9yIChjb25zdCBzeW0gb2Ygc2NvcGUucGFyYW1ldGVycykgY29uc2lkZXIoc3ltKTtcbiAgICBmb3IgKGNvbnN0IHN5bSBvZiBzY29wZS5wb3J0cykgY29uc2lkZXIoc3ltKTtcbiAgICBmb3IgKGNvbnN0IHN5bSBvZiBzY29wZS5zeW1ib2xzKSBjb25zaWRlcihzeW0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBSZXNvbHZlcyBhIG5hbWUgYXQgYHBvc2l0aW9uYCB1c2luZyBub3JtYWwgc2hhZG93aW5nIHJ1bGVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTeW1ib2woYW5hbHlzaXM6IEFuYWx5c2lzLCBuYW1lOiBzdHJpbmcsIHBvc2l0aW9uOiBudW1iZXIpOiBIZGxTeW1ib2wgfCB1bmRlZmluZWQge1xuICByZXR1cm4gdmlzaWJsZVN5bWJvbHMoYW5hbHlzaXMsIHBvc2l0aW9uKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpO1xufVxuXG4vKipcbiAqIE5hbWVzIGFuIGBpbXBvcnRgIHN0YXRlbWVudCBicmluZ3MgaW50byBzY29wZS5cbiAqXG4gKiBgaW1wb3J0IGNmZ19wa2c6Oio7YCBtYWtlcyBldmVyeSBwdWJsaWMgbWVtYmVyIG9mIGBjZmdfcGtnYCB1c2FibGUgdW5xdWFsaWZpZWQ7XG4gKiBgaW1wb3J0IGNmZ19wa2c6OldJRFRIO2AgYnJpbmdzIG9ubHkgdGhhdCBvbmUuIFRoZSBtZW1iZXJzIHRoZW1zZWx2ZXMgbGl2ZSBpblxuICogYW5vdGhlciBmaWxlLCBzbyB0aGlzIHJldHVybnMgdGhlIGltcG9ydCBpbnN0cnVjdGlvbnMgYW5kIGxlYXZlcyB0aGUgbG9va3VwIHRvXG4gKiB3aG9ldmVyIGhvbGRzIHRoZSBjYXRhbG9nLlxuICpcbiAqIEltcG9ydHMgYXQgY29tcGlsYXRpb24tdW5pdCBsZXZlbCBhcHBseSBldmVyeXdoZXJlIGluIHRoZSBmaWxlLCBzbyB0aGV5IGFyZVxuICogbWVyZ2VkIHdpdGggdGhlIG9uZXMgb3duZWQgYnkgdGhlIGVuY2xvc2luZyBzY29wZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbXBvcnRzSW5TY29wZShhbmFseXNpczogQW5hbHlzaXMsIHBvc2l0aW9uOiBudW1iZXIpOiBQYWNrYWdlSW1wb3J0W10ge1xuICBjb25zdCBjaGFpbiA9IHNjb3BlQ2hhaW4oYW5hbHlzaXMsIHBvc2l0aW9uKTtcblxuICBjb25zdCBvdXQ6IFBhY2thZ2VJbXBvcnRbXSA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxQYWNrYWdlSW1wb3J0PigpO1xuXG4gIGNvbnN0IGNvbnNpZGVyID0gKGxpc3Q6IHJlYWRvbmx5IFBhY2thZ2VJbXBvcnRbXSB8IHVuZGVmaW5lZCk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgbGlzdCA/PyBbXSkge1xuICAgICAgaWYgKHNlZW4uaGFzKGVudHJ5KSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChlbnRyeSk7XG4gICAgICBvdXQucHVzaChlbnRyeSk7XG4gICAgfVxuICB9O1xuXG4gIGNvbnNpZGVyKGFuYWx5c2lzLmltcG9ydHMpO1xuICBmb3IgKGNvbnN0IHNjb3BlIG9mIGNoYWluKSBjb25zaWRlcihzY29wZS5pbXBvcnRzKTtcblxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBgbmFtZWAgaXMgaW1wb3J0ZWQgaW50byBzY29wZSBieSBhbiBgaW1wb3J0YCBzdGF0ZW1lbnQuXG4gKlxuICogVGhlIG5hbWUgYWxvbmUgaXMgbm90IGVub3VnaCB0byBiZSBzdXJlIC0tIGEgbG9jYWwgZGVjbGFyYXRpb24gbWF5IHNoYWRvdyBhblxuICogaW1wb3J0ZWQgb25lIC0tIGJ1dCBpdCBpcyB3aGF0IHRoZSBjYWxsZXJzIG5lZWQgaW4gb3JkZXIgdG8gc3RvcCByZXBvcnRpbmcgYVxuICogcGVyZmVjdGx5IGdvb2QgY3Jvc3MtZmlsZSBuYW1lIGFzIHVuZGVjbGFyZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0ltcG9ydGVkTmFtZShpbXBvcnRzOiByZWFkb25seSBQYWNrYWdlSW1wb3J0W10sIG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gaW1wb3J0cy5zb21lKFxuICAgIChlbnRyeSkgPT4gZW50cnkud2lsZGNhcmQgfHwgZW50cnkuZXhwbGljaXQuc29tZSgobikgPT4gbiA9PT0gbmFtZSksXG4gICk7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG5pbXBvcnQgdHlwZSB7IEFuYWx5c2lzIH0gZnJvbSBcIi4vbW9kZWwuanNcIjtcblxuLyoqXG4gKiBUaGUgbW9zdCBzcGVjaWZpYyBub2RlIGNvdmVyaW5nIGBvZmZzZXRgLlxuICpcbiAqIGBuYW1lZERlc2NlbmRhbnRGb3JJbmRleGAgcmV0dXJucyB0aGUgc21hbGxlc3QgbmFtZWQgbm9kZSB3aG9zZSByYW5nZSBjb250YWluc1xuICogdGhlIGluZGV4LCB3aGljaCBpcyB3aGF0IHdlIHdhbnQsIGJ1dCBpdCBjYW4gYWxzbyBsYW5kIG9uIGEgbm9kZSB0aGF0IG1lcmVseVxuICogc3RhcnRzIGF0IGBvZmZzZXRgLiBUaGUgZmFsbGJhY2sgdG8gYG9mZnNldCAtIDFgIGNvdmVycyB0aGUgdmVyeSBjb21tb24gY2FzZVxuICogb2YgYSBjYXJldCBzaXR0aW5nIGltbWVkaWF0ZWx5IGFmdGVyIGFuIGlkZW50aWZpZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub2RlQXQoYW5hbHlzaXM6IEFuYWx5c2lzLCBvZmZzZXQ6IG51bWJlcik6IE5vZGUgfCBudWxsIHtcbiAgY29uc3Qgcm9vdCA9IGFuYWx5c2lzLnBhcnNlVHJlZS5yb290Tm9kZTtcbiAgZm9yIChjb25zdCBwcm9iZSBvZiBbb2Zmc2V0LCBvZmZzZXQgLSAxXSkge1xuICAgIGlmIChwcm9iZSA8IDAgfHwgcHJvYmUgPiByb290LmVuZEluZGV4KSBjb250aW51ZTtcbiAgICBjb25zdCBub2RlID0gcm9vdC5uYW1lZERlc2NlbmRhbnRGb3JJbmRleChwcm9iZSk7XG4gICAgaWYgKG5vZGUpIHJldHVybiBub2RlO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSBpZGVudGlmaWVyIHVuZGVyIHRoZSBjdXJzb3IsIG9yIG51bGwgd2hlbiB0aGUgY2FyZXQgaXMgbm90IG9uIG9uZS5cbiAqXG4gKiBDaGVja3MgdGhlIG9mZnNldCBpdHNlbGYgZmlyc3QsIHRoZW4gdGhlIGNoYXJhY3RlciBiZWZvcmUgaXQsIHNvIGJvdGhcbiAqIGBvYmoubmF8bWVgIGFuZCBgb2JqLm5hbXxlYCByZXNvbHZlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaWRlbnRpZmllckF0KGFuYWx5c2lzOiBBbmFseXNpcywgb2Zmc2V0OiBudW1iZXIpOiBOb2RlIHwgbnVsbCB7XG4gIGNvbnN0IHJvb3QgPSBhbmFseXNpcy5wYXJzZVRyZWUucm9vdE5vZGU7XG4gIGZvciAoY29uc3QgcHJvYmUgb2YgW29mZnNldCwgb2Zmc2V0IC0gMV0pIHtcbiAgICBpZiAocHJvYmUgPCAwIHx8IHByb2JlID4gcm9vdC5lbmRJbmRleCkgY29udGludWU7XG4gICAgY29uc3Qgbm9kZSA9IHJvb3QubmFtZWREZXNjZW5kYW50Rm9ySW5kZXgocHJvYmUpO1xuICAgIGlmIChub2RlICYmIG5vZGUudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKSByZXR1cm4gbm9kZTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn0iLCAiaW1wb3J0IHR5cGUgeyBDYXRhbG9nLCBDYXRhbG9nRW50cnkgfSBmcm9tIFwiLi9jYXRhbG9nLmpzXCI7XG5pbXBvcnQgeyBpbXBvcnRzSW5TY29wZSwgc2NvcGVDaGFpbiwgdHlwZSBBbmFseXNpcywgdHlwZSBIZGxTeW1ib2wsIHR5cGUgUGFja2FnZUltcG9ydCB9IGZyb20gXCIuL21vZGVsLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEluY2x1ZGVSZXNvbHZlciB9IGZyb20gXCIuL2luY2x1ZGVzLmpzXCI7XG5pbXBvcnQgeyBwYXRoVG9VcmksIHVyaVRvUGF0aCB9IGZyb20gXCIuL3BhdGhzLmpzXCI7XG5cbi8qKlxuICogRmluZGluZyB0aGluZ3MgdGhhdCBsaXZlIGluIGFub3RoZXIgZmlsZS5cbiAqXG4gKiBUaHJlZSBtZWNoYW5pc21zIGNyb3NzIGEgZmlsZSBib3VuZGFyeSBhbmQgbm9uZSBvZiB0aGVtIGlzIGEgcGxhaW4gc2NvcGVcbiAqIGNoYWluOiBhIGRvdHRlZCBwYXRoIHRocm91Z2ggYW4gaW5zdGFuY2UsIGEgYHBrZzo6bmFtZWAgc2NvcGUgcmVzb2x1dGlvbixcbiAqIGFuZCBhbiBgaW1wb3J0YCB0aGF0IG1ha2VzIGFub3RoZXIgcGFja2FnZSdzIG1lbWJlcnMgdXNhYmxlIHVucXVhbGlmaWVkLiBUaGV5XG4gKiBzaGFyZSB0aGUgc2FtZSBwcm9ibGVtIC0tIHRoZSBkZWNsYXJhdGlvbiBpcyBpbmRleGVkLCBidXQgdmlzaWJsZSBsb29rdXBcbiAqIGNhbm5vdCByZWFjaCBpdCAtLSBzbyB0aGUgbG9va3VwIGxpdmVzIGhlcmUgcmF0aGVyIHRoYW4gaW4gZWFjaCBwcm92aWRlci5cbiAqL1xuXG4vKiogQSBkZWNsYXJhdGlvbiByZWFjaGVkIHRocm91Z2ggYW4gYGltcG9ydGAsIGFuZCB3aGVyZSBpdCBsaXZlcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW1wb3J0ZWRNZW1iZXIge1xuICByZWFkb25seSBzeW1ib2w6IEhkbFN5bWJvbDtcbiAgcmVhZG9ubHkgcGFja2FnZU5hbWU6IHN0cmluZztcbiAgLyoqIEZpbGUgdGhlIGRlY2xhcmF0aW9uIGlzIHdyaXR0ZW4gaW4sIHdoaWNoIG1heSBub3QgYmUgdGhlIHJlYWRpbmcgb25lLiAqL1xuICByZWFkb25seSB1cmk6IHN0cmluZztcbn1cblxuLyoqIEEgZGVjbGFyYXRpb24gYSBoZWFkZXIgcHVsbGVkIGluLCBhbmQgdGhlIGZpbGUgdGhhdCBkZWNsYXJlcyBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW5jbHVkZWREZWNsYXJhdGlvbiB7XG4gIHJlYWRvbmx5IHN5bWJvbDogSGRsU3ltYm9sO1xuICAvKiogRmlsZSB0aGUgZGVjbGFyYXRpb24gaXMgd3JpdHRlbiBpbiwgd2hpY2ggaXMgbm90IHRoZSByZWFkaW5nIG9uZS4gKi9cbiAgcmVhZG9ubHkgdXJpOiBzdHJpbmc7XG4gIC8qKiBMYXN0IHBhdGggc2VnbWVudCBvZiB0aGF0IGZpbGUsIGZvciBob3ZlciBhbmQgY29tcGxldGlvbiBkZXRhaWwuICovXG4gIHJlYWRvbmx5IGhlYWRlcjogc3RyaW5nO1xufVxuXG4vKipcbiAqIFRoZSBkZWNsYXJhdGlvbnMgYGAgYGluY2x1ZGUgYGBkIGhlYWRlcnMgbWFrZSB2aXNpYmxlLCB0cmFuc2l0aXZlbHkuXG4gKlxuICogQSBzaGFyZWQgaGVhZGVyIHdyaXRlcyBpdHMgdHlwZXMgYWJvdmUgaXRzIGZpcnN0IG1vZHVsZSwgd2hlcmUgbm8gc2NvcGUgb3duc1xuICogdGhlbSwgYW5kIGV2ZXJ5IGZpbGUgdGhhdCBpbmNsdWRlcyBpdCB1c2VzIHRob3NlIG5hbWVzIGRpcmVjdGx5LiBUaGUgbmFtZXNcbiAqIGJlbG9uZyB0byB0aGUgY29tcGlsYXRpb24gdW5pdCwgc28gdGhleSBhcmUgbG9va2VkIGZvciBhY3Jvc3MgdGhlIHdob2xlXG4gKiBpbmNsdWRlIGNsb3N1cmUgYW5kIG5vdCBvbmx5IGluIHRoZSBmaWxlIG5hbWVkIG9uIHRoZSBkaXJlY3RpdmUgLS0gYSBoZWFkZXJcbiAqIHRoYXQgaW5jbHVkZXMgdGhyZWUgbW9yZSBpcyBleGFjdGx5IGhvdyBhIHByb2plY3QgbGF5cyBvdXQgaXRzIHR5cGVzLlxuICpcbiAqIE9ubHkgbmFtZXMgdGhhdCBzb21ldGhpbmcgY2FuIGJlIGZvdW5kIGZvciBhcmUgcmV0dXJuZWQ6IGEgaGVhZGVyIHRoZVxuICogd29ya3NwYWNlIGNhbm5vdCByZWFjaCBjb250cmlidXRlcyBub3RoaW5nLCBhbmQgc2F5aW5nIHNvIHdvdWxkIGhpZGUgYSBuYW1lXG4gKiB0aGUgYXV0aG9yIHJlYWxseSBkaWQgbWlzdHlwZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluY2x1ZGVkRGVjbGFyYXRpb25zKFxuICB1cmk6IHN0cmluZyxcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbiAgaW5jbHVkZXM6IEluY2x1ZGVSZXNvbHZlcixcbik6IEluY2x1ZGVkRGVjbGFyYXRpb25bXSB7XG4gIGNvbnN0IGZpbGUgPSB1cmlUb1BhdGgodXJpKTtcbiAgLy8gQW4gdW50aXRsZWQgYnVmZmVyIGhhcyBubyBkaXJlY3RvcnkgdG8gcmVzb2x2ZSBhbiBpbmNsdWRlIGFnYWluc3QsIGFuZCBub1xuICAvLyBoZWFkZXIgdG8gY2xhaW0gYXMgaXRzIG93biwgc28gZXZlcnkgbG9va3VwIGJlbG93IGl0IGlzIHNraXBwZWQgcmF0aGVyIHRoYW5cbiAgLy8gYW5zd2VyZWQgZnJvbSB0aGUgd3JvbmcgZmlsZS5cbiAgaWYgKCFmaWxlKSByZXR1cm4gW107XG5cbiAgY29uc3Qgb3V0OiBJbmNsdWRlZERlY2xhcmF0aW9uW10gPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGZvciAoY29uc3QgaGVhZGVyIG9mIGluY2x1ZGVzLmNsb3N1cmUoZmlsZSkpIHtcbiAgICBjb25zdCBoZWFkZXJVcmkgPSBwYXRoVG9VcmkoaGVhZGVyKTtcbiAgICBmb3IgKGNvbnN0IHN5bWJvbCBvZiBjYXRhbG9nLnVuaXREZWNsYXJhdGlvbnMoaGVhZGVyVXJpKSkge1xuICAgICAgLy8gVGhlIGZpcnN0IGhlYWRlciB3aW5zOiBhbiBpbmNsdWRlIG5lYXJlciB0aGUgdG9wIG9mIHRoZSBmaWxlIHNoYWRvd3NcbiAgICAgIC8vIG9uZSBwdWxsZWQgaW4gZnVydGhlciBkb3duLCB3aGljaCBpcyB3aGF0IHRoZSBwcmVwcm9jZXNzb3IgcHJvZHVjZXMuXG4gICAgICBpZiAoc2Vlbi5oYXMoc3ltYm9sLm5hbWUpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKHN5bWJvbC5uYW1lKTtcbiAgICAgIG91dC5wdXNoKHsgc3ltYm9sLCB1cmk6IGhlYWRlclVyaSwgaGVhZGVyOiBiYXNlTmFtZU9mKGhlYWRlcikgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFRoZSBvbmUgc3VjaCBkZWNsYXJhdGlvbiBjYWxsZWQgYG5hbWVgLCBpZiB0aGUgaW5jbHVkZSBjbG9zdXJlIHByb3ZpZGVzIGl0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluY2x1ZGVkRGVjbGFyYXRpb24oXG4gIHVyaTogc3RyaW5nLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBpbmNsdWRlczogSW5jbHVkZVJlc29sdmVyLFxuICBuYW1lOiBzdHJpbmcsXG4pOiBJbmNsdWRlZERlY2xhcmF0aW9uIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGluY2x1ZGVkRGVjbGFyYXRpb25zKHVyaSwgY2F0YWxvZywgaW5jbHVkZXMpLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5zeW1ib2wubmFtZSA9PT0gbmFtZSk7XG59XG5cbi8qKlxuICogSG93IGZhciBhbiBpbXBvcnQgY2hhaW4gaXMgZm9sbG93ZWQuXG4gKlxuICogQSBwYWNrYWdlIHRoYXQgZG9lcyBgaW1wb3J0IGJhc2U6OipgIHBhc3NlcyB0aG9zZSBuYW1lcyBvbiB0byB3aG9ldmVyIGltcG9ydHNcbiAqIGl0LCB3aGljaCBpcyB3aGF0IGRlc2lnbnMgaW4gdGhlIHdpbGQgZXhwZWN0IGV2ZW4gdGhvdWdoIHRoZSBsYW5ndWFnZSBvbmx5XG4gKiBwcm9taXNlcyBpdCBmb3IgYGV4cG9ydGAuIFdpdGhvdXQgdGhpcywgYSBwYXJhbWV0ZXIgdHdvIHBhY2thZ2VzIGF3YXkgaXNcbiAqIHJlcG9ydGVkIGFzIHVuZGVjbGFyZWQgaW4gZXZlcnkgZmlsZSB0aGF0IHVzZXMgaXQgLS0gd2hpbGUgdGhlIGZpbGUgdGhhdFxuICogZGVjbGFyZXMgaXQgbG9va3MgcGVyZmVjdGx5IGNvcnJlY3QsIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIGJ1ZyBzbyBoYXJkIHRvXG4gKiBzZWUuIEEgaGFuZGZ1bCBvZiBob3BzIGNvdmVycyBhbnkgcmVhbCBkZXBlbmRlbmN5IGNoYWluLCBhbmQgdGhlIHNldCBvZlxuICogdmlzaXRlZCBwYWNrYWdlcyBzdG9wcyBhIGN5Y2xlIGZyb20gbG9vcGluZy5cbiAqL1xuY29uc3QgTUFYX0lNUE9SVF9IT1BTID0gODtcblxuLyoqXG4gKiBUaGUgbWVtYmVycyBhbiBpbXBvcnQgbWFrZXMgYXZhaWxhYmxlLCBmb2xsb3dpbmcgdGhlIGNoYWluLlxuICpcbiAqIEFuIGltcG9ydCBkb2VzIG5vdCBjb3B5IGFueXRoaW5nOiBgaW1wb3J0IGNmZ19wa2c6Oio7YCBsZWF2ZXMgYFdJRFRIYFxuICogcmVmZXJyaW5nIHRvIHRoZSBwYXJhbWV0ZXIgZGVjbGFyZWQgaW5zaWRlIGBjZmdfcGtnYCwgaW4gdGhhdCBmaWxlLiBUaGF0IGlzXG4gKiB3aHkgdGhlIGRlY2xhcmF0aW9uJ3Mgb3duIHJhbmdlIGlzIHJldHVybmVkIGFsb25nc2lkZSB0aGUgZmlsZSBpdCBsaXZlcyBpbi5cbiAqXG4gKiBUaGUgZmlyc3QgcGFja2FnZSB0byBkZWNsYXJlIGEgbmFtZSB3aW5zLCB3aGljaCBpcyB3aGF0IHNoYWRvd2luZyBtZWFucyBoZXJlOlxuICogYSBsYXRlciB3aWxkY2FyZCBpbXBvcnQgY2Fubm90IG92ZXJyaWRlIHdoYXQgYW4gZWFybGllciBvbmUgYnJvdWdodCBpbi5cbiAqL1xuZnVuY3Rpb24gY29sbGVjdEZyb20oXG4gIGNhdGFsb2c6IENhdGFsb2csXG4gIGVudHJ5OiBDYXRhbG9nRW50cnksXG4gIHdhbnRlZDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICBvdXQ6IEltcG9ydGVkTWVtYmVyW10sXG4gIHNlZW46IFNldDxzdHJpbmc+LFxuICBob3BzOiBudW1iZXIsXG4pOiB2b2lkIHtcbiAgaWYgKGhvcHMgPiBNQVhfSU1QT1JUX0hPUFMgfHwgc2Vlbi5oYXMoZW50cnkubmFtZSkpIHJldHVybjtcbiAgc2Vlbi5hZGQoZW50cnkubmFtZSk7XG5cbiAgZm9yIChjb25zdCBzeW1ib2wgb2YgWy4uLmVudHJ5LnBhcmFtZXRlcnMsIC4uLmVudHJ5LnBvcnRzLCAuLi5lbnRyeS5zeW1ib2xzXSkge1xuICAgIGlmICh3YW50ZWQgIT09IHVuZGVmaW5lZCAmJiBzeW1ib2wubmFtZSAhPT0gd2FudGVkKSBjb250aW51ZTtcbiAgICBpZiAob3V0LnNvbWUoKGZvdW5kKSA9PiBmb3VuZC5zeW1ib2wubmFtZSA9PT0gc3ltYm9sLm5hbWUpKSBjb250aW51ZTtcbiAgICBvdXQucHVzaCh7IHN5bWJvbCwgcGFja2FnZU5hbWU6IGVudHJ5Lm5hbWUsIHVyaTogZW50cnkudXJpIH0pO1xuICB9XG5cbiAgLy8gQSBwYWNrYWdlIHRoYXQgaXMgbm90IGZ1bGx5IGluZGV4ZWQgeWV0IHNpbXBseSBoYXMgbm90aGluZyB0byBwYXNzIG9uLlxuICBmb3IgKGNvbnN0IGltcG9ydGVkIG9mIGVudHJ5LmltcG9ydHMpIHtcbiAgICBpZiAoIWltcG9ydGVkLndpbGRjYXJkKSBjb250aW51ZTtcbiAgICBjb25zdCBuZXh0ID0gcmVzb2x2ZVBhY2thZ2UoY2F0YWxvZywgaW1wb3J0ZWQucGFja2FnZU5hbWUsIGVudHJ5LnVyaSk7XG4gICAgaWYgKG5leHQpIGNvbGxlY3RGcm9tKGNhdGFsb2csIG5leHQsIHdhbnRlZCwgb3V0LCBzZWVuLCBob3BzICsgMSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIHBhY2thZ2UgbmFtZSwgcHJlZmVycmluZyB0aGUgZGVjbGFyYXRpb24gbmV4dCB0byB0aGUgaW1wb3J0aW5nXG4gKiBmaWxlIGFuZCBmYWxsaW5nIGJhY2sgdG8gdGhlIGZpcnN0IG9uZSBpbmRleGVkLlxuICpcbiAqIEEgcGFja2FnZSBvZiB0aGUgc2FtZSBuYW1lIGNhbiBsZWdpdGltYXRlbHkgYmUgZGVjbGFyZWQgbW9yZSB0aGFuIG9uY2UsIGFzIGFcbiAqIHZlbmRvciBsaWJyYXJ5IHBsdXMgYSBsb2NhbCB3cmFwcGVyLCBzbyBcIm5leHQgdG8gbWVcIiBpcyBub3QgbWVyZWx5IGFcbiAqIHByZWZlcmVuY2UuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVQYWNrYWdlKGNhdGFsb2c6IENhdGFsb2csIG5hbWU6IHN0cmluZywgbmVhclVyaTogc3RyaW5nKTogQ2F0YWxvZ0VudHJ5IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgZW50cmllcyA9IGNhdGFsb2cuYWxsKG5hbWUpO1xuICByZXR1cm4gZW50cmllcy5maW5kKChlbnRyeSkgPT4gZW50cnkudXJpID09PSBuZWFyVXJpKSA/PyBlbnRyaWVzWzBdO1xufVxuXG4vKiogV2hldGhlciBgbmFtZWAgaXMgb25lIG9mIHRoZSBuYW1lcyB0aGlzIGltcG9ydCBicmluZ3MgaW4uICovXG5mdW5jdGlvbiBicmluZ3NJbihlbnRyeTogUGFja2FnZUltcG9ydCwgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBlbnRyeS53aWxkY2FyZCB8fCBlbnRyeS5leHBsaWNpdC5pbmNsdWRlcyhuYW1lKTtcbn1cblxuLyoqXG4gKiBUaGUgbWVtYmVyIG9mIGFuIGltcG9ydGVkIHBhY2thZ2UgdGhhdCBgbmFtZWAgcmVmZXJzIHRvLCBpZiBhbnkuXG4gKlxuICogQSBsb2NhbCBkZWNsYXJhdGlvbiB3aW5zLCBhbmQgaXMgdGhlIGNhbGxlcidzIGJ1c2luZXNzOiBzaGFkb3dpbmcgYW4gaW1wb3J0ZWRcbiAqIG5hbWUgaXMgbGVnYWwsIHNvIHRoaXMgb25seSBhbnN3ZXJzIGZvciBuYW1lcyBub3RoaW5nIGVsc2UgaGFzIGNsYWltZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbXBvcnRlZE1lbWJlcihcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBwb3NpdGlvbjogbnVtYmVyLFxuICBuYW1lOiBzdHJpbmcsXG4pOiBJbXBvcnRlZE1lbWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGV4dGVybmFsID0gZXh0ZXJuYWxNZW1iZXJzKGFuYWx5c2lzLCBjYXRhbG9nLCBwb3NpdGlvbikuZmluZCgocykgPT4gcy5zeW1ib2wubmFtZSA9PT0gbmFtZSk7XG4gIGlmIChleHRlcm5hbCkgcmV0dXJuIGV4dGVybmFsO1xuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGltcG9ydHNJblNjb3BlKGFuYWx5c2lzLCBwb3NpdGlvbikpIHtcbiAgICAvLyBBbiBleHBsaWNpdCBpbXBvcnQgbmFtZXMgZXhhY3RseSBvbmUgbWVtYmVyLCBzbyBhIG1pc3NpbmcgbmFtZSBoZXJlIGlzIGFcbiAgICAvLyByZWFsIGVycm9yIGFuZCBtdXN0IG5vdCBiZSBsb29rZWQgZm9yIGluIHRoZSBwYWNrYWdlcyBpdCByZS1leHBvcnRzLlxuICAgIGlmICghYnJpbmdzSW4oZW50cnksIG5hbWUpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHBrZyA9IGNhdGFsb2cucmVzb2x2ZShlbnRyeS5wYWNrYWdlTmFtZSk7XG4gICAgaWYgKCFwa2cpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgZm91bmQ6IEltcG9ydGVkTWVtYmVyW10gPSBbXTtcbiAgICBjb2xsZWN0RnJvbShjYXRhbG9nLCBwa2csIG5hbWUsIGZvdW5kLCBuZXcgU2V0KCksIDApO1xuICAgIGlmIChmb3VuZC5sZW5ndGggPiAwKSByZXR1cm4gZm91bmRbMF07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKiogRXZlcnkgbWVtYmVyIGFuIGltcG9ydCBicmluZ3MgaW50byBzY29wZSwgZm9yIGNvbXBsZXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gaW1wb3J0ZWRNZW1iZXJzKFxuICBhbmFseXNpczogQW5hbHlzaXMsXG4gIGNhdGFsb2c6IENhdGFsb2csXG4gIHBvc2l0aW9uOiBudW1iZXIsXG4pOiBJbXBvcnRlZE1lbWJlcltdIHtcbiAgY29uc3Qgb3V0OiBJbXBvcnRlZE1lbWJlcltdID0gZXh0ZXJuYWxNZW1iZXJzKGFuYWx5c2lzLCBjYXRhbG9nLCBwb3NpdGlvbik7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGltcG9ydHNJblNjb3BlKGFuYWx5c2lzLCBwb3NpdGlvbikpIHtcbiAgICBjb25zdCBwa2cgPSBjYXRhbG9nLnJlc29sdmUoZW50cnkucGFja2FnZU5hbWUpO1xuICAgIGlmICghcGtnKSBjb250aW51ZTtcblxuICAgIGlmIChlbnRyeS53aWxkY2FyZCkge1xuICAgICAgY29sbGVjdEZyb20oY2F0YWxvZywgcGtnLCB1bmRlZmluZWQsIG91dCwgc2VlbiwgMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgZW50cnkuZXhwbGljaXQpIHtcbiAgICAgIGlmICghYnJpbmdzSW4oZW50cnksIG5hbWUpKSBjb250aW51ZTtcbiAgICAgIC8vIEEgZnJlc2ggYHNlZW5gIHBlciBuYW1lLCBzbyB0d28gZXhwbGljaXQgaW1wb3J0cyBvZiB0aGUgc2FtZSBwYWNrYWdlIGRvXG4gICAgICAvLyBub3QgaGlkZSBlYWNoIG90aGVyJ3MgbmFtZXMuXG4gICAgICBjb2xsZWN0RnJvbShjYXRhbG9nLCBwa2csIG5hbWUsIG91dCwgbmV3IFNldCgpLCAwKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBleHRlcm5hbE1lbWJlcnMoYW5hbHlzaXM6IEFuYWx5c2lzLCBjYXRhbG9nOiBDYXRhbG9nLCBwb3NpdGlvbjogbnVtYmVyKTogSW1wb3J0ZWRNZW1iZXJbXSB7XG4gIGNvbnN0IGNoYWluID0gc2NvcGVDaGFpbihhbmFseXNpcywgcG9zaXRpb24pO1xuICBjb25zdCBpbXBsZW1lbnRhdGlvbiA9IGNoYWluLmZpbmQoKHNjb3BlKSA9PiBzY29wZS5vd25lckNsYXNzKTtcbiAgY29uc3Qgb3duZXIgPSBpbXBsZW1lbnRhdGlvbj8ub3duZXJDbGFzcyA/PyBjaGFpbi5maW5kKChzY29wZSkgPT4gc2NvcGUuY2F0ZWdvcnkgPT09IFwiY2xhc3NcIik/Lm5hbWU7XG4gIGNvbnN0IG1lbWJlcnMgPSBjYXRhbG9nLmV4dGVybmFsRGVjbGFyYXRpb25zKG93bmVyKS5tYXAoKG1lbWJlcikgPT4gKHsgLi4ubWVtYmVyLCBwYWNrYWdlTmFtZTogb3duZXIgPz8gXCIkdW5pdFwiIH0pKTtcbiAgaWYgKG93bmVyKSBtZW1iZXJzLnB1c2goLi4uY2F0YWxvZy5leHRlcm5hbERlY2xhcmF0aW9ucygpLmZpbHRlcigobSkgPT4gIW1lbWJlcnMuc29tZSgob3duKSA9PiBvd24uc3ltYm9sLm5hbWUgPT09IG0uc3ltYm9sLm5hbWUpKVxuICAgIC5tYXAoKG1lbWJlcikgPT4gKHsgLi4ubWVtYmVyLCBwYWNrYWdlTmFtZTogXCIkdW5pdFwiIH0pKSk7XG4gIC8vIFNvbWUgb3V0LW9mLWJsb2NrIGJvZGllcyBvbWl0IHRoZSBhcmd1bWVudCBsaXN0IHJlcGVhdGVkIGluIHRoZSBleHRlcm5cbiAgLy8gcHJvdG90eXBlLiBLZWVwIHRoZSBkZWNsYXJhdGlvbidzIGxvY2F0aW9uIHdoZW4gc3VwcGx5aW5nIHRob3NlIG5hbWVzLlxuICBjb25zdCBwcm90b3R5cGUgPSBpbXBsZW1lbnRhdGlvbiA/IG1lbWJlcnMuZmluZCgobSkgPT4gbS5zeW1ib2wubmFtZSA9PT0gaW1wbGVtZW50YXRpb24ubmFtZSkgOiB1bmRlZmluZWQ7XG4gIGlmIChwcm90b3R5cGUpIG1lbWJlcnMudW5zaGlmdCguLi4ocHJvdG90eXBlLnN5bWJvbC5hcmd1bWVudHMgPz8gW10pLm1hcCgoc3ltYm9sKSA9PiAoe1xuICAgIHN5bWJvbCwgdXJpOiBwcm90b3R5cGUudXJpLCBwYWNrYWdlTmFtZTogb3duZXIhLFxuICB9KSkpO1xuICByZXR1cm4gbWVtYmVycztcbn1cblxuLyogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICpcbiAqIEZpbGVzXG4gKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLyoqIFRoZSBsYXN0IHBhdGggc2VnbWVudCBvZiBhIGZpbGUsIGZvciB0aGUgZGV0YWlsIGxpbmVzIG9mIGhvdmVyIGFuZCBjb21wbGV0aW9uLiAqL1xuZnVuY3Rpb24gYmFzZU5hbWVPZihmaWxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwYXJ0cyA9IGZpbGUuc3BsaXQoXCIvXCIpO1xuICByZXR1cm4gcGFydHNbcGFydHMubGVuZ3RoIC0gMV0gPz8gZmlsZTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFJhbmdlIH0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10eXBlc1wiO1xuaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG5pbXBvcnQgdHlwZSB7IENhdGFsb2csIENhdGFsb2dFbnRyeSB9IGZyb20gXCIuL2NhdGFsb2cuanNcIjtcbmltcG9ydCB7IHNjb3BlQ2hhaW4sIHR5cGUgQW5hbHlzaXMsIHR5cGUgSGRsU2NvcGUsIHR5cGUgSGRsU3ltYm9sIH0gZnJvbSBcIi4vbW9kZWwuanNcIjtcbmltcG9ydCB7IGltcG9ydGVkTWVtYmVyIH0gZnJvbSBcIi4vaW1wb3J0cy5qc1wiO1xuXG4vKipcbiAqIEZvbGxvd2luZyBhIGRvdHRlZCBuYW1lIGFjcm9zcyB0aGUgZGVzaWduIGhpZXJhcmNoeS5cbiAqXG4gKiBgRFVUX2lmLmFkY19pbmAsIGBEVVQudV9zdWIuZGVlcF9zaWdgIGFuZCBgZ2VuX2lbM10ubWVtYmVyYCBhbGwgbmFtZVxuICogc29tZXRoaW5nIGRlY2xhcmVkIGluIGFub3RoZXIgc2NvcGUsIHBvc3NpYmx5IGluIGFub3RoZXIgZmlsZS4gTG9jYWwgc2NvcGVcbiAqIGxvb2t1cCBjYW5ub3QgYW5zd2VyIHRoZW06IHRoZSBkZWNsYXJhdGlvbiBsaXZlcyBpbnNpZGUgYW4gaW50ZXJmYWNlLCBhXG4gKiBzdWJtb2R1bGUgb3IgYSBnZW5lcmF0ZSBibG9jaywgbm90IGluIHRoZSBmaWxlIGJlaW5nIHJlYWQuXG4gKlxuICogRWFjaCBzdGVwIGlzIHJlc29sdmVkIGluIHR1cm4gLS0gaW5zdGFuY2UgZmlyc3QsIHRoZW4gbWVtYmVyIC0tIGFuZCB0aGUgd2Fsa1xuICogc3RvcHMgYXMgc29vbiBhcyBhIHN0ZXAgY2Fubm90IGJlIHJlc29sdmVkLCBiZWNhdXNlIGEgcGF0aCB0aGF0IGlzIHdyb25nIGF0XG4gKiBwb3NpdGlvbiAyIHNheXMgbm90aGluZyBhYm91dCBwb3NpdGlvbnMgMyBhbmQgNC5cbiAqL1xuXG4vKiogT25lIHNlZ21lbnQgb2YgYSBoaWVyYXJjaGljYWwgcmVmZXJlbmNlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYXRoU2VnbWVudCB7XG4gIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcmFuZ2U6IFJhbmdlO1xuICAvKiogSW5kZXggaW50byB0aGUgc2VnbWVudCBvZiBhbiBhcnJheSBzZWxlY3QsIHdoZW4gdGhlIHBhdGggaW5kZXhlcy4gKi9cbiAgcmVhZG9ubHkgaW5kZXg/OiBzdHJpbmc7XG59XG5cbi8qKiBBIGRlY2xhcmF0aW9uIHJlYWNoZWQgYnkgZm9sbG93aW5nIGEgcGF0aCwgYW5kIHdoZXJlIGl0IGxpdmVzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFBhdGgge1xuICByZWFkb25seSBzeW1ib2w6IEhkbFN5bWJvbDtcbiAgLyoqIEZpbGUgdGhlIGRlY2xhcmF0aW9uIGlzIHdyaXR0ZW4gaW4sIHdoaWNoIG1heSBub3QgYmUgdGhpcyBvbmUuICovXG4gIHJlYWRvbmx5IHVyaTogc3RyaW5nO1xuICAvKiogVHJ1ZSB3aGVuIHRoZSBkZWNsYXJhdGlvbiBpcyBhIG1lbWJlciBvZiBhbiBpbnRlcmZhY2UuICovXG4gIHJlYWRvbmx5IHZpYUludGVyZmFjZTogYm9vbGVhbjtcbiAgLyoqIFRoZSBpbnRlcmZhY2UgaW5zdGFuY2UgdGhlIHdhbGsgd2VudCB0aHJvdWdoLCB3aGVuIGl0IGRpZC4gKi9cbiAgcmVhZG9ubHkgaW5zdGFuY2U/OiBzdHJpbmc7XG4gIC8qKiBTZXQgd2hlbiB0aGUgc2NvcGUgd2FzIHJlYWNoYWJsZSBidXQgdGhlIG5hbWVkIG1lbWJlciB3YXMgbm90IGluIGl0LiAqL1xuICBtaXNzaW5nTWVtYmVyPzogYm9vbGVhbjtcbiAgLyoqIFRoZSBuYW1lIHRoYXQgd2FzIGxvb2tlZCBmb3IgYW5kIG5vdCBmb3VuZC4gKi9cbiAgbWlzc2luZ05hbWU/OiBzdHJpbmc7XG59XG5cbi8qKiBOb2RlIHR5cGVzIHRoYXQgd3JhcCBhIHdob2xlIHJlZmVyZW5jZSwgb3V0ZXJtb3N0IGZpcnN0LiAqL1xuY29uc3QgUEFUSF9XUkFQUEVSUyA9IG5ldyBTZXQoW1xuICBcImhpZXJhcmNoaWNhbF9pZGVudGlmaWVyXCIsXG4gIFwic2VsZWN0XCIsXG4gIFwiYml0X3NlbGVjdFwiLFxuICBcInBhcnRfc2VsZWN0X3JhbmdlXCIsXG4gIFwic2NvcGVfcmVzb2x1dGlvblwiLFxuICAvLyBUaGUgY2hhaW4gdGhpcyBncmFtbWFyIHB1dHMgYXJvdW5kIGEgYHBrZzo6bmFtZWAuIEluIGFuIGV4cHJlc3Npb24gaXQgaXNcbiAgLy8gYG1ldGhvZF9jYWxsID4gc3Vicm91dGluZV9jYWxsID4gZnVuY3Rpb25fc3Vicm91dGluZV9jYWxsYDsgaW4gYSBjb25zdGFudFxuICAvLyBpbml0aWFsaXNlciB0d28gbW9yZSBjb25zdGFudC1leHByZXNzaW9uIGxheWVycyBhcmUgc3RhY2tlZCBvbiB0b3AsIGFuZFxuICAvLyB0aGUgbWVtYmVyIGl0c2VsZiBzaXRzIGluIGEgYG1ldGhvZF9jYWxsX2JvZHlgLlxuICBcIm1ldGhvZF9jYWxsXCIsXG4gIFwibWV0aG9kX2NhbGxfYm9keVwiLFxuICBcInN1YnJvdXRpbmVfY2FsbFwiLFxuICBcImZ1bmN0aW9uX3N1YnJvdXRpbmVfY2FsbFwiLFxuICBcImNvbnN0YW50X2Z1bmN0aW9uX2NhbGxcIixcbiAgXCJjb25zdGFudF9wcmltYXJ5XCIsXG5dKTtcblxuLyoqXG4gKiBTcGxpdHMgYERVVC51X3N1YlszXS5zaWdgIGludG8gaXRzIHNlZ21lbnRzLCBvdXRlcm1vc3QgZmlyc3QuXG4gKlxuICogUmV0dXJucyB1bmRlZmluZWQgd2hlbiB0aGUgbm9kZSBpcyBub3QgYSBwYXRoIGF0IGFsbCwgd2hpY2ggaXMgdGhlIGNvbW1vblxuICogY2FzZTogYSBiYXJlIG5hbWUgaXMgYWxzbyB3cmFwcGVkIGluIGEgYGhpZXJhcmNoaWNhbF9pZGVudGlmaWVyYCBieSB0aGlzXG4gKiBncmFtbWFyLCBhbmQgb25seSB0aGUgbnVtYmVyIG9mIHNlZ21lbnRzIHRlbGxzIHRoZW0gYXBhcnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXRoT2Yobm9kZTogTm9kZSB8IG51bGwgfCB1bmRlZmluZWQpOiBQYXRoU2VnbWVudFtdIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgdG9wID0gZW5jbG9zaW5nUmVmZXJlbmNlKG5vZGUpO1xuICBpZiAoIXRvcCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBzZWdtZW50czogUGF0aFNlZ21lbnRbXSA9IFtdO1xuICBjb2xsZWN0KHRvcCwgc2VnbWVudHMpO1xuXG4gIHJldHVybiBzZWdtZW50cy5sZW5ndGggPiAxID8gc2VnbWVudHMgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogVGhlIHdob2xlIGBhLmIuY2AgcmVmZXJlbmNlIGEgbm9kZSBiZWxvbmdzIHRvLCB3aGVuIGl0IGlzIGEgcGF0aC5cbiAqXG4gKiBDYWxsZXJzIHVzdWFsbHkgaG9sZCBvbmUgc2VnbWVudCAtLSBgYmAgb3V0IG9mIGBEVVRfaWYuYmAgLS0gYmVjYXVzZSB0aGF0IGlzXG4gKiB3aGF0IHRoZSBjdXJzb3IgbGFuZHMgb24sIHNvIHRoZSBlbmNsb3NpbmcgcmVmZXJlbmNlIGhhcyB0byBiZSByZWNvdmVyZWRcbiAqIGJlZm9yZSB0aGUgcGF0aCBjYW4gYmUgd2Fsa2VkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZW5jbG9zaW5nUmVmZXJlbmNlKG5vZGU6IE5vZGUgfCBudWxsIHwgdW5kZWZpbmVkKTogTm9kZSB8IHVuZGVmaW5lZCB7XG4gIGlmICghbm9kZSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBsZXQgdG9wID0gbm9kZTtcblxuICB3aGlsZSAodG9wLnBhcmVudCkge1xuICAgIGNvbnN0IHBhcmVudCA9IHRvcC5wYXJlbnQ7XG5cbiAgICAvLyBUd28gd2F5cyBhIHBhcmVudCBpcyBzdGlsbCBwYXJ0IG9mIHRoZSBzYW1lIHJlZmVyZW5jZS4gRWl0aGVyIHRoZSBncmFtbWFyXG4gICAgLy8gc2F5cyBzbywgb3IgdGhlIHdyYXBwZXIgYWRkcyBjb250ZXh0IHdpdGhvdXQgbW92aW5nIHRoZSByZWZlcmVuY2U6IGl0XG4gICAgLy8gc3RhcnRzIHdoZXJlIHRoaXMgbm9kZSBzdGFydHMgYW5kIGlzIHN0cmljdGx5IGxvbmdlci4gVGhhdCBzZWNvbmQgdGVzdCBpc1xuICAgIC8vIHdoYXQgZ2V0cyBwYXN0IGBjb25zdGFudF9wcmltYXJ5YCBhbmQgYG1ldGhvZF9jYWxsX2JvZHlgLCB3aGljaCBzaXRcbiAgICAvLyBiZXR3ZWVuIHRoZSBpZGVudGlmaWVyIGFuZCB0aGUgYG1ldGhvZF9jYWxsYCB0aGF0IGNhcnJpZXMgdGhlIGA6OmAuXG4gICAgY29uc3QgYnlUeXBlID0gUEFUSF9XUkFQUEVSUy5oYXMocGFyZW50LnR5cGUpO1xuICAgIGNvbnN0IGJ5UG9zaXRpb24gPSBwYXJlbnQuc3RhcnRJbmRleCA9PT0gdG9wLnN0YXJ0SW5kZXggJiYgcGFyZW50LnRleHQubGVuZ3RoID4gdG9wLnRleHQubGVuZ3RoO1xuICAgIGlmICghYnlUeXBlICYmICFieVBvc2l0aW9uKSBicmVhaztcblxuICAgIHRvcCA9IHBhcmVudDtcbiAgfVxuXG4gIC8vIEEgc2luZ2xlIG5hbWUgaXMgbm90IGEgcGF0aCwgYW5kIHdhbGtpbmcgb25lIHdvdWxkIGJlIGEgbm8tb3AgYW55d2F5LlxuICByZXR1cm4gcGF0aFNlZ21lbnRzT2YodG9wKS5sZW5ndGggPiAxID8gdG9wIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBwYXRoU2VnbWVudHNPZih0b3A6IE5vZGUpOiBQYXRoU2VnbWVudFtdIHtcbiAgY29uc3Qgc2VnbWVudHM6IFBhdGhTZWdtZW50W10gPSBbXTtcbiAgY29sbGVjdCh0b3AsIHNlZ21lbnRzKTtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG4vKipcbiAqIFNwbGl0cyBhIGBwa2c6Om5hbWVgIHJlZmVyZW5jZS5cbiAqXG4gKiBUaGlzIGdyYW1tYXIgaGFzIG5vIGBzY29wZV9yZXNvbHV0aW9uYCBub2RlIGF0IGFsbCwgc28gYSBwYWNrYWdlLXNjb3BlZCBuYW1lXG4gKiBhcnJpdmVzIGJ1cmllZCB1bmRlciB1cCB0byBmaXZlIHdyYXBwZXJzIC0tIGluIGEgY29uc3RhbnQgaW5pdGlhbGlzZXIgaXQgaXNcbiAqIGBjb25zdGFudF9mdW5jdGlvbl9jYWxsID4gZnVuY3Rpb25fc3Vicm91dGluZV9jYWxsID4gc3Vicm91dGluZV9jYWxsID5cbiAqIG1ldGhvZF9jYWxsYCwgYW5kIGluIGFuIGV4cHJlc3Npb24gb25lIGxheWVyIGlzIG1pc3NpbmcuIFdoaWNoIHdyYXBwZXIgaXMgb25cbiAqIHRvcCB0aGVyZWZvcmUgdmFyaWVzIHdpdGggd2hlcmUgdGhlIHJlZmVyZW5jZSBzaXRzLCBzbyB0aGUgc3BsaXQgaXMgZHJpdmVuIGJ5XG4gKiB0aGUgYDo6YCBpbiB0aGUgdGV4dCByYXRoZXIgdGhhbiBieSBhbnkgb25lIG5vZGUgdHlwZS5cbiAqL1xuZnVuY3Rpb24gY29sbGVjdFNjb3BlUmVzb2x2ZWQobm9kZTogTm9kZSwgaW50bzogUGF0aFNlZ21lbnRbXSk6IGJvb2xlYW4ge1xuICBpZiAoIW5vZGUudGV4dC5pbmNsdWRlcyhcIjo6XCIpKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgZXhwZWN0ZWQgPSBub2RlLnRleHQuc3BsaXQoXCI6OlwiKS5sZW5ndGg7XG4gIGNvbnN0IGlkZW50aWZpZXJzOiBOb2RlW10gPSBbXTtcblxuICBjb25zdCB3YWxrID0gKGN1cnJlbnQ6IE5vZGUpOiB2b2lkID0+IHtcbiAgICBpZiAoaWRlbnRpZmllcnMubGVuZ3RoID49IGV4cGVjdGVkKSByZXR1cm47XG4gICAgaWYgKGN1cnJlbnQudHlwZSA9PT0gXCJzaW1wbGVfaWRlbnRpZmllclwiKSB7XG4gICAgICBpZGVudGlmaWVycy5wdXNoKGN1cnJlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGN1cnJlbnQubmFtZWRDaGlsZHJlbikgd2FsayhjaGlsZCk7XG4gIH07XG4gIHdhbGsobm9kZSk7XG5cbiAgaWYgKGlkZW50aWZpZXJzLmxlbmd0aCA8IDIpIHJldHVybiBmYWxzZTtcblxuICBmb3IgKGNvbnN0IGlkZW50aWZpZXIgb2YgaWRlbnRpZmllcnMpIHtcbiAgICBpbnRvLnB1c2goe1xuICAgICAgbmFtZTogaWRlbnRpZmllci50ZXh0LFxuICAgICAgcmFuZ2U6IHtcbiAgICAgICAgc3RhcnQ6IHsgbGluZTogaWRlbnRpZmllci5zdGFydFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBpZGVudGlmaWVyLnN0YXJ0UG9zaXRpb24uY29sdW1uIH0sXG4gICAgICAgIGVuZDogeyBsaW5lOiBpZGVudGlmaWVyLmVuZFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBpZGVudGlmaWVyLmVuZFBvc2l0aW9uLmNvbHVtbiB9LFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gY29sbGVjdChub2RlOiBOb2RlLCBpbnRvOiBQYXRoU2VnbWVudFtdKTogdm9pZCB7XG4gIGlmIChjb2xsZWN0U2NvcGVSZXNvbHZlZChub2RlLCBpbnRvKSkgcmV0dXJuO1xuXG4gIC8vIGBoaWVyYXJjaGljYWxfaWRlbnRpZmllcmAgaG9sZHMgcGxhaW4gbmFtZXM7IGBzZWxlY3RgIGFkZHMgYW4gaW5kZXguXG4gIGlmIChub2RlLnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikge1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5uYW1lZENoaWxkcmVuKSB7XG4gICAgICBpbnRvLnB1c2goe1xuICAgICAgICBuYW1lOiBjaGlsZC50ZXh0LFxuICAgICAgICByYW5nZToge1xuICAgICAgICAgIHN0YXJ0OiB7IGxpbmU6IGNoaWxkLnN0YXJ0UG9zaXRpb24ucm93LCBjaGFyYWN0ZXI6IGNoaWxkLnN0YXJ0UG9zaXRpb24uY29sdW1uIH0sXG4gICAgICAgICAgZW5kOiB7IGxpbmU6IGNoaWxkLmVuZFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBjaGlsZC5lbmRQb3NpdGlvbi5jb2x1bW4gfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBoZWFkID0gbm9kZS5uYW1lZENoaWxkcmVuWzBdO1xuICBpZiAoIWhlYWQpIHJldHVybjtcbiAgaWYgKFtcInRmX2NhbGxcIiwgXCJzdWJyb3V0aW5lX2NhbGxfc3RhdGVtZW50XCIsIFwic3Vicm91dGluZV9jYWxsXCIsIFwiZnVuY3Rpb25fc3Vicm91dGluZV9jYWxsXCIsIFwiY29uc3RhbnRfZnVuY3Rpb25fY2FsbFwiXS5pbmNsdWRlcyhub2RlLnR5cGUpKSB7XG4gICAgY29sbGVjdChoZWFkLCBpbnRvKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQSBkb3R0ZWQgdGFzay9mdW5jdGlvbiBjYWxsIGlzIHdyYXBwZWQgaW4gdGZfY2FsbDsgaXRzIGZpcnN0IGNoaWxkIGlzXG4gIC8vIHRoZSBwYXRoLCB3aGlsZSB0aGUgcmVtYWluaW5nIGNoaWxkcmVuIGFyZSBhcmd1bWVudHMsIG5vdCBwYXRoIHNlZ21lbnRzLlxuICBpZiAobm9kZS50eXBlICE9PSBcInNlbGVjdFwiICYmIGhlYWQudHlwZSA9PT0gXCJoaWVyYXJjaGljYWxfaWRlbnRpZmllclwiKSB7XG4gICAgY29sbGVjdChoZWFkLCBpbnRvKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAobm9kZS50eXBlID09PSBcInNlbGVjdFwiKSB7XG4gICAgLy8gYGFbZXhwcl1gIC0tIGBuYW1lYCBpcyB0aGUgYXJyYXksIHRoZSBpbmRleCBzZWxlY3RzIGFuIGVsZW1lbnQgb2YgaXQuXG4gICAgY29uc3QgaWRlbnRpZmllciA9IGhlYWQubmFtZWRDaGlsZCgwKTtcbiAgICBpZiAoaWRlbnRpZmllcikge1xuICAgICAgaW50by5wdXNoKHtcbiAgICAgICAgbmFtZTogaWRlbnRpZmllci50ZXh0LFxuICAgICAgICByYW5nZToge1xuICAgICAgICAgIHN0YXJ0OiB7IGxpbmU6IGlkZW50aWZpZXIuc3RhcnRQb3NpdGlvbi5yb3csIGNoYXJhY3RlcjogaWRlbnRpZmllci5zdGFydFBvc2l0aW9uLmNvbHVtbiB9LFxuICAgICAgICAgIGVuZDogeyBsaW5lOiBpZGVudGlmaWVyLmVuZFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBpZGVudGlmaWVyLmVuZFBvc2l0aW9uLmNvbHVtbiB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IGluZGV4ID0gbm9kZS5uYW1lZENoaWxkcmVuWzFdPy50ZXh0O1xuICAgIGNvbnN0IGxhc3QgPSBpbnRvW2ludG8ubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxhc3QgJiYgaW5kZXgpIGludG9baW50by5sZW5ndGggLSAxXSA9IHsgLi4ubGFzdCwgaW5kZXggfTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAobm9kZS50eXBlID09PSBcInNjb3BlX3Jlc29sdXRpb25cIiAmJiBoZWFkLnR5cGUgIT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikge1xuICAgIC8vIGBwa2c6Om5hbWVgIC0tIGEgcGFja2FnZSBzY29wZSwgd2hpY2ggdGhlIGNhdGFsb2cgcmVzb2x2ZXMgYnkgbmFtZS5cbiAgICBjb2xsZWN0KGhlYWQsIGludG8pO1xuICAgIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5uYW1lZENoaWxkcmVuLnNsaWNlKDEpKSB7XG4gICAgICBpbnRvLnB1c2goe1xuICAgICAgICBuYW1lOiBjaGlsZC50ZXh0LFxuICAgICAgICByYW5nZToge1xuICAgICAgICAgIHN0YXJ0OiB7IGxpbmU6IGNoaWxkLnN0YXJ0UG9zaXRpb24ucm93LCBjaGFyYWN0ZXI6IGNoaWxkLnN0YXJ0UG9zaXRpb24uY29sdW1uIH0sXG4gICAgICAgICAgZW5kOiB7IGxpbmU6IGNoaWxkLmVuZFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBjaGlsZC5lbmRQb3NpdGlvbi5jb2x1bW4gfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICBpbnRvLnB1c2goe1xuICAgIG5hbWU6IGhlYWQudGV4dCxcbiAgICByYW5nZToge1xuICAgICAgc3RhcnQ6IHsgbGluZTogaGVhZC5zdGFydFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBoZWFkLnN0YXJ0UG9zaXRpb24uY29sdW1uIH0sXG4gICAgICBlbmQ6IHsgbGluZTogaGVhZC5lbmRQb3NpdGlvbi5yb3csIGNoYXJhY3RlcjogaGVhZC5lbmRQb3NpdGlvbi5jb2x1bW4gfSxcbiAgICB9LFxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgaW50ZXJmYWNlIGEgcG9ydCdzIG9yIHZhcmlhYmxlJ3MgdHlwZSBuYW1lcywgd2hlbiBpdCBuYW1lcyBvbmUuXG4gKlxuICogYGJ1c19pZi5zbGF2ZSBidXNgIHJlY29yZHMgdGhlIHR5cGUgYXMgYGJ1c19pZi5zbGF2ZWA6IHRoZSBpbnRlcmZhY2UgcGx1cyB0aGVcbiAqIG1vZHBvcnQgdGhlIHBvcnQgaXMgZGVjbGFyZWQgdGhyb3VnaC4gRm9sbG93aW5nIGBidXMuZGF0YWAgbmVlZHMgdGhlXG4gKiBpbnRlcmZhY2UsIHNvIHRoZSBtb2Rwb3J0IGlzIGRyb3BwZWQgYW5kIHRoZSB0cmFpbGluZyBuYW1lIGlzIGxvb2tlZCB1cCAtLVxuICogYHBrZzo6YnVzX2lmYCBpcyBsZWdhbCB0b28sIGFuZCBvbmx5IHRoZSBsYXN0IHNlZ21lbnQgaXMgdGhlIGludGVyZmFjZSBuYW1lLlxuICpcbiAqIFJldHVybnMgdW5kZWZpbmVkIGZvciBhbnl0aGluZyB0aGF0IGlzIG5vdCBhbiBpbnRlcmZhY2UsIGJlY2F1c2UgdGhlIHNhbWVcbiAqIHF1ZXN0aW9uIGlzIGFza2VkIG9mIGV2ZXJ5IHBvcnQgYW5kIG1vc3Qgb2YgdGhlbSBhcmUgcGxhaW4gbmV0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGludGVyZmFjZU9mVHlwZSh0eXBlVGV4dDogc3RyaW5nLCBjYXRhbG9nOiBDYXRhbG9nKTogQ2F0YWxvZ0VudHJ5IHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbGFzdCA9IHR5cGVUZXh0LnJlcGxhY2UoL152aXJ0dWFsXFxzKyg/OmludGVyZmFjZVxccyspPy8sIFwiXCIpXG4gICAgLnJlcGxhY2UoL1xccyojXFxzKlxcKFteXSpcXCkvLCBcIlwiKS50cmltKCkuc3BsaXQoXCI6OlwiKS5wb3AoKT8uc3BsaXQoXCIuXCIpWzBdPy50cmltKCk7XG4gIGlmICghbGFzdCkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCBjYW5kaWRhdGVzID0gY2F0YWxvZy5hbGwobGFzdCkuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJpbnRlcmZhY2VcIik7XG4gIHJldHVybiBjYW5kaWRhdGVzWzBdO1xufVxuXG4vKipcbiAqIFdhbGtzIGEgcGF0aCBmcm9tIGBvZmZzZXRgIGluIGBhbmFseXNpc2AuXG4gKlxuICogYG1pc3NpbmdNZW1iZXJgIHRlbGxzIGEgdHlwbyBmcm9tIGFuIHVucmVhY2hhYmxlIHBhdGg6IHdoZW4gdGhlIHdhbGsgZm91bmRcbiAqIHRoZSBzY29wZSB0byBsb29rIGluIGJ1dCB0aGUgbmFtZWQgbWVtYmVyIGlzIG5vdCB0aGVyZSwgdGhhdCBpcyBhIGZpbmRpbmcsXG4gKiB3aGVyZWFzIGZhaWxpbmcgdG8gcmVhY2ggdGhlIHNjb3BlIGF0IGFsbCBpcyBub3QgLS0gdGhlIGRlc2lnbiBtYXkgc2ltcGx5XG4gKiBub3QgYmUgaW5kZXhlZCB5ZXQuXG4gKi9cbi8qKlxuICogU2NvcGVzIGEgaGllcmFyY2hpY2FsIG5hbWUgY2FuIHN0ZXAgaW50bywgaW5kZXhlZCBieSBwYXJlbnQgYW5kIG5hbWUuXG4gKlxuICogQSBtb2R1bGUgaW5zdGFuY2UgYW5kIGEgbmFtZWQgYmxvY2sgYXJlIGJvdGggXCJhIHNjb3BlIHJlYWNoYWJsZSBieSBuYW1lXCIsIGFuZFxuICogdGhleSBhcmUgcmVhY2hlZCB0aGUgc2FtZSB3YXk6IGBzb21lTmFtZS5tZW1iZXJgLiBPbmx5IG1vZHVsZXMgY3Jvc3MgZmlsZXM7XG4gKiBhIGJsb2NrIGlzIGFsd2F5cyBsb2NhbCwgc28gdGhlIG1hcCBpcyBidWlsdCBwZXIgYW5hbHlzaXMgYW5kIGNhY2hlZC5cbiAqL1xuLyoqXG4gKiBUaGUgbmFtZWQgc2NvcGUgYG5hbWVgIHJlYWNoZXMgZnJvbSB0aGUgY2hhaW4gZW5jbG9zaW5nIGEgdXNlLlxuICpcbiAqIE5vdCBuZWNlc3NhcmlseSBhIGRpcmVjdCBjaGlsZCwgbm9yIGV2ZW4gYSBkZXNjZW5kYW50IGF0IG9uZSBmaXhlZCBkZXB0aDogYVxuICogYmxvY2sgaW5zaWRlIGEgYGdlbmVyYXRlYCBpcyBuZXN0ZWQgdW5kZXIgdGhlIHJlZ2lvbiwgeWV0IGBnYmxrLmxhbmVgIGlzXG4gKiB3cml0dGVuIGZyb20gdGhlIG1vZHVsZSdzIGJvZHkuIFNvIHRoZSBibG9jayBjb3VudHMgYXMgcmVhY2hhYmxlIHdoZW4gKmFueSpcbiAqIG9mIGl0cyBhbmNlc3RvcnMgaXMgb24gdGhlIGNoYWluLCBhbmQgdGhlIGNsb3Nlc3Qgb25lIHdpbnMuXG4gKi9cbmZ1bmN0aW9uIGNoaWxkTmFtZWQoXG4gIGFuYWx5c2lzOiBBbmFseXNpcyxcbiAgY2hhaW46IHJlYWRvbmx5IEhkbFNjb3BlW10sXG4gIG5hbWU6IHN0cmluZyxcbik6IEhkbFNjb3BlIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgb25DaGFpbiA9IG5ldyBTZXQoY2hhaW4ubWFwKChzY29wZSkgPT4gc2NvcGUuaWQpKTtcbiAgbGV0IGZvdW5kOiBIZGxTY29wZSB8IHVuZGVmaW5lZDtcbiAgbGV0IGZvdW5kRGVwdGggPSAtMTtcblxuICBmb3IgKGNvbnN0IHNjb3BlIG9mIGFuYWx5c2lzLnNjb3Blcykge1xuICAgIGlmIChzY29wZS5uYW1lICE9PSBuYW1lIHx8IHNjb3BlLnBhcmVudElkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGlmIChzY29wZS5jYXRlZ29yeSAhPT0gXCJibG9ja1wiICYmIHNjb3BlLmNhdGVnb3J5ICE9PSBcImZ1bmN0aW9uXCIgJiYgc2NvcGUuY2F0ZWdvcnkgIT09IFwidGFza1wiKSBjb250aW51ZTtcblxuICAgIC8vIFdhbGsgdXAgdW50aWwgYSBzY29wZSBvbiB0aGUgY2hhaW4gc2hvd3MgdXA7IHRoZSBudW1iZXIgb2YgaG9wcyBpcyB0aGVcbiAgICAvLyBkZXB0aCwgc28gdGhlIG5lYXJlc3QgYmxvY2sgd2lucy5cbiAgICBsZXQgZGVwdGggPSAwO1xuICAgIGxldCBwYXJlbnRJZDogbnVtYmVyIHwgdW5kZWZpbmVkID0gc2NvcGUucGFyZW50SWQ7XG4gICAgd2hpbGUgKHBhcmVudElkICE9PSB1bmRlZmluZWQgJiYgIW9uQ2hhaW4uaGFzKHBhcmVudElkKSkge1xuICAgICAgY29uc3QgcGFyZW50ID0gYW5hbHlzaXMuc2NvcGVzQnlJZC5nZXQocGFyZW50SWQpO1xuICAgICAgaWYgKCFwYXJlbnQpIGJyZWFrO1xuICAgICAgcGFyZW50SWQgPSBwYXJlbnQucGFyZW50SWQ7XG4gICAgICBkZXB0aCsrO1xuICAgIH1cbiAgICBpZiAocGFyZW50SWQgPT09IHVuZGVmaW5lZCB8fCBkZXB0aCA8PSBmb3VuZERlcHRoKSBjb250aW51ZTtcblxuICAgIGZvdW5kID0gc2NvcGU7XG4gICAgZm91bmREZXB0aCA9IGRlcHRoO1xuICB9XG5cbiAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIFRoZSBuYW1lZCBibG9jayBvciBtZXRob2Qgc2NvcGUgdmlzaWJsZSBmcm9tIGEgY2hhaW4gb2YgZW5jbG9zaW5nIHNjb3Blcy5cbiAqXG4gKiBFeHBvcnRlZCBiZWNhdXNlIGNvbXBsZXRpb24gYXNrcyB0aGUgc2FtZSBxdWVzdGlvbiBhcyBhIGhpZXJhcmNoaWNhbFxuICogcmVmZXJlbmNlOiBgbWFpbi5gIGluIGFuIGVkaXRvciBpcyBgbWFpbi5zb21ldGhpbmdgLCBhbmQgdGhlIGFuc3dlciBpcyB0aGVcbiAqIGJsb2NrJ3Mgb3duIHNjb3BlIHJhdGhlciB0aGFuIGFueXRoaW5nIGluIHRoZSBjYXRhbG9nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZU5hbWVkQmxvY2soXG4gIGFuYWx5c2lzOiBBbmFseXNpcyxcbiAgY2hhaW46IHJlYWRvbmx5IEhkbFNjb3BlW10sXG4gIG5hbWU6IHN0cmluZyxcbik6IEhkbFNjb3BlIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIGNoaWxkTmFtZWQoYW5hbHlzaXMsIGNoYWluLCBuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVQYXRoKFxuICBub2RlOiBOb2RlIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBkb2N1bWVudFVyaTogc3RyaW5nLFxuKTogUmVzb2x2ZWRQYXRoIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcmVzdWx0ID0gd2Fsa1BhdGgobm9kZSwgYW5hbHlzaXMsIGNhdGFsb2csIGRvY3VtZW50VXJpKTtcblxuICBpZiAocmVzdWx0ID09PSBcIm5vLXBhdGhcIikgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAvLyBUaGUgd2FsayByZWFjaGVkIHRoZSBzY29wZSBidXQgdGhlIG1lbWJlciBpcyBub3QgZGVjbGFyZWQgaW4gaXQsIHdoaWNoIGlzIGFcbiAgLy8gZmluZGluZyB0aGUgY2FsbGVyIG1heSB3YW50IHRvIHJlcG9ydCByYXRoZXIgdGhhbiBhIGRlYWQgZW5kLlxuICBpZiAoIShcInN5bWJvbFwiIGluIHJlc3VsdCkpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3ltYm9sOiBNSVNTSU5HLFxuICAgICAgdXJpOiBkb2N1bWVudFVyaSxcbiAgICAgIHZpYUludGVyZmFjZTogcmVzdWx0LnZpYUludGVyZmFjZSxcbiAgICAgIG1pc3NpbmdNZW1iZXI6IHRydWUsXG4gICAgICBtaXNzaW5nTmFtZTogcmVzdWx0Lm1pc3NpbmcsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogUGxhY2Vob2xkZXIgZm9yIGEgcGF0aCB0aGF0IHJlYWNoZWQgaXRzIHNjb3BlIGFuZCBmb3VuZCBub3RoaW5nLlxuICpcbiAqIEl0IGNhcnJpZXMgbm8gZGVjbGFyYXRpb247IGNhbGxlcnMgdGhhdCBvbmx5IGNhcmUgYWJvdXQgYSBoaXQgY2hlY2tcbiAqIGBtaXNzaW5nTWVtYmVyYCBmaXJzdC5cbiAqL1xuY29uc3QgTUlTU0lORyA9IHtcbiAgbmFtZTogXCJcIixcbiAgY2F0ZWdvcnk6IFwidmFyaWFibGVcIixcbiAgdHlwZVRleHQ6IFwiXCIsXG4gIHVucGFja2VkRGltczogW10sXG4gIGlzUG9ydDogZmFsc2UsXG4gIHNjb3BlSWQ6IC0xLFxuICByYW5nZTogeyBzdGFydDogeyBsaW5lOiAwLCBjaGFyYWN0ZXI6IDAgfSwgZW5kOiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9IH0sXG4gIHNlbGVjdGlvblJhbmdlOiB7IHN0YXJ0OiB7IGxpbmU6IDAsIGNoYXJhY3RlcjogMCB9LCBlbmQ6IHsgbGluZTogMCwgY2hhcmFjdGVyOiAwIH0gfSxcbn0gYXMgSGRsU3ltYm9sO1xuXG50eXBlIFdhbGtSZXN1bHQgPSBSZXNvbHZlZFBhdGggfCBcIm5vLXBhdGhcIiB8IHsgbWlzc2luZzogc3RyaW5nOyB2aWFJbnRlcmZhY2U6IGJvb2xlYW4gfTtcblxuLyoqIEEgc2NvcGUgd2FzIHJlYWNoZWQsIGFuZCBpdCBkb2VzIG5vdCBkZWNsYXJlIGBtaXNzaW5nYC4gKi9cbmZ1bmN0aW9uIG5vdEZvdW5kKG5hbWU6IHN0cmluZywgdmlhSW50ZXJmYWNlOiBib29sZWFuKTogV2Fsa1Jlc3VsdCB7XG4gIHJldHVybiB7IG1pc3Npbmc6IG5hbWUsIHZpYUludGVyZmFjZSB9O1xufVxuXG5mdW5jdGlvbiB3YWxrUGF0aChcbiAgbm9kZTogTm9kZSB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGFuYWx5c2lzOiBBbmFseXNpcyxcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbiAgZG9jdW1lbnRVcmk6IHN0cmluZyxcbik6IFdhbGtSZXN1bHQge1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGhPZihub2RlKTtcbiAgaWYgKCFzZWdtZW50cykgcmV0dXJuIFwibm8tcGF0aFwiO1xuXG4gIGNvbnN0IG9mZnNldCA9IG5vZGU/LnN0YXJ0SW5kZXggPz8gMDtcbiAgY29uc3QgY2hhaW4gPSBzY29wZUNoYWluKGFuYWx5c2lzLCBvZmZzZXQpO1xuXG4gIC8vIC0tLSB0aGUgZmlyc3Qgc2VnbWVudCBuYW1lcyBzb21ldGhpbmcgdmlzaWJsZSBmcm9tIGhlcmUgLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBjb25zdCBoZWFkID0gc2VnbWVudHNbMF0hO1xuICBpZiAoaGVhZC5uYW1lID09PSBcInRoaXNcIiB8fCBoZWFkLm5hbWUgPT09IFwic3VwZXJcIikge1xuICAgIGNvbnN0IG93bmVyID0gY2hhaW4uZmluZCgocykgPT4gcy5vd25lckNsYXNzKT8ub3duZXJDbGFzcyA/PyBjaGFpbi5maW5kKChzKSA9PiBzLmNhdGVnb3J5ID09PSBcImNsYXNzXCIpPy5uYW1lO1xuICAgIGxldCBlbnRyeSA9IG93bmVyID8gY2F0YWxvZy5yZXNvbHZlKG93bmVyKSA6IHVuZGVmaW5lZDtcbiAgICBpZiAoaGVhZC5uYW1lID09PSBcInN1cGVyXCIpIGVudHJ5ID0gZW50cnk/LmJhc2VDbGFzcyA/IGNhdGFsb2cucmVzb2x2ZShlbnRyeS5iYXNlQ2xhc3MpIDogdW5kZWZpbmVkO1xuICAgIGlmIChlbnRyeSkgcmV0dXJuIGludG9FbnRyeShlbnRyeSwgc2VnbWVudHMsIDEsIGNhdGFsb2csIGZhbHNlLCBoZWFkLm5hbWUpO1xuICB9XG5cbiAgLy8gQW4gaW5zdGFuY2Ugb2YgYSBtb2R1bGUsIGludGVyZmFjZSBvciBwYWNrYWdlOiB0aGUgcmVzdCBvZiB0aGUgcGF0aCBpc1xuICAvLyBpbnNpZGUgaXQuXG4gIGZvciAobGV0IGkgPSBjaGFpbi5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IGluc3RhbmNlID0gY2hhaW5baV0hLmluc3RhbmNlcy5maW5kKChpdCkgPT4gaXQuaW5zdGFuY2VOYW1lID09PSBoZWFkLm5hbWUpO1xuICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgcmV0dXJuIGludG9JbnN0YW5jZShpbnN0YW5jZS50eXBlTmFtZSwgc2VnbWVudHMsIGRvY3VtZW50VXJpLCBjYXRhbG9nKTtcbiAgICB9XG5cbiAgICAvLyBBIG5hbWVkIGJsb2NrOiBgbWFpbi5zY3JhdGNoYCBpbnNpZGUgYSB0ZXN0YmVuY2guIEl0IGlzIGxvY2FsLCBzbyB0aGVyZVxuICAgIC8vIGlzIG5vdGhpbmcgdG8gbG9vayB1cCBpbiB0aGUgY2F0YWxvZyAtLSB0aGUgbWVtYmVycyBhcmUgdGhlIHNjb3BlJ3Mgb3duLlxuICAgIGNvbnN0IGJsb2NrID0gY2hpbGROYW1lZChhbmFseXNpcywgY2hhaW4sIGhlYWQubmFtZSk7XG4gICAgaWYgKGJsb2NrKSByZXR1cm4gaW50b1Njb3BlKGJsb2NrLCBzZWdtZW50cywgMSwgZG9jdW1lbnRVcmkpO1xuICB9XG5cbiAgLy8gQSBsb2NhbCBkZWNsYXJhdGlvbi4gYFBhY2tldCBwa3Q7YCB0aGVuIGBwa3QucGF5bG9hZGAgbmVlZHMgdGhlIGNhdGFsb2cgdG9cbiAgLy8gc2F5IHdoYXQgYFBhY2tldGAgaG9sZHMsIGJlY2F1c2UgdGhlIGNsYXNzIHVzdWFsbHkgbGl2ZXMgaW4gYW5vdGhlciBmaWxlLlxuICBjb25zdCBsb2NhbCA9IHZpc2libGVJbkNoYWluKGNoYWluLCBoZWFkLm5hbWUpID8/IGltcG9ydGVkTWVtYmVyKGFuYWx5c2lzLCBjYXRhbG9nLCBvZmZzZXQsIGhlYWQubmFtZSk/LnN5bWJvbDtcbiAgaWYgKGxvY2FsKSB7XG4gICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIHsgc3ltYm9sOiBsb2NhbCwgdXJpOiBkb2N1bWVudFVyaSwgdmlhSW50ZXJmYWNlOiBmYWxzZSB9O1xuXG4gICAgaWYgKGxvY2FsLmhhbmRsZU9mKSB7XG4gICAgICBjb25zdCBlbnRyeSA9IGNhdGFsb2cucmVzb2x2ZShsb2NhbC5oYW5kbGVPZik7XG4gICAgICBpZiAoZW50cnkpIHJldHVybiBpbnRvRW50cnkoZW50cnksIHNlZ21lbnRzLCAxLCBjYXRhbG9nLCBmYWxzZSwgaGVhZC5uYW1lKTtcbiAgICB9XG5cbiAgICAvLyBBIHBvcnQgb3IgdmFyaWFibGUgb2YgaW50ZXJmYWNlIHR5cGU6IGBidXNfaWYuc2xhdmUgYnVzYCB0aGVuIGBidXMuZGF0YWAuXG4gICAgLy8gTm90aGluZyBlbHNlIGluIHRoZSBjaGFpbiBjYW4gYW5zd2VyIGZvciBpdCAtLSBpdCBpcyBub3QgYW4gaW5zdGFuY2UsIGl0XG4gICAgLy8gaXMgYSBuYW1lIGJvdW5kIHRvIGEgZm9yZWlnbiBzY29wZSBieSBpdHMgZGVjbGFyZWQgdHlwZS5cbiAgICBjb25zdCBpZmFjZSA9IGludGVyZmFjZU9mVHlwZShsb2NhbC50eXBlVGV4dCwgY2F0YWxvZyk7XG4gICAgaWYgKGlmYWNlKSByZXR1cm4gaW50b0VudHJ5KGlmYWNlLCBzZWdtZW50cywgMSwgY2F0YWxvZywgdHJ1ZSwgaGVhZC5uYW1lKTtcbiAgfVxuXG4gIC8vIEEgcGFja2FnZSBvciBjbGFzcyBuYW1lZCBkaXJlY3RseSwgZm9yIGBjZmdfcGtnOjpXSURUSGAuXG4gIGNvbnN0IHVuaXQgPSBjYXRhbG9nLmdldChoZWFkLm5hbWUpO1xuICBpZiAodW5pdCAmJiBzZWdtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgcmV0dXJuIGludG9FbnRyeSh1bml0LCBzZWdtZW50cywgMSwgY2F0YWxvZywgdW5pdC5raW5kID09PSBcImludGVyZmFjZVwiLCBoZWFkLm5hbWUpO1xuICB9XG5cbiAgcmV0dXJuIFwibm8tcGF0aFwiO1xufVxuXG4vKiogU3RlcHMgaW50byB0aGUgbW9kdWxlIG9yIGludGVyZmFjZSBhbiBpbnN0YW5jZSByZWZlcnMgdG8uICovXG5mdW5jdGlvbiBpbnRvSW5zdGFuY2UoXG4gIHR5cGVOYW1lOiBzdHJpbmcsXG4gIHNlZ21lbnRzOiBQYXRoU2VnbWVudFtdLFxuICBkb2N1bWVudFVyaTogc3RyaW5nLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuKTogV2Fsa1Jlc3VsdCB7XG4gIGNvbnN0IGVudHJ5ID0gY2F0YWxvZy5yZXNvbHZlKHR5cGVOYW1lKTtcbiAgaWYgKCFlbnRyeSkgcmV0dXJuIFwibm8tcGF0aFwiO1xuXG4gIHJldHVybiBpbnRvRW50cnkoZW50cnksIHNlZ21lbnRzLCAxLCBjYXRhbG9nLCBlbnRyeS5raW5kID09PSBcImludGVyZmFjZVwiLCBzZWdtZW50c1swXSEubmFtZSk7XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYHNlZ21lbnRzW2Zyb20uLi5dYCBhZ2FpbnN0IGEgc2NvcGUgdGhhdCBsaXZlcyBpbiB0aGlzIGZpbGUuXG4gKlxuICogQSBuYW1lZCBibG9jayBoYXMgbm8gZW50cnkgaW4gdGhlIGNhdGFsb2cgYW5kIG5vbmUgb2YgdGhlIHdpZHRoIG1hY2hpbmVyeSBhXG4gKiBjcm9zcy1maWxlIHdhbGsgbmVlZHM7IGl0IGlzIGp1c3QgYSBzY29wZSwgc28gdGhlIG1lbWJlcnMgYXJlIHJlYWQgc3RyYWlnaHRcbiAqIG91dCBvZiBpdCBhbmQgdGhlIGRlY2xhcmF0aW9uIGxpdmVzIGluIHRoZSBmaWxlIGJlaW5nIHJlYWQuXG4gKi9cbmZ1bmN0aW9uIGludG9TY29wZShcbiAgc2NvcGU6IEhkbFNjb3BlLFxuICBzZWdtZW50czogUGF0aFNlZ21lbnRbXSxcbiAgZnJvbTogbnVtYmVyLFxuICBkb2N1bWVudFVyaTogc3RyaW5nLFxuKTogV2Fsa1Jlc3VsdCB7XG4gIGNvbnN0IG1lbWJlciA9IHNlZ21lbnRzW2Zyb21dO1xuICBpZiAoIW1lbWJlcikgcmV0dXJuIFwibm8tcGF0aFwiO1xuXG4gIGNvbnN0IHN5bWJvbCA9IGZpbmRJbkVudHJ5KHNjb3BlLCBtZW1iZXIubmFtZSk7XG4gIGlmICghc3ltYm9sKSByZXR1cm4gbm90Rm91bmQobWVtYmVyLm5hbWUsIGZhbHNlKTtcblxuICBjb25zdCByZXNvbHZlZDogUmVzb2x2ZWRQYXRoID0ge1xuICAgIHN5bWJvbCxcbiAgICB1cmk6IGRvY3VtZW50VXJpLFxuICAgIHZpYUludGVyZmFjZTogZmFsc2UsXG4gICAgaW5zdGFuY2U6IHNjb3BlLm5hbWUsXG4gIH07XG5cbiAgLy8gTW9yZSBwYXRoIGxlZnQ6IGtlZXAgZGVzY2VuZGluZyBpbnRvIGEgYmxvY2sgbmVzdGVkIGluIHRoaXMgb25lLlxuICBjb25zdCBuZXh0ID0gc2VnbWVudHNbZnJvbSArIDFdO1xuICBpZiAoIW5leHQpIHJldHVybiByZXNvbHZlZDtcblxuICBjb25zdCBuZXN0ZWQgPSBjaGlsZE5hbWVkTG9jYWwoc2NvcGUsIG1lbWJlci5uYW1lKTtcbiAgcmV0dXJuIG5lc3RlZCA/IGludG9TY29wZShuZXN0ZWQsIHNlZ21lbnRzLCBmcm9tICsgMiwgZG9jdW1lbnRVcmkpIDogcmVzb2x2ZWQ7XG59XG5cbmZ1bmN0aW9uIGNoaWxkTmFtZWRMb2NhbChzY29wZTogSGRsU2NvcGUsIG5hbWU6IHN0cmluZyk6IEhkbFNjb3BlIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHNjb3BlLmNoaWxkcmVuLmZpbmQoKGNoaWxkKSA9PiBjaGlsZC5uYW1lID09PSBuYW1lICYmIGNoaWxkLmNhdGVnb3J5ID09PSBcImJsb2NrXCIpO1xufVxuXG4vKiogUmVzb2x2ZXMgYHNlZ21lbnRzW2Zyb20uLi5dYCBhZ2FpbnN0IG9uZSBkZXNpZ24gdW5pdC4gKi9cbmZ1bmN0aW9uIGludG9FbnRyeShcbiAgZW50cnk6IENhdGFsb2dFbnRyeSxcbiAgc2VnbWVudHM6IFBhdGhTZWdtZW50W10sXG4gIGZyb206IG51bWJlcixcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbiAgdmlhSW50ZXJmYWNlOiBib29sZWFuLFxuICBpbnN0YW5jZT86IHN0cmluZyxcbik6IFdhbGtSZXN1bHQge1xuICBjb25zdCBtZW1iZXIgPSBzZWdtZW50c1tmcm9tXTtcbiAgaWYgKCFtZW1iZXIpIHJldHVybiBcIm5vLXBhdGhcIjtcblxuICAvLyBBIHN1YmNsYXNzIHNlZXMgaXRzIGJhc2UncyBtZW1iZXJzLCBzbyBhIGNsYXNzIGxvb2t1cCBoYXMgdG8gZm9sbG93XG4gIC8vIGBleHRlbmRzYCByYXRoZXIgdGhhbiByZWFkaW5nIG9ubHkgd2hhdCB0aGUgY2xhc3MgaXRzZWxmIGRlY2xhcmVzLlxuICBjb25zdCBpbmhlcml0ZWQgPSBlbnRyeS5raW5kID09PSBcImNsYXNzXCIgPyBjYXRhbG9nLmV4dGVybmFsRGVjbGFyYXRpb25zKGVudHJ5Lm5hbWUpLmZpbmQoKHMpID0+IHMuc3ltYm9sLm5hbWUgPT09IG1lbWJlci5uYW1lKSA6IHVuZGVmaW5lZDtcbiAgY29uc3Qgc3ltYm9sID1cbiAgICBlbnRyeS5raW5kID09PSBcImNsYXNzXCJcbiAgICAgID8gaW5oZXJpdGVkPy5zeW1ib2xcbiAgICAgIDogZmluZEluRW50cnkoZW50cnksIG1lbWJlci5uYW1lKTtcbiAgaWYgKCFzeW1ib2wpIHtcbiAgICAvLyBUaGUgc2NvcGUgd2FzIHJlYWNoZWQ7IHRoZSBuYW1lIGluc2lkZSBpdCBpcyBzaW1wbHkgbm90IHRoZXJlLlxuICAgIHJldHVybiBub3RGb3VuZChtZW1iZXIubmFtZSwgdmlhSW50ZXJmYWNlKTtcbiAgfVxuXG4gIGNvbnN0IHJlc29sdmVkOiBSZXNvbHZlZFBhdGggPSB7IHN5bWJvbCwgdXJpOiBpbmhlcml0ZWQ/LnVyaSA/PyBlbnRyeS51cmksIHZpYUludGVyZmFjZSwgaW5zdGFuY2UgfTtcblxuICAvLyBTdGlsbCBtb3JlIHBhdGggbGVmdDoga2VlcCBkZXNjZW5kaW5nIHRocm91Z2ggbmVzdGVkIGluc3RhbmNlcy5cbiAgY29uc3QgbmV4dCA9IHNlZ21lbnRzW2Zyb20gKyAxXTtcbiAgaWYgKCFuZXh0KSByZXR1cm4gcmVzb2x2ZWQ7XG5cbiAgY29uc3QgbWVtYmVyVHlwZSA9IHN5bWJvbC5oYW5kbGVPZiA/IGNhdGFsb2cucmVzb2x2ZShzeW1ib2wuaGFuZGxlT2YpIDogaW50ZXJmYWNlT2ZUeXBlKHN5bWJvbC50eXBlVGV4dCwgY2F0YWxvZyk7XG4gIGlmIChtZW1iZXJUeXBlKSByZXR1cm4gaW50b0VudHJ5KG1lbWJlclR5cGUsIHNlZ21lbnRzLCBmcm9tICsgMSwgY2F0YWxvZywgbWVtYmVyVHlwZS5raW5kID09PSBcImludGVyZmFjZVwiLCBtZW1iZXIubmFtZSk7XG5cbiAgY29uc3QgbmVzdGVkID0gZW50cnkuaW5zdGFuY2VzLmZpbmQoKGkpID0+IGkuaW5zdGFuY2VOYW1lID09PSBtZW1iZXIubmFtZSk7XG4gIGlmIChuZXN0ZWQpIHtcbiAgICBjb25zdCBjaGlsZCA9IGNhdGFsb2cucmVzb2x2ZShuZXN0ZWQudHlwZU5hbWUpO1xuICAgIGlmIChjaGlsZCkgcmV0dXJuIGludG9FbnRyeShjaGlsZCwgc2VnbWVudHMsIGZyb20gKyAyLCBjYXRhbG9nLCB2aWFJbnRlcmZhY2UsIG1lbWJlci5uYW1lKTtcbiAgfVxuXG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxuLyoqIFdoYXQgYSBkZXNpZ24gdW5pdCBhbmQgYSBsb2NhbCBzY29wZSBoYXZlIGluIGNvbW1vbiBmb3IgbmFtZSBsb29rdXAuICovXG5pbnRlcmZhY2UgRGVjbGFyYXRpb25zIHtcbiAgcmVhZG9ubHkgcG9ydHM6IHJlYWRvbmx5IEhkbFN5bWJvbFtdO1xuICByZWFkb25seSBwYXJhbWV0ZXJzOiByZWFkb25seSBIZGxTeW1ib2xbXTtcbiAgcmVhZG9ubHkgc3ltYm9sczogcmVhZG9ubHkgSGRsU3ltYm9sW107XG59XG5cbi8qKiBFdmVyeSBkZWNsYXJhdGlvbiBhIHVuaXQgb2ZmZXJzOiBwb3J0cywgcGFyYW1ldGVycywgdGhlbiB0aGUgYm9keS4gKi9cbmZ1bmN0aW9uIGZpbmRJbkVudHJ5KGVudHJ5OiBEZWNsYXJhdGlvbnMsIG5hbWU6IHN0cmluZyk6IEhkbFN5bWJvbCB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiAoXG4gICAgZW50cnkucG9ydHMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKSA/P1xuICAgIGVudHJ5LnBhcmFtZXRlcnMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKSA/P1xuICAgIGVudHJ5LnN5bWJvbHMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKVxuICApO1xufVxuXG4vKiogQSBuYW1lIHZpc2libGUgZnJvbSBgb2Zmc2V0YCwgaG9ub3VyaW5nIHNoYWRvd2luZy4gKi9cbmZ1bmN0aW9uIHZpc2libGVJbkNoYWluKGNoYWluOiByZWFkb25seSBIZGxTY29wZVtdLCBuYW1lOiBzdHJpbmcpOiBIZGxTeW1ib2wgfCB1bmRlZmluZWQge1xuICBmb3IgKGxldCBpID0gY2hhaW4ubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICBjb25zdCBzY29wZSA9IGNoYWluW2ldITtcbiAgICBjb25zdCBmb3VuZCA9IGZpbmRJbkVudHJ5KHNjb3BlLCBuYW1lKTtcbiAgICBpZiAoZm91bmQpIHJldHVybiBmb3VuZDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuIiwgImltcG9ydCB7XG4gIENvbXBsZXRpb25JdGVtS2luZCxcbiAgU3ltYm9sS2luZCxcbiAgdHlwZSBNYXJrdXBDb250ZW50LFxufSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5cbmltcG9ydCB0eXBlIHsgSGRsU3ltYm9sIH0gZnJvbSBcIi4vbW9kZWwuanNcIjtcblxuLyoqIEh1bWFuLXJlYWRhYmxlIGxhYmVsIGZvciBhIGRlY2xhcmVkIGVudGl0eSwgZS5nLiBgYWx3YXlzX2ZmIGJsb2NrYC4gKi9cbmNvbnN0IENBVEVHT1JZX0xBQkVMOiBSZWNvcmQ8SGRsU3ltYm9sW1wiY2F0ZWdvcnlcIl0sIHN0cmluZz4gPSB7XG4gIHBvcnQ6IFwiUG9ydFwiLFxuICBuZXQ6IFwiTmV0XCIsXG4gIHZhcmlhYmxlOiBcIlZhcmlhYmxlXCIsXG4gIHBhcmFtZXRlcjogXCJQYXJhbWV0ZXJcIixcbiAgbG9jYWxwYXJhbTogXCJMb2NhbCBwYXJhbWV0ZXJcIixcbiAgdHlwZWRlZjogXCJUeXBlXCIsXG4gIGVudW06IFwiRW51bWVyYXRpb24gbGl0ZXJhbFwiLFxuICBnZW52YXI6IFwiR2VudmFyXCIsXG4gIHRhc2s6IFwiVGFza1wiLFxuICBmdW5jdGlvbjogXCJGdW5jdGlvblwiLFxuICBpbnN0YW5jZTogXCJJbnN0YW5jZVwiLFxuICBtb2R1bGU6IFwiTW9kdWxlXCIsXG4gIGludGVyZmFjZTogXCJJbnRlcmZhY2VcIixcbiAgcHJvZ3JhbTogXCJQcm9ncmFtXCIsXG4gIHBhY2thZ2U6IFwiUGFja2FnZVwiLFxuICBjbGFzczogXCJDbGFzc1wiLFxuICBoYW5kbGU6IFwiQ2xhc3MgaW5zdGFuY2VcIixcbiAgYmxvY2s6IFwiR2VuZXJhdGUgYmxvY2tcIixcbn07XG5cbi8qKiBNYXBzIGFuIEhETCBkZWNsYXJhdGlvbiBraW5kIHRvIHRoZSBMU1Agc3ltYm9sIGtpbmQgdXNlZCBpbiB0aGUgb3V0bGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1N5bWJvbEtpbmQoY2F0ZWdvcnk6IEhkbFN5bWJvbFtcImNhdGVnb3J5XCJdKTogU3ltYm9sS2luZCB7XG4gIHN3aXRjaCAoY2F0ZWdvcnkpIHtcbiAgICBjYXNlIFwicG9ydFwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuUHJvcGVydHk7XG4gICAgY2FzZSBcIm5ldFwiOlxuICAgIGNhc2UgXCJ2YXJpYWJsZVwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuVmFyaWFibGU7XG4gICAgY2FzZSBcInBhcmFtZXRlclwiOlxuICAgIGNhc2UgXCJsb2NhbHBhcmFtXCI6XG4gICAgY2FzZSBcImdlbnZhclwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuQ29uc3RhbnQ7XG4gICAgY2FzZSBcInR5cGVkZWZcIjpcbiAgICBjYXNlIFwiZW51bVwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuRW51bTtcbiAgICBjYXNlIFwidGFza1wiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuTWV0aG9kO1xuICAgIGNhc2UgXCJmdW5jdGlvblwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuRnVuY3Rpb247XG4gICAgY2FzZSBcImluc3RhbmNlXCI6XG4gICAgICByZXR1cm4gU3ltYm9sS2luZC5PYmplY3Q7XG4gICAgY2FzZSBcIm1vZHVsZVwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuTW9kdWxlO1xuICAgIGNhc2UgXCJpbnRlcmZhY2VcIjpcbiAgICAgIHJldHVybiBTeW1ib2xLaW5kLkludGVyZmFjZTtcbiAgICBjYXNlIFwicHJvZ3JhbVwiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuT2JqZWN0O1xuICAgIGNhc2UgXCJwYWNrYWdlXCI6XG4gICAgICByZXR1cm4gU3ltYm9sS2luZC5QYWNrYWdlO1xuICAgIGNhc2UgXCJjbGFzc1wiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuQ2xhc3M7XG4gICAgY2FzZSBcImhhbmRsZVwiOlxuICAgICAgLy8gQW4gb2JqZWN0IGhhbmRsZSByZWFkcyBhbmQgd3JpdGVzIHRocm91Z2ggaXRzIG1lbWJlcnMsIHNvIGl0IGlzXG4gICAgICAvLyBjbG9zZXIgdG8gYSByZWZlcmVuY2UgdGhhbiB0byBhIHZhbHVlLlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuT2JqZWN0O1xuICAgIGNhc2UgXCJibG9ja1wiOlxuICAgICAgcmV0dXJuIFN5bWJvbEtpbmQuTmFtZXNwYWNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gU3ltYm9sS2luZC5WYXJpYWJsZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Db21wbGV0aW9uS2luZChjYXRlZ29yeTogSGRsU3ltYm9sW1wiY2F0ZWdvcnlcIl0pOiBDb21wbGV0aW9uSXRlbUtpbmQge1xuICBzd2l0Y2ggKGNhdGVnb3J5KSB7XG4gICAgY2FzZSBcInBvcnRcIjpcbiAgICAgIHJldHVybiBDb21wbGV0aW9uSXRlbUtpbmQuRmllbGQ7XG4gICAgY2FzZSBcIm5ldFwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5WYWx1ZTtcbiAgICBjYXNlIFwidmFyaWFibGVcIjpcbiAgICAgIHJldHVybiBDb21wbGV0aW9uSXRlbUtpbmQuVmFyaWFibGU7XG4gICAgY2FzZSBcInBhcmFtZXRlclwiOlxuICAgIGNhc2UgXCJsb2NhbHBhcmFtXCI6XG4gICAgY2FzZSBcImdlbnZhclwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5Db25zdGFudDtcbiAgICBjYXNlIFwidHlwZWRlZlwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5DbGFzcztcbiAgICBjYXNlIFwiZW51bVwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5FbnVtTWVtYmVyO1xuICAgIGNhc2UgXCJ0YXNrXCI6XG4gICAgICByZXR1cm4gQ29tcGxldGlvbkl0ZW1LaW5kLkZ1bmN0aW9uO1xuICAgIGNhc2UgXCJmdW5jdGlvblwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5GdW5jdGlvbjtcbiAgICBjYXNlIFwicGFja2FnZVwiOlxuICAgICAgcmV0dXJuIENvbXBsZXRpb25JdGVtS2luZC5Nb2R1bGU7XG4gICAgY2FzZSBcImNsYXNzXCI6XG4gICAgICByZXR1cm4gQ29tcGxldGlvbkl0ZW1LaW5kLkNsYXNzO1xuICAgIGNhc2UgXCJoYW5kbGVcIjpcbiAgICAgIHJldHVybiBDb21wbGV0aW9uSXRlbUtpbmQuUmVmZXJlbmNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gQ29tcGxldGlvbkl0ZW1LaW5kLlZhbHVlO1xuICB9XG59XG5cbi8qKiBgMSBiaXRgIC8gYDggYml0c2AsIHdpdGhvdXQgdGhlIHRyYWlsaW5nIFwic1wiIG9uIHRoZSBzaW5ndWxhci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRCaXRzKGNvdW50OiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gYCR7Y291bnR9ICR7cGx1cmFsKGNvdW50LCBcImJpdFwiKX1gO1xufVxuXG4vKiogTmFpdmUgcGx1cmFsaXNhdGlvbiwgc3VmZmljaWVudCBmb3IgdGhlIG5vdW5zIHVzZWQgaW4gdGhlIFVJLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBsdXJhbChjb3VudDogbnVtYmVyLCB3b3JkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gY291bnQgPT09IDEgPyB3b3JkIDogYCR7d29yZH1zYDtcbn1cblxuLyoqXG4gKiBUaGUgb25lLWxpbmUgdHlwZSBhbm5vdGF0aW9uIHNob3duIG5leHQgdG8gYSBzeW1ib2wsIGUuZy5cbiAqIGBpbnB1dCBcdTAwQjcgbG9naWMgWzc6MF0gXHUwMEI3IDggYml0c2AuIEEgb25lLWJpdCBzaWduYWwgc3RhdGVzIGAxIGJpdGAgcmF0aGVyIHRoYW5cbiAqIGxlYXZpbmcgdGhlIHdpZHRoIG91dDsgdGhlIHdpZHRoIGlzIG9taXR0ZWQgb25seSB3aGVuIGl0IGNvdWxkIG5vdCBiZVxuICogZGV0ZXJtaW5lZCwgd2hpY2ggaXMgbW9yZSBob25lc3QgdGhhbiBzaG93aW5nIGEgZ3Vlc3NlZCB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlU3ltYm9sKHN5bWJvbDogSGRsU3ltYm9sLCBvcHRpb25zOiB7IHNob3dUeXBlOiBib29sZWFuOyBzaG93V2lkdGg6IGJvb2xlYW4gfSk6IHN0cmluZyB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGlmIChzeW1ib2wuZGlyZWN0aW9uKSBwYXJ0cy5wdXNoKHN5bWJvbC5kaXJlY3Rpb24pO1xuICAvLyBBIHBvcnQgd3JpdHRlbiB3aXRob3V0IGFuIGV4cGxpY2l0IHR5cGUgaW5oZXJpdHMgaXRzIGRpcmVjdGlvbiwgc29cbiAgLy8gcHJpbnRpbmcgaXQgdHdpY2Ugd291bGQganVzdCByZWFkIGBpbnB1dCBcdTAwQjcgaW5wdXRgLlxuICBpZiAob3B0aW9ucy5zaG93VHlwZSAmJiBzeW1ib2wudHlwZVRleHQgJiYgc3ltYm9sLnR5cGVUZXh0ICE9PSBzeW1ib2wuZGlyZWN0aW9uKSB7XG4gICAgcGFydHMucHVzaChzeW1ib2wudHlwZVRleHQpO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMuc2hvd1dpZHRoKSB7XG4gICAgY29uc3QgZGltczogc3RyaW5nW10gPSBbXTtcbiAgICBpZiAoc3ltYm9sLnBhY2tlZFdpZHRoICE9PSB1bmRlZmluZWQpIGRpbXMucHVzaChmb3JtYXRCaXRzKHN5bWJvbC5wYWNrZWRXaWR0aCkpO1xuICAgIGlmIChzeW1ib2wudW5wYWNrZWREaW1zLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGNvdW50ID0gc3ltYm9sLnVucGFja2VkQ291bnQ7XG4gICAgICBkaW1zLnB1c2goXG4gICAgICAgIGNvdW50ICE9PSB1bmRlZmluZWRcbiAgICAgICAgICA/IGAke2NvdW50fSAke3BsdXJhbChjb3VudCwgXCJlbGVtZW50XCIpfSAke3N5bWJvbC51bnBhY2tlZERpbXMuam9pbihcIiBcIil9YFxuICAgICAgICAgIDogYGFycmF5ICR7c3ltYm9sLnVucGFja2VkRGltcy5qb2luKFwiIFwiKX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgcGFydHMucHVzaCguLi5kaW1zKTtcbiAgfVxuXG4gIGlmIChzeW1ib2wuY2F0ZWdvcnkgPT09IFwicGFyYW1ldGVyXCIgfHwgc3ltYm9sLmNhdGVnb3J5ID09PSBcImxvY2FscGFyYW1cIikge1xuICAgIHBhcnRzLnB1c2goc3ltYm9sLnJlc29sdmVkVmFsdWUgIT09IHVuZGVmaW5lZCA/IGBkZWZhdWx0ICR7c3ltYm9sLnJlc29sdmVkVmFsdWV9YCA6IFwibm8gZGVmYXVsdFwiKTtcbiAgfVxuXG4gIHJldHVybiBwYXJ0cy5qb2luKFwiIFx1MDBCNyBcIik7XG59XG5cbi8qKiBUaGUgZnVsbCBkZWNsYXJhdGlvbiBhcyBpdCB3b3VsZCBiZSB3cml0dGVuLCB1c2VkIGluIGhvdmVyIGFuZCBkb2NzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlY2xhcmF0aW9uVGV4dChzeW1ib2w6IEhkbFN5bWJvbCk6IHN0cmluZyB7XG4gIGlmIChzeW1ib2wuYXJndW1lbnRzKSByZXR1cm4gY2FsbGFibGVMYWJlbChzeW1ib2wpO1xuICBjb25zdCBkaXJlY3Rpb24gPSBzeW1ib2wuaXNQb3J0ICYmIHN5bWJvbC5kaXJlY3Rpb24gPyBgJHtzeW1ib2wuZGlyZWN0aW9ufSBgIDogXCJcIjtcbiAgY29uc3QgcGFja2VkID0gc3ltYm9sLnBhY2tlZFJhbmdlVGV4dCA/IGAgWyR7c3ltYm9sLnBhY2tlZFJhbmdlVGV4dH1dYCA6IFwiXCI7XG4gIGNvbnN0IHVucGFja2VkID0gc3ltYm9sLnVucGFja2VkRGltcy5qb2luKFwiXCIpO1xuICBjb25zdCBpbml0ID1cbiAgICBzeW1ib2wuaW5pdGlhbGl6ZXJUZXh0ICYmIHN5bWJvbC5jYXRlZ29yeSAhPT0gXCJ0eXBlZGVmXCIgPyBgID0gJHtzeW1ib2wuaW5pdGlhbGl6ZXJUZXh0fWAgOiBcIlwiO1xuXG4gIHJldHVybiBgJHtkaXJlY3Rpb259JHtzeW1ib2wudHlwZVRleHR9JHtwYWNrZWR9ICR7c3ltYm9sLm5hbWV9JHt1bnBhY2tlZH0ke2luaXR9YC5yZXBsYWNlKC9cXHMrL2csIFwiIFwiKS50cmltKCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcmd1bWVudExhYmVsKGFyZzogSGRsU3ltYm9sKTogc3RyaW5nIHtcbiAgcmV0dXJuIFthcmcuZGlyZWN0aW9uID8/IFwiaW5wdXRcIiwgYXJnLnR5cGVUZXh0LCBhcmcucGFja2VkUmFuZ2VUZXh0ID8gYFske2FyZy5wYWNrZWRSYW5nZVRleHR9XWAgOiBcIlwiLCBhcmcubmFtZSArIGFyZy51bnBhY2tlZERpbXMuam9pbihcIlwiKV1cbiAgICAuZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCIgXCIpICsgKGFyZy5pbml0aWFsaXplclRleHQgIT09IHVuZGVmaW5lZCA/IGAgPSAke2FyZy5pbml0aWFsaXplclRleHR9YCA6IFwiXCIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2FsbGFibGVMYWJlbChzeW1ib2w6IEhkbFN5bWJvbCk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtzeW1ib2wuY2F0ZWdvcnl9ICR7c3ltYm9sLmNhdGVnb3J5ID09PSBcImZ1bmN0aW9uXCIgPyBzeW1ib2wudHlwZVRleHQgKyBcIiBcIiA6IFwiXCJ9JHtzeW1ib2wubmFtZX0oJHsoc3ltYm9sLmFyZ3VtZW50cyA/PyBbXSkubWFwKGFyZ3VtZW50TGFiZWwpLmpvaW4oXCIsIFwiKX0pYDtcbn1cblxuLyoqIFJpY2ggaG92ZXIgLyBjb21wbGV0aW9uIGRvY3VtZW50YXRpb24gZm9yIGEgZGVjbGFyYXRpb24uICovXG5leHBvcnQgZnVuY3Rpb24gZG9jdW1lbnRhdGlvbkZvcihcbiAgc3ltYm9sOiBIZGxTeW1ib2wsXG4gIG9wdGlvbnM6IHsgc2hvd1R5cGU6IGJvb2xlYW47IHNob3dXaWR0aDogYm9vbGVhbjsgdXNhZ2VDb3VudD86IG51bWJlciB9LFxuKTogTWFya3VwQ29udGVudCB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICBsaW5lcy5wdXNoKFwiYGBgc3lzdGVtdmVyaWxvZ1wiKTtcbiAgbGluZXMucHVzaChkZWNsYXJhdGlvblRleHQoc3ltYm9sKSk7XG4gIGxpbmVzLnB1c2goXCJgYGBcIik7XG5cbiAgY29uc3QgZGV0YWlsID0gZGVzY3JpYmVTeW1ib2woc3ltYm9sLCBvcHRpb25zKTtcbiAgaWYgKGRldGFpbCkgbGluZXMucHVzaChgKioke2RldGFpbH0qKmApO1xuXG4gIGlmIChzeW1ib2wucGFja2VkV2lkdGggIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IGxhYmVsID0gYCR7c3ltYm9sLm5hbWV9IGlzICR7Zm9ybWF0Qml0cyhzeW1ib2wucGFja2VkV2lkdGgpfSB3aWRlYDtcbiAgICBjb25zdCBzcHJlYWQgPVxuICAgICAgc3ltYm9sLnVucGFja2VkQ291bnQgIT09IHVuZGVmaW5lZCAmJiBzeW1ib2wudW5wYWNrZWRDb3VudCA+IDFcbiAgICAgICAgPyBgIGFjcm9zcyAke3N5bWJvbC51bnBhY2tlZENvdW50fSAke3BsdXJhbChzeW1ib2wudW5wYWNrZWRDb3VudCwgXCJlbGVtZW50XCIpfWBcbiAgICAgICAgOiBcIlwiO1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChgXFxgJHtsYWJlbH1cXGAke3NwcmVhZH0uYCk7XG4gIH1cblxuICBpZiAob3B0aW9ucy51c2FnZUNvdW50ICE9PSB1bmRlZmluZWQgJiYgb3B0aW9ucy51c2FnZUNvdW50ID4gMCkge1xuICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgbGluZXMucHVzaChgUmVmZXJlbmNlZCAke29wdGlvbnMudXNhZ2VDb3VudH0gJHtwbHVyYWwob3B0aW9ucy51c2FnZUNvdW50LCBcInRpbWVcIil9IGluIHRoaXMgZmlsZS5gKTtcbiAgfVxuXG4gIGlmIChzeW1ib2wuZG9jKSB7XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgICBsaW5lcy5wdXNoKHN5bWJvbC5kb2MpO1xuICB9XG5cbiAgcmV0dXJuIHsga2luZDogXCJtYXJrZG93blwiLCB2YWx1ZTogbGluZXMuam9pbihcIlxcblwiKSB9O1xufVxuXG5leHBvcnQgeyBDQVRFR09SWV9MQUJFTCB9O1xuIiwgImltcG9ydCB0eXBlIHsgSG92ZXIsIE1hcmt1cENvbnRlbnQgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5pbXBvcnQgdHlwZSB7IFRleHREb2N1bWVudCB9IGZyb20gXCJ2c2NvZGUtbGFuZ3VhZ2VzZXJ2ZXItdGV4dGRvY3VtZW50XCI7XG5cbmltcG9ydCB7IHZpc2libGVTeW1ib2xzIH0gZnJvbSBcIi4uL21vZGVsLmpzXCI7XG5pbXBvcnQgdHlwZSB7IENhdGFsb2cgfSBmcm9tIFwiLi4vY2F0YWxvZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBBbmFseXNpcyB9IGZyb20gXCIuLi9tb2RlbC5qc1wiO1xuaW1wb3J0IHsgaWRlbnRpZmllckF0IH0gZnJvbSBcIi4uL2xvY2F0ZS5qc1wiO1xuaW1wb3J0IHsgZGVjbGFyYXRpb25UZXh0LCBkZXNjcmliZVN5bWJvbCwgZG9jdW1lbnRhdGlvbkZvciB9IGZyb20gXCIuLi9zeW1ib2xGb3JtYXR0aW5nLmpzXCI7XG5pbXBvcnQgeyBwYXRoT2YsIHJlc29sdmVQYXRoIH0gZnJvbSBcIi4uL2hpZXJhcmNoeS5qc1wiO1xuaW1wb3J0IHsgaW1wb3J0ZWRNZW1iZXIsIGluY2x1ZGVkRGVjbGFyYXRpb24gfSBmcm9tIFwiLi4vaW1wb3J0cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBJbmNsdWRlUmVzb2x2ZXIgfSBmcm9tIFwiLi4vaW5jbHVkZXMuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBIb3ZlclNldHRpbmdzIHtcbiAgc2hvd1dpZHRoOiBib29sZWFuO1xuICBzaG93VHlwZTogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3ZpZGVIb3ZlcihcbiAgZG9jdW1lbnQ6IFRleHREb2N1bWVudCxcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBvZmZzZXQ6IG51bWJlcixcbiAgc2V0dGluZ3M6IEhvdmVyU2V0dGluZ3MsXG4gIGluY2x1ZGVzPzogSW5jbHVkZVJlc29sdmVyLFxuKTogSG92ZXIgfCBudWxsIHtcbiAgY29uc3Qgbm9kZSA9IGlkZW50aWZpZXJBdChhbmFseXNpcywgb2Zmc2V0KTtcbiAgaWYgKCFub2RlKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBuYW1lID0gbm9kZS50ZXh0O1xuICBjb25zdCBwYXRoID0gcGF0aE9mKG5vZGUpO1xuXG4gIC8vIEEgcmVmZXJlbmNlIHRvIGEgZGVjbGFyYXRpb24gaW4gdGhpcyBmaWxlLlxuICBjb25zdCBzeW1ib2xzID0gdmlzaWJsZVN5bWJvbHMoYW5hbHlzaXMsIG9mZnNldCk7XG4gIGNvbnN0IHN5bWJvbCA9IHN5bWJvbHMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKTtcblxuICBpZiAoc3ltYm9sKSB7XG4gICAgY29uc3QgdXNlcyA9IGFuYWx5c2lzLmlkZW50aWZpZXJzLmdldChuYW1lKT8ubGVuZ3RoID8/IDA7XG4gICAgY29uc3QgaXNEZWNsYXJhdGlvbiA9IHN5bWJvbC5zZWxlY3Rpb25SYW5nZS5zdGFydC5saW5lID09PSBub2RlLnN0YXJ0UG9zaXRpb24ucm93ICYmXG4gICAgICBzeW1ib2wuc2VsZWN0aW9uUmFuZ2Uuc3RhcnQuY2hhcmFjdGVyID09PSBub2RlLnN0YXJ0UG9zaXRpb24uY29sdW1uO1xuXG4gICAgY29uc3QgZG9jOiBNYXJrdXBDb250ZW50ID0gZG9jdW1lbnRhdGlvbkZvcihzeW1ib2wsIHsgLi4uc2V0dGluZ3MsIHVzYWdlQ291bnQ6IGlzRGVjbGFyYXRpb24gPyB1c2VzIDogdXNlcyArIDEgfSk7XG4gICAgY29uc3QgbGluZXMgPSBbZG9jLnZhbHVlXTtcblxuICAgIGlmICghaXNEZWNsYXJhdGlvbikge1xuICAgICAgbGluZXMucHVzaChcIlwiLCBgRGVjbGFyZWQgaW4gXFxgJHtzeW1ib2wuY2F0ZWdvcnl9XFxgIGF0IGxpbmUgJHtzeW1ib2wuc2VsZWN0aW9uUmFuZ2Uuc3RhcnQubGluZSArIDF9LmApO1xuICAgIH1cblxuICAgIHJldHVybiB7IGNvbnRlbnRzOiB7IGtpbmQ6IFwibWFya2Rvd25cIiwgdmFsdWU6IGxpbmVzLmpvaW4oXCJcXG5cIikgfSB9O1xuICB9XG5cbiAgLy8gYERVVF9pZi5hZGNfaW5gIG9yIGBEVVQudV9zdWIuc2lnYDogZGVjbGFyZWQgaW4gYW5vdGhlciBzY29wZSwgcG9zc2libHkgaW5cbiAgLy8gYW5vdGhlciBmaWxlLiBMb2NhbCBsb29rdXAgY2Fubm90IHNlZSBpdDsgdGhlIHBhdGggd2FsayBjYW4uXG4gIGlmIChwYXRoKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUGF0aChub2RlLCBhbmFseXNpcywgY2F0YWxvZywgZG9jdW1lbnQudXJpKTtcbiAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgIGNvbnN0IGRvYyA9IGRvY3VtZW50YXRpb25Gb3IocmVzb2x2ZWQuc3ltYm9sLCB7IC4uLnNldHRpbmdzLCB1c2FnZUNvdW50OiAxIH0pO1xuICAgICAgY29uc3QgbGluZXMgPSBbZG9jLnZhbHVlLCBcIlwiXTtcblxuICAgICAgaWYgKHJlc29sdmVkLnZpYUludGVyZmFjZSkge1xuICAgICAgICBsaW5lcy5wdXNoKGBNZW1iZXIgb2YgaW50ZXJmYWNlIGluc3RhbmNlIFxcYCR7cmVzb2x2ZWQuaW5zdGFuY2V9XFxgLmApO1xuICAgICAgfSBlbHNlIGlmIChyZXNvbHZlZC5pbnN0YW5jZSkge1xuICAgICAgICBsaW5lcy5wdXNoKGBSZWFjaGVkIHRocm91Z2ggaW5zdGFuY2UgXFxgJHtyZXNvbHZlZC5pbnN0YW5jZX1cXGAuYCk7XG4gICAgICB9XG5cbiAgICAgIGxpbmVzLnB1c2goXG4gICAgICAgIGBEZWNsYXJlZCBpbiBcXGAke3Nob3J0VXJpKHJlc29sdmVkLnVyaSl9XFxgIGF0IGxpbmUgJHtyZXNvbHZlZC5zeW1ib2wuc2VsZWN0aW9uUmFuZ2Uuc3RhcnQubGluZSArIDF9LmAsXG4gICAgICApO1xuXG4gICAgICByZXR1cm4geyBjb250ZW50czogeyBraW5kOiBcIm1hcmtkb3duXCIsIHZhbHVlOiBsaW5lcy5qb2luKFwiXFxuXCIpIH0gfTtcbiAgICB9XG4gIH1cblxuICAvLyBBIG5hbWUgYnJvdWdodCBpbiBieSBgaW1wb3J0IHBrZzo6KjtgLiBJdCBpcyBub3QgZGVjbGFyZWQgaGVyZSBhbmQgbm90IG9uXG4gIC8vIHRoZSBkb3R0ZWQgcGF0aCBlaXRoZXIsIHNvIHRoZSBpbXBvcnQgaGFzIHRvIGJlIGNvbnN1bHRlZCBleHBsaWNpdGx5LlxuICBjb25zdCBpbXBvcnRlZCA9IGltcG9ydGVkTWVtYmVyKGFuYWx5c2lzLCBjYXRhbG9nLCBvZmZzZXQsIG5hbWUpO1xuICBpZiAoaW1wb3J0ZWQpIHtcbiAgICBjb25zdCBkb2MgPSBkb2N1bWVudGF0aW9uRm9yKGltcG9ydGVkLnN5bWJvbCwgeyAuLi5zZXR0aW5ncywgdXNhZ2VDb3VudDogMSB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgY29udGVudHM6IHtcbiAgICAgICAga2luZDogXCJtYXJrZG93blwiLFxuICAgICAgICB2YWx1ZTogW1xuICAgICAgICAgIGRvYy52YWx1ZSxcbiAgICAgICAgICBcIlwiLFxuICAgICAgICAgIGBJbXBvcnRlZCBmcm9tIFxcYCR7aW1wb3J0ZWQucGFja2FnZU5hbWV9XFxgIGluIFxcYCR7c2hvcnRVcmkoaW1wb3J0ZWQudXJpKX1cXGBgICtcbiAgICAgICAgICAgIGAgYXQgbGluZSAke2ltcG9ydGVkLnN5bWJvbC5zZWxlY3Rpb25SYW5nZS5zdGFydC5saW5lICsgMX0uYCxcbiAgICAgICAgXS5qb2luKFwiXFxuXCIpLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLy8gQSB0eXBlIGRlY2xhcmVkIGluIGEgaGVhZGVyIHRoaXMgZmlsZSBgYCBgaW5jbHVkZSBgYHMuIFdyaXR0ZW4gYWJvdmUgdGhlXG4gIC8vIGhlYWRlcidzIGZpcnN0IG1vZHVsZSwgc28gbm8gc2NvcGUgb3ducyBpdCBhbmQgb25seSB0aGUgaW5jbHVkZSBzYXlzIHdoZXJlXG4gIC8vIGl0IGxpdmVzLlxuICBpZiAoaW5jbHVkZXMpIHtcbiAgICBjb25zdCBkZWNsYXJlZCA9IGluY2x1ZGVkRGVjbGFyYXRpb24oZG9jdW1lbnQudXJpLCBjYXRhbG9nLCBpbmNsdWRlcywgbmFtZSk7XG4gICAgaWYgKGRlY2xhcmVkKSB7XG4gICAgICBjb25zdCBkb2MgPSBkb2N1bWVudGF0aW9uRm9yKGRlY2xhcmVkLnN5bWJvbCwgeyAuLi5zZXR0aW5ncywgdXNhZ2VDb3VudDogMSB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnRzOiB7XG4gICAgICAgICAga2luZDogXCJtYXJrZG93blwiLFxuICAgICAgICAgIHZhbHVlOiBbXG4gICAgICAgICAgICBkb2MudmFsdWUsXG4gICAgICAgICAgICBcIlwiLFxuICAgICAgICAgICAgYERlY2xhcmVkIGluIFxcYCR7ZGVjbGFyZWQuaGVhZGVyfVxcYCBhdCBsaW5lIGAgK1xuICAgICAgICAgICAgICBgJHtkZWNsYXJlZC5zeW1ib2wuc2VsZWN0aW9uUmFuZ2Uuc3RhcnQubGluZSArIDF9LCBpbmNsdWRlZCBieSB0aGlzIGZpbGUuYCxcbiAgICAgICAgICBdLmpvaW4oXCJcXG5cIiksXG4gICAgICAgIH0sXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIEEgbW9kdWxlIC8gaW50ZXJmYWNlIC8gcGFja2FnZSByZWZlcmVuY2UuXG4gIGNvbnN0IHVuaXQgPSBjYXRhbG9nLmdldChuYW1lKTtcbiAgaWYgKHVuaXQpIHtcbiAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgICBsaW5lcy5wdXNoKFwiYGBgc3lzdGVtdmVyaWxvZ1wiKTtcbiAgICBsaW5lcy5wdXNoKGhlYWRlclN1bW1hcnkodW5pdC5uYW1lLCB1bml0LmtpbmQsIHVuaXQucG9ydHMsIHVuaXQucGFyYW1ldGVycykpO1xuICAgIGxpbmVzLnB1c2goXCJgYGBcIik7XG4gICAgbGluZXMucHVzaChcIlwiKTtcbiAgICBsaW5lcy5wdXNoKGAqKiR7dW5pdC5raW5kfSoqIGRlZmluZWQgaW4gXFxgJHtzaG9ydFVyaSh1bml0LnVyaSl9XFxgIGF0IGxpbmUgJHt1bml0LnNlbGVjdGlvblJhbmdlLnN0YXJ0LmxpbmUgKyAxfS5gKTtcblxuICAgIGlmICh1bml0LnBvcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxpbmVzLnB1c2goXCJcIik7XG4gICAgICBsaW5lcy5wdXNoKFwifCBQb3J0IHwgVHlwZSB8IEJpdHMgfFwiKTtcbiAgICAgIGxpbmVzLnB1c2goXCJ8IC0tLSB8IC0tLSB8IC0tLSB8XCIpO1xuICAgICAgZm9yIChjb25zdCBwb3J0IG9mIHVuaXQucG9ydHMpIHtcbiAgICAgICAgbGluZXMucHVzaChcbiAgICAgICAgICBgfCBcXGAke3BvcnQubmFtZX1cXGAgfCAke3BvcnQuZGlyZWN0aW9uID8/IFwiXCJ9ICR7ZXNjYXBlUGlwZXMocG9ydC50eXBlVGV4dCl9JHtwb3J0LnBhY2tlZFJhbmdlVGV4dCA/IGAgWyR7cG9ydC5wYWNrZWRSYW5nZVRleHR9XWAgOiBcIlwifSB8ICR7cG9ydC5wYWNrZWRXaWR0aCA/PyBcIj9cIn0gfGAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHVuaXQucGFyYW1ldGVycy5sZW5ndGggPiAwKSB7XG4gICAgICBsaW5lcy5wdXNoKFwiXCIpO1xuICAgICAgbGluZXMucHVzaChcIioqUGFyYW1ldGVycyoqXCIpO1xuICAgICAgZm9yIChjb25zdCBwYXJhbSBvZiB1bml0LnBhcmFtZXRlcnMpIHtcbiAgICAgICAgY29uc3QgZGV0YWlsID0gZGVzY3JpYmVTeW1ib2wocGFyYW0sIHNldHRpbmdzKTtcbiAgICAgICAgbGluZXMucHVzaChgLSBcXGAke2RlY2xhcmF0aW9uVGV4dChwYXJhbSl9XFxgJHtkZXRhaWwgPyBgIFx1MjAxNCAke2RldGFpbH1gIDogXCJcIn1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4geyBjb250ZW50czogeyBraW5kOiBcIm1hcmtkb3duXCIsIHZhbHVlOiBsaW5lcy5qb2luKFwiXFxuXCIpIH0gfTtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBoZWFkZXJTdW1tYXJ5KFxuICBuYW1lOiBzdHJpbmcsXG4gIGtpbmQ6IHN0cmluZyxcbiAgcG9ydHM6IHsgbmFtZTogc3RyaW5nIH1bXSxcbiAgcGFyYW1ldGVyczogeyBuYW1lOiBzdHJpbmcgfVtdLFxuKTogc3RyaW5nIHtcbiAgY29uc3QgcGFyYW1MaXN0ID0gcGFyYW1ldGVycy5sZW5ndGggPiAwID8gYCMoJHtwYXJhbWV0ZXJzLm1hcCgocCkgPT4gcC5uYW1lKS5qb2luKFwiLCBcIil9KWAgOiBcIlwiO1xuICBjb25zdCBwb3J0TGlzdCA9IHBvcnRzLmxlbmd0aCA+IDAgPyBgICgke3BvcnRzLm1hcCgocCkgPT4gcC5uYW1lKS5qb2luKFwiLCBcIil9KWAgOiBcIiAoKVwiO1xuICByZXR1cm4gYCR7a2luZH0gJHtuYW1lfSR7cGFyYW1MaXN0fSR7cG9ydExpc3R9O2A7XG59XG5cbmZ1bmN0aW9uIGVzY2FwZVBpcGVzKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1xcfC9nLCBcIlxcXFx8XCIpO1xufVxuXG5mdW5jdGlvbiBzaG9ydFVyaSh1cmk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHBhcnRzID0gdXJpLnNwbGl0KC9bXFxcXC9dLyk7XG4gIHJldHVybiBwYXJ0cy5zbGljZSgtMikuam9pbihcIi9cIik7XG59XG4iLCAiaW1wb3J0IHtcbiAgQ29tcGxldGlvbkl0ZW1LaW5kLFxuICBJbnNlcnRUZXh0Rm9ybWF0LFxuICB0eXBlIENvbXBsZXRpb25JdGVtLFxuICB0eXBlIENvbXBsZXRpb25MaXN0LFxuICB0eXBlIFRleHREb2N1bWVudCxcbn0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10eXBlc1wiO1xuaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG5pbXBvcnQgdHlwZSB7IEFuYWx5c2lzLCBIZGxTY29wZSwgSGRsU3ltYm9sIH0gZnJvbSBcIi4uL21vZGVsLmpzXCI7XG5pbXBvcnQgeyBzY29wZUNoYWluLCB2aXNpYmxlU3ltYm9scyB9IGZyb20gXCIuLi9tb2RlbC5qc1wiO1xuaW1wb3J0IHsgbm9kZUF0IH0gZnJvbSBcIi4uL2xvY2F0ZS5qc1wiO1xuaW1wb3J0IHsgaW50ZXJmYWNlT2ZUeXBlLCByZXNvbHZlTmFtZWRCbG9jayB9IGZyb20gXCIuLi9oaWVyYXJjaHkuanNcIjtcbmltcG9ydCB0eXBlIHsgQ2F0YWxvZyB9IGZyb20gXCIuLi9jYXRhbG9nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IERvY3VtZW50TWFuYWdlciB9IGZyb20gXCIuLi9kb2N1bWVudE1hbmFnZXIuanNcIjtcbmltcG9ydCB7IGltcG9ydGVkTWVtYmVycywgaW5jbHVkZWREZWNsYXJhdGlvbnMgfSBmcm9tIFwiLi4vaW1wb3J0cy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBJbmNsdWRlUmVzb2x2ZXIgfSBmcm9tIFwiLi4vaW5jbHVkZXMuanNcIjtcbmltcG9ydCB7IHN0YXRpY0NvbXBsZXRpb25JdGVtcyB9IGZyb20gXCIuLi9jb21wbGV0aW9uRGF0YS5qc1wiO1xuaW1wb3J0IHsgY2FsbGFibGVMYWJlbCwgY2FsbEF0LCByZXNvbHZlQ2FsbGFibGUgfSBmcm9tIFwiLi4vY2FsbGFibGVzLmpzXCI7XG5pbXBvcnQge1xuICBDQVRFR09SWV9MQUJFTCxcbiAgZGVzY3JpYmVTeW1ib2wsXG4gIGRvY3VtZW50YXRpb25Gb3IsXG4gIHRvQ29tcGxldGlvbktpbmQsXG59IGZyb20gXCIuLi9zeW1ib2xGb3JtYXR0aW5nLmpzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGxldGlvblNldHRpbmdzIHtcbiAgc2hvd1dpZHRoOiBib29sZWFuO1xuICBzaG93VHlwZTogYm9vbGVhbjtcbiAgc25pcHBldHM6IGJvb2xlYW47XG4gIHN5c3RlbUZ1bmN0aW9uczogYm9vbGVhbjtcbiAgaW5jbHVkZVBhcmFtZXRlcnM6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGxldGlvbkNvbnRleHQge1xuICBhbmFseXNpczogQW5hbHlzaXM7XG4gIGRvY3VtZW50OiBUZXh0RG9jdW1lbnQ7XG4gIG9mZnNldDogbnVtYmVyO1xuICAvKiogVGV4dCB0eXBlZCBhdCB0aGUgY3Vyc29yLCB1c2VkIGZvciBmdXp6eSBmaWx0ZXJpbmcgYW5kIHJhbmdlIG1hdGhzLiAqL1xuICBwcmVmaXg6IHN0cmluZztcbiAgLyoqIFdvcmQgY2hhcmFjdGVycyBpbW1lZGlhdGVseSBiZWZvcmUgdGhlIGN1cnNvci4gKi9cbiAgcmFuZ2VTdGFydDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcGxldGlvbkNvbnRleHQoZG9jdW1lbnQ6IFRleHREb2N1bWVudCwgYW5hbHlzaXM6IEFuYWx5c2lzLCBvZmZzZXQ6IG51bWJlcik6IENvbXBsZXRpb25Db250ZXh0IHtcbiAgY29uc3QgdGV4dCA9IGRvY3VtZW50LmdldFRleHQoKTtcbiAgbGV0IHN0YXJ0ID0gb2Zmc2V0O1xuICB3aGlsZSAoc3RhcnQgPiAwICYmIGlzV29yZENoYXIodGV4dFtzdGFydCAtIDFdISkpIHN0YXJ0LS07XG4gIHJldHVybiB7IGFuYWx5c2lzLCBkb2N1bWVudCwgb2Zmc2V0LCBwcmVmaXg6IHRleHQuc2xpY2Uoc3RhcnQsIG9mZnNldCksIHJhbmdlU3RhcnQ6IHN0YXJ0IH07XG59XG5cbmZ1bmN0aW9uIGlzV29yZENoYXIoY2g6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1tBLVphLXowLTlfJF0vLnRlc3QoY2gpO1xufVxuXG4vKipcbiAqIFByb2R1Y2VzIHRoZSBjb21wbGV0aW9uIGxpc3QgZm9yIGEgcG9zaXRpb24uXG4gKlxuICogQ29udGV4dC1zZW5zaXRpdmUgYmVoYXZpb3VyOlxuICogIC0gaW5zaWRlIGEgYC5wb3J0KGAgY29ubmVjdGlvbiAgLT4gb25seSB0aGF0IGluc3RhbmNlJ3MgcG9ydHNcbiAqICAtIGluc2lkZSBhIGAuUEFSQU0oYCBvdmVycmlkZSAgLT4gb25seSB0aGF0IGluc3RhbmNlJ3MgcGFyYW1ldGVyc1xuICogIC0gYWZ0ZXIgYGlmYy5gIG9mIGFuIGludGVyZmFjZSAtPiB0aGF0IGludGVyZmFjZSdzIG1lbWJlcnNcbiAqICAtIGF0IGFuIGluc3RhbnRpYXRpb24gdHlwZSAgICAtPiBvbmx5IGRlc2lnbiB1bml0cyBpbiB0aGUgd29ya3NwYWNlXG4gKiAgLSBvdGhlcndpc2UgICAgICAgICAgICAgICAgICAgLT4gdmlzaWJsZSBzeW1ib2xzICsga2V5d29yZHMgKyBzbmlwcGV0c1xuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvdmlkZUNvbXBsZXRpb24oXG4gIGNvbnRleHQ6IENvbXBsZXRpb25Db250ZXh0LFxuICBkb2N1bWVudHM6IERvY3VtZW50TWFuYWdlcixcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbiAgc2V0dGluZ3M6IENvbXBsZXRpb25TZXR0aW5ncyxcbiAgaW5jbHVkZXM/OiBJbmNsdWRlUmVzb2x2ZXIsXG4pOiBDb21wbGV0aW9uTGlzdCB7XG4gIGNvbnN0IGl0ZW1zOiBDb21wbGV0aW9uSXRlbVtdID0gW107XG4gIGNvbnN0IGNhbGwgPSBjYWxsQXQoY29udGV4dC5kb2N1bWVudC5nZXRUZXh0KCksIGNvbnRleHQub2Zmc2V0KTtcbiAgaWYgKGNhbGwgJiYgLyg/OlxcKHwsKVxccypcXC5cXHcqJC8udGVzdChjb250ZXh0LmRvY3VtZW50LmdldFRleHQoKS5zbGljZSgwLCBjb250ZXh0Lm9mZnNldCkpKSB7XG4gICAgY29uc3Qgcm91dGluZSA9IHJlc29sdmVDYWxsYWJsZShjYWxsLm5hbWUsIGNvbnRleHQuYW5hbHlzaXMsIGNhdGFsb2csIGNvbnRleHQub2Zmc2V0LCBjb250ZXh0LmRvY3VtZW50LnVyaSwgaW5jbHVkZXMpO1xuICAgIGlmIChyb3V0aW5lKSByZXR1cm4geyBpc0luY29tcGxldGU6IGZhbHNlLCBpdGVtczogKHJvdXRpbmUuYXJndW1lbnRzID8/IFtdKS5tYXAoKGFyZykgPT4gKHtcbiAgICAgIGxhYmVsOiBhcmcubmFtZSwga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlByb3BlcnR5LFxuICAgICAgZGV0YWlsOiBgJHthcmcuZGlyZWN0aW9uID8/IFwiaW5wdXRcIn0gJHthcmcudHlwZVRleHR9YCxcbiAgICAgIGluc2VydFRleHQ6IGAke2FyZy5uYW1lfShcXCR7MToke2FyZy5uYW1lfX0pYCwgaW5zZXJ0VGV4dEZvcm1hdDogSW5zZXJ0VGV4dEZvcm1hdC5TbmlwcGV0LFxuICAgIH0pKSB9O1xuICB9XG4gIGNvbnN0IGNvbm5lY3Rpb24gPSBpbnN0YW50aWF0aW9uQ29udGV4dChjb250ZXh0KTtcblxuICBpZiAoY29ubmVjdGlvbikge1xuICAgIHJldHVybiB7XG4gICAgICBpc0luY29tcGxldGU6IGZhbHNlLFxuICAgICAgaXRlbXM6IGNvbm5lY3Rpb25JdGVtcyhjb25uZWN0aW9uLCBjb250ZXh0LCBjYXRhbG9nLCBzZXR0aW5ncyksXG4gICAgfTtcbiAgfVxuXG4gIC8vIGBEVVRfaWYuYCAtLSB0aGUgbWVtYmVycyBvZiBhbiBpbnRlcmZhY2UgaW5zdGFuY2UsIG9yIG9mIGEgc3VibW9kdWxlLlxuICBjb25zdCBtZW1iZXIgPSBtZW1iZXJBY2Nlc3NDb250ZXh0KGNvbnRleHQsIGNhdGFsb2cpO1xuICBpZiAobWVtYmVyKSB7XG4gICAgcmV0dXJuIHsgaXNJbmNvbXBsZXRlOiBmYWxzZSwgaXRlbXM6IG1lbWJlci5pdGVtcyB9O1xuICB9XG5cbiAgLy8gVmlzaWJsZSBIREwgZGVjbGFyYXRpb25zLlxuICBjb25zdCBjaGFpbiA9IHNjb3BlQ2hhaW4oY29udGV4dC5hbmFseXNpcywgY29udGV4dC5vZmZzZXQpO1xuICBjb25zdCBzY29wZSA9IGNoYWluW2NoYWluLmxlbmd0aCAtIDFdO1xuICBjb25zdCBzeW1ib2xzID0gdmlzaWJsZVN5bWJvbHMoY29udGV4dC5hbmFseXNpcywgY29udGV4dC5vZmZzZXQpO1xuXG4gIGZvciAoY29uc3Qgc3ltYm9sIG9mIHN5bWJvbHMpIHtcbiAgICBpZiAoKHN5bWJvbC5jYXRlZ29yeSA9PT0gXCJwYXJhbWV0ZXJcIiB8fCBzeW1ib2wuY2F0ZWdvcnkgPT09IFwibG9jYWxwYXJhbVwiKSAmJiAhc2V0dGluZ3MuaW5jbHVkZVBhcmFtZXRlcnMpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpdGVtcy5wdXNoKHN5bWJvbEl0ZW0oc3ltYm9sLCBjb250ZXh0LCBzZXR0aW5ncywgXCIxXCIpKTtcbiAgfVxuXG4gIC8vIE5hbWVzIG1hZGUgdmlzaWJsZSBieSBgaW1wb3J0IGNmZ19wa2c6OipgLiBUaGV5IGFyZSBub3QgZGVjbGFyZWQgaGVyZSwgc29cbiAgLy8gd2l0aG91dCB0aGlzIGEgcGVyZmVjdGx5IGdvb2QgY3Jvc3MtZmlsZSBwYXJhbWV0ZXIgaXMgc2ltcGx5IGFic2VudCBmcm9tXG4gIC8vIHRoZSBsaXN0LlxuICBjb25zdCBhbHJlYWR5T2ZmZXJlZCA9IG5ldyBTZXQoc3ltYm9scy5tYXAoKHMpID0+IHMubmFtZSkpO1xuXG4gIC8vIFR5cGVzIGEgYGAgYGluY2x1ZGUgYGBkIGhlYWRlciBkZWNsYXJlcy4gVGhleSBhcmUgd3JpdHRlbiBhYm92ZSB0aGUgaGVhZGVyJ3NcbiAgLy8gZmlyc3QgbW9kdWxlLCBzbyB0aGlzIGZpbGUgdXNlcyBuYW1lcyBpdCBuZXZlciBkZWNsYXJlcyAtLSBhbmQgYSBjb21wbGV0aW9uXG4gIC8vIGxpc3QgdGhhdCBvbWl0cyB0aGVtIGlzIHdoeSBgaGRyX2AgY29tcGxldGVzIHRvIG5vdGhpbmcuXG4gIGlmIChpbmNsdWRlcykge1xuICAgIGZvciAoY29uc3QgZGVjbGFyZWQgb2YgaW5jbHVkZWREZWNsYXJhdGlvbnMoY29udGV4dC5kb2N1bWVudC51cmksIGNhdGFsb2csIGluY2x1ZGVzKSkge1xuICAgICAgaWYgKGFscmVhZHlPZmZlcmVkLmhhcyhkZWNsYXJlZC5zeW1ib2wubmFtZSkpIGNvbnRpbnVlO1xuICAgICAgYWxyZWFkeU9mZmVyZWQuYWRkKGRlY2xhcmVkLnN5bWJvbC5uYW1lKTtcblxuICAgICAgY29uc3QgaXRlbSA9IHN5bWJvbEl0ZW0oZGVjbGFyZWQuc3ltYm9sLCBjb250ZXh0LCBzZXR0aW5ncywgXCIxXCIpO1xuICAgICAgaXRlbS5kZXRhaWwgPSBgJHtpdGVtLmRldGFpbCA/PyBcIlwifSBcdTAwQjcgJHtkZWNsYXJlZC5oZWFkZXJ9YC50cmltKCk7XG4gICAgICBpdGVtcy5wdXNoKGl0ZW0pO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgaW1wb3J0ZWQgb2YgaW1wb3J0ZWRNZW1iZXJzKGNvbnRleHQuYW5hbHlzaXMsIGNhdGFsb2csIGNvbnRleHQub2Zmc2V0KSkge1xuICAgIGlmIChhbHJlYWR5T2ZmZXJlZC5oYXMoaW1wb3J0ZWQuc3ltYm9sLm5hbWUpKSBjb250aW51ZTtcbiAgICBhbHJlYWR5T2ZmZXJlZC5hZGQoaW1wb3J0ZWQuc3ltYm9sLm5hbWUpO1xuICAgIGlmIChcbiAgICAgIChpbXBvcnRlZC5zeW1ib2wuY2F0ZWdvcnkgPT09IFwicGFyYW1ldGVyXCIgfHwgaW1wb3J0ZWQuc3ltYm9sLmNhdGVnb3J5ID09PSBcImxvY2FscGFyYW1cIikgJiZcbiAgICAgICFzZXR0aW5ncy5pbmNsdWRlUGFyYW1ldGVyc1xuICAgICkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgaXRlbSA9IHN5bWJvbEl0ZW0oaW1wb3J0ZWQuc3ltYm9sLCBjb250ZXh0LCBzZXR0aW5ncywgXCIxXCIpO1xuICAgIGl0ZW0uZGV0YWlsID0gYCR7aXRlbS5kZXRhaWwgPz8gXCJcIn0gXHUwMEI3ICR7aW1wb3J0ZWQucGFja2FnZU5hbWV9OjpgLnRyaW0oKTtcbiAgICBpdGVtcy5wdXNoKGl0ZW0pO1xuICB9XG5cbiAgLy8gRGVzaWduIHVuaXRzOiBtb2R1bGVzLCBpbnRlcmZhY2VzLCBwYWNrYWdlcy5cbiAgaWYgKGF0SW5zdGFudGlhdGlvblR5cGUoY29udGV4dCwgc2NvcGUpKSB7XG4gICAgZm9yIChjb25zdCB1bml0IG9mIGNhdGFsb2cudW5pdHMoKSkge1xuICAgICAgaXRlbXMucHVzaCh1bml0SXRlbSh1bml0Lm5hbWUsIHVuaXQua2luZCwgdW5pdC51cmksIHVuaXQucG9ydHMsIHVuaXQucGFyYW1ldGVycywgXCIwXCIpKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZm9yIChjb25zdCB1bml0IG9mIGNhdGFsb2cudW5pdHMoKSkge1xuICAgICAgaXRlbXMucHVzaCh1bml0SXRlbSh1bml0Lm5hbWUsIHVuaXQua2luZCwgdW5pdC51cmksIHVuaXQucG9ydHMsIHVuaXQucGFyYW1ldGVycywgXCIzXCIpKTtcbiAgICB9XG4gIH1cblxuICAvLyBFbmNsb3Npbmcgc2NvcGUgbmFtZXMgaGVscCBgcGtnOjptZW1iZXJgIHN0eWxlIHJlZmVyZW5jZXMuXG4gIGZvciAoY29uc3Qgb3V0ZXIgb2YgY2hhaW4pIHtcbiAgICBpZiAob3V0ZXIuaWQgPT09IHNjb3BlPy5pZCkgY29udGludWU7XG4gICAgaXRlbXMucHVzaCh7XG4gICAgICBsYWJlbDogb3V0ZXIubmFtZSxcbiAgICAgIGtpbmQ6IHRvQ29tcGxldGlvbktpbmQob3V0ZXIuY2F0ZWdvcnkpLFxuICAgICAgZGV0YWlsOiBgJHtDQVRFR09SWV9MQUJFTFtvdXRlci5jYXRlZ29yeV0gPz8gb3V0ZXIuY2F0ZWdvcnl9IChlbmNsb3Npbmcgc2NvcGUpYCxcbiAgICAgIHNvcnRUZXh0OiBgNHwke291dGVyLm5hbWV9YCxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEtleXdvcmRzIGFuZCBzY2FmZm9sZGluZyBzbmlwcGV0cyBvbmx5IGJlY29tZSByZWxldmFudCBvbmNlIHNvbWV0aGluZyBoYXNcbiAgLy8gYmVlbiB0eXBlZC4gT2ZmZXJpbmcgdGhlbSBvbiBhbiBlbXB0eSBwcmVmaXggZmxvb2RzIHRoZSBsaXN0IGF0IHRoZSBleGFjdFxuICAvLyBtb21lbnQgdGhlIHVzZXIgcmVhY2hlcyBmb3IgYGFzc2lnbiA8c3BhY2U+YCwgd2hlcmUgdGhlIHNpZ25hbHMgYXJlIGFsbFxuICAvLyB0aGV5IHdhbnQgdG8gc2VlLlxuICBpZiAoY29udGV4dC5wcmVmaXgubGVuZ3RoID4gMCkge1xuICAgIGl0ZW1zLnB1c2goXG4gICAgICAuLi5zdGF0aWNDb21wbGV0aW9uSXRlbXMoeyBzbmlwcGV0czogc2V0dGluZ3Muc25pcHBldHMsIHN5c3RlbUZ1bmN0aW9uczogc2V0dGluZ3Muc3lzdGVtRnVuY3Rpb25zIH0pLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4geyBpc0luY29tcGxldGU6IGZhbHNlLCBpdGVtczogZGVkdXBlKGl0ZW1zKSB9O1xufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogSXRlbSBjb25zdHJ1Y3Rpb25cbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5leHBvcnQgZnVuY3Rpb24gc3ltYm9sSXRlbShcbiAgc3ltYm9sOiBIZGxTeW1ib2wsXG4gIGNvbnRleHQ6IENvbXBsZXRpb25Db250ZXh0LFxuICBzZXR0aW5nczogQ29tcGxldGlvblNldHRpbmdzLFxuICBidWNrZXQ6IHN0cmluZyxcbik6IENvbXBsZXRpb25JdGVtIHtcbiAgY29uc3QgdXNlcyA9IGNvbnRleHQuYW5hbHlzaXMuaWRlbnRpZmllcnMuZ2V0KHN5bWJvbC5uYW1lKT8ubGVuZ3RoID8/IDA7XG4gIGNvbnN0IGRldGFpbCA9IGRlc2NyaWJlU3ltYm9sKHN5bWJvbCwgc2V0dGluZ3MpO1xuXG4gIGNvbnN0IGl0ZW06IENvbXBsZXRpb25JdGVtID0ge1xuICAgIGxhYmVsOiBzeW1ib2wubmFtZSxcbiAgICBraW5kOiB0b0NvbXBsZXRpb25LaW5kKHN5bWJvbC5jYXRlZ29yeSksXG4gICAgZGV0YWlsOiBkZXRhaWwgfHwgQ0FURUdPUllfTEFCRUxbc3ltYm9sLmNhdGVnb3J5XSxcbiAgICBkb2N1bWVudGF0aW9uOiBkb2N1bWVudGF0aW9uRm9yKHN5bWJvbCwgeyAuLi5zZXR0aW5ncywgdXNhZ2VDb3VudDogdXNlcyB9KSxcbiAgICBzb3J0VGV4dDogYCR7YnVja2V0fXwke3N5bWJvbC5jYXRlZ29yeX18JHtzeW1ib2wubmFtZX1gLFxuICAgIGZpbHRlclRleHQ6IHN5bWJvbC5uYW1lLFxuICB9O1xuXG4gIC8vIFBvcnRzIGdldCBhIHBsYWluIGluc2VydDsgbm90aGluZyB0byBleHBhbmQuXG4gIGl0ZW0uaW5zZXJ0VGV4dCA9IHN5bWJvbC5uYW1lO1xuICBhcHBseUNhbGxhYmxlKGl0ZW0sIHN5bWJvbCwgY29udGV4dCk7XG5cbiAgLy8gQSBwYXJhbWV0ZXIgY2FuIGJlIGluc2VydGVkIGFzIGl0cyByZXNvbHZlZCB2YWx1ZSB3aXRoIGEgXCJ2YWx1ZTpcIiBjb21taXQuXG4gIGlmIChcbiAgICAoc3ltYm9sLmNhdGVnb3J5ID09PSBcInBhcmFtZXRlclwiIHx8IHN5bWJvbC5jYXRlZ29yeSA9PT0gXCJsb2NhbHBhcmFtXCIpICYmXG4gICAgc3ltYm9sLnJlc29sdmVkVmFsdWUgIT09IHVuZGVmaW5lZFxuICApIHtcbiAgICBpdGVtLmNvbW1hbmQgPSB7XG4gICAgICB0aXRsZTogXCJJbnNlcnQgcmVzb2x2ZWQgdmFsdWVcIixcbiAgICAgIGNvbW1hbmQ6IFwic3Zpc2lvbi5pbnNlcnRSZXNvbHZlZFZhbHVlXCIsXG4gICAgICBhcmd1bWVudHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHVyaTogY29udGV4dC5kb2N1bWVudC51cmksXG4gICAgICAgICAgcmFuZ2U6IHsgc3RhcnQ6IGNvbnRleHQuZG9jdW1lbnQucG9zaXRpb25BdChjb250ZXh0Lm9mZnNldCksIGVuZDogY29udGV4dC5kb2N1bWVudC5wb3NpdGlvbkF0KGNvbnRleHQub2Zmc2V0KSB9LFxuICAgICAgICAgIG5hbWU6IHN5bWJvbC5uYW1lLFxuICAgICAgICAgIHZhbHVlOiBTdHJpbmcoc3ltYm9sLnJlc29sdmVkVmFsdWUpLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICB9XG5cbiAgcmV0dXJuIGl0ZW07XG59XG5cbmZ1bmN0aW9uIHVuaXRJdGVtKFxuICBuYW1lOiBzdHJpbmcsXG4gIGtpbmQ6IEhkbFNjb3BlW1wiY2F0ZWdvcnlcIl0sXG4gIHVyaTogc3RyaW5nLFxuICBwb3J0czogSGRsU3ltYm9sW10sXG4gIHBhcmFtZXRlcnM6IEhkbFN5bWJvbFtdLFxuICBidWNrZXQ6IHN0cmluZyxcbik6IENvbXBsZXRpb25JdGVtIHtcbiAgY29uc3QgcG9ydFN1bW1hcnkgPSBwb3J0cy5sZW5ndGggPiAwID8gYCAoJHtwb3J0cy5sZW5ndGh9IHBvcnRzKWAgOiBcIlwiO1xuICBjb25zdCBwYXJhbVN1bW1hcnkgPSBwYXJhbWV0ZXJzLmxlbmd0aCA+IDAgPyBgICgke3BhcmFtZXRlcnMubGVuZ3RofSBwYXJhbXMpYCA6IFwiXCI7XG5cbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogbmFtZSxcbiAgICBraW5kOlxuICAgICAga2luZCA9PT0gXCJpbnRlcmZhY2VcIlxuICAgICAgICA/IENvbXBsZXRpb25JdGVtS2luZC5JbnRlcmZhY2VcbiAgICAgICAgOiBraW5kID09PSBcInBhY2thZ2VcIlxuICAgICAgICAgID8gQ29tcGxldGlvbkl0ZW1LaW5kLk1vZHVsZVxuICAgICAgICAgIDogQ29tcGxldGlvbkl0ZW1LaW5kLkNsYXNzLFxuICAgIGRldGFpbDogYCR7Q0FURUdPUllfTEFCRUxba2luZF0gPz8ga2luZH0ke3BvcnRTdW1tYXJ5fSR7cGFyYW1TdW1tYXJ5fSBcdTIwMTQgJHtzaG9ydFVyaSh1cmkpfWAsXG4gICAgc29ydFRleHQ6IGAke2J1Y2tldH18JHtraW5kfXwke25hbWV9YCxcbiAgICBmaWx0ZXJUZXh0OiBuYW1lLFxuICB9O1xufVxuXG5mdW5jdGlvbiBjb25uZWN0aW9uSXRlbXMoXG4gIGNvbm5lY3Rpb246IEluc3RhbnRpYXRpb25Db250ZXh0LFxuICBjb250ZXh0OiBDb21wbGV0aW9uQ29udGV4dCxcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbiAgc2V0dGluZ3M6IENvbXBsZXRpb25TZXR0aW5ncyxcbik6IENvbXBsZXRpb25JdGVtW10ge1xuICBjb25zdCB1bml0ID0gY2F0YWxvZy5nZXQoY29ubmVjdGlvbi50eXBlTmFtZSk7XG4gIGlmICghdW5pdCkge1xuICAgIC8vIFRoZSBtb2R1bGUgaXMgbm90IGluZGV4ZWQgeWV0OyBmYWxsIGJhY2sgdG8gdGhlIGZ1bGwgbGlzdC5cbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCBzb3VyY2UgPSBjb25uZWN0aW9uLmtpbmQgPT09IFwicG9ydFwiID8gdW5pdC5wb3J0cyA6IHVuaXQucGFyYW1ldGVycztcbiAgcmV0dXJuIHNvdXJjZS5tYXAoKHN5bWJvbCkgPT4ge1xuICAgIGNvbnN0IHVzZXMgPSBjb250ZXh0LmFuYWx5c2lzLmlkZW50aWZpZXJzLmdldChzeW1ib2wubmFtZSk/Lmxlbmd0aCA/PyAwO1xuICAgIHJldHVybiB7XG4gICAgICBsYWJlbDogc3ltYm9sLm5hbWUsXG4gICAgICBraW5kOiB0b0NvbXBsZXRpb25LaW5kKHN5bWJvbC5jYXRlZ29yeSksXG4gICAgICBkZXRhaWw6IGRlc2NyaWJlU3ltYm9sKHN5bWJvbCwgc2V0dGluZ3MpLFxuICAgICAgZG9jdW1lbnRhdGlvbjogZG9jdW1lbnRhdGlvbkZvcihzeW1ib2wsIHsgLi4uc2V0dGluZ3MsIHVzYWdlQ291bnQ6IHVzZXMgfSksXG4gICAgICBmaWx0ZXJUZXh0OiBzeW1ib2wubmFtZSxcbiAgICAgIGluc2VydFRleHQ6IGNvbm5lY3Rpb24ua2luZCA9PT0gXCJwb3J0XCIgPyBgLiR7c3ltYm9sLm5hbWV9KClgIDogYC4ke3N5bWJvbC5uYW1lfSgke3N5bWJvbC5yZXNvbHZlZFZhbHVlID8/IFwiXCJ9KWAsXG4gICAgICBzb3J0VGV4dDogYDB8JHtzeW1ib2wuY2F0ZWdvcnl9fCR7c3ltYm9sLm5hbWV9YCxcbiAgICB9IHNhdGlzZmllcyBDb21wbGV0aW9uSXRlbTtcbiAgfSk7XG59XG5cbi8qIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqXG4gKiBDb250ZXh0IGRldGVjdGlvblxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmludGVyZmFjZSBJbnN0YW50aWF0aW9uQ29udGV4dCB7XG4gIHJlYWRvbmx5IGtpbmQ6IFwicG9ydFwiIHwgXCJwYXJhbWV0ZXJcIjtcbiAgcmVhZG9ubHkgdHlwZU5hbWU6IHN0cmluZztcbn1cblxuLyoqXG4gKiBEZXRlY3RzIGA8aW5zdGFuY2U+LmAgYXQgdGhlIGN1cnNvciwgc28gdGhlIGxpc3QgY2FuIGJlIHJlc3RyaWN0ZWQgdG8gd2hhdFxuICogdGhhdCBpbnN0YW5jZSBvZmZlcnMuXG4gKlxuICogYERVVF9pZi5hZGNgIGlzIHRoZSBjYXNlIHRoYXQgbWF0dGVycyBtb3N0OiBhbiBpbnRlcmZhY2UncyBzaWduYWxzIGFyZSBub3RcbiAqIHBvcnRzIG9mIHRoZSBlbmNsb3NpbmcgbW9kdWxlLCB0aGV5IGFyZSBvcmRpbmFyeSBkZWNsYXJhdGlvbnMgaW5zaWRlIHRoZVxuICogaW50ZXJmYWNlLCBzbyBub3RoaW5nIGluIHRoZSBsb2NhbCBzY29wZSB3b3VsZCBzdWdnZXN0IHRoZW0uXG4gKlxuICogVGhlIGlkZW50aWZpZXIgYmVmb3JlIHRoZSBkb3QgaXMgcmVhZCBmcm9tIHRoZSB0ZXh0IHJhdGhlciB0aGFuIHRoZSB0cmVlLFxuICogYmVjYXVzZSB0aGUgY3Vyc29yIHNpdHMgaW4gdGhlIG1pZGRsZSBvZiBhIHBhcnRpYWwgbWVtYmVyIG5hbWUgYW5kIHRoZSBwYXJzZVxuICogYXQgdGhhdCBwb2ludCBpcyBub3QgeWV0IGEgY29tcGxldGUgcmVmZXJlbmNlLlxuICovXG5mdW5jdGlvbiBtZW1iZXJBY2Nlc3NDb250ZXh0KFxuICBjb250ZXh0OiBDb21wbGV0aW9uQ29udGV4dCxcbiAgY2F0YWxvZzogQ2F0YWxvZyxcbik6IHsgaXRlbXM6IENvbXBsZXRpb25JdGVtW10gfSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHRleHQgPSBjb250ZXh0LmRvY3VtZW50LmdldFRleHQoKTtcbiAgbGV0IHN0YXJ0ID0gY29udGV4dC5yYW5nZVN0YXJ0O1xuXG4gIC8vIFdhbGsgYmFjayBvdmVyIHRoZSBtZW1iZXIgbmFtZSBiZWluZyB0eXBlZC5cbiAgd2hpbGUgKHN0YXJ0ID4gMCAmJiBpc1dvcmRDaGFyKHRleHRbc3RhcnQgLSAxXSEpKSBzdGFydC0tO1xuXG4gIC8vIGBwa2c6OmAgYW5kIGBpbnN0LmAgYXNrIHRoZSBzYW1lIHF1ZXN0aW9uIHdpdGggZGlmZmVyZW50IHN5bnRheDogd2hhdCBkb2VzXG4gIC8vIHRoaXMgbmFtZWQgc2NvcGUgaG9sZD9cbiAgY29uc3QgZG90dGVkID0gdGV4dC5zbGljZShNYXRoLm1heCgwLCBzdGFydCAtIDIpLCBzdGFydCkgPT09IFwiOjpcIjtcbiAgY29uc3QgZGVsaW1pdGVyID0gZG90dGVkID8gMiA6IDE7XG4gIGlmIChzdGFydCA8IGRlbGltaXRlcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKChkb3R0ZWQgPyB0ZXh0W3N0YXJ0IC0gMl0gOiB0ZXh0W3N0YXJ0IC0gMV0pICE9PSAoZG90dGVkID8gXCI6XCIgOiBcIi5cIikpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gLi4uIGFuZCBvdmVyIHRoZSBuYW1lIGJlZm9yZSB0aGUgc2VwYXJhdG9yLlxuICBjb25zdCBuYW1lRW5kID0gc3RhcnQgLSBkZWxpbWl0ZXI7XG4gIGxldCBuYW1lU3RhcnQgPSBuYW1lRW5kO1xuICB3aGlsZSAobmFtZVN0YXJ0ID4gMCAmJiBpc1dvcmRDaGFyKHRleHRbbmFtZVN0YXJ0IC0gMV0hKSkgbmFtZVN0YXJ0LS07XG4gIGNvbnN0IG93bmVyTmFtZSA9IHRleHQuc2xpY2UobmFtZVN0YXJ0LCBuYW1lRW5kKTtcbiAgaWYgKCFvd25lck5hbWUgfHwgIS9eW0EtWmEtel9dLy50ZXN0KG93bmVyTmFtZSkpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgLy8gYGNmZ19wa2c6OmAgbmFtZXMgYSBwYWNrYWdlLCB3aG9zZSBtZW1iZXJzIGFyZSBkZWNsYXJhdGlvbnMgaW4gaXRzIG93blxuICAvLyBmaWxlIHJhdGhlciB0aGFuIHBvcnRzLlxuICBpZiAoZG90dGVkKSB7XG4gICAgY29uc3QgcGtnID0gY2F0YWxvZy5yZXNvbHZlKG93bmVyTmFtZSk7XG4gICAgaWYgKCFwa2cpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIHsgaXRlbXM6IG1lbWJlckl0ZW1zKFsuLi5wa2cucGFyYW1ldGVycywgLi4ucGtnLnBvcnRzLCAuLi5wa2cuc3ltYm9sc10sIGNvbnRleHQpIH07XG4gIH1cblxuICBjb25zdCBpbnN0YW5jZSA9IGNvbnRleHQuYW5hbHlzaXMuc2NvcGVzXG4gICAgLmZsYXRNYXAoKHNjb3BlKSA9PiBzY29wZS5pbnN0YW5jZXMpXG4gICAgLmZpbmQoKGkpID0+IGkuaW5zdGFuY2VOYW1lID09PSBvd25lck5hbWUpO1xuICBpZiAoaW5zdGFuY2UpIHtcbiAgICBjb25zdCBlbnRyeSA9IGNhdGFsb2cucmVzb2x2ZShpbnN0YW5jZS50eXBlTmFtZSk7XG4gICAgaWYgKCFlbnRyeSkgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIC8vIEFuIGludGVyZmFjZSBvZmZlcnMgZXZlcnl0aGluZyBpdCBkZWNsYXJlczsgYSBtb2R1bGUgb2ZmZXJzIGl0cyBwb3J0cy5cbiAgICBjb25zdCBtZW1iZXJzID1cbiAgICAgIGVudHJ5LmtpbmQgPT09IFwiaW50ZXJmYWNlXCIgPyBbLi4uZW50cnkucG9ydHMsIC4uLmVudHJ5LnN5bWJvbHNdIDogZW50cnkucG9ydHM7XG5cbiAgICByZXR1cm4geyBpdGVtczogbWVtYmVySXRlbXMobWVtYmVycywgY29udGV4dCkgfTtcbiAgfVxuXG4gIC8vIGBidXMuZGF0YWAgd2hlcmUgYGJ1c2AgaXMgYSBwb3J0IG9mIGludGVyZmFjZSB0eXBlIChgYnVzX2lmLnNsYXZlIGJ1c2ApLlxuICAvLyBUaGUgcG9ydCBpcyBhIG5hbWUgYm91bmQgdG8gYSBzY29wZSB0aGF0IGlzIG5vdCB0aGUgb25lIGJlaW5nIHdyaXR0ZW4gaW4sIHNvXG4gIC8vIGl0IGhhcyB0byBiZSBmb2xsb3dlZCB0aHJvdWdoIHRoZSBpbnRlcmZhY2UgaXQgZGVjbGFyZXMgLS0gdGhlIHNhbWUgd2Fsa1xuICAvLyBnby10by1kZWZpbml0aW9uIGRvZXMuXG4gIGNvbnN0IGJvdW5kID0gdmlzaWJsZVN5bWJvbHMoY29udGV4dC5hbmFseXNpcywgY29udGV4dC5vZmZzZXQpLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gb3duZXJOYW1lKTtcbiAgY29uc3QgaWZhY2UgPSBib3VuZCA/IGludGVyZmFjZU9mVHlwZShib3VuZC50eXBlVGV4dCwgY2F0YWxvZykgOiB1bmRlZmluZWQ7XG4gIGlmIChpZmFjZSkge1xuICAgIHJldHVybiB7IGl0ZW1zOiBtZW1iZXJJdGVtcyhbLi4uaWZhY2UucG9ydHMsIC4uLmlmYWNlLnN5bWJvbHNdLCBjb250ZXh0KSB9O1xuICB9XG5cbiAgLy8gYHBrdC5gIHdoZXJlIGBwa3RgIGlzIGFuIG9iamVjdCBoYW5kbGUuIEEgY2xhc3Mgb2ZmZXJzIGl0cyBwcm9wZXJ0aWVzIGFuZFxuICAvLyBpdHMgbWV0aG9kcywgaW5jbHVkaW5nIHRoZSBvbmVzIGluaGVyaXRlZCBmcm9tIGEgYmFzZSBjbGFzcy5cbiAgY29uc3QgaGFuZGxlID0gdmlzaWJsZVN5bWJvbHMoY29udGV4dC5hbmFseXNpcywgY29udGV4dC5vZmZzZXQpLmZpbmQoXG4gICAgKHMpID0+IHMubmFtZSA9PT0gb3duZXJOYW1lICYmIHMuaGFuZGxlT2YsXG4gICk7XG4gIGlmIChoYW5kbGU/LmhhbmRsZU9mKSB7XG4gICAgY29uc3QgbWVtYmVycyA9IGNhdGFsb2cuY2xhc3NNZW1iZXJzKGhhbmRsZS5oYW5kbGVPZik7XG4gICAgaWYgKG1lbWJlcnMubGVuZ3RoID4gMCkgcmV0dXJuIHsgaXRlbXM6IG1lbWJlckl0ZW1zKG1lbWJlcnMsIGNvbnRleHQpIH07XG4gIH1cblxuICAvLyBgbWFpbi5gIHdoZXJlIGBtYWluYCBuYW1lcyBhIGJsb2NrOiBgYmVnaW4gOiBtYWluIC4uLiBlbmRgLiBJdHMgbWVtYmVycyBhcmVcbiAgLy8gdGhlIHNpZ25hbHMgZGVjbGFyZWQgaW5zaWRlLCB3aGljaCBsaXZlIGluIHRoZSBibG9jaydzIG93biBzY29wZS5cbiAgY29uc3QgYmxvY2sgPSBuYW1lZEJsb2NrU2NvcGUoY29udGV4dC5hbmFseXNpcywgY29udGV4dC5vZmZzZXQsIG93bmVyTmFtZSk7XG4gIGlmIChibG9jaykge1xuICAgIGNvbnN0IG1lbWJlcnMgPSBbLi4uYmxvY2sucGFyYW1ldGVycywgLi4uYmxvY2sucG9ydHMsIC4uLmJsb2NrLnN5bWJvbHNdO1xuICAgIGlmIChtZW1iZXJzLmxlbmd0aCA+IDApIHJldHVybiB7IGl0ZW1zOiBtZW1iZXJJdGVtcyhtZW1iZXJzLCBjb250ZXh0KSB9O1xuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqIFRoZSBuYW1lZCBibG9jayB2aXNpYmxlIGZyb20gYG9mZnNldGAsIGlmIHRoZXJlIGlzIG9uZS4gKi9cbmZ1bmN0aW9uIG5hbWVkQmxvY2tTY29wZShcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBvZmZzZXQ6IG51bWJlcixcbiAgbmFtZTogc3RyaW5nLFxuKTogSGRsU2NvcGUgfCB1bmRlZmluZWQge1xuICBjb25zdCBlbmNsb3NpbmcgPSBzY29wZUNoYWluKGFuYWx5c2lzLCBvZmZzZXQpO1xuICByZXR1cm4gcmVzb2x2ZU5hbWVkQmxvY2soYW5hbHlzaXMsIGVuY2xvc2luZywgbmFtZSk7XG59XG5cbi8qKiBDb21wbGV0aW9uIGVudHJpZXMgZm9yIG9uZSBzZXQgb2YgbWVtYmVycywga2VlcGluZyBlYWNoIG9uZSdzIGRldGFpbC4gKi9cbmZ1bmN0aW9uIG1lbWJlckl0ZW1zKG1lbWJlcnM6IHJlYWRvbmx5IEhkbFN5bWJvbFtdLCBjb250ZXh0OiBDb21wbGV0aW9uQ29udGV4dCk6IENvbXBsZXRpb25JdGVtW10ge1xuICByZXR1cm4gbWVtYmVycy5tYXAoKHN5bWJvbCkgPT4ge1xuICAgIGNvbnN0IGl0ZW06IENvbXBsZXRpb25JdGVtID0ge1xuICAgICAgbGFiZWw6IHN5bWJvbC5uYW1lLFxuICAgICAga2luZDogdG9Db21wbGV0aW9uS2luZChzeW1ib2wuY2F0ZWdvcnkpLFxuICAgICAgZGV0YWlsOiBkZXNjcmliZVN5bWJvbChzeW1ib2wsIHsgc2hvd1dpZHRoOiB0cnVlLCBzaG93VHlwZTogdHJ1ZSB9KSxcbiAgICB9O1xuICAgIGlmIChzeW1ib2wuZG9jKSBpdGVtLmRvY3VtZW50YXRpb24gPSBzeW1ib2wuZG9jO1xuICAgIGFwcGx5Q2FsbGFibGUoaXRlbSwgc3ltYm9sLCBjb250ZXh0KTtcbiAgICByZXR1cm4gaXRlbTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q2FsbGFibGUoaXRlbTogQ29tcGxldGlvbkl0ZW0sIHN5bWJvbDogSGRsU3ltYm9sLCBjb250ZXh0OiBDb21wbGV0aW9uQ29udGV4dCk6IHZvaWQge1xuICBpZiAoc3ltYm9sLmNhdGVnb3J5ICE9PSBcInRhc2tcIiAmJiBzeW1ib2wuY2F0ZWdvcnkgIT09IFwiZnVuY3Rpb25cIikgcmV0dXJuO1xuICBpdGVtLmRldGFpbCA9IGNhbGxhYmxlTGFiZWwoc3ltYm9sKTtcbiAgLy8gRG8gbm90IGR1cGxpY2F0ZSBhIGNhbGwncyBwYXJlbnRoZXNlcyB3aGVuIGNvbXBsZXRpbmcgaXRzIG5hbWUgaW4gcGxhY2UuXG4gIGlmICgvXlxcdypcXHMqXFwoLy50ZXN0KGNvbnRleHQuZG9jdW1lbnQuZ2V0VGV4dCgpLnNsaWNlKGNvbnRleHQub2Zmc2V0KSkpIHJldHVybjtcbiAgaXRlbS5pbnNlcnRUZXh0Rm9ybWF0ID0gSW5zZXJ0VGV4dEZvcm1hdC5TbmlwcGV0O1xuICBpdGVtLmluc2VydFRleHQgPSBgJHtzeW1ib2wubmFtZX0oJHsoc3ltYm9sLmFyZ3VtZW50cyA/PyBbXSkubWFwKChhLCBpKSA9PiBgXFwkeyR7aSArIDF9OiR7YS5uYW1lfX1gKS5qb2luKFwiLCBcIil9KSQwYDtcbiAgaXRlbS5jb21tYW5kID0geyB0aXRsZTogXCJTaG93IGFyZ3VtZW50c1wiLCBjb21tYW5kOiBcImVkaXRvci5hY3Rpb24udHJpZ2dlclBhcmFtZXRlckhpbnRzXCIgfTtcbn1cblxuLyoqIEJpbmRpbmdzIHdob3NlIG5hbWUgYW5kIHZhbHVlIGNhbiBiZSBjb21wbGV0ZWQgZnJvbSB0aGUgaW50ZXJmYWNlLiAqL1xuY29uc3QgQklORElOR19UWVBFUyA9IG5ldyBTZXQoW1wibmFtZWRfcG9ydF9jb25uZWN0aW9uXCIsIFwibmFtZWRfcGFyYW1ldGVyX2Fzc2lnbm1lbnRcIl0pO1xuXG4vKipcbiAqIERldGVjdHMgYSBgLmZvbyhgIC8gYC5GT08oYCBwb3NpdGlvbiBpbnNpZGUgYSBgbW9kdWxlX2luc3RhbnRpYXRpb25gLCBzbyB0aGVcbiAqIGxpc3QgY2FuIGJlIHJlc3RyaWN0ZWQgdG8gdGhhdCBpbnN0YW5jZSdzIHBvcnRzIG9yIHBhcmFtZXRlcnMuXG4gKlxuICogVGhlIGJpbmRpbmcgaXMgYSBzaWJsaW5nIG9mIHRoZSBpbnN0YW5jZSBub2RlIHJhdGhlciB0aGFuIGFuIGFuY2VzdG9yIG9mIHRoZVxuICogY3Vyc29yLCBzbyBpdCBpcyBsb2NhdGVkIGJ5IHJhbmdlIGNvbnRhaW5tZW50IHJhdGhlciB0aGFuIGJ5IHdhbGtpbmcgdXAuXG4gKi9cbmZ1bmN0aW9uIGluc3RhbnRpYXRpb25Db250ZXh0KGNvbnRleHQ6IENvbXBsZXRpb25Db250ZXh0KTogSW5zdGFudGlhdGlvbkNvbnRleHQgfCB1bmRlZmluZWQge1xuICBsZXQgbm9kZTogTm9kZSB8IG51bGwgPSBub2RlQXRPZmZzZXQoY29udGV4dCk7XG5cbiAgLy8gQXNjZW5kIHRvIHRoZSBlbmNsb3NpbmcgaW5zdGFudGlhdGlvbiwgYmFpbGluZyBvdXQgYXQgdGhlIGRlc2lnbi11bml0IGVkZ2UuXG4gIGxldCBpbnN0YW50aWF0aW9uOiBOb2RlIHwgbnVsbCA9IG51bGw7XG4gIHdoaWxlIChub2RlKSB7XG4gICAgaWYgKG5vZGUudHlwZSA9PT0gXCJtb2R1bGVfaW5zdGFudGlhdGlvblwiKSB7XG4gICAgICBpbnN0YW50aWF0aW9uID0gbm9kZTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBub2RlLnR5cGUgPT09IFwic291cmNlX2ZpbGVcIiB8fFxuICAgICAgbm9kZS50eXBlID09PSBcIm1vZHVsZV9kZWNsYXJhdGlvblwiIHx8XG4gICAgICBub2RlLnR5cGUgPT09IFwiaW50ZXJmYWNlX2RlY2xhcmF0aW9uXCJcbiAgICApIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG5vZGUgPSBub2RlLnBhcmVudDtcbiAgfVxuXG4gIGlmICghaW5zdGFudGlhdGlvbikgcmV0dXJuIHVuZGVmaW5lZDtcblxuICBjb25zdCB0eXBlTmFtZSA9IGluc3RhbnRpYXRpb24uY2hpbGRGb3JGaWVsZE5hbWUoXCJpbnN0YW5jZV90eXBlXCIpPy50ZXh0O1xuICBpZiAoIXR5cGVOYW1lKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gIGZvciAoY29uc3QgYmluZGluZyBvZiBmaW5kQmluZGluZ3MoaW5zdGFudGlhdGlvbikpIHtcbiAgICBpZiAoYmluZGluZy5zdGFydEluZGV4IDw9IGNvbnRleHQub2Zmc2V0ICYmIGNvbnRleHQub2Zmc2V0IDw9IGJpbmRpbmcuZW5kSW5kZXgpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6IGJpbmRpbmcudHlwZSA9PT0gXCJuYW1lZF9wYXJhbWV0ZXJfYXNzaWdubWVudFwiID8gXCJwYXJhbWV0ZXJcIiA6IFwicG9ydFwiLFxuICAgICAgICB0eXBlTmFtZSxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24qIGZpbmRCaW5kaW5ncyhpbnN0YW50aWF0aW9uOiBOb2RlKTogR2VuZXJhdG9yPE5vZGU+IHtcbiAgY29uc3Qgc3RhY2s6IE5vZGVbXSA9IFtpbnN0YW50aWF0aW9uXTtcbiAgd2hpbGUgKHN0YWNrLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBub2RlID0gc3RhY2sucG9wKCkhO1xuICAgIGlmIChCSU5ESU5HX1RZUEVTLmhhcyhub2RlLnR5cGUpKSB7XG4gICAgICB5aWVsZCBub2RlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSBub2RlLm5hbWVkQ2hpbGRDb3VudCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBjaGlsZCA9IG5vZGUubmFtZWRDaGlsZChpKTtcbiAgICAgIGlmIChjaGlsZCkgc3RhY2sucHVzaChjaGlsZCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vZGVBdE9mZnNldChjb250ZXh0OiBDb21wbGV0aW9uQ29udGV4dCk6IE5vZGUgfCBudWxsIHtcbiAgcmV0dXJuIG5vZGVBdChjb250ZXh0LmFuYWx5c2lzLCBjb250ZXh0Lm9mZnNldCk7XG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIGN1cnNvciBzaXRzIHdoZXJlIGFuIGluc3RhbnRpYXRlZCBtb2R1bGUgdHlwZSBpcyBleHBlY3RlZC4gKi9cbmZ1bmN0aW9uIGF0SW5zdGFudGlhdGlvblR5cGUoY29udGV4dDogQ29tcGxldGlvbkNvbnRleHQsIHNjb3BlOiBIZGxTY29wZSB8IHVuZGVmaW5lZCk6IGJvb2xlYW4ge1xuICBpZiAoIXNjb3BlKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IG5vZGUgPSBub2RlQXRPZmZzZXQoY29udGV4dCk7XG4gIGlmICghbm9kZSkgcmV0dXJuIGZhbHNlO1xuICAvLyBBZnRlciBgbW9kdWxlX25hbWVgIHdpdGggbm8gaW5zdGFuY2UgbmFtZSB0eXBlZCB5ZXQuXG4gIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50O1xuICBpZiAoIXBhcmVudCkgcmV0dXJuIGZhbHNlO1xuICBpZiAocGFyZW50LnR5cGUgPT09IFwibW9kdWxlX2luc3RhbnRpYXRpb25cIikge1xuICAgIHJldHVybiBwYXJlbnQuY2hpbGRGb3JGaWVsZE5hbWUoXCJpbnN0YW5jZV90eXBlXCIpPy5pZCA9PT0gbm9kZS5pZDtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqXG4gKiBVdGlsaXRpZXNcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5mdW5jdGlvbiBkZWR1cGUoaXRlbXM6IENvbXBsZXRpb25JdGVtW10pOiBDb21wbGV0aW9uSXRlbVtdIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBNYXA8c3RyaW5nLCBDb21wbGV0aW9uSXRlbT4oKTtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBzZWVuLmdldChpdGVtLmxhYmVsKTtcbiAgICAvLyBLZWVwIHRoZSBtb3N0IHNwZWNpZmljIGVudHJ5OiBsb3dlciBzb3J0VGV4dCBidWNrZXQgd2lucy5cbiAgICBpZiAoIWV4aXN0aW5nIHx8IChpdGVtLnNvcnRUZXh0ID8/IFwiXCIpIDwgKGV4aXN0aW5nLnNvcnRUZXh0ID8/IFwiXCIpKSB7XG4gICAgICBzZWVuLnNldChpdGVtLmxhYmVsLCBpdGVtKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFsuLi5zZWVuLnZhbHVlcygpXTtcbn1cblxuZnVuY3Rpb24gc2hvcnRVcmkodXJpOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwYXJ0cyA9IHVyaS5zcGxpdCgvW1xcXFwvXS8pO1xuICByZXR1cm4gcGFydHMuc2xpY2UoLTIpLmpvaW4oXCIvXCIpO1xufVxuIiwgImltcG9ydCB7IENvbXBsZXRpb25JdGVtS2luZCwgSW5zZXJ0VGV4dEZvcm1hdCwgdHlwZSBDb21wbGV0aW9uSXRlbSB9IGZyb20gXCJ2c2NvZGUtbGFuZ3VhZ2VzZXJ2ZXItdHlwZXNcIjtcblxuLyoqIExhbmd1YWdlIGtleXdvcmRzIGdyb3VwZWQgc28gY29tcGxldGlvbiBjYW4gc29ydCB0aGVtIGludG8gYnVja2V0cy4gKi9cbmNvbnN0IEtFWVdPUkRfR1JPVVBTOiB7IGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZDsgd29yZHM6IHN0cmluZ1tdIH1bXSA9IFtcbiAge1xuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5LZXl3b3JkLFxuICAgIHdvcmRzOiBbXG4gICAgICBcIm1vZHVsZVwiLCBcImVuZG1vZHVsZVwiLCBcIm1hY3JvbW9kdWxlXCIsIFwicHJpbWl0aXZlXCIsIFwiZW5kcHJpbWl0aXZlXCIsXG4gICAgICBcInBhY2thZ2VcIiwgXCJlbmRwYWNrYWdlXCIsIFwicHJvZ3JhbVwiLCBcImVuZHByb2dyYW1cIiwgXCJpbnRlcmZhY2VcIiwgXCJlbmRpbnRlcmZhY2VcIixcbiAgICAgIFwiY2xhc3NcIiwgXCJlbmRjbGFzc1wiLCBcInZpcnR1YWxcIiwgXCJleHRlbmRzXCIsIFwiaW1wbGVtZW50c1wiLCBcInB1cmVcIixcbiAgICBdLFxuICB9LFxuICB7XG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLktleXdvcmQsXG4gICAgd29yZHM6IFtcbiAgICAgIFwiYWx3YXlzXCIsIFwiYWx3YXlzX2ZmXCIsIFwiYWx3YXlzX2NvbWJcIiwgXCJhbHdheXNfbGF0Y2hcIiwgXCJpbml0aWFsXCIsIFwiZmluYWxcIixcbiAgICAgIFwiYmVnaW5cIiwgXCJlbmRcIiwgXCJmb3JrXCIsIFwiam9pblwiLCBcImpvaW5fYW55XCIsIFwiam9pbl9ub25lXCIsXG4gICAgICBcImlmXCIsIFwiZWxzZVwiLCBcImNhc2VcIiwgXCJjYXNleFwiLCBcImNhc2V6XCIsIFwiZW5kY2FzZVwiLCBcImRlZmF1bHRcIixcbiAgICAgIFwiZm9yXCIsIFwiZm9yZWFjaFwiLCBcIndoaWxlXCIsIFwiZG9cIiwgXCJyZXBlYXRcIiwgXCJicmVha1wiLCBcImNvbnRpbnVlXCIsIFwicmV0dXJuXCIsXG4gICAgICBcImZvcmV2ZXJcIiwgXCJ3YWl0XCIsIFwiZGlzYWJsZVwiLCBcImFzc2lnblwiLCBcImRlYXNzaWduXCIsIFwiZm9yY2VcIiwgXCJyZWxlYXNlXCIsXG4gICAgXSxcbiAgfSxcbiAge1xuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5UeXBlUGFyYW1ldGVyLFxuICAgIHdvcmRzOiBbXG4gICAgICBcImxvZ2ljXCIsIFwiYml0XCIsIFwiYnl0ZVwiLCBcInNob3J0aW50XCIsIFwiaW50XCIsIFwibG9uZ2ludFwiLCBcImludGVnZXJcIiwgXCJ0aW1lXCIsXG4gICAgICBcInJlYWxcIiwgXCJzaG9ydHJlYWxcIiwgXCJyZWFsdGltZVwiLCBcInJlZ1wiLCBcIndpcmVcIiwgXCJ0cmlcIiwgXCJ3YW5kXCIsIFwid29yXCIsXG4gICAgICBcInN1cHBseTBcIiwgXCJzdXBwbHkxXCIsIFwidHJpMFwiLCBcInRyaTFcIiwgXCJ0cmlhbmRcIiwgXCJ0cmlvclwiLCBcInRyaXJlZ1wiLFxuICAgICAgXCJ1d2lyZVwiLCBcImludGVyY29ubmVjdFwiLCBcInZvaWRcIiwgXCJzdHJpbmdcIiwgXCJjaGFuZGxlXCIsIFwiZXZlbnRcIiwgXCJnZW52YXJcIixcbiAgICBdLFxuICB9LFxuICB7XG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlN0cnVjdCxcbiAgICB3b3JkczogW1wic3RydWN0XCIsIFwidW5pb25cIiwgXCJlbnVtXCIsIFwicGFja2VkXCIsIFwidGFnZ2VkXCJdLFxuICB9LFxuICB7XG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLktleXdvcmQsXG4gICAgd29yZHM6IFtcbiAgICAgIFwiaW5wdXRcIiwgXCJvdXRwdXRcIiwgXCJpbm91dFwiLCBcInJlZlwiLCBcImNvbnN0XCIsIFwidmFyXCIsIFwic3RhdGljXCIsIFwiYXV0b21hdGljXCIsXG4gICAgICBcImxvY2FscGFyYW1cIiwgXCJwYXJhbWV0ZXJcIiwgXCJsb2NhbFwiLCBcInByb3RlY3RlZFwiLCBcInJhbmRcIiwgXCJyYW5kY1wiLFxuICAgIF0sXG4gIH0sXG4gIHtcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuS2V5d29yZCxcbiAgICB3b3JkczogW1xuICAgICAgXCJzaWduZWRcIiwgXCJ1bnNpZ25lZFwiLCBcInVuaXF1ZVwiLCBcInVuaXF1ZTBcIiwgXCJwcmlvcml0eVwiLCBcIndpdGhcIixcbiAgICAgIFwiaW5zaWRlXCIsIFwiZGlzdFwiLCBcIm1hdGNoZXNcIiwgXCJ0YWdnZWRcIiwgXCJiaW5zb2ZcIixcbiAgICBdLFxuICB9LFxuICB7XG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlR5cGVQYXJhbWV0ZXIsXG4gICAgd29yZHM6IFtcInR5cGVkZWZcIiwgXCJlbnVtXCIsIFwiYml0XCIsIFwibG9naWNcIiwgXCJjbGFzc1wiLCBcImludGVyZmFjZVwiXSxcbiAgfSxcbiAge1xuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5Nb2R1bGUsXG4gICAgd29yZHM6IFtcImltcG9ydFwiLCBcImV4cG9ydFwiLCBcInRpbWV1bml0XCIsIFwidGltZXByZWNpc2lvblwiLCBcImNlbGxkZWZpbmVcIiwgXCJlbmRjZWxsZGVmaW5lXCIsIFwiYGluY2x1ZGVcIiwgXCJgZGVmaW5lXCJdLFxuICB9LFxuXTtcblxuLyoqIE1hY3JvcyB0aGF0IGJlaGF2ZSBsaWtlIGtleXdvcmRzLCBzdXJmYWNlZCB3aXRoIGEgZGlzdGluY3QgaWNvbi4gKi9cbmNvbnN0IERJUkVDVElWRVMgPSBbXG4gIFwiYGRlZmluZVwiLCBcImB1bmRlZlwiLCBcImBpZmRlZlwiLCBcImBpZm5kZWZcIiwgXCJgZWxzZVwiLCBcImBlbHNpZlwiLCBcImBlbmRpZlwiLFxuICBcImBpbmNsdWRlXCIsIFwiYHRpbWVzY2FsZVwiLCBcImBkZWZhdWx0X25ldHR5cGVcIiwgXCJgcmVzZXRhbGxcIiwgXCJgY2VsbGRlZmluZVwiLFxuICBcImB1bmNvbm5lY3RlZF9kcml2ZVwiLCBcImBsaW5lXCIsIFwiYGJlZ2luX2tleXdvcmRzXCIsIFwiYGVuZF9rZXl3b3Jkc1wiLCBcImBwcmFnbWFcIixcbl07XG5cbi8qKiBTeXN0ZW0gdGFza3MgYW5kIGZ1bmN0aW9ucyB3b3J0aCBzdXJmYWNpbmcgaW4gUlRMIGNvbnRleHRzLiAqL1xuY29uc3QgU1lTVEVNX0ZVTkNUSU9OUyA9IFtcbiAgeyBuYW1lOiBcIiRjbG9nMlwiLCBkZXRhaWw6IFwiUmV0dXJucyB0aGUgaW50ZWdlciBsb2cyIG9mIHRoZSBhcmd1bWVudC5cIiB9LFxuICB7IG5hbWU6IFwiJGJpdHNcIiwgZGV0YWlsOiBcIlJldHVybnMgdGhlIHNpemUgb2YgYSB0eXBlIG9yIHNpZ25hbCBpbiBiaXRzLlwiIH0sXG4gIHsgbmFtZTogXCIkc2l6ZVwiLCBkZXRhaWw6IFwiUmV0dXJucyB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGluIGFuIHVucGFja2VkIGRpbWVuc2lvbi5cIiB9LFxuICB7IG5hbWU6IFwiJGxlZnRcIiwgZGV0YWlsOiBcIlNoaWZ0cyBhIHZhbHVlIGxlZnQsIGZpbGxpbmcgd2l0aCB6ZXJvcy5cIiB9LFxuICB7IG5hbWU6IFwiJHJpZ2h0XCIsIGRldGFpbDogXCJTaGlmdHMgYSB2YWx1ZSByaWdodCwgZmlsbGluZyB3aXRoIHplcm9zLlwiIH0sXG4gIHsgbmFtZTogXCIkc2lnbmVkXCIsIGRldGFpbDogXCJSZWludGVycHJldHMgdGhlIHZhbHVlIGFzIHNpZ25lZC5cIiB9LFxuICB7IG5hbWU6IFwiJHVuc2lnbmVkXCIsIGRldGFpbDogXCJSZWludGVycHJldHMgdGhlIHZhbHVlIGFzIHVuc2lnbmVkLlwiIH0sXG4gIHsgbmFtZTogXCIkY2VpbFwiLCBkZXRhaWw6IFwiUm91bmRzIHVwIHRvIHRoZSBuZWFyZXN0IGludGVnZXIuXCIgfSxcbiAgeyBuYW1lOiBcIiRmbG9vclwiLCBkZXRhaWw6IFwiUm91bmRzIGRvd24gdG8gdGhlIG5lYXJlc3QgaW50ZWdlci5cIiB9LFxuICB7IG5hbWU6IFwiJHNxcnRcIiwgZGV0YWlsOiBcIlNxdWFyZSByb290LlwiIH0sXG4gIHsgbmFtZTogXCIkbG5cIiwgZGV0YWlsOiBcIk5hdHVyYWwgbG9nYXJpdGhtLlwiIH0sXG4gIHsgbmFtZTogXCIkbG9nMTBcIiwgZGV0YWlsOiBcIkJhc2UtMTAgbG9nYXJpdGhtLlwiIH0sXG4gIHsgbmFtZTogXCIkcG93XCIsIGRldGFpbDogXCJSYWlzZXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZSBzZWNvbmQuXCIgfSxcbiAgeyBuYW1lOiBcIiR1cmFuZG9tXCIsIGRldGFpbDogXCJQc2V1ZG8tcmFuZG9tIG51bWJlci5cIiB9LFxuICB7IG5hbWU6IFwiJHVyYW5kb21fcmFuZ2VcIiwgZGV0YWlsOiBcIlBzZXVkby1yYW5kb20gbnVtYmVyIGluIGEgcmFuZ2UuXCIgfSxcbiAgeyBuYW1lOiBcIiR0aW1lXCIsIGRldGFpbDogXCJDdXJyZW50IHNpbXVsYXRpb24gdGltZS5cIiB9LFxuICB7IG5hbWU6IFwiJHN0aW1lXCIsIGRldGFpbDogXCJTaW11bGF0aW9uIHRpbWUgc2NhbGVkIHRvIHRoZSBtb2R1bGUgdGltZSB1bml0LlwiIH0sXG4gIHsgbmFtZTogXCIkcmVhbHRpbWVcIiwgZGV0YWlsOiBcIkN1cnJlbnQgc2ltdWxhdGlvbiB0aW1lIGFzIGEgcmVhbC5cIiB9LFxuICB7IG5hbWU6IFwiJGNvdW50b25lc1wiLCBkZXRhaWw6IFwiTnVtYmVyIG9mIGJpdHMgc2V0IHRvIG9uZS5cIiB9LFxuICB7IG5hbWU6IFwiJG9uZWhvdFwiLCBkZXRhaWw6IFwiVHJ1ZSB3aGVuIGV4YWN0bHkgb25lIGJpdCBpcyBzZXQuXCIgfSxcbiAgeyBuYW1lOiBcIiRvbmVob3QwXCIsIGRldGFpbDogXCJUcnVlIHdoZW4gYXQgbW9zdCBvbmUgYml0IGlzIHNldC5cIiB9LFxuICB7IG5hbWU6IFwiJGlzdW5rbm93blwiLCBkZXRhaWw6IFwiVHJ1ZSB3aGVuIGFueSBiaXQgaXMgeCBvciB6LlwiIH0sXG4gIHsgbmFtZTogXCIkcGFzdFwiLCBkZXRhaWw6IFwiVmFsdWUgb2YgYW4gZXhwcmVzc2lvbiBpbiBhIHByZXZpb3VzIHRpbWUgc3RlcC5cIiB9LFxuICB7IG5hbWU6IFwiJHJvc2VcIiwgZGV0YWlsOiBcIlRydWUgb24gYSAwIC0+IDEgdHJhbnNpdGlvbi5cIiB9LFxuICB7IG5hbWU6IFwiJGZlbGxcIiwgZGV0YWlsOiBcIlRydWUgb24gYSAxIC0+IDAgdHJhbnNpdGlvbi5cIiB9LFxuICB7IG5hbWU6IFwiJHN0YWJsZVwiLCBkZXRhaWw6IFwiVHJ1ZSB3aGVuIHRoZSB2YWx1ZSBkaWQgbm90IGNoYW5nZS5cIiB9LFxuICB7IG5hbWU6IFwiJGRpc3BsYXlcIiwgZGV0YWlsOiBcIldyaXRlcyB2YWx1ZXMgdG8gdGhlIHNpbXVsYXRvciBvdXRwdXQuXCIgfSxcbiAgeyBuYW1lOiBcIiR3cml0ZVwiLCBkZXRhaWw6IFwiV3JpdGVzIHZhbHVlcyB3aXRob3V0IGEgdHJhaWxpbmcgbmV3bGluZS5cIiB9LFxuICB7IG5hbWU6IFwiJG1vbml0b3JcIiwgZGV0YWlsOiBcIlByaW50cyB3aGVuZXZlciBhbnkgbW9uaXRvcmVkIGFyZ3VtZW50IGNoYW5nZXMuXCIgfSxcbiAgeyBuYW1lOiBcIiRmaW5pc2hcIiwgZGV0YWlsOiBcIkVuZHMgdGhlIHNpbXVsYXRpb24uXCIgfSxcbiAgeyBuYW1lOiBcIiRzdG9wXCIsIGRldGFpbDogXCJQYXVzZXMgdGhlIHNpbXVsYXRpb24uXCIgfSxcbiAgeyBuYW1lOiBcIiRmYXRhbFwiLCBkZXRhaWw6IFwiQXNzZXJ0aW9uIGZhaWx1cmUgdGhhdCBlbmRzIHRoZSBzaW11bGF0aW9uLlwiIH0sXG4gIHsgbmFtZTogXCIkZXJyb3JcIiwgZGV0YWlsOiBcIkFzc2VydGlvbiBmYWlsdXJlLlwiIH0sXG4gIHsgbmFtZTogXCIkd2FybmluZ1wiLCBkZXRhaWw6IFwiQXNzZXJ0aW9uIHdhcm5pbmcuXCIgfSxcbiAgeyBuYW1lOiBcIiRpbmZvXCIsIGRldGFpbDogXCJJbmZvcm1hdGlvbmFsIGFzc2VydGlvbiBtZXNzYWdlLlwiIH0sXG4gIHsgbmFtZTogXCIkYXNzZXJ0a2lsbFwiLCBkZXRhaWw6IFwiRW5kcyB0aGUgc2ltdWxhdGlvbiBvbiBmYWlsdXJlLlwiIH0sXG4gIHsgbmFtZTogXCIkc2Zvcm1hdGZcIiwgZGV0YWlsOiBcIkZvcm1hdHMgYXJndW1lbnRzIGludG8gYSBzdHJpbmcuXCIgfSxcbiAgeyBuYW1lOiBcIiR0eXBlbmFtZVwiLCBkZXRhaWw6IFwiUmV0dXJucyB0aGUgdHlwZSBuYW1lIG9mIGFuIGV4cHJlc3Npb24uXCIgfSxcbl07XG5cbi8qKiBTbmlwcGV0IHRlbXBsYXRlcyBmb3IgY29tbW9uIFJUTCBzY2FmZm9sZGluZy4gKi9cbmludGVyZmFjZSBTbmlwcGV0IHtcbiAgcmVhZG9ubHkgbGFiZWw6IHN0cmluZztcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGJvZHk6IHN0cmluZyB8IHN0cmluZ1tdO1xuICByZWFkb25seSBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQ7XG59XG5cbmNvbnN0IFNOSVBQRVRTOiBTbmlwcGV0W10gPSBbXG4gIHtcbiAgICBsYWJlbDogXCJhbHdheXNfZmZcIixcbiAgICBkZXRhaWw6IFwiU2VxdWVudGlhbCBibG9jayBkcml2ZW4gYnkgYSBjbG9jayAobm9uLWJsb2NraW5nIGFzc2lnbm1lbnRzKVwiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwiYWx3YXlzX2ZmIEAocG9zZWRnZSAkezE6Y2xrfSAkezI6b3IgbmVnZWRnZSByc3Rfbn0pIGJlZ2luXCIsXG4gICAgICBcIlxcdGlmICghJHszOnJzdF9ufSkgYmVnaW5cIixcbiAgICAgIFwiXFx0XFx0JDRcIixcbiAgICAgIFwiXFx0ZW5kIGVsc2UgYmVnaW5cIixcbiAgICAgIFwiXFx0XFx0JDBcIixcbiAgICAgIFwiXFx0ZW5kXCIsXG4gICAgICBcImVuZFwiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJhbHdheXNfZmZfc2ltcGxlXCIsXG4gICAgZGV0YWlsOiBcIlNlcXVlbnRpYWwgYmxvY2ssIGNsb2NrIG9ubHksIG5vIHJlc2V0XCIsXG4gICAgYm9keTogW1wiYWx3YXlzX2ZmIEAocG9zZWRnZSAkezE6Y2xrfSkgYmVnaW5cIiwgXCJcXHQkMFwiLCBcImVuZFwiXSxcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuU25pcHBldCxcbiAgfSxcbiAge1xuICAgIGxhYmVsOiBcImFsd2F5c19jb21iXCIsXG4gICAgZGV0YWlsOiBcIkNvbWJpbmF0aW9uYWwgYmxvY2tcIixcbiAgICBib2R5OiBbXCJhbHdheXNfY29tYiBiZWdpblwiLCBcIlxcdCQwXCIsIFwiZW5kXCJdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiYWx3YXlzX2xhdGNoXCIsXG4gICAgZGV0YWlsOiBcIkxhdGNoIGJsb2NrIChpbmZlcnMgYSBsYXRjaCB1bmxlc3MgZXZlcnkgcGF0aCBhc3NpZ25zKVwiLFxuICAgIGJvZHk6IFtcImFsd2F5c19sYXRjaCBiZWdpblwiLCBcIlxcdCQwXCIsIFwiZW5kXCJdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiYWx3YXlzX2Jsb2NrXCIsXG4gICAgZGV0YWlsOiBcIlZlcmlsb2ctMjAwMSBzdHlsZSBhbHdheXMgQCgqKVwiLFxuICAgIGJvZHk6IFtcImFsd2F5cyBAKCopIGJlZ2luXCIsIFwiXFx0JDBcIiwgXCJlbmRcIl0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJtb2R1bGVcIixcbiAgICBkZXRhaWw6IFwiTW9kdWxlIHNrZWxldG9uIHdpdGggcGFyYW1ldGVyIGFuZCBwb3J0IGxpc3RzXCIsXG4gICAgYm9keTogW1xuICAgICAgXCJtb2R1bGUgJHsxOm5hbWV9ICMoJHsyOnBhcmFtZXRlciBpbnQgVyA9IDh9KSAoXCIsXG4gICAgICBcIlxcdGlucHV0ICB3aXJlICAgICAgICAgICAgJHszOmNsa30sXCIsXG4gICAgICBcIlxcdGlucHV0ICB3aXJlICAgICAgICAgICAgJHs0OnJzdF9ufVwiLFxuICAgICAgXCIpO1wiLFxuICAgICAgXCJcIixcbiAgICAgIFwiXFx0JDBcIixcbiAgICAgIFwiXCIsXG4gICAgICBcImVuZG1vZHVsZVwiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLk1vZHVsZSxcbiAgfSxcbiAge1xuICAgIGxhYmVsOiBcImludGVyZmFjZVwiLFxuICAgIGRldGFpbDogXCJJbnRlcmZhY2Ugc2tlbGV0b25cIixcbiAgICBib2R5OiBbXG4gICAgICBcImludGVyZmFjZSAkMV9pZiAjKHBhcmFtZXRlciAkezI6aW50fSAkezM6V0lEVEh9ID0gJHs0OjMyfSkgKFwiLFxuICAgICAgXCJcXHRpbnB1dCB3aXJlICR7NTpjbGt9XCIsXG4gICAgICBcIik7XCIsXG4gICAgICBcIlwiLFxuICAgICAgXCJcXHQkMFwiLFxuICAgICAgXCJcIixcbiAgICAgIFwiZW5kaW50ZXJmYWNlXCIsXG4gICAgXSxcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuSW50ZXJmYWNlLFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwicGFja2FnZVwiLFxuICAgIGRldGFpbDogXCJQYWNrYWdlIHNrZWxldG9uXCIsXG4gICAgYm9keTogW1wicGFja2FnZSAkMV9wa2c7XCIsIFwiXCIsIFwiXFx0JDBcIiwgXCJcIiwgXCJlbmRwYWNrYWdlXCJdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5Nb2R1bGUsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJ0eXBlZGVmX3N0cnVjdFwiLFxuICAgIGRldGFpbDogXCJQYWNrZWQgdHlwZWRlZiBzdHJ1Y3RcIixcbiAgICBib2R5OiBbXG4gICAgICBcInR5cGVkZWYgc3RydWN0IHBhY2tlZCB7XCIsXG4gICAgICBcIlxcdGxvZ2ljIFskezE6N306MF0gJHsyOmZpZWxkfTtcIixcbiAgICAgIFwifSAkezM6bXlfc3RydWN0fTtcIixcbiAgICBdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwidHlwZWRlZl9lbnVtXCIsXG4gICAgZGV0YWlsOiBcIlR5cGVkZWYgZW51bSB3aXRoIGV4cGxpY2l0IHZhbHVlc1wiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwidHlwZWRlZiBlbnVtIGxvZ2ljIFskezE6MX06MF0ge1wiLFxuICAgICAgXCJcXHQkezI6SURMRX0gPSAyJ2IwMCxcIixcbiAgICAgIFwiXFx0JHszOlJVTn0gID0gMidiMDEsXCIsXG4gICAgICBcIlxcdCR7NDpET05FfSA9IDInYjEwXCIsXG4gICAgICBcIn0gJHs1Om15X2VudW19O1wiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJmdW5jdGlvblwiLFxuICAgIGRldGFpbDogXCJBdXRvbWF0aWMgZnVuY3Rpb25cIixcbiAgICBib2R5OiBbXG4gICAgICBcImZ1bmN0aW9uIGF1dG9tYXRpYyAkezE6bG9naWN9IFskezI6MzF9OjBdICR7MzpteV9mdW5jfShpbnB1dCBsb2dpYyBbJHsyOjMxfTowXSAkezQ6YXJnfSk7XCIsXG4gICAgICBcIlxcdCQwXCIsXG4gICAgICBcImVuZGZ1bmN0aW9uXCIsXG4gICAgXSxcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuRnVuY3Rpb24sXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJ0YXNrXCIsXG4gICAgZGV0YWlsOiBcIkF1dG9tYXRpYyB0YXNrXCIsXG4gICAgYm9keTogW1widGFzayBhdXRvbWF0aWMgJHsxOm15X3Rhc2t9KGlucHV0IGxvZ2ljICR7Mjphcmd9KTtcIiwgXCJcXHQkMFwiLCBcImVuZHRhc2tcIl0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLkZ1bmN0aW9uLFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiZ2VuZXJhdGVfZm9yXCIsXG4gICAgZGV0YWlsOiBcIkdlbmVyYXRlIGZvciBsb29wXCIsXG4gICAgYm9keTogW1xuICAgICAgXCJnZW52YXIgJHsxOml9O1wiLFxuICAgICAgXCJnZW5lcmF0ZVwiLFxuICAgICAgXCJcXHRmb3IgKCR7MTppfSA9IDA7ICR7MTppfSA8ICR7MjpOfTsgJHsxOml9KyspIGJlZ2luIDogZ2VuXyQxXCIsXG4gICAgICBcIlxcdFxcdCQwXCIsXG4gICAgICBcIlxcdGVuZFwiLFxuICAgICAgXCJlbmRnZW5lcmF0ZVwiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJpZl9nZW5lcmF0ZVwiLFxuICAgIGRldGFpbDogXCJDb25kaXRpb25hbCBnZW5lcmF0ZVwiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwiZ2VuZXJhdGVcIixcbiAgICAgIFwiXFx0aWYgKCR7MTpDT05EfSkgYmVnaW4gOiBnZW5fJDFcIixcbiAgICAgIFwiXFx0XFx0JDBcIixcbiAgICAgIFwiXFx0ZW5kIGVsc2UgYmVnaW4gOiBnZW5fZWxzZVwiLFxuICAgICAgXCJcXHRlbmRcIixcbiAgICAgIFwiZW5kZ2VuZXJhdGVcIixcbiAgICBdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiYXNzZXJ0X3Byb3BlcnR5XCIsXG4gICAgZGV0YWlsOiBcIkltbWVkaWF0ZS1zdHlsZSBjb25jdXJyZW50IGFzc2VydGlvbiBwcm9wZXJ0eVwiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwicHJvcGVydHkgJHsxOnBfbmFtZX07XCIsXG4gICAgICBcIlxcdEAocG9zZWRnZSAkezI6Y2xrfSkgJHszOmV4cHJ9IHwtPiAkezQ6ZXhwcjJ9O1wiLFxuICAgICAgXCJlbmRwcm9wZXJ0eVwiLFxuICAgICAgXCJhc3NlcnQgcHJvcGVydHkgKCR7MTpwX25hbWV9KSBlbHNlICRlcnJvcihcXFwiJHs1OmFzc2VydGlvbiBmYWlsZWR9XFxcIik7XCIsXG4gICAgXSxcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuU25pcHBldCxcbiAgfSxcbiAge1xuICAgIGxhYmVsOiBcInN2YV9hc3NlcnRcIixcbiAgICBkZXRhaWw6IFwiU2ltcGxlIGNvbmN1cnJlbnQgYXNzZXJ0aW9uXCIsXG4gICAgYm9keTogW1wiYXNzZXJ0IHByb3BlcnR5IChAKHBvc2VkZ2UgJHsxOmNsa30pICR7MjpleHByfSB8PT4gJHszOmV4cHIyfSk7XCJdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiY292ZXJfcHJvcGVydHlcIixcbiAgICBkZXRhaWw6IFwiQ29uY3VycmVudCBjb3ZlciBwb2ludFwiLFxuICAgIGJvZHk6IFtcImNvdmVyIHByb3BlcnR5IChAKHBvc2VkZ2UgJHsxOmNsa30pICR7MjpleHByfSk7XCJdLFxuICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5TbmlwcGV0LFxuICB9LFxuICB7XG4gICAgbGFiZWw6IFwiaW1tZWRpYXRlX2Fzc2VydFwiLFxuICAgIGRldGFpbDogXCJJbW1lZGlhdGUgYXNzZXJ0aW9uXCIsXG4gICAgYm9keTogW1wiYXNzZXJ0ICgkezE6ZXhwcn0pIGVsc2UgJGVycm9yKFxcXCIkezI6bWVzc2FnZX1cXFwiKTtcIl0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJjb3Zlcmdyb3VwXCIsXG4gICAgZGV0YWlsOiBcIkZ1bmN0aW9uYWwgY292ZXJhZ2UgY292ZXJncm91cFwiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwiY292ZXJncm91cCAkezE6Y2d9X2NvdiBAKHBvc2VkZ2UgJHsyOmNsa30pO1wiLFxuICAgICAgXCJcXHQkezM6Y3B9OiBjb3ZlcnBvaW50ICR7NDpleHByfSB7XCIsXG4gICAgICBcIlxcdFxcdGJpbnMgbG93ICA9IHswfTtcIixcbiAgICAgIFwiXFx0XFx0YmlucyBoaWdoID0ge1sxOiRdfTtcIixcbiAgICAgIFwiXFx0fVwiLFxuICAgICAgXCJlbmRncm91cFwiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJjbG9ja2luZ19ibG9ja1wiLFxuICAgIGRldGFpbDogXCJDbG9ja2luZyBibG9jayBmb3IgdGVzdGJlbmNoIHN5bmNocm9uaXNhdGlvblwiLFxuICAgIGJvZHk6IFtcbiAgICAgIFwiY2xvY2tpbmcgJHsxOmNifV9jbGsgQChwb3NlZGdlICR7MjpjbGt9KTtcIixcbiAgICAgIFwiXFx0ZGVmYXVsdCBpbnB1dCAjMXN0ZXAgb3V0cHV0ICMxbnM7XCIsXG4gICAgICBcIlxcdGlucHV0ICR7MzpzaWduYWx9O1wiLFxuICAgICAgXCJlbmRjbG9ja2luZ1wiLFxuICAgIF0sXG4gICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLlNuaXBwZXQsXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogXCJjbGFzc1wiLFxuICAgIGRldGFpbDogXCJDbGFzcyBza2VsZXRvblwiLFxuICAgIGJvZHk6IFtcImNsYXNzICR7MTpteV9jbGFzc30kezI6IGV4dGVuZHMgYmFzZX07XCIsIFwiXFx0JDBcIiwgXCJlbmRjbGFzc1wiXSxcbiAgICBraW5kOiBDb21wbGV0aW9uSXRlbUtpbmQuQ2xhc3MsXG4gIH0sXG5dO1xuXG4vKipcbiAqIEJ1aWxkcyB0aGUgc3RhdGljIChub24tY29udGV4dHVhbCkgcG9ydGlvbiBvZiB0aGUgY29tcGxldGlvbiBsaXN0LlxuICpcbiAqIFdvcmRzIGFwcGVhciBpbiBtb3JlIHRoYW4gb25lIGdyb3VwIHNvIHRoZSBmaWxlIHN0YXlzIHJlYWRhYmxlLCBzbyB0aGUgcmVzdWx0XG4gKiBpcyBkZWR1cGxpY2F0ZWQuIEVudHJpZXMgYXJlIGFkZGVkIGluIHByaW9yaXR5IG9yZGVyLCBoaWdoZXN0IGZpcnN0LCBiZWNhdXNlXG4gKiBzb21lIHNuaXBwZXQgbGFiZWxzIGNvaW5jaWRlIHdpdGgga2V5d29yZHMgKGBtb2R1bGVgLCBgaW50ZXJmYWNlYCwgLi4uKSBhbmRcbiAqIHRoZSBzbmlwcGV0IGlzIHRoZSBtb3JlIHVzZWZ1bCBvZiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdGljQ29tcGxldGlvbkl0ZW1zKG9wdGlvbnM6IHtcbiAgc25pcHBldHM6IGJvb2xlYW47XG4gIHN5c3RlbUZ1bmN0aW9uczogYm9vbGVhbjtcbn0pOiBDb21wbGV0aW9uSXRlbVtdIHtcbiAgY29uc3QgaXRlbXM6IENvbXBsZXRpb25JdGVtW10gPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0IHB1c2ggPSAoaXRlbTogQ29tcGxldGlvbkl0ZW0pOiB2b2lkID0+IHtcbiAgICBpZiAoc2Vlbi5oYXMoaXRlbS5sYWJlbCkpIHJldHVybjtcbiAgICBzZWVuLmFkZChpdGVtLmxhYmVsKTtcbiAgICBpdGVtcy5wdXNoKGl0ZW0pO1xuICB9O1xuXG4gIGlmIChvcHRpb25zLnNuaXBwZXRzKSB7XG4gICAgZm9yIChjb25zdCBzbmlwcGV0IG9mIFNOSVBQRVRTKSB7XG4gICAgICBwdXNoKHtcbiAgICAgICAgbGFiZWw6IHNuaXBwZXQubGFiZWwsXG4gICAgICAgIGtpbmQ6IHNuaXBwZXQua2luZCxcbiAgICAgICAgZGV0YWlsOiBzbmlwcGV0LmRldGFpbCxcbiAgICAgICAgaW5zZXJ0VGV4dDogQXJyYXkuaXNBcnJheShzbmlwcGV0LmJvZHkpID8gc25pcHBldC5ib2R5LmpvaW4oXCJcXG5cIikgOiBzbmlwcGV0LmJvZHksXG4gICAgICAgIGluc2VydFRleHRGb3JtYXQ6IEluc2VydFRleHRGb3JtYXQuU25pcHBldCxcbiAgICAgICAgc29ydFRleHQ6IGA1fCR7c25pcHBldC5sYWJlbH1gLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG9wdGlvbnMuc3lzdGVtRnVuY3Rpb25zKSB7XG4gICAgZm9yIChjb25zdCBmbiBvZiBTWVNURU1fRlVOQ1RJT05TKSB7XG4gICAgICBwdXNoKHtcbiAgICAgICAgbGFiZWw6IGZuLm5hbWUsXG4gICAgICAgIGtpbmQ6IENvbXBsZXRpb25JdGVtS2luZC5GdW5jdGlvbixcbiAgICAgICAgZGV0YWlsOiBmbi5kZXRhaWwsXG4gICAgICAgIHNvcnRUZXh0OiBgNnwke2ZuLm5hbWV9YCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgbWFjcm8gb2YgRElSRUNUSVZFUykge1xuICAgIHB1c2goe1xuICAgICAgbGFiZWw6IG1hY3JvLFxuICAgICAga2luZDogQ29tcGxldGlvbkl0ZW1LaW5kLkNvbnN0YW50LFxuICAgICAgZGV0YWlsOiBcIkNvbXBpbGVyIGRpcmVjdGl2ZVwiLFxuICAgICAgc29ydFRleHQ6IGA3fCR7bWFjcm99YCxcbiAgICB9KTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZ3JvdXAgb2YgS0VZV09SRF9HUk9VUFMpIHtcbiAgICBmb3IgKGNvbnN0IHdvcmQgb2YgZ3JvdXAud29yZHMpIHtcbiAgICAgIHB1c2goeyBsYWJlbDogd29yZCwga2luZDogZ3JvdXAua2luZCwgZGV0YWlsOiBcIlN5c3RlbVZlcmlsb2cga2V5d29yZFwiLCBzb3J0VGV4dDogYDh8JHt3b3JkfWAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGl0ZW1zO1xufSIsICJpbXBvcnQgdHlwZSB7IFRleHREb2N1bWVudCB9IGZyb20gXCJ2c2NvZGUtbGFuZ3VhZ2VzZXJ2ZXItdGV4dGRvY3VtZW50XCI7XG5pbXBvcnQgdHlwZSB7IFNpZ25hdHVyZUhlbHAgfSBmcm9tIFwidnNjb2RlLWxhbmd1YWdlc2VydmVyLXR5cGVzXCI7XG5pbXBvcnQgdHlwZSB7IENhdGFsb2cgfSBmcm9tIFwiLi9jYXRhbG9nLmpzXCI7XG5pbXBvcnQgdHlwZSB7IEFuYWx5c2lzLCBIZGxTeW1ib2wgfSBmcm9tIFwiLi9tb2RlbC5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2ZVN5bWJvbCwgc2NvcGVDaGFpbiB9IGZyb20gXCIuL21vZGVsLmpzXCI7XG5pbXBvcnQgeyBpbXBvcnRlZE1lbWJlciwgaW5jbHVkZWREZWNsYXJhdGlvbiB9IGZyb20gXCIuL2ltcG9ydHMuanNcIjtcbmltcG9ydCB7IGludGVyZmFjZU9mVHlwZSB9IGZyb20gXCIuL2hpZXJhcmNoeS5qc1wiO1xuaW1wb3J0IHR5cGUgeyBJbmNsdWRlUmVzb2x2ZXIgfSBmcm9tIFwiLi9pbmNsdWRlcy5qc1wiO1xuaW1wb3J0IHsgYXJndW1lbnRMYWJlbCwgY2FsbGFibGVMYWJlbCB9IGZyb20gXCIuL3N5bWJvbEZvcm1hdHRpbmcuanNcIjtcbmV4cG9ydCB7IGNhbGxhYmxlTGFiZWwgfSBmcm9tIFwiLi9zeW1ib2xGb3JtYXR0aW5nLmpzXCI7XG5cbi8qKiBSZXNvbHZlIHRoZSBzYW1lIHJvdXRpbmUgZm9yIGNvbXBsZXRpb24sIHBvc2l0aW9uYWwgY2FsbHMgYW5kIG5hbWVkIGNhbGxzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVDYWxsYWJsZShuYW1lOiBzdHJpbmcsIGFuYWx5c2lzOiBBbmFseXNpcywgY2F0YWxvZzogQ2F0YWxvZywgb2Zmc2V0OiBudW1iZXIsIHVyaTogc3RyaW5nLCBpbmNsdWRlcz86IEluY2x1ZGVSZXNvbHZlcik6IEhkbFN5bWJvbCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhcnRzID0gbmFtZS5zcGxpdCgvOjp8XFwuLyk7XG4gIGNvbnN0IGxhc3QgPSBwYXJ0cy5wb3AoKSE7XG4gIGxldCBzeW1ib2w6IEhkbFN5bWJvbCB8IHVuZGVmaW5lZDtcbiAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHN5bWJvbCA9IHJlc29sdmVTeW1ib2woYW5hbHlzaXMsIGxhc3QsIG9mZnNldCkgPz8gaW1wb3J0ZWRNZW1iZXIoYW5hbHlzaXMsIGNhdGFsb2csIG9mZnNldCwgbGFzdCk/LnN5bWJvbCA/P1xuICAgICAgKGluY2x1ZGVzID8gaW5jbHVkZWREZWNsYXJhdGlvbih1cmksIGNhdGFsb2csIGluY2x1ZGVzLCBsYXN0KT8uc3ltYm9sIDogdW5kZWZpbmVkKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCByb290ID0gcGFydHMuc2hpZnQoKSE7XG4gICAgY29uc3QgbG9jYWwgPSByZXNvbHZlU3ltYm9sKGFuYWx5c2lzLCByb290LCBvZmZzZXQpID8/IGltcG9ydGVkTWVtYmVyKGFuYWx5c2lzLCBjYXRhbG9nLCBvZmZzZXQsIHJvb3QpPy5zeW1ib2w7XG4gICAgY29uc3QgaW5zdGFuY2UgPSBzY29wZUNoYWluKGFuYWx5c2lzLCBvZmZzZXQpLmZsYXRNYXAoKHMpID0+IHMuaW5zdGFuY2VzKS5maW5kKChpKSA9PiBpLmluc3RhbmNlTmFtZSA9PT0gcm9vdCk7XG4gICAgbGV0IGVudHJ5ID0gbG9jYWw/LmhhbmRsZU9mID8gY2F0YWxvZy5yZXNvbHZlKGxvY2FsLmhhbmRsZU9mKSA6XG4gICAgICBsb2NhbCA/IGludGVyZmFjZU9mVHlwZShsb2NhbC50eXBlVGV4dCwgY2F0YWxvZykgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHJvb3QgPT09IFwidGhpc1wiIHx8IHJvb3QgPT09IFwic3VwZXJcIikge1xuICAgICAgY29uc3QgY2hhaW4gPSBzY29wZUNoYWluKGFuYWx5c2lzLCBvZmZzZXQpO1xuICAgICAgY29uc3Qgb3duZXIgPSBjaGFpbi5maW5kKChzKSA9PiBzLm93bmVyQ2xhc3MpPy5vd25lckNsYXNzID8/IGNoYWluLmZpbmQoKHMpID0+IHMuY2F0ZWdvcnkgPT09IFwiY2xhc3NcIik/Lm5hbWU7XG4gICAgICBlbnRyeSA9IG93bmVyID8gY2F0YWxvZy5yZXNvbHZlKG93bmVyKSA6IHVuZGVmaW5lZDtcbiAgICAgIGlmIChyb290ID09PSBcInN1cGVyXCIpIGVudHJ5ID0gZW50cnk/LmJhc2VDbGFzcyA/IGNhdGFsb2cucmVzb2x2ZShlbnRyeS5iYXNlQ2xhc3MpIDogdW5kZWZpbmVkO1xuICAgIH1cbiAgICBlbnRyeSA/Pz0gY2F0YWxvZy5yZXNvbHZlKGluc3RhbmNlPy50eXBlTmFtZSA/PyByb290KTtcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgIGNvbnN0IG5lc3RlZCA9IGVudHJ5Py5pbnN0YW5jZXMuZmluZCgoaSkgPT4gaS5pbnN0YW5jZU5hbWUgPT09IHBhcnQpO1xuICAgICAgY29uc3QgbWVtYmVyID0gZW50cnk/LnN5bWJvbHMuZmluZCgocykgPT4gcy5uYW1lID09PSBwYXJ0KTtcbiAgICAgIGVudHJ5ID0gbmVzdGVkID8gY2F0YWxvZy5yZXNvbHZlKG5lc3RlZC50eXBlTmFtZSkgOiBtZW1iZXI/LmhhbmRsZU9mID8gY2F0YWxvZy5yZXNvbHZlKG1lbWJlci5oYW5kbGVPZikgOlxuICAgICAgICBtZW1iZXIgPyBpbnRlcmZhY2VPZlR5cGUobWVtYmVyLnR5cGVUZXh0LCBjYXRhbG9nKSA6IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKGVudHJ5KSBzeW1ib2wgPSAoZW50cnkua2luZCA9PT0gXCJjbGFzc1wiID8gY2F0YWxvZy5jbGFzc01lbWJlcnMoZW50cnkubmFtZSkgOiBlbnRyeS5zeW1ib2xzKS5maW5kKChzKSA9PiBzLm5hbWUgPT09IGxhc3QpO1xuICB9XG4gIHJldHVybiBzeW1ib2wgJiYgKHN5bWJvbC5jYXRlZ29yeSA9PT0gXCJmdW5jdGlvblwiIHx8IHN5bWJvbC5jYXRlZ29yeSA9PT0gXCJ0YXNrXCIpID8gc3ltYm9sIDogdW5kZWZpbmVkO1xufVxuXG4vKiogU3RhY2stYmFzZWQgc2Nhbm5lcjogY29tbWFzIGluIG5lc3RlZCBjYWxscywgc3RyaW5ncyBhbmQgc2VsZWN0cyBkbyBub3QgYWR2YW5jZSB0aGUgYXJndW1lbnQuICovXG5leHBvcnQgZnVuY3Rpb24gY2FsbEF0KHRleHQ6IHN0cmluZywgb2Zmc2V0OiBudW1iZXIpOiB7IG5hbWU6IHN0cmluZzsgYXJndW1lbnQ6IG51bWJlcjsgbmFtZWQ/OiBzdHJpbmcgfSB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHN0YWNrOiB7IGNoYXI6IHN0cmluZzsgc3RhcnQ6IG51bWJlcjsgYXJndW1lbnQ6IG51bWJlcjsgYXJnU3RhcnQ6IG51bWJlciB9W10gPSBbXTtcbiAgbGV0IHN0cmluZyA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG9mZnNldDsgaSsrKSB7XG4gICAgY29uc3QgY2hhciA9IHRleHRbaV07XG4gICAgaWYgKHN0cmluZykge1xuICAgICAgaWYgKGNoYXIgPT09IFwiXFxcXFwiKSBpKys7XG4gICAgICBlbHNlIGlmIChjaGFyID09PSAnXCInKSBzdHJpbmcgPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2hhciA9PT0gJ1wiJykgeyBzdHJpbmcgPSB0cnVlOyBjb250aW51ZTsgfVxuICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiB0ZXh0W2kgKyAxXSA9PT0gXCIvXCIpIHsgd2hpbGUgKGkgPCBvZmZzZXQgJiYgdGV4dFtpXSAhPT0gXCJcXG5cIikgaSsrOyBjb250aW51ZTsgfVxuICAgIGlmIChjaGFyID09PSBcIi9cIiAmJiB0ZXh0W2kgKyAxXSA9PT0gXCIqXCIpIHsgaSArPSAyOyB3aGlsZSAoaSA8IG9mZnNldCAmJiAhKHRleHRbaV0gPT09IFwiKlwiICYmIHRleHRbaSArIDFdID09PSBcIi9cIikpIGkrKzsgaSsrOyBjb250aW51ZTsgfVxuICAgIGlmIChjaGFyID09PSBcIihcIiB8fCBjaGFyID09PSBcIltcIiB8fCBjaGFyID09PSBcIntcIikgc3RhY2sucHVzaCh7IGNoYXIsIHN0YXJ0OiBpLCBhcmd1bWVudDogMCwgYXJnU3RhcnQ6IGkgKyAxIH0pO1xuICAgIGVsc2UgaWYgKGNoYXIgPT09IFwiKVwiIHx8IGNoYXIgPT09IFwiXVwiIHx8IGNoYXIgPT09IFwifVwiKSBzdGFjay5wb3AoKTtcbiAgICBlbHNlIGlmIChjaGFyID09PSBcIixcIiAmJiBzdGFjay5sZW5ndGgpIHtcbiAgICAgIGNvbnN0IHRvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdITtcbiAgICAgIHRvcC5hcmd1bWVudCsrO1xuICAgICAgdG9wLmFyZ1N0YXJ0ID0gaSArIDE7XG4gICAgfVxuICB9XG4gIGZvciAobGV0IGkgPSBzdGFjay5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IGZyYW1lID0gc3RhY2tbaV0hO1xuICAgIGlmIChmcmFtZS5jaGFyICE9PSBcIihcIikgY29udGludWU7XG4gICAgY29uc3QgbWF0Y2ggPSAvKFtBLVphLXpfXVxcdyooPzooPzo6OnxcXC4pW0EtWmEtel9dXFx3KikqKVxccyokLy5leGVjKHRleHQuc2xpY2UoMCwgZnJhbWUuc3RhcnQpKTtcbiAgICBpZiAoIW1hdGNoIHx8IHRleHRbZnJhbWUuc3RhcnQgLSBtYXRjaFswXS5sZW5ndGggLSAxXSA9PT0gXCIuXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG5hbWVkID0gL15cXHMqXFwuKFtBLVphLXpfXVxcdyopLy5leGVjKHRleHQuc2xpY2UoZnJhbWUuYXJnU3RhcnQsIG9mZnNldCkpPy5bMV07XG4gICAgcmV0dXJuIHsgbmFtZTogbWF0Y2hbMV0hLCBhcmd1bWVudDogZnJhbWUuYXJndW1lbnQsIG5hbWVkIH07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3ZpZGVTaWduYXR1cmVIZWxwKGRvY3VtZW50OiBUZXh0RG9jdW1lbnQsIGFuYWx5c2lzOiBBbmFseXNpcywgY2F0YWxvZzogQ2F0YWxvZywgb2Zmc2V0OiBudW1iZXIsIGluY2x1ZGVzPzogSW5jbHVkZVJlc29sdmVyKTogU2lnbmF0dXJlSGVscCB8IG51bGwge1xuICBjb25zdCBjYWxsID0gY2FsbEF0KGRvY3VtZW50LmdldFRleHQoKSwgb2Zmc2V0KTtcbiAgaWYgKCFjYWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgcm91dGluZSA9IHJlc29sdmVDYWxsYWJsZShjYWxsLm5hbWUsIGFuYWx5c2lzLCBjYXRhbG9nLCBvZmZzZXQsIGRvY3VtZW50LnVyaSwgaW5jbHVkZXMpO1xuICBpZiAoIXJvdXRpbmUpIHJldHVybiBudWxsO1xuICBjb25zdCBhcmdzID0gcm91dGluZS5hcmd1bWVudHMgPz8gW107XG4gIGNvbnN0IG5hbWVkSW5kZXggPSBjYWxsLm5hbWVkID8gYXJncy5maW5kSW5kZXgoKGEpID0+IGEubmFtZSA9PT0gY2FsbC5uYW1lZCkgOiAtMTtcbiAgcmV0dXJuIHtcbiAgICBzaWduYXR1cmVzOiBbeyBsYWJlbDogY2FsbGFibGVMYWJlbChyb3V0aW5lKSwgcGFyYW1ldGVyczogYXJncy5tYXAoKGFyZykgPT4gKHsgbGFiZWw6IGFyZ3VtZW50TGFiZWwoYXJnKSwgZG9jdW1lbnRhdGlvbjogYXJnLmRvYyB9KSkgfV0sXG4gICAgYWN0aXZlU2lnbmF0dXJlOiAwLFxuICAgIGFjdGl2ZVBhcmFtZXRlcjogTWF0aC5tYXgoMCwgTWF0aC5taW4obmFtZWRJbmRleCA+PSAwID8gbmFtZWRJbmRleCA6IGNhbGwuYXJndW1lbnQsIGFyZ3MubGVuZ3RoIC0gMSkpLFxuICB9O1xufVxuIiwgImltcG9ydCB7XG4gIERpYWdub3N0aWNTZXZlcml0eSxcbiAgdHlwZSBEaWFnbm9zdGljLFxuICB0eXBlIFJhbmdlLFxuICB0eXBlIFRleHREb2N1bWVudCxcbn0gZnJvbSBcInZzY29kZS1sYW5ndWFnZXNlcnZlci10eXBlc1wiO1xuaW1wb3J0IHR5cGUgeyBOb2RlIH0gZnJvbSBcIndlYi10cmVlLXNpdHRlclwiO1xuXG5pbXBvcnQgeyB3aWR0aE9mLCB0eXBlIEV2YWxFbnYgfSBmcm9tIFwiLi4vZXZhbC5qc1wiO1xuaW1wb3J0IHsgc2NvcGVDaGFpbiwgdmlzaWJsZVN5bWJvbHMsIHR5cGUgQW5hbHlzaXMgfSBmcm9tIFwiLi4vbW9kZWwuanNcIjtcbmltcG9ydCB7IGVuY2xvc2luZ1JlZmVyZW5jZSwgcmVzb2x2ZVBhdGggfSBmcm9tIFwiLi4vaGllcmFyY2h5LmpzXCI7XG5pbXBvcnQgeyBpbXBvcnRlZE1lbWJlciwgaW5jbHVkZWREZWNsYXJhdGlvbnMsIHR5cGUgSW5jbHVkZWREZWNsYXJhdGlvbiB9IGZyb20gXCIuLi9pbXBvcnRzLmpzXCI7XG5pbXBvcnQgdHlwZSB7IENhdGFsb2cgfSBmcm9tIFwiLi4vY2F0YWxvZy5qc1wiO1xuaW1wb3J0IHR5cGUgeyBJbmNsdWRlUmVzb2x2ZXIgfSBmcm9tIFwiLi4vaW5jbHVkZXMuanNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBEaWFnbm9zdGljU2V0dGluZ3Mge1xuICBlbmFibGU6IGJvb2xlYW47XG4gIHVua25vd25JZGVudGlmaWVyczogYm9vbGVhbjtcbiAgd2lkdGhNaXNtYXRjaDogYm9vbGVhbjtcbiAgYmxvY2tpbmdJblNlcXVlbnRpYWw6IGJvb2xlYW47XG4gIGltcGxpY2l0U2Vuc2l0aXZpdHk6IGJvb2xlYW47XG4gIGxhdGNoRGV0ZWN0aW9uOiBib29sZWFuO1xufVxuXG4vKiogTmFtZXMgdGhhdCBhcmUgYWx3YXlzIGxlZ2FsIGV2ZW4gdGhvdWdoIG5vdGhpbmcgaW4gdGhlIGZpbGUgZGVjbGFyZXMgdGhlbS4gKi9cbmNvbnN0IEJVSUxUSU5fTkFNRVMgPSBuZXcgU2V0KFtcbiAgXCJ0aGlzXCIsIFwic3VwZXJcIiwgXCJudWxsXCIsIFwicmFuZFwiLCBcInJhbmRjXCIsIFwibG9jYWxcIiwgXCJwcm90ZWN0ZWRcIiwgXCJzdGF0aWNcIixcbiAgXCJhdXRvbWF0aWNcIiwgXCJ2b2lkXCIsIFwiZXJyb3JcIiwgXCJ3YXJuaW5nXCIsIFwiaW5mb1wiLCBcImZhdGFsXCIsIFwiYXNzZXJ0XCIsIFwiY292ZXJcIixcbiAgXCJkZWZhdWx0XCIsIFwiZGlzYWJsZVwiLCBcImZvcmtcIiwgXCJqb2luXCIsIFwiam9pbl9hbnlcIiwgXCJqb2luX25vbmVcIiwgXCJwcm9ncmFtXCIsXG4gIFwidGltZVwiLCBcInN0cmluZ1wiLCBcInJlYWxcIiwgXCJyZWFsdGltZVwiLCBcImludGVnZXJcIiwgXCJnZW52YXJcIiwgXCJlZGdlXCIsXG5dKTtcblxuLyoqIE5vZGVzIGhvbGRpbmcgY29tcGlsZXItZGlyZWN0aXZlIHRleHQsIHdob3NlIGlkZW50aWZpZXJzIGFyZSBtYWNybyBuYW1lcy4gKi9cbmNvbnN0IFBSRVBST0NFU1NPUl9QQVJFTlRTID0gbmV3IFNldChbXG4gIFwidGV4dF9tYWNyb19kZWZpbml0aW9uXCIsXG4gIFwidGV4dF9tYWNyb19uYW1lXCIsXG4gIFwidGV4dF9tYWNyb191c2FnZVwiLFxuICBcImlmZGVmX2NvbmRpdGlvblwiLFxuICBcImVsc2lmX2NvbmRpdGlvblwiLFxuICBcImluY2x1ZGVfZmlsZV9wYXRoXCIsXG4gIC8vIFRoZSBmb3JtYWwgYXJndW1lbnRzIG9mIGEgbWFjcm8gYXJlIG5vdCBzaWduYWxzOiBgTkFNRWAsIGBSQU5HRWAgYW5kXG4gIC8vIGBBU1NJR05NRU5UYCBpbiBgYCBgZGVmaW5lIFRNUihOQU1FLCBSQU5HRSwgQVNTSUdOTUVOVCkgYGAgYXJlIHRoZSBuYW1lc1xuICAvLyB0aGUgbWFjcm8gd2lsbCBzdWJzdGl0dXRlLiBBIG1hY3JvIG9ubHkgYmVjb21lcyBIREwgd2hlbiBzb21lYm9keSBjYWxscyBpdC5cbiAgLy8gVGhlIGdyYW1tYXIgbmVzdHMgZWFjaCBvbmUgdW5kZXIgYGZvcm1hbF9hcmd1bWVudGAsIHNvIGxpc3Rpbmcgb25seSB0aGVcbiAgLy8gZGVmaW5pdGlvbiB3b3VsZCBsZWF2ZSBldmVyeSBvbmUgb2YgdGhlbSByZXBvcnRlZCBhcyB1bmRlY2xhcmVkLlxuICBcIm1hY3JvX3RleHRcIixcbiAgXCJmb3JtYWxfYXJndW1lbnRcIixcbiAgXCJsaXN0X29mX2Zvcm1hbF9hcmd1bWVudHNcIixcbl0pO1xuXG4vKiogQXNzaWdubWVudCBub2RlIHR5cGVzLCBpbiBhbGwgdGhlaXIgc3BlbGxpbmdzLiAqL1xuY29uc3QgQVNTSUdOTUVOVF9UWVBFUyA9IG5ldyBTZXQoW1xuICBcImJsb2NraW5nX2Fzc2lnbm1lbnRcIixcbiAgXCJub25ibG9ja2luZ19hc3NpZ25tZW50XCIsXG4gIFwibmV0X2Fzc2lnbm1lbnRcIixcbiAgXCJvcGVyYXRvcl9hc3NpZ25tZW50XCIsXG5dKTtcblxuLyoqIE5vZGVzIHRoYXQgbWVyZWx5IHdyYXAgYSBuZXN0ZWQgc3RhdGVtZW50LiAqL1xuY29uc3QgU1RBVEVNRU5UX1dSQVBQRVJTID0gbmV3IFNldChbXCJzdGF0ZW1lbnRcIiwgXCJzdGF0ZW1lbnRfaXRlbVwiLCBcInN0YXRlbWVudF9vcl9udWxsXCJdKTtcblxuY29uc3QgU0VWRVJJVFkgPSB7XG4gIGVycm9yOiBEaWFnbm9zdGljU2V2ZXJpdHkuRXJyb3IsXG4gIHdhcm5pbmc6IERpYWdub3N0aWNTZXZlcml0eS5XYXJuaW5nLFxuICBpbmZvOiBEaWFnbm9zdGljU2V2ZXJpdHkuSW5mb3JtYXRpb24sXG4gIGhpbnQ6IERpYWdub3N0aWNTZXZlcml0eS5IaW50LFxufSBhcyBjb25zdDtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVEaWFnbm9zdGljcyhcbiAgZG9jdW1lbnQ6IFRleHREb2N1bWVudCxcbiAgYW5hbHlzaXM6IEFuYWx5c2lzLFxuICBjYXRhbG9nOiBDYXRhbG9nLFxuICBzZXR0aW5nczogRGlhZ25vc3RpY1NldHRpbmdzLFxuICBpbmNsdWRlcz86IEluY2x1ZGVSZXNvbHZlcixcbik6IERpYWdub3N0aWNbXSB7XG4gIGlmICghc2V0dGluZ3MuZW5hYmxlKSByZXR1cm4gW107XG5cbiAgY29uc3QgZGlhZ25vc3RpY3M6IERpYWdub3N0aWNbXSA9IFtdO1xuICBjb25zdCB0cmVlID0gYW5hbHlzaXMucGFyc2VUcmVlO1xuXG4gIC8vIFdoYXQgdGhlIGBgIGBpbmNsdWRlIGBgcyBvZiB0aGlzIGZpbGUgbWFrZSB2aXNpYmxlLCByZWFkIG9uY2UuXG4gIC8vXG4gIC8vIFRoZSB1bmtub3duLWlkZW50aWZpZXIgcnVsZSBydW5zIHBlciBpZGVudGlmaWVyLCBhbmQgd2Fsa2luZyB0aGUgaW5jbHVkZVxuICAvLyBjbG9zdXJlIGVhY2ggdGltZSB3b3VsZCB0dXJuIGEgMjUwLWxpbmUgbW9kdWxlIGludG8gaHVuZHJlZHMgb2YgZmlsZVxuICAvLyBsb29rdXBzLiBPbmUgcGFzcyBvdmVyIHRoZSBjbG9zdXJlIGJlZm9yZSB0aGUgdHJhdmVyc2FsIGlzIHRoZSB3aG9sZSBjb3N0LlxuICBjb25zdCBpbmNsdWRlZCA9IGluY2x1ZGVzXG4gICAgPyBuZXcgTWFwKFxuICAgICAgICBpbmNsdWRlZERlY2xhcmF0aW9ucyhkb2N1bWVudC51cmkudG9TdHJpbmcoKSwgY2F0YWxvZywgaW5jbHVkZXMpLm1hcCgoZW50cnkpID0+IFtcbiAgICAgICAgICBlbnRyeS5zeW1ib2wubmFtZSxcbiAgICAgICAgICBlbnRyeSxcbiAgICAgICAgXSksXG4gICAgICApXG4gICAgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgZW52ID0gYnVpbGRFbnYoYW5hbHlzaXMpO1xuICBjb25zdCBhc3NpZ25lZEluID0gbmV3IE1hcDxudW1iZXIsIFNldDxzdHJpbmc+PigpO1xuXG4gIC8vIE9uZSB0cmF2ZXJzYWwgZm9yIGV2ZXJ5IGNoZWNrLlxuICAvL1xuICAvLyBFYWNoIHJ1bGUgdXNlZCB0byB3YWxrIHRoZSB3aG9sZSB0cmVlIG9uIGl0cyBvd24sIHNvIGEgMjUwLWxpbmUgbW9kdWxlIHdhc1xuICAvLyB3YWxrZWQgc2l4IHRpbWVzIG9uIGV2ZXJ5IGtleXN0cm9rZSAtLSBhbmQgZXZlcnkgbm9kZSB2aXNpdCBjcm9zc2VzIHRoZVxuICAvLyBXQVNNIGJvdW5kYXJ5LiBUaGUgcnVsZXMgb25seSBkaWZmZXIgaW4gd2hpY2ggbm9kZSB0eXBlIHRoZXkgcmVhY3QgdG8sIHNvXG4gIC8vIHRoZXkgcnVuIHRvZ2V0aGVyIGFuZCB0aGUgdHdvIHRoYXQgbmVlZCBhIHN1YnRyZWUgc2VhcmNoIGRlZmVyIHRvIGl0OiB0aGVcbiAgLy8gbmVzdGVkIGxvb3BzIGJlbG93IGNvdmVyIHRoZSBzYW1lIG5vZGVzLCBiZWNhdXNlIGEgbmVzdGVkIG5vZGUgaXMgYWx3YXlzXG4gIC8vIHJlYWNoZWQgYWZ0ZXIgdGhlIGNvbnN0cnVjdCB0aGF0IGNvbnRhaW5zIGl0LlxuICBmb3IgKGNvbnN0IG5vZGUgb2YgaXRlcmF0ZSh0cmVlLnJvb3ROb2RlKSkge1xuICAgIGlmICgobm9kZS50eXBlID09PSBcIkVSUk9SXCIgfHwgbm9kZS5pc01pc3NpbmcpICYmICFjYXVzZWRCeU1hY3JvKG5vZGUpKSB7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKHN5bnRheERpYWdub3N0aWMobm9kZSkpO1xuICAgIH1cblxuICAgIC8vIENvbGxlY3RlZCBiZWZvcmUgdGhlIHJ1bGVzIHRoYXQgbmVlZCBpdCwgc28gYSBsYXRjaCBvciBhIHNlbnNpdGl2aXR5XG4gICAgLy8gZmluZGluZyBzZWVzIGV2ZXJ5IGFzc2lnbm1lbnQgaW4gdGhlIGJsb2NrLCBub3Qgb25seSB0aGUgZWFybGllciBvbmVzLlxuICAgIGlmIChpc1NlcXVlbnRpYWxCbG9jayhub2RlKSB8fCBpc0NvbWJpbmF0aW9uYWwobm9kZSkpIHtcbiAgICAgIGNvbGxlY3RBc3NpZ25tZW50cyhub2RlLCBhc3NpZ25lZEluKTtcbiAgICB9XG5cbiAgICBpZiAoQVNTSUdOTUVOVF9UWVBFUy5oYXMobm9kZS50eXBlKSAmJiBzZXR0aW5ncy53aWR0aE1pc21hdGNoKSB7XG4gICAgICBjb25zdCBkaWFnbm9zdGljID0gd2lkdGhEaWFnbm9zdGljKG5vZGUsIGVudik7XG4gICAgICBpZiAoZGlhZ25vc3RpYykgZGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljKTtcbiAgICB9XG5cbiAgICBpZiAobm9kZS50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgJiYgc2V0dGluZ3MudW5rbm93bklkZW50aWZpZXJzKSB7XG4gICAgICBjb25zdCBkaWFnbm9zdGljID0gdW5rbm93bkRpYWdub3N0aWMoXG4gICAgICAgIGFuYWx5c2lzLFxuICAgICAgICBub2RlLFxuICAgICAgICBjYXRhbG9nLFxuICAgICAgICBkb2N1bWVudC51cmkudG9TdHJpbmcoKSxcbiAgICAgICAgaW5jbHVkZWQsXG4gICAgICApO1xuICAgICAgaWYgKGRpYWdub3N0aWMpIGRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gICAgfVxuXG4gICAgaWYgKHNldHRpbmdzLmJsb2NraW5nSW5TZXF1ZW50aWFsICYmIGlzU2VxdWVudGlhbEJsb2NrKG5vZGUpKSB7XG4gICAgICBjb25zdCBpbm5lciA9IGZpcnN0QmxvY2tpbmdBc3NpZ25tZW50KG5vZGUpO1xuICAgICAgaWYgKGlubmVyKSB7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goe1xuICAgICAgICAgIHNldmVyaXR5OiBTRVZFUklUWS53YXJuaW5nLFxuICAgICAgICAgIHJhbmdlOiBub2RlUmFuZ2UoaW5uZXIpLFxuICAgICAgICAgIG1lc3NhZ2U6XG4gICAgICAgICAgICBcIkJsb2NraW5nIGFzc2lnbm1lbnQgKD0pIGluc2lkZSBhbHdheXNfZmYgaW5mZXJzIHJhY2UtcHJvbmUgbG9naWM7IHVzZSBub24tYmxvY2tpbmcgKDw9KS5cIixcbiAgICAgICAgICBzb3VyY2U6IFwic3Zpc2lvblwiLFxuICAgICAgICAgIGNvZGU6IFwic2VxdWVudGlhbC1ibG9ja2luZ1wiLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc2V0dGluZ3MuaW1wbGljaXRTZW5zaXRpdml0eSAmJiBub2RlLnR5cGUgPT09IFwiYWx3YXlzX2NvbnN0cnVjdFwiKSB7XG4gICAgICBjb25zdCBkaWFnbm9zdGljID0gc2Vuc2l0aXZpdHlEaWFnbm9zdGljKG5vZGUpO1xuICAgICAgaWYgKGRpYWdub3N0aWMpIGRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gICAgfVxuXG4gICAgaWYgKHNldHRpbmdzLmxhdGNoRGV0ZWN0aW9uICYmIGlzQ29tYmluYXRpb25hbChub2RlKSkge1xuICAgICAgZGlhZ25vc3RpY3MucHVzaCguLi5sYXRjaERpYWdub3N0aWNzKG5vZGUsIGFzc2lnbmVkSW4pKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZGVkdXBlRGlhZ25vc3RpY3MoZGlhZ25vc3RpY3MpO1xufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogQXNzaWdubWVudCBoZWxwZXJzXG4gKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLyoqXG4gKiBUaGUgbHZhbHVlIGFuZCByaWdodC1oYW5kIHNpZGUgb2YgYW4gYXNzaWdubWVudC5cbiAqXG4gKiBOb25lIG9mIHRoZSBhc3NpZ25tZW50IG5vZGUgdHlwZXMgY2FycnkgTFNQLXN0eWxlIGZpZWxkcyBpbiB0aGlzIGdyYW1tYXIsIHNvXG4gKiB0aGUgb3BlcmFuZHMgYXJlIHRha2VuIHBvc2l0aW9uYWxseTogYGJsb2NraW5nX2Fzc2lnbm1lbnRgIHdyYXBzIGFuXG4gKiBgb3BlcmF0b3JfYXNzaWdubWVudGAsIHdob3NlIG5hbWVkIGNoaWxkcmVuIGFyZSB0aGUgbHZhbHVlIHRoZW4gdGhlIHZhbHVlLlxuICovXG5mdW5jdGlvbiBhc3NpZ25tZW50UGFydHMobm9kZTogTm9kZSk6IHsgbGVmdDogTm9kZSB8IG51bGw7IHJpZ2h0OiBOb2RlIHwgbnVsbCB9IHtcbiAgbGV0IHRhcmdldCA9IG5vZGU7XG4gIGlmICh0YXJnZXQudHlwZSA9PT0gXCJibG9ja2luZ19hc3NpZ25tZW50XCIgfHwgdGFyZ2V0LnR5cGUgPT09IFwibm9uYmxvY2tpbmdfYXNzaWdubWVudFwiKSB7XG4gICAgY29uc3QgaW5uZXIgPSB0YXJnZXQubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwib3BlcmF0b3JfYXNzaWdubWVudFwiKTtcbiAgICBpZiAoaW5uZXIpIHRhcmdldCA9IGlubmVyO1xuICB9XG5cbiAgY29uc3QgbmFtZWQgPSB0YXJnZXQubmFtZWRDaGlsZHJlbjtcbiAgY29uc3QgbHZhbHVlID0gbmFtZWQuZmluZCgoYykgPT4gYy50eXBlID09PSBcInZhcmlhYmxlX2x2YWx1ZVwiIHx8IGMudHlwZSA9PT0gXCJuZXRfbHZhbHVlXCIpO1xuICBjb25zdCB2YWx1ZSA9IG5hbWVkLmZpbmQoKGMpID0+IGMudHlwZSA9PT0gXCJleHByZXNzaW9uXCIpO1xuXG4gIGlmIChsdmFsdWUgJiYgdmFsdWUpIHJldHVybiB7IGxlZnQ6IGx2YWx1ZSwgcmlnaHQ6IHZhbHVlIH07XG4gIHJldHVybiB7IGxlZnQ6IG5hbWVkWzBdID8/IG51bGwsIHJpZ2h0OiBuYW1lZFsxXSA/PyBudWxsIH07XG59XG5cbi8qKiBUcnVlIHdoZW4gYG5hbWVgIGFwcGVhcnMgYW55d2hlcmUgaW4gdGhlIHN1YnRyZWUuICovXG5mdW5jdGlvbiBtZW50aW9uc0lkZW50aWZpZXIobm9kZTogTm9kZSwgbmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgaW5uZXIgb2YgaXRlcmF0ZShub2RlKSkge1xuICAgIGlmIChpbm5lci50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgJiYgaW5uZXIudGV4dCA9PT0gbmFtZSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogUm9vdCBpZGVudGlmaWVyIG9mIGFuIGx2YWx1ZSwgaWdub3JpbmcgYml0IGFuZCBwYXJ0IHNlbGVjdHMuICovXG5mdW5jdGlvbiBsdmFsdWVOYW1lKG5vZGU6IE5vZGUgfCBudWxsKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFub2RlKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAobm9kZS50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpIHJldHVybiBub2RlLnRleHQ7XG4gIGlmIChub2RlLnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikgcmV0dXJuIGx2YWx1ZU5hbWUobm9kZS5uYW1lZENoaWxkKDApID8/IG51bGwpO1xuICBpZiAoXG4gICAgbm9kZS50eXBlID09PSBcInNlbGVjdFwiIHx8XG4gICAgbm9kZS50eXBlID09PSBcImJpdF9zZWxlY3RcIiB8fFxuICAgIG5vZGUudHlwZSA9PT0gXCJwYXJ0X3NlbGVjdF9yYW5nZVwiIHx8XG4gICAgbm9kZS50eXBlID09PSBcInZhcmlhYmxlX2x2YWx1ZVwiIHx8XG4gICAgbm9kZS50eXBlID09PSBcIm5ldF9sdmFsdWVcIiB8fFxuICAgIG5vZGUudHlwZSA9PT0gXCJwcmltYXJ5XCJcbiAgKSB7XG4gICAgcmV0dXJuIGx2YWx1ZU5hbWUobm9kZS5uYW1lZENoaWxkcmVuWzBdID8/IG51bGwpO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKiBFdmVyeSBzaWduYWwgYXNzaWduZWQgYW55d2hlcmUgaW5zaWRlIGEgc3VidHJlZS4gKi9cbmZ1bmN0aW9uIGFzc2lnbmVkTmFtZXNXaXRoaW4obm9kZTogTm9kZSk6IFNldDxzdHJpbmc+IHtcbiAgY29uc3QgbmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBpbm5lciBvZiBpdGVyYXRlKG5vZGUpKSB7XG4gICAgaWYgKCFBU1NJR05NRU5UX1RZUEVTLmhhcyhpbm5lci50eXBlKSkgY29udGludWU7XG4gICAgY29uc3QgbmFtZSA9IGx2YWx1ZU5hbWUoYXNzaWdubWVudFBhcnRzKGlubmVyKS5sZWZ0KTtcbiAgICBpZiAobmFtZSkgbmFtZXMuYWRkKG5hbWUpO1xuICB9XG4gIHJldHVybiBuYW1lcztcbn1cblxuLyogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICpcbiAqIFJ1bGVzXG4gKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLyoqIFRoZSBmaXJzdCBibG9ja2luZyBhc3NpZ25tZW50IGluc2lkZSBhbiBgYWx3YXlzX2ZmYCwgaWYgdGhlcmUgaXMgb25lLiAqL1xuZnVuY3Rpb24gZmlyc3RCbG9ja2luZ0Fzc2lnbm1lbnQobm9kZTogTm9kZSk6IE5vZGUgfCB1bmRlZmluZWQge1xuICBmb3IgKGNvbnN0IGlubmVyIG9mIGl0ZXJhdGUobm9kZSkpIHtcbiAgICBpZiAoaW5uZXIudHlwZSA9PT0gXCJibG9ja2luZ19hc3NpZ25tZW50XCIpIHJldHVybiBpbm5lcjtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIEtleXdvcmRzIHRoYXQgZW5kIHVwIHN0cmFuZGVkIHdoZW4gYSBtYWNybyBicmVha3MgdGhlIHBhcnNlLlxuICpcbiAqIGBlbHNlYCBpcyB0aGUgY29tbW9uIG9uZTogaXQgbWVhbnMgdGhlIGNvbnN0cnVjdCBiZWZvcmUgaXQgd2FzIG5vdCBjbG9zZWQuXG4gKiBgb3V0cHV0YCBpbiBgb3V0cHV0IGBUTVJJTlNUKFNJWkUtMSwwLCBzdGF0ZSk7YCBpcyB0aGUgb3RoZXIgZGlyZWN0aW9uIC0tXG4gKiB0aGUga2V5d29yZCBpcyB0aGUgb25lIHRoYXQgaGFzIG5vdGhpbmcgdG8gYXR0YWNoIHRvLCBiZWNhdXNlIHRoZSBtYWNyb1xuICogYWZ0ZXIgaXQgaXMgbm90IGEgZ3JhbW1hciB0aGUgYXV0aG9yIGNvdWxkIGhhdmUgd3JpdHRlbiBpbiBwbGFpbiBIREwuXG4gKi9cbmNvbnN0IFNUUkFOREVEX0tFWVdPUkRTID0gbmV3IFNldChbXG4gIFwiZWxzZVwiLFxuICBcImVuZFwiLFxuICBcImVuZGNhc2VcIixcbiAgXCJlbmRtb2R1bGVcIixcbiAgXCJlbmR0YXNrXCIsXG4gIFwiZW5kZnVuY3Rpb25cIixcbiAgXCJlbmRnZW5lcmF0ZVwiLFxuICBcImVuZGludGVyZmFjZVwiLFxuICBcImVuZHByb2dyYW1cIixcbiAgXCJlbmRwcm9wZXJ0eVwiLFxuICBcImJlZ2luXCIsXG4gIFwiZm9ya1wiLFxuICBcImpvaW5cIixcbiAgXCJvdXRwdXRcIixcbiAgXCJpbnB1dFwiLFxuICBcImlub3V0XCIsXG4gIFwid2lyZVwiLFxuICBcInJlZ1wiLFxuICBcImxvZ2ljXCIsXG4gIFwiYXNzaWduXCIsXG5dKTtcblxuLyoqIFNpYmxpbmdzIHRoYXQgY2Fycnkgbm8gbWVhbmluZyBiZXR3ZWVuIGEgc3RhdGVtZW50IGFuZCB0aGUga2V5d29yZCBhZnRlciBpdC4gKi9cbmNvbnN0IFRSSVZJQV9URVhUID0gbmV3IFNldChbXCJcIiwgXCI7XCIsIFwiOlwiXSk7XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3ludGF4IGVycm9yIGV4aXN0cyBvbmx5IGJlY2F1c2UgYSBtYWNybyBpcyB0aGVyZS5cbiAqXG4gKiBgYGBzeXN0ZW12ZXJpbG9nXG4gKiBhbHdheXMgQChwb3NlZGdlIENsaylcbiAqICAgaWYgKCFSc3QpXG4gKiAgICAgYFRNUihyZF9wdCwse0FERFJXezEnYjB9fSk7ICAgLy8gYSBzdGF0ZW1lbnQgdGhlIGdyYW1tYXIgY2Fubm90IHNlZVxuICogICBlbHNlXG4gKiAgICAgYFRNUihyZF9wdCwscmRfcHRfbmV4dCk7XG4gKiBgYGBcbiAqXG4gKiBUaGUgZ3JhbW1hciBoYXMgbm8gcHJvZHVjdGlvbiBmb3IgYSBtYWNybyBjYWxsIHVzZWQgYXMgYSBzdGF0ZW1lbnQsIHNvIHRoZVxuICogYGlmYCBlbmRzIGVhcmx5IGFuZCB0aGUgYGVsc2VgIGlzIGxlZnQgZGFuZ2xpbmcgYXQgbW9kdWxlIGxldmVsLiBUaGUgYXV0aG9yXG4gKiB3cm90ZSBiYWxhbmNlZCBjb2RlOyB0aGUgcGFyc2UgaXMgd2hhdCBicm9rZSwgYW5kIHJlcG9ydGluZyB0aGUgYGVsc2VgIGJsYW1lc1xuICogdGhlbSBmb3IgaXQuIEV4cGFuZGluZyB0aGUgbWFjcm8gbWFrZXMgdGhlIHNhbWUgc291cmNlIHBhcnNlIHdpdGggbm8gZXJyb3IgYXRcbiAqIGFsbCwgd2hpY2ggaXMgd2hhdCB3YXMgY2hlY2tlZCBiZWZvcmUgZGVjaWRpbmcgdG8gc3RheSBxdWlldC5cbiAqXG4gKiBUaGUgcmV2ZXJzZSBoYXBwZW5zIHRvbyAtLSBgb3V0cHV0IGBUTVJJTlNUKFNJWkUtMSwwLCBzdGF0ZSk7YCBzdHJhbmRzIHRoZVxuICogZGlyZWN0aW9uIGtleXdvcmQgLS0gc28gdGhlIG1hY3JvIGlzIGxvb2tlZCBmb3Igb24gZWl0aGVyIHNpZGUuXG4gKlxuICogVGhlIHRlc3QgaXMgZGVsaWJlcmF0ZWx5IG5hcnJvdzogYSBiYXJlIGtleXdvcmQgd2l0aCBhIG1hY3JvIGNhbGwgaW4gdGhlXG4gKiBpdGVtIGltbWVkaWF0ZWx5IGJlZm9yZSBvciBhZnRlciBpdC4gQSByZWFsIHN5bnRheCBlcnJvciBmdXJ0aGVyIGF3YXksIG9yIG9uZVxuICogd2l0aCBubyBtYWNybyBhbnl3aGVyZSBuZWFyIGl0LCBpcyBzdGlsbCByZXBvcnRlZC5cbiAqL1xuZnVuY3Rpb24gY2F1c2VkQnlNYWNybyhub2RlOiBOb2RlKTogYm9vbGVhbiB7XG4gIGNvbnN0IGtleXdvcmQgPSBub2RlLnRleHQudHJpbSgpO1xuICBpZiAoIWtleXdvcmQgfHwga2V5d29yZC5zcGxpdCgvXFxzLylbMF0gIT09IGtleXdvcmQpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFTVFJBTkRFRF9LRVlXT1JEUy5oYXMoa2V5d29yZCkpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgaWYgKCFwYXJlbnQpIHJldHVybiBmYWxzZTtcblxuICBsZXQgYmVmb3JlID0gbm9kZS5wcmV2aW91c1NpYmxpbmc7XG4gIHdoaWxlIChiZWZvcmUgJiYgaXNUcml2aWEoYmVmb3JlKSkgYmVmb3JlID0gYmVmb3JlLnByZXZpb3VzU2libGluZztcbiAgaWYgKGJlZm9yZSAmJiBob2xkc01hY3JvSW52b2NhdGlvbihiZWZvcmUpKSByZXR1cm4gdHJ1ZTtcblxuICBsZXQgYWZ0ZXIgPSBub2RlLm5leHRTaWJsaW5nO1xuICB3aGlsZSAoYWZ0ZXIgJiYgaXNUcml2aWEoYWZ0ZXIpKSBhZnRlciA9IGFmdGVyLm5leHRTaWJsaW5nO1xuICByZXR1cm4gYWZ0ZXIgPyBob2xkc01hY3JvSW52b2NhdGlvbihhZnRlcikgOiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUcnVlIGZvciB0aGUgc2VtaWNvbG9ucyBhbmQgY29tbWVudHMgdGhlIGdyYW1tYXIgd3JhcHMgaW4gYSBub2RlIG9mIGl0cyBvd24uXG4gKlxuICogVGhlIGxvbmUgYDtgIHRoYXQgY2xvc2VzIGEgbWFjcm8tY2FsbCBzdGF0ZW1lbnQgYXJyaXZlcyBhcyBhIGBtb2R1bGVfaXRlbWBcbiAqIGhvbGRpbmcgbm90aGluZyBidXQgYSBzZW1pY29sb24sIHNvIHRoZSB0eXBlIGFsb25lIGNhbm5vdCBzYXkgd2hhdCBpdCBpcy5cbiAqL1xuZnVuY3Rpb24gaXNUcml2aWEobm9kZTogTm9kZSk6IGJvb2xlYW4ge1xuICBpZiAobm9kZS50eXBlLmVuZHNXaXRoKFwiX2NvbW1lbnRcIikpIHJldHVybiB0cnVlO1xuICByZXR1cm4gVFJJVklBX1RFWFQuaGFzKG5vZGUudGV4dC50cmltKCkpO1xufVxuXG4vKiogVHJ1ZSB3aGVuIGBub2RlYCdzIHN1YnRyZWUgY29udGFpbnMgYSBtYWNybyBjYWxsLiAqL1xuZnVuY3Rpb24gaG9sZHNNYWNyb0ludm9jYXRpb24obm9kZTogTm9kZSk6IGJvb2xlYW4ge1xuICBpZiAobm9kZS50eXBlID09PSBcInRleHRfbWFjcm9fdXNhZ2VcIikgcmV0dXJuIHRydWU7XG4gIGZvciAoY29uc3QgY2hpbGQgb2Ygbm9kZS5jaGlsZHJlbikge1xuICAgIGlmIChob2xkc01hY3JvSW52b2NhdGlvbihjaGlsZCkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc3ludGF4RGlhZ25vc3RpYyhub2RlOiBOb2RlKTogRGlhZ25vc3RpYyB7XG4gIGlmIChub2RlLmlzTWlzc2luZykge1xuICAgIHJldHVybiB7XG4gICAgICBzZXZlcml0eTogU0VWRVJJVFkuZXJyb3IsXG4gICAgICByYW5nZTogbm9kZVJhbmdlKG5vZGUpLFxuICAgICAgbWVzc2FnZTogYE1pc3NpbmcgXFxgJHtub2RlLnR5cGV9XFxgIGJlZm9yZSB0aGlzIHBvc2l0aW9uLmAsXG4gICAgICBzb3VyY2U6IFwic3Zpc2lvblwiLFxuICAgICAgY29kZTogXCJzeW50YXgtbWlzc2luZ1wiLFxuICAgIH07XG4gIH1cbiAgY29uc3Qgc25pcHBldCA9IG5vZGUudGV4dC5zcGxpdChcIlxcblwiKVswXSEuc2xpY2UoMCwgNDApO1xuICByZXR1cm4ge1xuICAgIHNldmVyaXR5OiBTRVZFUklUWS5lcnJvcixcbiAgICByYW5nZTogbm9kZVJhbmdlKG5vZGUpLFxuICAgIG1lc3NhZ2U6IGBVbmV4cGVjdGVkIHN5bnRheCBcXGAke3NuaXBwZXR9XFxgLmAsXG4gICAgc291cmNlOiBcInN2aXNpb25cIixcbiAgICBjb2RlOiBcInN5bnRheC1lcnJvclwiLFxuICB9O1xufVxuXG5mdW5jdGlvbiB3aWR0aERpYWdub3N0aWMobm9kZTogTm9kZSwgZW52OiBFdmFsRW52KTogRGlhZ25vc3RpYyB8IG51bGwge1xuICBjb25zdCB7IGxlZnQsIHJpZ2h0IH0gPSBhc3NpZ25tZW50UGFydHMobm9kZSk7XG4gIGlmICghbGVmdCB8fCAhcmlnaHQpIHJldHVybiBudWxsO1xuXG4gIC8vIEFuIG9iamVjdCBoYW5kbGUgaGFzIG5vIHdpZHRoIHRvIHRydW5jYXRlIGludG8uIGBwa3QucGF5bG9hZCA9IDgnaEFCYFxuICAvLyBhc3NpZ25zIHRocm91Z2ggdGhlIGhhbmRsZSwgYW5kIHRyZWF0aW5nIGl0IGFzIGEgMS1iaXQgbmV0IHdvdWxkIHJlcG9ydFxuICAvLyBldmVyeSBmaWVsZCB3cml0ZSBhcyBhIHRydW5jYXRpb24uXG4gIGlmIChlbnYuaXNIYW5kbGU/LihsdmFsdWVOYW1lKGxlZnQpID8/IFwiXCIpKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBsZWZ0V2lkdGggPSB3aWR0aE9mKGxlZnQsIGVudik7XG4gIGNvbnN0IHJpZ2h0V2lkdGggPSB3aWR0aE9mKHJpZ2h0LCBlbnYpO1xuICBpZiAobGVmdFdpZHRoID09PSB1bmRlZmluZWQgfHwgcmlnaHRXaWR0aCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgaWYgKGxlZnRXaWR0aCA9PT0gcmlnaHRXaWR0aCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gT25seSB0cnVuY2F0aW9uIGlzIHJlcG9ydGVkLiBaZXJvLWV4dGVuZGluZyBhIG5hcnJvdyBleHByZXNzaW9uIGludG8gYVxuICAvLyB3aWRlciB0YXJnZXQgaXMgaG93IGBwdHIgPD0gcHRyICsgMSdiMWAgYW5kIG9yZGluYXJ5IGNvbnN0YW50cyB3b3JrLCBzb1xuICAvLyB3YXJuaW5nIG9uIGl0IHdvdWxkIGJ1cnkgdGhlIHJlYWwgZmluZGluZ3MgdW5kZXIgbm9pc2UuXG4gIGlmIChsZWZ0V2lkdGggPj0gcmlnaHRXaWR0aCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gQWNjdW11bGF0b3IgcGF0dGVybjogYGNudCA8PSBjbnQgKyAxYCwgYHN1bSA8PSBzdW0gKyBkYXRhYC4gVGhlIHJpZ2h0LWhhbmRcbiAgLy8gc2lkZSBpcyBldmFsdWF0ZWQgYXQgdGhlIHdpZHRoIG9mIHRoZSBhc3NpZ25tZW50LCBzbyB0aGUgZGlmZmVyZW5jZSBpcyBhblxuICAvLyBhcnRlZmFjdCBvZiB1bnNpemVkIGxpdGVyYWxzIHJhdGhlciB0aGFuIGEgcmVhbCB0cnVuY2F0aW9uLlxuICBjb25zdCB0YXJnZXQgPSBsdmFsdWVOYW1lKGxlZnQpO1xuICBpZiAodGFyZ2V0ICYmIG1lbnRpb25zSWRlbnRpZmllcihyaWdodCwgdGFyZ2V0KSkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgbmFtZSA9IHRhcmdldCA/PyBcInRoZSB0YXJnZXRcIjtcbiAgY29uc3QgbG9zdCA9IHJpZ2h0V2lkdGggLSBsZWZ0V2lkdGg7XG5cbiAgcmV0dXJuIHtcbiAgICBzZXZlcml0eTogU0VWRVJJVFkud2FybmluZyxcbiAgICByYW5nZTogbm9kZVJhbmdlKG5vZGUpLFxuICAgIG1lc3NhZ2U6XG4gICAgICBgQXNzaWdubWVudCB0cnVuY2F0ZXM6ICcke25hbWV9JyBpcyAke3BsdXJhbEJpdHMobGVmdFdpZHRoKX0gYnV0IHRoZSByaWdodC1oYW5kIHNpZGUgaXMgYCArXG4gICAgICBgJHtwbHVyYWxCaXRzKHJpZ2h0V2lkdGgpfS4gVGhlIHVwcGVyICR7bG9zdH0gJHtwbHVyYWwobG9zdCwgXCJiaXRcIil9IGAgK1xuICAgICAgYCR7bG9zdCA9PT0gMSA/IFwiaXNcIiA6IFwiYXJlXCJ9IGRpc2NhcmRlZC5gLFxuICAgIHNvdXJjZTogXCJzdmlzaW9uXCIsXG4gICAgY29kZTogXCJ3aWR0aC1taXNtYXRjaFwiLFxuICB9O1xufVxuXG5mdW5jdGlvbiBwbHVyYWwoY291bnQ6IG51bWJlciwgd29yZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNvdW50ID09PSAxID8gd29yZCA6IGAke3dvcmR9c2A7XG59XG5cbmZ1bmN0aW9uIHBsdXJhbEJpdHMoY291bnQ6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiBgJHtjb3VudH0gJHtwbHVyYWwoY291bnQsIFwiYml0XCIpfWA7XG59XG5cbmZ1bmN0aW9uIHVua25vd25EaWFnbm9zdGljKFxuICBhbmFseXNpczogQW5hbHlzaXMsXG4gIG5vZGU6IE5vZGUsXG4gIGNhdGFsb2c6IENhdGFsb2csXG4gIHVyaTogc3RyaW5nLFxuICBpbmNsdWRlZD86IFJlYWRvbmx5TWFwPHN0cmluZywgSW5jbHVkZWREZWNsYXJhdGlvbj4sXG4pOiBEaWFnbm9zdGljIHwgbnVsbCB7XG4gIGNvbnN0IG5hbWUgPSBub2RlLnRleHQ7XG4gIGlmIChuYW1lLnN0YXJ0c1dpdGgoXCIkXCIpKSByZXR1cm4gbnVsbDtcbiAgaWYgKEJVSUxUSU5fTkFNRVMuaGFzKG5hbWUpKSByZXR1cm4gbnVsbDtcblxuICAvLyBBIGRvdHRlZCBwYXRoOiB0aGUgbWVtYmVycyBsaXZlIGluIGFub3RoZXIgc2NvcGUsIHNvIGxvY2FsIGxvb2t1cCBjYW5ub3RcbiAgLy8gYW5zd2VyLiBJZiB0aGUgd2FsayByZWFjaGVzIHRoYXQgc2NvcGUgYW5kIGZpbmRzIHRoZSBuYW1lLCBpdCBpcyBkZWNsYXJlZDtcbiAgLy8gaWYgaXQgcmVhY2hlcyB0aGUgc2NvcGUgYW5kIGRvZXMgbm90LCB0aGF0IGlzIGEgcmVhbCB0eXBvIHdvcnRoIHJlcG9ydGluZy5cbiAgLy9cbiAgLy8gVGhpcyBydW5zIGJlZm9yZSB0aGUgc3RydWN0dXJhbCBmaWx0ZXIsIHdoaWNoIHdvdWxkIG90aGVyd2lzZSBkaXNjYXJkIGV2ZXJ5XG4gIC8vIHNlZ21lbnQgb2YgYERVVF9pZi5hZGNfaW5gIGluY2x1ZGluZyB0aGUgb25lIHdvcnRoIGNoZWNraW5nLlxuICBjb25zdCB3aG9sZSA9IGVuY2xvc2luZ1JlZmVyZW5jZShub2RlKTtcbiAgaWYgKHdob2xlKSB7XG4gICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUGF0aCh3aG9sZSwgYW5hbHlzaXMsIGNhdGFsb2csIHVyaSk7XG5cbiAgICBpZiAoIXJlc29sdmVkKSB7XG4gICAgICAvLyBUaGUgc2NvcGUgaXRzZWxmIHdhcyBvdXQgb2YgcmVhY2ggLS0gYW4gdW5rbm93biBpbnN0YW5jZSwgYSB1bml0IHRoYXRcbiAgICAgIC8vIGlzIG5vdCBpbmRleGVkLiBGYWxsIHRocm91Z2ggdG8gdGhlIHN0cnVjdHVyYWwgZmlsdGVyIGJlbG93LCB3aGljaFxuICAgICAgLy8gc3RpbGwgY2F0Y2hlcyBhbiB1bmRlY2xhcmVkIHJvb3QgYW5kIGlnbm9yZXMgdGhlIHJlc3Qgb2YgdGhlIHBhdGguXG4gICAgfSBlbHNlIGlmICghcmVzb2x2ZWQubWlzc2luZ01lbWJlcikge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBlbHNlIGlmIChyZXNvbHZlZC5taXNzaW5nTmFtZSA9PT0gbmFtZSkge1xuICAgICAgLy8gT25seSB0aGUgc2VnbWVudCB0aGF0IGFjdHVhbGx5IGZhaWxlZCBpcyB3b3J0aCBhIGZpbmRpbmcuIEluXG4gICAgICAvLyBgRFVUX2lmLnR5cG8uYWRjX2luYCB0aGUgd2FsayBzdG9wcyBhdCBgdHlwb2A7IGBhZGNfaW5gIGlzIGlubm9jZW50LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc2V2ZXJpdHk6IFNFVkVSSVRZLndhcm5pbmcsXG4gICAgICAgIHJhbmdlOiBub2RlUmFuZ2Uobm9kZSksXG4gICAgICAgIG1lc3NhZ2U6XG4gICAgICAgICAgYFVua25vd24gbWVtYmVyIFxcYCR7bmFtZX1cXGAuIGAgK1xuICAgICAgICAgIChyZXNvbHZlZC52aWFJbnRlcmZhY2UgPyBcIlRoZSBpbnRlcmZhY2VcIiA6IFwiVGhlIHNjb3BlXCIpICtcbiAgICAgICAgICBgIHJlYWNoZWQgdGhyb3VnaCBcXGAke3dob2xlLnRleHQuc3BsaXQoXCIuXCIpWzBdfVxcYCBkb2VzIG5vdCBkZWNsYXJlIGl0LmAsXG4gICAgICAgIHNvdXJjZTogXCJzdmlzaW9uXCIsXG4gICAgICAgIGNvZGU6IFwidW5rbm93bi1pZGVudGlmaWVyXCIsXG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBIGxhdGVyIHNlZ21lbnQgZmFpbGVkOyB0aGlzIG9uZSBpcyBzaW1wbHkgbm90IHdoZXJlIHRoZSB3YWxrIHN0b3BwZWQuXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBpZiAoaXNTdHJ1Y3R1cmFsUG9zaXRpb24obm9kZSkpIHJldHVybiBudWxsO1xuXG4gIGlmIChpbXBvcnRlZE1lbWJlcihhbmFseXNpcywgY2F0YWxvZywgbm9kZS5zdGFydEluZGV4LCBuYW1lKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gRGVjbGFyZWQgaW4gYSBoZWFkZXIgdGhpcyBmaWxlIHB1bGxzIGluLiBBIGB0eXBlZGVmYCB3cml0dGVuIGFib3ZlIHRoZVxuICAvLyBoZWFkZXIncyBmaXJzdCBtb2R1bGUgaGFzIG5vIHNjb3BlIHRvIGxpdmUgaW4sIHNvIHdpdGhvdXQgZm9sbG93aW5nIHRoZVxuICAvLyBpbmNsdWRlIGV2ZXJ5IHVzZSBvZiBpdCB3b3VsZCBiZSByZXBvcnRlZCBoZXJlIC0tIGFuZCBpbiBhIGZpbGUgdGhhdFxuICAvLyBpbmNsdWRlcyB0aHJlZSBoZWFkZXJzIHRoYXQgaXMgZXZlcnkgdHlwZSB0aGUgZGVzaWduIGlzIHdyaXR0ZW4gaW4uXG4gIGlmIChpbmNsdWRlZD8uaGFzKG5hbWUpKSByZXR1cm4gbnVsbDtcblxuICBpZiAoaXNEZWNsYXJlZEhlcmUoYW5hbHlzaXMsIG5hbWUsIG5vZGUuc3RhcnRJbmRleCkpIHJldHVybiBudWxsO1xuICBpZiAoY2F0YWxvZy5nZXQobmFtZSkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7XG4gICAgc2V2ZXJpdHk6IFNFVkVSSVRZLndhcm5pbmcsXG4gICAgcmFuZ2U6IG5vZGVSYW5nZShub2RlKSxcbiAgICBtZXNzYWdlOiBgVW5rbm93biBpZGVudGlmaWVyIFxcYCR7bmFtZX1cXGAuIEl0IGlzIG5vdCBkZWNsYXJlZCBpbiB0aGlzIHNjb3BlIG9yIGFueSBlbmNsb3Npbmcgc2NvcGUuYCxcbiAgICBzb3VyY2U6IFwic3Zpc2lvblwiLFxuICAgIGNvZGU6IFwidW5rbm93bi1pZGVudGlmaWVyXCIsXG4gIH07XG59XG5cbi8qKlxuICogRmxhZ3MgYGFsd2F5cyBAKGEpIC4uLmAgYmxvY2tzIHRoYXQgcmVhZCBhIHNpZ25hbCB0aGV5IGRvIG5vdCBsaXN0LlxuICogYGFsd2F5c19jb21iYCwgYGFsd2F5c19sYXRjaGAsIGBhbHdheXNfZmZgIGFuZCBgYWx3YXlzIEAqYCBhcmUgZXhjbHVkZWQ6IHRoZVxuICogZmlyc3QgdGhyZWUgYXJlIGNvbXBsZXRlIGJ5IGNvbnN0cnVjdGlvbiwgYW5kIHRoZSBsYXN0IGNvdmVycyBldmVyeSByZWFkLlxuICovXG5mdW5jdGlvbiBzZW5zaXRpdml0eURpYWdub3N0aWMobm9kZTogTm9kZSk6IERpYWdub3N0aWMgfCBudWxsIHtcbiAgY29uc3Qga2V5d29yZFRleHQgPSBhbHdheXNLZXl3b3JkKG5vZGUpO1xuICBpZiAoa2V5d29yZFRleHQgPT09IFwiYWx3YXlzX2NvbWJcIiB8fCBrZXl3b3JkVGV4dCA9PT0gXCJhbHdheXNfbGF0Y2hcIiB8fCBrZXl3b3JkVGV4dCA9PT0gXCJhbHdheXNfZmZcIikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmICgha2V5d29yZFRleHQuc3RhcnRzV2l0aChcImFsd2F5c1wiKSkgcmV0dXJuIG51bGw7XG5cbiAgLy8gVGhlIGV4cGxpY2l0IGV2ZW50IGxpc3QgbGl2ZXMgaW4gYGV2ZW50X2NvbnRyb2xgLCBiZWxvdyB0aGUga2V5d29yZC5cbiAgbGV0IGV2ZW50Q29udHJvbDogTm9kZSB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBpbm5lciBvZiBpdGVyYXRlKG5vZGUpKSB7XG4gICAgaWYgKGlubmVyLnR5cGUgPT09IFwiZXZlbnRfY29udHJvbFwiKSB7XG4gICAgICBldmVudENvbnRyb2wgPSBpbm5lcjtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoIWV2ZW50Q29udHJvbCkgcmV0dXJuIG51bGw7XG4gIGlmIChldmVudENvbnRyb2wudGV4dC5pbmNsdWRlcyhcIipcIikpIHJldHVybiBudWxsO1xuXG4gIC8vIEEgY2xvY2tlZCBibG9jayBpcyBzZXF1ZW50aWFsIGJ5IGRlc2lnbjogb25seSB0aGUgY2xvY2sgYW5kIHRoZSBhc3luY1xuICAvLyByZXNldCBiZWxvbmcgaW4gdGhlIGxpc3QsIHNvIGBhbHdheXMgQChwb3NlZGdlIGNsaylgIGlzIG5ldmVyIGEgZmluZGluZy5cbiAgaWYgKGV2ZW50Q29udHJvbC50ZXh0LmluY2x1ZGVzKFwicG9zZWRnZVwiKSB8fCBldmVudENvbnRyb2wudGV4dC5pbmNsdWRlcyhcIm5lZ2VkZ2VcIikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGRlY2xhcmVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgaWQgb2YgaXRlcmF0ZShldmVudENvbnRyb2wpKSB7XG4gICAgaWYgKGlkLnR5cGUgPT09IFwic2ltcGxlX2lkZW50aWZpZXJcIikgZGVjbGFyZWQuYWRkKGlkLnRleHQpO1xuICB9XG4gIGlmIChkZWNsYXJlZC5zaXplID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBDb2xsZWN0IHRoZSBsdmFsdWUgc2lkZSBvZiBldmVyeSBhc3NpZ25tZW50IGluIHRoZSBibG9jazogaWRlbnRpZmllcnMgaW5zaWRlXG4gIC8vIHRob3NlIHN1YnRyZWVzIGFyZSB3cml0ZXMsIG5vdCByZWFkcy4gVGhlIGx2YWx1ZSBpcyBuZXN0ZWQgdW5kZXIgYSB3cmFwcGVyLFxuICAvLyBzbyBhbiBhbmNlc3RyeSBjaGVjayBpcyBuZWVkZWQgcmF0aGVyIHRoYW4gYSBwYXJlbnQtdHlwZSB0ZXN0LlxuICBjb25zdCBsdmFsdWVzOiBOb2RlW10gPSBbXTtcbiAgZm9yIChjb25zdCBpbm5lciBvZiBpdGVyYXRlKG5vZGUpKSB7XG4gICAgaWYgKCFBU1NJR05NRU5UX1RZUEVTLmhhcyhpbm5lci50eXBlKSkgY29udGludWU7XG4gICAgY29uc3QgeyBsZWZ0IH0gPSBhc3NpZ25tZW50UGFydHMoaW5uZXIpO1xuICAgIGlmIChsZWZ0KSBsdmFsdWVzLnB1c2gobGVmdCk7XG4gIH1cblxuICBjb25zdCByZWFkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgaWQgb2YgaXRlcmF0ZShub2RlKSkge1xuICAgIGlmIChpZC50eXBlICE9PSBcInNpbXBsZV9pZGVudGlmaWVyXCIpIGNvbnRpbnVlO1xuICAgIGlmIChpc0luc2lkZShpZCwgZXZlbnRDb250cm9sKSkgY29udGludWU7XG4gICAgaWYgKGx2YWx1ZXMuc29tZSgobHZhbHVlKSA9PiBpc0luc2lkZShpZCwgbHZhbHVlKSkpIGNvbnRpbnVlO1xuICAgIC8vIGBhbHdheXMgQChEVVQudS54KWAgYWxyZWFkeSBsaXN0cyB3aGF0IGl0IHdhdGNoZXM7IHRoZSBzZWdtZW50cyBvZiBhXG4gICAgLy8gaGllcmFyY2hpY2FsIG5hbWUgYXJlIG5vdCBsb2NhbCBzaWduYWxzIHRoZSBhdXRob3IgY291bGQgYWRkLlxuICAgIGlmIChpbnNpZGVIaWVyYXJjaGljYWxJZGVudGlmaWVyKGlkKSkgY29udGludWU7XG4gICAgcmVhZC5hZGQoaWQudGV4dCk7XG4gIH1cblxuICBjb25zdCBtaXNzaW5nID0gWy4uLnJlYWRdLmZpbHRlcigobmFtZSkgPT4gIWRlY2xhcmVkLmhhcyhuYW1lKSk7XG4gIGlmIChtaXNzaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgbGlzdGVkID0gbWlzc2luZy5zbGljZSgwLCA0KS5tYXAoKG0pID0+IGBcXGAke219XFxgYCkuam9pbihcIiwgXCIpO1xuICBjb25zdCBvdmVyZmxvdyA9IG1pc3NpbmcubGVuZ3RoID4gNCA/IGAsICske21pc3NpbmcubGVuZ3RoIC0gNH0gbW9yZWAgOiBcIlwiO1xuXG4gIHJldHVybiB7XG4gICAgc2V2ZXJpdHk6IFNFVkVSSVRZLndhcm5pbmcsXG4gICAgcmFuZ2U6IG5vZGVSYW5nZShub2RlKSxcbiAgICBtZXNzYWdlOiBgU2Vuc2l0aXZpdHkgbGlzdCBpcyBpbmNvbXBsZXRlOiAke2xpc3RlZH0ke292ZXJmbG93fSAke21pc3NpbmcubGVuZ3RoID09PSAxID8gXCJpc1wiIDogXCJhcmVcIn0gcmVhZCBidXQgbm90IGxpc3RlZC4gVXNlIFxcYGFsd2F5cyBAKCopXFxgIG9yIFxcYGFsd2F5c19jb21iXFxgLmAsXG4gICAgc291cmNlOiBcInN2aXNpb25cIixcbiAgICBjb2RlOiBcImltcGxpY2l0LXNlbnNpdGl2aXR5XCIsXG4gIH07XG59XG5cbi8qKlxuICogUmVwb3J0cyBzaWduYWxzIGFzc2lnbmVkIGluc2lkZSBhIGNvbWJpbmF0aW9uYWwgYmxvY2sgd2l0aG91dCBiZWluZyBhc3NpZ25lZFxuICogb24gZXZlcnkgZXhlY3V0aW9uIHBhdGgsIHdoaWNoIGlzIHdoYXQgaW5mZXJzIGEgbGF0Y2guXG4gKi9cbmZ1bmN0aW9uIGxhdGNoRGlhZ25vc3RpY3Mobm9kZTogTm9kZSwgYXNzaWduZWRJbjogTWFwPG51bWJlciwgU2V0PHN0cmluZz4+KTogRGlhZ25vc3RpY1tdIHtcbiAgY29uc3QgYXNzaWduZWQgPSBhc3NpZ25lZEluLmdldChub2RlLmlkKTtcbiAgaWYgKCFhc3NpZ25lZCB8fCBhc3NpZ25lZC5zaXplID09PSAwKSByZXR1cm4gW107XG5cbiAgY29uc3QgZ3VhcmFudGVlZCA9IGd1YXJhbnRlZWRBc3NpZ25tZW50cyhub2RlKTtcbiAgY29uc3Qgcmlza3kgPSBbLi4uYXNzaWduZWRdLmZpbHRlcigobmFtZSkgPT4gIWd1YXJhbnRlZWQuaGFzKG5hbWUpKTtcbiAgaWYgKHJpc2t5Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIGNvbnN0IGxpc3RlZCA9IHJpc2t5LnNsaWNlKDAsIDQpLm1hcCgocikgPT4gYFxcYCR7cn1cXGBgKS5qb2luKFwiLCBcIik7XG4gIGNvbnN0IG92ZXJmbG93ID0gcmlza3kubGVuZ3RoID4gNCA/IGAsICske3Jpc2t5Lmxlbmd0aCAtIDR9IG1vcmVgIDogXCJcIjtcblxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIHNldmVyaXR5OiBTRVZFUklUWS53YXJuaW5nLFxuICAgICAgcmFuZ2U6IG5vZGVSYW5nZShub2RlKSxcbiAgICAgIG1lc3NhZ2U6IGBQb3NzaWJsZSBsYXRjaCBpbmZlcnJlZDogJHtsaXN0ZWR9JHtvdmVyZmxvd30gJHtyaXNreS5sZW5ndGggPT09IDEgPyBcImlzXCIgOiBcImFyZVwifSBub3QgYXNzaWduZWQgb24gZXZlcnkgcGF0aC5gLFxuICAgICAgc291cmNlOiBcInN2aXNpb25cIixcbiAgICAgIGNvZGU6IFwibGF0Y2gtaW5mZXJlbmNlXCIsXG4gICAgfSxcbiAgXTtcbn1cblxuLyoqIFJlY29yZHMsIHBlciBibG9jayBub2RlIGlkLCB0aGUgc2V0IG9mIHNpZ25hbHMgYXNzaWduZWQgaW5zaWRlIGl0LiAqL1xuZnVuY3Rpb24gY29sbGVjdEFzc2lnbm1lbnRzKG5vZGU6IE5vZGUsIGludG86IE1hcDxudW1iZXIsIFNldDxzdHJpbmc+Pik6IHZvaWQge1xuICBpbnRvLnNldChub2RlLmlkLCBhc3NpZ25lZE5hbWVzV2l0aGluKG5vZGUpKTtcbn1cblxuLyoqIFN0YXRlbWVudHMgb2YgdGhlIGJsb2NrIGJvZHksIHVud3JhcHBlZCBmcm9tIGBzdGF0ZW1lbnRgL2BzdGF0ZW1lbnRfaXRlbWAuICovXG5mdW5jdGlvbiBib2R5U3RhdGVtZW50cyhub2RlOiBOb2RlKTogTm9kZVtdIHtcbiAgbGV0IGJvZHkgPSBub2RlLm5hbWVkQ2hpbGRyZW4uZmluZCgoYykgPT4gYy50eXBlICE9PSBcImFsd2F5c19rZXl3b3JkXCIpO1xuICB3aGlsZSAoYm9keSAmJiBTVEFURU1FTlRfV1JBUFBFUlMuaGFzKGJvZHkudHlwZSkgJiYgYm9keS5uYW1lZENoaWxkQ291bnQgPT09IDEpIHtcbiAgICBib2R5ID0gYm9keS5uYW1lZENoaWxkKDApITtcbiAgfVxuICBpZiAoIWJvZHkpIHJldHVybiBbXTtcblxuICAvLyBBIGJlZ2luL2VuZCBibG9jayBkaXJlY3RseSBob2xkcyB0aGUgc3RhdGVtZW50cy5cbiAgaWYgKGJvZHkudHlwZSA9PT0gXCJzZXFfYmxvY2tcIikgcmV0dXJuIFsuLi5ib2R5Lm5hbWVkQ2hpbGRyZW5dO1xuXG4gIC8vIEEgc2luZ2xlIHN0YXRlbWVudCwgcG9zc2libHkgd3JhcHBlZC5cbiAgY29uc3QgaW5uZXIgPSB1bndyYXBTdGF0ZW1lbnQoYm9keSk7XG4gIHJldHVybiBpbm5lciA/IFtpbm5lcl0gOiBbYm9keV07XG59XG5cbmZ1bmN0aW9uIHVud3JhcFN0YXRlbWVudChub2RlOiBOb2RlKTogTm9kZSB8IG51bGwge1xuICBsZXQgY3VycmVudDogTm9kZSA9IG5vZGU7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMTY7IGkrKykge1xuICAgIGlmIChTVEFURU1FTlRfV1JBUFBFUlMuaGFzKGN1cnJlbnQudHlwZSkgJiYgY3VycmVudC5uYW1lZENoaWxkQ291bnQgPT09IDEpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50Lm5hbWVkQ2hpbGQoMCkhO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjdXJyZW50LnR5cGUgPT09IFwic2VxX2Jsb2NrXCIpIHJldHVybiBjdXJyZW50O1xuICAgIHJldHVybiBjdXJyZW50O1xuICB9XG4gIHJldHVybiBjdXJyZW50O1xufVxuXG4vKipcbiAqIFNpZ25hbHMgYXNzaWduZWQgb24gZXZlcnkgZXhlY3V0aW9uIHBhdGggdGhyb3VnaCB0aGUgYmxvY2suXG4gKlxuICogQW4gYXNzaWdubWVudCBjb3VudHMgb25seSB3aGVuIGl0IGlzIHVuY29uZGl0aW9uYWwsIG9yIHdoZW4gZXZlcnkgYXJtIG9mIGFuXG4gKiBgaWZgL2BlbHNlYCBvciBldmVyeSBicmFuY2ggb2YgYSBgY2FzZWAgKHdpdGggYSBgZGVmYXVsdGApIGFzc2lnbnMgaXQuXG4gKi9cbmZ1bmN0aW9uIGd1YXJhbnRlZWRBc3NpZ25tZW50cyhibG9jazogTm9kZSk6IFNldDxzdHJpbmc+IHtcbiAgbGV0IGNlcnRhaW46IFNldDxzdHJpbmc+IHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3Qgc3RhdGVtZW50IG9mIGJvZHlTdGF0ZW1lbnRzKGJsb2NrKSkge1xuICAgIGNvbnN0IG5hbWVzID0gZ3VhcmFudGVlZEluKHN0YXRlbWVudCk7XG4gICAgLy8gQSBuYW1lIHN1cnZpdmVzIG9ubHkgaWYgZXZlcnkgc3RhdGVtZW50IG9uIGV2ZXJ5IHBhdGggYXNzaWducyBpdC5cbiAgICBjZXJ0YWluID0gY2VydGFpbiA9PT0gbnVsbCA/IG5hbWVzIDogaW50ZXJzZWN0KGNlcnRhaW4sIG5hbWVzKTtcbiAgfVxuICByZXR1cm4gY2VydGFpbiA/PyBuZXcgU2V0KCk7XG59XG5cbi8qKiBBc3NpZ25tZW50cyBndWFyYW50ZWVkIGJ5IGEgc2luZ2xlIHN0YXRlbWVudDsgZW1wdHkgbWVhbnMgXCJtYXkgbm90IHJ1blwiLiAqL1xuZnVuY3Rpb24gZ3VhcmFudGVlZEluKHN0YXRlbWVudDogTm9kZSk6IFNldDxzdHJpbmc+IHtcbiAgaWYgKEFTU0lHTk1FTlRfVFlQRVMuaGFzKHN0YXRlbWVudC50eXBlKSkge1xuICAgIGNvbnN0IG5hbWUgPSBsdmFsdWVOYW1lKGFzc2lnbm1lbnRQYXJ0cyhzdGF0ZW1lbnQpLmxlZnQpO1xuICAgIHJldHVybiBuYW1lID8gbmV3IFNldChbbmFtZV0pIDogbmV3IFNldCgpO1xuICB9XG5cbiAgaWYgKHN0YXRlbWVudC50eXBlID09PSBcImNvbmRpdGlvbmFsX3N0YXRlbWVudFwiKSB7XG4gICAgcmV0dXJuIGd1YXJhbnRlZWRCeUNvbmRpdGlvbmFsKHN0YXRlbWVudCk7XG4gIH1cblxuICBpZiAoc3RhdGVtZW50LnR5cGUgPT09IFwiY2FzZV9zdGF0ZW1lbnRcIikge1xuICAgIHJldHVybiBndWFyYW50ZWVkQnlDYXNlKHN0YXRlbWVudCk7XG4gIH1cblxuICAvLyBBIGJlZ2luL2VuZCBhdCBzdGF0ZW1lbnQgbGV2ZWwgcnVucyBzdHJhaWdodCB0aHJvdWdoLlxuICBjb25zdCBpbm5lciA9IHVud3JhcFN0YXRlbWVudChzdGF0ZW1lbnQpO1xuICBpZiAoaW5uZXIgJiYgaW5uZXIgIT09IHN0YXRlbWVudCkge1xuICAgIGxldCBjZXJ0YWluOiBTZXQ8c3RyaW5nPiB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IG5lc3RlZCA9IGlubmVyLnR5cGUgPT09IFwic2VxX2Jsb2NrXCIgPyBpbm5lci5uYW1lZENoaWxkcmVuIDogW2lubmVyXTtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG5lc3RlZCkge1xuICAgICAgY29uc3QgbmFtZXMgPSBndWFyYW50ZWVkSW4oY2hpbGQpO1xuICAgICAgY2VydGFpbiA9IGNlcnRhaW4gPT09IG51bGwgPyBuYW1lcyA6IGludGVyc2VjdChjZXJ0YWluLCBuYW1lcyk7XG4gICAgfVxuICAgIHJldHVybiBjZXJ0YWluID8/IG5ldyBTZXQoKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2V0KCk7XG59XG5cbmZ1bmN0aW9uIGd1YXJhbnRlZWRCeUNvbmRpdGlvbmFsKHN0YXRlbWVudDogTm9kZSk6IFNldDxzdHJpbmc+IHtcbiAgLy8gYGlmIC8gZWxzZSBpZiAvIGVsc2VgIGlzIGZsYXR0ZW5lZCBpbnRvIGEgc2luZ2xlIG5vZGUgaG9sZGluZyBldmVyeSBicmFuY2hcbiAgLy8gaW4gc291cmNlIG9yZGVyLCBzbyB0aGUgYXJtcyBhcmUgcmVjb3ZlcmVkIGZyb20gdGhlIGNoaWxkIHNlcXVlbmNlLlxuICBjb25zdCBhcm1zID0gY29uZGl0aW9uYWxBcm1zKHN0YXRlbWVudCk7XG4gIGlmIChhcm1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG5ldyBTZXQoKTtcblxuICAvLyBXaXRob3V0IGEgZmluYWwgYGVsc2VgLCBjb250cm9sIGNhbiBmYWxsIHBhc3QgdGhlIHdob2xlIGNoYWluLlxuICBjb25zdCBsYXN0ID0gYXJtc1thcm1zLmxlbmd0aCAtIDFdITtcbiAgaWYgKCFwcmVjZWRlZEJ5RWxzZShzdGF0ZW1lbnQsIGxhc3QuYm9keSkpIHJldHVybiBuZXcgU2V0KCk7XG5cbiAgbGV0IGFjYzogU2V0PHN0cmluZz4gfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBhcm0gb2YgYXJtcykge1xuICAgIGNvbnN0IG5hbWVzID0gYXNzaWduZWROYW1lc1dpdGhpbihhcm0uYm9keSk7XG4gICAgYWNjID0gYWNjID09PSBudWxsID8gbmFtZXMgOiBpbnRlcnNlY3QoYWNjLCBuYW1lcyk7XG4gIH1cbiAgcmV0dXJuIGFjYyA/PyBuZXcgU2V0KCk7XG59XG5cbi8qKlxuICogRXZlcnkgYnJhbmNoIGJvZHkgb2YgYW4gYGlmYCBzdGF0ZW1lbnQsIGluIHNvdXJjZSBvcmRlci4gVGhlIGxhc3QgZW50cnkgaXNcbiAqIHRoZSBgZWxzZWAgYm9keSBvbmx5IHdoZW4gdGhlIHN0YXRlbWVudCBlbmRzIHdpdGggYW4gYGVsc2VgLlxuICovXG5mdW5jdGlvbiBjb25kaXRpb25hbEFybXMoc3RhdGVtZW50OiBOb2RlKTogeyBib2R5OiBOb2RlIH1bXSB7XG4gIGNvbnN0IGFybXM6IHsgYm9keTogTm9kZSB9W10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHN0YXRlbWVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5pc05hbWVkICYmIGNoaWxkLnR5cGUgPT09IFwic3RhdGVtZW50X29yX251bGxcIikge1xuICAgICAgYXJtcy5wdXNoKHsgYm9keTogY2hpbGQgfSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFybXM7XG59XG5cbmZ1bmN0aW9uIGd1YXJhbnRlZWRCeUNhc2Uoc3RhdGVtZW50OiBOb2RlKTogU2V0PHN0cmluZz4ge1xuICBjb25zdCBpdGVtcyA9IHN0YXRlbWVudC5uYW1lZENoaWxkcmVuLmZpbHRlcigoYykgPT4gYy50eXBlID09PSBcImNhc2VfaXRlbVwiKTtcbiAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG5ldyBTZXQoKTtcblxuICBjb25zdCBoYXNEZWZhdWx0ID0gaXRlbXMuc29tZSgoaXRlbSkgPT5cbiAgICBpdGVtLmNoaWxkcmVuLnNvbWUoKGspID0+ICFrLmlzTmFtZWQgJiYgKGsudHlwZSA9PT0gXCJkZWZhdWx0XCIgfHwgay50eXBlID09PSBcImRlZmF1bHQ6XCIpKSxcbiAgKTtcbiAgaWYgKCFoYXNEZWZhdWx0KSByZXR1cm4gbmV3IFNldCgpO1xuXG4gIGxldCBhY2M6IFNldDxzdHJpbmc+IHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGNvbnN0IG5hbWVzID0gYXNzaWduZWROYW1lc1dpdGhpbihpdGVtKTtcbiAgICBhY2MgPSBhY2MgPT09IG51bGwgPyBuYW1lcyA6IGludGVyc2VjdChhY2MsIG5hbWVzKTtcbiAgfVxuICByZXR1cm4gYWNjID8/IG5ldyBTZXQoKTtcbn1cblxuLyoqIFRydWUgd2hlbiBgY2hpbGRgIHNpdHMgaW1tZWRpYXRlbHkgYWZ0ZXIgYW4gYGVsc2VgIHRva2VuLiAqL1xuZnVuY3Rpb24gcHJlY2VkZWRCeUVsc2UocGFyZW50OiBOb2RlLCBjaGlsZDogTm9kZSk6IGJvb2xlYW4ge1xuICBjb25zdCBpbmRleCA9IHBhcmVudC5jaGlsZHJlbi5maW5kSW5kZXgoKGMpID0+IGMuaWQgPT09IGNoaWxkLmlkKTtcbiAgaWYgKGluZGV4IDw9IDApIHJldHVybiBmYWxzZTtcbiAgY29uc3QgcHJldmlvdXMgPSBwYXJlbnQuY2hpbGRyZW5baW5kZXggLSAxXSE7XG4gIHJldHVybiAhcHJldmlvdXMuaXNOYW1lZCAmJiBwcmV2aW91cy50eXBlID09PSBcImVsc2VcIjtcbn1cblxuLyoqIFRydWUgd2hlbiBgbm9kZWAgbGllcyB3aXRoaW4gYGFuY2VzdG9yYC4gKi9cbmZ1bmN0aW9uIGlzSW5zaWRlKG5vZGU6IE5vZGUsIGFuY2VzdG9yOiBOb2RlKTogYm9vbGVhbiB7XG4gIGxldCBjdXJyZW50OiBOb2RlIHwgbnVsbCA9IG5vZGU7XG4gIHdoaWxlIChjdXJyZW50KSB7XG4gICAgaWYgKGN1cnJlbnQuaWQgPT09IGFuY2VzdG9yLmlkKSByZXR1cm4gdHJ1ZTtcbiAgICBjdXJyZW50ID0gY3VycmVudC5wYXJlbnQ7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBpbnRlcnNlY3QoYTogU2V0PHN0cmluZz4sIGI6IFNldDxzdHJpbmc+KTogU2V0PHN0cmluZz4ge1xuICBjb25zdCBvdXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCB2YWx1ZSBvZiBhKSB7XG4gICAgaWYgKGIuaGFzKHZhbHVlKSkgb3V0LmFkZCh2YWx1ZSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICpcbiAqIEJsb2NrIGNsYXNzaWZpY2F0aW9uXG4gKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuZnVuY3Rpb24gYWx3YXlzS2V5d29yZChub2RlOiBOb2RlKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGUubmFtZWRDaGlsZHJlbi5maW5kKChjKSA9PiBjLnR5cGUgPT09IFwiYWx3YXlzX2tleXdvcmRcIik/LnRleHQudHJpbSgpID8/IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGlzU2VxdWVudGlhbEJsb2NrKG5vZGU6IE5vZGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vZGUudHlwZSA9PT0gXCJhbHdheXNfY29uc3RydWN0XCIgJiYgYWx3YXlzS2V5d29yZChub2RlKSA9PT0gXCJhbHdheXNfZmZcIjtcbn1cblxuZnVuY3Rpb24gaXNDb21iaW5hdGlvbmFsKG5vZGU6IE5vZGUpOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vZGUudHlwZSA9PT0gXCJhbHdheXNfY29uc3RydWN0XCIgJiYgYWx3YXlzS2V5d29yZChub2RlKSA9PT0gXCJhbHdheXNfY29tYlwiO1xufVxuXG4vKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKlxuICogVHJlZSB3YWxraW5nIGFuZCBsb29rdXBcbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vKiogRGVwdGgtZmlyc3Qgd2FsayBvdmVyIGV2ZXJ5IG5vZGUsIGluY2x1ZGluZyBhbm9ueW1vdXMgb25lcy4gKi9cbmZ1bmN0aW9uKiBpdGVyYXRlKHJvb3Q6IE5vZGUpOiBHZW5lcmF0b3I8Tm9kZT4ge1xuICBjb25zdCBzdGFjazogTm9kZVtdID0gW3Jvb3RdO1xuICB3aGlsZSAoc3RhY2subGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IG5vZGUgPSBzdGFjay5wb3AoKSE7XG4gICAgeWllbGQgbm9kZTtcbiAgICBmb3IgKGxldCBpID0gbm9kZS5jaGlsZENvdW50IC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGNvbnN0IGNoaWxkID0gbm9kZS5jaGlsZChpKTtcbiAgICAgIGlmIChjaGlsZCkgc3RhY2sucHVzaChjaGlsZCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vZGVSYW5nZShub2RlOiBOb2RlKTogUmFuZ2Uge1xuICByZXR1cm4ge1xuICAgIHN0YXJ0OiB7IGxpbmU6IG5vZGUuc3RhcnRQb3NpdGlvbi5yb3csIGNoYXJhY3Rlcjogbm9kZS5zdGFydFBvc2l0aW9uLmNvbHVtbiB9LFxuICAgIGVuZDogeyBsaW5lOiBub2RlLmVuZFBvc2l0aW9uLnJvdywgY2hhcmFjdGVyOiBub2RlLmVuZFBvc2l0aW9uLmNvbHVtbiB9LFxuICB9O1xufVxuXG4vKipcbiAqIElkZW50aWZpZXJzIHRoYXQgYXJlIG5vdCB2YXJpYWJsZSByZWZlcmVuY2VzOiBtZW1iZXIgc2VsZWN0aW9ucywgcGFja2FnZVxuICogc2NvcGUgcmVzb2x1dGlvbiwgbW9kdWxlIHR5cGUgbmFtZXMsIHNjb3BlIGRlY2xhcmF0aW9ucywgYW5kIGJpbmRpbmcgbmFtZXMuXG4gKi9cbmZ1bmN0aW9uIGlzU3RydWN0dXJhbFBvc2l0aW9uKG5vZGU6IE5vZGUpOiBib29sZWFuIHtcbiAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnQ7XG4gIGlmICghcGFyZW50KSByZXR1cm4gZmFsc2U7XG5cbiAgLy8gYElETEUgPSAyJ2IwMGAgaW5zaWRlIGBlbnVtIHsgLi4uIH1gOiB0aGUgbmFtZSBpcyB0aGUgZGVjbGFyYXRpb24gaXRzZWxmLFxuICAvLyBub3QgYSB1c2Ugb2Ygc29tZXRoaW5nIGRlY2xhcmVkIGVsc2V3aGVyZS5cbiAgaWYgKHBhcmVudC50eXBlID09PSBcImVudW1fbmFtZV9kZWNsYXJhdGlvblwiKSByZXR1cm4gdHJ1ZTtcblxuICAvLyBgZW5kcGFja2FnZSA6IHBgIHJlcGVhdHMgdGhlIG5hbWUgYXQgdGhlIGVuZCBvZiB0aGUgZGVjbGFyYXRpb24uIEV2ZXJ5XG4gIC8vIGlkZW50aWZpZXIgZGlyZWN0bHkgaW5zaWRlIGEgc2NvcGUgZGVjbGFyYXRpb24gaXMgcGFydCBvZiBpdHMgaGVhZGVyLlxuICBpZiAoXG4gICAgcGFyZW50LnR5cGUgPT09IFwicGFja2FnZV9kZWNsYXJhdGlvblwiIHx8XG4gICAgcGFyZW50LnR5cGUgPT09IFwibW9kdWxlX2RlY2xhcmF0aW9uXCIgfHxcbiAgICBwYXJlbnQudHlwZSA9PT0gXCJpbnRlcmZhY2VfZGVjbGFyYXRpb25cIlxuICApIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIE1hY3JvIG5hbWVzIGluIGBpZmRlZiAvIGBkZWZpbmUgLyBgaW5jbHVkZSBhcmUgbm90IEhETCBpZGVudGlmaWVycy5cbiAgaWYgKFBSRVBST0NFU1NPUl9QQVJFTlRTLmhhcyhwYXJlbnQudHlwZSkpIHJldHVybiB0cnVlO1xuICBpZiAocGFyZW50LnR5cGUuZW5kc1dpdGgoXCJfZGlyZWN0aXZlXCIpIHx8IHBhcmVudC50eXBlLmVuZHNXaXRoKFwiX2NvbmRpdGlvblwiKSkgcmV0dXJuIHRydWU7XG4gIC8vIFRoZSBuYW1lIG9mIGEgbW9kdWxlIC8gaW50ZXJmYWNlIC8gcHJvZ3JhbS5cbiAgaWYgKHBhcmVudC50eXBlLmVuZHNXaXRoKFwiX2hlYWRlclwiKSkgcmV0dXJuIHRydWU7XG4gIC8vIGBhLmIuYy5kYCAtLSBvbmx5IHRoZSBmaXJzdCBzZWdtZW50IG5hbWVzIHNvbWV0aGluZyBpbiB0aGlzIHNjb3BlLiBFdmVyeVxuICAvLyBsYXRlciBzZWdtZW50IGlzIGEgbWVtYmVyIG9mIGFuIGluc3RhbmNlIG9yIGFuIGFycmF5IGVsZW1lbnQsIHJlYWNoZWRcbiAgLy8gdGhyb3VnaCB0aGUgZGVzaWduIGhpZXJhcmNoeSByYXRoZXIgdGhhbiBkZWNsYXJlZCBoZXJlLiBUaGlzIGlzIHdoYXQga2VlcHNcbiAgLy8gYGZvcmNlIERVVC5jaHJvbHNbaV0uY2hyb2wuZXJyID0gMGAgZnJvbSByZXBvcnRpbmcgYGNocm9sYCBhcyB1bmtub3duLlxuICAvL1xuICAvLyBUaGUgZmlyc3Qgc2VnbWVudCBpcyBkZWxpYmVyYXRlbHkgKm5vdCogZmlsdGVyZWQ6IGBEVVRgIHJlYWxseSBkb2VzIGhhdmUgdG9cbiAgLy8gYmUgZGVjbGFyZWQgaGVyZSwgYW5kIGEgdHlwbyBpbiBpdCBzaG91bGQgc3RpbGwgYmUgcmVwb3J0ZWQuXG4gIGlmIChwYXJlbnQudHlwZSA9PT0gXCJoaWVyYXJjaGljYWxfaWRlbnRpZmllclwiICYmIHBhcmVudC5uYW1lZENoaWxkKDApPy5pZCAhPT0gbm9kZS5pZCkgcmV0dXJuIHRydWU7XG4gIC8vIGBwa2c6Om5hbWVgXG4gIGlmIChwYXJlbnQudHlwZSA9PT0gXCJzY29wZWRfaWRlbnRpZmllclwiIHx8IHBhcmVudC50eXBlID09PSBcImNsYXNzX3R5cGVcIikgcmV0dXJuIHRydWU7XG4gIGlmIChwYXJlbnQudHlwZSA9PT0gXCJwYWNrYWdlX2ltcG9ydF9pdGVtXCIgfHwgcGFyZW50LnR5cGUgPT09IFwicGFja2FnZV9zY29wZVwiKSByZXR1cm4gdHJ1ZTtcbiAgLy8gYHN1YiB1X3N1YiAoLi4uKWAgLS0gdGhlIHR5cGUgbmFtZS5cbiAgaWYgKHBhcmVudC50eXBlID09PSBcIm1vZHVsZV9pbnN0YW50aWF0aW9uXCIgJiYgcGFyZW50LmNoaWxkRm9yRmllbGROYW1lKFwiaW5zdGFuY2VfdHlwZVwiKT8uaWQgPT09IG5vZGUuaWQpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICAvLyBgc3ViIHVfc3ViICguLi4pYCAtLSB0aGUgaW5zdGFuY2UgbmFtZSwgd2hpY2ggaXMgYWxzbyBhIGRlY2xhcmF0aW9uLlxuICBpZiAocGFyZW50LnR5cGUgPT09IFwibmFtZV9vZl9pbnN0YW5jZVwiIHx8IHBhcmVudC50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyX3dpdGhfZXNjYXBlZF9pZFwiKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgLy8gYC5wb3J0KC4uLilgIGFuZCBgLlBBUkFNKC4uLilgIGJpbmRpbmcgbmFtZXMuXG4gIGlmIChwYXJlbnQudHlwZSA9PT0gXCJuYW1lZF9wb3J0X2Nvbm5lY3Rpb25cIiB8fCBwYXJlbnQudHlwZSA9PT0gXCJuYW1lZF9wYXJhbWV0ZXJfYXNzaWdubWVudFwiKSByZXR1cm4gdHJ1ZTtcbiAgLy8gYGludCcoeClgLCBgJGJpdHModClgLCBhbmQgc2ltaWxhciB0eXBlIHBvc2l0aW9ucy5cbiAgaWYgKHBhcmVudC50eXBlID09PSBcImNhc3RcIiB8fCBwYXJlbnQudHlwZSA9PT0gXCJzaWduaW5nXCIgfHwgcGFyZW50LnR5cGUgPT09IFwiZGF0YV90eXBlXCIpIHJldHVybiB0cnVlO1xuICAvLyBTdHJ1Y3QgbGl0ZXJhbCBmaWVsZHMuXG4gIGlmIChwYXJlbnQudHlwZSA9PT0gXCJhc3NpZ25tZW50X3BhdHRlcm5fZXhwcmVzc2lvblwiKSByZXR1cm4gdHJ1ZTtcblxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGBub2RlYCBzaXRzIGluc2lkZSBhICpkb3R0ZWQqIHJlZmVyZW5jZSwgYGEuYi5jYC5cbiAqXG4gKiBBIHNpbmdsZSBuYW1lIGlzIGFsc28gd3JhcHBlZCBpbiBhIGBoaWVyYXJjaGljYWxfaWRlbnRpZmllcmAgYnkgdGhpcyBncmFtbWFyLFxuICogc28gdGhlIG5vZGUgdHlwZSBhbG9uZSBzYXlzIG5vdGhpbmc6IHdoYXQgbWF0dGVycyBpcyB3aGV0aGVyIHRoZXJlIGlzIG1vcmVcbiAqIHRoYW4gb25lIHNlZ21lbnQuIGBhYCBpcyBhIGxvY2FsIHNpZ25hbDsgYERVVC51LnhgIGlzIGEgcGF0aCBpbnRvIHRoZSBkZXNpZ24uXG4gKi9cbmZ1bmN0aW9uIGluc2lkZUhpZXJhcmNoaWNhbElkZW50aWZpZXIobm9kZTogTm9kZSk6IGJvb2xlYW4ge1xuICBsZXQgY3VycmVudDogTm9kZSB8IG51bGwgfCB1bmRlZmluZWQgPSBub2RlO1xuICB3aGlsZSAoY3VycmVudCkge1xuICAgIGlmIChjdXJyZW50LnR5cGUgPT09IFwiaGllcmFyY2hpY2FsX2lkZW50aWZpZXJcIikge1xuICAgICAgY29uc3Qgc2VnbWVudHMgPSBjdXJyZW50Lm5hbWVkQ2hpbGRyZW4uZmlsdGVyKFxuICAgICAgICAoYykgPT4gYy50eXBlID09PSBcInNpbXBsZV9pZGVudGlmaWVyXCIgfHwgYy50eXBlID09PSBcInNlbGVjdFwiLFxuICAgICAgKS5sZW5ndGg7XG4gICAgICBpZiAoc2VnbWVudHMgPiAxKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY3VycmVudCA9IGN1cnJlbnQucGFyZW50O1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYG5hbWVgIGlzIGRlY2xhcmVkIGluIHRoZSBzY29wZSBhdCBgb2Zmc2V0YCwgYXMgYSBzaWduYWwsIGFcbiAqIHBhcmFtZXRlciwgb3IgYW4gaW5zdGFuY2UuXG4gKlxuICogQW4gaW5zdGFuY2UgaXMgYSBkZWNsYXJhdGlvbiBsaWtlIGFueSBvdGhlcjogYHVfZHNwLmEuYiA9IDBgIHN0YXJ0cyBmcm9tXG4gKiBgdV9kc3BgLCBhbmQgcmVwb3J0aW5nIHRoYXQgYXMgdW5rbm93biB3b3VsZCBmbGFnIGV2ZXJ5IGhpZXJhcmNoaWNhbFxuICogcmVmZXJlbmNlIGludG8gYW4gaW5zdGFuY2UgLS0gd2hpY2ggaXMgaG93IHRlc3RiZW5jaGVzIGFuZCBgZm9yY2VgIGFyZVxuICogd3JpdHRlbi5cbiAqL1xuZnVuY3Rpb24gaXNEZWNsYXJlZEhlcmUoYW5hbHlzaXM6IEFuYWx5c2lzLCBuYW1lOiBzdHJpbmcsIG9mZnNldDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGlmICh2aXNpYmxlU3ltYm9scyhhbmFseXNpcywgb2Zmc2V0KS5zb21lKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpKSByZXR1cm4gdHJ1ZTtcblxuICBjb25zdCBjaGFpbiA9IHNjb3BlQ2hhaW4oYW5hbHlzaXMsIG9mZnNldCk7XG4gIGZvciAobGV0IGkgPSBjaGFpbi5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIGNvbnN0IHNjb3BlID0gY2hhaW5baV0hO1xuICAgIGlmIChzY29wZS5pbnN0YW5jZXMuc29tZSgoaW5zdGFuY2UpID0+IGluc3RhbmNlLmluc3RhbmNlTmFtZSA9PT0gbmFtZSkpIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogQnVpbGRzIGFuIGV2YWx1YXRpb24gZW52aXJvbm1lbnQgZnJvbSBmb2xkZWQgcGFyYW1ldGVycyBhbmQga25vd24gd2lkdGhzLiAqL1xuZnVuY3Rpb24gYnVpbGRFbnYoYW5hbHlzaXM6IEFuYWx5c2lzKTogRXZhbEVudiB7XG4gIGNvbnN0IHBhcmFtVmFsdWVzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgY29uc3Qgd2lkdGhzID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgY29uc3QgaGFuZGxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGZvciAoY29uc3Qgc2NvcGUgb2YgYW5hbHlzaXMuc2NvcGVzKSB7XG4gICAgZm9yIChjb25zdCBwYXJhbSBvZiBzY29wZS5wYXJhbWV0ZXJzKSB7XG4gICAgICBpZiAocGFyYW0ucmVzb2x2ZWRWYWx1ZSAhPT0gdW5kZWZpbmVkKSBwYXJhbVZhbHVlcy5zZXQocGFyYW0ubmFtZSwgcGFyYW0ucmVzb2x2ZWRWYWx1ZSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcG9ydCBvZiBzY29wZS5wb3J0cykge1xuICAgICAgaWYgKHBvcnQucGFja2VkV2lkdGggIT09IHVuZGVmaW5lZCkgd2lkdGhzLnNldChwb3J0Lm5hbWUsIHBvcnQucGFja2VkV2lkdGgpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHN5bWJvbCBvZiBzY29wZS5zeW1ib2xzKSB7XG4gICAgICBpZiAoc3ltYm9sLnJlc29sdmVkVmFsdWUgIT09IHVuZGVmaW5lZCkgcGFyYW1WYWx1ZXMuc2V0KHN5bWJvbC5uYW1lLCBzeW1ib2wucmVzb2x2ZWRWYWx1ZSk7XG4gICAgICBpZiAoc3ltYm9sLnBhY2tlZFdpZHRoICE9PSB1bmRlZmluZWQpIHdpZHRocy5zZXQoc3ltYm9sLm5hbWUsIHN5bWJvbC5wYWNrZWRXaWR0aCk7XG4gICAgICBpZiAoc3ltYm9sLmhhbmRsZU9mKSBoYW5kbGVzLmFkZChzeW1ib2wubmFtZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBsb29rdXA6IChuYW1lKSA9PiBwYXJhbVZhbHVlcy5nZXQobmFtZSksXG4gICAgc3ltYm9sV2lkdGg6IChuYW1lKSA9PiB3aWR0aHMuZ2V0KG5hbWUpLFxuICAgIGlzSGFuZGxlOiAobmFtZSkgPT4gaGFuZGxlcy5oYXMobmFtZSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlZHVwZURpYWdub3N0aWNzKGRpYWdub3N0aWNzOiBEaWFnbm9zdGljW10pOiBEaWFnbm9zdGljW10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG91dDogRGlhZ25vc3RpY1tdID0gW107XG4gIGZvciAoY29uc3QgZCBvZiBkaWFnbm9zdGljcykge1xuICAgIGNvbnN0IGtleSA9IGAke2QucmFuZ2Uuc3RhcnQubGluZX06JHtkLnJhbmdlLnN0YXJ0LmNoYXJhY3Rlcn06JHtkLmNvZGUgPz8gXCJcIn06JHtkLm1lc3NhZ2V9YDtcbiAgICBpZiAoc2Vlbi5oYXMoa2V5KSkgY29udGludWU7XG4gICAgc2Vlbi5hZGQoa2V5KTtcbiAgICBvdXQucHVzaChkKTtcbiAgfVxuICByZXR1cm4gb3V0LnNvcnQoXG4gICAgKGEsIGIpID0+IGEucmFuZ2Uuc3RhcnQubGluZSAtIGIucmFuZ2Uuc3RhcnQubGluZSB8fCBhLnJhbmdlLnN0YXJ0LmNoYXJhY3RlciAtIGIucmFuZ2Uuc3RhcnQuY2hhcmFjdGVyLFxuICApO1xufSJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxvQkFBbUI7QUFDbkIsSUFBQUEsa0JBQXNEO0FBQ3RELHFCQUF1QjtBQUN2QixJQUFBQyxvQkFBaUI7QUFDakIsdUJBQWtDO0FBQ2xDLGdEQUE2Qjs7O0FDSDdCLDZCQUF1RDtBQU9oRCxJQUFNLGdCQUFOLE1BQU0sZUFBYztBQUFBLEVBQ3pCLE9BQWU7QUFBQSxFQUNmLE9BQWU7QUFBQSxFQUVFO0FBQUEsRUFDQTtBQUFBLEVBRVQsWUFBWSxVQUFvQjtBQUN0QyxTQUFLLFdBQVc7QUFDaEIsU0FBSyxTQUFTLElBQUksOEJBQU87QUFDekIsU0FBSyxPQUFPLFlBQVksUUFBUTtBQUFBLEVBQ2xDO0FBQUEsRUFFQSxhQUFhLFNBQWlDO0FBQzVDLFVB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QUFBRCxRQUFLLEtBQUssRUFBRSxNQUFNLHNCQUFzQixDQUFDLENBQUM7QUFDN0UsSUFBRSxRQUFRLE1BQU0sRUFBRSxHQUFHO0FBQ3ZCLENBQUM7IiwKICAibmFtZXMiOiBbImltcG9ydF9ub2RlX2ZzIiwgImltcG9ydF9ub2RlX3BhdGgiLCAibGVmdCIsICJyaWdodCIsICJwYXRoIiwgImltcG9ydF9ub2RlX3BhdGgiLCAicGF0aCIsICJwYXRoIiwgImV4aXN0aW5nIiwgImxpdGVyYWwiLCAidG9Qb3NpdGlvbiIsICJ0b1JhbmdlIiwgImZpbmRDaGlsZCIsICJiZWZvcmUiLCAibm9kZSIsICJlbnRyeSIsICJpbXBvcnRfbm9kZV9mcyIsICJpbXBvcnRfbm9kZV9wYXRoIiwgInBhcnNlciIsICJmcyIsICJwYXRoIiwgImltcG9ydF93ZWJfdHJlZV9zaXR0ZXIiLCAicGFyc2VyIiwgImV4aXN0aW5nIiwgIk1BWF9JTVBPUlRfSE9QUyIsICJpdCIsICJpbXBvcnRfdnNjb2RlX2xhbmd1YWdlc2VydmVyX3R5cGVzIiwgInBhdGgiLCAiaW1wb3J0X3ZzY29kZV9sYW5ndWFnZXNlcnZlcl90eXBlcyIsICJpbXBvcnRfdnNjb2RlX2xhbmd1YWdlc2VydmVyX3R5cGVzIiwgInNob3J0VXJpIiwgImV4aXN0aW5nIiwgImltcG9ydF92c2NvZGVfbGFuZ3VhZ2VzZXJ2ZXJfdHlwZXMiLCAiQVNTSUdOTUVOVF9UWVBFUyIsICJpdGVyYXRlIiwgImx2YWx1ZU5hbWUiLCAiYmVmb3JlIiwgImFmdGVyIiwgInBsdXJhbCIsICJwYXRoIiwgImFzc2VydCJdCn0K
