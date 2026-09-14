import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const manifest = JSON.parse(
  fs.readFileSync("services/office-editor/libreoffice/upstream.json", "utf8"),
);
const sourceBuild = fs.readFileSync(
  "services/office-editor/libreoffice/build-engine.sh",
  "utf8",
);
const candidateWrapper = fs.readFileSync(
  "services/office-editor/libreoffice/write-candidate-build-env.mjs",
  "utf8",
);
const candidateRuntime = fs.readFileSync(
  "services/office-editor/libreoffice/build-candidate-runtime.sh",
  "utf8",
);

test("source build admission and candidate promotion are separate evidence states", () => {
  assert.equal(typeof manifest.sourcePatchSeriesReady, "boolean");
  assert.equal(typeof manifest.sourceCandidateReady, "boolean");
  assert.match(sourceBuild, /get sourcePatchSeriesReady/u);
  assert.doesNotMatch(sourceBuild, /get sourceCandidateReady/u);
  assert.match(sourceBuild, /\$EUID/u);
  assert.match(sourceBuild, /docker info/u);
  assert.match(sourceBuild, /refuses root compilation/u);
  assert.match(sourceBuild, /node --version/u);
  assert.match(sourceBuild, /Node\.js 20 or newer/u);
  assert.match(sourceBuild, /build_completed=false/u);
  assert.match(sourceBuild, /Integrated build failed; preserving/u);
  assert.match(sourceBuild, /build_completed=true/u);
  assert.match(sourceBuild, /for cppunit_target in/u);
  assert.match(sourceBuild, /SPELLBOOK_NATIVE_EVIDENCE_DIR/u);
  assert.match(sourceBuild, /\$cppunit_target\.log/u);
  assert.match(sourceBuild, /\$cppunit_target\.status/u);
  assert.match(sourceBuild, /PIPESTATUS\[0\]/u);
  assert.doesNotMatch(
    sourceBuild,
    /make -C "\$engine_build_root" "\$\{cppunit_targets\[@\]\}"/u,
  );
  assert.match(candidateWrapper, /manifest\.sourceCandidateReady/u);
  assert.doesNotMatch(candidateWrapper, /sourcePatchSeriesReady/u);
  assert.match(candidateRuntime, /@sha256:\[0-9a-f\]\{64\}/u);
  assert.match(
    candidateRuntime,
    /status --porcelain --untracked-files=normal/u,
  );
  assert.match(candidateRuntime, /must match the checked-out public commit/u);
  assert.match(candidateRuntime, /org\.opencontainers\.image\.revision/u);
  assert.match(candidateRuntime, /org\.spellbook\.collabora-engine-image/u);
  assert.match(
    candidateRuntime,
    /org\.spellbook\.collabora-patch-series-sha256/u,
  );
});

test("managed distributions receive one digest-pinned public runtime receipt", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "spellbook-runtime-release-"),
  );
  try {
    const output = path.join(root, "release.json");
    const runtimeImage = `registry.example/spellbook-office@sha256:${"a".repeat(64)}`;
    const engineImage = `registry.example/spellbook-engine@sha256:${"b".repeat(64)}`;
    const publicCommit = "c".repeat(40);
    if (!manifest.sourceCandidateReady) {
      const result = spawnSync(process.execPath, [
        "services/office-editor/libreoffice/write-runtime-release.mjs",
        output,
        runtimeImage,
        engineImage,
        publicCommit,
      ]);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr.toString(),
        /has not passed the integrated native suites/u,
      );
      assert.equal(fs.existsSync(output), false);
      return;
    }
    execFileSync(process.execPath, [
      "services/office-editor/libreoffice/write-runtime-release.mjs",
      output,
      runtimeImage,
      engineImage,
      publicCommit,
    ]);
    const release = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(release.kind, "spellbook-office-runtime");
    assert.equal(release.publicSource.commit, publicCommit);
    assert.equal(release.runtime.image, runtimeImage);
    assert.equal(release.runtime.engineImage, engineImage);
    assert.equal(release.runtime.patchLevel, manifest.patchLevel);
    assert.equal(release.runtime.patchSeriesSha256, manifest.patchSeriesSha256);
    assert.deepEqual(
      release.nativeVerification.requiredCppunitTargets,
      manifest.requiredCppunitTargets,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
