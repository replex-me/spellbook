import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { admitCandidateRuntime } from "./candidate-runtime.mjs";
import { createBrowserRuntimeReceipt } from "./libreoffice/write-build-receipt.mjs";

test("candidate runtime is admitted only from receipt-bound raw artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spellbook-candidate-"));
  try {
    await writeArtifacts(root);
    const receipt = await createBrowserRuntimeReceipt({
      runtimeDirectory: root,
      repositoryRoot: path.resolve(import.meta.dirname, "../.."),
      sourceRevision: "a".repeat(40),
      builtAt: "2026-09-15T00:00:00.000Z",
      platform: "test-platform",
    });
    await writeFile(
      path.join(root, "build-receipt.json"),
      `${JSON.stringify(receipt)}\n`,
    );

    const admitted = await admitCandidateRuntime({ runtimeDirectory: root });
    assert.equal(admitted.runtimeIdentity.buildReady, true);
    assert.equal(
      admitted.runtimeIdentity.buildCommit,
      admitted.runtimeIdentity.candidateCommit,
    );
    assert.deepEqual(
      admitted.upstream.runtimeAssets.map(({ storedPath }) => storedPath),
      [
        "soffice.js",
        "soffice.data.js.metadata",
        "soffice.wasm",
        "soffice.data",
      ],
    );

    await writeFile(path.join(root, "soffice.data"), Buffer.from([0x02]));
    await assert.rejects(
      admitCandidateRuntime({ runtimeDirectory: root }),
      /digest differs/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeArtifacts(root) {
  await Promise.all([
    writeFile(path.join(root, "soffice.js"), "Module = {};\n"),
    writeFile(path.join(root, "soffice.data.js.metadata"), "{}\n"),
    writeFile(
      path.join(root, "soffice.wasm"),
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01]),
    ),
    writeFile(path.join(root, "soffice.data"), Buffer.from([0x01])),
  ]);
}
