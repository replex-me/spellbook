import assert from "node:assert/strict";
import test from "node:test";

import { selectEditableTextElement } from "./evaluate-public-roundtrip.mjs";

test("selects the first explicitly editable text shape", () => {
  const selected = selectEditableTextElement({
    slides: [
      {
        slideIndex: 0,
        elements: [
          { elementId: "picture", editable: false, text: null },
          { elementId: "empty", editable: true, text: "" },
        ],
      },
      {
        slideIndex: 1,
        elements: [
          { elementId: "shape", kind: "shape", editable: true, text: "Title" },
        ],
      },
    ],
  });

  assert.equal(selected.slideIndex, 1);
  assert.equal(selected.element.elementId, "shape");
});

test("returns null for preservation-only decks", () => {
  assert.equal(
    selectEditableTextElement({
      slides: [
        { slideIndex: 0, elements: [{ editable: false, text: "Chart" }] },
      ],
    }),
    null,
  );
});
