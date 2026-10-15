import * as path from "node:path";

import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { NavigatorView } from "./navigatorView.js";
import { parseUri, registerToolViews, type ToolViews } from "./toolViews.js";

let client: LanguageClient | undefined;
let toolViews: ToolViews | undefined;
let stopping = false;
let outputChannel: vscode.LogOutputChannel | undefined;
let serverModule: string | undefined;

const OUTPUT_CHANNEL_NAME = "SVision";

/** Debounce before restarting the server after a rebuild. */
const RELOAD_DEBOUNCE_MS = 250;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
  context.subscriptions.push(output);
  outputChannel = output;
  serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

  client = createClient(output);

  context.subscriptions.push(
    vscode.commands.registerCommand("svision.restartLanguageServer", () => restartServer("manual")),
    vscode.commands.registerCommand("svision.showResolvedWidth", () => showResolvedWidth()),
    vscode.commands.registerCommand("svision.showSymbolReport", () => showSymbolReport()),
    // Shared by both sidebar views: a row in either one jumps to a location.
    vscode.commands.registerCommand(
      "svision.revealLocation",
      async (uri: string, line: number, character: number) => {
        const target = parseUri(uri);
        if (!target) return;

        const document = await vscode.workspace.openTextDocument(target);
        const position = new vscode.Position(line, character);
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(position, position),
          preview: false,
        });
      },
    ),
  );

  toolViews = registerToolViews(client, context);

  const navigator = new NavigatorView(client);
  context.subscriptions.push(
    navigator,
    vscode.commands.registerCommand("svision.refreshNavigator", () => void navigator.refresh()),
  );

  try {
    await client.start();
    output.appendLine("[svision] language server started");
  } catch (error) {
    output.appendLine(`[svision] failed to start language server: ${String(error)}`);
    output.show(true);
  }

  // Trace the signal under the cursor, the way a waveform viewer would: the
  // tracer view follows the cursor as it moves through the code.
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (event) => {
      if (!toolViews || !isHdl(event.textEditor.document.languageId)) return;

      const word = wordUnderCursor(event.textEditor, event.selections[0]);
      if (!word) return;

      await toolViews.trace(word, event.textEditor.document.uri.toString());
    }),
  );

  // Reload the server whenever its bundle is rebuilt, so edits to the server
  // take effect without reloading the window. The extension host itself still
  // needs a reload, but that code changes far less often.
  watchServerBundle(context);
}

export async function deactivate(): Promise<void> {
  stopping = true;
  await client?.stop();
  client = undefined;
}

/* ------------------------------------------------------------------ *
 * Client lifecycle
 * ------------------------------------------------------------------ */

function createClient(output: vscode.LogOutputChannel): LanguageClient {
  const module = serverModule!;
  const transport: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: {
      module,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const config = vscode.workspace.getConfiguration("svision");

  const options: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "systemverilog" },
      { scheme: "file", language: "verilog" },
      { scheme: "untitled", language: "systemverilog" },
      { scheme: "untitled", language: "verilog" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{sv,svh,svp,v,vh}"),
      configurationSection: "svision",
    },
    initializationOptions: {
      nodePath: process.execPath,
      // The folder the file being edited belongs to. The protocol's own
      // `workspaceFolders` is empty when a single file is opened without a
      // folder, and without this the packages sitting next to that file are
      // never indexed -- so `cfg_pkg::WIDTH` cannot resolve.
      workspaceFolder:
        vscode.window.activeTextEditor?.document.uri.scheme === "file"
          ? workspaceRootOf(vscode.window.activeTextEditor.document.uri)
          : undefined,
      settings: {
        diagnostics: {
          enable: config.get("diagnostics.enable", true),
          unknownIdentifiers: config.get("diagnostics.unknownIdentifiers", true),
          widthMismatch: config.get("diagnostics.widthMismatch", true),
          blockingInSequential: config.get("diagnostics.blockingInSequential", true),
          implicitSensitivity: config.get("diagnostics.implicitSensitivity", true),
          latchDetection: config.get("diagnostics.latchDetection", true),
        },
      },
    },
    outputChannel: output,
  };

  return new LanguageClient("svision", "SVision", transport, options);
}

/**
 * The workspace folder containing `uri`, or undefined when the file is loose.
 *
 * Falls back to the document's own directory when no folder is open, which is
 * the case that matters: a single `.sv` file opened on its own has packages
 * beside it, and they are what the file's parameters come from.
 */
function workspaceRootOf(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) return folder.uri.fsPath;
  return uri.scheme === "file" ? path.dirname(uri.fsPath) : undefined;
}

/**
 * Restarts the server, which is what picking up a rebuilt bundle requires.
 *
 * A manual restart is asked for; an automatic one follows a rebuild. The
 * reason is logged either way, because a server that dies on every keystroke
 * is much easier to diagnose with the reason in view.
 */
async function restartServer(reason: "manual" | "rebuild"): Promise<void> {
  if (!client || stopping) return;

  outputChannel?.appendLine(`[svision] restarting language server (${reason})`);
  try {
    await client.stop();
    await client.start();
    outputChannel?.appendLine("[svision] language server restarted");
  } catch (error) {
    outputChannel?.appendLine(`[svision] restart failed: ${String(error)}`);
  }
}

/**
 * Watches the server bundle and restarts the client when it is rewritten.
 *
 * The server is a separate process, so it has to be restarted to pick up a
 * new build. Debounced because a build writes the file more than once.
 */
function watchServerBundle(context: vscode.ExtensionContext): void {
  if (!serverModule) return;

  const folder = path.dirname(serverModule);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "*.js"));

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void restartServer("rebuild");
    }, RELOAD_DEBOUNCE_MS);
  };

  context.subscriptions.push(
    watcher,
    watcher.onDidChange(schedule),
    watcher.onDidCreate(schedule),
  );
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/** Reports the resolved type and width of the symbol under the cursor. */
async function showResolvedWidth(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isHdl(editor.document.languageId)) return;

  const line = editor.document.lineAt(editor.selection.active.line).text;
  const word = wordUnderCursor(editor, editor.selection);
  if (!word) {
    await vscode.window.showInformationMessage("svision: no symbol under the cursor.");
    return;
  }

  // The server folds parameters, so ask it rather than guessing from text.
  const response = await client?.sendRequest<{ detail: string } | null>("svision/resolvedWidth", {
    uri: editor.document.uri.toString(),
    word,
  });

  const detail = response?.detail ?? `\`${word}\` on line ${editor.selection.active.line + 1}`;
  outputChannel?.appendLine(`[svision] ${word} (line ${line.trim().slice(0, 60)}…)\n${detail}`);

  await vscode.window.showInformationMessage(detail, { modal: false });
}

/** Lists every symbol of the active file in the output channel. */
async function showSymbolReport(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isHdl(editor.document.languageId)) return;

  const report = await client?.sendRequest<string | null>("svision/symbolReport", {
    uri: editor.document.uri.toString(),
  });

  outputChannel?.clear();
  outputChannel?.appendLine(report ?? "svision: no symbols.");
  outputChannel?.show(true);
}

/** True for the two languages this extension serves. */
function isHdl(languageId: string): boolean {
  return languageId === "systemverilog" || languageId === "verilog";
}

/**
 * The identifier the cursor is on, or the one that was selected.
 *
 * Reading only the selection was the bug: clicking a signal places an empty
 * caret inside the word, `getText` returns "", and nothing was traced, leaving
 * whatever the previous signal had produced on screen.
 */
function wordUnderCursor(
  editor: vscode.TextEditor,
  selection: vscode.Selection | undefined,
): string | undefined {
  const word = selection && !selection.isEmpty
    ? editor.document.getText(selection).trim()
    : selection
      ? wordAt(editor.document, selection.active)
      : undefined;

  if (!word || word.length > 64) return undefined;
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(word) ? word : undefined;
}

/** The identifier spanning `position`, scanning outwards over word characters. */
function wordAt(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const line = document.lineAt(position.line).text;
  const isWord = (char: string | undefined): boolean =>
    char !== undefined && /[A-Za-z0-9_$]/.test(char);

  let start = position.character;
  let end = position.character;

  // A caret sitting just after a word should still find it.
  if (!isWord(line[start]) && isWord(line[start - 1])) {
    start -= 1;
    end -= 1;
  }

  while (start > 0 && isWord(line[start - 1])) start--;
  while (end < line.length && isWord(line[end])) end++;

  const word = line.slice(start, end);
  return /^[A-Za-z_]/.test(word) ? word : undefined;
}

