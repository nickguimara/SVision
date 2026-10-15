import type { Catalog, CatalogEntry } from "./catalog.js";
import { importsInScope, type Analysis, type HdlSymbol, type PackageImport } from "./model.js";

/**
 * Finding things that live in another file.
 *
 * Three mechanisms cross a file boundary and none of them is a plain scope
 * chain: a dotted path through an instance, a `pkg::name` scope resolution,
 * and an `import` that makes another package's members usable unqualified. They
 * share the same problem -- the declaration is indexed, but visible lookup
 * cannot reach it -- so the lookup lives here rather than in each provider.
 */

/** A declaration reached through an `import`, and where it lives. */
export interface ImportedMember {
  readonly symbol: HdlSymbol;
  readonly packageName: string;
  /** File the declaration is written in, which may not be the reading one. */
  readonly uri: string;
}

/**
 * How far an import chain is followed.
 *
 * A package that does `import base::*` passes those names on to whoever imports
 * it, which is what designs in the wild expect even though the language only
 * promises it for `export`. Without this, a parameter two packages away is
 * reported as undeclared in every file that uses it -- while the file that
 * declares it looks perfectly correct, which is what makes the bug so hard to
 * see. A handful of hops covers any real dependency chain, and the set of
 * visited packages stops a cycle from looping.
 */
const MAX_IMPORT_HOPS = 8;

/**
 * The members an import makes available, following the chain.
 *
 * An import does not copy anything: `import cfg_pkg::*;` leaves `WIDTH`
 * referring to the parameter declared inside `cfg_pkg`, in that file. That is
 * why the declaration's own range is returned alongside the file it lives in.
 *
 * The first package to declare a name wins, which is what shadowing means here:
 * a later wildcard import cannot override what an earlier one brought in.
 */
function collectFrom(
  catalog: Catalog,
  entry: CatalogEntry,
  wanted: string | undefined,
  out: ImportedMember[],
  seen: Set<string>,
  hops: number,
): void {
  if (hops > MAX_IMPORT_HOPS || seen.has(entry.name)) return;
  seen.add(entry.name);

  for (const symbol of [...entry.parameters, ...entry.ports, ...entry.symbols]) {
    if (wanted !== undefined && symbol.name !== wanted) continue;
    if (out.some((found) => found.symbol.name === symbol.name)) continue;
    out.push({ symbol, packageName: entry.name, uri: entry.uri });
  }

  // A package that is not fully indexed yet simply has nothing to pass on.
  for (const imported of entry.imports) {
    if (!imported.wildcard) continue;
    const next = resolvePackage(catalog, imported.packageName, entry.uri);
    if (next) collectFrom(catalog, next, wanted, out, seen, hops + 1);
  }
}

/**
 * Resolves a package name, preferring the declaration next to the importing
 * file and falling back to the first one indexed.
 *
 * A package of the same name can legitimately be declared more than once, as a
 * vendor library plus a local wrapper, so "next to me" is not merely a
 * preference.
 */
function resolvePackage(catalog: Catalog, name: string, nearUri: string): CatalogEntry | undefined {
  const entries = catalog.all(name);
  return entries.find((entry) => entry.uri === nearUri) ?? entries[0];
}

/** Whether `name` is one of the names this import brings in. */
function bringsIn(entry: PackageImport, name: string): boolean {
  return entry.wildcard || entry.explicit.includes(name);
}

/**
 * The member of an imported package that `name` refers to, if any.
 *
 * A local declaration wins, and is the caller's business: shadowing an imported
 * name is legal, so this only answers for names nothing else has claimed.
 */
export function importedMember(
  analysis: Analysis,
  catalog: Catalog,
  position: number,
  name: string,
): ImportedMember | undefined {
  for (const entry of importsInScope(analysis, position)) {
    // An explicit import names exactly one member, so a missing name here is a
    // real error and must not be looked for in the packages it re-exports.
    if (!bringsIn(entry, name)) continue;

    const pkg = catalog.resolve(entry.packageName);
    if (!pkg) continue;

    const found: ImportedMember[] = [];
    collectFrom(catalog, pkg, name, found, new Set(), 0);
    if (found.length > 0) return found[0];
  }

  return undefined;
}

/** Every member an import brings into scope, for completion. */
export function importedMembers(
  analysis: Analysis,
  catalog: Catalog,
  position: number,
): ImportedMember[] {
  const out: ImportedMember[] = [];
  const seen = new Set<string>();

  for (const entry of importsInScope(analysis, position)) {
    const pkg = catalog.resolve(entry.packageName);
    if (!pkg) continue;

    if (entry.wildcard) {
      collectFrom(catalog, pkg, undefined, out, seen, 0);
      continue;
    }

    for (const name of entry.explicit) {
      if (!bringsIn(entry, name)) continue;
      // A fresh `seen` per name, so two explicit imports of the same package do
      // not hide each other's names.
      collectFrom(catalog, pkg, name, out, new Set(), 0);
    }
  }

  return out;
}