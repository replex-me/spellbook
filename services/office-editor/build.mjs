import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRuntimeMutationContract } from "./mutation-contract.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = fileURLToPath(new URL("./extension/", import.meta.url));

function runPnpm(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && path.isAbsolute(npmExecPath)) {
    execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd: root,
      stdio: "inherit",
    });
    return;
  }
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
}

generateRuntimeMutationContract();
runPnpm(["--filter", "@spellbook/ai-connector", "build"]);
runPnpm([
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
]);
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
