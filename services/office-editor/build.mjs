import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = fileURLToPath(new URL("./extension/", import.meta.url));
for (const args of [
  ["--filter", "@spellbook/ai-connector", "build"],
  [
    "--filter",
    "@spellbook/web",
    "exec",
    "vite",
    "build",
    "--config",
    "native-preview/vite.config.mjs",
  ],
])
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
execFileSync(
  "zip",
  [
    "-q",
    "-FS",
    "../extension.zip",
    "manifest.json",
    "icon.svg",
    "index.html",
    "operations.js",
    "bridge.js",
  ],
  { cwd: extension, stdio: "inherit" },
);
