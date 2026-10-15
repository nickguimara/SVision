import type { Node, Tree } from "web-tree-sitter";

/**
 * Text macros.
 *
 * `` `NOTMRINST((CHANW-1),0,chan_mask); `` is a declaration written by a
 * preprocessor, not by the author, and without expansion it declares nothing:
 * the module's signals go missing and every use of them is reported as an
 * unknown identifier.
 *
 * This is not a preprocessor -- `include` is not followed, `undef` is honoured
 * but nothing else is simulated, and `ifdef` is resolved by picking a branch
 * rather than by evaluating a condition nobody has told us the value of. What it
 * does is enough for the declaration a macro stands for, which is the part that
 * has to be right for hover, widths and navigation.
 */

/** One `` `define ``, with its formal arguments and its body. */
export interface MacroDef {
  readonly name: string;
  /** Formal argument names, in order. Empty for an object-like macro. */
  readonly params: readonly string[];
  readonly body: string;
}

/** Every macro known to the workspace. */
export type MacroTable = Map<string, MacroDef>;

/** How deep a chain of macros is followed before giving up. */
const MAX_EXPANSION_DEPTH = 8;

/**
 * Reads the macros defined in one document.
 *
 * `ifdef` branches are collected rather than evaluated: whether `REMOVE_TMR`
 * is set is not knowable from the source alone, and a macro defined in either
 * branch is one the author expects to be available. Where both branches define
 * the same name, the later one wins, which is the `else` -- the branch taken
 * when the feature is not enabled, and the one most RTL relies on.
 */
export function collectMacros(tree: Tree, source: string): MacroDef[] {
  const out: MacroDef[] = [];
  const stack: Node[] = [tree.rootNode];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.type === "text_macro_definition") {
      const def = readDefinition(node, source);
      if (def) {
        // Later definitions of the same name win: `ifdef` first, `else` after.
        const existing = out.findIndex((m) => m.name === def.name);
        if (existing >= 0) out[existing] = def;
        else out.push(def);
      }
      continue;
    }

    if (node.type === "undefine_compiler_directive") {
      // Found by reading the node names: the grammar calls this
      // `undefine_compiler_directive`, not `undef`.
      const name = node.namedChild(0)?.text ?? "";
      const index = out.findIndex((m) => m.name === name);
      if (index >= 0) out.splice(index, 1);
      continue;
    }

    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }

  return out;
}

function readDefinition(node: Node, source: string): MacroDef | undefined {
  const nameNode = findChild(node, "text_macro_name");
  const bodyNode = findChild(node, "macro_text");
  if (!nameNode) return undefined;

  // The name node holds `NAME` or `NAME(a,b,c)`; the parameters live inside
  // it, so they are read from the text rather than from a field.
  const header = source.slice(nameNode.startIndex, nameNode.endIndex);
  const match = /^([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/.exec(header);
  if (!match) return undefined;

  const params = (match[2] ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== "=");

  return {
    name: match[1]!,
    params,
    body: bodyNode ? source.slice(bodyNode.startIndex, bodyNode.endIndex) : "",
  };
}

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

/**
 * Text produced by expanding a macro, with a map back to the original source.
 *
 * A macro body is written in the file that defines it but declares things in
 * the file that uses it, so every character of the expansion has to point at
 * the invocation that caused it. Hover and go-to-definition are meaningless
 * otherwise.
 */
export interface Expansion {
  readonly text: string;
  /** For each character of `text`, its offset in the original source. */
  readonly origin: number[];
}

/**
 * Expands `` `NAME `` and `` `NAME(args) `` in `text`.
 *
 * `originBase` is where `text` starts in the original source, so the map comes
 * out absolute.
 */
export function expand(
  text: string,
  macros: MacroTable,
  originBase: number,
  depth = 0,
): Expansion {
  let out = "";
  const origin: number[] = [];

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "`" && text[i + 1] === "`") {
      // `` ``_TMR `` -- token pasting. The backticks around the suffix go, and
      // what remains is appended to the token before it, which is what the
      // author wrote: `NAME``_TMR` means `NAME_TMR`.
      i += 2;
      continue;
    }

    if (ch === "`") {
      const match = /^`\s*([A-Za-z_]\w*)\s*/.exec(text.slice(i));
      const name = match?.[1];
      if (!name) {
        // A directive rather than a macro call. Left alone: the analyser reads
        // directives separately and rewriting them would hide them.
        const literal = /^`\s*[A-Za-z_]\w*/.exec(text.slice(i))![0];
        for (let k = 0; k < literal.length; k++) {
          out += literal[k]!;
          origin.push(originBase + i + k);
        }
        i += literal.length;
        continue;
      }

      const callStart = i;
      const def = macros.get(name);

      if (!def) {
        const literal = match![0];
        for (let k = 0; k < literal.length; k++) {
          out += literal[k]!;
          origin.push(originBase + i + k);
        }
        i += literal.length;
        continue;
      }

      const args = readArguments(text, i + match![0].length);
      const expandedBody = substitute(def, args, depth);

      if (depth < MAX_EXPANSION_DEPTH && expandedBody !== undefined) {
        const inner = expand(expandedBody.text, macros, callStart, depth + 1);
        // The inner map is relative to the original call; re-base it onto the
        // body text it came from.
        out += inner.text;
        for (const offset of inner.origin) origin.push(callStart + offset);
        i = args.end;
        continue;
      }

      const literal = text.slice(callStart, args.end);
      for (let k = 0; k < literal.length; k++) {
        out += literal[k]!;
        origin.push(originBase + callStart + k);
      }
      i = args.end;
      continue;
    }

    out += ch;
    origin.push(originBase + i);
    i++;
  }

  return { text: out, origin };
}

interface Args {
  readonly args: string[];
  /** Offset just past the closing parenthesis of the call, if there was one. */
  readonly end: number;
}

/** Reads the actual arguments of a macro call starting at `at`. */
function readArguments(text: string, at: number): Args {
  let i = at;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  if (text[i] !== "(") return { args: [], end: i };

  let depth = 0;
  let start = i + 1;
  const args: string[] = [];

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        args.push(text.slice(start, i));
        i++;
        break;
      }
    } else if (ch === "," && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }

  return { args, end: i };
}

interface Substituted {
  readonly text: string;
  /** Offset within `text` where the expanded body starts. */
  readonly start: number;
}

/**
 * Replaces the formal arguments of a macro with the actual ones.
 *
 * A parameter is only substituted as a whole word. `NAME` inside `NAME_TMR` is
 * a different identifier, and rewriting it would invent a symbol the author
 * never wrote.
 */
function substitute(def: MacroDef, call: Args, depth: number): Substituted | undefined {
  if (def.params.length === 0) return { text: def.body, start: 0 };

  let out = def.body;
  let offset = 0;

  for (let index = 0; index < def.params.length; index++) {
    const formal = def.params[index]!;
    const actual = call.args[index]?.trim() ?? "";

    const pattern = new RegExp(`\\b${escapeRegExp(formal)}\\b`, "g");
    out = out.replace(pattern, () => {
      const written = actual;
      offset += written.length - formal.length;
      return written;
    });
  }

  void offset;
  void depth;
  return { text: out, start: 0 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}