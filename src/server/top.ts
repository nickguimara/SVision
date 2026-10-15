import type { Range } from "vscode-languageserver-types";

import type { Catalog, CatalogEntry } from "./catalog.js";

/**
 * Which module the design hangs from.
 *
 * A project has one entry point: the module nobody instantiates, whose
 * instantiation tree reaches everything else. Knowing it once turns a pile of
 * files into a design -- it is what the RTL viewer should open, what "where does
 * this signal end up" should be answered against, and what tells a file with no
 * module of its own which module it belongs to.
 *
 * The answer is a property of the workspace, not of the file being edited, so it
 * is computed once and kept. `Catalog.structureVersion` is what makes that safe:
 * the search is repeated only when a design unit appears, disappears or is
 * re-instantiated, and never because a signal was renamed -- which is the
 * difference between a lookup per keystroke and a lookup per edit of the design.
 */

/** A design unit, and how much of the design hangs from it. */
export interface TopUnit {
  readonly name: string;
  readonly kind: string;
  readonly uri: string;
  /** Span of the unit's name, so a top can be opened from a list. */
  readonly range: Range;
  /** Design units reachable through instantiation, this one included. */
  readonly reach: number;
}

/** Kinds that can be the root of a design. A package or a class cannot. */
const ROOT_KINDS = new Set(["module", "program"]);

/** How many modules a single reach count may include, as a runaway guard. */
const MAX_REACH = 4096;

/** How far up the instantiation tree a single lookup may walk. */
const MAX_ASCENT = 64;

/**
 * The instantiated relation and the roots it implies, cached until the catalog's
 * structure changes.
 */
interface Snapshot {
  /** Module name -> the units that instantiate it. */
  readonly parents: ReadonlyMap<string, readonly CatalogEntry[]>;
  /** Module name -> the module names it instantiates. */
  readonly children: ReadonlyMap<string, readonly string[]>;
  /** Every unit nobody instantiates, widest first. */
  readonly roots: readonly TopUnit[];
  /** Module name -> how many units hang from it. */
  readonly reach: ReadonlyMap<string, number>;
  /** Answer for `top()`, kept so the same question costs nothing twice. */
  readonly main?: TopUnit;
}

const EMPTY: Snapshot = {
  parents: new Map(),
  children: new Map(),
  roots: [],
  reach: new Map(),
};

export class TopResolver {
  /** Structure version the cached snapshot was built from. */
  private version = -1;
  private snapshot: Snapshot = EMPTY;

  constructor(private readonly catalog: Catalog) {}

  /**
   * Every unit that instantiates nothing, widest first.
   *
   * Sorted by how much of the design each one reaches, because a project with
   * several roots -- a testbench beside the RTL, a library beside both -- has
   * one that is plainly the main one: the one that reaches the rest.
   */
  roots(): TopUnit[] {
    return [...this.current().roots];
  }

  /**
   * The project's top: the root that reaches the most of the design.
   *
   * This is the one a file with no module of its own has no other way to find,
   * which is what makes it worth naming.
   */
  top(): TopUnit | undefined {
    return this.current().main;
  }

  /**
   * The top a module belongs to, walking up its instantiations.
   *
   * A module is reached from the top by being instantiated, transitively. When a
   * module sits in more than one tree -- a leaf reused by two tops -- the
   * project's own top wins when it is one of the ancestors, since that is the
   * one the whole design hangs from; otherwise the first root found does.
   */
  topOf(name: string, uri?: string): TopUnit | undefined {
    const { parents, roots, main } = this.current();
    let best: TopUnit | undefined;

    const visit = (current: string, hops: number, seen: Set<string>): void => {
      if (hops > MAX_ASCENT || seen.has(current) || best?.name === main?.name) return;
      seen.add(current);

      const sites = parents.get(current);
      if (!sites || sites.length === 0) {
        best = roots.find((root) => root.name === current) ?? best;
        return;
      }

      for (const site of sites) visit(site.name, hops + 1, seen);
    };

    visit(name, 0, new Set());

    // A name the catalog knows only in the file being edited still deserves an
    // answer: it may be a root that was just written.
    const entry = best ?? roots.find((root) => root.name === name && root.uri === uri);
    return entry;
  }

  /** Rebuilds the snapshot only when the design itself changed. */
  private current(): Snapshot {
    const version = this.catalog.structureVersion;
    if (this.version === version) return this.snapshot;

    this.version = version;
    this.snapshot = build(this.catalog);
    return this.snapshot;
  }
}

/**
 * Reads the instantiated relation out of the catalog.
 *
 * Edges are recorded by module *name* rather than by declaration: a design with
 * a guarded variant declares `fifo` twice, and for the hierarchy both are the
 * same module.
 */
function build(catalog: Catalog): Snapshot {
  const parents = new Map<string, CatalogEntry[]>();
  const children = new Map<string, Set<string>>();
  const units = catalog.units();
  const known = new Set(units.map((entry) => entry.name));

  const instantiated = new Set<string>();

  for (const entry of units) {
    for (const instance of entry.instances) {
      // An instantiation of a type the index has not seen is not an edge: there
      // is nothing on the other side to walk to, and counting it would invent a
      // module that no file declares.
      if (!known.has(instance.typeName)) continue;

      instantiated.add(instance.typeName);

      const own = children.get(entry.name) ?? new Set<string>();
      own.add(instance.typeName);
      children.set(entry.name, own);

      const sites = parents.get(instance.typeName);
      if (sites) {
        if (!sites.includes(entry)) sites.push(entry);
      } else {
        parents.set(instance.typeName, [entry]);
      }
    }

    // A unit that instantiates itself is instantiated, and must not be offered
    // as the design's top.
    if (entry.instances.some((instance) => instance.typeName === entry.name)) {
      instantiated.add(entry.name);
    }
  }

  const childNames = new Map<string, string[]>();
  for (const [name, own] of children) childNames.set(name, [...own]);

  const reach = new Map<string, number>();
  for (const entry of units) {
    if (!reach.has(entry.name)) reach.set(entry.name, countReach(entry.name, childNames));
  }

  const roots = units
    .filter((entry) => ROOT_KINDS.has(entry.kind) && !instantiated.has(entry.name))
    .sort((a, b) => {
      const byWidth = (reach.get(b.name) ?? 1) - (reach.get(a.name) ?? 1);
      // Two units of the same name in different files are both candidates, and
      // the order has to be stable or the answer would change between runs.
      return byWidth !== 0 ? byWidth : a.name.localeCompare(b.name) || a.uri.localeCompare(b.uri);
    })
    .map<TopUnit>((entry) => ({
      name: entry.name,
      kind: entry.kind,
      uri: entry.uri,
      range: entry.selectionRange,
      reach: reach.get(entry.name) ?? 1,
    }));

  return { parents, children: childNames, roots, reach, main: roots[0] };
}

/** How many distinct modules hang from `name`, counting itself. */
function countReach(name: string, children: ReadonlyMap<string, readonly string[]>): number {
  const seen = new Set<string>([name]);
  const queue = [name];

  while (queue.length > 0 && seen.size < MAX_REACH) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }

  return seen.size;
}
