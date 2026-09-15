import assert from "node:assert/strict";
import test from "node:test";

import { candidateBrowserReportErrors } from "./verify-candidate-powerpoint.mjs";

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
    /17-operation/u,
  );
});
