import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json";
import { before, describe, it } from "node:test";


import { TextDocument } from "vscode-languageserver-textdocument";
import { InsertTextFormat } from "vscode-languageserver-types";

import { analyzeTree, classNamesIn } from "../src/server/analyzer.js";
import type { Analysis } from "../src/server/model.js";
import { staticCompletionItems } from "../src/server/completionData.js";
import { Catalog } from "../src/server/catalog.js";
import { DocumentManager } from "../src/server/documentManager.js";
import { VerilogParser } from "../src/server/verilogParser.js";
import { visibleSymbols } from "../src/server/model.js";
import { completionContext, provideCompletion } from "../src/server/providers/completion.js";
import { provideHover } from "../src/server/providers/hover.js";
import { provideDefinition, provideReferences } from "../src/server/providers/definition.js";
import { computeDiagnostics, type DiagnosticSettings } from "../src/server/providers/diagnostics.js";
import { rootNameOf } from "../src/server/signalAccess.js";
import { countHops, moduleOfSignal, traceSignal, type TraceHop } from "../src/server/trace.js";
import { buildNavigator } from "../src/server/navigator.js";
import { provideDocumentSymbols } from "../src/server/providers/documentSymbols.js";
import { SymbolKind } from "vscode-languageserver-types";
import { pathOf, resolvePath } from "../src/server/hierarchy.js";
import { identifierAt } from "../src/server/locate.js";
import { emptyTrace, traceTree, unknownSignal } from "../src/client/toolsHtml.js";
import { DEFAULT_INDEX_OPTIONS, pathToUri, WorkspaceIndexer } from "../src/server/workspaceIndex.js";
import { isUsableUri } from "../src/client/uris.js";

const zeroRange = () => ({
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
});

/** Decodes what `escapeHtml` encoded, for asserting on embedded JSON. */
const unescapeHtml = (text: string): string =>
  text
    .replace(/&#34;/g, '"')
    .replace(/&#60;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&#38;/g, "&")
    .replace(/&#39;/g, "'");

let parser: VerilogParser;

before(async () => {
  parser = await VerilogParser.create();
});

interface Fixture {
  readonly analysis: ReturnType<typeof analyzeTree>;
  readonly document: TextDocument;
  /** Character offset of the first character of `needle`. */
  readonly offsetOf: (needle: string, occurrence?: number) => number;
  /** Character offset immediately after `needle`, i.e. caret-at-end-of-word. */
  readonly endOf: (needle: string, occurrence?: number) => number;
  readonly symbol: (name: string) => ReturnType<typeof visibleSymbols>[number] | undefined;
}

function fixture(source: string, uri = "file:///test/dut.sv"): Fixture {
  const document = TextDocument.create(uri, "systemverilog", 1, source);
  const tree = parser.parse(source);
  const analysis = analyzeTree(tree, source);

  /** Character offset of the `occurrence`-th match of `needle`. */
  const offsetOf = (needle: string, occurrence = 1): number => {
    let index = -1;
    for (let i = 0; i < occurrence; i++) {
      index = source.indexOf(needle, index + 1);
      if (index < 0) throw new Error(`occurrence ${occurrence} of ${needle} not found`);
    }
    return index;
  };

  const endOf = (needle: string, occurrence = 1): number =>
    offsetOf(needle, occurrence) + needle.length;

  const symbol = (name: string) => {
    // Resolve from inside the scope itself rather than a guessed offset.
    for (const scope of analysis.scopes) {
      const found = visibleSymbols(analysis, document.offsetAt(scope.range.start)).find(
        (s) => s.name === name,
      );
      if (found) return found;
    }
    return undefined;
  };

  return { analysis, document, offsetOf, endOf, symbol };
}

/* ------------------------------------------------------------------ *
 * Declaration extraction and width folding
 * ------------------------------------------------------------------ */

describe("declaration extraction", () => {
  const source = `
module fifo #(
  parameter int WIDTH = 32,
  parameter int DEPTH = 256
) (
  input  logic              clk,
  input  logic              rst_n,
  input  logic [WIDTH-1:0]  din,
  output logic              full,
  output logic [WIDTH-1:0]  dout
);
  localparam int AW = $clog2(DEPTH);
  logic [WIDTH-1:0] mem [DEPTH-1:0];
  logic [AW-1:0]   wptr;
  logic signed [7:0] gain;
  wire  simple_net;
  typedef logic [3:0] nib_t;
endmodule
`;

  it("extracts every port with direction and type", () => {
    const f = fixture(source);
    const ports = f.analysis.scopes[0]!.ports;
    assert.deepEqual(
      ports.map((p) => p.name),
      ["clk", "rst_n", "din", "full", "dout"],
    );
    assert.equal(ports.find((p) => p.name === "din")?.direction, "input");
    assert.equal(ports.find((p) => p.name === "full")?.direction, "output");
  });

  it("folds parameter expressions to exact values", () => {
    const f = fixture(source);
    const params = f.analysis.scopes[0]!.parameters;
    assert.equal(params.find((p) => p.name === "WIDTH")?.resolvedValue, 32);
    assert.equal(params.find((p) => p.name === "DEPTH")?.resolvedValue, 256);
    // $clog2(256) === 8
    assert.equal(params.find((p) => p.name === "AW")?.resolvedValue, 8);
  });

  it("resolves packed widths through parameters", () => {
    const f = fixture(source);
    const din = f.symbol("din");
    assert.ok(din, "din should be declared");
    assert.equal(din.typeText, "logic");
    assert.equal(din.packedRangeText, "WIDTH-1:0");
    assert.equal(din.packedWidth, 32);

    // [AW-1:0] -> [7:0] -> 8 bits
    assert.equal(f.symbol("wptr")?.packedWidth, 8);
  });

  it("resolves unpacked array element counts", () => {
    const f = fixture(source);
    const mem = f.symbol("mem");
    assert.ok(mem);
    assert.deepEqual(mem.unpackedDims, ["[DEPTH-1:0]"]);
    assert.equal(mem.unpackedCount, 256);
    assert.equal(mem.packedWidth, 32);
  });

  it("handles signed vectors and nets", () => {
    const f = fixture(source);
    assert.equal(f.symbol("gain")?.packedWidth, 8);
    assert.match(f.symbol("gain")?.typeText ?? "", /signed/);
    assert.equal(f.symbol("simple_net")?.category, "net");
  });

  it("records typedefs", () => {
    const f = fixture(source);
    assert.equal(f.symbol("nib_t")?.category, "typedef");
  });

  it("reports a syntax error without throwing", () => {
    const broken = "module m ( input logic a ; endmodul";
    const f = fixture(broken);
    assert.ok(f.analysis.parseTree.rootNode.hasError);
  });
});

/* ------------------------------------------------------------------ *
 * Port shapes
 * ------------------------------------------------------------------ */

describe("port declarations", () => {
  // `input wire clk` and `input logic [7:0] d` have different tree shapes:
  // the first writes the type inline, the second nests it in a port header.
  const source = `module top #(parameter int W = 8) (
  input  wire         clk,
  input  wire         keep_out,
  input  logic [W-1:0] d,
  output wire [W-1:0] dout,
  inout  wire         io,
  output logic        valid
);
endmodule
`;

  it("keeps the type when it is written inline after the direction", () => {
    const f = fixture(source);
    const clk = f.symbol("clk");
    assert.equal(clk?.typeText, "wire");
    assert.equal(clk?.direction, "input");

    const io = f.symbol("io");
    assert.equal(io?.typeText, "wire");
    assert.equal(io?.direction, "inout");
  });

  it("resolves width for inline-typed packed ports", () => {
    const f = fixture(source);
    assert.equal(f.symbol("dout")?.packedWidth, 8);
    assert.equal(f.symbol("d")?.packedWidth, 8);
    assert.equal(f.symbol("dout")?.typeText, "wire");
  });

  it("never reports the direction in place of the type", () => {
    const f = fixture(source);
    for (const port of f.analysis.scopes[0]!.ports) {
      assert.notEqual(port.typeText, port.direction, `${port.name} lost its type`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Hover
 * ------------------------------------------------------------------ */

describe("hover", () => {
  const source = `
module counter #(parameter int W = 16) (
  input  logic        clk,
  input  logic        en,
  output logic [W-1:0] count
);
  logic [W-1:0] next;
  // Counts up while enabled.
  always_ff @(posedge clk) if (en) count <= next;
endmodule
`;

  it("shows type and resolved bit width for a reference", () => {
    const f = fixture(source);
    const hover = provideHover(
      f.document,
      f.analysis,
      new Catalog(),
      f.offsetOf("count <= next"),
      { showWidth: true, showType: true },
    );
    assert.ok(hover);
    const value = (hover.contents as { value: string }).value;
    assert.match(value, /output/);
    assert.match(value, /logic \[W-1:0\] count/);
    assert.match(value, /16 bits/);
  });

  it("returns null on whitespace", () => {
    const f = fixture(source);
    const hover = provideHover(f.document, f.analysis, new Catalog(), 1, {
      showWidth: true,
      showType: true,
    });
    assert.equal(hover, null);
  });
});

/* ------------------------------------------------------------------ *
 * Completion
 * ------------------------------------------------------------------ */

const childSource = `
module child #(parameter int W = 8) (
  input  logic clk,
  input  logic [W-1:0] din,
  output logic dout
);
endmodule
`;

const parentSource = `
module parent (
  input logic clk,
  input logic [7:0] data_in
);
  logic [7:0] internal_bus;
  logic       flag;

  child #(.W(8)) u_child (
    .di
  );
endmodule
`;

function completionAt(source: string, offset: number, catalog = new Catalog()) {
  const document = TextDocument.create("file:///test/p.sv", "systemverilog", 1, source);
  const tree = parser.parse(source);
  const analysis = analyzeTree(tree, source);
  const documents = new DocumentManager(parser);
  documents.update(document.uri, document);
  const context = completionContext(document, analysis, offset);
  return provideCompletion(context, documents, catalog, {
    showWidth: true,
    showType: true,
    snippets: true,
    systemFunctions: true,
    includeParameters: true,
  }).items;
}

describe("completion", () => {
  it("offers local signals with their type and width", () => {
    const items = completionAt(parentSource, parentSource.indexOf("  logic [7:0] internal_bus") + 1);
    const bus = items.find((i) => i.label === "internal_bus");
    assert.ok(bus, "internal_bus should be offered");
    assert.match(bus.detail ?? "", /logic/);
    assert.match(bus.detail ?? "", /8 bits/);
  });

  it("does not offer signals from a sibling scope", () => {
    const items = completionAt(parentSource, parentSource.indexOf("  logic       flag") + 1);
    assert.ok(items.some((i) => i.label === "clk"));
    assert.ok(!items.some((i) => i.label === "dout"), "child ports must not leak in");
  });

  it("restricts to the instantiated module's ports inside a named connection", () => {
    const offset = parentSource.indexOf("    .di") + "    .di".length;
    const catalog = new Catalog();
    const childTree = parser.parse(childSource);
    catalog.replaceDocument("file:///test/child.sv", analyzeTree(childTree, childSource).scopes);

    const items = completionAt(parentSource, offset, catalog);
    const labels = items.map((i) => i.label).sort();
    assert.deepEqual(labels, ["clk", "din", "dout"]);
    // The insert text should wire the connection.
    assert.equal(items.find((i) => i.label === "dout")?.insertText, ".dout()");
  });

  it("restricts to parameters inside a parameter override", () => {
    const offset = parentSource.indexOf("#(.W") + "#(.W".length;
    const catalog = new Catalog();
    const childTree = parser.parse(childSource);
    catalog.replaceDocument("file:///test/child.sv", analyzeTree(childTree, childSource).scopes);

    const items = completionAt(parentSource, offset, catalog);
    assert.deepEqual(items.map((i) => i.label), ["W"]);
  });

  it("includes keywords and system functions", () => {
    const items = completionAt(parentSource, 4);
    const labels = new Set(items.map((i) => i.label));
    assert.ok(labels.has("always_ff"));
    assert.ok(labels.has("logic"));
    assert.ok(labels.has("$clog2"));
  });

  it("offers design units from the workspace", () => {
    const catalog = new Catalog();
    const childTree = parser.parse(childSource);
    catalog.replaceDocument("file:///test/child.sv", analyzeTree(childTree, childSource).scopes);
    const items = completionAt(parentSource, 4, catalog);
    const child = items.find((i) => i.label === "child");
    assert.ok(child, "child module should be suggested");
    assert.match(child.detail ?? "", /Module/);
    assert.match(child.detail ?? "", /3 ports/);
  });

  it("offers only the local signals on an empty prefix", () => {
    // `assign <space>` should surface the signals, not a wall of keywords and
    // multiline snippet previews.
    const items = completionAt(parentSource, parentSource.indexOf("\n  logic [7:0] internal_bus"));

    assert.deepEqual(
      items.map((i) => i.label).sort(),
      ["clk", "data_in", "flag", "internal_bus"],
    );
  });

  it("adds keywords and snippets once something is typed", () => {
    const at = parentSource.indexOf("internal_bus") + "internal_bus".length;
    const items = completionAt(parentSource, at);
    const labels = new Set(items.map((i) => i.label));

    assert.ok(labels.has("internal_bus"));
    assert.ok(labels.has("always_ff"), "snippets appear once a prefix is typed");
    assert.ok(labels.has("$clog2"), "system functions appear once a prefix is typed");
  });
});

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

describe("navigation", () => {
  const source = `
module m (
  input logic clk,
  input logic [7:0] din
);
  logic [7:0] sum;
  assign sum = din + din;
  child #(.W(8)) u_child (.clk(clk), .din(din), .dout(sum));
endmodule
`;

  it("jumps from a reference to its declaration", () => {
    const f = fixture(source);
    const location = provideDefinition(
      f.document,
      f.analysis,
      new Catalog(),
      f.offsetOf("sum = din"),
    ) as { range: { start: { line: number } } };
    assert.ok(location);
    // `logic [7:0] sum;` is on line 5.
    assert.equal(location.range.start.line, 5);
  });

  it("jumps from an instantiation to the module definition", () => {
    const f = fixture(source);
    const catalog = new Catalog();
    const childTree = parser.parse(childSource);
    catalog.replaceDocument("file:///test/child.sv", analyzeTree(childTree, childSource).scopes);

    const result = provideDefinition(f.document, f.analysis, catalog, f.offsetOf("child #("));
    assert.ok(result);
    const locations = Array.isArray(result) ? result : [result];
    assert.equal(locations.length, 1);
    assert.equal(locations[0]!.uri, "file:///test/child.sv");
  });

  it("jumps to a port in the module's own file", () => {
    // A port's range belongs to the instantiated module's file. Pairing it
    // with the current document's uri sends the jump to an unrelated line of
    // the file you were already in, which reads as the click doing nothing.
    const top = [
      "module top (input wire clk);",
      "  child u_child (.din(clk), .dout());",
      "endmodule",
      "",
    ].join("\n");
    const child = "module child (input wire din, output wire dout);\nendmodule\n";

    const catalog = new Catalog();
    const childAnalysis = analyzeTree(parser.parse(child), child);
    catalog.replaceDocument("file:///test/child.sv", childAnalysis.scopes, childAnalysis.accesses);

    const document = TextDocument.create("file:///test/top.sv", "systemverilog", 1, top);
    const analysis = analyzeTree(parser.parse(top), top);
    const offset = top.indexOf(".din") + 1;

    const result = provideDefinition(document, analysis, catalog, offset);
    assert.ok(result, "the port should resolve");

    const location = Array.isArray(result) ? result[0]! : result;
    assert.equal(location.uri, "file:///test/child.sv", "not the current file");
    assert.equal(location.range.start.line, 0, "the line inside the child module");
  });

  it("finds every reference to a signal", () => {
    const f = fixture(source);
    const locations = provideReferences(f.document, f.analysis, f.offsetOf("sum = din"), true);
    const lines = locations.map((l) => l.range.start.line).sort((x, y) => x - y);
    // Declaration on line 5, one use on line 6, one use on line 7.
    assert.deepEqual(lines, [5, 6, 7]);
  });

  it("excludes the declaration when not requested", () => {
    const f = fixture(source);
    const locations = provideReferences(f.document, f.analysis, f.offsetOf("sum = din"), false);
    assert.equal(locations.length, 2);
  });
});

/* ------------------------------------------------------------------ *
 * Incremental re-parsing
 * ------------------------------------------------------------------ */

describe("document updates", () => {
  const uri = "file:///test/dut.sv";
  let manager: DocumentManager;

  before(() => {
    manager = new DocumentManager(parser);
  });

  const open = (text: string, version: number) =>
    manager.update(uri, TextDocument.create(uri, "systemverilog", version, text));

  /**
   * Every identifier the analysis knows about: declarations and references.
   * `uses` alone omits declaration names, which is where the corruption
   * showed up most visibly.
   */
  const allNames = (entry: { analysis: ReturnType<typeof analyzeTree> }): string[] => {
    const declared = entry.analysis.scopes.flatMap((s) => [
      ...s.parameters.map((p) => p.name),
      ...s.ports.map((p) => p.name),
      ...s.symbols.map((s) => s.name),
    ]);
    return [...declared, ...entry.analysis.uses.map((u) => u.name)];
  };

  it("keeps identifiers intact when a character shifts every offset", () => {
    const v1 = "module a;\n  logic add_fill;\n  assign x = add_fill;\nendmodule\n";
    const v2 = "module a;\n  logic zadd_fill;\n  assign x = add_fill;\nendmodule\n";

    open(v1, 1);
    const names = allNames(open(v2, 2));

    assert.deepEqual([...new Set(names)].sort(), ["add_fill", "x", "zadd_fill"]);

    // The regression: reusing a tree without `edit` shifts node text by one.
    assert.ok(!names.includes("add_fil"), "node text must not be truncated");
    assert.ok(!names.includes("dd_fill"), "node text must not lose its first character");
  });

  it("keeps identifiers intact when a line is inserted", () => {
    const v1 = "module a;\n  logic cnt_fill;\n  assign x = cnt_fill;\nendmodule\n";
    const v2 = "module a;\n  wire unused;\n  logic cnt_fill;\n  assign x = cnt_fill;\nendmodule\n";

    open(v1, 3);
    const names = allNames(open(v2, 4));

    assert.deepEqual([...new Set(names)].sort(), ["cnt_fill", "unused", "x"]);
  });

  it("drops a deleted declaration instead of keeping stale text", () => {
    const v1 = "module a;\n  logic keep_me;\n  logic drop_me;\nendmodule\n";
    const v2 = "module a;\n  logic keep_me;\nendmodule\n";

    open(v1, 5);
    const names = allNames(open(v2, 6));

    assert.deepEqual(names, ["keep_me"]);
  });

  it("stays correct across several consecutive edits", () => {
    open("module a;\n  logic sig;\nendmodule\n", 7);

    const edits = [
      "module a;\n  logic sig;\n  wire extra;\nendmodule\n",
      "module a;\n  logic sig;\n  wire extra;\n  assign y = sig;\nendmodule\n",
      "module aa;\n  logic sig;\n  wire extra;\n  assign y = sig;\nendmodule\n",
    ];

    for (const [i, next] of edits.entries()) {
      const names = allNames(open(next, 8 + i));
      assert.ok(
        names.every((n) => n.trim().length > 0 && /^[_A-Za-z]/.test(n)),
        `malformed identifier ${JSON.stringify(names)} at edit ${i}`,
      );
      assert.ok(names.includes("sig"), `sig lost at edit ${i}`);
      assert.ok(names.includes("extra"), `extra lost at edit ${i}`);
    }
  });

  it("diagnoses the updated document, not a stale one", () => {
    const clean = "module a;\n  logic ok;\n  logic x;\n  assign x = ok;\nendmodule\n";
    const broken = "module a;\n  logic ok;\n  logic x;\n  assign x = undefined_signal;\nendmodule\n";

    const before = open(clean, 20);
    assert.deepEqual(
      computeDiagnostics(before.document, before.analysis, new Catalog(), DIAG),
      [],
    );

    const after = open(broken, 21);
    const found = computeDiagnostics(after.document, after.analysis, new Catalog(), DIAG);
    const unknown = found.filter((d) => d.code === "unknown-identifier");
    assert.equal(unknown.length, 1);
    assert.match(unknown[0]!.message, /undefined_signal/);
  });
});

/* ------------------------------------------------------------------ *
 * Verilog net declarations
 * ------------------------------------------------------------------ */

describe("reg and wire declarations", () => {
  const source = `module m #(parameter int SIZE = 16) (
  input  wire [11:0] sample,
  output wire [25:0] out
);
reg [3:0] p_exit;
reg [18:0] reg_smp [SIZE-1:0];
reg [25:0] reg_CMD;
reg       was_keep;
wire to_keep_in;
wire [18:0] smp_in;
wire [3:0] keep_out, keep_out2;
wire signed [7:0] gain;
wire (strong0, weak1) driven;
integer i, k;
logic [31:0] shadow;
logic signed [15:0] acc;
endmodule
`;

  const width = (f: Fixture, name: string) => f.symbol(name)?.packedWidth;
  const type = (f: Fixture, name: string) => f.symbol(name)?.typeText;

  it("resolves the width of a reg", () => {
    const f = fixture(source);
    assert.equal(width(f, "p_exit"), 4);
    assert.equal(width(f, "reg_CMD"), 26);
    assert.equal(type(f, "p_exit"), "reg");
  });

  it("resolves the width of a wire", () => {
    // The regression: the packed range sits in a sibling `data_type_or_implicit`,
    // not inside `net_type`, so nets used to resolve to no width at all.
    const f = fixture(source);
    assert.equal(width(f, "smp_in"), 19);
    assert.equal(type(f, "smp_in"), "wire");
  });

  it("applies the range across a comma-separated wire list", () => {
    const f = fixture(source);
    assert.equal(width(f, "keep_out"), 4);
    assert.equal(width(f, "keep_out2"), 4);
  });

  it("keeps the signed modifier on a wire", () => {
    const f = fixture(source);
    assert.equal(width(f, "gain"), 8);
    assert.equal(type(f, "gain"), "wire signed");
  });

  it("keeps the drive strength on a wire", () => {
    const f = fixture(source);
    assert.match(type(f, "driven") ?? "", /strong0/);
  });

  it("reports a scalar signal as one bit wide", () => {
    // A vector with no declared range is 1 bit; that is a fact, not a guess,
    // so it is stated rather than left blank.
    const f = fixture(source);
    assert.equal(width(f, "was_keep"), 1);
    assert.equal(width(f, "to_keep_in"), 1);
    assert.equal(type(f, "was_keep"), "reg");
  });

  it("gives the integer family its fixed width", () => {
    const f = fixture(source);
    assert.equal(width(f, "i"), 32);
    assert.equal(width(f, "k"), 32);
  });

  it("leaves an unresolvable width unknown", () => {
    // A declared range that cannot be folded must stay blank rather than
    // fall back to 1 bit, which would be a false claim.
    const f = fixture(`module m;
  wire [NOT_A_PARAMETER-1:0] x;
  wire y;
endmodule
`);
    assert.equal(f.symbol("x")?.packedRangeText, "NOT_A_PARAMETER-1:0");
    assert.equal(width(f, "x"), undefined);
    assert.equal(width(f, "y"), 1);
  });

  it("resolves widths for logic and integer too", () => {
    const f = fixture(source);
    assert.equal(width(f, "shadow"), 32);
    assert.equal(width(f, "acc"), 16);
    assert.equal(type(f, "acc"), "logic signed");
    assert.equal(type(f, "i"), "integer");
  });

  it("reports the element count of an unpacked reg array", () => {
    const f = fixture(source);
    assert.equal(f.symbol("reg_smp")?.packedWidth, 19);
    assert.equal(f.symbol("reg_smp")?.unpackedCount, 16);
  });
});

/* ------------------------------------------------------------------ *
 * Module hierarchy
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 * Signal access (drivers and loads)
 * ------------------------------------------------------------------ */

describe("signal access", () => {
  const PORT_SOURCES = new Set(["port_input", "port_output"]);

  /** All accesses to a signal, including the port-boundary records. */
  const all = (source: string, name: string) =>
    analyzeTree(parser.parse(source), source).accesses.filter((a) => a.name === name);

  /** Accesses from statements in the module body, ignoring port boundaries. */
  const body = (source: string, name: string) =>
    all(source, name).filter((a) => !PORT_SOURCES.has(a.source));

  /** Only the port-boundary records. */
  const ports = (source: string, name: string) =>
    all(source, name).filter((a) => PORT_SOURCES.has(a.source));

  const kinds = (list: { kind: string }[]): string[] => list.map((a) => a.kind).sort();

  it("drives the lvalue and loads the right-hand side of an assign", () => {
    const source = "module m(input wire a, input wire b, output wire y);\n  assign y = a & b;\nendmodule\n";

    assert.deepEqual(kinds(body(source, "y")), ["drive"]);
    assert.deepEqual(kinds(body(source, "a")), ["load"]);
    assert.deepEqual(kinds(body(source, "b")), ["load"]);
    assert.deepEqual(body(source, "y").map((a) => a.source), ["continuous_assign"]);
    assert.match(body(source, "y")[0]!.detail, /assign y = a & b;/);
  });

  it("records the port boundary separately from the module body", () => {
    const source = "module m(input wire a, output wire y);\n  assign y = a;\nendmodule\n";

    assert.deepEqual(ports(source, "a").map((a) => a.source), ["port_input"]);
    assert.deepEqual(ports(source, "y").map((a) => a.source), ["port_output"]);
    assert.deepEqual(kinds(ports(source, "a")), ["drive"], "an input port is driven from outside");
    assert.deepEqual(kinds(ports(source, "y")), ["load"], "an output port is read from inside");
  });

  it("loads both operands of an assign rather than driving them", () => {
    // The regression that mattered: treating `net_assignment` as the lvalue
    // swept the whole expression in as a driver.
    const source =
      "module m(input wire [3:0] p, input wire [3:0] q, output wire eq);\n  assign eq = (p == q);\nendmodule\n";

    assert.deepEqual(kinds(body(source, "p")), ["load"], "p must never be driven by an assign");
    assert.deepEqual(kinds(body(source, "q")), ["load"]);
    assert.deepEqual(body(source, "p").map((a) => a.source), ["continuous_assign"]);
  });

  it("drives the lvalue and loads the right-hand side of a procedural assignment", () => {
    const source = [
      "module m(input wire clk, input wire d, output reg q);",
      "  always_ff @(posedge clk) q <= d;",
      "endmodule",
      "",
    ].join("\n");

    assert.deepEqual(kinds(body(source, "q")), ["drive"]);
    assert.deepEqual(kinds(body(source, "d")), ["load"]);
  });

  it("drives only the root of a bit-select lvalue", () => {
    const source =
      "module m(input wire clk, input wire d);\n  logic [7:0] r;\n  always_ff @(posedge clk) r[3] <= d;\nendmodule\n";

    assert.deepEqual(kinds(body(source, "r")), ["drive"], "r[3] drives r, and nothing else");
    assert.match(body(source, "r")[0]!.detail, /r\[3\] <= d/);
  });

  it("loads the index of a bit-select lvalue rather than driving it", () => {
    const source =
      "module m(input wire clk, input wire [2:0] i, input wire d);\n  logic [7:0] r;\n  always_ff @(posedge clk) r[i] <= d;\nendmodule\n";

    assert.deepEqual(kinds(body(source, "i")), ["load"], "the index is read, not written");
  });

  it("counts a signal read twice in one statement as a single load", () => {
    const source =
      "module m(input wire [1:0] p, input wire [1:0] q, output wire eq);\n  assign eq = (p == q) || (p != q);\nendmodule\n";

    assert.equal(body(source, "p").length, 1, "the tracer wants statements, not every mention");
  });

  it("ignores parameters and genvars, which are not signals", () => {
    const source = [
      "module m #(parameter int AW = 4) (output wire [AW-1:0] idx);",
      "  assign idx = AW - 1;",
      "endmodule",
      "",
    ].join("\n");

    assert.deepEqual(all(source, "AW"), [], "AW is a parameter, not a net");
    assert.deepEqual(kinds(body(source, "idx")), ["drive"]);
  });

  it("does not record a subroutine call as a signal load", () => {
    const source = "module m(input wire clk, output wire q);\n  always_comb q = myfunc(clk);\nendmodule\n";

    assert.deepEqual(all(source, "myfunc"), []);
  });

  it("loads a signal used in an if condition", () => {
    const source = "module m(input wire c, output reg q);\n  always_comb if (c) q = 1'b1;\nendmodule\n";

    assert.deepEqual(kinds(body(source, "c")), ["load"], "a condition is a read");
  });

  it("loads a signal used both as a condition and as a value", () => {
    const source =
      "module m(input wire d, output reg q);\n  always_latch if (d) q = d;\nendmodule\n";

    // Two distinct statements, so two loads.
    assert.deepEqual(kinds(body(source, "d")), ["load", "load"]);
    const details = body(source, "d").map((a) => a.detail);
    assert.ok(details.some((t) => t.includes("if (d)")), `expected the condition, got ${details}`);
    assert.ok(details.some((t) => t.includes("q = d")), `expected the assignment, got ${details}`);
  });

  it("records the range of the signal, not of the statement", () => {
    const source = "module m(input wire a, output wire y);\n  assign y = a;\nendmodule\n";
    const [found] = body(source, "a");
    const line = source.split("\n")[found!.range.start.line]!;

    assert.equal(line.slice(found!.range.start.character, found!.range.end.character), "a");
  });
});

/* ------------------------------------------------------------------ *
 * Port boundary (cross-module connectivity)
 * ------------------------------------------------------------------ */

describe("port boundary", () => {
  const build = (files: Record<string, string>, entryName: string): Catalog => {
    const catalog = new Catalog();
    for (const [uri, source] of Object.entries(files)) {
      const analysis = analyzeTree(parser.parse(source), source);
      catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);
    }
    return catalog.get(entryName)!;
  };

  const childSource = [
    "module child(input wire clk, input wire din, output wire dout, output wire full);",
    "endmodule",
    "",
  ].join("\n");

  const parentSource = [
    "module parent(input wire clk, input wire d, output wire q);",
    "  wire inner;",
    "  child u_child (.clk(clk), .din(d), .dout(q), .full(inner));",
    "endmodule",
    "",
  ].join("\n");

  it("loads a net that reaches a submodule input", () => {
    // Seen from the net: `d` goes into the child's din, so the child reads it.
    const entry = build({ "file:///c.sv": childSource, "file:///p.sv": parentSource }, "parent");
    const loads = entry.accesses.filter((a) => a.name === "d" && a.source === "instance_input");

    assert.ok(
      loads.some((a) => a.kind === "load" && a.detail === "u_child.din"),
      `expected a load through u_child.din, got ${JSON.stringify(loads)}`,
    );
  });

  it("drives a net that comes from a submodule output", () => {
    const entry = build({ "file:///c.sv": childSource, "file:///p.sv": parentSource }, "parent");
    const drives = entry.accesses.filter((a) => a.name === "q" && a.source === "instance_output");

    assert.ok(
      drives.some((a) => a.kind === "drive" && a.detail === "u_child.dout"),
      `expected a drive through u_child.dout, got ${JSON.stringify(drives)}`,
    );
  });

  it("resolves directions across files, whichever order they are indexed", () => {
    // The parent is indexed first here, so the child's port list only exists
    // after the fact; resolution has to be deferred until the index settles.
    const forward = build({ "file:///c.sv": childSource, "file:///p.sv": parentSource }, "parent");
    const reverse = build({ "file:///p.sv": parentSource, "file:///c.sv": childSource }, "parent");

    const count = (e: NonNullable<ReturnType<Catalog["get"]>>): number =>
      e.accesses.filter((a) => a.source.startsWith("instance_")).length;

    assert.equal(count(forward), count(reverse));
    assert.ok(count(reverse) >= 2);
  });

  it("ignores a connection whose module is not indexed", () => {
    const source = [
      "module parent(input wire clk);",
      "  missing u_missing (.clk(clk), .dout(clk));",
      "endmodule",
      "",
    ].join("\n");

    const entry = build({ "file:///p.sv": source }, "parent");
    assert.deepEqual(
      entry.accesses.filter((a) => a.source.startsWith("instance_")),
      [],
      "without port directions there is nothing to classify, so nothing is guessed",
    );
  });

  it("reduces a selected binding to its net", () => {
    assert.equal(rootNameOf("push_data"), "push_data");
    assert.equal(rootNameOf("push_data[3:0]"), "push_data");
    assert.equal(rootNameOf("  .some_field"), undefined);
    assert.equal(rootNameOf("8'hff"), undefined);
  });
});

/* ------------------------------------------------------------------ *
 * Signal tracer
 * ------------------------------------------------------------------ */

describe("signal tracer", () => {
  const build = (files: Record<string, string>): Catalog => {
    const catalog = new Catalog();
    for (const [uri, source] of Object.entries(files)) {
      const analysis = analyzeTree(parser.parse(source), source);
      catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);
    }
    return catalog;
  };

  const leaf = "module leaf (input wire din, output wire dout);\n  assign dout = din;\nendmodule\n";
  const mid = [
    "module mid (input wire din, output wire dout);",
    "  wire inner;",
    "  leaf u_leaf (.din(inner), .dout(dout));",
    "  assign inner = din;",
    "endmodule",
    "",
  ].join("\n");
  const top = [
    "module top (input wire din, output wire dout);",
    "  wire chained;",
    "  mid u_mid (.din(din), .dout(chained));",
    "  leaf u_side (.din(chained), .dout(dout));",
    "endmodule",
    "",
  ].join("\n");

  const files = {
    "file:///leaf.sv": leaf,
    "file:///mid.sv": mid,
    "file:///top.sv": top,
  };

  const traceFrom = (moduleName: string, signal: string) =>
    traceSignal({ moduleName, uri: `file:///${moduleName}.sv`, signal }, build(files));

  it("reports drivers and loads in the starting module", () => {
    const hop = traceFrom("mid", "inner");

    assert.ok(hop);
    assert.equal(hop!.moduleName, "mid");
    assert.equal(hop!.signal, "inner");
    // `assign inner = din;` drives it, and `inner` is also bound to the leaf's
    // din, which is a second way for it to be driven.
    assert.ok(hop!.drivers.some((d) => d.source === "continuous_assign"));
    assert.ok(
      hop!.loads.some((l) => l.source === "instance_input" && l.detail === "u_leaf.din"),
      `u_leaf reads inner, got ${JSON.stringify(hop!.loads.map((l) => l.source))}`,
    );
  });

  it("renames the signal to the port name when crossing downwards", () => {
    const hop = traceFrom("mid", "inner");
    const child = hop!.children.find((c) => c.moduleName === "leaf");

    assert.ok(child, "the trace must reach the submodule");
    assert.equal(child!.signal, "din", "inner is bound to the leaf's din port");
    assert.deepEqual(child!.instancePath, ["u_leaf"]);
  });

  it("follows a signal up through an instantiation", () => {
    const hop = traceFrom("mid", "dout");
    const parent = hop!.children.find((c) => c.moduleName === "top");

    assert.ok(parent, "the trace must climb to the parent");
    assert.equal(parent!.direction, "up");
    assert.equal(parent!.signal, "chained", "dout is bound to the parent's chained net");
  });

  it("walks both directions from one hop", () => {
    const hop = traceFrom("mid", "inner");

    assert.ok(
      hop!.children.some((c) => c.direction === "down"),
      "down into the leaf",
    );
  });

  it("stops rather than looping when a module instantiates itself", () => {
    const recursive = [
      "module rec (input wire din, output wire dout);",
      "  rec u_self (.din(din), .dout(dout));",
      "endmodule",
      "",
    ].join("\n");

    const hop = traceFrom2(recursive, "rec", "din");
    const depth = (h: NonNullable<typeof hop>): number =>
      1 + Math.max(0, ...h.children.map(depth));

    assert.ok(depth(hop!) <= 6, `recursive trace must terminate, went ${depth(hop!)} deep`);
  });

  const traceFrom2 = (source: string, moduleName: string, signal: string) =>
    traceSignal(
      { moduleName, uri: `file:///${moduleName}.sv`, signal },
      build({ "file:///r.sv": source }),
    );

  it("respects the hop budget", () => {
    const hop = traceSignal(
      { moduleName: "top", uri: "file:///top.sv", signal: "din" },
      build(files),
      { maxHops: 1, maxNodes: 50 },
    );

    const total = countHops(hop);
    assert.ok(total <= 4, `budget exceeded: ${total} hops`);
  });

  it("marks a hop as truncated when a limit stopped it", () => {
    const hop = traceSignal(
      { moduleName: "top", uri: "file:///top.sv", signal: "din" },
      build(files),
      { maxHops: 1, maxNodes: 50 },
    );

    const anyTruncated = [...walkHops(hop)].some((h) => h.truncated);
    assert.ok(anyTruncated, "hitting the budget must be visible, not silent");
  });

  it("returns nothing for a module the index does not know", () => {
    assert.equal(traceFrom("ghost", "signal"), undefined);
  });

  it("finds the module that declares a signal under the cursor", () => {
    const source = "module outer(input wire a);\n  inner u (.x(a));\nendmodule\nmodule inner(input wire x);\nendmodule\n";
    const analysis = analyzeTree(parser.parse(source), source);
    const outer = analysis.scopes.find((s) => s.name === "outer")!;

    assert.equal(moduleOfSignal(analysis, "a", outer.selectionRange.start.line * 10)?.name, "outer");
  });
});

function* walkHops(hop: ReturnType<typeof traceSignal>): Generator<NonNullable<ReturnType<typeof traceSignal>>> {
  if (!hop) return;
  yield hop;
  for (const child of hop.children) yield* walkHops(child);
}

/* ------------------------------------------------------------------ *
 * RTL level (one module and its submodules)
 * ------------------------------------------------------------------ */

it("does not flag enum literals as unknown", () => {
  // `IDLE = 2'b00` declares the name; it is not a reference to something
  // declared elsewhere.
  const source = [
    "package p;",
    "  typedef enum logic [1:0] { IDLE = 2'b00, LOAD = 2'b01, STORE = 2'b10 } state_t;",
    "endpackage",
    "",
  ].join("\n");

  assert.deepEqual(diagnose(source, { unknownIdentifiers: true }), []);
});

it("declares an enum literal so hovering it resolves", () => {
  const source = "package p;\n  typedef enum { A = 0, B = 1 } t;\nendpackage\n";
  const analysis = analyzeTree(parser.parse(source), source);
  const names = analysis.scopes[0]!.symbols.map((s) => s.name);

  assert.ok(names.includes("A") && names.includes("B"), `got ${names.join(", ")}`);
});

it("does not flag struct members as unknown", () => {
  const source = [
    "package p;",
    "  typedef struct packed {",
    "    logic       valid;",
    "    logic [7:0] data;",
    "  } entry_t;",
    "endpackage",
    "",
  ].join("\n");

  assert.deepEqual(diagnose(source, { unknownIdentifiers: true }), []);
});

it("declares every name of a struct member", () => {
  // `logic valid, dirty;` is one member declaring two fields.
  const source = "package p;\n  typedef struct { logic valid, dirty; } t;\nendpackage\n";
  const analysis = analyzeTree(parser.parse(source), source);
  const names = analysis.scopes[0]!.symbols.map((s) => s.name);

  assert.ok(names.includes("valid"), `got ${names.join(", ")}`);
  assert.ok(names.includes("dirty"), `got ${names.join(", ")}`);
});

it("does not flag union members either", () => {
  const source = "package p;\n  typedef union { logic [31:0] w; logic [7:0] b; } u_t;\nendpackage\n";

  assert.deepEqual(diagnose(source, { unknownIdentifiers: true }), []);
});

it("still flags a name that is genuinely undeclared", () => {
  // The guard against over-correcting: adding struct members must not silence
  // real errors.
  const source = "package p;\n  typedef struct { logic valid; } t;\n  logic x = nowhere;\nendpackage\n";
  const found = diagnose(source, { unknownIdentifiers: true });

  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /nowhere/);
});

it("leaves a clean package with no diagnostics at all", () => {
  const source = [
    "// Shared types and constants.",
    "package counter_pkg;",
    "  localparam int AW = $clog2(16);",
    "  typedef enum logic [1:0] { IDLE = 2'b00, LOAD = 2'b01, STORE = 2'b10 } state_t;",
    "  typedef struct packed { logic valid; logic [7:0] data; } entry_t;",
    "endpackage : counter_pkg",
    "",
  ].join("\n");

  assert.deepEqual(diagnose(source, { unknownIdentifiers: true, widthMismatch: true }), []);
});

it("builds a file uri with exactly three slashes", () => {
  // Prefix `file://` onto an already-absolute path and you get `file:////...`,
  // which is a different uri: every lookup by uri then misses, and a jump to
  // another file silently does nothing.
  assert.equal(pathToUri("/Users/dev/top.sv"), "file:///Users/dev/top.sv");
  assert.equal(pathToUri("/a/b/c.sv"), "file:///a/b/c.sv");

  const uri = pathToUri("/Users/dev/my design.sv");
  assert.equal(uri, "file:///Users/dev/my%20design.sv", "spaces are escaped");
  assert.ok(isUsableUri(uri), "and it must survive the parser's checks");
});

it("does not double the leading slash", () => {
  const uri = pathToUri("/x.sv");
  assert.equal(uri.split("/").filter((s) => s === "").length, 2, "scheme plus one empty segment");
});

it("puts other-file modules under one heading", () => {
  // The root is about the file being edited; everything reached outside it
  // belongs under one row, so reading top to bottom answers "here" first.
  const [root] = traceTree({
    moduleName: "top",
    uri: "file:///top.sv",
    range: zeroRange(),
    instancePath: [],
    signal: "push_data",
    direction: "start",
    drivers: [],
    loads: [],
    truncated: false,
    children: [
      {
        moduleName: "fifo",
        uri: "file:///fifo.sv",
        range: zeroRange(),
        instancePath: ["u_fifo"],
        signal: "din",
        direction: "down",
        drivers: [],
        loads: [],
        truncated: false,
        children: [],
      },
    ],
  });

  const groups = root!.children!;
  const elsewhere = groups.find((n) => n.kind === "elsewhere")!;

  assert.ok(elsewhere, "another file needs its own heading");
  assert.equal(elsewhere.icon, "arrow-down");
  assert.equal(elsewhere.children!.length, 1);
  assert.equal(elsewhere.children![0]!.kind, "hop", "and the module sits inside it");
});

it("leaves a module from the same file out of that heading", () => {
  // A sibling module declared in the same file is still "here".
  const [root] = traceTree({
    moduleName: "top",
    uri: "file:///top.sv",
    range: zeroRange(),
    instancePath: [],
    signal: "s",
    direction: "start",
    drivers: [],
    loads: [],
    truncated: false,
    children: [
      {
        moduleName: "helper",
        uri: "file:///top.sv",
        range: zeroRange(),
        instancePath: ["u_helper"],
        signal: "s",
        direction: "down",
        drivers: [],
        loads: [],
        truncated: false,
        children: [],
      },
    ],
  });

  assert.equal(
    root!.children!.filter((n) => n.kind === "elsewhere").length,
    0,
    "same file means no heading",
  );
  assert.ok(root!.children!.some((n) => n.kind === "hop"), "it appears inline instead");
});

it("names the file every row came from", () => {
  const [root] = traceTree({
    moduleName: "top",
    uri: "file:///a/top.sv",
    range: zeroRange(),
    instancePath: [],
    signal: "s",
    direction: "start",
    drivers: [],
    loads: [],
    truncated: false,
    children: [],
  });

  assert.match(root!.description!, /top\.sv/);
});

it("resolves the module against the file the trace started in", () => {
  // Two files declaring `top`: asking for `top` by name alone answers with
  // whichever the index saw first, which is the wrong one. The trace knows
  // which file the user is editing and has to use it.
  const real = "module top(input wire din, output wire dout);\n  child u_child (.din(din), .dout(dout));\nendmodule\n";
  const decoy = "module top(output wire dout);\n  assign dout = decoy_value;\nendmodule\n";
  const child = "module child(input wire din, output wire dout);\nendmodule\n";

  const catalog = new Catalog();
  // Decoy indexed first, exactly as the alphabetical walk does.
  for (const [uri, source] of [
    ["file:///decoy.sv", decoy],
    ["file:///real.sv", real],
    ["file:///child.sv", child],
  ] as const) {
    const analysis = analyzeTree(parser.parse(source), source);
    catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);
  }

  const hop = traceSignal({ moduleName: "top", uri: "file:///real.sv", signal: "dout" }, catalog)!;

  assert.equal(hop.uri, "file:///real.sv", "the entry from the file being edited");
  assert.deepEqual(
    hop.drivers.map((d) => d.source),
    ["instance_output"],
    "dout is driven by the submodule's output port",
  );
  assert.ok(
    !hop.drivers.some((d) => d.detail.includes("decoy_value")),
    "the other file's body must not leak in",
  );
});

it("does not climb into a same-named module declared elsewhere", () => {
  // `has_issues.sv` in the sample declares its own `top`; tracing from the
  // real top.sv must not treat that one as a parent of itself.
  const real = "module top(input wire din, output wire dout);\n  child u_child (.din(din), .dout(dout));\nendmodule\n";
  const child = "module child(input wire din, output wire dout);\nendmodule\n";
  const decoy = "module top(input wire d);\n  child u_x (.din(d), .dout());\nendmodule\n";

  const catalog = new Catalog();
  for (const [uri, source] of [
    ["file:///real.sv", real],
    ["file:///child.sv", child],
    ["file:///decoy.sv", decoy],
  ] as const) {
    const analysis = analyzeTree(parser.parse(source), source);
    catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);
  }

  const hop = traceSignal({ moduleName: "top", uri: "file:///real.sv", signal: "din" }, catalog)!;
  const parents = hop.children.filter((c) => c.direction === "up");

  assert.deepEqual(parents, [], "the module in another file is not a parent of this one");
});

    /* ------------------------------------------------------------------ *
 * Crossing into an interface instance
 * ------------------------------------------------------------------ */

describe("interface traversal", () => {
  const iface = [
    "interface dsp_if #(parameter int W = 13) (input logic clk);",
    "  logic        global_rst_n;",
    "  logic [31:0] adc_in;",
    "  logic [15:0] mux_data_out;",
    "  modport master (input clk, output adc_in);",
    "endinterface",
    "",
  ].join("\n");

  const build = (tb: string) => {
    const catalog = new Catalog();
    for (const [uri, source] of [["file:///dsp_if.sv", iface], ["file:///tb.sv", tb]] as const) {
      const analysis = analyzeTree(parser.parse(source), source);
      catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);
    }
    return catalog;
  };

  const at = (source: string, needle: string, plus = 0): number =>
    source.indexOf(needle) + needle.length - 1 + plus;

  it("splits a dotted reference into its segments", () => {
    const source = "module tb;\n  dsp_if ifc ();\n  initial $display(ifc.adc_in);\nendmodule\n";
    const analysis = analyzeTree(parser.parse(source), source);

    let target;
    const walk = (n: any): void => {
      if (n.type === "hierarchical_identifier" && n.text === "ifc.adc_in") target = n;
      for (const c of n.namedChildren) walk(c);
    };
    walk(analysis.parseTree.rootNode);

    assert.deepEqual(pathOf(target)?.map((s) => s.name), ["ifc", "adc_in"]);
  });

  it("treats a single name as not a path", () => {
    // This grammar wraps even a lone name in `hierarchical_identifier`, so the
    // segment count is the only thing that tells a path from a plain symbol.
    const source = "module tb;\n  logic x;\n  initial x = 1'b0;\nendmodule\n";
    const analysis = analyzeTree(parser.parse(source), source);

    const use = analysis.uses.find((u) => u.name === "x" && u.context === "hierarchical_identifier");
    assert.ok(use, "the grammar wraps a lone name too");

    let node;
    const walk = (n: any): void => {
      if (n.type === "simple_identifier" && n.text === "x" && n.startPosition.row === 2) node = n;
      for (const c of n.namedChildren) walk(c);
    };
    walk(analysis.parseTree.rootNode);

    assert.equal(pathOf(node), undefined, "one segment is not a path");
  });

  it("resolves a member of an interface instance", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial $display(DUT_if.adc_in);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const analysis = analyzeTree(parser.parse(tb), tb);
    const offset = at(tb, "DUT_if.adc_", 1);

    const node = identifierAt(analysis, offset);
    const resolved = resolvePath(node, analysis, catalog, "file:///tb.sv");

    assert.ok(resolved, "the interface member must resolve");
    assert.equal(resolved!.symbol.name, "adc_in");
    assert.equal(resolved!.symbol.packedWidth, 32);
    assert.equal(resolved!.uri, "file:///dsp_if.sv", "declared in the interface's file");
    assert.equal(resolved!.viaInterface, true);
    assert.equal(resolved!.instance, "DUT_if");
  });

  it("shows the type and width on hover", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial $display(DUT_if.adc_in);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const analysis = analyzeTree(parser.parse(tb), tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);

    const hover = provideHover(document, analysis, catalog, at(tb, "DUT_if.adc_", 1), {
      showWidth: true,
      showType: true,
    });

    assert.ok(hover, "hover must answer for an interface member");
    const value = (hover!.contents as { value: string }).value;
    assert.match(value, /32 bits/);
    assert.match(value, /DUT_if/);
    assert.match(value, /dsp_if\.sv/);
  });

  it("jumps to the declaration inside the interface", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial $display(DUT_if.adc_in);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const analysis = analyzeTree(parser.parse(tb), tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);

    const definition = provideDefinition(document, analysis, catalog, at(tb, "DUT_if.adc_", 1));
    const location = Array.isArray(definition) ? definition[0]! : definition!;

    assert.ok(location, "go to definition must answer");
    assert.equal(location.uri, "file:///dsp_if.sv", "not the reading file");
    assert.equal(location.range.start.line, 2, "the `adc_in` line");
  });

  it("prefers a local signal of the same name over a path", () => {
    // Local lookup runs first, so an inner `adc_in` still shadows.
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  logic [7:0] adc_in;",
      "  initial $display(adc_in);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const analysis = analyzeTree(parser.parse(tb), tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);

    const definition = provideDefinition(document, analysis, catalog, at(tb, "$display(adc_in)"));
    const location = Array.isArray(definition) ? definition[0]! : definition!;

    assert.equal(location?.uri, "file:///tb.sv");
  });

  it("offers the interface's members after `DUT_if.`", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial begin",
      "    DUT_if.",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const analysis = analyzeTree(parser.parse(tb), tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);

    const cursor = tb.indexOf("    DUT_if.") + "    DUT_if.".length;
    const list = provideCompletion(
      { analysis, document, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true },
    );

    const labels = list.items.map((i) => i.label);
    assert.ok(labels.includes("adc_in"), `expected interface members, got ${labels.join(", ")}`);
    assert.ok(labels.includes("global_rst_n"));
    assert.ok(
      list.items.find((i) => i.label === "adc_in")?.detail?.includes("32 bits"),
      "with their width",
    );
  });

  it("does not offer members after a plain signal", () => {
    const tb = "module tb;\n  logic [7:0] plain;\n  initial plain.\nendmodule\n";
    const analysis = analyzeTree(parser.parse(tb), tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);

    const cursor = tb.indexOf("plain.", "initial") + "plain.".length;
    const list = provideCompletion(
      { analysis, document, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      new Catalog(),
      { showWidth: true, showType: true },
    );

    assert.ok(
      !list.items.some((i) => i.label === "adc_in"),
      "only instances of a known unit get a member list",
    );
  });

  it("reports a member the interface does not declare", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial $display(DUT_if.nonexistent_signal);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);
    const analysis = analyzeTree(parser.parse(tb), tb);

    const found = computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

    assert.equal(found.length, 1, "a typo is worth a finding");
    assert.match(found[0]!.message, /nonexistent_signal/);
    assert.match(found[0]!.message, /DUT_if/);
  });

  it("does not report the segments of a path that does resolve", () => {
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial begin",
      "    $display(DUT_if.adc_in);",
      "    force DUT_if.global_rst_n = 1'b1;",
      "    DUT_if.mux_data_out = 16'h0;",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);
    const analysis = analyzeTree(parser.parse(tb), tb);

    const found = computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

    assert.deepEqual(found.map((d) => d.message), []);
  });

  it("blames only the segment where the walk stopped", () => {
    // `typo` is not a member of the interface; `adc_in` is, but the walk never
    // reaches it. Only the failure is a finding.
    const tb = [
      "module tb;",
      "  dsp_if DUT_if (.clk(1'b0));",
      "  initial $display(DUT_if.typo.adc_in);",
      "endmodule",
      "",
    ].join("\n");

    const catalog = build(tb);
    const document = TextDocument.create("file:///tb.sv", "systemverilog", 1, tb);
    const analysis = analyzeTree(parser.parse(tb), tb);

    const found = computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /`typo`/);
  });
});

/* ------------------------------------------------------------------ *
 * Verilog-1995 ports
 * ------------------------------------------------------------------ */

describe("Verilog-1995 port declarations", () => {
  const ports = (source: string) =>
    analyzeTree(parser.parse(source), source).scopes[0]?.ports ?? [];

  it("reads direction and width from the body, not the header", () => {
    const found = ports(
      [
        "module chrgu(clk, rg_add, rg_din, rg_dout, K1);",
        "  input               clk;",
        "  input      [5:0]    rg_add;",
        "  input      [12:0]   rg_din;",
        "  output reg [12:0]   rg_dout;",
        "  output reg [12:0]   K1;",
        "endmodule",
        "",
      ].join("\n"),
    );

    assert.deepEqual(found.map((p) => p.name), ["clk", "rg_add", "rg_din", "rg_dout", "K1"]);
    assert.deepEqual(found.map((p) => p.direction), ["input", "input", "input", "output", "output"]);
    // `input clk;` declares no type and no range, so it is an implicitly typed
    // one-bit wire -- stating 1 is the fact; saying nothing would read as "not
    // understood".
    assert.deepEqual(found.map((p) => p.packedWidth), [1, 6, 13, 13, 13]);
  });

  it("keeps reg out of the declared type", () => {
    const [rgDout] = ports("module m(q);\n  output reg [12:0] q;\nendmodule\n");

    assert.equal(rgDout!.packedWidth, 13);
    assert.ok(!rgDout!.typeText.includes("reg"), "the storage keyword is not a type");
  });

  it("carries a range across a comma-separated declaration", () => {
    const found = ports("module m(K1, K2, ZSTHR);\n  output reg [12:0] K1, K2;\n  output reg [11:0] ZSTHR;\nendmodule\n");

    assert.deepEqual(found.map((p) => `${p.name}:${p.packedWidth}`), [
      "K1:13",
      "K2:13",
      "ZSTHR:12",
    ]);
  });

  it("does not promote a body declaration missing from the header", () => {
    // `internal` is declared in the body but not listed in the header, so it is
    // a plain net, not a port.
    const found = ports("module m(a, b);\n  input a;\n  output b;\n  wire internal;\nendmodule\n");

    assert.deepEqual(found.map((p) => p.name), ["a", "b"]);
  });

  it("still reads an ANSI header unchanged", () => {
    const found = ports("module m(input wire [7:0] a, output reg [3:0] b);\nendmodule\n");

    assert.deepEqual(found.map((p) => `${p.name}:${p.direction}:${p.packedWidth}`), [
      "a:input:8",
      "b:output:4",
    ]);
  });

  it("lists them in the navigator with their width", () => {
    const result = buildNavigator(
      analyzeTree(
        parser.parse("module m(a, b);\n  input [5:0] a;\n  output reg [12:0] b;\nendmodule\n"),
        "x",
      ),
    );

    const inputs = result.groups.find((g) => g.label === "Inputs")!;
    assert.deepEqual(inputs.signals.map((s) => `${s.name}:${s.sizeText}`), ["a:6 bits"]);
  });
});

/* ------------------------------------------------------------------ *
 * Hierarchical references
 * ------------------------------------------------------------------ */

describe("hierarchical references", () => {
  it("does not report the segments of a dotted path as unknown", () => {
    const source = [
      "module tb;",
      "  genvar i;",
      "  child u_child (.x(1'b0));",
      "  initial begin",
      "    force u_child.a.b.c = 0;",
      "    force u_child.i.sig = 1'b1;",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    assert.deepEqual(diagnose(source, { unknownIdentifiers: true }), []);
  });

  it("accepts force and release into an instance", () => {
    const source = [
      "module tb;",
      "  genvar i;",
      "  child u_child (.x(1'b0));",
      "  initial begin",
      "    force u_child.a.b.c = 0;",
      "    release u_child.a.b.c;",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    assert.deepEqual(diagnose(source, { unknownIdentifiers: true }), []);
  });

  it("still reports a genuinely undeclared root of a path", () => {
    const source = "module tb;\n  initial nothing.here = 0;\nendmodule\n";
    const found = diagnose(source, { unknownIdentifiers: true });

    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /`nothing`/);
  });

  it("does not ask the author to list a dotted path in a sensitivity list", () => {
    // `always @(DUT.u.x)` already says what it watches; `DUT`, `u` and `x` are
    // not local signals the author could add.
    const source = [
      "module tb;",
      "  child u_child ();",
      "  reg q;",
      "  always @(u_child.go) q = u_child.gi;",
      "endmodule",
      "",
    ].join("\n");

    assert.deepEqual(diagnose(source, { implicitSensitivity: true }), []);
  });
});

/* ------------------------------------------------------------------ *
 * Navigator
 * ------------------------------------------------------------------ */

describe("navigator", () => {
  const nav = (source: string) => buildNavigator(analyzeTree(parser.parse(source), source));

  const group = (result: ReturnType<typeof nav>, label: string) =>
    result.groups.find((g) => g.label === label);

  const names = (result: ReturnType<typeof nav>, label: string) =>
    group(result, label)?.signals.map((s) => s.name) ?? [];

  const sample = [
    "module m #(",
    "  parameter int W = 8",
    ") (",
    "  input  wire       clk,",
    "  input  wire [7:0] din,",
    "  output wire [7:0] dout,",
    "  output reg        hit",
    ");",
    "  wire       shared;",
    "  logic [W-1:0] counter;",
    "  logic [7:0] mem [0:15];",
    "  child u_child (.din(din), .dout(dout));",
    "endmodule",
    "",
  ].join("\n");

  it("groups ports by direction", () => {
    const result = nav(sample);

    assert.deepEqual(names(result, "Inputs"), ["clk", "din"]);
    assert.deepEqual(names(result, "Outputs"), ["dout", "hit"]);
  });

  it("keeps the header order rather than sorting it", () => {
    // A port list is read left to right; alphabetising it would lose that.
    const result = nav("module m(input wire z, input wire a, output wire y);\nendmodule\n");
    assert.deepEqual(names(result, "Inputs"), ["z", "a"]);
  });

  it("shows the resolved width of a signal", () => {
    const result = nav(sample);
    const din = group(result, "Inputs")!.signals.find((s) => s.name === "din")!;

    assert.equal(din.width, 8);
    assert.equal(din.sizeText, "8 bits");
  });

  it("says one bit rather than 1 bits", () => {
    const result = nav(sample);
    const clk = group(result, "Inputs")!.signals.find((s) => s.name === "clk")!;

    assert.equal(clk.sizeText, "1 bit");
  });

  it("shows both dimensions of an unpacked array", () => {
    // `logic [7:0] mem [0:15]` is 16 elements of 8 bits: showing only the
    // element width would understate it by 16x.
    const result = nav(sample);
    const mem = group(result, "Registers")!.signals.find((s) => s.name === "mem")!;

    assert.equal(mem.elements, 16);
    assert.equal(mem.width, 8);
    assert.equal(mem.sizeText, "16 x 8 bits");
  });

  it("folds a parameter into the width it drives", () => {
    const result = nav(sample);
    const counter = group(result, "Registers")!.signals.find((s) => s.name === "counter")!;

    assert.equal(counter.width, 8, "W = 8");
  });

  it("lists parameters and instances", () => {
    const result = nav(sample);

    assert.deepEqual(names(result, "Parameters"), ["W"]);
    assert.deepEqual(names(result, "Instances"), ["u_child"]);
  });

  it("names the module an instance instantiates", () => {
    const result = nav(sample);
    const inst = group(result, "Instances")!.signals[0]!;

    assert.equal(inst.typeName, "child");
  });

  it("omits groups with nothing in them", () => {
    // A module with no parameters should not show an empty Parameters group.
    const result = nav("module m(input wire a);\nendmodule\n");

    assert.deepEqual(result.groups.map((g) => g.label), ["Inputs"]);
  });

  it("leaves out an import, which is not a signal", () => {
    const result = nav("package p;\n  typedef enum { A = 0 } t;\nendpackage\nmodule m;\n  import p::*;\nendmodule\n");

    assert.ok(
      !result.groups.some((g) => g.signals.some((s) => s.name === "p")),
      "an import must not be listed as a declaration",
    );
  });

  it("reports a file that declares nothing", () => {
    const result = nav("// just a comment\n");

    assert.equal(result.empty, true);
    assert.deepEqual(result.groups, []);
  });

  it("lists every design unit of the file separately", () => {
    const result = nav("module a(input wire x);\nendmodule\nmodule b(output wire y);\nendmodule\n");

    assert.deepEqual(result.units.map((u) => u.name), ["a", "b"]);
    assert.deepEqual(names(result, "Inputs"), ["x"]);
    assert.deepEqual(names(result, "Outputs"), ["y"]);
  });
});

/* ------------------------------------------------------------------ *
 * RTL viewer rendering
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Sidebar tree shaping
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Sidebar robustness
 * ------------------------------------------------------------------ */

describe("sidebar robustness", () => {
  const hop = (over: Partial<TraceHop> = {}): TraceHop => ({
    moduleName: "top",
    uri: "file:///top.sv",
    instancePath: [],
    signal: "s",
    direction: "start",
    drivers: [],
    loads: [],
    truncated: false,
    children: [],
    ...over,
  });

  it("keeps a trace hop that has no file behind it", () => {
    // The regression behind the UriError: a trace started from the viewer has
    // no editor open, so the hop arrives with an empty uri.
    const [root] = traceTree(
      hop({
        uri: "",
        loads: [
          {
            name: "s",
            scopeId: 0,
            kind: "load",
            range: zeroRange(),
            source: "continuous_assign",
            detail: "assign y = s;",
            moduleName: "top",
            uri: "",
          },
        ],
      }),
    );

    const access = root!.children![0]!.children![0];
    assert.equal(access!.kind, "access", "the load is still listed");
    assert.equal(access!.target, undefined, "but there is nowhere to jump to");
  });

  it("gives an access a jump target only when it has a file", () => {
    const [root] = traceTree(
      hop({
        uri: "file:///top.sv",
        loads: [
          {
            name: "s",
            scopeId: 0,
            kind: "load",
            range: zeroRange(),
            source: "continuous_assign",
            detail: "assign y = s;",
            moduleName: "top",
            uri: "file:///top.sv",
          },
        ],
      }),
    );

    const access = root!.children![0]!.children![0]!;
    assert.ok(access.target, "a valid file gives somewhere to jump");
    assert.equal(access.target!.uri, "file:///top.sv");
  });

  it("shows a placeholder rather than an empty list when a signal is unknown", () => {
    // An unknown module must not leave the tree blank: a blank tree reads as a
    // broken feature rather than as "nothing found".
    assert.ok(emptyTrace().length > 0);

    const nodes = unknownSignal("mystery");
    assert.match(nodes[0]!.label, /mystery not found/);
    assert.ok(nodes[0]!.tooltip, "and the hover must say why");
  });

  it("rejects a uri that would make Uri.parse throw", () => {
    // `vscode-uri` refuses a path that starts with `//` with no authority,
    // which is the exact UriError that surfaced when clicking a net.
    // A scheme-less value is also refused: it names no file here.
    assert.equal(isUsableUri("//"), false, "no scheme, no authority, no path");
    assert.equal(isUsableUri(""), false, "an empty uri names no file");
    assert.equal(isUsableUri("a.sv"), false, "a bare path names no file");

    for (const value of ["file:///a.sv", "untitled:Untitled-1", "file://host/share/a.sv"]) {
      assert.equal(isUsableUri(value), true, value);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Hierarchy webview rendering
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Verilog-1995 / vendor styles
 * ------------------------------------------------------------------ */

describe("Verilog-1995 / vendor styles", () => {
  const source = `\`ifndef GUARD_V
\`define GUARD_V

module prepkt_fifo #(parameter SIZE = 16) (
    input  [11:0] sample,
    input  ZS_KEEPME_i, TM_KEEPME_i,
    output [ 3:0] FG_CALIB_o, FG_CALIB_o2,
    output ZS_KEEPME_o, TM_KEEPME_o,
    input  clk,
    input  rst
);
reg [3:0] cnt_fill;
wire add_fill;
assign add_fill = (cnt_fill < SIZE) && ZS_KEEPME_i && !TM_KEEPME_i;
always @(posedge clk)
    if (!rst) cnt_fill <= 4'd0;
    else cnt_fill <= cnt_fill + 1;
endmodule

\`endif
`;

  it("applies a bare direction to every following name", () => {
    const f = fixture(source);
    const ports = f.analysis.scopes[0]!.ports;

    // `input ZS_KEEPME_i, TM_KEEPME_i` makes both inputs.
    assert.equal(ports.find((p) => p.name === "ZS_KEEPME_i")?.direction, "input");
    assert.equal(ports.find((p) => p.name === "TM_KEEPME_i")?.direction, "input");

    assert.equal(ports.find((p) => p.name === "FG_CALIB_o")?.direction, "output");
    assert.equal(ports.find((p) => p.name === "FG_CALIB_o2")?.direction, "output");
    assert.equal(ports.find((p) => p.name === "ZS_KEEPME_o")?.direction, "output");
  });

  it("carries the packed range across a comma-separated group", () => {
    const f = fixture(source);
    const ports = f.analysis.scopes[0]!.ports;
    assert.equal(ports.find((p) => p.name === "FG_CALIB_o")?.packedWidth, 4);
    assert.equal(ports.find((p) => p.name === "FG_CALIB_o2")?.packedWidth, 4);
    assert.equal(ports.find((p) => p.name === "sample")?.packedWidth, 12);
  });

  it("does not report the direction as the type of a bare port", () => {
    const f = fixture(source);
    for (const port of f.analysis.scopes[0]!.ports) {
      assert.notEqual(port.typeText, port.direction, `${port.name}`);
    }
  });

  it("treats an untyped range as implicit, not as a type name", () => {
    const f = fixture(source);
    const sample = f.symbol("sample");
    assert.equal(sample?.packedRangeText, "11:0");
    // `input [11:0] a` declares a range but no type.
    assert.equal(sample?.typeText, "");
  });

  it("does not flag macro names as unknown identifiers", () => {
    const f = fixture(source);
    const unknown = [
      ...(f.analysis.identifiers.get("GUARD_V") ?? []),
    ];
    void unknown;
    const result = computeDiagnostics(
      f.document,
      f.analysis,
      new Catalog(),
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: true,
        blockingInSequential: true,
        implicitSensitivity: true,
        latchDetection: true,
      },
    );
    assert.deepEqual(
      result.filter((d) => d.code === "unknown-identifier"),
      [],
    );
  });

  it("does not flag a clocked block as an incomplete sensitivity list", () => {
    const f = fixture(source);
    const result = computeDiagnostics(
      f.document,
      f.analysis,
      new Catalog(),
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: true,
        blockingInSequential: true,
        implicitSensitivity: true,
        latchDetection: true,
      },
    );
    assert.deepEqual(
      result.filter((d) => d.code === "implicit-sensitivity"),
      [],
    );
  });

  it("does not flag the accumulator pattern as truncation", () => {
    const f = fixture(source);
    const result = computeDiagnostics(
      f.document,
      f.analysis,
      new Catalog(),
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: true,
        blockingInSequential: true,
        implicitSensitivity: true,
        latchDetection: true,
      },
    );
    assert.deepEqual(
      result.filter((d) => d.code === "width-mismatch"),
      [],
    );
  });

  it("leaves this file with no diagnostics at all", () => {
    const f = fixture(source);
    const result = computeDiagnostics(
      f.document,
      f.analysis,
      new Catalog(),
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: true,
        blockingInSequential: true,
        implicitSensitivity: true,
        latchDetection: true,
      },
    );
    assert.deepEqual(result, []);
  });
});

/* ------------------------------------------------------------------ *
 * Snippet integrity
 * ------------------------------------------------------------------ */

/**
 * Expands snippet placeholders the way VS Code does on accept, so the result
 * can be fed back to the parser.
 *
 * Placeholder defaults are substituted, and bare tabstops (`$1`, `$0`) are
 * removed: they mark positions the user is expected to fill, so leaving them
 * out checks the snippet's own structure rather than the user's typing.
 */
function expandSnippet(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const char = body[i]!;

    if (char === "\\") {
      out += body[i + 1] ?? "";
      i += 2;
      continue;
    }

    if (char === "$" && body[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === "\\") {
          j += 2;
          continue;
        }
        if (body[j] === "$" && body[j + 1] === "{") {
          depth++;
          j += 2;
          continue;
        }
        if (body[j] === "}") depth--;
        j++;
      }
      const inner = body.slice(i + 2, j - 1);
      const colon = inner.indexOf(":");
      const fallback = inner.slice(colon + 1);
      out += expandSnippet(fallback === inner ? "x" : fallback);
      i = j;
      continue;
    }

    if (char === "$" && /[0-9]/.test(body[i + 1] ?? "")) {
      // A bare tabstop marks a position the user fills in.
      i += 2;
      continue;
    }

    out += char;
    i++;
  }
  return out;
}

describe("snippet output", () => {
  const items = staticCompletionItems({ snippets: true, systemFunctions: true });
  const snippets = items.filter((i) => i.insertTextFormat === InsertTextFormat.Snippet);

  it("has unique labels", () => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
    const duplicates = [...counts].filter(([, n]) => n > 1).map(([label]) => label);
    assert.deepEqual(duplicates, [], "duplicate labels collapse in the suggest widget");
  });

  it("distinguishes snippet variants by label", () => {
    const labels = snippets.map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.includes("always_ff"));
    assert.ok(labels.includes("always_ff_simple"));
  });

  it("has balanced snippet placeholders", () => {
    // An unterminated `${n:...}` makes VS Code swallow the rest of the
    // snippet as the placeholder's default text, producing garbage output.
    // Literal braces from the language itself are fine and are ignored here.
    const bad: string[] = [];

    for (const item of snippets) {
      const body = item.insertText ?? "";
      let index = 0;
      while (index < body.length) {
        const char = body[index];
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char !== "$" || body[index + 1] !== "{") {
          index++;
          continue;
        }

        let depth = 1;
        let cursor = index + 2;
        while (cursor < body.length && depth > 0) {
          if (body[cursor] === "\\") {
            cursor += 2;
            continue;
          }
          if (body[cursor] === "$" && body[cursor + 1] === "{") {
            depth++;
            cursor += 2;
            continue;
          }
          if (body[cursor] === "}") depth--;
          cursor++;
        }

        if (depth !== 0) bad.push(`${item.label}: unterminated \${...} at offset ${index}`);
        index = cursor;
      }
    }

    assert.deepEqual(bad, []);
  });

  it("expands every snippet to parseable SystemVerilog", () => {
    const broken: string[] = [];

    for (const snippet of snippets) {
      const expanded = expandSnippet(snippet.insertText ?? "");
      const tree = parser.parse(expanded);
      if (tree.rootNode.hasError) {
        broken.push(`${snippet.label}:\n${expanded}`);
      }
    }

    assert.deepEqual(broken, []);
  });
});

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

/** Diagnostic configuration shared by the tests that build their own fixture. */
const DIAG = {
  enable: true,
  unknownIdentifiers: true,
  widthMismatch: true,
  blockingInSequential: true,
  implicitSensitivity: true,
  latchDetection: true,
};

function diagnose(source: string, overrides: Partial<DiagnosticSettings> = {}) {
  const document = TextDocument.create("file:///test/d.sv", "systemverilog", 1, source);
  const tree = parser.parse(source);
  const analysis = analyzeTree(tree, source);
  return computeDiagnostics(document, analysis, new Catalog(), {
    enable: true,
    unknownIdentifiers: true,
    widthMismatch: true,
    blockingInSequential: true,
    implicitSensitivity: true,
    latchDetection: true,
    ...overrides,
  });
}

describe("diagnostics", () => {
  it("flags an unknown identifier", () => {
    const result = diagnose(`
module m (input logic a);
  logic b;
  assign b = a + undefined_signal;
endmodule
`);
    const found = result.find((d) => d.code === "unknown-identifier");
    assert.ok(found, "expected an unknown-identifier diagnostic");
    assert.match(found.message, /undefined_signal/);
  });

  it("flags a width mismatch that truncates", () => {
    const result = diagnose(`
module m (input logic [15:0] din);
  logic [7:0] narrow;
  assign narrow = din;
endmodule
`);
    const found = result.find((d) => d.code === "width-mismatch");
    assert.ok(found, "expected a width-mismatch diagnostic");
    assert.match(found.message, /'narrow' is 8 bits but the right-hand side is 16 bits/);
    assert.match(found.message, /8 bits are discarded/);
  });

  it("does not flag zero-extension, which is ordinary RTL", () => {
    // `count <= count + 1'b1` and small constants assigned to wide targets are
    // the most common lines in RTL; warning on them buries real findings.
    const result = diagnose(`
module m #(parameter int W = 8) (
  input  wire          clk,
  output logic [W-1:0] count
);
  logic [W-1:0] wide;
  assign wide = 8'hFF;
  always_ff @(posedge clk) count <= count + 1'b1;
endmodule
`);
    assert.equal(result.find((d) => d.code === "width-mismatch"), undefined);
  });

  it("handles unsized literals without crashing", () => {
    // Regression: parsing `'0` once threw, which took down the whole
    // diagnostics pass for the file.
    const result = diagnose(`
module m (input wire clk, input wire rst_n, output logic [7:0] q);
  logic [7:0] r;
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      r <= '0;
      q <= '1;
    end else begin
      r <= r;
      q <= q;
    end
  end
endmodule
`);
    assert.deepEqual(result, []);
  });

  it("does not flag matching widths", () => {
    const result = diagnose(`
module m (input logic [7:0] din);
  logic [7:0] copy;
  assign copy = din;
endmodule
`);
    assert.equal(result.find((d) => d.code === "width-mismatch"), undefined);
  });

  it("flags blocking assignments inside always_ff", () => {
    const result = diagnose(`
module m (input logic clk, input logic d, output logic q);
  always_ff @(posedge clk) q = d;
endmodule
`);
    assert.ok(result.some((d) => d.code === "sequential-blocking"));
  });

  it("allows non-blocking assignments inside always_ff", () => {
    const result = diagnose(`
module m (input logic clk, input logic d, output logic q);
  always_ff @(posedge clk) q <= d;
endmodule
`);
    assert.equal(result.some((d) => d.code === "sequential-blocking"), false);
  });

  it("does not report an instance name as an unknown identifier", () => {
    const result = diagnose(`
module top (input wire clk, output wire q);
  child #(.W(8)) u_child (.clk(clk), .dout(q));
endmodule
`);
  assert.equal(
    result.find((d) => d.code === "unknown-identifier" && /u_child/.test(d.message)),
    undefined,
  );
});

it("does not treat an assignment target as a read in the sensitivity check", () => {
  const result = diagnose(`
module m (input wire clk, input wire a, output wire y);
  always @(a) y = a;
endmodule
`);
  const found = result.find((d) => d.code === "implicit-sensitivity");
  assert.equal(found, undefined, "only `a` is read, and it is listed");
});

it("flags an incomplete sensitivity list", () => {
    const result = diagnose(`
module m (input logic a, input logic b, output logic y);
  always @(a) y = a | b;
endmodule
`);
    const found = result.find((d) => d.code === "implicit-sensitivity");
    assert.ok(found, "expected an implicit-sensitivity diagnostic");
    assert.match(found.message, /`b`/);
  });

  it("flags a latch inferred by an incomplete if", () => {
    const result = diagnose(`
module m (input logic sel, input logic [7:0] d, output logic [7:0] y);
  always_comb begin
    if (sel) y = d;
  end
endmodule
`);
    const found = result.find((d) => d.code === "latch-inference");
    assert.ok(found, "expected a latch diagnostic");
    assert.match(found.message, /`y`/);
  });

  it("does not flag a latch when both branches assign", () => {
    const result = diagnose(`
module m (input logic sel, input logic [7:0] d, output logic [7:0] y);
  always_comb begin
    if (sel) y = d;
    else     y = 8'h00;
  end
endmodule
`);
    assert.equal(result.some((d) => d.code === "latch-inference"), false);
  });

  it("accepts clean RTL without warnings", () => {
    const result = diagnose(`
module m (
  input  logic clk,
  input  logic rst_n,
  input  logic [7:0] din,
  output logic [7:0] dout
);
  always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n) dout <= 8'h00;
    else        dout <= din;
  end
endmodule
`);
    assert.deepEqual(result, []);
  });
});
/* ------------------------------------------------------------------ *
 * Classes and cross-file packages
 * ------------------------------------------------------------------ */

describe("SystemVerilog classes", () => {
  const CLASSES = [
    "class Packet #(parameter int W = 8);",
    "  rand  bit [W-1:0] payload;",
    "  int                 id;",
    "  static int          count = 0;",
    "",
    "  function new(int id);",
    "    this.id = id;",
    "  endfunction",
    "",
    "  virtual function bit is_valid();",
    "    return (id >= 0);",
    "  endfunction",
    "",
    "  task run();",
    "  endtask",
    "endclass",
    "",
    "class Derived extends Packet #(16);",
    "  function new();",
    "    super.new(1);",
    "  endfunction",
    "endclass",
    "",
  ].join("\n");

  const PACKAGE = [
    "package cfg_pkg;",
    "  parameter int WIDTH = 32;",
    "  localparam int AW = $clog2(WIDTH);",
    "endpackage",
    "",
  ].join("\n");

  /** Indexes the class and package files the way the workspace indexer does. */
  const index = (top: string): { catalog: Catalog; analysis: ReturnType<typeof analyzeTree> } => {
    const catalog = new Catalog();
    const classes = classNamesIn(CLASSES);

    for (const [uri, source] of [
      ["file:///cls.sv", CLASSES],
      ["file:///pkg.sv", PACKAGE],
    ] as const) {
      const a = analyzeTree(parser.parse(source), source, classes);
      catalog.replaceDocument(uri, a.scopes, []);
    }

    const analysis = analyzeTree(parser.parse(top), top, classes);
    catalog.replaceDocument("file:///top.sv", analysis.scopes, []);
    return { catalog, analysis };
  };

  const document = (text: string) => TextDocument.create("file:///top.sv", "systemverilog", 1, text);

  const at = (source: string, needle: string): number =>
    source.indexOf(needle) + needle.length - 1;

  /* ---------------- declarations ---------------- */

  it("reads properties, methods and parameters from a class body", () => {
    const scope = analyzeTree(parser.parse(CLASSES), CLASSES, new Set(["Packet"])).scopes.find(
      (s) => s.name === "Packet" && s.category === "class",
    );

    assert.ok(scope, "the class must be a scope");
    assert.deepEqual(
      scope!.symbols.map((s) => s.name),
      ["payload", "id", "count", "new", "is_valid", "run"],
    );
    assert.deepEqual(scope!.parameters.map((p) => p.name), ["W"]);
  });

  it("keeps the qualifiers that change what a member means", () => {
    const scope = analyzeTree(parser.parse(CLASSES), CLASSES, new Set(["Packet"])).scopes.find(
      (s) => s.name === "Packet" && s.category === "class",
    );

    const byName = new Map(scope!.symbols.map((s) => [s.name, s]));
    assert.deepEqual(byName.get("payload")?.qualifiers, ["rand"]);
    assert.deepEqual(byName.get("count")?.qualifiers, ["static"]);
  });

  it("records the base class of a subclass", () => {
    const derived = analyzeTree(parser.parse(CLASSES), CLASSES, new Set(["Packet"])).scopes.find(
      (s) => s.name === "Derived",
    );

    assert.equal(derived?.baseClass, "Packet");
  });

  it("opens each method as a scope of its own", () => {
    const methods = analyzeTree(parser.parse(CLASSES), CLASSES, new Set(["Packet"])).scopes.filter(
      (s) => s.category === "function" || s.category === "task",
    );

    assert.deepEqual(methods.map((m) => `${m.category}:${m.name}`), [
      "function:new",
      "function:is_valid",
      "task:run",
      "function:new",
    ]);
  });

  it("does not give a method a width of its own", () => {
    // `bit is_valid()` returns a bit; the method is not a one-bit signal.
    const scope = analyzeTree(parser.parse(CLASSES), CLASSES, new Set(["Packet"])).scopes.find(
      (s) => s.name === "Packet" && s.category === "class",
    );
    const isValid = scope!.symbols.find((s) => s.name === "is_valid");

    assert.equal(isValid?.packedWidth, undefined);
    assert.equal(isValid?.typeText, "bit", "the return type is still shown");
  });

  it("does not count a package's parameters twice", () => {
    // `package p;` has no header node, so scanning the declaration for header
    // parameters also finds everything in the body.
    const pkg = analyzeTree(parser.parse(PACKAGE), PACKAGE).scopes.find((s) => s.category === "package");

    assert.deepEqual(pkg?.parameters.map((p) => p.name), ["WIDTH", "AW"]);
  });

  /* ---------------- cross-file resolution ---------------- */

  it("finds a class declared in another file", () => {
    const top = ["module top;", "  Packet #(8) pkt;", "endmodule", ""].join("\n");
    const { catalog } = index(top);

    assert.ok(catalog.get("Packet"), "a class is a design unit");
    assert.equal(catalog.get("Packet")?.kind, "class");
    assert.equal(catalog.get("Derived")?.baseClass, "Packet");
  });

  it("treats a class handle as an object, not a one-bit net", () => {
    const top = ["module top;", "  Packet #(8) pkt;", "endmodule", ""].join("\n");
    const { analysis } = index(top);
    const handle = analysis.scopes[0]!.symbols.find((s) => s.name === "pkt");

    assert.equal(handle?.category, "handle");
    assert.equal(handle?.handleOf, "Packet");
    assert.equal(handle?.packedWidth, undefined);
  });

  it("still treats an ordinary user type as a net", () => {
    // `my_t x;` where `my_t` is not a class must not become a handle.
    const top = [
      "module top;",
      "  my_t x;",
      "  wire [7:0] w;",
      "endmodule",
      "",
    ].join("\n");
    const { analysis } = index(top);

    const userType = analysis.scopes[0]!.symbols.find((s) => s.name === "x");
    assert.notEqual(userType?.handleOf, "my_t", "not an object handle");
    assert.equal(
      analysis.scopes[0]!.symbols.find((s) => s.name === "w")?.category,
      "net",
      "an ordinary wire is still a net",
    );
  });

  it("resolves a member through a class handle", () => {
    const top = [
      "module top;",
      "  Packet #(8) pkt;",
      "  initial pkt.payload = 8'hAB;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);
    const doc = document(top);

    const resolved = resolvePath(
      identifierAt(analysis, at(top, "pkt.pay")),
      analysis,
      catalog,
      "file:///top.sv",
    );

    assert.equal(resolved?.symbol.name, "payload");
    assert.equal(resolved?.uri, "file:///cls.sv", "declared in the class's file");

    const definition = provideDefinition(doc, analysis, catalog, at(top, "pkt.pay"));
    const loc = Array.isArray(definition) ? definition[0]! : definition!;
    assert.equal(loc?.uri, "file:///cls.sv");
  });

  it("resolves a member inherited from a base class", () => {
    const top = [
      "module top;",
      "  Derived d;",
      "  initial d.payload = 8'hAB;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const resolved = resolvePath(
      identifierAt(analysis, at(top, "d.pay")),
      analysis,
      catalog,
      "file:///top.sv",
    );

    assert.equal(resolved?.symbol.name, "payload", "inherited from Packet");
    assert.equal(resolved?.uri, "file:///cls.sv");
  });

  it("offers a class's members, inherited ones included", () => {
    const top = [
      "module top;",
      "  Derived d;",
      "  initial d.",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);
    const doc = document(top);

    const cursor = top.indexOf("  initial d.") + "  initial d.".length;
    const list = provideCompletion(
      { analysis, document: doc, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true },
    );

    const labels = list.items.map((i) => i.label);
    assert.ok(labels.includes("payload"), `expected class members, got ${labels.join(", ")}`);
    assert.ok(labels.includes("is_valid"), "and its methods");
    assert.ok(labels.includes("new"));
    assert.match(
      list.items.find((i) => i.label === "payload")?.detail ?? "",
      /8 bits/,
      "with the parameterised width",
    );
  });

  it("does not report a class member as an unknown identifier", () => {
    const top = [
      "module top;",
      "  Packet #(8) pkt;",
      "  initial begin",
      "    pkt = new();",
      "    pkt.payload = 8'hAB;",
      "    pkt.is_valid();",
      "    pkt.run();",
      "  end",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    assert.deepEqual(
      computeDiagnostics(document(top), analysis, catalog, DIAG).map((d) => d.message),
      [],
    );
  });

  it("does not report a member write through a handle as a truncation", () => {
    // The handle is a reference, not a 1-bit target; treating it as one made
    // every field assignment look like a truncation.
    const top = [
      "module top;",
      "  Packet #(8) pkt;",
      "  initial pkt.payload = 8'hAB;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    assert.deepEqual(
      computeDiagnostics(document(top), analysis, catalog, DIAG).map((d) => d.message),
      [],
    );
  });

  it("reports a member the class does not declare", () => {
    const top = [
      "module top;",
      "  Packet #(8) pkt;",
      "  initial pkt.nonexistent = 1'b0;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const found = computeDiagnostics(document(top), analysis, catalog, DIAG);
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /nonexistent/);
  });
});

describe("cross-file packages", () => {
  const PACKAGE = [
    "package cfg_pkg;",
    "  parameter int WIDTH = 32;",
    "  localparam int DEPTH = 256;",
    "  typedef enum logic [1:0] {IDLE, RUN} state_e;",
    "endpackage",
    "",
  ].join("\n");

  /** Indexes `cfg_pkg.sv`, analyses `top`, and returns everything the tests need. */
  const index = (top: string) => {
    const catalog = new Catalog();
    const a = analyzeTree(parser.parse(PACKAGE), PACKAGE);
    catalog.replaceDocument("file:///pkg.sv", a.scopes, []);

    const analysis = analyzeTree(parser.parse(top), top, catalog.classNames());
    catalog.replaceDocument("file:///top.sv", analysis.scopes, []);
    return { catalog, analysis };
  };

  const document = (text: string) => TextDocument.create("file:///top.sv", "systemverilog", 1, text);
  const at = (source: string, needle: string): number => source.indexOf(needle) + needle.length - 1;

  it("finds a package parameter written as `pkg::NAME`", () => {
    // This grammar has no `scope_resolution` node: `cfg_pkg::WIDTH` arrives as
    // a `method_call`, and a resolver that only knew the former never saw it.
    const top = [
      "module top;",
      "  logic [cfg_pkg::WIDTH-1:0] bus;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const resolved = resolvePath(
      identifierAt(analysis, at(top, "cfg_pkg::WIDTH")),
      analysis,
      catalog,
      "file:///top.sv",
    );

    assert.equal(resolved?.symbol.name, "WIDTH");
    assert.equal(resolved?.uri, "file:///pkg.sv");
    assert.equal(resolved?.symbol.resolvedValue, 32);
  });

  it("jumps to a package parameter in its own file", () => {
    const top = ["module top;", "  localparam int W = cfg_pkg::WIDTH;", "endmodule", ""].join("\n");
    const { catalog, analysis } = index(top);

    const definition = provideDefinition(document(top), analysis, catalog, at(top, "cfg_pkg::WIDTH"));
    const loc = Array.isArray(definition) ? definition[0]! : definition!;

    assert.equal(loc?.uri, "file:///pkg.sv");
    assert.equal(loc?.range.start.line, 1);
  });

  it("shows the type and the default of an imported parameter", () => {
    const top = [
      "module top;",
      "  import cfg_pkg::*;",
      "  localparam int W = WIDTH;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const hover = provideHover(document(top), analysis, catalog, at(top, "WIDTH;"), {
      showWidth: true,
      showType: true,
    });

    assert.ok(hover, "an imported name must have a hover");
    const value = (hover!.contents as { value: string }).value;
    assert.match(value, /int WIDTH = 32/);
    assert.match(value, /cfg_pkg/);
  });

  it("does not report an imported name as unknown", () => {
    const top = [
      "module top;",
      "  import cfg_pkg::*;",
      "  logic [WIDTH-1:0] bus;",
      "  initial bus = DEPTH;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    assert.deepEqual(
      computeDiagnostics(document(top), analysis, catalog, DIAG).map((d) => d.message),
      [],
    );
  });

  it("offers an imported package's members", () => {
    const top = [
      "module top;",
      "  import cfg_pkg::*;",
      "  initial bus = ",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const cursor = top.indexOf("= ") + 2;
    const list = provideCompletion(
      { analysis, document: document(top), offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true, includeParameters: true },
    );

    const labels = list.items.map((i) => i.label);
    assert.ok(labels.includes("WIDTH"), `expected imported names, got ${labels.join(", ")}`);
    assert.ok(labels.includes("DEPTH"));
    assert.ok(labels.includes("state_e"), "and its typedefs and enum literals");
  });

  it("offers a package's members after `pkg::`", () => {
    const top = [
      "module top;",
      "  logic [cfg_pkg::",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const cursor = top.indexOf("cfg_pkg::") + "cfg_pkg::".length;
    const list = provideCompletion(
      { analysis, document: document(top), offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true, includeParameters: true },
    );

    const labels = list.items.map((i) => i.label);
    assert.ok(labels.includes("WIDTH"), `expected package members, got ${labels.join(", ")}`);
    assert.ok(labels.includes("IDLE"));
  });

  it("imports only what it names, for a non-wildcard import", () => {
    const top = [
      "module top;",
      "  import cfg_pkg::WIDTH;",
      "  logic [WIDTH-1:0] bus;",
      "  initial bus = DEPTH;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const messages = computeDiagnostics(document(top), analysis, catalog, DIAG).map((d) => d.message);
    assert.ok(messages.every((m) => !m.includes("WIDTH")), "WIDTH is imported");
    assert.ok(messages.some((m) => m.includes("DEPTH")), "DEPTH is not");
  });

  it("still reports a name no import brings in", () => {
    const top = [
      "module top;",
      "  import cfg_pkg::*;",
      "  initial $display(NOT_A_MEMBER);",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(top);

    const messages = computeDiagnostics(document(top), analysis, catalog, DIAG).map((d) => d.message);
    assert.ok(messages.some((m) => m.includes("NOT_A_MEMBER")));
  });
});

describe("classes in the navigator and the outline", () => {
  const FILE = [
    "package cfg_pkg;",
    "  parameter int W = 32;",
    "endpackage",
    "",
    "class Packet #(parameter int W = 8);",
    "  rand bit [W-1:0] payload;",
    "  function is_valid();",
    "  endfunction",
    "endclass",
    "",
    "module top;",
    "  Packet #(8) pkt;",
    "endmodule",
    "",
  ].join("\n");

  const analysis = () => analyzeTree(parser.parse(FILE), FILE, new Set(["Packet"]));

  it("lists every design unit the file declares", () => {
    const nav = buildNavigator(analysis());

    assert.deepEqual(
      nav.units.map((u) => `${u.category}:${u.name}`),
      ["package:cfg_pkg", "class:Packet", "module:top"],
    );
  });

  it("lists a class handle beside the module instances", () => {
    const nav = buildNavigator(analysis());
    const instances = nav.groups.find((g) => g.group === "instance")?.signals ?? [];

    assert.deepEqual(instances.map((i) => `${i.name}:${i.typeName}`), ["pkt:Packet"]);
  });

  it("nests a class's members under it in the outline", () => {
    const symbols = provideDocumentSymbols(analysis());
    const packet = symbols.find((s) => s.name === "Packet");

    assert.ok(packet, "the class is a top-level symbol");
    assert.deepEqual(
      packet!.children?.map((c) => c.name),
      ["W", "payload", "is_valid"],
    );
    assert.equal(packet!.kind, SymbolKind.Class);
  });
});

/* ------------------------------------------------------------------ *
 * Functions and tasks
 * ------------------------------------------------------------------ */

describe("functions and tasks", () => {
  const FILE = [
    "module m1;",
    "  logic [7:0] sig;",
    "",
    "  function automatic int add(input int a, input int b);",
    "    return a + b;",
    "  endfunction",
    "",
    "  function int no_args();",
    "    return 7;",
    "  endfunction",
    "",
    "  task automatic drive(input logic en, output logic q);",
    "    q = en;",
    "  endtask",
    "",
    "  initial begin",
    "    drive(1'b1, sig);",
    "    sig = add(1, 2);",
    "  end",
    "endmodule",
    "",
  ].join("\n");

  const analysis = () => analyzeTree(parser.parse(FILE), FILE);
  const module_ = () => analysis().scopes.find((s) => s.category === "module");

  it("declares a module-level function in its module", () => {
    const names = module_()!.symbols.map((s) => s.name);

    assert.ok(names.includes("add"), `expected functions, got ${names.join(", ")}`);
    assert.ok(names.includes("no_args"));
    assert.ok(names.includes("drive"), "and tasks");
    assert.ok(names.includes("no_args_t") || names.length >= 3);
  });

  it("records the declared return type, not the whole declaration", () => {
    const add = module_()!.symbols.find((s) => s.name === "add");
    const drive = module_()!.symbols.find((s) => s.name === "drive");

    assert.equal(add?.category, "function");
    assert.equal(add?.typeText, "int");
    assert.equal(drive?.category, "task");
    assert.equal(drive?.typeText, "void");
  });

  it("reads a function's arguments as ports", () => {
    const add = analysis().scopes.find((s) => s.name === "add");

    assert.deepEqual(
      add?.ports.map((p) => `${p.name}:${p.direction}:${p.typeText}`),
      ["a:input:int", "b:input:int"],
    );
  });

  it("reads a task's arguments, direction included", () => {
    const drive = analysis().scopes.find((s) => s.name === "drive");

    assert.deepEqual(
      drive?.ports.map((p) => `${p.name}:${p.direction}`),
      ["en:input", "q:output"],
    );
  });

  it("resolves an argument's width from its declared range", () => {
    const source = [
      "module m2;",
      "  function bit [15:0] wide(input bit [15:0] v);",
      "    return v;",
      "  endfunction",
      "endmodule",
      "",
    ].join("\n");
    const fn = analyzeTree(parser.parse(source), source).scopes.find((s) => s.name === "wide");

    assert.equal(fn?.ports[0]?.packedWidth, 16);
  });

  it("does not report an argument as undeclared inside the body", () => {
    // The argument only exists as a port of the function's own scope; without
    // parsing `tf_port_list` every use inside the body would be a finding.
    const found = diagnose(FILE, { unknownIdentifiers: true });

    assert.deepEqual(found.map((d) => d.message), []);
  });

  it("completes a call to a function declared in the same file", () => {
    const a = analysis();
    const document = TextDocument.create("file:///m1.sv", "systemverilog", 1, FILE);
    const cursor = FILE.indexOf("sig = add") + "sig = ".length;

    const list = provideCompletion(
      { analysis: a, document, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      new Catalog(),
      { showWidth: true, showType: true },
    );

    const add = list.items.find((i) => i.label === "add");
    assert.ok(add, `expected add in ${list.items.map((i) => i.label).join(", ")}`);
    assert.match(add!.detail ?? "", /int/, "with its return type");
  });

  it("opens a class method's arguments too", () => {
    const source = [
      "class C;",
      "  function new(int id, string name);",
      "  endfunction",
      "  task go(input logic en, output logic q);",
      "  endtask",
      "endclass",
      "",
    ].join("\n");
    const scopes = analyzeTree(parser.parse(source), source, new Set(["C"])).scopes;

    const ctor = scopes.find((s) => s.name === "new");
    const go = scopes.find((s) => s.name === "go");

    assert.deepEqual(ctor?.ports.map((p) => p.name), ["id", "name"]);
    assert.deepEqual(go?.ports.map((p) => `${p.name}:${p.direction}`), ["en:input", "q:output"]);
  });

  it("does not report a function as a one-bit signal", () => {
    // Functions are not signals, and the tracer must not follow them.
    const names = analysis()
      .accesses.map((a) => a.name);

    assert.ok(!names.includes("add"), `tracer followed a function: ${[...new Set(names)].join(", ")}`);
    assert.ok(!names.includes("drive"));
    assert.ok(names.includes("sig"), "but it still follows a real signal");
  });
});

/* ------------------------------------------------------------------ *
 * The Signal Tracer after the single-pass rewrite
 * ------------------------------------------------------------------ */

describe("signal access collection", () => {
  const FILE = [
    "module tracer;",
    "  logic clk;",
    "  logic [7:0] data;",
    "  logic [7:0] shadow;",
    "",
    "  child u_child (.a(data), .b(shadow));",
    "",
    "  always_ff @(posedge clk) begin",
    "    data <= data + 1'b1;",
    "  end",
    "",
    "  assign shadow = data;",
    "endmodule",
    "",
  ].join("\n");

  it("records a procedural write and a read of the same signal", () => {
    const accesses = analyzeTree(parser.parse(FILE), FILE).accesses;
    const data = accesses.filter((a) => a.name === "data");

    assert.ok(
      data.some((a) => a.kind === "drive" && a.source === "procedural_assignment"),
      "written in the always_ff",
    );
    assert.ok(
      data.some((a) => a.kind === "load" && a.source === "procedural_assignment"),
      "read on the right-hand side",
    );
  });

  it("labels a continuous assign on both the sides it touches", () => {
    const accesses = analyzeTree(parser.parse(FILE), FILE).accesses;

    // `assign shadow = data;` drives the target and reads the source, and both
    // are continuous rather than procedural accesses.
    assert.ok(
      accesses.some((a) => a.name === "shadow" && a.kind === "drive" && a.source === "continuous_assign"),
      "written by `assign`",
    );
    assert.ok(
      accesses.some((a) => a.name === "data" && a.kind === "load" && a.source === "continuous_assign"),
      "read on the right-hand side",
    );
  });

  it("does not treat a port connection as a read of the module body", () => {
    // `.a(data)` is resolved later, against the instantiated module's port
    // directions; counting it here would report every connection twice.
    const accesses = analyzeTree(parser.parse(FILE), FILE).accesses;
    const data = accesses.filter((a) => a.name === "data" && a.detail.includes(".a"));

    assert.deepEqual(data, []);
  });

  it("still describes the statement an access happens in", () => {
    const accesses = analyzeTree(parser.parse(FILE), FILE).accesses;
    const write = accesses.find((a) => a.name === "data" && a.kind === "drive");

    assert.match(write!.detail, /data <= data/);
  });

  it("does not count a declaration as a reference of itself", () => {
    const a = analyzeTree(parser.parse(FILE), FILE);
    const declaration = a.scopes
      .flatMap((s) => [...s.ports, ...s.symbols])
      .find((s) => s.name === "data")!;

    // The declaration itself must not also appear as a use at its own position,
    // which is what makes `find all references` report one hit too many.
    const atDeclaration = a.uses.filter(
      (u) =>
        u.name === "data" &&
        u.range.start.line === declaration.selectionRange.start.line &&
        u.range.start.character === declaration.selectionRange.start.character,
    );

    assert.deepEqual(atDeclaration, []);
    assert.ok(a.uses.some((u) => u.name === "data"), "but it is referenced elsewhere");
  });

  it("does not report the enum literals of a typedef as references", () => {
    // An enum member is part of a declaration. Counting it as a use brings back
    // the "unknown identifier" findings for perfectly good enum values.
    const source = [
      "package p;",
      "  typedef enum logic [1:0] {IDLE, RUN, DONE} state_e;",
      "endpackage",
      "",
    ].join("\n");
    const a = analyzeTree(parser.parse(source), source);

    const used = a.uses.map((u) => u.name);
    for (const literal of ["IDLE", "RUN", "DONE"]) {
      assert.ok(!used.includes(literal), `${literal} is declared, not referenced`);
    }
    assert.deepEqual(used, [], "the typedef itself declares every name it mentions");
  });

  it("does report an enum literal that is genuinely referenced", () => {
    // The other half of the rule: skipping the declaration must not also hide
    // the use of that same literal in an expression.
    const source = [
      "package p;",
      "  typedef enum logic [1:0] {IDLE, RUN, DONE} state_e;",
      "endpackage",
      "module uses_it;",
      "  import p::*;",
      "  state_e st;",
      "  initial st = IDLE;",
      "endmodule",
      "",
    ].join("\n");
    const a = analyzeTree(parser.parse(source), source);

    assert.ok(a.uses.some((u) => u.name === "IDLE"), "a real reference is still seen");
  });

  it("gives each use the innermost scope that contains it", () => {
    // A use inside `always_ff` belongs to that block, not to the module: the
    // signal is only declared in the block.
    const a = analyzeTree(parser.parse(FILE), FILE);
    const moduleId = a.scopes.find((s) => s.category === "module")!.id;
    const byId = new Map(a.scopes.map((s) => [s.id, s]));

    for (const use of a.uses) {
      const scope = byId.get(use.scopeId);
      assert.ok(scope, `${use.name} was attributed to a scope that does not exist`);
      assert.ok(
        scope.range.start.line <= use.range.start.line &&
          use.range.start.line <= scope.range.end.line,
        `${use.name} was attributed to \`${scope.name}\`, which does not contain it`,
      );
    }

    // An unnamed `begin ... end` is not a scope of its own, so everything in
    // this fixture belongs to the module. Named blocks are covered separately.
    for (const use of a.uses) {
      assert.equal(use.scopeId, moduleId, `${use.name} should belong to the module`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Import chains between packages
 * ------------------------------------------------------------------ */

describe("transitive package imports", () => {
  const BASE = [
    "package base_pkg;",
    "  parameter integer A_INT = 8;",
    "  localparam int  C_INT = 32;",
    "  typedef logic [31:0] word_t;",
    "  function automatic integer twice(input integer v);",
    "    return v * 2;",
    "  endfunction",
    "  task automatic poke(input integer v);",
    "  endtask",
    "endpackage",
    "",
  ].join("\n");

  const MID = [
    "package mid_pkg;",
    "  import base_pkg::*;",
    "  parameter integer MID = 7;",
    "endpackage",
    "",
  ].join("\n");

  /**
   * Indexes the two packages and analyses `use`, the way the workspace indexer
   * does: the declaring files first, the reading file against a finished
   * catalog.
   */
  const index = (use: string) => {
    const catalog = new Catalog();
    for (const [uri, source] of [
      ["file:///base.sv", BASE],
      ["file:///mid.sv", MID],
    ] as const) {
      const a = analyzeTree(parser.parse(source), source);
      catalog.replaceDocument(uri, a.scopes, []);
    }

    const analysis = analyzeTree(parser.parse(use), use, catalog.classNames());
    catalog.replaceDocument("file:///use.sv", analysis.scopes, []);
    return { catalog, analysis };
  };

  const document = (text: string) => TextDocument.create("file:///use.sv", "systemverilog", 1, text);

  /** Names reported as undeclared, computed against the built catalog. */
  const unknownNames = (catalog: Catalog, analysis: Analysis, text: string): string[] =>
    computeDiagnostics(document(text), analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    }).map((d) => /`(\w+)`/.exec(d.message)?.[1] ?? d.message);

  it("records a package's own imports", () => {
    const scope = analyzeTree(parser.parse(MID), MID).scopes[0];

    assert.deepEqual(scope.imports?.map((i) => `${i.packageName}:${i.wildcard}`), ["base_pkg:true"]);
  });

  it("resolves a parameter one package away, imported directly", () => {
    const use = [
      "module u;",
      "  import base_pkg::*;",
      "  localparam integer L = A_INT;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    assert.deepEqual(unknownNames(catalog, analysis, use), []);

    // Where the name really lives is what go-to-definition has to jump to.
    const definition = provideDefinition(
      document(use),
      analysis,
      catalog,
      use.indexOf("A_INT") + 2,
    );
    const location = Array.isArray(definition) ? definition[0]! : definition!;
    assert.equal(location?.uri, "file:///base.sv");
    assert.equal(location?.range.start.line, 1, "the `A_INT` line");
  });

  it("resolves a parameter two packages away, through a re-export", () => {
    // `use` imports only `mid_pkg`, which is the only one that declares `MID`.
    // `A_INT` lives in `base_pkg`, which `mid_pkg` imports -- so unless the
    // chain is followed, a perfectly good parameter is reported as undeclared
    // while the file that declares it looks correct.
    const use = [
      "module u;",
      "  import mid_pkg::*;",
      "  localparam integer L = A_INT;",
      "  localparam integer M = MID;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    assert.deepEqual(unknownNames(catalog, analysis, use), []);

    // `A_INT` is not declared by the package `use` imported; it is two hops
    // away. The jump has to land where it is really written, not in mid_pkg.
    const definition = provideDefinition(
      document(use),
      analysis,
      catalog,
      use.indexOf("A_INT") + 2,
    );
    const location = Array.isArray(definition) ? definition[0]! : definition!;
    assert.equal(location?.uri, "file:///base.sv");
  });

  it("resolves a localparam, a typedef, a function and a task through the chain", () => {
    const use = [
      "module u;",
      "  import mid_pkg::*;",
      "  word_t w;",
      "  integer n;",
      "  initial begin",
      "    w = C_INT;",
      "    n = twice(1);",
      "    poke(2);",
      "  end",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    assert.deepEqual(unknownNames(catalog, analysis, use), []);
  });

  it("still reports a name that no package in the chain declares", () => {
    const use = [
      "module u;",
      "  import mid_pkg::*;",
      "  localparam integer L = NOT_A_PARAM;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    assert.deepEqual(unknownNames(catalog, analysis, use), ["NOT_A_PARAM"]);
  });

  it("does not follow an explicit import past the name it lists", () => {
    // `import mid_pkg::MID;` asks for one name. Reaching into `base_pkg` for it
    // would make a genuine typo in an unrelated name look declared.
    const use = [
      "module u;",
      "  import mid_pkg::MID;",
      "  localparam integer L = MID;",
      "  localparam integer X = A_INT;",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    assert.deepEqual(unknownNames(catalog, analysis, use), ["A_INT"]);
  });

  it("survives an import cycle without hanging", () => {
    const a = ["package a_pkg;", "  import b_pkg::*;", "  parameter int A = 1;", "endpackage", ""].join("\n");
    const b = ["package b_pkg;", "  import a_pkg::*;", "  parameter int B = 2;", "endpackage", ""].join("\n");

    const catalog = new Catalog();
    catalog.replaceDocument("file:///a.sv", analyzeTree(parser.parse(a), a).scopes, []);
    catalog.replaceDocument("file:///b.sv", analyzeTree(parser.parse(b), b).scopes, []);

    const use = ["module u;", "  import a_pkg::*;", "  initial $display(A + B);", "endmodule", ""].join("\n");
    const analysis = analyzeTree(parser.parse(use), use, catalog.classNames());

    assert.deepEqual(unknownNames(catalog, analysis, use), []);
  });

  it("offers the re-exported members in completion", () => {
    const use = [
      "module u;",
      "  import mid_pkg::*;",
      "  initial begin",
      "    ",
      "  end",
      "endmodule",
      "",
    ].join("\n");
    const { catalog, analysis } = index(use);

    const cursor = use.indexOf("    \n") + 4;
    const list = provideCompletion(
      { analysis, document: document(use), offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true, includeParameters: true },
    );

    const labels = list.items.map((i) => i.label);
    assert.ok(labels.includes("A_INT"), `expected the chain, got ${labels.join(", ")}`);
    assert.ok(labels.includes("MID"), "and the intermediate package's own parameter");
  });
});

describe("index file patterns", () => {
  it("covers every extension declared as SystemVerilog or Verilog", () => {
    // A package the editor opens and watches but the indexer skips is the worst
    // case: it looks loaded, and nothing that crosses a file boundary resolves.
    const declared = new Set<string>();
    for (const language of manifest.contributes.languages) {
      for (const ext of language.extensions as string[]) declared.add(ext);
    }

    const covered = new Set<string>();
    for (const glob of DEFAULT_INDEX_OPTIONS.include) {
      for (const ext of declared) {
        if (glob.endsWith(ext)) covered.add(ext);
      }
    }

    assert.deepEqual(
      [...declared].filter((ext) => !covered.has(ext)),
      [],
      "every declared extension must be indexed",
    );
  });

  it("indexes a package declared in a .svp file", () => {
    assert.ok(
      DEFAULT_INDEX_OPTIONS.include.includes("**/*.svp"),
      "`.svp` is a registered SystemVerilog extension and holds package definitions",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The indexer, on a real directory
 * ------------------------------------------------------------------ */

describe("workspace indexing", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "svision-index-"));
  const write = (name: string, source: string): void => {
    mkdirSync(path.join(workspace, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(workspace, name), source, "utf8");
  };

  before(async () => {
    write(
      "pkgs/defs.svp",
      ["package defs_pkg;", "  parameter integer CHANNELS = 16;", "endpackage", ""].join("\n"),
    );
    write("pkgs/nested.sv", ["package nested_pkg;", "  parameter integer NESTED = 4;", "endpackage", ""].join("\n"));
    write(
      "rtl/top.sv",
      [
        "module top;",
        "  import defs_pkg::*;",
        "  import nested_pkg::*;",
        "  localparam integer W = CHANNELS + NESTED;",
        "endmodule",
        "",
      ].join("\n"),
    );
  });

  it("indexes a package declared in a .svp file and resolves its parameters", async () => {
    const catalog = new Catalog();
    await new WorkspaceIndexer(parser, catalog).indexFolders([workspace]);

    assert.ok(catalog.get("defs_pkg"), "a .svp package must reach the catalog");
    assert.ok(catalog.get("nested_pkg"));

    const source = readFileSync(path.join(workspace, "rtl/top.sv"), "utf8");
    const analysis = analyzeTree(parser.parse(source), source, catalog.classNames());
    catalog.replaceDocument(`${pathToUri(path.join(workspace, "rtl/top.sv"))}`, analysis.scopes, []);

    const uri = `${pathToUri(path.join(workspace, "rtl/top.sv"))}`;
    const document = TextDocument.create(uri, "systemverilog", 1, source);

    const found = computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

    assert.deepEqual(found.map((d) => d.message), [], "both package parameters resolve");
  });

  it("has a catalog entry with the package's own imports", async () => {
    const catalog = new Catalog();
    await new WorkspaceIndexer(parser, catalog).indexFolders([workspace]);

    assert.equal(catalog.get("defs_pkg")?.imports.length, 0);
    assert.deepEqual(catalog.get("top")?.parameters.map((p) => p.name), ["W"]);
  });
});

/* ------------------------------------------------------------------ *
 * A package whose parameters are used as widths
 * ------------------------------------------------------------------ */

describe("package parameters as widths", () => {
  const PKG = [
    "package dsp_pkg;",
    "  parameter int C_PKT_DAT_W = 32;",
    "  parameter int C_NB_DLINK  = 4;",
    "  parameter int UNFOLDABLE  = 1;",
    "endpackage",
    "",
  ].join("\n");

  const build = (source: string) => {
    const catalog = new Catalog();
    catalog.replaceDocument(
      "file:///dsp_pkg.sv",
      analyzeTree(parser.parse(PKG), PKG).scopes,
      [],
    );

    const analysis = analyzeTree(
      parser.parse(source),
      source,
      catalog.classNames(),
      (name) => catalog.parameterValues(name),
    );
    catalog.replaceDocument("file:///mod.sv", analysis.scopes, analysis.accesses);
    return { catalog, analysis };
  };

  const document = (text: string) => TextDocument.create("file:///mod.sv", "systemverilog", 1, text);

  it("folds a port width written with an imported parameter", () => {
    const source = [
      "module mod (",
      "  output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o",
      ");",
      "  import dsp_pkg::*;",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const port = analysis.scopes[0]!.ports[0];

    assert.equal(port.packedWidth, 32);
  });

  it("folds a port width written with a qualified parameter", () => {
    // `pkg::W-1:0` names the package at every use and needs no import.
    const source = [
      "module mod (",
      "  output logic [dsp_pkg::C_PKT_DAT_W-1:0] pkt_dat_word_o",
      ");",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);

    assert.equal(analysis.scopes[0]!.ports[0]?.packedWidth, 32);
  });

  it("keeps the element count of an unpacked array of package parameters", () => {
    const source = [
      "module mod (",
      "  output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o [C_NB_DLINK]",
      ");",
      "  import dsp_pkg::*;",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const port = analysis.scopes[0]!.ports[0];

    assert.equal(port.packedWidth, 32);
    assert.equal(port.unpackedCount, 4, "4 outputs, each 32 bits");
  });

  it("shows the folded width in the navigator", () => {
    const source = [
      "module mod (",
      "  output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o [C_NB_DLINK]",
      ");",
      "  import dsp_pkg::*;",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const nav = buildNavigator(analysis);
    const outputs = nav.groups.find((g) => g.group === "output")?.signals ?? [];

    assert.deepEqual(
      outputs.map((s) => `${s.name} (${s.sizeText})`),
      ["pkt_dat_word_o (4 x 32 bits)"],
      "4 outputs of 32 bits, not 5",
    );
  });

  it("folds a signal width as well as a port's", () => {
    const source = [
      "module mod;",
      "  import dsp_pkg::*;",
      "  logic [C_PKT_DAT_W-1:0] lane [C_NB_DLINK];",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const lane = analysis.scopes[0]!.symbols.find((s) => s.name === "lane");

    assert.equal(lane?.packedWidth, 32);
    assert.equal(lane?.unpackedCount, 4);
  });

  it("folds a parameter that references another one from the package", () => {
    const source = [
      "module mod;",
      "  import dsp_pkg::*;",
      "  localparam int HALF = C_PKT_DAT_W / 2;",
      "  logic [HALF-1:0] half_word;",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const half = analysis.scopes[0]!.symbols.find((s) => s.name === "half_word");

    assert.equal(half?.packedWidth, 16);
  });

  it("leaves the width unknown rather than guessing when no value is available", () => {
    // A package that is not indexed cannot supply a number, and a plausible but
    // wrong width is worse than none.
    const source = [
      "module mod;",
      "  import missing_pkg::*;",
      "  logic [SOMETHING-1:0] wide;",
      "endmodule",
      "",
    ].join("\n");

    const catalog = new Catalog();
    const analysis = analyzeTree(parser.parse(source), source, catalog.classNames(), (name) =>
      catalog.parameterValues(name),
    );
    const wide = analysis.scopes[0]!.symbols.find((s) => s.name === "wide");

    assert.equal(wide?.packedWidth, undefined);
  });

  it("lets a local parameter shadow an imported one of the same name", () => {
    const source = [
      "module mod;",
      "  import dsp_pkg::*;",
      "  localparam int C_PKT_DAT_W = 8;",
      "  logic [C_PKT_DAT_W-1:0] lane;",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const lane = analysis.scopes[0]!.symbols.find((s) => s.name === "lane");

    assert.equal(lane?.packedWidth, 8, "the local value wins over the package's 32");
  });

  it("does not split a range at the colon of a scope resolution", () => {
    // `[dsp_pkg::W-1:0]` has two colons in a row before the real one. Taking
    // the first is what made every qualified width come out unknown.
    const { catalog } = build("module mod; endmodule\n");
    const values = catalog.parameterValues("dsp_pkg");

    assert.equal(values.get("C_PKT_DAT_W"), 32);
  });

  it("offers the package's parameters in completion with their defaults", () => {
    const source = [
      "module mod;",
      "  import dsp_pkg::*;",
      "  localparam int X = ",
      "endmodule",
      "",
    ].join("\n");

    const { catalog, analysis } = build(source);
    const cursor = source.indexOf("= ") + 2;
    const list = provideCompletion(
      { analysis, document: document(source), offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true, includeParameters: true },
    );

    const item = list.items.find((i) => i.label === "C_PKT_DAT_W");
    assert.ok(item, "the parameter is offered");
    assert.match(item!.detail ?? "", /default 32/);
  });

  it("hover on an imported parameter names the file it comes from", () => {
    const source = [
      "module mod;",
      "  import dsp_pkg::*;",
      "  localparam int X = C_PKT_DAT_W;",
      "endmodule",
      "",
    ].join("\n");

    const { catalog, analysis } = build(source);
    const hover = provideHover(document(source), analysis, catalog, source.indexOf("C_PKT_DAT_W") + 2, {
      showWidth: true,
      showType: true,
    });

    assert.ok(hover);
    const value = (hover!.contents as { value: string }).value;
    assert.match(value, /dsp_pkg/);
    assert.match(value, /int C_PKT_DAT_W = 32/);
  });
});

/* ------------------------------------------------------------------ *
 * `module m import p::*; ( ... );`
 * ------------------------------------------------------------------ */

describe("an import in the module header", () => {
  const PKG = [
    "package dsp_pkg;",
    "parameter int C_NB_CHAN   = 32;",
    "parameter int C_ADC_W     = 12;",
    "parameter int C_NB_DLINK  = 4;",
    "parameter int C_PKT_DAT_W = 32;",
    "endpackage",
    "",
  ].join("\n");

  const build = (source: string) => {
    const catalog = new Catalog();
    catalog.replaceDocument("file:///p.sv", analyzeTree(parser.parse(PKG), PKG).scopes, []);
    const analysis = analyzeTree(
      parser.parse(source),
      source,
      catalog.classNames(),
      (name) => catalog.parameterValues(name),
    );
    catalog.replaceDocument("file:///m.sv", analysis.scopes, analysis.accesses);
    return { catalog, analysis };
  };

  const document = (text: string) => TextDocument.create("file:///m.sv", "systemverilog", 1, text);

  it("records an import written between the module name and the port list", () => {
    // Legal SystemVerilog, and the only way some designs write their header.
    // The import is a child of the header node, so a traversal that only looks
    // at the body never sees it -- and every parameter used in a width then
    // reads as undeclared, in the port list itself.
    const source = [
      "module dsp",
      "    import dsp_pkg::*;",
      "    (",
      "      input  wire [C_ADC_W-1:0] dsp_dat_i [C_NB_CHAN]",
      "    );",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const scope = analysis.scopes.find((s) => s.category === "module")!;

    assert.deepEqual(scope.imports?.map((i) => i.packageName), ["dsp_pkg"]);
  });

  it("resolves the package parameters used in that port list", () => {
    const source = [
      "module dsp",
      "    import dsp_pkg::*;",
      "    (",
      "      input  wire  [2:0]                          chip_id_i,",
      "      input  wire  [C_ADC_W-1:0]                  dsp_dat_i [C_NB_CHAN],",
      "      output logic [C_PKT_DAT_W-1:0]              pkt_dat_word_o [C_NB_DLINK],",
      "      output logic [C_NB_DLINK-1:0]               pkt_dat_valid_o",
      "    );",
      "endmodule",
      "",
    ].join("\n");

    const { catalog, analysis } = build(source);
    const ports = new Map(analysis.scopes.find((s) => s.category === "module")!.ports.map((p) => [p.name, p]));

    assert.equal(ports.get("chip_id_i")?.packedWidth, 3);
    assert.equal(ports.get("dsp_dat_i")?.packedWidth, 12, "C_ADC_W");
    assert.equal(ports.get("dsp_dat_i")?.unpackedCount, 32, "C_NB_CHAN");
    assert.equal(ports.get("pkt_dat_word_o")?.packedWidth, 32, "C_PKT_DAT_W");
    assert.equal(ports.get("pkt_dat_word_o")?.unpackedCount, 4, "C_NB_DLINK");
    assert.equal(ports.get("pkt_dat_valid_o")?.packedWidth, 4, "a packed range, not an array");

    const found = computeDiagnostics(document(source), analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

    assert.deepEqual(found.map((d) => d.message), []);
  });

  it("reports the dimensions in the navigator", () => {
    const source = [
      "module dsp",
      "    import dsp_pkg::*;",
      "    (",
      "      input  wire [C_ADC_W-1:0] dsp_dat_i [C_NB_CHAN],",
      "      output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o [C_NB_DLINK]",
      "    );",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const nav = buildNavigator(analysis);

    assert.deepEqual(nav.groups.find((g) => g.group === "input")?.signals.map((s) => s.sizeText), [
      "32 x 12 bits",
    ]);
    assert.deepEqual(nav.groups.find((g) => g.group === "output")?.signals.map((s) => s.sizeText), [
      "4 x 32 bits",
    ]);
  });

  it("still resolves a header import on an interface", () => {
    const source = [
      "interface bus_if",
      "    import dsp_pkg::*;",
      "    (input wire clk);",
      "  logic [C_PKT_DAT_W-1:0] word;",
      "endinterface",
      "",
    ].join("\n");

    const { analysis } = build(source);
    const scope = analysis.scopes.find((s) => s.category === "interface")!;

    assert.deepEqual(scope.imports?.map((i) => i.packageName), ["dsp_pkg"]);
    assert.equal(scope.symbols.find((s) => s.name === "word")?.packedWidth, 32);
  });

  it("combines a header import with one in the body", () => {
    const other = ["package other_pkg;", "  parameter int OTHER = 7;", "endpackage", ""].join("\n");
    const catalog = new Catalog();
    catalog.replaceDocument("file:///p.sv", analyzeTree(parser.parse(PKG), PKG).scopes, []);
    catalog.replaceDocument("file:///o.sv", analyzeTree(parser.parse(other), other).scopes, []);

    const source = [
      "module dsp",
      "    import dsp_pkg::*;",
      "    (input wire [C_ADC_W-1:0] a);",
      "  import other_pkg::*;",
      "  logic [OTHER-1:0] b;",
      "endmodule",
      "",
    ].join("\n");

    const analysis = analyzeTree(
      parser.parse(source),
      source,
      catalog.classNames(),
      (name) => catalog.parameterValues(name),
    );
    const scope = analysis.scopes.find((s) => s.category === "module")!;

    assert.deepEqual(
      scope.imports?.map((i) => i.packageName).sort(),
      ["dsp_pkg", "other_pkg"],
    );
    assert.equal(scope.ports[0]?.packedWidth, 12);
    assert.equal(scope.symbols.find((s) => s.name === "b")?.packedWidth, 7);
  });
});

/* ------------------------------------------------------------------ *
 * Named blocks
 * ------------------------------------------------------------------ */

describe("named blocks", () => {
  const TB = [
    "module tb;",
    "  logic clk = 1'b0;",
    "",
    "  initial begin : main",
    "    logic [7:0] scratch;",
    "    scratch = 8'hAB;",
    "  end",
    "",
    "  always @(posedge clk) begin : mon",
    "    logic hit;",
    "    hit = 1'b0;",
    "  end",
    "",
    "  generate",
    "    if (1) begin : gblk",
    "      logic [3:0] lane;",
    "      assign lane = 4'h5;",
    "    end",
    "  endgenerate",
    "",
    "  initial begin",
    "    #10 main.scratch = 8'h00;",
    "    #10 mon.hit = 1'b1;",
    "  end",
    "",
    "  initial begin",
    "    $display(\"%h\", main.scratch);",
    "    $display(\"%b\", mon.hit);",
    "    $display(\"%h\", gblk.lane);",
    "  end",
    "endmodule",
    "",
  ].join("\n");

  const analysis = () => analyzeTree(parser.parse(TB), TB);
  const document = () => TextDocument.create("file:///tb.sv", "systemverilog", 1, TB);

  const catalogFor = () => {
    const a = analysis();
    const catalog = new Catalog();
    catalog.replaceDocument("file:///tb.sv", a.scopes, a.accesses);
    return { catalog, analysis: a };
  };

  const names = (): string[] => {
    const a = analysis();
    return computeDiagnostics(document(), a, catalogFor().catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    }).map((d) => d.message);
  };

  it("opens a scope for `begin : name`", () => {
    const named = analysis().scopes.filter(
      (s) => s.category === "block" && !s.name.startsWith("<"),
    );

    assert.deepEqual(named.map((s) => s.name).sort(), ["gblk", "main", "mon"]);
    assert.deepEqual(
      named.map((s) => s.symbols.map((x) => x.name)).find((n) => n.includes("scratch")),
      ["scratch"],
      "the block owns the signals declared in it",
    );
  });

  it("declares the signals written inside the block", () => {
    // Without the block's scope, every signal declared in a `begin : name`
    // reads as undeclared -- at its declaration and at every use.
    assert.deepEqual(names(), []);
  });

  it("declares the block's name where a hierarchical name can reach it", () => {
    const module_ = analysis().scopes.find((s) => s.category === "module")!;
    const blocks = module_.symbols.filter((s) => s.category === "block").map((s) => s.name);

    assert.deepEqual(blocks.sort(), ["gblk", "main", "mon"]);
  });

  it("resolves a signal inside a named block", () => {
    const { catalog, analysis: a } = catalogFor();

    const resolved = resolvePath(
      identifierAt(a, TB.lastIndexOf("main.scratch") + 5),
      a,
      catalog,
      "file:///tb.sv",
    );
    assert.equal(resolved?.symbol.name, "scratch");
    assert.equal(resolved?.symbol.packedWidth, 8);
    assert.equal(resolved?.uri, "file:///tb.sv");
  });

  it("resolves a signal inside a block nested in a generate", () => {
    // `gblk` is a grandchild of the module, yet `gblk.lane` is written from the
    // module's body.
    const { catalog, analysis: a } = catalogFor();

    const resolved = resolvePath(
      identifierAt(a, TB.lastIndexOf("gblk.lane") + 5),
      a,
      catalog,
      "file:///tb.sv",
    );
    assert.equal(resolved?.symbol.name, "lane");
    assert.equal(resolved?.symbol.packedWidth, 4);
  });

  it("jumps to the declaration inside the block", () => {
    const { catalog, analysis: a } = catalogFor();
    const definition = provideDefinition(document(), a, catalog, TB.lastIndexOf("mon.hit") + "mon.".length);
    const loc = Array.isArray(definition) ? definition[0]! : definition!;

    assert.equal(loc?.uri, "file:///tb.sv");
    assert.equal(loc?.range.start.line, 9, "the line declaring `logic hit;`");
  });

  it("hovers with the type declared inside the block", () => {
    const { catalog, analysis: a } = catalogFor();
    const hover = provideHover(document(), a, catalog, TB.lastIndexOf("main.scratch") + 5, {
      showWidth: true,
      showType: true,
    });

    assert.ok(hover);
    assert.match((hover!.contents as { value: string }).value, /logic \[7:0\] scratch/);
  });

  it("offers the block's members after `main.`", () => {
    const { catalog, analysis: a } = catalogFor();
    const source = TB.replace('    $display("%h", main.scratch);', "    main.\n    $display(\"%h\", main.scratch);");
    const doc = TextDocument.create("file:///tb.sv", "systemverilog", 1, source);
    const an = analyzeTree(parser.parse(source), source);
    const cat = new Catalog();
    cat.replaceDocument("file:///tb.sv", an.scopes, an.accesses);

    const cursor = source.indexOf("    main.") + "    main.".length;
    const list = provideCompletion(
      { analysis: an, document: doc, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      cat,
      { showWidth: true, showType: true },
    );

    const scratch = list.items.find((i) => i.label === "scratch");
    assert.ok(scratch, `expected the block's members, got ${list.items.map((i) => i.label).join(", ")}`);
    assert.match(scratch!.detail ?? "", /8 bits/);
  });

  it("reports a name the block does not declare", () => {
    const source = TB.replace("main.scratch", "main.nope");
    const an = analyzeTree(parser.parse(source), source);
    const cat = new Catalog();
    cat.replaceDocument("file:///tb.sv", an.scopes, an.accesses);

    const found = computeDiagnostics(
      TextDocument.create("file:///tb.sv", "systemverilog", 1, source),
      an,
      cat,
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: false,
        blockingInSequential: false,
        implicitSensitivity: false,
        latchDetection: false,
      },
    );

    assert.ok(
      found.some((d) => d.message.includes("nope")),
      "the scope was reached, so the missing name is a real finding",
    );
  });

  it("does not give an unnamed block a scope of its own", () => {
    // Every `begin ... end` becoming a scope pushed a 243-line module to 55
    // scopes, and `scopeChain` is called on every keystroke. An unnamed block is
    // not addressable, so it contributes its declarations to the module.
    const source = [
      "module m;",
      "  always @(posedge clk) begin",
      "    logic tmp;",
      "    tmp = 1'b0;",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    const scopes = analyzeTree(parser.parse(source), source).scopes;
    assert.deepEqual(scopes.map((s) => `${s.category}:${s.name}`), ["module:m"]);
  });

  it("still collects the declarations of an unnamed block", () => {
    const source = [
      "module m;",
      "  always @(posedge clk) begin",
      "    logic tmp;",
      "    tmp = 1'b0;",
      "  end",
      "endmodule",
      "",
    ].join("\n");

    const module_ = analyzeTree(parser.parse(source), source).scopes[0]!;
    assert.deepEqual(module_.symbols.map((s) => s.name), ["tmp"]);
  });

  it("reads a named block inside a fork", () => {
    const source = [
      "module m;",
      "  initial fork : worker",
      "    logic flag;",
      "    flag = 1'b1;",
      "  join",
      "  initial $display(\"%b\", worker.flag);",
      "endmodule",
      "",
    ].join("\n");

    const a = analyzeTree(parser.parse(source), source);
    const catalog = new Catalog();
    catalog.replaceDocument("file:///m.sv", a.scopes, a.accesses);

    assert.ok(a.scopes.some((s) => s.name === "worker" && s.category === "block"));

    const found = computeDiagnostics(
      TextDocument.create("file:///m.sv", "systemverilog", 1, source),
      a,
      catalog,
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: false,
        blockingInSequential: false,
        implicitSensitivity: false,
        latchDetection: false,
      },
    );
    assert.deepEqual(found.map((d) => d.message), []);
  });
});

/* ------------------------------------------------------------------ *
 * Named blocks in every generate form
 * ------------------------------------------------------------------ */

describe("named blocks in generate constructs", () => {
  /**
   * Every shape of `generate` that can hold a named block.
   *
   * Listed by source form rather than by grammar node type on purpose. The node
   * names are not guessable -- a `for` construct is `loop_generate_construct`,
   * a case arm is `case_generate_item` -- and an earlier attempt listed
   * `for_generate_construct`, matched nothing, and every `begin : name` inside a
   * generate loop silently went unopened.
   */
  const FORMS: Record<string, string> = {
    "for": [
      "module m;",
      "  wire [3:0] seen;",
      "  genvar j;",
      "  generate",
      "    for (j = 0; j < 4; j = j + 1) begin : loop_blk",
      "      wire inner;",
      "    end",
      "  endgenerate",
      "  initial $display(\"%b\", loop_blk.inner);",
      "endmodule",
    ].join("\n"),

    "if": [
      "module m;",
      "  wire seen;",
      "  generate",
      "    if (1) begin : then_blk",
      "      wire inner;",
      "    end else begin : else_blk",
      "      wire other;",
      "    end",
      "  endgenerate",
      "  initial $display(\"%b %b\", then_blk.inner, else_blk.other);",
      "endmodule",
    ].join("\n"),

    "if sem else": [
      "module m;",
      "  wire seen;",
      "  generate",
      "    if (1) begin : only_blk",
      "      wire inner;",
      "    end",
      "  endgenerate",
      "  initial $display(\"%b\", only_blk.inner);",
      "endmodule",
    ].join("\n"),

    "case": [
      "module m;",
      "  wire seen;",
      "  generate",
      "    case (2)",
      "      0: begin : zero_blk",
      "        wire inner;",
      "      end",
      "      default: begin : other_blk",
      "        wire other;",
      "      end",
      "    endcase",
      "  endgenerate",
      "  initial $display(\"%b %b\", zero_blk.inner, other_blk.other);",
      "endmodule",
    ].join("\n"),


    "aninhado": [
      "module m;",
      "  wire seen;",
      "  generate",
      "    if (1) begin : outer_blk",
      "      if (1) begin : inner_blk",
      "        wire deep;",
      "      end",
      "    end",
      "  endgenerate",
      "  initial $display(\"%b\", outer_blk.inner_blk.deep);",
      "endmodule",
    ].join("\n"),

    "for dentro de if": [
      "module m;",
      "  wire seen;",
      "  genvar j;",
      "  generate",
      "    if (1) begin : gate_blk",
      "      for (j = 0; j < 2; j = j + 1) begin : lane_blk",
      "        wire inner;",
      "      end",
      "    end",
      "  endgenerate",
      "  initial $display(\"%b\", gate_blk.lane_blk.inner);",
      "endmodule",
    ].join("\n"),
  };

  const namesOf = (source: string): string[] => {
    const analysis = analyzeTree(parser.parse(source), source);
    const catalog = new Catalog();
    catalog.replaceDocument("file:///m.sv", analysis.scopes, analysis.accesses);

    return computeDiagnostics(
      TextDocument.create("file:///m.sv", "systemverilog", 1, source),
      analysis,
      catalog,
      {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: false,
        blockingInSequential: false,
        implicitSensitivity: false,
        latchDetection: false,
      },
    ).map((d) => d.message);
  };

  for (const [form, source] of Object.entries(FORMS)) {
    it(`opens a named block inside a generate ${form}`, () => {
      assert.deepEqual(namesOf(source), [], `\`${form}\` should resolve every name`);
    });
  }

  it("reports a name the block does not declare", () => {
    const source = FORMS["for"]!.replace("loop_blk.inner", "loop_blk.nope");
    assert.ok(
      namesOf(source).some((m) => m.includes("nope")),
      "the block was reached, so the missing name is a real finding",
    );
  });

  it("descends through wrappers whose type it was never told about", () => {
    // The guard is the shape of the name, so a construct the list does not
    // mention is still descended into. Both of these names are the grammar's
    // own, and neither is guessable: a `for` is `loop_generate_construct` and a
    // case arm is `case_generate_item`.
    const wrappersOf = (source: string): Set<string> => {
      const found = new Set<string>();
      const stack = [parser.parse(source).rootNode];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.type.includes("generate")) found.add(node.type);
        for (let i = node.childCount - 1; i >= 0; i--) {
          const child = node.child(i);
          if (child) stack.push(child);
        }
      }
      return found;
    };

    assert.ok(
      wrappersOf(FORMS["for"]!).has("loop_generate_construct"),
      "a `for` construct is called loop_generate_construct, not for_generate_construct",
    );
    assert.ok(
      wrappersOf(FORMS["case"]!).has("case_generate_item"),
      "a case arm is called case_generate_item, not case_item",
    );
  });
});

/* ------------------------------------------------------------------ *
 * A realistic RTL file
 * ------------------------------------------------------------------ */

describe("a module with compiler directives and a header import", () => {
  const FILE = [
    "`default_nettype none",
    "",
    "// includes",
    "`ifndef SYNTH",
    '    `include "mem1.v"',
    "`endif",
    '`include "pkg_users.v"// a comment glued to the directive',
    '`include "sub/handshake.v"',
    "",
    "module top",
    "    import salsa2_dsp_pkg::*;",
    "    (",
    "        input  wire [2:0]                     chip_id_i,",
    "        input  wire [C_ADC_W-1:0]             dsp_dat_i [C_NB_CHAN],",
    "        output logic [C_PKT_DAT_W-1:0]        pkt_dat_word_o [C_NB_DLINK],",
    "        output logic [C_NB_DLINK-1:0]         pkt_dat_valid_o",
    "    );",
    "",
    "    wire [4*C_NB_CHAN-1:0]                  pkt_counts_o;",
    "    wire [2*C_PKT_DAT_W*C_NB_CHAN-1:0]      masked_data_bus;",
    "    wire [C_NB_CHAN-1:0]                    channel_gnt_bus_o;",
    "    reg  [2*C_NB_CHAN-1:0]                 r_channel_gnt_delayed;",
    "",
    "    assign pkt_dat_valid_o = channel_gnt_bus_o;",
    "",
    "    genvar j;",
    "    generate",
    "        for (j = 0; j < 2*C_NB_CHAN; j = j + 1)",
    "        begin : grant_delay_loop",
    "            assign masked_data_bus[32*j +: 32] = channel_gnt_bus_o[j];",
    "        end",
    "    endgenerate",
    "",
    "endmodule",
    "",
  ].join("\n");

  const PKG = [
    "package salsa2_dsp_pkg;",
    "parameter int C_NB_CHAN   = 32;",
    "parameter int C_ADC_W     = 12;",
    "parameter int C_NB_DLINK  = 4;",
    "parameter int C_PKT_DAT_W = 32;",
    "endpackage",
    "",
  ].join("\n");

  const build = () => {
    const catalog = new Catalog();
    catalog.replaceDocument("file:///p.sv", analyzeTree(parser.parse(PKG), PKG).scopes, []);
    const analysis = analyzeTree(
      parser.parse(FILE),
      FILE,
      catalog.classNames(),
      (name) => catalog.parameterValues(name),
    );
    catalog.replaceDocument("file:///top.v", analysis.scopes, analysis.accesses);
    return { catalog, analysis };
  };

  const document = () => TextDocument.create("file:///top.v", "systemverilog", 1, FILE);

  const messages = () =>
    computeDiagnostics(document(), build().analysis, build().catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    }).map((d) => d.message);

  it("finds the module after a run of compiler directives", () => {
    // `default_nettype, `ifndef and a dozen `include lines come first, and a
    // comment glued to a directive does not break the parse.
    const { analysis } = build();
    const module_ = analysis.scopes.find((s) => s.category === "module");

    assert.ok(module_, "the module is found");
    assert.equal(module_.name, "top");
    assert.deepEqual(module_.imports?.map((i) => i.packageName), ["salsa2_dsp_pkg"]);
  });

  it("resolves every package parameter, including inside arithmetic", () => {
    assert.deepEqual(messages(), []);
  });

  it("resolves the width of a range written as an expression", () => {
    const { analysis } = build();
    const module_ = analysis.scopes.find((s) => s.category === "module")!;
    const counts = module_.symbols.find((s) => s.name === "pkt_counts_o");

    // 4 * C_NB_CHAN = 4 * 32
    assert.equal(counts?.packedWidth, 128);
    assert.equal(module_.symbols.find((s) => s.name === "masked_data_bus")?.packedWidth, 2 * 32 * 32);
  });

  it("opens the named block inside the generate loop", () => {
    const { analysis } = build();
    const block = analysis.scopes.find((s) => s.name === "grant_delay_loop");

    assert.ok(block, "the loop body is a named block");
    assert.equal(block!.category, "block");
  });

  it("reports nothing across the whole file", () => {
    assert.deepEqual(messages(), []);
  });
});

/* ------------------------------------------------------------------ *
 * A file opened before the workspace index lands
 * ------------------------------------------------------------------ */

describe("diagnostics before and after indexing", () => {
  const PKG = [
    "package salsa2_dsp_pkg;",
    "parameter int C_NB_CHAN   = 32;",
    "parameter int C_ADC_W     = 12;",
    "parameter int C_NB_DLINK  = 4;",
    "parameter int C_PKT_DAT_W = 32;",
    "endpackage",
    "",
  ].join("\n");

  const MOD = [
    "`default_nettype none",
    "`ifndef SYNTH",
    '    `include "mem.v"',
    "`endif",
    "",
    "module salsa2_dsp",
    "    import salsa2_dsp_pkg::*;",
    "    (",
    "        input  wire [C_ADC_W-1:0]      dsp_dat_i [C_NB_CHAN],",
    "        output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o [C_NB_DLINK]",
    "    );",
    "endmodule: salsa2_dsp",
    "",
  ].join("\n");

  const workspace = mkdtempSync(path.join(tmpdir(), "svision-timing-"));
  writeFileSync(path.join(workspace, "salsa2_dsp_pkg.sv"), PKG, "utf8");
  writeFileSync(path.join(workspace, "salsa2_dsp.sv"), MOD, "utf8");

  const uri = pathToUri(path.join(workspace, "salsa2_dsp.sv"));
  const document = TextDocument.create(uri, "systemverilog", 1, MOD);

  const findings = (analysis: Analysis, catalog: Catalog): string[] =>
    computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: false,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    }).map((d) => d.message);

  it("reports every package parameter before the index is built", async () => {
    // What the editor sees when the file is opened: the index has not finished,
    // so the catalog is empty and every parameter looks undeclared.
    const catalog = new Catalog();
    const analysis = analyzeTree(parser.parse(MOD), MOD);
    catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);

    const found = findings(analysis, catalog);
    assert.ok(
      found.some((m) => m.includes("C_ADC_W")) && found.some((m) => m.includes("C_NB_CHAN")),
      "and those findings stay until something re-runs them",
    );
  });

  it("leaves the port widthless before the index is built", async () => {
    const analysis = analyzeTree(parser.parse(MOD), MOD);
    const port = analysis.scopes.find((s) => s.category === "module")!.ports[0]!;

    assert.equal(port.packedWidth, undefined, "the value lives in the package's file");
  });

  it("resolves everything once the workspace is indexed", async () => {
    const catalog = new Catalog();
    await new WorkspaceIndexer(parser, catalog).indexFolders([workspace]);

    const analysis = analyzeTree(
      parser.parse(MOD),
      MOD,
      catalog.classNames(),
      (name) => catalog.parameterValues(name),
    );
    catalog.replaceDocument(uri, analysis.scopes, analysis.accesses);

    assert.deepEqual(findings(analysis, catalog), []);

    const module_ = analysis.scopes.find((s) => s.category === "module")!;
    assert.equal(module_.name, "salsa2_dsp");
    assert.deepEqual(module_.imports?.map((i) => i.packageName), ["salsa2_dsp_pkg"]);
    assert.equal(module_.ports.find((p) => p.name === "dsp_dat_i")?.packedWidth, 12);
    assert.equal(module_.ports.find((p) => p.name === "pkt_dat_word_o")?.unpackedCount, 4);
  });

  it("recovers the width on a re-analysis with the same text", async () => {
    // The document's version never changes when only the index moved, so the
    // cached analysis would keep the wrong width forever without a forced pass.
    const catalog = new Catalog();

    const documents = new DocumentManager(parser);
    documents.update(uri, document);
    catalog.replaceDocument(uri, documents.get(uri)!.analysis.scopes, documents.get(uri)!.analysis.accesses);

    assert.ok(findings(documents.get(uri)!.analysis, catalog).length > 0, "before indexing");

    await new WorkspaceIndexer(parser, catalog).indexFolders([workspace]);
    documents.knownClasses = () => catalog.classNames();
    documents.importedParameterValues = (name) => catalog.parameterValues(name);
    const updated = documents.reanalyze(uri)!;

    assert.deepEqual(findings(updated.analysis, catalog), []);
    assert.equal(
      updated.analysis.scopes.find((s) => s.category === "module")!.ports[0]?.packedWidth,
      12,
    );
  });

  it("handles `endmodule: name`", async () => {
    // The file closes with `endmodule: salsa2_dsp`, which is a different node
    // shape from a bare `endmodule`.
    const analysis = analyzeTree(parser.parse(MOD), MOD);
    const tree = analysis.parseTree;

    let found = false;
    const stack = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === "endmodule") found = true;
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i);
        if (child) stack.push(child);
      }
    }
    assert.ok(found, "`endmodule: name` is still an endmodule node");
  });
});

/* ------------------------------------------------------------------ *
 * Verilog-1995: declarations after a non-ANSI header
 * ------------------------------------------------------------------ */

describe("Verilog-1995 declarations", () => {
  /**
   * The 1995 dialect: the header lists bare names and the body carries the
   * declarations. Every one of them arrives wrapped in a `module_item`, so
   * without flattening that wrapper a whole design dialect loses its parameters
   * -- while its ports survive, because those are read from the body by a
   * separate path. The symptom is a module whose ports look fine and whose
   * `parameter integer DATAW = 12;` is invisible.
   */
  const V1995 = [
    "module m (a, b, q, d);",
    "  parameter integer DATAW = 12;",
    "  parameter DEPTH = 4;",
    "  localparam integer HALF = 2;",
    "  input  [DATAW-1:0] a;",
    "  input  b;",
    "  output reg [DATAW-1:0] q;",
    "  input  d;",
    "  logic [7:0] internal;",
    "endmodule",
    "",
  ].join("\n");

  const scope = () => analyzeTree(parser.parse(V1995), V1995).scopes[0]!;

  it("reads a parameter written after a non-ANSI header", () => {
    const names = scope().parameters.map((p) => p.name);

    assert.ok(names.includes("DATAW"), `expected DATAW, got ${names.join(", ")}`);
    assert.ok(names.includes("DEPTH"));
    assert.ok(names.includes("HALF"));
  });

  it("keeps the declared type and the folded default", () => {
    const dataw = scope().parameters.find((p) => p.name === "DATAW");

    assert.equal(dataw?.typeText, "integer");
    assert.equal(dataw?.resolvedValue, 12);
    assert.equal(scope().parameters.find((p) => p.name === "HALF")?.category, "localparam");
  });

  it("still reads the ports, with their directions and widths", () => {
    const ports = new Map(scope().ports.map((p) => [p.name, p]));

    assert.equal(ports.get("a")?.direction, "input");
    assert.equal(ports.get("a")?.packedWidth, 12, "a uses the module's own parameter");
    assert.equal(ports.get("q")?.direction, "output");
    assert.equal(ports.get("q")?.packedWidth, 12);
    assert.equal(ports.get("b")?.packedWidth, 1);
  });

  it("reads declarations that are not ports at all", () => {
    // `module_item` wraps every kind of declaration, not just parameters.
    assert.ok(scope().symbols.some((s) => s.name === "internal"));
  });

  it("resolves the parameter at every use in the file", () => {
    const found = diagnose(V1995, { unknownIdentifiers: true });

    assert.deepEqual(found.map((d) => d.message), []);
  });

  it("does not declare a name that the header does not list", () => {
    // `port_declaration` for a name absent from the header list is a mistake,
    // and reading the body must not paper over it.
    const source = [
      "module m (a);",
      "  parameter integer DATAW = 12;",
      "  input a;",
      "  input not_in_header;",
      "endmodule",
      "",
    ].join("\n");

    const ports = analyzeTree(parser.parse(source), source).scopes[0]!.ports;

    assert.deepEqual(ports.map((p) => p.name), ["a"]);
  });

  it("reads declarations in a non-ANSI interface", () => {
    const source = [
      "interface bus_if (clk);",
      "  parameter integer DATAW = 12;",
      "  input clk;",
      "endinterface",
      "",
    ].join("\n");

    const analysis = analyzeTree(parser.parse(source), source);
    const bus = analysis.scopes.find((s) => s.category === "interface")!;

    assert.deepEqual(bus.parameters.map((p) => p.name), ["DATAW"]);
    assert.deepEqual(bus.ports.map((p) => p.name), ["clk"]);
  });

  it("reads declarations in a non-ANSI program", () => {
    const source = [
      "program test (clk);",
      "  parameter integer DATAW = 12;",
      "  input clk;",
      "endprogram",
      "",
    ].join("\n");

    const analysis = analyzeTree(parser.parse(source), source);
    const prog = analysis.scopes.find((s) => s.category === "program")!;

    assert.deepEqual(prog.parameters.map((p) => p.name), ["DATAW"]);
    assert.deepEqual(prog.ports.map((p) => p.name), ["clk"]);
  });

  it("reads it in every place a parameter can be written", () => {
    const cases: Record<string, string> = {
      "parametro de modulo": "module m;\n parameter integer DATAW = 12;\nendmodule\n",
      "localparam": "module m;\n localparam integer DATAW = 12;\nendmodule\n",
      "cabecalho ANSI": "module m #(parameter integer DATAW = 12) ();\nendmodule\n",
      "cabecalho nao-ANSI": "module m (a);\n parameter integer DATAW = 12;\n input a;\nendmodule\n",
      package: "package p;\n parameter integer DATAW = 12;\nendpackage\n",
      classe: "class C;\n parameter integer DATAW = 12;\nendclass\n",
      unsigned: "module m;\n parameter integer unsigned DATAW = 12;\nendmodule\n",
      multiplos: "module m;\n parameter integer A = 1, B = 2;\nendmodule\n",
      "usado na largura": "module m;\n parameter integer DATAW = 12;\n logic [DATAW-1:0] bus;\nendmodule\n",
    };

    for (const [onde, source] of Object.entries(cases)) {
      const names = analyzeTree(parser.parse(source), source).scopes.flatMap((s) => [
        ...s.parameters.map((p) => p.name),
        ...s.symbols.map((x) => x.name),
      ]);

      assert.ok(
        names.includes("DATAW") || names.includes("A"),
        `DATAW should be declared when written as ${onde}, got ${names.join(", ")}`,
      );
    }
  });

  it("folds a width written in terms of a 1995 parameter", () => {
    const source = [
      "module m (q);",
      "  parameter integer DATAW = 12;",
      "  output reg [DATAW-1:0] q;",
      "endmodule",
      "",
    ].join("\n");

    assert.equal(analyzeTree(parser.parse(source), source).scopes[0]!.ports[0]?.packedWidth, 12);
  });

  it("shows the parameter in completion and hover", () => {
    const a = analyzeTree(parser.parse(V1995), V1995);
    const catalog = new Catalog();
    catalog.replaceDocument("file:///m.sv", a.scopes, a.accesses);
    const document = TextDocument.create("file:///m.sv", "systemverilog", 1, V1995);

    const hover = provideHover(document, a, catalog, V1995.indexOf("DATAW") + 2, {
      showWidth: true,
      showType: true,
    });
    assert.match((hover!.contents as { value: string }).value, /integer DATAW = 12/);

    const source = V1995.replace("  input  [DATAW-1:0] a;", "  localparam integer USED = ");
    const an = analyzeTree(parser.parse(source), source);
    const doc = TextDocument.create("file:///m.sv", "systemverilog", 1, source);
    const cursor = source.indexOf("= ") + 2;
    const list = provideCompletion(
      { analysis: an, document: doc, offset: cursor, prefix: "", rangeStart: cursor },
      undefined as never,
      catalog,
      { showWidth: true, showType: true, includeParameters: true },
    );

    assert.ok(
      list.items.some((i) => i.label === "DATAW"),
      `expected DATAW, got ${list.items.map((i) => i.label).join(", ")}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Text macros
 * ------------------------------------------------------------------ */

describe("text macros", () => {
  /** The definition file, with both branches of the conditional. */
  const DEFS = [
    "`ifdef REMOVE_TMR",
    "`define TMRINST(HIGH,LOW,NAME) reg [HIGH : LOW] NAME",
    "`else",
    "`define TMRINST(HIGH,LOW,NAME) wire [HIGH : LOW] NAME; reg [HIGH : LOW] NAME``_TMR[2:0]; voting_nbit_3reg #(.SIZE((HIGH)-(LOW)+1))  NAME``_voter(.A(NAME``_TMR[0]), .out(NAME))",
    "`endif",
    "`define NOTMRINST(HIGH,LOW,NAME) reg [HIGH : LOW] NAME",
    "`define SIMPLE_W reg [7:0]",
    "",
  ].join("\n");

  /**
   * Indexes the definitions and analyses `use`, the way the server does: the
   * macro table comes from every file in the workspace, not from the file being
   * read, because a macro is defined in one file and used in another.
   */
  const build = async (use: string) => {
    const local = parser;
    const catalog = new Catalog();
    const documents = new DocumentManager(local);
    const workspace = mkdtempSync(path.join(tmpdir(), "svision-macro-"));
    writeFileSync(path.join(workspace, "defs.vh"), DEFS, "utf8");
    writeFileSync(path.join(workspace, "use.v"), use, "utf8");

    const indexer = new WorkspaceIndexer(local, catalog);
    await indexer.indexFolders([workspace]);

    documents.knownClasses = () => catalog.classNames();
    documents.importedParameterValues = (n) => catalog.parameterValues(n);
    documents.macros = () => indexer.macros;

    const uri = pathToUri(path.join(workspace, "use.v"));
    const document = TextDocument.create(uri, "systemverilog", 1, use);
    const entry = documents.update(uri, document);
    catalog.replaceDocument(uri, entry.analysis.scopes, entry.analysis.accesses);

    return { catalog, analysis: entry.analysis, document, uri, macros: indexer.macros };
  };

  const USE = [
    "module u;",
    "  parameter CHANW = 12;",
    "  parameter COUNW = 4;",
    "",
    "  `NOTMRINST((CHANW-1),0,chan_mask); // Masked channels",
    "  `NOTMRINST((COUNW-1),0,num_shift); // Number of shift",
    "",
    "  logic [3:0] x;",
    "endmodule",
    "",
  ].join("\n");

  it("collects a macro with its parameters and body", async () => {
    const { macros } = await build(USE);
    const notmr = macros.get("NOTMRINST");

    assert.ok(notmr, "the macro is indexed");
    assert.deepEqual(notmr!.params, ["HIGH", "LOW", "NAME"]);
    assert.match(notmr!.body, /reg \[HIGH : LOW\] NAME/);
  });

  it("takes the else branch when both define the same name", async () => {
    // Whether `REMOVE_TMR` is set is not knowable from the source. The later
    // definition wins, which is the branch taken when the feature is off -- and
    // the one most RTL relies on.
    const { macros } = await build(USE);

    assert.match(macros.get("TMRINST")!.body, /voting_nbit_3reg/);
  });

  it("declares what a macro invocation stands for", async () => {
    const { analysis } = await build(USE);
    const names = analysis.scopes[0]!.symbols.map((s) => s.name);

    assert.ok(names.includes("chan_mask"), `got ${names.join(", ")}`);
    assert.ok(names.includes("num_shift"));
  });

  it("folds the width from the macro's arguments", async () => {
    // `reg [(CHANW-1) : 0] chan_mask` with CHANW = 12.
    const { analysis } = await build(USE);
    const symbols = new Map(analysis.scopes[0]!.symbols.map((s) => [s.name, s]));

    assert.equal(symbols.get("chan_mask")?.packedWidth, 12);
    assert.equal(symbols.get("num_shift")?.packedWidth, 4);
  });

  it("does not report the declared names as unknown", async () => {
    const { catalog, analysis, document } = await build(USE);

    assert.deepEqual(
      computeDiagnostics(document, analysis, catalog, {
        enable: true,
        unknownIdentifiers: true,
        widthMismatch: false,
        blockingInSequential: false,
        implicitSensitivity: false,
        latchDetection: false,
      }).map((d) => d.message),
      [],
    );
  });

  it("expands token pasting", async () => {
    // `NAME``_TMR` is `NAME_TMR`: the backticks around the suffix go away and
    // what remains is appended to the token before them.
    const use = [
      "module u;",
      "  parameter WID = 12;",
      "  `TMRINST(WID-1,0,trg_sig);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = await build(use);
    const names = analysis.scopes[0]!.symbols.map((s) => s.name);

    assert.ok(names.includes("trg_sig"), `got ${names.join(", ")}`);
    assert.ok(names.includes("trg_sig_TMR"), "the pasted name");
    assert.equal(
      analysis.scopes[0]!.symbols.find((s) => s.name === "trg_sig_TMR")?.unpackedCount,
      3,
      "declared as `reg [11:0] trg_sig_TMR[2:0]`",
    );
  });

  it("expands a module instantiated inside a macro", async () => {
    const use = [
      "module u;",
      "  parameter WID = 12;",
      "  `TMRINST(WID-1,0,trg_sig);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = await build(use);
    const instances = analysis.scopes[0]!.instances.map((i) => i.instanceName);

    assert.deepEqual(instances, ["trg_sig_voter"]);
  });

  it("substitutes an argument only as a whole word", async () => {
    // `NAME` inside `NAME_TMR` is a different identifier, and rewriting it
    // would invent a symbol the author never wrote. Token pasting is the way
    // to build one, and it goes through backticks rather than substitution.
    const defs = ["`define M(NAME) reg [3:0] NAME_TMR", ""].join("\n");
    const use = ["module u;", "  `M(sig);", "endmodule", ""].join("\n");

    const local = parser;
    const catalog = new Catalog();
    const workspace = mkdtempSync(path.join(tmpdir(), "svision-word-"));
    writeFileSync(path.join(workspace, "defs.vh"), defs, "utf8");
    writeFileSync(path.join(workspace, "use.v"), use, "utf8");

    const indexer = new WorkspaceIndexer(local, catalog);
    await indexer.indexFolders([workspace]);

    const uri = pathToUri(path.join(workspace, "use.v"));
    const analysis = analyzeTree(local.parse(use), use, catalog.classNames(), undefined, indexer.macros, (t) =>
      local.parse(t),
    );

    assert.deepEqual(
      analysis.scopes[0]!.symbols.map((s) => s.name),
      ["NAME_TMR"],
      "the argument is not spliced into a longer name",
    );
  });

  it("leaves an unknown macro alone", async () => {
    // A macro from an unread include must not become an invented declaration.
    const use = ["module u;", "  `SOMETHING_ELSE(1,2,three);", "endmodule", ""].join("\n");
    const { analysis } = await build(use);

    assert.deepEqual(analysis.scopes[0]!.symbols.map((s) => s.name), []);
  });

  it("honours `undef", async () => {
    const defs = ["`define GONE reg [3:0] x", "`undef GONE", ""].join("\n");
    const local = parser;
    const catalog = new Catalog();
    const workspace = mkdtempSync(path.join(tmpdir(), "svision-undef-"));
    writeFileSync(path.join(workspace, "defs.vh"), defs, "utf8");

    const indexer = new WorkspaceIndexer(local, catalog);
    await indexer.indexFolders([workspace]);

    assert.equal(indexer.macros.get("GONE"), undefined);
  });

  it("anchors a macro's symbols at the invocation", async () => {
    // The expansion has coordinates of its own; they mean nothing in the file
    // being read, so everything has to be re-anchored onto the invocation.
    const use = [
      "module u;",
      "  parameter CHANW = 12;",
      "",
      "  `NOTMRINST((CHANW-1),0,chan_mask);",
      "",
      "  logic [3:0] use_it = chan_mask[0];",
      "endmodule",
      "",
    ].join("\n");

    const { analysis, document } = await build(use);
    const chan = analysis.scopes[0]!.symbols.find((s) => s.name === "chan_mask")!;
    const invocationLine = use.split("\n").findIndex((line) => line.includes("NOTMRINST"));

    assert.equal(chan.range.start.line, invocationLine);
    assert.equal(
      chan.range.start.character,
      use.split("\n")[invocationLine]!.indexOf("`NOTMRINST"),
      "the invocation starts at the backtick, not at the name",
    );

    // Hover on a use of it shows the expansion, which is what the reader is
    // missing from the source.
    const hover = provideHover(document, analysis, new Catalog(), use.indexOf("chan_mask[0]") + 2, {
      showWidth: true,
      showType: true,
    });
    assert.ok(hover, "the macro's signal has a hover");
    const value = (hover!.contents as { value: string }).value;
    assert.match(value, /chan_mask/);
    assert.match(value, /12 bits/);
  });

  it("shows a macro's declarations in the navigator", async () => {
    const { analysis } = await build(USE);
    const nav = buildNavigator(analysis);
    const all = nav.groups.flatMap((g) => g.signals);

    assert.ok(
      all.some((s) => s.name === "chan_mask" && s.sizeText === "12 bits"),
      `got ${all.map((s) => `${s.name} ${s.sizeText}`).join(", ")}`,
    );
  });

  it("still reads the module around the macro", async () => {
    const { analysis } = await build(USE);
    const scope = analysis.scopes[0]!;

    assert.equal(scope.name, "u");
    assert.deepEqual(scope.parameters.map((p) => p.name), ["CHANW", "COUNW"]);
    assert.ok(scope.symbols.some((s) => s.name === "x"));
  });
});

/* ------------------------------------------------------------------ *
 * Macros used where HDL is expected
 *
 * A macro call is legal anywhere an item or a statement is legal, and the
 * grammar has no production for it in either position. What it produces is a
 * parse that stops early, and the keywords around it are then blamed for a
 * mistake the author did not make.
 * ------------------------------------------------------------------ */

describe("macros in HDL position", () => {
  const DEFS = [
    "`define TMR(NAME,RANGE,ASSIGNMENT) NAME RANGE <= ASSIGNMENT",
    "`define NOTMR(NAME,RANGE,ASSIGNMENT) NAME RANGE <= ASSIGNMENT",
    "`define TMRINST(HIGH,LOW,NAME) wire [HIGH:LOW] NAME; reg [HIGH:LOW] NAME``_TMR[2:0]",
    "",
  ].join("\n");

  /** A non-ANSI header, which is the shape this code is written in. */
  const HEAD = [
    "module tmr_reg (clk, rstb, nstate, state);",
    "  parameter SIZE = 2;",
    "  input wire clk;",
    "  input wire rstb;",
    "  input wire [SIZE-1:0] nstate;",
    "",
  ].join("\n");

  const build = async (use: string) => {
    const catalog = new Catalog();
    const workspace = mkdtempSync(path.join(tmpdir(), "svision-macro-pos-"));
    writeFileSync(path.join(workspace, "defs.vh"), DEFS, "utf8");
    writeFileSync(path.join(workspace, "use.v"), use, "utf8");

    const indexer = new WorkspaceIndexer(parser, catalog);
    await indexer.indexFolders([workspace]);

    const documents = new DocumentManager(parser);
    documents.macros = () => indexer.macros;

    const uri = pathToUri(path.join(workspace, "use.v"));
    const document = TextDocument.create(uri, "systemverilog", 1, use);
    const entry = documents.update(uri, document);
    catalog.replaceDocument(uri, entry.analysis.scopes, entry.analysis.accesses);

    return { analysis: entry.analysis, catalog, document };
  };

  const diagnose = (document: TextDocument, analysis: ReturnType<typeof build>["analysis"], catalog: Catalog) =>
    computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: true,
      blockingInSequential: false,
      implicitSensitivity: false,
      latchDetection: false,
    });

  it("reports nothing for a macro used as a statement", async () => {
    // `` `TMR(state,,nstate); `` stands for an assignment. The grammar cannot
    // see it as a statement, so the `if` ends early and the `else` is left
    // dangling at module level -- a finding about the macro, not the author.
    const use = [
      HEAD,
      "  reg [SIZE-1:0] state;",
      "  reg [SIZE-1:0] state_TMR [2:0];",
      "  always @(posedge clk)",
      "    if(!rstb)",
      "      `TMR(state,,{SIZE{1'b0}});",
      "    else",
      "      `TMR(state,,nstate);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis, catalog, document } = await build(use);

    assert.deepEqual(diagnose(document, analysis, catalog).map((d) => d.message), []);
  });

  it("reports nothing for a macro behind a port direction", async () => {
    // `output `TMRINST(SIZE-1,0, state);` strands the `output` the same way.
    const use = [
      HEAD,
      "  output `TMRINST(SIZE-1,0, state);",
      "  always @(posedge clk)",
      "    if(!rstb) `TMR(state,,{SIZE{1'b0}});",
      "    else      `TMR(state,,nstate);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis, catalog, document } = await build(use);
    const codes = diagnose(document, analysis, catalog).map((d) => d.code);

    assert.deepEqual(codes.filter((c) => c === "syntax-error"), [], "no stray syntax error");
    assert.deepEqual(codes.filter((c) => c === "unknown-identifier"), [], "no unknown identifier");
  });

  it("still declares what the macro expands to", async () => {
    const use = [
      HEAD,
      "  output `TMRINST(SIZE-1,0, state);",
      "  always @(posedge clk)",
      "    if(!rstb) `TMR(state,,{SIZE{1'b0}});",
      "    else      `TMR(state,,nstate);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis } = await build(use);
    const names = analysis.scopes[0]!.symbols.map((s) => s.name);

    assert.ok(names.includes("state"), `got ${names.join(", ")}`);
    assert.ok(names.includes("state_TMR"), "the pasted name");
  });

  it("does not report a macro's formal arguments as undeclared", async () => {
    // `NAME`, `RANGE` and `ASSIGNMENT` are what the macro substitutes, not
    // signals. The grammar nests each under `formal_argument`, so filtering the
    // definition alone left every one of them reported.
    const { analysis } = await build(HEAD + "endmodule\n");
    const messages = diagnose(
      TextDocument.create("file:///probe/v.v", "systemverilog", 1, HEAD + "endmodule\n"),
      analysis,
      new Catalog(),
    ).map((d) => d.message);

    assert.deepEqual(
      messages.filter((m) => /NAME|RANGE|ASSIGNMENT/.test(m)),
      [],
    );
  });

  it("still reports a real syntax error away from any macro", async () => {
    // The suppression is narrow on purpose. A file that uses macros must not
    // go quiet about its own mistakes.
    const use = [
      HEAD,
      "  reg [SIZE-1:0] state;",
      "  reg [SIZE-1:0] state_TMR [2:0];",
      "  always @(posedge clk) state <= nstate",
      "  `TMRINST(SIZE-1,0, spare);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis, catalog, document } = await build(use);
    const codes = diagnose(document, analysis, catalog).map((d) => d.code);

    assert.ok(codes.includes("syntax-error"), `got ${codes.join(", ")}`);
  });

  it("still reports a dangling else that no macro caused", async () => {
    // An `else` after a real `end` is the author's mistake, however many macros
    // the file uses elsewhere.
    const use = [
      HEAD,
      "  reg [SIZE-1:0] state;",
      "  always @(posedge clk) begin",
      "    state <= nstate;",
      "  else",
      "    state <= nstate;",
      "  end",
      "  `TMRINST(SIZE-1,0, spare);",
      "endmodule",
      "",
    ].join("\n");

    const { analysis, catalog, document } = await build(use);
    const findings = diagnose(document, analysis, catalog);

    assert.ok(
      findings.some((d) => d.code === "syntax-error" && /else/.test(d.message)),
      `got ${findings.map((d) => d.message).join(" | ")}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Indexing across folders
 *
 * A macro is defined in one folder and called in another, and the index is the
 * only place the whole set exists. Indexing a second folder must therefore add
 * to what is known rather than replace it.
 * ------------------------------------------------------------------ */

describe("indexing a second folder", () => {
  const DEFS = [
    "`ifndef TMR_V",
    "`define TMR_V",
    "`include \"voting_nbit_3reg.v\"",
    "`ifdef REMOVE_TMR",
    "`define TMR(NAME,RANGE,ASSIGNMENT) NAME RANGE <= ASSIGNMENT",
    "`else",
    "`define TMR(NAME,RANGE,ASSIGNMENT) NAME RANGE <= ASSIGNMENT",
    "`endif",
    "`define NOTMRINST(HIGH,LOW,NAME) reg [HIGH : LOW] NAME",
    "`endif",
    "",
  ].join("\n");

  /** The caller of the macros, in a folder of its own, as a project has it. */
  const USER = [
    "module pattern_generator (Clk, Rst, PeValAddr, PeValCen);",
    "  parameter integer ADDRW = 8;",
    "  parameter integer CHANW = 32;",
    "  parameter integer COUNW = 8;",
    "",
    "  input Clk;",
    "  input Rst;",
    "  input [ADDRW-1:0] PeValAddr;",
    "  input PeValCen;",
    "",
    "  `NOTMRINST((ADDRW-1),0,rd_pt)",
    "  `NOTMRINST((COUNW-1),0,aux)",
    "  `NOTMRINST((CHANW-1),0,chan_mask)",
    "  wire [ADDRW-1:0] rd_pt_next;",
    "  always @(posedge Clk)",
    "    if (!Rst)",
    "      `TMR(rd_pt,,{ADDRW{1'b0}});",
    "    else",
    "      `TMR(rd_pt,,rd_pt_next);",
    "endmodule",
    "",
  ].join("\n");

  /**
   * Builds the layout and replays what the server does: index the project root
   * at startup, then index the folder of the file that was just opened.
   */
  const scenario = async () => {
    const catalog = new Catalog();
    const root = mkdtempSync(path.join(tmpdir(), "svision-folders-"));
    const common = path.join(root, "common");
    const rtl = path.join(root, "rtl");
    mkdirSync(common, { recursive: true });
    mkdirSync(rtl, { recursive: true });
    writeFileSync(path.join(common, "tmr.v"), DEFS, "utf8");
    writeFileSync(path.join(rtl, "pattern_generator.v"), USER, "utf8");

    const indexer = new WorkspaceIndexer(parser, catalog);

    // Startup pass: the whole project, both folders.
    await indexer.indexFolders([root]);
    const afterStartup = indexer.macros.size;

    // Then the file is opened, and its own folder is indexed again.
    await indexer.indexFolders([rtl]);

    const documents = new DocumentManager(parser);
    documents.knownClasses = () => catalog.classNames();
    documents.importedParameterValues = (n) => catalog.parameterValues(n);
    documents.macros = () => indexer.macros;

    const uri = pathToUri(path.join(rtl, "pattern_generator.v"));
    const document = TextDocument.create(uri, "systemverilog", 1, USER);
    const entry = documents.update(uri, document);
    catalog.replaceDocument(uri, entry.analysis.scopes, entry.analysis.accesses);

    return { afterStartup, analysis: entry.analysis, catalog, document };
  };

  const diagnose = (document: TextDocument, analysis: Analysis, catalog: Catalog) =>
    computeDiagnostics(document, analysis, catalog, {
      enable: true,
      unknownIdentifiers: true,
      widthMismatch: true,
      blockingInSequential: true,
      implicitSensitivity: true,
      latchDetection: true,
    });

  it("keeps the macros learned from the first folder", async () => {
    const { afterStartup } = await scenario();

    assert.ok(afterStartup > 0, "the startup pass found the macros");
  });

  it("still knows the macros after indexing a second folder", async () => {
    const { analysis } = await scenario();
    const names = analysis.scopes[0]!.symbols.map((s) => s.name);

    assert.ok(names.includes("rd_pt"), `got ${names.join(", ")}`);
    assert.ok(names.includes("aux"));
    assert.ok(names.includes("chan_mask"));
  });

  it("reports nothing once a second folder has been indexed", async () => {
    const { analysis, catalog, document } = await scenario();
    const findings = diagnose(document, analysis, catalog);

    assert.deepEqual(findings.map((d) => `${d.code} L${d.range.start.line + 1} ${d.message}`), []);
  });
});

/* ------------------------------------------------------------------ *
 * Macro calls nothing in the workspace can explain
 * ------------------------------------------------------------------ */

describe("undefined macros", () => {
  /**
   * The only way to tell "this macro lives in a header the editor cannot reach"
   * apart from "the tool is broken" is to say the name out loud, so the index
   * records it. `include` is not followed, which is what makes this happen: a
   * definition in a vendor library is invisible no matter how the file is
   * written.
   */
  const build = async (files: Record<string, string>) => {
    const catalog = new Catalog();
    const workspace = mkdtempSync(path.join(tmpdir(), "svision-undef-macro-"));
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(workspace, name), text, "utf8");
    }

    const indexer = new WorkspaceIndexer(parser, catalog);
    await indexer.indexFolders([workspace]);
    return indexer;
  };

  it("names a macro that no file defines", async () => {
    const indexer = await build({
      "use.v": ["module m;", "  `TMRINST(3,0,x);", "endmodule", ""].join("\n"),
    });

    assert.ok(indexer.undefinedMacros.has("TMRINST"), "recorded");
  });

  it("does not name a macro that is defined", async () => {
    const indexer = await build({
      "defs.vh": "`define TMRINST(H,L,N) reg [H:L] N\n",
      "use.v": ["module m;", "  `TMRINST(3,0,x);", "endmodule", ""].join("\n"),
    });

    assert.equal(indexer.undefinedMacros.has("TMRINST"), false);
  });

  it("does not mistake a directive for a macro call", async () => {
    const indexer = await build({
      "use.v": [
        "`ifndef GUARD",
        "`define GUARD",
        "`timescale 1ns/1ps",
        "`include \"other.v\"",
        "module m; endmodule",
        "`endif",
        "",
      ].join("\n"),
    });

    assert.deepEqual([...indexer.undefinedMacros.keys()], []);
  });
});
