import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertObservedEngineIdentity,
  loadOfficeRuntimeRelease,
  releaseEngineIdentity,
  verifyRuntimeContainerInspection,
} from "./office-runtime-identity.mjs";

function releaseFixture() {
  return {
    kind: "spellbook-office-runtime",
    publicSource: { commit: "c".repeat(40) },
    runtime: {
      image: `registry/runtime@sha256:${"a".repeat(64)}`,
      engineImage: `registry/engine@sha256:${"b".repeat(64)}`,
      patchLevel: "undo-v18",
      patchSeriesSha256: "d".repeat(64),
      collaboraSourceCommit: "e".repeat(40),
    },
    nativeVerification: {
      requiredCppunitTargets: ["CppunitTest_sd_uiimpress"],
    },
  };
}

test("loads and hashes an immutable Office runtime release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spellbook-release-"));
  try {
    const releasePath = path.join(root, "release.json");
    fs.writeFileSync(releasePath, JSON.stringify(releaseFixture()));
    const evidence = loadOfficeRuntimeRelease(releasePath);
    assert.match(evidence.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(evidence.release.runtime.patchLevel, "undo-v18");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("matches browser-observed engine identity to the release", () => {
  const release = releaseFixture();
  assert.deepEqual(
    assertObservedEngineIdentity(releaseEngineIdentity(release), release),
    releaseEngineIdentity(release),
  );
  assert.throws(
    () =>
      assertObservedEngineIdentity(
        { ...releaseEngineIdentity(release), publicCommit: "f".repeat(40) },
        release,
      ),
    /observed_engine_identity_mismatch/u,
  );
});

test("accepts only a running container configured from the release digest", () => {
  const release = releaseFixture();
  const inspection = {
    Id: "3".repeat(64),
    Image: `sha256:${"1".repeat(64)}`,
    Config: { Image: release.runtime.image },
    State: { Running: true },
  };
  assert.equal(
    verifyRuntimeContainerInspection(release, inspection).status,
    "passed",
  );
  assert.throws(
    () =>
      verifyRuntimeContainerInspection(release, {
        ...inspection,
        Config: { Image: `registry/runtime@sha256:${"2".repeat(64)}` },
      }),
    /runtime_container_identity_mismatch/u,
  );
});
