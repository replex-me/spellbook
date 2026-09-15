import assert from "node:assert/strict";
import test from "node:test";

import { selfhostUpPlan } from "./selfhost-up.mjs";

test("builds, starts to health and retires only managed images", () => {
  const plan = selfhostUpPlan("node-test");
  assert.deepEqual(plan.beforeBuild[1].slice(-1), ["--execute"]);
  assert.deepEqual(plan.build, ["docker", ["compose", "build"]]);
  assert.deepEqual(plan.start, [
    "docker",
    ["compose", "up", "--detach", "--no-build", "--wait"],
  ]);
  assert.deepEqual(plan.afterStart[1].slice(-1), ["--execute"]);
});
