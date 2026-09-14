import assert from "node:assert/strict";
import test from "node:test";

import {
  activeTextFontEvidence,
  canonicalFontFamily,
  normalizeActiveTextFormatting,
  scriptFontSlot,
} from "./text-format-evidence.mjs";

test("font evidence canonicalizes only controlled metric-compatible aliases", () => {
  assert.equal(canonicalFontFamily("Liberation Sans"), "Arial");
  assert.equal(canonicalFontFamily("Arial"), "Arial");
  assert.equal(canonicalFontFamily("Noto Sans CJK KR"), "Noto Sans CJK KR");
});

test("font evidence selects the active OOXML script slot", () => {
  assert.equal(scriptFontSlot("A"), "western");
  assert.equal(scriptFontSlot("검"), "asian");
  assert.equal(scriptFontSlot("ع"), "complex");
  assert.equal(scriptFontSlot(" "), null);
});

test("range formatting ignores dormant slots but preserves active formatting", () => {
  const formatting = {
    fontFamily: "Liberation Sans",
    fontFamilyAsian: "Noto Sans CJK KR",
    fontFamilyComplex: "Noto Sans",
    fontSize: 19,
    fontSizeAsian: 20,
    fontSizeComplex: 21,
    color: 0xff0000,
  };
  assert.deepEqual(normalizeActiveTextFormatting(formatting, "Latin"), {
    color: 0xff0000,
    fontFamily: "Arial",
    fontSize: 19,
  });
  assert.deepEqual(normalizeActiveTextFormatting(formatting, "검증"), {
    color: 0xff0000,
    fontFamilyAsian: "Noto Sans CJK KR",
    fontSizeAsian: 20,
  });
});

test("character evidence is stable across equivalent run splits", () => {
  const portion = (text, startOffset) => ({
    text,
    startOffset,
    fontFamily: "Liberation Sans",
    fontFamilyAsian: "Liberation Sans",
    fontFamilyComplex: "Liberation Sans",
    fontSize: 19,
    fontSizeAsian: 19,
    fontSizeComplex: 19,
    fontWeight: 150,
    fontWeightAsian: 150,
    fontWeightComplex: 150,
    fontStyle: "italic",
    fontStyleAsian: "italic",
    fontStyleComplex: "italic",
  });
  const oneRun = {
    paragraphs: [{ portions: [portion("A검ع", 0)] }],
  };
  const splitRuns = {
    paragraphs: [
      { portions: [portion("A", 0), portion("검", 1), portion("ع", 2)] },
    ],
  };
  assert.deepEqual(
    activeTextFontEvidence(oneRun),
    activeTextFontEvidence(splitRuns),
  );
});
