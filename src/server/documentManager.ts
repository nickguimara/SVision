import { TextDocument } from "vscode-languageserver-textdocument";
import type { Position } from "vscode-languageserver-types";
import { Edit, type Point, type Tree } from "web-tree-sitter";

import { analyzeTree } from "./analyzer.js";
import type { MacroTable } from "./macros.js";
import type { Analysis } from "./model.js";
import type { VerilogParser } from "./verilogParser.js";

interface DocumentEntry {
  document: TextDocument;
  tree: Tree;
  analysis: Analysis;
  version: number;
}

/**
 * Tells tree-sitter how `newText` differs from `oldText`.
 *
 * The client sends the whole document on every change, so the difference may
 * span several disjoint edits. Wrapping them in one enclosing range is always
 * valid and only costs tree-sitter a little extra re-parsing.
 */
function applyEdit(
  tree: Tree,
  oldText: string,
  newText: string,
  oldDocument: TextDocument,
  newDocument: TextDocument,
): void {
  const limit = Math.min(oldText.length, newText.length);

  let start = 0;
  while (start < limit && oldText[start] === newText[start]) start++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  tree.edit(
    new Edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition: toPoint(oldDocument.positionAt(start)),
      oldEndPosition: toPoint(oldDocument.positionAt(oldEnd)),
      newEndPosition: toPoint(newDocument.positionAt(newEnd)),
    }),
  );
}

/** LSP positions are `{line, character}`; tree-sitter points are `{row, column}`. */
function toPoint(position: Position): Point {
  return { row: position.line, column: position.character };
}

/**
 * Owns every open SystemVerilog document together with its parse tree and
 * semantic analysis. Re-parses incrementally so typing stays cheap.
 */
export class DocumentManager {
  private readonly entries = new Map<string, DocumentEntry>();

  /**
   * Where to ask for class names declared elsewhere in the workspace.
   *
   * Analysis needs them to tell `Packet pkt;` from a one-bit net, and the
   * answer is usually in a different file. Supplied by the server so this
   * class does not have to know the catalog exists.
   */
  knownClasses: () => ReadonlySet<string> = () => new Set();

  /**
   * Where to ask for the folded value of a package's parameters.
   *
   * A width written in terms of a package parameter cannot be resolved inside
   * the file that uses it, so the numbers come from the catalog.
   */
  importedParameterValues:
    | ((packageName: string) => ReadonlyMap<string, number> | undefined)
    | undefined;

  /**
   * Where to ask for the macros defined anywhere in the workspace.
   *
   * A `` `NAME(args) `` declaration lives in the file that defines the macro and
   * stands for a declaration in the file that uses it, so neither file is
   * enough on its own.
   */
  macros: () => MacroTable = () => new Map();

  constructor(private readonly parser: VerilogParser) {}

  update(uri: string, document: TextDocument): DocumentEntry {
    const existing = this.entries.get(uri);
    const version = document.version;

    if (existing && existing.version === version) {
      existing.document = document;
      return existing;
    }

    const text = document.getText();
    let tree: Tree;

    if (existing) {
      // Reusing a tree is only sound after telling tree-sitter what changed.
      // Without `edit`, it assumes the old tree still describes the input and
      // reuses subtrees at stale offsets, yielding shifted, corrupted nodes.
      applyEdit(existing.tree, existing.document.getText(), text, existing.document, document);
      tree = this.parser.parse(text, existing.tree);
      existing.tree.delete();
    } else {
      tree = this.parser.parse(text);
    }

    const analysis = this.analyze(tree, text);

    const entry: DocumentEntry = { document, tree, analysis, version };
    this.entries.set(uri, entry);
    return entry;
  }

  /**
   * Analyses a parsed document, running a second pass when the first one
   * revealed classes the caller did not know about.
   *
   * A file that declares `Packet` and also writes `Packet pkt;` cannot decide
   * which is which on the first pass. One extra pass settles it, and only when
   * the file actually declares something new.
   */
  private analyze(tree: Tree, text: string): Analysis {
    const known = this.knownClasses();
    const values = this.importedParameterValues;
    const macros = this.macros();
    const parse = (fragment: string): Tree => this.parser.parse(fragment);

    const first = analyzeTree(tree, text, known, values, macros, parse);

    const declaredHere = [...new Set(first.scopes.filter((s) => s.category === "class").map((s) => s.name))].filter(
      (name) => !known.has(name),
    );
    if (declaredHere.length === 0) return first;

    return analyzeTree(tree, text, new Set([...known, ...declaredHere]), values, macros, parse);
  }

  /**
 * Re-analyses a document from scratch, ignoring its version.
 *
 * A version check exists to keep a keystroke cheap, which is the right trade
 * while nothing outside the file can change the answer. It is the wrong trade
 * once the workspace index lands: `output logic [C_PKT_DAT_W-1:0]` keeps the
 * same text and gets a different width the moment the package is indexed, and
 * no edit will ever arrive to trigger the update.
 */
reanalyze(uri: string): DocumentEntry | undefined {
    const existing = this.entries.get(uri);
    if (!existing) return undefined;

    const text = existing.document.getText();
    const tree = this.parser.parse(text);
    existing.tree.delete();

    existing.tree = tree;
    existing.analysis = this.analyze(tree, text);
    return existing;
  }

  get(uri: string): DocumentEntry | undefined {
    return this.entries.get(uri);
  }

  close(uri: string): void {
    const entry = this.entries.get(uri);
    if (!entry) return;
    entry.tree.delete();
    this.entries.delete(uri);
  }

  all(): DocumentEntry[] {
    return [...this.entries.values()];
  }
}