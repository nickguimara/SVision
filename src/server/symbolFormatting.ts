import {
  CompletionItemKind,
  SymbolKind,
  type MarkupContent,
} from "vscode-languageserver-types";

import type { HdlSymbol } from "./model.js";

/** Human-readable label for a declared entity, e.g. `always_ff block`. */
const CATEGORY_LABEL: Record<HdlSymbol["category"], string> = {
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
  block: "Generate block",
};

/** Maps an HDL declaration kind to the LSP symbol kind used in the outline. */
export function toSymbolKind(category: HdlSymbol["category"]): SymbolKind {
  switch (category) {
    case "port":
      return SymbolKind.Property;
    case "net":
    case "variable":
      return SymbolKind.Variable;
    case "parameter":
    case "localparam":
    case "genvar":
      return SymbolKind.Constant;
    case "typedef":
    case "enum":
      return SymbolKind.Enum;
    case "task":
      return SymbolKind.Method;
    case "function":
      return SymbolKind.Function;
    case "instance":
      return SymbolKind.Object;
    case "module":
      return SymbolKind.Module;
    case "interface":
      return SymbolKind.Interface;
    case "program":
      return SymbolKind.Object;
    case "package":
      return SymbolKind.Package;
    case "class":
      return SymbolKind.Class;
    case "handle":
      // An object handle reads and writes through its members, so it is
      // closer to a reference than to a value.
      return SymbolKind.Object;
    case "block":
      return SymbolKind.Namespace;
    default:
      return SymbolKind.Variable;
  }
}

export function toCompletionKind(category: HdlSymbol["category"]): CompletionItemKind {
  switch (category) {
    case "port":
      return CompletionItemKind.Field;
    case "net":
      return CompletionItemKind.Value;
    case "variable":
      return CompletionItemKind.Variable;
    case "parameter":
    case "localparam":
    case "genvar":
      return CompletionItemKind.Constant;
    case "typedef":
      return CompletionItemKind.Class;
    case "enum":
      return CompletionItemKind.EnumMember;
    case "task":
      return CompletionItemKind.Function;
    case "function":
      return CompletionItemKind.Function;
    case "package":
      return CompletionItemKind.Module;
    case "class":
      return CompletionItemKind.Class;
    case "handle":
      return CompletionItemKind.Reference;
    default:
      return CompletionItemKind.Value;
  }
}

/** `1 bit` / `8 bits`, without the trailing "s" on the singular. */
export function formatBits(count: number): string {
  return `${count} ${plural(count, "bit")}`;
}

/** Naive pluralisation, sufficient for the nouns used in the UI. */
export function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * The one-line type annotation shown next to a symbol, e.g.
 * `input · logic [7:0] · 8 bits`. A one-bit signal states `1 bit` rather than
 * leaving the width out; the width is omitted only when it could not be
 * determined, which is more honest than showing a guessed value.
 */
export function describeSymbol(symbol: HdlSymbol, options: { showType: boolean; showWidth: boolean }): string {
  const parts: string[] = [];

  if (symbol.direction) parts.push(symbol.direction);
  // A port written without an explicit type inherits its direction, so
  // printing it twice would just read `input · input`.
  if (options.showType && symbol.typeText && symbol.typeText !== symbol.direction) {
    parts.push(symbol.typeText);
  }

  if (options.showWidth) {
    const dims: string[] = [];
    if (symbol.packedWidth !== undefined) dims.push(formatBits(symbol.packedWidth));
    if (symbol.unpackedDims.length > 0) {
      const count = symbol.unpackedCount;
      dims.push(
        count !== undefined
          ? `${count} ${plural(count, "element")} ${symbol.unpackedDims.join(" ")}`
          : `array ${symbol.unpackedDims.join(" ")}`,
      );
    }
    parts.push(...dims);
  }

  if (symbol.category === "parameter" || symbol.category === "localparam") {
    parts.push(symbol.resolvedValue !== undefined ? `default ${symbol.resolvedValue}` : "no default");
  }

  return parts.join(" · ");
}

/** The full declaration as it would be written, used in hover and docs. */
export function declarationText(symbol: HdlSymbol): string {
  const direction = symbol.isPort && symbol.direction ? `${symbol.direction} ` : "";
  const packed = symbol.packedRangeText ? ` [${symbol.packedRangeText}]` : "";
  const unpacked = symbol.unpackedDims.join("");
  const init =
    symbol.initializerText && symbol.category !== "typedef" ? ` = ${symbol.initializerText}` : "";

  return `${direction}${symbol.typeText}${packed} ${symbol.name}${unpacked}${init}`.replace(/\s+/g, " ").trim();
}

/** Rich hover / completion documentation for a declaration. */
export function documentationFor(
  symbol: HdlSymbol,
  options: { showType: boolean; showWidth: boolean; usageCount?: number },
): MarkupContent {
  const lines: string[] = [];
  lines.push("```systemverilog");
  lines.push(declarationText(symbol));
  lines.push("```");

  const detail = describeSymbol(symbol, options);
  if (detail) lines.push(`**${detail}**`);

  if (symbol.packedWidth !== undefined) {
    const label = `${symbol.name} is ${formatBits(symbol.packedWidth)} wide`;
    const spread =
      symbol.unpackedCount !== undefined && symbol.unpackedCount > 1
        ? ` across ${symbol.unpackedCount} ${plural(symbol.unpackedCount, "element")}`
        : "";
    lines.push("");
    lines.push(`\`${label}\`${spread}.`);
  }

  if (options.usageCount !== undefined && options.usageCount > 0) {
    lines.push("");
    lines.push(`Referenced ${options.usageCount} ${plural(options.usageCount, "time")} in this file.`);
  }

  if (symbol.doc) {
    lines.push("");
    lines.push(symbol.doc);
  }

  return { kind: "markdown", value: lines.join("\n") };
}

export { CATEGORY_LABEL };