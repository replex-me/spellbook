import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSourceCandidateAdmission } from "./admit-source-candidate.mjs";

const manifest = {
  sourceCandidateReady: false,
  patchSeriesSha256: "a".repeat(64),
  source: { ref: "cp-test", commit: "b".repeat(40) },
  requiredCppunitTargets: ["CppunitTest_one", "CppunitTest_two"],
  impressUiUnoCommandCount: 2,
  impressUiUnoCommandsSha256: "c".repeat(64),
};

test("admits only exact source, native suite and command-surface evidence", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spellbook-engine-admit-"));
  const nativeDirectory = path.join(root, "native");
  mkdirSync(nativeDirectory);
  try {
    for (const target of manifest.requiredCppunitTargets) {
      writeFileSync(path.join(nativeDirectory, `${target}.status`), "0\n");
      writeFileSync(path.join(nativeDirectory, `${target}.log`), `${target}\n`);
    }
    writeFileSync(
      path.join(nativeDirectory, "impress-command-surface.json"),
      JSON.stringify({
        source: manifest.source,
        inventory: {
          count: manifest.impressUiUnoCommandCount,
          sha256: manifest.impressUiUnoCommandsSha256,
          exact: true,
        },
        semanticRouting: {
          complete: true,
          unmappedCommands: [],
          unknownSemanticFamilies: [],
          contractMismatches: [],
        },
      }),
    );
    const nativeArchivePath = path.join(root, "native.tgz");
    const buildResultPath = path.join(root, "build-result");
    execFileSync("tar", [
      "-czf",
      nativeArchivePath,
      "-C",
      nativeDirectory,
      ".",
    ]);
    writeFileSync(buildResultPath, "0\n");

    const admitted = buildSourceCandidateAdmission({
      manifest,
      nativeDirectory,
      nativeArchivePath,
      buildResultPath,
      engineImageDigest: `sha256:${"d".repeat(64)}`,
      spellbookSourceRevision: "e".repeat(40),
      completedAt: "2026-09-16T00:00:00.000Z",
      patchSeriesSha256: manifest.patchSeriesSha256,
    });
    assert.equal(admitted.sourceCandidateReady, true);
    assert.equal(
      admitted.sourceCandidateEvidence.spellbookSourceRevision,
      "e".repeat(40),
    );
    assert.deepEqual(admitted.sourceCandidateEvidence.requiredCppunitStatuses, {
      CppunitTest_one: 0,
      CppunitTest_two: 0,
    });
    assert.equal(
      admitted.sourceCandidateEvidence.impressCommandSurface.exact,
      true,
    );

    writeFileSync(buildResultPath, "1\n");
    assert.throws(
      () =>
        buildSourceCandidateAdmission({
          manifest,
          nativeDirectory,
          nativeArchivePath,
          buildResultPath,
          engineImageDigest: `sha256:${"d".repeat(64)}`,
          spellbookSourceRevision: "e".repeat(40),
          patchSeriesSha256: manifest.patchSeriesSha256,
        }),
      /source_candidate_build_failed/u,
    );

    writeFileSync(buildResultPath, "0\n");
    writeFileSync(
      path.join(nativeDirectory, "CppunitTest_one.log"),
      "CppunitTest_one\nchanged after archive\n",
    );
    assert.throws(
      () =>
        buildSourceCandidateAdmission({
          manifest,
          nativeDirectory,
          nativeArchivePath,
          buildResultPath,
          engineImageDigest: `sha256:${"d".repeat(64)}`,
          spellbookSourceRevision: "e".repeat(40),
          patchSeriesSha256: manifest.patchSeriesSha256,
        }),
      /source_candidate_archive_content_mismatch/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
