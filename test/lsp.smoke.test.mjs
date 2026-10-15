/**
 * End-to-end smoke test: launches the *built* language server as a child
 * process and drives it over real LSP framing on stdio.
 *
 * This is what catches problems the unit tests cannot, such as the tree-sitter
 * WebAssembly payloads failing to resolve from `dist/`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
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
});