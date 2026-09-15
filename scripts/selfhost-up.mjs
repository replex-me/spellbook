#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanupScript = path.join(root, "scripts", "cleanup-local-docker.mjs");

export function selfhostUpPlan(nodeExecutable = process.execPath) {
  return {
    beforeBuild: [nodeExecutable, [cleanupScript, "--execute"]],
    build: ["docker", ["compose", "build"]],
    start: ["docker", ["compose", "up", "--detach", "--no-build", "--wait"]],
    afterStart: [nodeExecutable, [cleanupScript, "--execute"]],
  };
}

function execute([command, args]) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed${result.signal ? ` with ${result.signal}` : ` with exit ${result.status}`}.`,
    );
}

function run() {
  const plan = selfhostUpPlan();
  execute(plan.beforeBuild);
  execute(plan.build);
  try {
    execute(plan.start);
  } finally {
    execute(plan.afterStart);
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
