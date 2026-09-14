import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyScaledDimensionComparison,
  isTransientCorpusProbeFailure,
  stableSlideSemantics,
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
  assert.equal(
    classifyScaledDimensionComparison(
      { width: 1360, height: 908 },
      { width: 1280, height: 853 },
    ).mode,
    "scale",
  );
});

test("editor corpus persistence ignores runtime master projections but keeps slide semantics", () => {
  const state = {
    slides: [
      {
        name: "Slide 1",
        hidden: false,
        layout: 20,
        masterName: "Default",
        elementCount: 3,
      },
    ],
  };
  assert.deepEqual(stableSlideSemantics(state), [
    { name: "Slide 1", hidden: false, layout: 20, elementCount: 3 },
  ]);
});

test("editor corpus retries only connection and read-only observation timeouts", () => {
  assert.equal(
    isTransientCorpusProbeFailure(
      new Error("Native editor extension did not connect."),
    ),
    true,
  );
  assert.equal(
    isTransientCorpusProbeFailure(
      new Error(
        "편집 응답을 확인하지 못했습니다. 명령을 자동 재실행하지 않았습니다.",
      ),
    ),
    true,
  );
  assert.equal(
    isTransientCorpusProbeFailure(new Error("PPTX persistence failed")),
    false,
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
    {
      status: "passed",
      slideCount: 1,
      evidenceGaps: [{ code: "missing_powerpoint_reference" }],
      slides: [
        {
          powerPointComparison: null,
          roundtripComparison: { normalizedRmse: 0.02 },
        },
      ],
    },
    { status: "failed", slideCount: 0, slides: [] },
  ]);
  assert.equal(summary.passedDecks, 2);
  assert.equal(summary.failedDecks, 1);
  assert.equal(summary.evidenceGapDecks, 1);
  assert.equal(summary.evidenceGaps, 1);
  assert.equal(summary.slides, 3);
  assert.equal(summary.referenceComparison.p50Rmse, 0.2);
  assert.equal(summary.referenceComparison.p95Rmse, 0.4);
  assert.equal(summary.saveReopenComparison.maxRmse, 0.03);
});
