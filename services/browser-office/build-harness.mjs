import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(serviceRoot, "runtime");
await mkdir(runtimeRoot, { recursive: true });
await build({
  entryPoints: [path.join(serviceRoot, "ooxml-worker-source.mjs")],
  outfile: path.join(runtimeRoot, "ooxml-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "eof",
  logLevel: "warning",
});
process.stdout.write("built ooxml-worker.js\n");
