import { readFileSync } from "node:fs";
import path from "node:path";

import { TextDocument } from "vscode-languageserver-textdocument";

import { VerilogParser } from "../src/server/verilogParser.js";
import { analyzeTree } from "../src/server/analyzer.js";
import { Catalog } from "../src/server/catalog.js";
import { buildHierarchy } from "../src/server/graph.js";
import { computeDiagnostics } from "../src/server/providers/diagnostics.js";

const root = path.resolve("sample");

async function main(): Promise<void> {
  const parser = await VerilogParser.create();
  const catalog = new Catalog();

  for (const name of ["counter_pkg.sv", "fifo.sv", "top.sv", "has_issues.sv"]) {
    const src = readFileSync(path.join(root, name), "utf8");
    catalog.replaceDocument(`file://${root}/${name}`, analyzeTree(parser.parse(src), src).scopes);
  }

  const topSrc = readFileSync(path.join(root, "top.sv"), "utf8");
  const uri = `file://${root}/top.sv`;
  const analysis = analyzeTree(parser.parse(topSrc), topSrc);

  const tree = buildHierarchy(analysis, catalog, undefined, uri);

  console.log("HIERARCHY");
  const print = (nodes: typeof tree, depth = 0) => {
    for (const n of nodes) {
      console.log(`  ${"  ".repeat(depth)}${n.label}  (${n.typeName})  ${n.uri ? path.basename(n.uri) : "<unresolved>"}`);
      print(n.children, depth + 1);
    }
  };
  print(tree);

  console.log("\nDIAGNOSTICS in top.sv:");
  const doc = TextDocument.create(uri, "systemverilog", 1, topSrc);
  const diags = computeDiagnostics(doc, analysis, catalog, {
    enable: true,
    unknownIdentifiers: true,
    widthMismatch: true,
    blockingInSequential: true,
    implicitSensitivity: true,
    latchDetection: true,
  });
  for (const d of diags) console.log(`  [${d.code}] ${d.range.start.line + 1}: ${d.message}`);
  console.log(`  (total ${diags.length})`);
}

void main();