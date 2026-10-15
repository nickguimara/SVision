import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import type { TraceHop } from "../server/trace.js";
import { emptyTrace, traceTree, unknownSignal, type TraceNode } from "./toolsHtml.js";
import { isUsableUri } from "./uris.js";

/**
 * The two sidebar tools: an RTL viewer outline and a signal tracer.
 *
 * Both share one piece of state -- the module and path currently being viewed
 * and the signal currently being traced -- because clicking a net in the viewer
 * is one of the ways to pick a signal to trace.
 */

/** What the two views are currently showing. */
interface ToolState {
  /** Module drawn by the RTL viewer. */
  module?: string;
  /** Chain of module names from the top of the design down to `module`. */
  path: string[];
  /** Signal handed to the tracer. */
  signal?: string;
  /** File the signal was picked from, so the tracer can open it. */
  uri?: string;
  /** File `module` was resolved from; `module` only applies to that file. */
  moduleUri?: string;
}

export class ToolViews implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  private traceNodes: readonly TraceNode[] = [];

  constructor(
    private readonly client: LanguageClient,
    traceView: vscode.TreeView<TraceNode>,
    private readonly traceProvider: ViewProvider<TraceNode>,
  ) {
    this.disposables.push(traceView);
  }

  /** Notifies the view that its content changed. */
  refresh(): void {
    this.traceProvider.fire();
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  /* ---------------------------------------------------------------- *
   * RTL viewer
   * ---------------------------------------------------------------- */

  /**
   * Records which module a trace should start from.
   *
   * The RTL viewer view is hidden for now -- it did not earn its place -- but
   * the tracer still needs to know the module of the file being edited, so a
   * signal picked in the text resolves against the right scope.
   */
  async showLevel(module: string, _trail: readonly string[] = [], uri?: string): Promise<void> {
    this.state.module = module;
    this.state.moduleUri = uri ?? this.state.uri;
    if (uri) this.state.uri = uri;
  }

  /* ---------------------------------------------------------------- *
   * Signal tracer
   * ---------------------------------------------------------------- */

  getTraceChildren = (element?: TraceNode): TraceNode[] =>
    element ? element.children ?? [] : [...this.traceNodes];

  getTraceTreeItem = (node: TraceNode, isRoot = false): vscode.TreeItem => {
    const hasChildren = (node.children?.length ?? 0) > 0;

    // Drivers and loads start open, because the shape of a trace should be
    // readable without clicking. Everything from another file starts closed: it
    // is context, not the answer, and it is often several modules deep.
    const collapsible = !hasChildren
      ? vscode.TreeItemCollapsibleState.None
      : node.kind === "elsewhere"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : node.kind === "hop"
          ? isRoot
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded;

    const item = new vscode.TreeItem(node.label, collapsible);
    item.iconPath = node.color
      ? new vscode.ThemeIcon(node.icon, new vscode.ThemeColor(node.color))
      : new vscode.ThemeIcon(node.icon);
    item.description = node.description;
    item.contextValue = `svision.${node.kind}`;

    if (node.tooltip) {
      item.tooltip = new vscode.MarkdownString(node.tooltip);
    }

    if (node.target && parseUri(node.target.uri)) {
      const { uri, line, character } = node.target;
      item.command = {
        command: "svision.revealLocation",
        title: "Open",
        arguments: [uri, line, character],
      };
    }

    return item;
  };

  /** Follows `signal` from `uri`, across module boundaries. */
  async trace(signal: string, uri?: string): Promise<void> {
    const file = uri ?? this.state.uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    this.state.signal = signal;
    this.state.uri = file;

    if (!signal || !file) {
      this.traceNodes = emptyTrace();
      this.refresh();
      return;
    }

    const module = await this.moduleAt(file, signal);
    if (!module) {
      // The document is not open, or holds no module declaring this signal.
      // Say so rather than showing a blank tree, which reads as a broken tool.
      this.traceNodes = unknownSignal(signal);
      this.refresh();
      return;
    }

    const hop = await this.client.sendRequest<TraceHop | null>("svision/signalTrace", {
      module,
      signal,
      uri: file,
    });

    this.traceNodes = hop ? traceTree(hop) : emptyTrace();
    this.refresh();
  }

  /** The module a trace starts from: the one already known, else the file's. */
  private async moduleAt(uri: string, signal: string): Promise<string> {
    if (this.state.module && this.state.moduleUri === uri) return this.state.module;

    const module = await this.client.sendRequest<string | null>("svision/moduleAt", { uri, signal });
    return module ?? "";
  }

  /* ---------------------------------------------------------------- *
   * Shared state and selection
   * ---------------------------------------------------------------- */

  private state: ToolState = { path: [] };

  /** File the sidebar is currently working in. */
  get uri(): string | undefined {
    return this.state.uri;
  }

  /**
   * Shows the module of the active HDL editor, unless it is already showing it.
   *
   * Switching files should change the viewer, but re-selecting the same file --
   * or focusing the same module from a signal trace -- must not reset the
   * level the user navigated down to.
   */
  async adoptActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isHdl(editor.document.languageId)) return;

    const uri = editor.document.uri.toString();
    if (this.state.uri === uri && this.state.module) return;

    this.state.uri = uri;
    const module = await this.client.sendRequest<string | null>("svision/moduleAt", { uri });
    if (!module) return;

    await this.showLevel(module, [module], uri);
  }


  /** Module the viewer is currently showing, if any. */
  get currentModule(): string | undefined {
    return this.state.module;
  }

  /** The row the tree is rooted at, used to decide how it renders. */
  get traceRoot(): TraceNode | undefined {
    return this.traceNodes[0];
  }

}

/**
 * A tree data provider that reads from a ToolViews instance.
 *
 * The instance is created after the views, because the views need it; this
 * indirection is what breaks the cycle.
 */
class ViewProvider<T> implements vscode.TreeDataProvider<T>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<T | undefined>();

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly get: () => ToolViews,
    private readonly itemFor: (views: ToolViews, node: T) => vscode.TreeItem,
    private readonly childrenOf: (views: ToolViews, element?: T) => T[],
  ) {}

  getTreeItem(node: T): vscode.TreeItem {
    return this.itemFor(this.get(), node);
  }

  getChildren(element?: T): T[] {
    return this.childrenOf(this.get(), element);
  }

  fire(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** Registers both views and the commands that drive them. */
export function registerToolViews(
  client: LanguageClient,
  context: vscode.ExtensionContext,
): ToolViews {
  let views: ToolViews;

  const traceProvider = new ViewProvider<TraceNode>(
    () => views,
    (owner, node) => owner.getTraceTreeItem(node, node === owner.traceRoot),
    (owner, element) => owner.getTraceChildren(element),
  );

  // The RTL viewer view is contributed as hidden: the drawing exists and works,
  // but it did not earn its place next to the tracer, so it is not shown.
  const traceView = vscode.window.createTreeView("svision.signalTracer", { treeDataProvider: traceProvider });

  views = new ToolViews(client, traceView, traceProvider);

  context.subscriptions.push(traceProvider);

  context.subscriptions.push(
    views,
        vscode.commands.registerCommand("svision.traceSignal", async (signal: string) => {
      const editor = vscode.window.activeTextEditor;
      await views.trace(signal, editor?.document.uri.toString());
    }),
    vscode.commands.registerCommand("svision.traceSignalAtCursor", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const word = editor.document.getText(editor.selection).trim() ||
        editor.document.getText(editor.selection).match(/[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
      if (!word) return;
      await views.trace(word, editor.document.uri.toString());
    }),
  );

    // Populate the viewer for whatever HDL file is already open, so the sidebar
  // is never blank just because nobody pressed a button.
  void views.adoptActiveEditor();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void views.adoptActiveEditor()),
  );

  return views;
}

function isHdl(languageId: string): boolean {
  return languageId === "systemverilog" || languageId === "verilog";
}

/**
 * Parses a uri, returning undefined instead of throwing.
 *
 * A trace hop is allowed to have no file behind it -- it happens whenever the
 * trace was started from the viewer panel -- so the jump target is only built
 * when there is something valid to point at.
 */
/**
 * Exports `parseUri` so the navigator shares it: a row in either view must
 * refuse the same broken uris.
 */
export function parseUri(value: string): vscode.Uri | undefined {
  if (!isUsableUri(value)) return undefined;
  try {
    return vscode.Uri.parse(value);
  } catch {
    return undefined;
  }
}

