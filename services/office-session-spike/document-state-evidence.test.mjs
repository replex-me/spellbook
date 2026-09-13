import assert from "node:assert/strict";
import test from "node:test";

import {
  documentStatesEquivalent,
  firstDocumentStateDifference,
  quantizedGeometryEquivalent,
} from "./document-state-evidence.mjs";

test("document state treats one hundredth millimetre as the same element outline", () => {
  const expected = {
    slides: [
      {
        elements: [
          {
            x: 1_000,
            y: 2_000,
            width: 9_000,
            height: 4_500,
            table: { rowHeights: [2_250, 2_250], columnWidths: [4_500] },
          },
        ],
      },
    ],
  };
  const actual = structuredClone(expected);
  actual.slides[0].elements[0].width = 8_999;
  actual.slides[0].elements[0].height = 4_499;
  actual.slides[0].elements[0].table.rowHeights[0] = 2_249;

  assert.equal(documentStatesEquivalent(expected.slides, actual.slides), true);
  assert.equal(quantizedGeometryEquivalent(1_000, 999), true);
  assert.equal(quantizedGeometryEquivalent(1_000, 998), false);
});

test("document state keeps meaningful geometry and non-geometry values exact", () => {
  assert.deepEqual(
    firstDocumentStateDifference(
      [{ elements: [{ width: 9_000, text: "before" }] }],
      [{ elements: [{ width: 8_998, text: "before" }] }],
    ),
    { path: "slides[0].elements[0].width", expected: 9_000, actual: 8_998 },
  );
  assert.deepEqual(
    firstDocumentStateDifference(
      [{ elements: [{ sourcePixelSize: { width: 100 } }] }],
      [{ elements: [{ sourcePixelSize: { width: 99 } }] }],
    ),
    {
      path: "slides[0].elements[0].sourcePixelSize.width",
      expected: 100,
      actual: 99,
    },
  );
  assert.ok(
    firstDocumentStateDifference(
      [{ elements: [{ text: "before" }] }],
      [{ elements: [{ text: "after" }] }],
    ),
  );
});
