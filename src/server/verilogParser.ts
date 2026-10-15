import * as path from "node:path";

import { Language, Parser, type Node, type Tree } from "web-tree-sitter";

/**
 * Owns the single tree-sitter runtime and the SystemVerilog grammar, and hands
 * out parsers. Tree-sitter parsers are cheap to clone but share the loaded
 * language, so we initialise once per process.
 */
export class VerilogParser {
  private static language: Language | undefined;
  private static initPromise: Promise<Language> | undefined;

  private readonly language: Language;
  private readonly parser: Parser;

  private constructor(language: Language) {
    this.language = language;
    this.parser = new Parser();
    this.parser.setLanguage(language);
  }

  static async create(): Promise<VerilogParser> {
    const language = await VerilogParser.loadLanguage();
    return new VerilogParser(language);
  }

  private static loadLanguage(): Promise<Language> {
    if (VerilogParser.language) {
      return Promise.resolve(VerilogParser.language);
    }
    if (!VerilogParser.initPromise) {
      VerilogParser.initPromise = (async () => {
        // web-tree-sitter ships its own core runtime alongside the grammar; both
        // must be addressable on disk, so resolve them through require.
        await Parser.init({
          locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
        });
        const wasm = require.resolve("tree-sitter-systemverilog/tree-sitter-systemverilog.wasm");
        const language = await Language.load(wasm);
        VerilogParser.language = language;
        return language;
      })();
    }
    return VerilogParser.initPromise;
  }

  /**
   * Parses `text`, reusing the previous parse for incremental updates when the
   * caller supplies the corresponding old tree.
   */
  parse(text: string, oldTree?: Tree): Tree {
    const tree = this.parser.parse(text, oldTree);
    if (tree) return tree;
    // Should not happen: SystemVerilog accepts any input, including garbage.
    const fallback = this.parser.parse(text);
    if (!fallback) throw new Error("tree-sitter failed to produce a tree");
    return fallback;
  }

  getLanguage(): Language {
    return this.language;
  }

  /** The node covering `offset`, preferring the innermost named node. */
  nodeAt(tree: Tree, offset: number): Node | null {
    const root = tree.rootNode;
    if (offset < 0 || offset > root.endIndex) return null;
    const raw = root.namedDescendantForIndex(offset);
    if (!raw) return null;
    // `namedDescendantForIndex` can land on a node that merely touches the offset.
    return raw.startIndex <= offset && offset < raw.endIndex ? raw : (raw.parent ?? raw);
  }

  dispose(): void {
    try {
      this.parser.delete();
    } catch {
      /* parser already torn down */
    }
  }
}

/** Absolute path of the extension root, used for diagnostics in the status bar. */
export function extensionRoot(): string {
  return path.resolve(__dirname, "..");
}