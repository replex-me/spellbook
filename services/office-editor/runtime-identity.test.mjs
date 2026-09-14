import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const engineImage = `registry/engine@sha256:${"a".repeat(64)}`;

test("injects immutable release identity into the browser-side engine program", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spellbook-identity-"));
  try {
    const target = path.join(root, "operations.js");
    fs.copyFileSync("services/office-editor/extension/operations.js", target);
    execFileSync(process.execPath, [
      "services/office-editor/inject-runtime-identity.mjs",
      target,
      "undo-v18",
      "c".repeat(40),
      engineImage,
      "d".repeat(64),
      "e".repeat(40),
    ]);
    const source = fs.readFileSync(target, "utf8");
    assert.match(source, /patchLevel: "undo-v18"/u);
    assert.match(source, new RegExp(`engineImage: "${engineImage}"`, "u"));
    assert.doesNotMatch(source, /__SPELLBOOK_[A-Z0-9_]+__/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses mutable engine identity for a candidate runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spellbook-identity-"));
  try {
    const target = path.join(root, "operations.js");
    fs.copyFileSync("services/office-editor/extension/operations.js", target);
    const result = spawnSync(
      process.execPath,
      [
        "services/office-editor/inject-runtime-identity.mjs",
        target,
        "undo-v18",
        "c".repeat(40),
        "registry/engine:mutable",
        "d".repeat(64),
        "e".repeat(40),
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /engine image must be digest-pinned/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
