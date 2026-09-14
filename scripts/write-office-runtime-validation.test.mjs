import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOfficeRuntimeValidation } from "./write-office-runtime-validation.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spellbook-validation-"));
  const nativeDirectory = path.join(root, "native");
  fs.mkdirSync(nativeDirectory);
  const target = "CppunitTest_sd_uiimpress";
  fs.writeFileSync(path.join(nativeDirectory, `${target}.status`), "0\n");
  fs.writeFileSync(
    path.join(nativeDirectory, `${target}.log`),
    `${target} passed\n`,
  );
  const releasePath = write(root, "release.json", {
    kind: "spellbook-office-runtime",
    publicSource: { commit: "c".repeat(40) },
    runtime: {
      image: `registry/runtime@sha256:${"a".repeat(64)}`,
      engineImage: `registry/engine@sha256:${"b".repeat(64)}`,
      patchLevel: "undo-v17",
      patchSeriesSha256: "d".repeat(64),
      collaboraSourceCommit: "e".repeat(40),
    },
    nativeVerification: { requiredCppunitTargets: [target] },
  });
  const browserReportPath = write(root, "browser.json", {
    status: "browser_runtime_passed",
    enginePatchLevel: 17,
    selectedOperations: ["replace_text", "set_background"],
    executedOperations: ["replace_text", "set_background"],
    missingOperations: [],
    scenarios: [
      {
        scenario: "general-native-surface",
        status: "passed",
        reopen: { verified: true },
        changeBudget: { valid: true },
      },
    ],
  });
  const visualReviewPath = write(root, "visual.json", {
    kind: "spellbook-visual-review",
    status: "agent_reviewed",
    reviewedAt: "2026-09-15T00:00:00.000Z",
    reviewer: "automated-release-review",
    screenshotCount: 4,
    scenarios: ["general-native-surface"],
  });
  return {
    root,
    nativeDirectory,
    releasePath,
    browserReportPath,
    visualReviewPath,
  };
}

test("records passed native/browser gates without overstating a release", () => {
  const value = fixture();
  try {
    const validation = buildOfficeRuntimeValidation(value);
    assert.equal(validation.status, "candidate");
    assert.equal(validation.gates.native.status, "passed");
    assert.equal(validation.gates.browser.operationCount, 2);
    assert.equal(validation.gates.visual.status, "agent_reviewed");
    assert.equal(validation.gates.powerPoint.status, "pending");
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("refuses a failed native target", () => {
  const value = fixture();
  try {
    fs.writeFileSync(
      path.join(value.nativeDirectory, "CppunitTest_sd_uiimpress.status"),
      "2\n",
    );
    assert.throws(
      () => buildOfficeRuntimeValidation(value),
      /native_target_failed/u,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("requires every browser scenario to pass reopen and change-budget checks", () => {
  const value = fixture();
  try {
    const report = JSON.parse(fs.readFileSync(value.browserReportPath, "utf8"));
    report.scenarios[0].reopen.verified = false;
    fs.writeFileSync(value.browserReportPath, JSON.stringify(report));
    assert.throws(
      () => buildOfficeRuntimeValidation(value),
      /browser_runtime_validation_failed/u,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("promotes only human visual and PowerPoint evidence", () => {
  const value = fixture();
  try {
    const visual = JSON.parse(fs.readFileSync(value.visualReviewPath, "utf8"));
    visual.status = "human_passed";
    fs.writeFileSync(value.visualReviewPath, JSON.stringify(visual));
    const powerPointEvidencePath = write(value.root, "powerpoint.json", {
      kind: "spellbook-powerpoint-validation",
      status: "passed",
      validatedAt: "2026-09-15T00:00:00.000Z",
      platform: "macOS",
      applicationVersion: "16.109.1",
      files: [{ sha256: "f".repeat(64), result: "opened_without_repair" }],
    });
    const validation = buildOfficeRuntimeValidation({
      ...value,
      powerPointEvidencePath,
    });
    assert.equal(validation.status, "release_verified");
    assert.equal(validation.gates.powerPoint.status, "passed");
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test("the package-script separator reaches the real CLI", () => {
  const value = fixture();
  const output = path.join(value.root, "validation.json");
  try {
    execFileSync(process.execPath, [
      "scripts/write-office-runtime-validation.mjs",
      "--",
      "--release",
      value.releasePath,
      "--native-directory",
      value.nativeDirectory,
      "--browser-report",
      value.browserReportPath,
      "--visual-review",
      value.visualReviewPath,
      "--output",
      output,
    ]);
    assert.equal(
      JSON.parse(fs.readFileSync(output, "utf8")).status,
      "candidate",
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

function write(root, name, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
