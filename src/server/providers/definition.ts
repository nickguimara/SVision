import { Location, type Position, type Range, type TextDocument } from "vscode-languageserver-types";
import type { Node } from "web-tree-sitter";

import { resolveSymbol, type Analysis } from "../model.js";
import { identifierAt } from "../locate.js";
import { pathOf, resolvePath } from "../hierarchy.js";
import { importedMember } from "../imports.js";
import type { Catalog } from "../catalog.js";

interface BindingContext {
  readonly kind: "port" | "parameter";
  readonly typeName: string;
}

/**
 * Resolves the identifier under the cursor to its declaration.
 *
 * Handles three cases:
 *  1. a reference to a symbol declared in the current file,
 *  2. a reference to a design unit (module / interface / package) anywhere in
 *     the workspace,
 *  3. a port or parameter name on an instantiation, which resolves against the
 *     instantiated unit's interface even across files.
 */
export function provideDefinition(
  document: TextDocument,
  analysis: Analysis,
  catalog: Catalog,
  offset: number,
): Location | Location[] | null {
  const node = identifierAt(analysis, offset);
  if (!node) return null;

  const name = node.text;

  // `.port(` on an instantiation resolves against the instantiated module.
  const binding = instanceBindingContext(node);
  if (binding) {
    // The module being instantiated normally lives in another file, so a
    // same-named declaration elsewhere would otherwise supply the wrong port
    // directions and the wrong completion list.
    const entries = catalog.all(binding.typeName);
    const unit =
      entries.find((e) => e.uri !== document.uri) ??
      entries.find((e) => e.uri === document.uri) ??
      entries[0];

    const candidates = unit
      ? binding.kind === "port"
        ? unit.ports
        : unit.parameters
      : [];
    const target = candidates.find((p) => p.name === name);
    // The unit's uri, not the current document's: the port lives in the
    // module's file, and pairing its range with this file's uri jumps to an
    // unrelated line.
    if (target && unit) return Location.create(unit.uri, target.selectionRange);
  }

  // A local declaration, honouring shadowing.
  const local = resolveSymbol(analysis, name, offset);
  if (local) return Location.create(document.uri, local.selectionRange);

  // `DUT_if.adc_in`, `DUT.u_sub.sig`: a dotted path into another scope, often
  // in another file. Only worth trying once local lookup has failed, so a local
  // signal named `adc_in` still wins.
  if (pathOf(node)) {
    const resolved = resolvePath(node, analysis, catalog, document.uri);
    // The resolved uri, not this document's: the declaration lives where it
    // was written.
    if (resolved) return Location.create(resolved.uri, resolved.symbol.selectionRange);
  }

  // `import cfg_pkg::*;` then a bare `WIDTH`. Nothing in this file declares it
  // and there is no path to walk -- the import is the only link.
  const imported = importedMember(analysis, catalog, offset, name);
  if (imported) return Location.create(imported.uri, imported.symbol.selectionRange);

  // A design unit referenced by name, possibly declared more than once.
  const locations = catalog.locations(name);
  if (locations.length > 0) return locations;

  return null;
}

/**
 * Recognises the port/parameter name position of a named binding, i.e. the
 * first identifier of `.port(...)` inside a `module_instantiation`.
 */
function instanceBindingContext(node: Node): BindingContext | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  if (parent.type !== "named_port_connection" && parent.type !== "named_parameter_assignment") {
    return undefined;
  }

  // Only the leading identifier is the port name; anything deeper is a signal.
  const first = parent.namedChild(0);
  if (first && first.id !== node.id) return undefined;

  let current: Node | null = parent;
  while (current) {
    if (current.type === "module_instantiation") {
      const typeName = current.childForFieldName("instance_type")?.text;
      if (!typeName) return undefined;
      return {
        kind: parent.type === "named_port_connection" ? "port" : "parameter",
        typeName,
      };
    }
    current = current.parent;
  }
  return undefined;
}

/** All occurrences of the identifier under the cursor within this document. */
export function provideReferences(
  document: TextDocument,
  analysis: Analysis,
  offset: number,
  includeDeclaration: boolean,
): Location[] {
  const node = identifierAt(analysis, offset);
  if (!node) return [];

  const name = node.text;
  const symbol = resolveSymbol(analysis, name, offset);
  const locations: Location[] = [];

  if (includeDeclaration && symbol) {
    locations.push(Location.create(document.uri, symbol.selectionRange));
  }

  for (const use of analysis.identifiers.get(name) ?? []) {
    if (symbol && sameRange(use.range, symbol.selectionRange)) continue;
    locations.push(Location.create(document.uri, use.range));
  }

  return locations;
}

function sameRange(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

export type { Position };