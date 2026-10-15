import type { Position, Range } from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

/**
 * Tree-sitter helpers shared by diagnostics, the signal-access collector and
 * the hierarchy tools. Centralised so the node-type knowledge that took
 * several debugging rounds to pin down lives in exactly one place.
 */

export function toPosition(p: { row: number; column: number }): Position {
  return { line: p.row, character: p.column };
}

export function toRange(node: Node): Range {
  return {
    start: toPosition(node.startPosition),
    end: toPosition(node.endPosition),
  };
}

/** Depth-first walk over every node, including anonymous ones. */
export function* iterate(root: Node): Generator<Node> {
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

/** Assignment node types, in all their spellings. */
export const ASSIGNMENT_TYPES = new Set([
  "blocking_assignment",
  "nonblocking_assignment",
  "net_assignment",
  "operator_assignment",
]);

/**
 * Splits an assignment into its lvalue and value.
 *
 * Assignment nodes carry no LSP fields, so the operands have to be found by
 * node type. `blocking_assignment` / `nonblocking_assignment` wrap the real
 * `operator_assignment`.
 */
export function assignmentParts(node: Node): { left: Node | null; right: Node | null } {
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
export function mentionsIdentifier(node: Node, name: string): boolean {
  for (const inner of iterate(node)) {
    if (inner.type === "simple_identifier" && inner.text === name) return true;
  }
  return false;
}

/** Root identifier of an lvalue, ignoring bit and part selects. */
export function lvalueName(node: Node | null): string | undefined {
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

/** Identifier nodes whose first named child is the called subroutine. */
function isCallTarget(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type !== "function_call" && parent.type !== "system_tf_call") return false;
  return parent.namedChild(0)?.id === node.id;
}

/**
 * Every signal named by an expression, reduced to its root: `a.b[3]` and
 * `a` both yield `a`, because the tracer reasons about whole nets.
 *
 * Subroutine names are skipped -- calling a task is not a signal load.
 */
export function rootIdentifiers(node: Node | null): Node[] {
  const found: Node[] = [];

  const visit = (current: Node, depth: number): void => {
    // Only the leading identifier of a hierarchical name is the net.
    if (depth > 0 && current.type === "hierarchical_identifier") {
      const root = current.namedChild(0);
      if (root) visit(root, depth);
      return;
    }
    if (current.type === "simple_identifier" && !isCallTarget(current)) {
      found.push(current);
      return;
    }
    for (const child of current.namedChildren) visit(child, depth + 1);
  };

  if (node) visit(node, 0);
  return found;
}

/** Text of the `always` variant, e.g. `always_ff`, or `always`. */
export function alwaysKeyword(node: Node): string {
  const text = node.child(0)?.text ?? "";
  return text === "always" ? "always" : text;
}

export function isSequentialBlock(node: Node): boolean {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_ff";
}

export function isCombinational(node: Node): boolean {
  return node.type === "always_construct" && alwaysKeyword(node) === "always_comb";
}

/** Nodes that merely wrap a nested statement. */
export const STATEMENT_WRAPPERS = new Set(["statement", "statement_item", "statement_or_null"]);

/** First line of text, trimmed, for single-line display labels. */
export function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? text;
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}