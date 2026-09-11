import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDiscoveryManifest,
  discoverPptxFiles,
} from "./create-corpus-manifest.mjs";

test("discovers size-bounded PPTX files in stable order", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "spellbook-corpus-discovery-"),
  );
  await fs.writeFile(path.join(root, "larger.pptx"), Buffer.alloc(8));
  await fs.writeFile(path.join(root, "smaller.PPTX"), Buffer.alloc(4));
  await fs.writeFile(path.join(root, "ignored.pptx"), Buffer.alloc(16));
  await fs.writeFile(path.join(root, "ignored.txt"), Buffer.alloc(1));

  const files = await discoverPptxFiles([root], { limit: 2, maxBytes: 8 });
  assert.deepEqual(
    files.map((file) => path.basename(file.path)),
    ["smaller.PPTX", "larger.pptx"],
  );
});

test("discovery manifests keep rights, sensitivity, and support unverified", () => {
  const manifest = buildDiscoveryManifest(
    [{ path: "/private/example.pptx", bytes: 42 }],
    "release-1",
  );
  assert.equal(manifest.decks[0].supportClass, "D");
  assert.equal(manifest.decks[0].usageRights, "unverified");
  assert.equal(manifest.decks[0].sensitivity, "unclassified");
  assert.equal(manifest.renderer.version, "release-1");
});

test("records the exact renderer image when provided", () => {
  const manifest = buildDiscoveryManifest(
    [{ path: "/fixtures/a.pptx", bytes: 42 }],
    "mvp10",
    "registry.example/spellbook-document-worker@mvp10",
  );

  assert.equal(
    manifest.renderer.image,
    "registry.example/spellbook-document-worker@mvp10",
  );
});
