import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  compareCollaboraRefs,
  computePatchSeriesSha256,
  latestCollaboraRef,
  upstreamManifest,
  valueAtPath,
} from "../services/office-editor/libreoffice/upstream.mjs";

test("browser engine source, patches and runtime are locked in one manifest", () => {
  assert.equal(valueAtPath("source.ref"), upstreamManifest.source.ref);
  assert.match(upstreamManifest.source.commit, /^[0-9a-f]{40}$/u);
  assert.match(upstreamManifest.runtimeImage, /@sha256:[0-9a-f]{64}$/u);
  assert.match(upstreamManifest.runtimePatchLevel, /^(?:stock|undo-v\d+)$/u);
  assert.match(upstreamManifest.patchSeriesSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    new Set(upstreamManifest.patches).size,
    upstreamManifest.patches.length,
  );
  assert.ok(
    upstreamManifest.patches.every((relativePatch) =>
      existsSync(
        path.resolve("services/office-editor/libreoffice", relativePatch),
      ),
    ),
  );
  assert.equal(computePatchSeriesSha256(), upstreamManifest.patchSeriesSha256);
  assert.ok(upstreamManifest.requiredCppunitTargets.length > 0);
  assert.ok(upstreamManifest.focusedCppunitTests.length > 0);
});

test("runtime environment is generated only from a digest-pinned manifest", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spellbook-engine-env-"));
  try {
    const output = path.join(root, "runtime.env");
    execFileSync(process.execPath, [
      "services/office-editor/libreoffice/write-runtime-build-env.mjs",
      output,
    ]);
    const environment = readFileSync(output, "utf8");
    assert.match(
      environment,
      /COLLABORA_RUNTIME_IMAGE='[^']+@sha256:[0-9a-f]{64}'/u,
    );
    assert.match(
      environment,
      /COLLABORA_RUNTIME_PATCH_LEVEL='(?:stock|undo-v\d+)'/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("engine admission and build fetch the immutable source commit", () => {
  for (const script of [
    "services/office-editor/libreoffice/build-engine.sh",
    "services/office-editor/libreoffice/verify-patch.sh",
  ]) {
    const source = readFileSync(script, "utf8");
    assert.match(
      source,
      /fetch --quiet --depth=1 origin "\$source_commit"/u,
    );
    assert.match(source, /checkout --quiet --detach FETCH_HEAD/u);
    assert.doesNotMatch(source, /clone .*--branch "\$source_ref"/u);
  }
});

test("Collabora release refs use numeric ordering", () => {
  assert.ok(compareCollaboraRefs("cp-26.04.10-1", "cp-26.04.9-9") > 0);
  assert.equal(
    latestCollaboraRef([
      "cp-26.04.3-2",
      "not-a-release",
      "cp-26.04.10-1",
      "cp-25.04.9-9",
    ]),
    "cp-26.04.10-1",
  );
  assert.throws(() => valueAtPath("source.missing"), /Unknown upstream key/u);
});

test("runtime mutation contracts are generated from the public capability model", () => {
  const capabilities = JSON.parse(
    readFileSync("contracts/native-edit-capabilities.json", "utf8"),
  );
  const conformance = JSON.parse(
    readFileSync("contracts/native-mutation-conformance.json", "utf8"),
  );
  const patchVersion = /^undo-v(?<version>[1-9][0-9]*)$/u.exec(
    upstreamManifest.patchLevel,
  );
  assert.ok(patchVersion?.groups?.version);
  assert.equal(
    conformance.enginePatchLevel,
    Number(patchVersion.groups.version),
  );
  const operations = capabilities.mutationModel.operations;
  assert.equal(Object.keys(operations).length, 63);
  assert.equal(operations.set_printable.availability, "format_excluded");
  assert.equal(
    operations.crop_image.availability,
    "runtime_validation_required",
  );
  assert.equal(operations.insert_slide.minEnginePatch, 9);
  for (const operation of capabilities.toolInputSchema.properties.op.enum)
    assert.equal(operations[operation].availability, "runtime_verified");
  const generated = readFileSync(
    "services/office-editor/extension/mutation-contract.generated.js",
    "utf8",
  );
  for (const operation of Object.keys(operations))
    assert.match(generated, new RegExp(`"${operation}"`, "u"));
});

test("the checked-in native conformance fixture is reproducible", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spellbook-fixture-"));
  try {
    const generated = path.join(root, "general-native-surface.pptx");
    execFileSync("python3", [
      "scripts/generate-native-conformance-fixture.py",
      generated,
    ]);
    assert.deepEqual(
      readFileSync(generated),
      readFileSync("eval/public/fixtures/general-native-surface.pptx"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
