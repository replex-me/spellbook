import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { promoteNativeRuntimeEvidence } from "./promote-native-runtime-evidence.mjs";

const capabilities = JSON.parse(
  readFileSync("contracts/native-edit-capabilities.json", "utf8"),
);
const matrix = JSON.parse(
  readFileSync("contracts/impress-ai-capability-matrix.json", "utf8"),
);
const upstream = JSON.parse(
  readFileSync("services/office-editor/libreoffice/upstream.json", "utf8"),
);
const operations = Object.entries(capabilities.mutationModel.operations)
  .filter(([, operation]) => operation.availability !== "format_excluded")
  .map(([operation]) => operation);
const report = {
  status: "browser_runtime_passed",
  selectedOperations: operations,
  executedOperations: operations,
  missingOperations: [],
  scenarios: [
    {
      scenario: "complete",
      status: "passed",
      reopen: { verified: true },
      changeBudget: { valid: true },
    },
  ],
};
const sha256Json = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validation = {
  kind: "spellbook-office-runtime-validation",
  createdAt: "2026-09-15T00:00:00Z",
  release: {
    patchLevel: upstream.patchLevel,
    patchSeriesSha256: upstream.patchSeriesSha256,
    collaboraSourceCommit: upstream.source.commit,
  },
  gates: {
    native: { status: "passed" },
    browser: {
      status: "passed",
      operationCount: operations.length,
      scenarioCount: 1,
      sourceSha256: sha256Json(report),
    },
    visual: { status: "agent_reviewed" },
    powerPoint: { status: "passed" },
  },
};

test("promotes only the complete evidence-bound native operation set", () => {
  const promoted = promoteNativeRuntimeEvidence({
    capabilities,
    matrix,
    upstream,
    browserReport: report,
    validation,
    version: "9.9.9",
    browserReportSha256: "a".repeat(64),
    validationSha256: "b".repeat(64),
  });
  assert.equal(promoted.capabilities.version, "9.9.9");
  assert.equal(promoted.capabilities.candidateOperations.length, 0);
  assert.ok(
    operations.every(
      (operation) =>
        promoted.capabilities.mutationModel.operations[operation]
          .availability === "runtime_verified",
    ),
  );
  assert.equal(
    promoted.capabilities.mutationModel.operations.set_printable.availability,
    "format_excluded",
  );
  assert.deepEqual(promoted.matrix.operationCoverage.enginePatchReady, []);
  assert.ok(promoted.capabilities.stockEngineLimitations.length > 0);

  const promotedAgain = promoteNativeRuntimeEvidence({
    capabilities: promoted.capabilities,
    matrix: promoted.matrix,
    upstream,
    browserReport: report,
    validation,
    version: "9.9.10",
    browserReportSha256: "a".repeat(64),
    validationSha256: "b".repeat(64),
  });
  assert.deepEqual(
    promotedAgain.capabilities.stockEngineLimitations,
    promoted.capabilities.stockEngineLimitations,
  );
});

test("refuses partial browser evidence", () => {
  assert.throws(
    () =>
      promoteNativeRuntimeEvidence({
        capabilities,
        matrix,
        upstream,
        browserReport: { ...report, executedOperations: operations.slice(1) },
        validation,
        version: "9.9.9",
        browserReportSha256: "a".repeat(64),
        validationSha256: "b".repeat(64),
      }),
    /complete operation set/u,
  );
});
