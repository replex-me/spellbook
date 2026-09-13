import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateRuntimeMutationContract } from "./mutation-contract.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = fileURLToPath(new URL("./extension/", import.meta.url));
generateRuntimeMutationContract();
execFileSync("pnpm", ["--filter", "@spellbook/ai-connector", "build"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  [
    "exec",
    "esbuild",
    "apps/web/native-preview/main.tsx",
    "--bundle",
    "--format=iife",
    "--global-name=SpellbookWorkspace",
    "--outfile=services/office-editor/workspace-dist/workspace.js",
    "--loader:.css=css",
    "--jsx=automatic",
    "--alias:@=./apps/web/src",
    '--define:process.env.NODE_ENV="production"',
  ],
  { cwd: root, stdio: "inherit" },
);
execFileSync(
  "zip",
  [
    "-q",
    "-FS",
    "../extension.zip",
    "manifest.json",
    "icon.svg",
    "index.html",
    "mutation-contract.generated.js",
    "operations.js",
    "bridge.js",
  ],
  { cwd: extension, stdio: "inherit" },
);
