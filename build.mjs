#!/usr/bin/env node
/**
 * Build script for the SVision extension.
 *
 * Emits two CommonJS bundles into dist/:
 *   - client.js : VS Code extension host entry point (uses the "vscode" API)
 *   - server.js : language server, spawned as a standalone `node dist/server.js`
 *
 * Use `npm start` instead to build, watch and launch the editor in one step.
 */
import { buildAll, watchAll } from "./build.config.mjs";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

if (watch) {
  const contexts = await watchAll();
  console.log("[svision] watching...");
  const stop = async () => {
    await Promise.all(contexts.map((context) => context.dispose()));
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  await buildAll({ production });
  console.log("[svision] build complete");
}