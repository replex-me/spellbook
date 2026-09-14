import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyScaledDimensionComparison,
  summarizeEditorCorpus,
} from "./evaluate-office-editor-corpus.mjs";

test("editor corpus comparison permits resolution scaling only at the same aspect ratio", () => {
  assert.deepEqual(
    classifyScaledDimensionComparison(
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
    ),
    { mode: "exact" },
  );
  assert.equal(
    classifyScaledDimensionComparison(
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ).mode,
    "scale",
  );
  assert.equal(
    classifyScaledDimensionComparison(
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
    ).mode,
    "mismatch",
  );
});

test("editor corpus summary separates PowerPoint fidelity from save-reopen drift", () => {
  const summary = summarizeEditorCorpus([
    {
      status: "passed",
      slideCount: 2,
      slides: [
        {
          powerPointComparison: { normalizedRmse: 0.2 },
          roundtripComparison: { normalizedRmse: 0.01 },
        },
        {
          powerPointComparison: { normalizedRmse: 0.4 },
          roundtripComparison: { normalizedRmse: 0.03 },
        },
      ],
    },
    { status: "failed", slideCount: 0, slides: [] },
  ]);
  assert.equal(summary.passedDecks, 1);
  assert.equal(summary.failedDecks, 1);
  assert.equal(summary.slides, 2);
  assert.equal(summary.referenceComparison.p50Rmse, 0.2);
  assert.equal(summary.referenceComparison.p95Rmse, 0.4);
  assert.equal(summary.saveReopenComparison.maxRmse, 0.03);
});
