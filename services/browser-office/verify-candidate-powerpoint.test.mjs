import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  candidateBrowserReportErrors,
  candidateNativeConformanceErrors,
} from "./verify-candidate-powerpoint.mjs";

const operations = [
  "replace_text",
  "move",
  "resize",
  "fill_color",
  "rotate",
  "line_color",
  "line_width",
  "fill_opacity",
  "line_opacity",
  "font_size",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "font_family",
  "font_color",
  "paragraph_alignment",
];
const capabilities = JSON.parse(
  readFileSync(
    new URL("../../contracts/native-edit-capabilities.json", import.meta.url),
    "utf8",
  ),
);
const nativeOperations = Object.entries(capabilities.mutationModel.operations)
  .filter(([, operation]) => operation.availability !== "format_excluded")
  .map(([operation]) => operation)
  .sort();

test("PowerPoint admission requires the complete receipt-bound endurance report", () => {
  const report = {
    status: "browser-product-bridge-verified",
    patchedBrowserRuntime: true,
    candidateRuntime: { receiptSha256: "a".repeat(64) },
    verifiedElementOperations: operations,
    endurance: {
      status: "browser-product-endurance-verified",
      cycles: 100,
      operations,
    },
    changedParts: ["ppt/slides/slide1.xml"],
    replacement: "Spellbook · product bridge",
    savedSha256: "b".repeat(64),
    pageErrors: [],
    requestFailures: [],
  };
  assert.deepEqual(candidateBrowserReportErrors(report), []);
  assert.match(
    candidateBrowserReportErrors({
      ...report,
      endurance: { ...report.endurance, cycles: 99 },
    }).join("; "),
    /100 cycles/u,
  );
  assert.match(
    candidateBrowserReportErrors({
      ...report,
      verifiedElementOperations: operations.slice(1),
    }).join("; "),
    /17-operation bridge/u,
  );
});

test("PowerPoint admission also requires every typed native operation", () => {
  const scenarios = Array.from({ length: 10 }, (_, index) => ({
    scenario: `scenario-${index}`,
    status: "passed",
    reopenVerified: true,
    missingSelectedOperations: [],
    changeBudget: { valid: true },
  }));
  const report = {
    status: "browser-native-conformance-verified",
    candidateReceiptSha256: "a".repeat(64),
    expectedOperations: nativeOperations,
    executedOperations: nativeOperations,
    missingOperations: [],
    scenarios,
  };
  assert.deepEqual(candidateNativeConformanceErrors(report), []);
  assert.match(
    candidateNativeConformanceErrors({
      ...report,
      executedOperations: nativeOperations.slice(1),
    }).join("; "),
    /complete native operation contract/u,
  );
  assert.match(
    candidateNativeConformanceErrors({
      ...report,
      scenarios: scenarios.slice(1),
    }).join("; "),
    /all 10 scenarios/u,
  );
});
