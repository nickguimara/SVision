import type { Node } from "web-tree-sitter";

import type { Analysis } from "./model.js";

/**
 * The most specific node covering `offset`.
 *
 * `namedDescendantForIndex` returns the smallest named node whose range contains
 * the index, which is what we want, but it can also land on a node that merely
 * starts at `offset`. The fallback to `offset - 1` covers the very common case
 * of a caret sitting immediately after an identifier.
 */
export function nodeAt(analysis: Analysis, offset: number): Node | null {
  const root = analysis.parseTree.rootNode;
  for (const probe of [offset, offset - 1]) {
    if (probe < 0 || probe > root.endIndex) continue;
    const node = root.namedDescendantForIndex(probe);
    if (node) return node;
  }
  return null;
}

/**
 * The identifier under the cursor, or null when the caret is not on one.
 *
 * Checks the offset itself first, then the character before it, so both
 * `obj.na|me` and `obj.nam|e` resolve.
 */
export function identifierAt(analysis: Analysis, offset: number): Node | null {
  const root = analysis.parseTree.rootNode;
  for (const probe of [offset, offset - 1]) {
    if (probe < 0 || probe > root.endIndex) continue;
    const node = root.namedDescendantForIndex(probe);
    if (node && node.type === "simple_identifier") return node;
  }
  return null;
}