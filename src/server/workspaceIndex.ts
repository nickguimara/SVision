import { promises as fs } from "node:fs";
import path from "node:path";

import type { Node } from "web-tree-sitter";

import { analyzeTree, classNamesIn } from "./analyzer.js";
import { collectMacros, type MacroTable } from "./macros.js";
import { Catalog } from "./catalog.js";
import { IncludeResolver, type IncludeDirective } from "./includes.js";
import { pathToUri, toPosix, uriToPath } from "./paths.js";
import type { VerilogParser } from "./verilogParser.js";

export interface IndexOptions {
  include: string[];
  exclude: string[];
  /** Safety valve so a huge repo cannot stall the server on startup. */
  maxFiles: number;
}

/** How many undefined macro names are remembered before giving up on the list. */
const MAX_REPORTED_MACROS = 200;

/**
 * How many passes of header reading one include chain may take.
 *
 * Headers include headers, so a pass that reads one leaves more to read. A real
 * chain is a handful deep; the bound is what stops a pair of headers that
 * include each other from looping.
 */
const MAX_INCLUDE_ROUNDS = 8;

export const DEFAULT_INDEX_OPTIONS: IndexOptions = {
  // Must cover every extension the package declares as SystemVerilog or Verilog.
  // `.svp` holds package definitions, and leaving it out meant a package in a
  // `.svp` file was opened, highlighted and watched by the editor while its
  // parameters stayed invisible to every lookup that crosses a file boundary.
  include: ["**/*.sv", "**/*.svh", "**/*.svp", "**/*.v", "**/*.vh"],
  exclude: ["**/node_modules/**", "**/.git/**", "**/build/**", "**/out/**"],
  maxFiles: 5000,
};

/** Converts a glob with `*`, `**` and `?` into an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          pattern += "(?:.*/)?";
          i += 2;
        } else {
          pattern += ".*";
          i += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if ("\\^$.|+()[]{}".includes(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  return new RegExp(`^${pattern}$`);
}

/** One file read by the walk, held until the whole workspace is known. */
interface PendingFile {
  readonly absolute: string;
  readonly uri: string;
  readonly text: string;
}

/**
 * Builds the cross-file design-unit catalog.
 *
 * Runs once at startup and is refreshed when a workspace folder is added. Open
 * documents are always indexed separately as they change, so a stale disk index
 * never blocks navigation in the file the user is editing.
 */
export class WorkspaceIndexer {
  private readonly includeRes: RegExp[];
  private readonly excludeRes: RegExp[];
  private indexed = 0;
  private truncated = false;
  /**
   * Class names across the whole workspace.
   *
   * Analysis needs them to recognise `Packet pkt;` as an object rather than a
   * one-bit net, and the file declaring `Packet` may be read *after* the file
   * that uses it. So the walk reads first and parses second.
   */
  private readonly classNames = new Set<string>();

  /** Every macro defined in the workspace, so any file can expand any of them. */
  private readonly macroTable: MacroTable = new Map();

  /** Headers an `include` named and the walk has not read yet. */
  private readonly pendingIncludes = new Set<string>();
  /** Files this indexer has actually parsed, so none is read twice. */
  private readonly indexedPaths = new Set<string>();

  /**
   * Macro calls the workspace never defines, and where they were seen.
   *
   * `include` is not followed, so a macro that lives in a file the editor
   * cannot reach -- a vendor library, a file list outside the workspace -- is
   * invisible, and every signal it declares reads as undeclared. That looks
   * like a tool bug from inside the editor, so the names are recorded and
   * logged rather than left to be guessed at.
   */
  private readonly unresolvedMacros = new Map<string, Set<string>>();

  /** Macro calls with no definition, as `name -> files that call it`. */
  get undefinedMacros(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.unresolvedMacros;
  }

  constructor(
    private readonly parser: VerilogParser,
    readonly catalog: Catalog,
    private readonly options: IndexOptions = DEFAULT_INDEX_OPTIONS,
    /**
     * Shared across indexer instances on purpose.
     *
     * The server builds a second indexer when settings arrive with the
     * handshake, and a fresh resolver would start knowing nothing -- the
     * includes resolved during startup would be forgotten, and the second pass
     * would have to learn the same answers again.
     */
    readonly includes: IncludeResolver = new IncludeResolver(),
  ) {
    this.includeRes = options.include.map(globToRegExp);
    this.excludeRes = options.exclude.map(globToRegExp);
  }

  get filesIndexed(): number {
    return this.indexed;
  }

  get wasTruncated(): boolean {
    return this.truncated;
  }

  /**
   * Reads `folders` into the index, adding to whatever is already there.
   *
   * Additive on purpose. The workspace root is indexed once at startup, and
   * then a folder is indexed again as soon as a file in it is opened -- and
   * opening `rtl/pattern_generator.v` must not erase what `common/tmr.v`
   * contributed. Clearing here threw away every macro and class name learned
   * from the rest of the project, and the file that had just been read lost
   * all thirty-five of its macro-declared signals.
   *
   * A fresh pass over everything is not needed when settings change: the
   * server builds a new indexer for that, which starts empty on its own.
   */
  async indexFolders(folders: string[]): Promise<number> {
    let count = 0;

    for (const folder of folders) {
      this.includes.noteRoot(folder);

      // Read every file, learn every class name and every macro, then parse.
      // Doing it the other way round makes the answer depend on directory
      // order, which is exactly the kind of bug that only shows up on someone
      // else's machine.
      const files = await this.collect(folder);
      for (const file of files) {
        for (const name of classNamesIn(file.text)) this.classNames.add(name);
        this.readMacros(file);
      }

      for (const file of files) {
        this.parse(file);
        count++;
        // Hand the event loop back between files.
        //
        // Parsing is synchronous and CPU-bound, so a few hundred files would
        // otherwise be one long block in which the server answers nothing: no
        // hover, no completion, and the editor's own requests queue up behind
        // the index. Yielding costs a few microseconds per file and turns a
        // visible stall into a background task.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    // Headers reached only through an `include` are part of the workspace, and
    // whatever they declare is exactly what the files including them are
    // missing. Reading them here is what closes that gap before the open
    // documents are re-analysed.
    count += await this.indexReachedIncludes();

    return count;
  }

  /**
   * Reads the files an `include` named and the folder walk never visited.
   *
   * A header does not have to be under an indexed folder to be part of the
   * design: a package sits wherever the project keeps its packages, and the
   * include that names it is often the only thing that says where. Following it
   * is the difference between `` cfg_pkg::WIDTH `` resolving and the file
   * declaring an undeclared module, and nothing else in the index would find it.
   *
   * Only files reachable from a resolved include are read, so this cannot walk
   * the filesystem -- the paths come from source, and every one of them is
   * checked against the exclude patterns first.
   */
  async indexReachedIncludes(): Promise<number> {
    let total = 0;

    // Headers include headers, and the one that declares the type is often the
    // furthest away -- so a pass that read a header leaves more to read. The
    // rounds are bounded by the depth of any real chain, not by the file count.
    for (let round = 0; round < MAX_INCLUDE_ROUNDS; round++) {
      const wanted: string[] = [];
      for (const file of this.pendingIncludes) {
        if (this.indexedPaths.has(file)) continue;
        wanted.push(file);
      }
      this.pendingIncludes.clear();
      if (wanted.length === 0) break;

      total += await this.readIncluded(wanted);
    }

    return total;
  }

  /**
   * Reads and analyses a set of headers, learning from all of them first.
   *
   * The same two-pass order the folder walk uses: a macro defined in one header
   * is used by another, and the answer must not depend on which was reached
   * first.
   */
  private async readIncluded(absolutePaths: readonly string[]): Promise<number> {
    const read: PendingFile[] = [];
    for (const absolute of absolutePaths) {
      const text = await this.read(absolute);
      if (text !== undefined) read.push({ absolute, uri: pathToUri(absolute), text });
    }

    for (const file of read) {
      this.includes.noteFile(file.absolute);
      for (const name of classNamesIn(file.text)) this.classNames.add(name);
      this.readMacros(file);
    }

    for (const file of read) {
      this.parse(file);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    return read.length;
  }

  /**
   * Resolves the includes of an open document and queues the files they name.
   *
   * The directives come from the document's own analysis, so this costs a map
   * lookup per directive rather than another pass over the tree. With no
   * workspace folder open the walk never sees a folder but the loose file's,
   * and the package it pulls in is the one thing the author is looking at.
   */
  followIncludes(uri: string, directives: readonly IncludeDirective[]): void {
    const absolute = uriToPath(uri);
    if (!absolute) return;

    for (const edge of this.includes.noteIncludes(absolute, directives)) {
      if (!this.indexedPaths.has(edge.absolute)) this.pendingIncludes.add(edge.absolute);
    }
  }

  /** Forgets a closed document's edges, so a stale header is not chased. */
  forgetDocument(uri: string): void {
    const absolute = uriToPath(uri);
    if (absolute) this.includes.forget(absolute);
  }

  /**
   * Learns the macros a file defines, before any file is analysed.
   *
   * Collected up front rather than during the parse so that a file sees every
   * macro in the folder no matter which of them the directory walk reached
   * first. Only files that mention a backtick are parsed here, so the extra
   * parse falls on headers -- the one place a `` `define `` lives.
   */
  private readMacros(file: PendingFile): void {
    if (!file.text.includes("`")) return;

    let tree: ReturnType<VerilogParser["parse"]> | undefined;
    try {
      tree = this.parser.parse(file.text);
      for (const macro of collectMacros(tree, file.text)) this.macroTable.set(macro.name, macro);
    } catch {
      // A malformed file must not abort the whole index.
    } finally {
      tree?.delete();
    }
  }

  private async collect(root: string, directory = root, into: PendingFile[] = []): Promise<PendingFile[]> {
    if (into.length >= this.options.maxFiles) {
      this.truncated = true;
      return into;
    }

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return into; // unreadable directory: skip silently
    }

    for (const entry of entries) {
      if (into.length >= this.options.maxFiles) {
        this.truncated = true;
        return into;
      }

      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // Cheap pre-filter before recursing.
        const relDir = toPosix(path.relative(root, absolute)) + "/";
        if (this.excludeRes.some((re) => matchesGlobDir(re, relDir))) continue;
        await this.collect(root, absolute, into);
        continue;
      }

      if (!entry.isFile()) continue;

      const relative = toPosix(path.relative(root, absolute));
      if (!this.includeRes.some((re) => re.test(relative))) continue;
      if (this.excludeRes.some((re) => re.test(relative))) continue;

      // Noted before the file is read: a name in this folder is resolvable even
      // if the file itself turns out to be unreadable, and the next document
      // that includes something from here deserves the same search.
      this.includes.noteFile(absolute);

      const text = await this.read(absolute);
      if (text !== undefined) into.push({ absolute, uri: pathToUri(absolute), text });
    }

    return into;
  }

  private async read(absolute: string): Promise<string | undefined> {
    try {
      const stat = await fs.stat(absolute);
      // Skip anything a human could not plausibly want parsed.
      if (stat.size > 4 * 1024 * 1024) return undefined;
      return await fs.readFile(absolute, "utf8");
    } catch {
      return undefined;
    }
  }

  private parse(file: PendingFile): void {
    let tree: ReturnType<VerilogParser["parse"]> | undefined;
    try {
      tree = this.parser.parse(file.text);

      // `readMacros` already collected every macro in the folder before this
      // loop started, so by now the table is complete: a `NAME(args)
      // declaration here can stand for something a header defines, whichever
      // order the directory walk produced.
      this.noteUndefinedMacros(tree, file);

      const analysis = analyzeTree(tree, file.text, this.classNames, undefined, this.macros);

      // What this file pulls in, read from the same traversal. The headers are
      // queued whether or not the walk will reach them: one inside the folder
      // being read is dropped again below, one outside it is read after.
      this.includes.noteIncludes(file.absolute, analysis.includes);
      for (const edge of this.includes.includesOf(file.absolute)) {
        if (!this.indexedPaths.has(edge)) this.pendingIncludes.add(edge);
      }

      this.catalog.replaceDocument(
        file.uri,
        analysis.scopes,
        analysis.accesses,
        analysis.unitSymbols,
      );
      this.indexed++;
      this.indexedPaths.add(toPosix(file.absolute));
    } catch {
      // A malformed file must not abort the whole index.
    } finally {
      tree?.delete();
    }
  }

  /**
   * Records macro calls that no file in the workspace defines.
   *
   * The name is not a compiler directive, and it is not in the table, so nothing
   * in the workspace can say what it expands to. Saying so out loud is the
   * difference between "the tool is broken" and "that macro is in a header the
   * editor cannot reach".
   */
  private noteUndefinedMacros(tree: ReturnType<VerilogParser["parse"]>, file: PendingFile): void {
    if (this.unresolvedMacros.size >= MAX_REPORTED_MACROS) return;

    const stack: Node[] = [tree.rootNode as Node];
    while (stack.length > 0) {
      const node = stack.pop()!;

      if (node.type === "text_macro_usage") {
        const name = node.namedChild(0)?.text ?? "";
        // A directive (`ifdef, `include) is not a macro call, so it never
        // reaches here; anything named is a call that nothing can expand.
        if (name.length > 0 && !this.macroTable.has(name) && !this.unresolvedMacros.has(name)) {
          this.unresolvedMacros.set(name, new Set([file.absolute]));
        }
        continue;
      }

      if (node.type === "text_macro_definition") continue;

      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i);
        if (child) stack.push(child as Node);
      }
    }
  }

  /**
   * Every macro defined anywhere in the workspace.
   *
   * A macro's definition is rarely in the file that uses it -- usually it is in
   * a header pulled in by a file list the editor cannot see -- so the index is
   * the only place the whole set exists. Kept beside the catalog for the same
   * reason: both are workspace-wide answers that one file cannot give.
   */
  get macros(): MacroTable {
    return this.macroTable;
  }
}

/** A trailing-slash directory should also match exclude patterns written bare. */
function matchesGlobDir(re: RegExp, relativeDir: string): boolean {
  if (re.test(relativeDir)) return true;
  const trimmed = relativeDir.replace(/\/$/, "");
  return re.test(trimmed) || re.test(`${trimmed}/`);
}

export { pathToUri, toPosix } from "./paths.js";