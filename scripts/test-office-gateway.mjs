#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const version = spawnSync("go", ["version"], { encoding: "utf8" });
if (version.error?.code === "ENOENT") {
  console.log(
    "SKIP office gateway Go tests: Go is not installed locally (the Docker build runs them).",
  );
  process.exit(0);
}
if (version.status !== 0) {
  process.stderr.write(
    version.stderr || "Unable to inspect the Go toolchain.\n",
  );
  process.exit(version.status ?? 1);
}
const result = spawnSync("go", ["test", "./..."], {
  cwd: "services/office-editor/gateway",
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(result.status ?? 1);
