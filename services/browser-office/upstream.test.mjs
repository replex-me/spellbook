import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
);
const fetcher = readFileSync(
  new URL("./fetch-runtime.mjs", import.meta.url),
  "utf8",
);

test("browser Office runtime is reproducible and remains unapproved by default", () => {
  assert.equal(manifest.status, "viability_probe_only");
  assert.match(manifest.source.buildCommit, /^[0-9a-f]{40}$/u);
  assert.match(manifest.javascriptBridge.commit, /^[0-9a-f]{40}$/u);
  assert.equal(
    manifest.javascriptBridge.runtimeAsset.url,
    `https://raw.githubusercontent.com/allotropia/zetajs/${manifest.javascriptBridge.commit}/source/zeta.js`,
  );
  assert.ok(!manifest.runtimeBaseUrl.includes("spellbook"));
  assert.deepEqual(
    manifest.runtimeAssets.map(({ path }) => path),
    ["soffice.js", "soffice.data.js.metadata", "soffice.wasm", "soffice.data"],
  );
  for (const asset of manifest.runtimeAssets) {
    assert.match(asset.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0);
  }
  assert.equal(manifest.javascriptBridge.runtimeAsset.storedPath, "zeta.js");
  assert.match(
    manifest.javascriptBridge.runtimeAsset.sha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.ok(manifest.javascriptBridge.runtimeAsset.bytes > 0);
  assert.equal(
    manifest.requiredDocumentHeaders["Cross-Origin-Opener-Policy"],
    "same-origin",
  );
  assert.equal(
    manifest.requiredDocumentHeaders["Cross-Origin-Embedder-Policy"],
    "require-corp",
  );
  assert.match(fetcher, /does not match the pinned/);
  assert.match(fetcher, /Content-Encoding/);
  assert.match(fetcher, /\.partial/);
});
