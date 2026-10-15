import type { Hover, MarkupContent } from "vscode-languageserver-types";
import type { TextDocument } from "vscode-languageserver-textdocument";

import { visibleSymbols } from "../model.js";
import type { Catalog } from "../catalog.js";
import type { Analysis } from "../model.js";
import { identifierAt } from "../locate.js";
import { declarationText, describeSymbol, documentationFor } from "../symbolFormatting.js";
import { pathOf, resolvePath } from "../hierarchy.js";
import { importedMember, includedDeclaration } from "../imports.js";
import type { IncludeResolver } from "../includes.js";

export interface HoverSettings {
  showWidth: boolean;
  showType: boolean;
}

export function provideHover(
  document: TextDocument,
  analysis: Analysis,
  catalog: Catalog,
  offset: number,
  settings: HoverSettings,
  includes?: IncludeResolver,
): Hover | null {
  const node = identifierAt(analysis, offset);
  if (!node) return null;

  const name = node.text;
  const path = pathOf(node);

  // A reference to a declaration in this file.
  const symbols = visibleSymbols(analysis, offset);
  const symbol = symbols.find((s) => s.name === name);

  if (symbol) {
    const uses = analysis.identifiers.get(name)?.length ?? 0;
    const isDeclaration = symbol.selectionRange.start.line === node.startPosition.row &&
      symbol.selectionRange.start.character === node.startPosition.column;

    const doc: MarkupContent = documentationFor(symbol, { ...settings, usageCount: isDeclaration ? uses : uses + 1 });
    const lines = [doc.value];

    if (!isDeclaration) {
      lines.push("", `Declared in \`${symbol.category}\` at line ${symbol.selectionRange.start.line + 1}.`);
    }

    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }

  // `DUT_if.adc_in` or `DUT.u_sub.sig`: declared in another scope, possibly in
  // another file. Local lookup cannot see it; the path walk can.
  if (path) {
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
        `Declared in \`${shortUri(resolved.uri)}\` at line ${resolved.symbol.selectionRange.start.line + 1}.`,
      );

      return { contents: { kind: "markdown", value: lines.join("\n") } };
    }
  }

  // A name brought in by `import pkg::*;`. It is not declared here and not on
  // the dotted path either, so the import has to be consulted explicitly.
  const imported = importedMember(analysis, catalog, offset, name);
  if (imported) {
    const doc = documentationFor(imported.symbol, { ...settings, usageCount: 1 });
    return {
      contents: {
        kind: "markdown",
        value: [
          doc.value,
          "",
          `Imported from \`${imported.packageName}\` in \`${shortUri(imported.uri)}\`` +
            ` at line ${imported.symbol.selectionRange.start.line + 1}.`,
        ].join("\n"),
      },
    };
  }

  // A type declared in a header this file `` `include ``s. Written above the
  // header's first module, so no scope owns it and only the include says where
  // it lives.
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
            `Declared in \`${declared.header}\` at line ` +
              `${declared.symbol.selectionRange.start.line + 1}, included by this file.`,
          ].join("\n"),
        },
      };
    }
  }

  // A module / interface / package reference.
  const unit = catalog.get(name);
  if (unit) {
    const lines: string[] = [];
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
          `| \`${port.name}\` | ${port.direction ?? ""} ${escapePipes(port.typeText)}${port.packedRangeText ? ` [${port.packedRangeText}]` : ""} | ${port.packedWidth ?? "?"} |`,
        );
      }
    }

    if (unit.parameters.length > 0) {
      lines.push("");
      lines.push("**Parameters**");
      for (const param of unit.parameters) {
        const detail = describeSymbol(param, settings);
        lines.push(`- \`${declarationText(param)}\`${detail ? ` — ${detail}` : ""}`);
      }
    }

    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }

  return null;
}

function headerSummary(
  name: string,
  kind: string,
  ports: { name: string }[],
  parameters: { name: string }[],
): string {
  const paramList = parameters.length > 0 ? `#(${parameters.map((p) => p.name).join(", ")})` : "";
  const portList = ports.length > 0 ? ` (${ports.map((p) => p.name).join(", ")})` : " ()";
  return `${kind} ${name}${paramList}${portList};`;
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function shortUri(uri: string): string {
  const parts = uri.split(/[\\/]/);
  return parts.slice(-2).join("/");
}
