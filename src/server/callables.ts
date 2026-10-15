import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SignatureHelp } from "vscode-languageserver-types";
import type { Catalog } from "./catalog.js";
import type { Analysis, HdlSymbol } from "./model.js";
import { resolveSymbol, scopeChain } from "./model.js";
import { importedMember, includedDeclaration } from "./imports.js";
import { interfaceOfType } from "./hierarchy.js";
import type { IncludeResolver } from "./includes.js";
import { argumentLabel, callableLabel } from "./symbolFormatting.js";
export { callableLabel } from "./symbolFormatting.js";

/** Resolve the same routine for completion, positional calls and named calls. */
export function resolveCallable(name: string, analysis: Analysis, catalog: Catalog, offset: number, uri: string, includes?: IncludeResolver): HdlSymbol | undefined {
  const parts = name.split(/::|\./);
  const last = parts.pop()!;
  let symbol: HdlSymbol | undefined;
  if (parts.length === 0) {
    symbol = resolveSymbol(analysis, last, offset) ?? importedMember(analysis, catalog, offset, last)?.symbol ??
      (includes ? includedDeclaration(uri, catalog, includes, last)?.symbol : undefined);
  } else {
    const root = parts.shift()!;
    const local = resolveSymbol(analysis, root, offset) ?? importedMember(analysis, catalog, offset, root)?.symbol;
    const instance = scopeChain(analysis, offset).flatMap((s) => s.instances).find((i) => i.instanceName === root);
    let entry = local?.handleOf ? catalog.resolve(local.handleOf) :
      local ? interfaceOfType(local.typeText, catalog) : undefined;
    if (root === "this" || root === "super") {
      const chain = scopeChain(analysis, offset);
      const owner = chain.find((s) => s.ownerClass)?.ownerClass ?? chain.find((s) => s.category === "class")?.name;
      entry = owner ? catalog.resolve(owner) : undefined;
      if (root === "super") entry = entry?.baseClass ? catalog.resolve(entry.baseClass) : undefined;
    }
    entry ??= catalog.resolve(instance?.typeName ?? root);
    for (const part of parts) {
      const nested = entry?.instances.find((i) => i.instanceName === part);
      const member = entry?.symbols.find((s) => s.name === part);
      entry = nested ? catalog.resolve(nested.typeName) : member?.handleOf ? catalog.resolve(member.handleOf) :
        member ? interfaceOfType(member.typeText, catalog) : undefined;
    }
    if (entry) symbol = (entry.kind === "class" ? catalog.classMembers(entry.name) : entry.symbols).find((s) => s.name === last);
  }
  return symbol && (symbol.category === "function" || symbol.category === "task") ? symbol : undefined;
}

/** Stack-based scanner: commas in nested calls, strings and selects do not advance the argument. */
export function callAt(text: string, offset: number): { name: string; argument: number; named?: string } | undefined {
  const stack: { char: string; start: number; argument: number; argStart: number }[] = [];
  let string = false;
  for (let i = 0; i < offset; i++) {
    const char = text[i];
    if (string) {
      if (char === "\\") i++;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') { string = true; continue; }
    if (char === "/" && text[i + 1] === "/") { while (i < offset && text[i] !== "\n") i++; continue; }
    if (char === "/" && text[i + 1] === "*") { i += 2; while (i < offset && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    if (char === "(" || char === "[" || char === "{") stack.push({ char, start: i, argument: 0, argStart: i + 1 });
    else if (char === ")" || char === "]" || char === "}") stack.pop();
    else if (char === "," && stack.length) {
      const top = stack[stack.length - 1]!;
      top.argument++;
      top.argStart = i + 1;
    }
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (frame.char !== "(") continue;
    const match = /([A-Za-z_]\w*(?:(?:::|\.)[A-Za-z_]\w*)*)\s*$/.exec(text.slice(0, frame.start));
    if (!match || text[frame.start - match[0].length - 1] === ".") continue;
    const named = /^\s*\.([A-Za-z_]\w*)/.exec(text.slice(frame.argStart, offset))?.[1];
    return { name: match[1]!, argument: frame.argument, named };
  }
  return undefined;
}

export function provideSignatureHelp(document: TextDocument, analysis: Analysis, catalog: Catalog, offset: number, includes?: IncludeResolver): SignatureHelp | null {
  const call = callAt(document.getText(), offset);
  if (!call) return null;
  const routine = resolveCallable(call.name, analysis, catalog, offset, document.uri, includes);
  if (!routine) return null;
  const args = routine.arguments ?? [];
  const namedIndex = call.named ? args.findIndex((a) => a.name === call.named) : -1;
  return {
    signatures: [{ label: callableLabel(routine), parameters: args.map((arg) => ({ label: argumentLabel(arg), documentation: arg.doc })) }],
    activeSignature: 0,
    activeParameter: Math.max(0, Math.min(namedIndex >= 0 ? namedIndex : call.argument, args.length - 1)),
  };
}
