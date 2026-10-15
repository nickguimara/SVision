import { SymbolKind, type DocumentSymbol } from "vscode-languageserver-types";

import type { Analysis, HdlScope, HdlSymbol } from "../model.js";
import { toSymbolKind } from "../symbolFormatting.js";

/**
 * Builds the outline. Design units become top-level symbols and their ports,
 * parameters, signals and instances become nested children.
 *
 * Inline generate blocks are flattened into their parent so the tree stays
 * shallow and readable.
 */
export function provideDocumentSymbols(analysis: Analysis): DocumentSymbol[] {
  const out: DocumentSymbol[] = [];
  for (const scope of analysis.scopes) {
    // Only roots: nested scopes are attached to their parent.
    if (scope.parentId !== undefined && analysis.scopesById.has(scope.parentId)) continue;
    out.push(toDocumentSymbol(scope));
  }
  return out;
}

function toDocumentSymbol(scope: HdlScope): DocumentSymbol {
  const children: DocumentSymbol[] = [];

  for (const param of scope.parameters) children.push(toSymbol(param));
  for (const port of scope.ports) children.push(toSymbol(port));
  for (const symbol of scope.symbols) children.push(toSymbol(symbol));

  for (const instance of scope.instances) {
    children.push({
      name: instance.instanceName || instance.typeName,
      detail: instance.typeName,
      kind: SymbolKind.Object,
      range: instance.range,
      selectionRange: instance.typeRange,
      children: [],
    });
  }

  for (const child of scope.children) {
    if (child.category === "block") continue;

    // A class method appears twice: once as a symbol declared in the class, and
    // once as the scope of its own body. The symbol is enough -- repeating it
    // with an identical name in the same list is noise, and nothing is lost,
    // since the symbol already carries the range of the whole method.
    const declared = new Set(scope.symbols.map((s) => s.name));
    if ((child.category === "function" || child.category === "task") && declared.has(child.name)) {
      continue;
    }

    children.push(toDocumentSymbol(child));
  }

  return {
    name: scope.name,
    detail: scope.category,
    kind: toSymbolKind(scope.category),
    range: scope.range,
    selectionRange: scope.selectionRange,
    children,
  };
}

function toSymbol(symbol: HdlSymbol): DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbolDetail(symbol),
    kind: toSymbolKind(symbol.category),
    range: symbol.range,
    selectionRange: symbol.selectionRange,
  };
}

function symbolDetail(symbol: HdlSymbol): string {
  const parts: string[] = [];
  if (symbol.direction) parts.push(symbol.direction);
  // Same rule as the completion list: do not print the direction twice when the
  // port has no explicit type.
  if (symbol.typeText && symbol.typeText !== symbol.direction) parts.push(symbol.typeText);
  // `1b` for a scalar, matching what the completion list shows.
  if (symbol.packedWidth !== undefined) parts.push(`${symbol.packedWidth}b`);
  if (symbol.unpackedCount !== undefined && symbol.unpackedCount > 1) {
    parts.push(`[${symbol.unpackedCount}]`);
  }
  return parts.join(" ");
}