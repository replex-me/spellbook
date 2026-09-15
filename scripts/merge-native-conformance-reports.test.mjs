import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildConformancePlan } from "./native-mutation-conformance.mjs";
import { mergeConformanceEvidence } from "./merge-native-conformance-reports.mjs";

const capabilities = JSON.parse(
  fs.readFileSync("contracts/native-edit-capabilities.json", "utf8"),
);
const conformance = JSON.parse(
  fs.readFileSync("contracts/native-mutation-conformance.json", "utf8"),
);

function fixture() {
  const release = {
    kind: "spellbook-office-runtime",
    publicSource: { commit: "c".repeat(40) },
    runtime: {
      image: `registry/runtime@sha256:${"a".repeat(64)}`,
      engineImage: `registry/engine@sha256:${"b".repeat(64)}`,
      patchLevel: "undo-v18",
      patchSeriesSha256: "d".repeat(64),
      collaboraSourceCommit: "e".repeat(40),
    },
    nativeVerification: {
      requiredCppunitTargets: ["CppunitTest_sd_uiimpress"],
    },
  };
  const identity = {
    patchLevel: release.runtime.patchLevel,
    publicCommit: release.publicSource.commit,
    engineImage: release.runtime.engineImage,
    patchSeriesSha256: release.runtime.patchSeriesSha256,
    collaboraSourceCommit: release.runtime.collaboraSourceCommit,
  };
  const plan = buildConformancePlan(capabilities, conformance, {
    enginePatchLevel: 18,
  });
  const operationsByScenario = Object.fromEntries(
    Object.keys(plan.scenarios).map((name) => [name, []]),
  );
  for (const family of Object.values(plan.families))
    operationsByScenario[family.scenarios[0]].push(...family.operations);
  const scenarios = Object.keys(plan.scenarios).map((name) => ({
    scenario: name,
    status: "passed",
    operations: [...new Set(operationsByScenario[name])],
    missingSelectedOperations: [],
    reopen: { verified: true },
    changeBudget: { valid: true },
    engineIdentity: identity,
  }));
  scenarios[0].missingSelectedOperations = ["covered-by-another-scenario"];
  return {
    releaseEvidence: { release, sha256: "f".repeat(64) },
    containerVerification: {
      status: "passed",
      configuredImage: release.runtime.image,
      localImageId: `sha256:${"1".repeat(64)}`,
      containerId: "2".repeat(64),
    },
    reports: [
      { path: "part-1.json", sha256: "3".repeat(64), report: { enginePatchLevel: 18, status: "failed", scenarios: scenarios.slice(0, 4) } },
      { path: "part-2.json", sha256: "4".repeat(64), report: { enginePatchLevel: 18, status: "browser_runtime_passed", scenarios: scenarios.slice(4) } },
    ],
    capabilities,
    conformance,
  };
}

test("merges checkpointed scenarios only when the full release contract is covered", () => {
  const merged = mergeConformanceEvidence(fixture());
  assert.equal(merged.status, "browser_runtime_passed");
  assert.equal(merged.scenarios.length, 10);
  assert.equal(merged.executedOperations.length, 63);
  assert.equal(merged.runtime.container.status, "passed");
});

test("rejects a checkpoint set with a missing scenario", () => {
  const value = fixture();
  value.reports[1].report.scenarios.pop();
  assert.throws(
    () => mergeConformanceEvidence(value),
    /missing_conformance_scenarios/u,
  );
});

test("rejects browser evidence from another engine identity", () => {
  const value = fixture();
  value.reports[0].report.scenarios[0].engineIdentity.publicCommit = "9".repeat(40);
  assert.throws(
    () => mergeConformanceEvidence(value),
    /observed_engine_identity_mismatch/u,
  );
});
