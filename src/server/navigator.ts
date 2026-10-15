import type { Range } from "vscode-languageserver-types";

import type { Analysis, HdlScope, HdlSymbol, PortDirection } from "./model.js";

/**
 * The navigator: every declaration of a file, grouped by what it is.
 *
 * Purely local on purpose. It answers "what does this file declare", which is
 * a question about one file; anything that needs the workspace belongs to
 * navigation or to the tracer, not here.
 */

/** Group ids, in the order they are shown. */
export const NAVIGATOR_GROUPS = [
  "input",
  "output",
  "wire",
  "register",
  "parameter",
  "type",
  "instance",
] as const;

export type NavGroup = (typeof NAVIGATOR_GROUPS)[number];

export const NAVIGATOR_LABELS: Record<NavGroup, string> = {
  input: "Inputs",
  output: "Outputs",
  wire: "Wires",
  register: "Registers",
  parameter: "Parameters",
  type: "Types",
  instance: "Instances",
};

/** One row under a group. */
export interface NavSignal {
  readonly name: string;
  readonly group: NavGroup;
  /** Declared type, e.g. `logic [7:0]`. */
  readonly typeText: string;
  readonly direction?: PortDirection;
  /** Packed width in bits, when it could be folded. */
  readonly width?: number;
  /** Element count of the unpacked dimensions, e.g. 16 for `[0:15]`. */
  readonly elements?: number;
  /** Text shown as the row's description: `8 bits`, `16 x 8 bits`. */
  readonly sizeText: string;
  readonly range: Range;
  /** For an instance, the module it instantiates. */
  readonly typeName?: string;
}

/** A group of declarations, plus how many it holds. */
export interface NavGroupEntry {
  readonly group: NavGroup;
  readonly label: string;
  readonly signals: NavSignal[];
}

export interface NavigatorResult {
  /** The design units declared in the file, in source order. */
  readonly units: { name: string; category: string }[];
  readonly groups: NavGroupEntry[];
  /** True when the file declares nothing. */
  readonly empty: boolean;
}

/**
 * Reads `name` out of the signal.
 *
 * Width is what the tools reason about, so it is shown first; the element
 * count only matters for an unpacked array, where it is what tells a memory
 * from a vector.
 */
function sizeText(symbol: HdlSymbol): string {
  const { packedWidth: width, unpackedCount: elements } = symbol;

  if (width === undefined && elements === undefined) return "";
  if (elements !== undefined && elements > 1 && width !== undefined) {
    return `${elements} x ${width} bits`;
  }
  if (elements !== undefined && elements > 1) return `${elements} elements`;
  if (width === undefined) return "";
  return width === 1 ? "1 bit" : `${width} bits`;
}

function toSignal(symbol: HdlSymbol, group: NavGroup): NavSignal {
  return {
    name: symbol.name,
    group,
    typeText: symbol.typeText,
    direction: symbol.direction,
    width: symbol.packedWidth,
    elements: symbol.unpackedCount,
    sizeText: sizeText(symbol),
    range: symbol.selectionRange,
  };
}

/**
 * Design units whose declarations the navigator lists.
 *
 * `class` and `package` belong here for the same reason `module` does: they are
 * named things a file declares, and a file holding only a class still has
 * declarations worth showing.
 */
const NAVIGATED_UNITS = new Set<HdlScope["category"]>([
  "module",
  "interface",
  "class",
  "package",
]);

/** Which group a declaration belongs to. */
function groupOf(symbol: HdlSymbol): NavGroup | undefined {
  switch (symbol.category) {
    case "port":
      return symbol.direction === "output" || symbol.direction === "inout" ? "output" : "input";
    case "net":
      return "wire";
    case "variable":
      return "register";
    case "parameter":
    case "localparam":
      return "parameter";
    case "typedef":
    case "enum":
      return "type";
    default:
      // Methods, imports, genvars and design units are not signals. A handle is
      // handled below, next to the instances it belongs with.
      return undefined;
  }
}

/**
 * Groups one scope's declarations.
 *
 * Ports keep their declared order rather than being alphabetised: the header
 * is read left to right, and that is the order it is in.
 */
function fromScope(scope: HdlScope): NavGroupEntry[] {
  const buckets = new Map<NavGroup, NavSignal[]>();
  for (const group of NAVIGATOR_GROUPS) buckets.set(group, []);

  for (const symbol of [...scope.ports, ...scope.parameters, ...scope.symbols]) {
    const group = groupOf(symbol);
    if (!group) continue;
    buckets.get(group)!.push(toSignal(symbol, group));
  }

  const instances: NavSignal[] = scope.instances.map((instance) => ({
    name: instance.instanceName || instance.typeName,
    group: "instance" as const,
    typeText: instance.typeName,
    sizeText: "",
    range: instance.typeRange,
    typeName: instance.typeName,
  }));

  // A class handle belongs beside the module instances: both name an object,
  // and the type shown is the thing they point at.
  for (const symbol of scope.symbols) {
    if (!symbol.handleOf) continue;
    instances.push({
      name: symbol.name,
      group: "instance" as const,
      typeText: symbol.handleOf,
      sizeText: "",
      range: symbol.selectionRange,
      typeName: symbol.handleOf,
    });
  }

  const order: NavGroup[] = [...NAVIGATOR_GROUPS];
  return order
    .map((group) => ({
      group,
      label: NAVIGATOR_LABELS[group],
      signals: group === "instance" ? instances : buckets.get(group)!,
    }))
    .filter((entry) => entry.signals.length > 0);
}

/**
 * Builds the navigator for one analysed document.
 *
 * Every design unit in the file gets its own set of groups: a file holding a
 * module and a package lists both, rather than merging their declarations.
 */
export function buildNavigator(analysis: Analysis): NavigatorResult {
  const designUnits = analysis.scopes.filter((scope) => NAVIGATED_UNITS.has(scope.category));

  const units = designUnits.map((scope) => ({ name: scope.name, category: scope.category }));

  // A method is its own scope, nested inside the class; listing it separately
  // would show the class twice and detach the member from its owner.
  const groups = designUnits
    .filter((scope) => scope.category !== "function" && scope.category !== "task")
    .flatMap((scope) => fromScope(scope));

  return { units, groups, empty: units.length === 0 };
}