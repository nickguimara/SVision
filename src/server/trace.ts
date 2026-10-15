import type { Range } from "vscode-languageserver-types";

import type { Catalog, CatalogEntry } from "./catalog.js";
import type { Analysis, HdlScope, SignalAccess } from "./model.js";
import { rootNameOf } from "./signalAccess.js";

/** How a hop relates to the one before it. */
export type TraceDirection = "start" | "up" | "down";

/** An access, tagged with the module and file it physically lives in. */
export interface TracedAccess extends SignalAccess {
  readonly moduleName: string;
  readonly uri: string;
}

/**
 * One module the signal was followed into, with what drives and loads it there.
 *
 * The tracer produces a tree rather than a flat list so that a reader can tell
 * "this net is driven three levels up" from "this net is driven right here".
 */
export interface TraceHop {
  /** Module the signal lives in at this hop. */
  readonly moduleName: string;
  readonly uri: string;
  /** Where the module itself is declared, so a hop row can be clicked. */
  readonly range?: Range;
  /** Instance names from the starting module down to this one. */
  readonly instancePath: string[];
  /** Name the signal has in this module; ports are renamed at each boundary. */
  readonly signal: string;
  readonly direction: TraceDirection;
  readonly drivers: TracedAccess[];
  readonly loads: TracedAccess[];
  /** True when a limit stopped the walk before the design was exhausted. */
  readonly truncated: boolean;
  readonly children: TraceHop[];
}

export interface TraceLimits {
  /** How many times the walk may cross a module boundary. */
  readonly maxHops: number;
  /** Hard cap on hops, in case a design is wider than expected. */
  readonly maxNodes: number;
}

export const DEFAULT_TRACE_LIMITS: TraceLimits = { maxHops: 4, maxNodes: 120 };

/** One instantiation of a module, with the file it is written in. */
interface ParentSite {
  readonly entry: CatalogEntry;
  readonly instanceName: string;
  readonly typeName: string;
}

/**
 * Follows one signal through the design, crossing module boundaries.
 *
 * Within a module the answer comes straight from the recorded accesses. Across
 * a boundary the signal is renamed to the port it is bound to, so `push_data`
 * in the parent becomes `din` inside the child -- and the walk continues from
 * whichever side drives or loads that port.
 */
export function traceSignal(
  start: { moduleName: string; uri: string; signal: string },
  catalog: Catalog,
  limits: TraceLimits = DEFAULT_TRACE_LIMITS,
  live?: Analysis,
): TraceHop | undefined {
  const entry = catalog.resolve(start.moduleName, start.uri);
  if (!entry) return undefined;

  // `maxHops` bounds the depth of any single path, and `maxNodes` bounds the
  // whole tree. A per-path budget matters: a shared budget would be exhausted
  // by the first branch explored, leaving a signal that reaches both a parent
  // and a child with one side silently missing.
  let nodesLeft = limits.maxNodes;

  const walk = (
    moduleName: string,
    signal: string,
    direction: TraceDirection,
    instancePath: string[],
    ancestors: Set<string>,
    depth: number,
    /** File this hop should be resolved in, when the caller knows it. */
    hintUri?: string,
  ): TraceHop | undefined => {
    const key = `${moduleName}:${signal}`;
    // A signal that loops back into a module already on this path would
    // otherwise expand forever.
    if (ancestors.has(key)) return undefined;
    if (nodesLeft <= 0 || depth >= limits.maxHops) return undefined;

    nodesLeft--;
    const nextAncestors = new Set(ancestors).add(key);

    // Resolved against the file the trace started in, so a module name that
    // two files share does not silently answer with the wrong one's body.
    const target = catalog.resolve(moduleName, hintUri);
    const drivers: TracedAccess[] = [];
    const loads: TracedAccess[] = [];

    if (target) {
      for (const access of target.accesses) {
        if (access.name !== signal) continue;
        const tagged: TracedAccess = { ...access, moduleName, uri: target.uri };
        (access.kind === "drive" ? drivers : loads).push(tagged);
      }
    }

    const children: TraceHop[] = [];
    let truncated = false;

    // Down: follow the signal into a submodule this module instantiates.
    for (const instance of target?.instances ?? []) {
      const binding = instance.connections.find((c) => rootNameOf(c.valueText) === signal);
      if (!binding?.portName) continue;

      const child = catalog.get(instance.typeName);
      if (!child) continue;

      const hop = walk(
        child.name,
        binding.portName,
        "down",
        [...instancePath, instance.instanceName],
        nextAncestors,
        depth + 1,
      );

      if (hop) children.push(hop);
      else if (depth + 1 >= limits.maxHops) truncated = true;
      else if (nodesLeft <= 0) truncated = true;
    }

    // Up: find every instantiation of this module and follow the port outwards.
    if (target?.ports.some((p) => p.name === signal)) {
      for (const site of parentsOf(catalog, moduleName, target?.uri)) {
        // Only a port can be followed outwards; an internal signal has no name
        // in the parent to look up.
        const instance = site.entry.instances.find(
          (i) => i.typeName === moduleName && i.instanceName === site.instanceName,
        );
        if (!instance) continue;

        const binding = instance.connections.find((c) => c.portName === signal);
        const outer = binding ? rootNameOf(binding.valueText) : undefined;
        if (!outer) continue;

        const hop = walk(
          site.entry.name,
          outer,
          "up",
          instancePath.slice(0, -1),
          nextAncestors,
          depth + 1,
        );

        if (hop) children.push(hop);
        else if (depth + 1 >= limits.maxHops) truncated = true;
        else if (nodesLeft <= 0) truncated = true;
      }
    }

    const hop: TraceHop = {
      moduleName,
      uri: target?.uri ?? start.uri,
      range: target?.selectionRange,
      instancePath,
      signal,
      direction,
      drivers,
      loads,
      truncated,
      children,
    };

    return hop;
  };

  return walk(start.moduleName, start.signal, "start", [], new Set(), 0, start.uri);
}

/**
 * Every place the workspace instantiates `moduleName`.
 *
 * `selfUri` skips the entry that declares the module in the file being traced:
 * that is the module itself, not a parent, and walking up from it would go in
 * circles. It matters when two files declare the same name -- tracing `top`
 * from `top.sv` must not climb into the `top` of some other file.
 */
function parentsOf(catalog: Catalog, moduleName: string, selfUri?: string): ParentSite[] {
  const sites: ParentSite[] = [];
  for (const entry of catalog.allEntries()) {
    if (selfUri && entry.uri === selfUri && entry.name === moduleName) continue;

    for (const instance of entry.instances) {
      if (instance.typeName === moduleName) {
        sites.push({ entry, instanceName: instance.instanceName, typeName: instance.typeName });
      }
    }
  }
  return sites;
}

/** Total number of hops in a trace, for the summary line. */
export function countHops(hop: TraceHop | undefined): number {
  if (!hop) return 0;
  return 1 + hop.children.reduce((sum, child) => sum + countHops(child), 0);
}

/** The module a signal belongs to, given the scopes of a live document. */
export function moduleOfSignal(
  analysis: Analysis,
  signal: string,
  offset: number,
): HdlScope | undefined {
  const chain = analysis.scopesByRange
    .filter((e) => e.start <= offset && offset <= e.end)
    .sort((a, b) => a.depth - b.depth)
    .map((e) => e.scope);

  // Innermost scope that declares the signal wins.
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i]!;
    const declares =
      scope.ports.some((s) => s.name === signal) || scope.symbols.some((s) => s.name === signal);
    if (declares) return scope;
  }
  return chain.find((s) => s.category === "module");
}