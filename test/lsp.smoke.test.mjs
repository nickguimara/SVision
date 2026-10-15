/**
 * End-to-end smoke test: launches the *built* language server as a child
 * process and drives it over real LSP framing on stdio.
 *
 * This is what catches problems the unit tests cannot, such as the tree-sitter
 * WebAssembly payloads failing to resolve from `dist/`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "dist", "server.js");

const SAMPLE = `module counter #(
  parameter int W = 8
) (
  input  wire       clk,
  input  wire       rst_n,
  input  wire [W-1:0] din,
  output wire [W-1:0] dout
);
  logic [W-1:0] shadow;
  assign dout = din ^ shadow;
endmodule
`;

/** Minimal LSP stdio client. */
class Client {
  constructor(child) {
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.notifications = [];
    this.nextId = 1;

    child.stdout.on("data", (chunk) => this.onData(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) throw new Error(`malformed header: ${header}`);

      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;

      const body = this.buffer.subarray(start, start + length).toString("utf8");
      this.buffer = this.buffer.subarray(start + length);

      const message = JSON.parse(body);
      if (message.id !== undefined && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      } else {
        this.notifications.push(message);
      }
    }
  }

  write(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, 20000);

      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** Waits for a server-initiated notification matching `predicate`. */
  async waitFor(predicate, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.notifications.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("timed out waiting for notification");
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe("language server (built bundle)", () => {
  let client;
  let workspace;
  let uri;
  let child;

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "svision-smoke-"));
    await writeFile(path.join(workspace, "child.sv"), "module child #(parameter int W = 8) (input wire clk); endmodule\n");
    await mkdir(path.join(workspace, "interfaces"));
    await mkdir(path.join(workspace, "api"));
    await writeFile(path.join(workspace, "interfaces/stream.sv"), "interface stream_if; logic [7:0] data; endinterface\n");
    await writeFile(path.join(workspace, "api/test.svh"), [
      "class dsp_test;",
      " virtual stream_if vif;",
      " extern task generate_triangle_wave(input int samples, output int value);",
      "endclass", "",
    ].join("\n"));
    uri = `file://${workspace}/counter.sv`;

    // The extension host normally launches the server over IPC; the language
    // client reads the transport from the command line, so ask for stdio here.
    child = spawn(process.execPath, [serverEntry, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    client = new Client(child);

    const result = await client.request("initialize", {
      processId: process.pid,
      rootUri: `file://${workspace}`,
      capabilities: {},
      initializationOptions: {},
      workspaceFolders: [{ uri: `file://${workspace}`, name: "smoke" }],
    });

    assert.ok(result.capabilities.completionProvider, "completion should be advertised");
    assert.ok(result.capabilities.hoverProvider, "hover should be advertised");
    assert.ok(result.capabilities.definitionProvider, "definition should be advertised");
    assert.ok(result.capabilities.signatureHelpProvider, "argument hints should be advertised");

    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "systemverilog", version: 1, text: SAMPLE },
    });
  });

  after(async () => {
    try {
      await client?.request("shutdown", null);
      client?.notify("exit");
    } catch {
      /* server already gone */
    }
    child?.kill();
  });

  it("publishes diagnostics for an open document", async () => {
    const message = await client.waitFor(
      (n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === uri,
    );
    assert.ok(Array.isArray(message.params.diagnostics));
  });

  it("answers hover with a resolved width", async () => {
    // Caret just after `shadow` on the assignment line.
    const marker = SAMPLE.indexOf("din ^ shadow") + "din ^ shadow".length;
    const before = SAMPLE.slice(0, marker);
    const character = marker - before.lastIndexOf("\n") - 1;

    const hover = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line: before.split("\n").length - 1, character },
    });

    assert.ok(hover, "hover should return a result");
    const value = hover.contents.value;
    assert.match(value, /shadow/);
    assert.match(value, /8 bits/);
  });

  it("answers completion with workspace modules", async () => {
    const marker = SAMPLE.indexOf("assign dout");
    const before = SAMPLE.slice(0, marker);

    const completion = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line: before.split("\n").length - 1, character: before.length - before.lastIndexOf("\n") - 1 },
    });

    const items = completion.items ?? completion;
    assert.ok(items.length > 0, "completion should not be empty");
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("shadow"), "local signal should be offered");
    assert.ok(labels.includes("child"), "workspace module should be offered");
  });

  it("resolves a definition inside the document", async () => {
    const marker = SAMPLE.indexOf("din ^ shadow") + "din ^ shadow".length;
    const before = SAMPLE.slice(0, marker);

    const definition = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: before.split("\n").length - 1, character: marker - before.lastIndexOf("\n") - 1 },
    });

    assert.ok(definition, "definition should resolve");
    const locations = Array.isArray(definition) ? definition : [definition];
    assert.equal(locations[0].uri, uri);
  });

  it("answers the signal trace request", async () => {
    const hop = await client.request("svision/signalTrace", {
      module: "counter",
      signal: "value",
      uri,
    });

    assert.ok(hop, "a known signal must produce a trace");
    assert.equal(hop.moduleName, "counter");
    assert.equal(hop.signal, "value");
    assert.ok(Array.isArray(hop.drivers));
    assert.ok(Array.isArray(hop.loads));
  });

  it("returns null rather than throwing on an empty trace request", async () => {
    const none = await client.request("svision/signalTrace", { module: "", signal: "", uri });
    assert.equal(none, null);
  });

  it("answers the navigator request", async () => {
    const result = await client.request("svision/navigator", { uri });

    assert.ok(result, "an HDL file must produce a navigator");
    assert.ok(Array.isArray(result.groups));
    assert.ok(result.groups.length > 0, "the sample declares ports");
    const inputs = result.groups.find((g) => g.label === "Inputs");
    assert.ok(inputs, "ports are grouped by direction");
    assert.ok(inputs.signals.every((s) => typeof s.sizeText === "string"));
  });

  it("returns null for a navigator of a file it does not have", async () => {
    const result = await client.request("svision/navigator", { uri: "file:///nope.sv" });
    assert.equal(result, null);
  });

  it("names the module a file belongs to", async () => {
    const module = await client.request("svision/moduleAt", { uri });
    assert.equal(module, "counter");

    const missing = await client.request("svision/moduleAt", { uri: "file:///nope.sv" });
    assert.equal(missing, null);
  });

  it("names the module the design hangs from", async () => {
    const answer = await client.request("svision/designTop", { uri });

    assert.ok(answer, "the request answers with a top and the roots it saw");
    // `counter` is instantiated by nothing and `child` by nothing either, but
    // `counter` is the file being edited, so it is the top the caller asked for.
    assert.equal(answer.top.name, "counter");
    assert.ok(answer.top.reach >= 1);
    assert.ok(Array.isArray(answer.roots));
  });

  it("keeps the same top when asked twice", async () => {
    const first = await client.request("svision/designTop", { uri });
    const second = await client.request("svision/designTop", { uri });

    assert.deepEqual(second.top, first.top, "the answer is cached, not recomputed per request");
  });

  it("resolves an external task body and advertises its argument hints over LSP", async () => {
    const bodyUri = `file://${workspace}/implementation.sv`;
    const text = [
      "task automatic dsp_test::generate_triangle_wave(input int samples, output int value);",
      " int temporary;",
      " temporary = samples;",
      " value = temporary;",
      " vif.data = temporary;",
      " generate_triangle_wave(2, value);",
      "endtask", "",
    ].join("\n");
    client.notify("textDocument/didOpen", {
      textDocument: { uri: bodyUri, languageId: "systemverilog", version: 1, text },
    });
    const findings = await waitForCleanDiagnostics(client, bodyUri);
    assert.deepEqual(findings, []);
    const definition = await client.request("textDocument/definition", {
      textDocument: { uri: bodyUri }, position: { line: 4, character: 6 },
    });
    assert.equal(definition.uri, `file://${workspace}/interfaces/stream.sv`);
    const help = await client.request("textDocument/signatureHelp", {
      textDocument: { uri: bodyUri }, position: { line: 5, character: " generate_triangle_wave(2, ".length },
    });
    assert.equal(help.activeParameter, 1);
    assert.match(help.signatures[0].label, /input int samples, output int value/);
  });
});

/**
 * The case that reads like a bug report: one `.sv` file opened on its own, with
 * the package it uses sitting in a folder the editor has no other reason to
 * look at. Nothing here is in a workspace folder, so the folder walk sees only
 * `rtl/` -- the `include` is the only thing that names `pkgs/cfg_pkg.svh`.
 */
describe("a package reached only through an include", () => {
  const HEADER = [
    "`ifndef CFG_SVH",
    "`define CFG_SVH",
    "typedef logic [7:0] word_t;",
    "package cfg_pkg;",
    "  parameter int WIDTH = 32;",
    "endpackage",
    "`endif",
    "",
  ].join("\n");

  const USER = [
    '`include "../pkgs/cfg_pkg.svh"',
    "module datapath;",
    "  word_t w;",
    "  localparam int TOTAL = cfg_pkg::WIDTH;",
    "endmodule",
    "",
  ].join("\n");

  let client;
  let child;
  let uri;
  let headerUri;

  before(async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "svision-loose-"));
    await mkdir(path.join(workspace, "rtl"), { recursive: true });
    await mkdir(path.join(workspace, "pkgs"), { recursive: true });
    await writeFile(path.join(workspace, "pkgs/cfg_pkg.svh"), HEADER, "utf8");
    await writeFile(path.join(workspace, "pkgs/more.svh"), "typedef logic [3:0] nib_t;\n", "utf8");
    await writeFile(path.join(workspace, "rtl/datapath.sv"), USER, "utf8");

    uri = `file://${workspace}/rtl/datapath.sv`;
    headerUri = `file://${workspace}/pkgs/cfg_pkg.svh`;

    child = spawn(process.execPath, [serverEntry, "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    client = new Client(child);

    // What the extension host sends for a file opened without a folder: no
    // workspace at all, and the folder of the document as the only hint.
    await client.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      initializationOptions: { workspaceFolder: path.join(workspace, "rtl") },
      workspaceFolders: null,
    });

    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "systemverilog", version: 1, text: USER },
    });
  });

  after(async () => {
    try {
      await client?.request("shutdown", null);
      client?.notify("exit");
    } catch {
      /* server already gone */
    }
    child?.kill();
  });

  it("reports nothing for a name the included header declares", async () => {
    // The diagnostics arrive twice: once from the first analysis, and again once
    // the header has been read. The finding that must not survive is the unknown
    // identifier.
    const findings = await waitForCleanDiagnostics(client, uri);

    assert.deepEqual(
      findings.map((d) => d.message),
      [],
      "word_t and cfg_pkg::WIDTH both resolve once the include is followed",
    );
  });

  it("jumps to a declaration made in the header", async () => {
    const marker = USER.indexOf("word_t w") + "word_t".length - 1;
    const before = USER.slice(0, marker);

    const definition = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: before.split("\n").length - 1, character: marker - before.lastIndexOf("\n") - 1 },
    });

    assert.ok(definition, "the declaration in the header is reachable");
    assert.equal(definition.uri, headerUri);
  });

  it("hovers a type declared in the header", async () => {
    const marker = USER.indexOf("word_t w") + "word_t".length - 1;
    const before = USER.slice(0, marker);

    const hover = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line: before.split("\n").length - 1, character: marker - before.lastIndexOf("\n") - 1 },
    });

    assert.ok(hover, "hover should answer");
    assert.match(hover.contents.value, /cfg_pkg\.svh/);
  });

  it("follows an include the author just typed", async () => {
    // The folder was walked at startup, so no new walk happens for this file.
    // What has to notice the new line is the document itself, which is why the
    // includes are read from the tree the editor already produced.
    const edited = [
      '`include "../pkgs/cfg_pkg.svh"',
      '`include "../pkgs/more.svh"',
      "module datapath;",
      "  word_t w;",
      "  nib_t n;",
      "  localparam int TOTAL = cfg_pkg::WIDTH;",
      "endmodule",
      "",
    ].join("\n");

    const seen = diagnosticsFor(client, uri).length;
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: edited }],
    });

    const findings = await waitForCleanDiagnostics(client, uri, seen);
    assert.deepEqual(
      findings.map((d) => d.message),
      [],
      "nib_t is declared in a header that did not exist when the file was opened",
    );
  });
});

/** The diagnostics published for `uri` so far, oldest first. */
function diagnosticsFor(client, uri) {
  return client.notifications
    .filter((n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === uri)
    .map((n) => n.params.diagnostics);
}

/**
 * Waits until the newest diagnostics for `uri` are empty.
 *
 * The publication list is cumulative on purpose. An edit reaches the server
 * before the header it names has been read, so the findings arrive first and the
 * corrected ones after; waiting for the newest rather than the first is what
 * makes this a test of the whole round trip instead of of its first half.
 */
async function waitForCleanDiagnostics(client, uri, since = 0, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const all = diagnosticsFor(client, uri);
    const newest = all[all.length - 1] ?? [];
    if (all.length > since && newest.length === 0) return newest;
    if (Date.now() >= deadline) return newest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
