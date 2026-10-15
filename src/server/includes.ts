import { statSync } from "node:fs";
import path from "node:path";

import type { Range } from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

import { folded, toPosix } from "./paths.js";

/**
 * Finding the file a `` `include `` names.
 *
 * The directive is a *string*, not a path the editor can follow: it says
 * `"pkg/cfg_pkg.svh"`, and nothing in the workspace says whether that is
 * relative to the file doing the including, relative to the project root, or a
 * name that only exists in a vendor library. A compiler is told with `+incdir+`
 * and a file list; the editor has neither, and guessing wrong is what leaves
 * `` cfg_pkg::WIDTH `` unresolvable while the package sits two folders over.
 *
 * So the resolver tries the spellings a compiler would have been given, in an
 * order that makes each one win only when it is right, and falls back to a
 * search over every file the workspace index has already seen. The fallback is
 * the point: "the header is somewhere in this project" is true far more often
 * than "the header is next to the file that includes it".
 */

/** One `` `include `` written in a file. */
export interface IncludeDirective {
  /** The name as written, without quotes or angle brackets. */
  readonly target: string;
  /**
   * True for `` `include <name> ``, false for `` `include "name" ``.
   *
   * The two are not the same question: a quoted include is resolved against the
   * directory of the file that writes it, while an angle-bracketed one is a
   * library include and is *never* relative to that directory. Trying the
   * including file's folder for a `<...>` include invents a file a compiler
   * would never read.
   */
  readonly systemLib: boolean;
  /** Whole directive, backtick included, for the diagnostic that names it. */
  readonly range: Range;
}

/** An include that resolved to a file. */
export interface ResolvedInclude {
  /** Absolute posix path of the included file. */
  readonly absolute: string;
  readonly directive: IncludeDirective;
}

/** How many parent folders are tried when resolving a relative include. */
const MAX_ASCENT = 4;

/**
 * The directive written on one node, or undefined when the node is not one.
 *
 * Read per node rather than by walking the tree separately: the analyser already
 * crosses every node once, and a second pass to find the handful of lines that
 * change rarely cost a quarter of the analysis on a 400-line module.
 */
export function readInclude(node: Node): IncludeDirective | undefined {
  if (node.type !== "include_compiler_directive") return undefined;

  const read = readTarget(node);
  if (!read) return undefined;

  return {
    target: read.target,
    systemLib: read.systemLib,
    range: {
      start: { line: node.startPosition.row, character: node.startPosition.column },
      end: { line: node.endPosition.row, character: node.endPosition.column },
    },
  };
}

/**
 * The name an `include_compiler_directive` carries.
 *
 * The grammar keeps the name in `quoted_string` for `"..."` and in
 * `system_lib_string` for `<...>`, each with its punctuation as separate
 * children, so the name is read from the directive's text.
 */
function readTarget(node: Node): { target: string; systemLib: boolean } | undefined {
  const text = node.text.replace(/^\s*`include\s*/, "").trim();

  const angle = /^<([^>]*)>/.exec(text);
  if (angle) return { target: (angle[1] ?? "").trim(), systemLib: true };

  const quoted = /^"([^"]*)"/.exec(text);
  if (quoted) return { target: (quoted[1] ?? "").trim(), systemLib: false };

  // A macro in the name -- `` `include `SOME_PATH `` -- names a path nobody can
  // know until the macro is expanded. Left unresolved rather than guessed at.
  return undefined;
}

/**
 * The workspace's answer to "where is this header".
 *
 * Everything it knows is accumulated as files are indexed, so a lookup that
 * misses early in the session starts succeeding once the walk has passed the
 * folder holding the header. That is why the server resolves an open document's
 * includes again after indexing instead of only when it is opened.
 */
export class IncludeResolver {
  /** Folders a search starts from: the workspace roots and their ancestors. */
  private readonly roots: string[] = [];
  /** Absolute posix paths of every file the index has read. */
  private readonly files = new Set<string>();
  /** Lowercased basename -> absolute paths, for a name-only lookup. */
  private readonly byBasename = new Map<string, string[]>();
  /** Absolute path -> the includes that file resolved to. */
  private readonly edges = new Map<string, ResolvedInclude[]>();
  /**
   * Resolved names, with the generation they were answered in.
   *
   * A miss has to be re-tried once the index has learned more files -- the
   * header may simply not have been read yet -- so an answer is only reused
   * while the set of known files is the one it was computed against.
   */
  private readonly answers = new Map<string, { generation: number; hit?: string }>();
  /** Incremented whenever a file or a root is learned. */
  private generation = 0;
  /** Include names nothing could be found for, and the files that ask. */
  private readonly unresolved = new Map<string, Set<string>>();

  /** Registers a folder a relative include is tried against. */
  noteRoot(directory: string): void {
    const absolute = toPosix(path.normalize(directory));
    if (this.roots.includes(absolute)) return;
    this.roots.push(absolute);
    this.generation++;
  }

  /**
   * Registers a file the index has read, so a later include can name it.
   *
   * This is what makes "the header is somewhere in this project" answerable: the
   * walk teaches the resolver about every file it passes, and an include typed
   * long afterwards can still be placed by path or by name.
   */
  noteFile(absolute: string): void {
    const file = toPosix(path.normalize(absolute));
    if (this.files.has(file)) return;

    this.files.add(file);

    const key = path.posix.basename(file).toLowerCase();
    const bucket = this.byBasename.get(key);
    if (bucket) bucket.push(file);
    else this.byBasename.set(key, [file]);

    this.generation++;
  }

  /**
   * Resolves every include written in one file and remembers the edges.
   *
   * `file` is the including file's absolute path, because that directory is
   * what a quoted name is resolved against. Returns what the file reaches, so
   * the caller can index whatever the workspace walk did not reach itself.
   */
  noteIncludes(file: string, directives: readonly IncludeDirective[]): ResolvedInclude[] {
    const source = toPosix(path.normalize(file));
    const from = path.posix.dirname(source);
    const out: ResolvedInclude[] = [];

    for (const directive of directives) {
      const hit = this.answer(directive, from);
      if (hit) {
        // Noted before the edge is stored: an included header is a file of the
        // project, and the next document that includes something relative to it
        // deserves the same search the walk would have given.
        this.noteFile(hit);
        // A name that could not be placed earlier may be placeable now that the
        // walk has read the folder holding it, and a stale complaint about a
        // header that is right there is worse than silence.
        this.unresolved.delete(directive.target);
        out.push({ absolute: hit, directive });
        continue;
      }

      const askers = this.unresolved.get(directive.target);
      if (askers) askers.add(source);
      else this.unresolved.set(directive.target, new Set([source]));
    }

    this.edges.set(source, out);
    return out;
  }

  /** Forgets a file's edges, so an edited include is looked up again. */
  forget(file: string): void {
    this.edges.delete(toPosix(path.normalize(file)));
  }

  /** Files named by `` `include `` in `file`, absolute paths. */
  includesOf(file: string): string[] {
    return (this.edges.get(toPosix(path.normalize(file))) ?? []).map((edge) => edge.absolute);
  }

  /**
   * Every file `file` reaches through includes, transitively.
   *
   * Headers include headers, and the one that declares the type is often the
   * furthest away. The `seen` set is what stops a pair of headers that include
   * each other -- not unheard of behind an `ifndef` guard -- from looping.
   */
  closure(file: string, limit = 64): string[] {
    const start = toPosix(path.normalize(file));
    const seen = new Set<string>([start]);
    const queue = [start];

    while (queue.length > 0 && seen.size <= limit) {
      const current = queue.shift()!;
      for (const edge of this.edges.get(current) ?? []) {
        if (seen.has(edge.absolute)) continue;
        seen.add(edge.absolute);
        queue.push(edge.absolute);
      }
    }

    seen.delete(start);
    return [...seen];
  }

  /**
   * Include names nothing could be found for, and the files that ask for them.
   *
   * Reported in the log because a missing header is invisible otherwise: every
   * macro it would have declared then reads as an unknown name, and the symptom
   * points at the extension rather than at the file list.
   */
  get missing(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.unresolved;
  }

  /**
   * The file an include names, or undefined.
   *
   * Reused only while the set of known files is the one the answer came from: a
   * miss has to be re-tried once the index has read more, because the header may
   * simply not have been reached yet.
   */
  private answer(directive: IncludeDirective, from: string): string | undefined {
    const target = directive.target.trim();
    const key = `${from}|${target}|${directive.systemLib ? "<" : '"'}`;
    const cached = this.answers.get(key);
    if (cached && cached.generation === this.generation) return cached.hit;

    const hit = this.search(target, from, directive.systemLib);
    this.answers.set(key, { generation: this.generation, hit });
    return hit;
  }

  /**
   * Where the file for `name` is, tried in the order a compiler would be told.
   *
   * Beside the file that wrote it, then up the folder tree, then at a workspace
   * root, then anywhere in the project by path suffix, and finally by bare file
   * name. Each step is reached only when the one before it found nothing, so a
   * name with an exact answer always gets it.
   */
  private search(name: string, from: string, systemLib: boolean): string | undefined {
    const trimmed = name.trim();
    if (trimmed.length === 0) return undefined;

    if (path.isAbsolute(trimmed)) return existing(trimmed);

    // A quoted include is relative to the file that writes it. An
    // angle-bracketed one is a library include and the including file's folder
    // is not a candidate: a copy of `dut.svh` sitting next to a module does not
    // become the library's version because somebody wrote `<dut.svh>`.
    if (!systemLib) {
      const beside = existing(path.resolve(from, trimmed));
      if (beside) return beside;
    }

    // Upwards. `../pkg/cfg_pkg.svh` and `pkg/cfg_pkg.svh` written from three
    // folders deep are the two spellings a project really uses, and both are
    // answered by trying the enclosing folders.
    let directory = from;
    for (let level = 0; level < MAX_ASCENT; level++) {
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;

      const candidate = existing(path.resolve(directory, trimmed));
      if (candidate) return candidate;
    }

    for (const root of this.roots) {
      const candidate = existing(path.resolve(root, trimmed));
      if (candidate) return candidate;
    }

    const suffix = `/${folded(trimmed)}`;
    let shallowest: string | undefined;
    for (const file of this.files) {
      if (!file.toLowerCase().endsWith(suffix)) continue;
      // The shallowest match wins: two folders can each hold a `defines.svh`,
      // and the one closer to the project root is the one the file list meant.
      if (!shallowest || file.length < shallowest.length) shallowest = file;
    }
    if (shallowest) return shallowest;

    // A bare file name, but only when the project holds exactly one of them.
    // This is what an include path does for the common `` `include
    // "defines.svh" ``; two files of that name are ambiguous, and picking one
    // would resolve to a header the author never wrote.
    const byName = this.byBasename.get(path.posix.basename(folded(trimmed)));
    if (byName && byName.length === 1) return byName[0];

    return undefined;
  }
}

/** A readable regular file at `candidate`, as a posix path, or nothing. */
function existing(candidate: string): string | undefined {
  try {
    if (!statSync(candidate).isFile()) return undefined;
    return toPosix(path.normalize(candidate));
  } catch {
    return undefined;
  }
}
