import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

import type { NavGroup, NavigatorResult } from "../server/navigator.js";
import { parseUri } from "./toolViews.js";

/**
 * The navigator view: every declaration of the active file, grouped by kind and
 * annotated with its resolved size.
 *
 * Local to one file by design. Clicking a row jumps to the declaration.
 */

/** A tree row: a group of declarations, or one declaration under it. */
type NavNode =
  | { kind: "group"; label: string; group: string; count: number; icon: string; entries: NavEntry[] }
  | { kind: "signal"; label: string; description: string; icon: string; tone: string; entry: NavEntry };

interface NavEntry {
  name: string;
  typeText: string;
  width?: number;
  elements?: number;
  sizeText: string;
  uri: string;
  line: number;
  character: number;
  typeName?: string;
}

/** Icon and colour per group, so the eye can find a kind without reading. */
const GROUP_STYLE: Record<NavGroup, { icon: string; color: string }> = {
  input: { icon: "arrow-down", color: "charts.blue" },
  output: { icon: "arrow-up", color: "charts.orange" },
  wire: { icon: "symbol-variable", color: "charts.green" },
  register: { icon: "symbol-event", color: "charts.purple" },
  parameter: { icon: "symbol-constant", color: "charts.yellow" },
  type: { icon: "symbol-structure", color: "charts.teal" },
  instance: { icon: "type-hierarchy", color: "charts.pink" },
};

export class NavigatorView implements vscode.TreeDataProvider<NavNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<NavNode | undefined>();

  readonly onDidChangeTreeData = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];

  private result: NavigatorResult | null = null;

  private scopeUri: string | undefined;

  constructor(private readonly client: LanguageClient) {
    this.disposables.push(
      // The list belongs to the file being edited, so it follows the tab and
      // rebuilds as the file changes.
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.scopeUri) void this.refresh();
      }),
    );

    this.disposables.push(
      vscode.window.createTreeView("svision.navigator", { treeDataProvider: this }),
    );

    void this.refresh();
  }

  /** The file the navigator is listing, or undefined when none is active. */
  private get scope(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const { languageId, uri } = editor.document;
    return languageId === "systemverilog" || languageId === "verilog" ? uri.toString() : undefined;
  }

  /** File name shown in the view description, so the scope is never a guess. */
  get scopeLabel(): string {
    if (!this.scopeUri) return "";
    const parts = this.scopeUri.replace(/^[a-z]+:\/\//, "").split("/");
    return parts[parts.length - 1] ?? "";
  }

  async refresh(): Promise<void> {
    const uri = this.scope;
    this.scopeUri = uri;

    if (!uri) {
      this.result = null;
    } else {
      this.result = await this.client.sendRequest<NavigatorResult | null>("svision/navigator", { uri });
    }

    void vscode.commands.executeCommand("setContext", "svision.navigator.active", Boolean(uri));
    this.emitter.fire(undefined);
  }

  getTreeItem(node: NavNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.description = String(node.count);
      item.contextValue = "svision.navgroup";
      item.tooltip = new vscode.MarkdownString(`${node.count} in ${this.scopeLabel}`);
      return item;
    }

    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(node.icon, new vscode.ThemeColor(node.tone));
    item.description = node.description;
    item.contextValue = "svision.navsignal";
    item.tooltip = new vscode.MarkdownString(node.entry.typeText || node.entry.typeName || node.label);

    const { uri, line, character } = node.entry;
    const target = parseUri(uri);
    if (target) {
      item.command = {
        command: "svision.revealLocation",
        title: "Open",
        arguments: [uri, line, character],
      };
    }

    return item;
  }

  getChildren(node?: NavNode): NavNode[] {
    if (!node) {
      return (this.result?.groups ?? []).map((group) => ({
        kind: "group" as const,
        label: group.label,
        group: group.group,
        count: group.signals.length,
        icon: GROUP_STYLE[group.group]?.icon ?? "symbol-miscellaneous",
        entries: group.signals.map((signal) => ({
          ...signal,
          uri: this.scopeUri ?? "",
          line: signal.range.start.line,
          character: signal.range.start.character,
        })),
      }));
    }

    if (node.kind !== "group") return [];

    const style = GROUP_STYLE[node.group as NavGroup] ?? {
      icon: "symbol-miscellaneous",
      color: "foreground",
    };

    return node.entries.map((entry) => ({
      kind: "signal" as const,
      label: entry.name,
      // Size first: it is what the row is for. The declared type follows.
      description: [entry.sizeText, entry.typeText].filter(Boolean).join("  ·  "),
      icon: style.icon,
      tone: style.color,
      entry,
    }));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}