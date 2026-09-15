import assert from "node:assert/strict";
import test from "node:test";

import { selfhostUpPlan } from "./selfhost-up.mjs";

test("builds, starts to health and retires only managed images", () => {
  const plan = selfhostUpPlan("node-test", "browser");
  assert.deepEqual(plan.beforeBuild[1].slice(-1), ["--execute"]);
  assert.deepEqual(plan.stopInactive, [
    "docker",
    ["compose", "stop", "--timeout", "30", "office-editor"],
  ]);
  assert.deepEqual(plan.build, [
    "docker",
    ["compose", "--profile", "browser", "build"],
  ]);
  assert.deepEqual(plan.start, [
    "docker",
    [
      "compose",
      "--profile",
      "browser",
      "up",
      "--detach",
      "--no-build",
      "--wait",
      "--remove-orphans",
    ],
  ]);
  assert.deepEqual(plan.afterStart[1].slice(-1), ["--execute"]);
});

test("selects one supported editor profile", () => {
  assert.equal(
    selfhostUpPlan("node-test", "wopi").stopInactive[1].at(-1),
    "browser-office",
  );
  assert.throws(
    () => selfhostUpPlan("node-test", "both"),
    /must be wopi or browser/u,
  );
});
