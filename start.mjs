#!/usr/bin/env node
/**
 * Builds the extension and opens VS Code with it loaded.
 *
 * One command for the whole loop:
 *   - starts esbuild in watch mode so edits are picked up
 *   - launches VS Code in extension-development mode against this folder
 *   - tears the watcher down when the editor window closes
 *
 * Pass a path or folder to open it in the new window:
 *   npm start -- ./rtl
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { buildAll, root, watchAll } from "./build.config.mjs";

/** VS Code CLI locations, tried in order, plus the installed-app fallbacks. */
const CODE_CANDIDATES = [
  process.env.CODE_BIN,
  "code",
  "code-insiders",
  "cursor",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders",
  "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  "/usr/bin/code",
  "/usr/local/bin/code",
];

function resolveCode() {
  for (const candidate of CODE_CANDIDATES) {
    if (!candidate) continue;
    if (candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const found = spawnSync("which", [candidate], { encoding: "utf8" });
    const resolved = found.stdout?.trim();
    if (found.status === 0 && resolved) return resolved;
  }
  return undefined;
}

const openTargets = process.argv.slice(2);
const positional = openTargets.filter((arg) => !arg.startsWith("-"));

async function main() {
  const code = resolveCode();
  if (!code) {
    console.error(
      [
        "[svision] Could not find the VS Code CLI.",
        "",
        "Either open VS Code and run 'Shell Command: Install \"code\" command in PATH'",
        "from the Command Palette, or set CODE_BIN to the binary, e.g.:",
        "",
        '  CODE_BIN="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" npm start',
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("[svision] building...");
  await buildAll();

  console.log("[svision] watching for changes...");
  const contexts = await watchAll();

  const args = [
    "--extensionDevelopmentPath",
    root,
    "--new-window",
    // The `code` CLI detaches as soon as the window opens. Without --wait the
    // "exit" handler below fires immediately and tears the watcher down, so
    // edits after the launch are never rebuilt.
    "--wait",
    ...positional,
  ];

  console.log(`[svision] launching ${code}`);
  const editor = spawn(code, args, { stdio: "inherit" });

  let shuttingDown = false;
  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all(contexts.map((context) => context.dispose()));
  };

  editor.on("exit", async () => {
    await stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await stop();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await stop();
    process.exit(143);
  });
}

main().catch((error) => {
  console.error(`[svision] failed to start: ${String(error)}`);
  process.exit(1);
});