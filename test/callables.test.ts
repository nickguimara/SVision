import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, after, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { VerilogParser } from "../src/server/verilogParser.js";
import { analyzeTree } from "../src/server/analyzer.js";
import { Catalog } from "../src/server/catalog.js";
import { WorkspaceIndexer, pathToUri } from "../src/server/workspaceIndex.js";
import { DocumentManager } from "../src/server/documentManager.js";
import { provideDefinition } from "../src/server/providers/definition.js";
import { provideHover } from "../src/server/providers/hover.js";
import { completionContext, provideCompletion } from "../src/server/providers/completion.js";
import { computeDiagnostics } from "../src/server/providers/diagnostics.js";
import { provideSignatureHelp, callAt } from "../src/server/callables.js";

let parser: VerilogParser;
before(async () => { parser = await VerilogParser.create(); });
after(() => parser.dispose());

const IFACE = `interface bus_if(input logic clk);
 logic [7:0] data;
 modport sink(input data);
 task automatic drive(input int count, output logic done); done = count > 0; endtask
endinterface`;
const CLASS = `class dsp_test;
 virtual bus_if vif;
 int amplitude;
 extern task generate_triangle_wave(input int count, output int result);
 extern function int calculate(input int x);
endclass`;
const BODY = `task automatic dsp_test::generate_triangle_wave(input int count, output int result);
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

async function project(source: string, extras: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "svision-callables-"));
  const files = { "interfaces/bus_if.sv": IFACE, "headers/dsp_test.svh": CLASS, "bodies/triangle.sv": BODY, ...extras, "rtl/use.sv": source };
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const catalog = new Catalog();
  const indexer = new WorkspaceIndexer(parser, catalog);
  await indexer.indexFolders([root]);
  const uri = pathToUri(path.join(root, "rtl/use.sv"));
  const document = TextDocument.create(uri, "systemverilog", 1, source);
  const manager = new DocumentManager(parser);
  manager.knownClasses = () => catalog.classNames();
  const { analysis } = manager.update(uri, document);
  const at = (needle: string) => source.lastIndexOf(needle) + needle.length;
  const complete = (needle: string) => provideCompletion(
    completionContext(document, analysis, at(needle)), manager, catalog,
    { showWidth: true, showType: true, snippets: true, systemFunctions: false, includeParameters: true }, indexer.includes,
  ).items;
  return { root, uri, document, analysis, catalog, indexer, manager, at, complete };
}

it("resolves cross-file interface ports, modports and instance members without includes", async () => {
  const p = await project(`module use_it(bus_if.sink bus);
 bus_if actual();
 initial begin bus.data = actual.data; end
endmodule`);
  for (const needle of ["bus.data", "actual.data"]) {
    const target = provideDefinition(p.document, p.analysis, p.catalog, p.at(needle) - 1) as { uri: string };
    assert.equal(target.uri, pathToUri(path.join(p.root, "interfaces/bus_if.sv")));
  }
  assert.ok(p.complete("bus.").some((i) => i.label === "data"));
  assert.ok(p.complete("actual.").some((i) => i.label === "drive"));
  p.manager.close(p.uri);
});

it("reads extern prototypes with ordered arguments and return types", async () => {
  const p = await project("module m; endmodule");
  const members = p.catalog.classMembers("dsp_test");
  assert.deepEqual(members.find((s) => s.name === "generate_triangle_wave")?.arguments?.map((a) => a.name), ["count", "result"]);
  assert.equal(members.find((s) => s.name === "calculate")?.typeText, "int");
  p.manager.close(p.uri);
});

it("resolves class fields, sibling methods and virtual interfaces inside out-of-block bodies", async () => {
  const p = await project(BODY);
  const diagnostics = computeDiagnostics(p.document, p.analysis, p.catalog, {
    enable: true, unknownIdentifiers: true, widthMismatch: false,
    blockingInSequential: false, implicitSensitivity: false, latchDetection: false,
  });
  assert.deepEqual(diagnostics.map((d) => d.message), []);
  const definition = provideDefinition(p.document, p.analysis, p.catalog, p.at("calculate(sum") - 5);
  assert.ok(definition);
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("vif.data") - 1) as { uri: string };
  assert.equal(target.uri, pathToUri(path.join(p.root, "interfaces/bus_if.sv")));
  p.manager.close(p.uri);
});

it("exposes prototype arguments when an external implementation omits them", async () => {
  const p = await project("task automatic dsp_test::generate_triangle_wave(); result = count; endtask");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("count") - 1) as { uri: string };
  assert.equal(target.uri, pathToUri(path.join(p.root, "headers/dsp_test.svh")));
  p.manager.close(p.uri);
});

it("keeps local declarations and for variables in task/function bodies", async () => {
  const tree = parser.parse(BODY);
  const analysis = analyzeTree(tree, BODY);
  assert.deepEqual(analysis.scopes.find((s) => s.category === "task")?.symbols.map((s) => s.name), ["sum", "i"]);
  assert.ok(analysis.scopes.find((s) => s.category === "function")?.symbols.some((s) => s.name === "temp"));
  tree.delete();
});

it("reads non-ANSI task arguments and inherited ANSI argument types", async () => {
  const source = `task old_style; input int a,b; output logic [7:0] q; q=a+b; endtask
function int add(input int a,b); return a+b; endfunction`;
  const tree = parser.parse(source);
  const analysis = analyzeTree(tree, source);
  assert.deepEqual(analysis.unitSymbols.find((s) => s.name === "old_style")?.arguments?.map((a) => a.name), ["a", "b", "q"]);
  assert.deepEqual(analysis.unitSymbols.find((s) => s.name === "add")?.arguments?.map((a) => a.typeText), ["int", "int"]);
  tree.delete();
});

it("completes external class, interface and free routines with argument placeholders", async () => {
  const p = await project(`module m(bus_if bus);
 initial begin dsp_test::generate_triangle_wave(1, 2); bus.drive(1, ready); helper(3); end
endmodule`, { "helpers/helper.sv": "function int helper(input int value); return value; endfunction" });
  assert.match(p.complete("dsp_test::generate_triangle_wave").find((i) => i.label === "generate_triangle_wave")?.detail ?? "", /input int count/);
  assert.match(p.complete("bus.drive").find((i) => i.label === "drive")?.detail ?? "", /output logic done/);
  const helper = p.complete("helper").find((i) => i.label === "helper");
  assert.ok(helper);
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("helper") - 1) as { uri: string };
  assert.equal(target.uri, pathToUri(path.join(p.root, "helpers/helper.sv")));
  p.manager.close(p.uri);
});

it("inserts callable snippets and shows the active argument while typing", async () => {
  const p = await project(`module m; initial dsp_test::generate_triangle_wave; endmodule`);
  const item = p.complete("dsp_test::generate_triangle_wave").find((i) => i.label === "generate_triangle_wave");
  assert.equal(item?.insertText, "generate_triangle_wave(${1:count}, ${2:result})$0");
  const text = "module m; initial dsp_test::generate_triangle_wave(3, ";
  const doc = TextDocument.create(p.uri, "systemverilog", 2, text);
  const help = provideSignatureHelp(doc, p.analysis, p.catalog, text.length);
  assert.equal(help?.activeParameter, 1);
  assert.match(help?.signatures[0]?.label ?? "", /output int result/);
  p.manager.close(p.uri);
});

it("offers named arguments, and signature help follows the argument name", async () => {
  const text = "module m; initial dsp_test::generate_triangle_wave(.res";
  const p = await project(text);
  assert.ok(p.complete(".res").some((i) => i.label === "result"));
  const named = text.replace(".res", ".result(");
  const doc = TextDocument.create(p.uri, "systemverilog", 2, named);
  assert.equal(provideSignatureHelp(doc, p.analysis, p.catalog, named.length)?.activeParameter, 1);
  p.manager.close(p.uri);
});

it("counts only top-level commas in calls", () => {
  assert.equal(callAt('f(g(1, 2), {a,b}, "c,d", ', 27)?.argument, 3);
  const text = "f(a /* , */, // ,\n b, ";
  assert.equal(callAt(text, text.length)?.argument, 2);
});

it("resolves imported package routines and shows argument defaults", async () => {
  const p = await project(`module m; import math_pkg::*; initial scale(2, 3); endmodule`, {
    "packages/math.sv": `package math_pkg;
 function automatic int scale(input int value, input int gain=4); return value*gain; endfunction
endpackage`,
  });
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("scale") - 1) as { uri: string };
  assert.equal(target.uri, pathToUri(path.join(p.root, "packages/math.sv")));
  const help = provideSignatureHelp(p.document, p.analysis, p.catalog, p.at("scale(2, "));
  assert.equal(help?.activeParameter, 1);
  assert.match(help?.signatures[0]?.label ?? "", /gain = 4/);
  const hover = provideHover(p.document, p.analysis, p.catalog, p.at("scale") - 1, { showType: true, showWidth: true });
  assert.match(JSON.stringify(hover), /input int value/);
  p.manager.close(p.uri);
});

it("makes included free tasks callable from another file", async () => {
  const p = await project('`include "../helpers/drive.svh"\nmodule m; initial pulse(1); endmodule', {
    "helpers/drive.svh": "task automatic pulse(input int cycles); int remaining; remaining=cycles; endtask",
  });
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("pulse") - 1, p.indexer.includes) as { uri: string };
  assert.equal(target.uri, pathToUri(path.join(p.root, "helpers/drive.svh")));
  assert.match(p.complete("pulse").find((i) => i.label === "pulse")?.detail ?? "", /cycles/);
  p.manager.close(p.uri);
});

it("keeps declarations local to the task rather than leaking them to its caller", async () => {
  const p = await project(`module m;
 task work(input int argument); int only_here; only_here=argument; endtask
 initial work(1);
endmodule`);
  assert.ok(!p.complete("work(1)").some((i) => i.label === "only_here" || i.label === "argument"));
  p.manager.close(p.uri);
});

it("resolves inherited methods to the file declaring them and prefers overrides", async () => {
  const p = await project(`class Derived extends Base;
 function int value(input int local_arg); return local_arg; endfunction
endclass
module m; Derived obj; initial obj.base_task(1); endmodule`, {
    "base/base.sv": "class Base; task base_task(input int cycles); endtask function int value(input int x); return x; endfunction endclass",
  });
  assert.equal(p.catalog.classMembers("Derived").find((s) => s.name === "value")?.arguments?.[0]?.name, "local_arg");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("obj.base_task") - 1) as { uri: string };
  assert.ok(target, "an inherited task call must resolve");
  assert.equal(target.uri, pathToUri(path.join(p.root, "base/base.sv")));
  p.manager.close(p.uri);
});

it("follows this through a virtual interface in an external method body", async () => {
  const p = await project("task dsp_test::generate_triangle_wave(); this.vif.data = count; endtask");
  const target = provideDefinition(p.document, p.analysis, p.catalog, p.at("this.vif.data") - 1) as { uri: string };
  assert.ok(target);
  assert.equal(target.uri, pathToUri(path.join(p.root, "interfaces/bus_if.sv")));
  p.manager.close(p.uri);
});
