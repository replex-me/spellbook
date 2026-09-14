import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseNamedArguments,
  booleanOption,
  requiredStringOption,
  requireBackupMembers,
  safeBackupPath,
  validateProjectName,
  verifyBackupManifest,
  writeBackupManifest,
} from "./selfhost-archive-lib.mjs";

test("archive arguments and project names fail closed", () => {
  assert.deepEqual(
    parseNamedArguments(
      ["--", "--project=spellbook-test", "--start"],
      new Set(["project", "start"]),
    ),
    { project: "spellbook-test", start: true },
  );
  assert.equal(
    validateProjectName("spellbook_restore_1"),
    "spellbook_restore_1",
  );
  assert.equal(requiredStringOption({ project: "safe" }, "project"), "safe");
  assert.equal(booleanOption({ start: true }, "start"), true);
  assert.throws(() => booleanOption({ start: "false" }, "start"));
  assert.throws(() => validateProjectName("Spellbook"));
  assert.throws(() => parseNamedArguments(["--unknown"], new Set()));
});

test("manifest verification detects traversal and changed bytes", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "spellbook-backup-test-"),
  );
  fs.writeFileSync(path.join(directory, "database.dump"), "database");
  writeBackupManifest(directory, { createdAt: "2026-09-14T00:00:00Z" }, [
    "database.dump",
  ]);
  assert.equal(verifyBackupManifest(directory).files.length, 1);
  requireBackupMembers(verifyBackupManifest(directory), ["database.dump"]);
  assert.throws(
    () =>
      requireBackupMembers(verifyBackupManifest(directory), ["missing.tar.gz"]),
    /missing required member/,
  );
  assert.throws(() => safeBackupPath(directory, "../outside"));
  fs.appendFileSync(path.join(directory, "database.dump"), "changed");
  assert.throws(
    () => verifyBackupManifest(directory),
    /integrity verification/,
  );
});

test("manifest verification rejects duplicate members", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "spellbook-backup-duplicate-test-"),
  );
  fs.writeFileSync(path.join(directory, "database.dump"), "database");
  writeBackupManifest(directory, { createdAt: "2026-09-14T00:00:00Z" }, [
    "database.dump",
  ]);
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.files.push(manifest.files[0]);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  assert.throws(() => verifyBackupManifest(directory), /duplicate member/);
});
