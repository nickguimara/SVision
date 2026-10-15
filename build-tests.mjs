#!/usr/bin/env node
/**
 * Bundles the test suite into out-test/ so `node --test` can run it directly.
 * Runtime dependencies stay external, matching how the extension ships.
 */
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(root, "test");

const entryPoints = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => path.join(testDir, name));

if (entryPoints.length === 0) {
  console.error("[svision] no test files found");
  process.exit(1);
}

await esbuild.build({
  entryPoints,
  outdir: path.join(root, "out-test"),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: "inline",
  packages: "external",
  logLevel: "info",
});