import path from "node:path";

/**
 * Filesystem paths and `file://` uris, in one place.
 *
 * The two are not interchangeable, and getting it wrong is silent: a lookup
 * keyed by a path fails against a catalog keyed by a uri and the answer is
 * simply "not found". Every module that has to translate between the two -- the
 * workspace walk, the include resolver, the top-module search -- goes through
 * here so they all agree on the spelling.
 */

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * Minimal `file://` URI encoder that handles Windows drive letters.
 *
 * The path segments are joined onto an empty scheme, and the leading slash is
 * taken from the path itself: prefixing `file://` onto an already-absolute path
 * yields `file:////...`, which is a different URI from `file:///...` and makes
 * every lookup by uri miss.
 */
export function pathToUri(absolute: string): string {
  const normalised = toPosix(absolute);
  const encoded = normalised
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  const drive = /^([A-Za-z]):/.exec(encoded);
  if (drive) return `file:///${encoded.replace(/^([A-Za-z]):/, "%241:")}`;

  return `file:///${encoded}`;
}

/**
 * The filesystem path behind a `file://` uri, or undefined for anything else.
 *
 * A document can also be `untitled:` or live in a virtual filesystem, and there
 * is no directory to search upwards from -- so those return nothing rather than
 * a path that cannot be read.
 */
export function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;

  const decoded = decodeURIComponent(uri.slice("file://".length));
  // `pathToUri` never emits more than one leading slash, but a uri written by
  // hand or by another editor can, and `/a//b` is not a path node can read.
  const absolute = decoded.startsWith("/") ? decoded : `/${decoded}`;
  return path.normalize(absolute);
}

/** Lowercased path, for the case-insensitive comparisons a project needs. */
export function folded(value: string): string {
  return toPosix(value).toLowerCase();
}
