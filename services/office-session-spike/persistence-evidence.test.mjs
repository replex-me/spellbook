import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDocumentPersistenceDelta,
  assertExactPersistence,
  assertPersistenceDelta,
  documentPersistenceDeltaDifferences,
  firstPersistenceDeltaDifference,
  firstPersistenceDifference,
  normalizeDocumentPersistenceState,
  persistenceStateFromObservation,
  persistenceDeltaDifferences,
} from "./persistence-evidence.mjs";

test("persistence comparison ignores object key insertion order", () => {
  assert.equal(
    firstPersistenceDifference(
      { slide: { width: 10, height: 20 } },
      { slide: { height: 20, width: 10 } },
    ),
    null,
  );
});

test("persistence comparison reports the first structural value path", () => {
  assert.deepEqual(
    firstPersistenceDifference(
      { slides: [{ animations: { effects: [{ delay: 0.4 }] } }] },
      { slides: [{ animations: { effects: [{ delay: 0 }] } }] },
    ),
    {
      path: "$.slides[0].animations.effects[0].delay",
      expected: 0.4,
      observed: 0,
    },
  );
  assert.throws(
    () => assertExactPersistence([1, 2], [1], "Persistence failed."),
    /First difference at \$\.length: expected 1, observed 2/,
  );
});

test("delta comparison accepts normal no-op serialization changes", () => {
  assert.equal(
    firstPersistenceDeltaDifference(
      { masters: [{ shapeCount: 5 }] },
      { masters: [{ shapeCount: 5 }] },
      { masters: [{ shapeCount: 3 }] },
      { masters: [{ shapeCount: 3 }] },
    ),
    null,
  );
});

test("delta comparison requires an intended edit to survive save", () => {
  const states = {
    before: { slides: [{ transition: { duration: 0.75 } }] },
    expected: { slides: [{ transition: { duration: 1.25 } }] },
    baseline: { slides: [{ transition: { duration: 0.75 } }] },
  };
  assert.doesNotThrow(() =>
    assertPersistenceDelta(
      {
        ...states,
        observed: { slides: [{ transition: { duration: 1.25 } }] },
      },
      "Persistence failed.",
    ),
  );
  assert.throws(
    () =>
      assertPersistenceDelta(
        {
          ...states,
          observed: { slides: [{ transition: { duration: 0.75 } }] },
        },
        "Persistence failed.",
      ),
    /intended-change failed at \$\.slides\[0\]\.transition\.duration.*1\.25.*0\.75/,
  );
});

test("delta comparison rejects collateral changes after normalization", () => {
  assert.throws(
    () =>
      assertPersistenceDelta(
        {
          before: {
            slides: [{ transition: { duration: 0.75 } }],
            masters: [{ shapeCount: 5 }],
          },
          expected: {
            slides: [{ transition: { duration: 1.25 } }],
            masters: [{ shapeCount: 5 }],
          },
          baseline: {
            slides: [{ transition: { duration: 0.75 } }],
            masters: [{ shapeCount: 3 }],
          },
          observed: {
            slides: [{ transition: { duration: 1.25 } }],
            masters: [{ shapeCount: 2 }],
          },
        },
        "Persistence failed.",
      ),
    /unchanged-after-normalization failed at \$\.masters\[0\]\.shapeCount.*3.*2/,
  );
});

test("document delta comparison refuses incomplete four-state evidence", () => {
  assert.throws(
    () =>
      assertDocumentPersistenceDelta(
        { persistenceExpected: { slides: [], masters: [] } },
        { slides: [], masters: [] },
        "Persistence failed.",
      ),
    /requires before, expected, no-op baseline and reopened/,
  );
});

test("delta comparison applies OOXML millisecond canonicalization only to raw animation times", () => {
  const compareAt = (path) =>
    firstPersistenceDeltaDifference(0.001, 0.0015, 0.001, 0.001, path);
  assert.equal(
    compareAt("$.slides[0].animations.roots[0].children[0].duration"),
    null,
  );
  assert.deepEqual(compareAt("$.slides[0].animations.effects[0].duration"), {
    path: "$.slides[0].animations.effects[0].duration",
    expected: 0.0015,
    observed: 0.001,
    invariant: "intended-change",
  });
});

test("document persistence compares masters by semantics rather than relationship order", () => {
  const before = {
    masters: [
      { masterIndex: 0, name: "Title", layout: 0, shapeCount: 4 },
      { masterIndex: 1, name: "Blank", layout: 20, shapeCount: 3 },
    ],
    slides: [{ masterIndex: 1, masterName: "Blank", name: "page1" }],
  };
  const reordered = {
    masters: [
      { masterIndex: 0, name: "Blank", layout: 20, shapeCount: 3 },
      { masterIndex: 1, name: "Title", layout: 0, shapeCount: 4 },
    ],
    slides: [{ masterIndex: 0, masterName: "Blank", name: "page1" }],
  };
  const report = {
    persistenceBefore: before,
    persistenceExpected: before,
    persistenceBaseline: reordered,
  };
  assert.deepEqual(normalizeDocumentPersistenceState(before), {
    masters: [
      { name: "Blank", layout: 20, shapeCount: 3 },
      { name: "Title", layout: 0, shapeCount: 4 },
    ],
    slides: [{ masterName: "Blank", name: "page1" }],
  });
  assert.doesNotThrow(() =>
    assertDocumentPersistenceDelta(report, reordered, "Persistence failed."),
  );
});

test("document persistence still rejects semantic master changes and extras", () => {
  const state = {
    masters: [{ masterIndex: 0, name: "Blank", layout: 20, shapeCount: 3 }],
    slides: [{ masterIndex: 0, masterName: "Blank", name: "page1" }],
  };
  const report = {
    persistenceBefore: state,
    persistenceExpected: state,
    persistenceBaseline: state,
  };
  const modified = structuredClone(state);
  modified.masters[0].shapeCount = 5;
  assert.deepEqual(
    documentPersistenceDeltaDifferences(report, modified).map(
      ({ path, invariant }) => ({ path, invariant }),
    ),
    [
      {
        path: "$.masters[0].shapeCount",
        invariant: "unchanged-after-normalization",
      },
    ],
  );
  const extra = structuredClone(state);
  extra.masters.push({
    masterIndex: 1,
    name: "Default",
    layout: 20,
    shapeCount: 5,
  });
  assert.throws(
    () => assertDocumentPersistenceDelta(report, extra, "Persistence failed."),
    /\$\.masters\.length/,
  );
});

test("document persistence excludes regenerated observation diagnostics but not stored values", () => {
  const before = {
    masters: [],
    slides: [
      {
        slideIndex: 0,
        layoutIssues: [{ code: "old" }],
        elements: [
          {
            elementId: "0/0",
            stableId: "session-a",
            alignedWith: ["0/1"],
            overlapsWith: [],
            x: 10,
            fillColor: 255,
          },
        ],
      },
    ],
  };
  const regenerated = structuredClone(before);
  regenerated.slides[0].layoutIssues = [{ code: "new" }];
  Object.assign(regenerated.slides[0].elements[0], {
    stableId: "session-b",
    alignedWith: [],
    overlapsWith: ["0/2"],
  });
  const report = {
    persistenceBefore: before,
    persistenceExpected: before,
    persistenceBaseline: structuredClone(regenerated),
  };
  assert.doesNotThrow(() =>
    assertDocumentPersistenceDelta(report, regenerated, "Persistence failed."),
  );
  regenerated.slides[0].elements[0].fillColor = 0;
  assert.throws(
    () =>
      assertDocumentPersistenceDelta(
        report,
        regenerated,
        "Persistence failed.",
      ),
    /fillColor/,
  );
});

test("persistence state uses detailed paragraph portions after a range edit", () => {
  const observed = {
    masters: [],
    slides: [
      {
        elements: [
          { elementId: "0/0", text: "stale compact text" },
          { elementId: "0/1", text: "untouched" },
        ],
      },
    ],
    textDetails: {
      slideIndex: 0,
      elements: [
        {
          elementId: "0/0",
          paragraphs: [
            { portions: [{ text: "first" }, { text: " run" }] },
            { portions: [{ text: "second" }] },
          ],
        },
      ],
    },
  };
  assert.deepEqual(persistenceStateFromObservation(observed), {
    masters: [],
    slides: [
      {
        elements: [
          { elementId: "0/0", text: "first run\nsecond" },
          { elementId: "0/1", text: "untouched" },
        ],
      },
    ],
  });
});

test("persistence diagnostics collect the complete bounded difference set", () => {
  const differences = persistenceDeltaDifferences({
    before: { value: 1, untouched: "a" },
    expected: { value: 2, untouched: "a" },
    baseline: { value: 1, untouched: "b" },
    observed: { value: 3, untouched: "c" },
  });
  assert.deepEqual(
    differences.map(({ path, invariant }) => ({ path, invariant })),
    [
      { path: "$.untouched", invariant: "unchanged-after-normalization" },
      { path: "$.value", invariant: "intended-change" },
    ],
  );
});
