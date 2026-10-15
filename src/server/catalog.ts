import type { Location, Range } from "vscode-languageserver-types";

import type { HdlInstance, HdlScope, HdlSymbol, PackageImport, SignalAccess } from "./model.js";
import { rootNameOf } from "./signalAccess.js";

/** A design unit (module / interface / package / program / class) found anywhere. */
export interface CatalogEntry {
  readonly name: string;
  readonly kind: HdlScope["category"];
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly ports: HdlSymbol[];
  readonly parameters: HdlSymbol[];
  /**
   * Signals, typedefs, genvars and enum literals declared in the unit's body.
   *
   * Needed to answer `DUT_if.adc_in`: an interface instance's members are not
   * ports of the enclosing module, they are ordinary declarations inside the
   * interface.
   */
  readonly symbols: HdlSymbol[];
  /**
   * Instances declared inside this unit. Kept so the hierarchy view can walk
   * the whole design without re-parsing every file it passes through.
   */
  readonly instances: HdlInstance[];
  /**
   * Drives and loads declared inside this unit, resolved against the workspace
   * index. The Signal Tracer walks these to follow a net across modules.
   */
  readonly accesses: SignalAccess[];
  readonly headerText: string;
  /**
   * For a class, the class it extends.
   *
   * Members of the base are members of the subclass, and the base is often in
   * another file, so this is recorded rather than merged.
   */
  readonly baseClass?: string;
  /**
   * Packages this unit imports.
   *
   * A package that does `import other::*` re-exports `other`'s members in
   * practice -- every design does it, and code downstream of it relies on it --
   * so a lookup that stopped at the first import would miss half the names a
   * `import cfg_pkg::*` is expected to bring in.
   */
  readonly imports: readonly PackageImport[];
}

/**
 * Scopes that represent a reusable design unit rather than an inline block.
 *
 * `class` belongs here for the same reason `package` does: both are named types
 * declared in one file and referenced from another, so `Packet pkt;` needs the
 * catalog to say what `Packet` is.
 */
const UNIT_KINDS = new Set<HdlScope["category"]>([
  "module",
  "interface",
  "program",
  "package",
  "class",
]);

/** How far a package's import chain is followed. */
const MAX_IMPORT_HOPS = 8;

/**
 * Workspace-wide index of design units. This is what makes "go to definition"
 * on an instantiation, and completion of module names, work across files.
 *
 * A name may legitimately be declared more than once (guarded variants, or a
 * vendor library plus a local wrapper), so declarations are stored as a list
 * and all of them are offered.
 */
export class Catalog {
  private readonly byName = new Map<string, CatalogEntry[]>();
  /** uri -> names declared by that document, so removal is exact. */
  private readonly byUri = new Map<string, string[]>();

  /**
   * Rebuilds the entries contributed by a single document.
   *
   * Port-boundary accesses need the direction of the *instantiated* module,
   * which may live in another file that has not been indexed yet. Resolution is
   * therefore a separate pass: this method only records what the document says,
   * and `resolveAll` rebuilds every entry's accesses from the finished index.
   */
  replaceDocument(uri: string, scopes: HdlScope[], accesses: readonly SignalAccess[] = []): void {
    this.removeDocument(uri);

    const declared: string[] = [];

    for (const scope of scopes) {
      if (!UNIT_KINDS.has(scope.category)) continue;
      const entry: CatalogEntry = {
        name: scope.name,
        kind: scope.category,
        uri,
        range: scope.range,
        selectionRange: scope.selectionRange,
        ports: scope.ports,
        parameters: scope.parameters,
        symbols: scope.symbols,
        instances: scope.instances,
        accesses: [],
        headerText: scope.headerText,
        baseClass: scope.baseClass,
        imports: scope.imports ?? [],
      };
      const list = this.byName.get(scope.name);
      if (list) list.push(entry);
      else this.byName.set(scope.name, [entry]);
      declared.push(scope.name);
    }

    this.byUri.set(uri, declared);
    this.source.set(uri, { accesses, scopes });
    this.resolveAll();
  }

  /**
   * What each document declared, kept so accesses can be rebuilt whenever the
   * index changes. Indexing order must not change the result.
   */
  private readonly source = new Map<
    string,
    { accesses: readonly SignalAccess[]; scopes: readonly HdlScope[] }
  >();

  /**
   * Recomputes the accesses of every indexed document.
   *
   * Called after each `replaceDocument` because a newly indexed module can be
   * the target of an instantiation in a file that was indexed earlier.
   */
  resolveAll(): void {
    for (const [uri, { accesses, scopes }] of this.source) {
      const entries = (this.byUri.get(uri) ?? [])
        .flatMap((name) => this.byName.get(name) ?? [])
        .filter((entry) => entry.uri === uri);

      for (const entry of entries) {
        const scope = scopes.find((s) => s.name === entry.name);
        const own = scope ? accesses.filter((a) => a.scopeId === scope.id) : [];
        const cross = scope ? this.portBoundaryAccesses(scope) : [];
        (entry as { accesses: SignalAccess[] }).accesses = [...own, ...cross];
      }
    }
  }

  /**
   * Drives and loads implied by `u_sub (.a(net))` style connections.
   *
   * Seen from the net: a net reaching a submodule's input port is loaded by
   * that submodule, and a net on its output port is driven by it. Without the
   * submodule's port directions there is nothing to classify, so those
   * connections are left out rather than guessed.
   */
  private portBoundaryAccesses(scope: HdlScope): SignalAccess[] {
    const out: SignalAccess[] = [];
    const visit = (current: HdlScope): void => {
      for (const instance of current.instances) {
        const entry = this.get(instance.typeName);
        if (!entry) continue;

        const directions = new Map(entry.ports.map((p) => [p.name, p.direction]));

        for (const binding of instance.connections) {
          const direction = binding.portName ? directions.get(binding.portName) : undefined;
          if (!direction) continue;

          // A net feeding an input port is being *read* by the submodule, and a net
          // on an output port is being *written* by it. The point of view is
          // always the net in this module, not the port.
          const kind =
            direction === "input" ? "load" : direction === "output" ? "drive" : undefined;
          if (!kind) continue;

          const name = rootNameOf(binding.valueText);
          if (!name) continue;

          out.push({
            name,
            scopeId: current.id,
            kind,
            range: binding.range,
            source: direction === "input" ? "instance_input" : "instance_output",
            // `instance_input` names the port the net reaches, not the
            // direction of the access itself.
            detail: `${instance.instanceName}.${binding.portName}`,
            port: binding.portName,
          });
        }
      }
      for (const child of current.children) visit(child);
    };

    visit(scope);
    return out;
  }

  removeDocument(uri: string): void {
    this.source.delete(uri);
    for (const name of this.byUri.get(uri) ?? []) {
      const list = this.byName.get(name);
      if (!list) continue;
      const kept = list.filter((e) => e.uri !== uri);
      if (kept.length === 0) this.byName.delete(name);
      else this.byName.set(name, kept);
    }
    this.byUri.delete(uri);
  }

  /** First declaration of `name`, used when a single target is expected. */
  get(name: string): CatalogEntry | undefined {
    return this.byName.get(name)?.[0];
  }

  /**
   * The entry for a module name, preferring the one written in a given file.
   *
   * A name may legitimately be declared more than once -- a guarded variant, or
   * a test file that reuses `top`. Asking for `top` while editing one of them
   * and getting the other one's definition is silently wrong, so a caller that
   * knows which file it is working in says so here.
   */
  resolve(name: string, uri?: string): CatalogEntry | undefined {
    const entries = this.byName.get(name);
    if (!entries) return undefined;
    if (uri) {
      const exact = entries.find((entry) => entry.uri === uri);
      if (exact) return exact;
    }
    return entries[0];
  }

  /**
 * Folded values of a package's parameters, following its own imports.
 *
 * Width folding needs numbers, not declarations: `output logic [C_PKT_DAT_W-1:0]`
 * is only 32 bits if the analyzer knows what `C_PKT_DAT_W` is, and that is one
 * file over -- possibly several, if the package re-exports another.
 *
 * Only names that already carry a folded value are included. An expression the
 * evaluator could not reduce is left out rather than approximated, so a width
 * stays unknown instead of becoming a plausible wrong number.
 */
parameterValues(packageName: string): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const walk = (entry: CatalogEntry, seen: Set<string>, hops: number): void => {
    if (hops > MAX_IMPORT_HOPS || seen.has(entry.name)) return;
    seen.add(entry.name);

    for (const symbol of entry.parameters) {
      if (symbol.resolvedValue === undefined) continue;
      if (!out.has(symbol.name)) out.set(symbol.name, symbol.resolvedValue);
    }

    for (const imported of entry.imports) {
      if (!imported.wildcard) continue;
      const next = this.get(imported.packageName);
      if (next) walk(next, seen, hops + 1);
    }
  };

  const entry = this.get(packageName);
  if (entry) walk(entry, new Set(), 0);
  return out;
}

all(name: string): CatalogEntry[] {
    return this.byName.get(name) ?? [];
  }

  /**
   * Every class declared anywhere in the workspace.
   *
   * The analyzer needs this to tell a class handle from a one-bit net: the
   * `Packet` in `Packet pkt;` is only knowable from outside the file being
   * read, since the class usually sits in another one.
   */
  classNames(): Set<string> {
    const names = new Set<string>();
    for (const [name, entries] of this.byName) {
      if (entries.some((entry) => entry.kind === "class")) names.add(name);
    }
    return names;
  }

  /**
   * Everything an object of `className` can see, its own members first.
   *
   * A subclass inherits its base's properties and methods, so the walk follows
   * `extends` up the chain. The base may be in another file, and may itself be
   * missing from the index, which is why the walk stops rather than recursing
   * forever.
   */
  classMembers(className: string, seen = new Set<string>()): HdlSymbol[] {
    const entry = this.get(className);
    if (!entry || seen.has(className)) return [];
    seen.add(className);

    const own = [...entry.symbols];
    const inherited = entry.baseClass ? this.classMembers(entry.baseClass, seen) : [];

    // The subclass declaration shadows the base's, which is what SV says.
    return [...own.filter((s) => !inherited.some((b) => b.name === s.name)), ...inherited];
  }

  /**
   * Every indexed design unit, across all files and names.
   *
   * The Signal Tracer walks this to find the instantiations of a module, which
   * is the only way to follow a net upwards.
   */
  allEntries(): CatalogEntry[] {
    return [...this.byName.values()].flat();
  }

  locations(name: string): Location[] {
    return this.all(name).map((e) => ({ uri: e.uri, range: e.selectionRange }));
  }

  /** Every design unit in the workspace, for the completion list. */
  units(): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const list of this.byName.values()) out.push(...list);
    return out;
  }
}