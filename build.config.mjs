/**
 * Shared esbuild configuration for the extension bundles.
 *
 * Runtime dependencies stay external so they resolve from the extension's own
 * node_modules at runtime, which is what keeps tree-sitter's .wasm payloads
 * addressable via require.resolve().
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  // Resolved from node_modules at runtime -- never inlined.
  packages: "external",
  // Injected by the extension host, never resolvable on disk.
  external: ["vscode"],
};

/** Both bundles, in the order they should be reported. */
export function targets({ production = false } = {}) {
  const options = { ...common, minify: production, sourcemap: !production };
  return [
    {
      ...options,
      entryPoints: [path.join(root, "src/client/extension.ts")],
      outfile: path.join(root, "dist/client.js"),
    },
    {
      ...options,
      entryPoints: [path.join(root, "src/server/server.ts")],
      outfile: path.join(root, "dist/server.js"),
    },
  ];
}

/** One-off build of every bundle. */
export async function buildAll({ production = false } = {}) {
  await Promise.all(targets({ production }).map((target) => esbuild.build(target)));
}

/** Long-lived watch contexts, returned so the caller can dispose of them. */
export async function watchAll() {
  const contexts = await Promise.all(targets().map((target) => esbuild.context(target)));
  await Promise.all(contexts.map((context) => context.watch()));
  return contexts;
}