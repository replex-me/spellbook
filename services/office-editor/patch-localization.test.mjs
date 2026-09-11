import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.dirname(new URL(import.meta.url).pathname);
const patcher = path.join(root, "patch-localization.mjs");
const overridesPath = path.join(root, "localization-ko-overrides.json");

test("Korean presentation terminology fills upstream gaps without dropping existing translations", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spellbook-l10n-"));
  const dictionaryPath = path.join(temporary, "ui-ko.json");
  writeFileSync(
    dictionaryPath,
    JSON.stringify({ Home: "홈", Insert: "삽입 전" }),
  );

  execFileSync(process.execPath, [patcher, dictionaryPath, overridesPath]);
  const dictionary = JSON.parse(readFileSync(dictionaryPath, "utf8"));

  assert.equal(dictionary.Home, "홈");
  assert.equal(dictionary.Insert, "삽입");
  assert.equal(dictionary.Navigation, "슬라이드 탐색");
  assert.equal(dictionary["Slide Show"], "슬라이드 쇼");
  assert.equal(dictionary["Width & Height"], "크기");
});
