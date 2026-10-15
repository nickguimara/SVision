/**
 * Uri validation, kept separate from the panels so it can be unit tested.
 *
 * `vscode.Uri.parse` throws a UriError on a value whose path begins with `//`
 * when there is no authority component. That value reaches the extension from
 * two directions -- the workspace index and the webview messages -- so it is
 * checked before being handed over rather than caught afterwards.
 */

/** Splits a uri the way `vscode-uri` does, without validating it. */
function split(value: string): { scheme: string; authority: string; path: string } {
  const match = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)/.exec(value);
  return {
    scheme: match?.[2] ?? "",
    authority: match?.[4] ?? "",
    path: match?.[5] ?? "",
  };
}

/**
 * True when a uri is safe to hand to `vscode.Uri.parse`.
 *
 * `vscode-uri` raises a UriError when the path begins with `//` and there is no
 * authority. That is the exact failure that surfaced when clicking a net in the
 * viewer, so the shape is checked here rather than caught after the fact.
 *
 * An empty string is reported as unusable too: it parses, but names no file, so
 * a jump target built from it would silently go nowhere.
 */
export function isUsableUri(value: string): boolean {
  if (!value) return false;

  const { scheme, authority, path } = split(value);
  if (path.startsWith("//") && !authority) return false;

  // `//host` with no scheme is read as a path of `//host`, which is the same
  // rejection one level up. A scheme-less uri names no file in this extension.
  if (!scheme) return false;

  return true;
}

/** The uri, or undefined when it cannot be parsed. */
export function parseUri(value: string): { scheme: string; path: string } | undefined {
  if (!isUsableUri(value)) return undefined;
  const { scheme, path } = split(value);
  return { scheme, path };
}