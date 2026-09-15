import assert from "node:assert/strict";
import test from "node:test";

import { createCandidatePromotion } from "./candidate-promotion.mjs";

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
const receiptSha256 = "a".repeat(64);
const savedSha256 = "b".repeat(64);
const admittedRuntime = {
  receiptSha256,
  receipt: {
    spellbookSourceRevision: "c".repeat(40),
    libreOffice: { patchLevel: "browser-undo-v7" },
    toolchain: { emsdk: { version: "3.1.65" } },
    artifacts: [{ name: "soffice.wasm", sha256: "d".repeat(64) }],
  },
};
const browserReport = {
  status: "browser-product-bridge-verified",
  patchedBrowserRuntime: true,
  candidateRuntime: { receiptSha256 },
  verifiedElementOperations: operations,
  endurance: {
    status: "browser-product-endurance-verified",
    cycles: 100,
    operations,
  },
  changedParts: ["ppt/slides/slide1.xml"],
  replacement: "Spellbook · product bridge",
  savedSha256,
  pageErrors: [],
  requestFailures: [],
};
const powerpointReport = {
  valid: true,
  errors: [],
  browserReceiptSha256: receiptSha256,
  savedSha256,
  renderer: { name: "Microsoft PowerPoint", version: "16.109.1" },
  slideCounts: { source: 1, candidate: 1 },
  visibleEdit: { normalizedRmse: 0.01 },
};

test("promotion receipt binds runtime, browser endurance and PowerPoint", () => {
  const promotion = createCandidatePromotion({
    admittedRuntime,
    browserReport,
    browserReportSha256: "e".repeat(64),
    powerpointReport,
    powerpointReportSha256: "f".repeat(64),
    verifiedAt: "2026-09-15T00:00:00.000Z",
  });
  assert.equal(promotion.status, "verified_not_published");
  assert.equal(promotion.runtime.receiptSha256, receiptSha256);
  assert.equal(promotion.evidence.enduranceCycles, 100);
  assert.throws(
    () =>
      createCandidatePromotion({
        admittedRuntime,
        browserReport,
        browserReportSha256: "e".repeat(64),
        powerpointReport: { ...powerpointReport, savedSha256: "0".repeat(64) },
        powerpointReportSha256: "f".repeat(64),
      }),
    /browser-saved PPTX/u,
  );
});
