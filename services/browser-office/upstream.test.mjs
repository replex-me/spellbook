import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  computePatchSeriesSha256,
  patchedSourcePaths,
} from "./libreoffice/upstream.mjs";

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
  assert.match(manifest.source.candidateCommit, /^[0-9a-f]{40}$/u);
  assert.notEqual(manifest.source.candidateCommit, manifest.source.buildCommit);
  assert.equal(manifest.sourceCandidate.patchSeriesReady, true);
  assert.equal(manifest.sourceCandidate.buildReady, false);
  assert.equal(manifest.sourceCandidate.nativeSlideStructureReady, false);
  assert.equal(
    computePatchSeriesSha256(),
    manifest.sourceCandidate.patchSeriesSha256,
  );
  assert.deepEqual(manifest.sourceCandidate.invariants, [
    "table-cell-native-undo",
    "page-background-native-undo",
    "slide-real-name-undo",
    "moved-page-object-identity",
    "table-structure-geometry-undo",
    "table-insert-format-inheritance",
    "table-text-cursor-undo",
    "slide-layout-master-preservation",
    "sparse-master-slide-insertion",
    "pptx-slide-name-roundtrip",
    "pptx-text-shadow-roundtrip",
    "native-object-creation-undo",
    "text-layout-cache-invalidation",
    "table-cell-property-uno-undo",
    "pptx-object-lock-roundtrip",
    "object-interaction-uno-undo",
    "pptx-object-interaction-roundtrip",
    "content-placeholder-editability",
    "placeholder-local-property-precedence",
    "non-layout-undo-master-safety",
    "page-property-uno-undo",
    "object-property-uno-undo",
    "browser-property-pptx-roundtrip",
    "shape-text-native-undo",
    "shape-text-property-native-undo",
    "speaker-notes-native-undo",
    "browser-text-pptx-roundtrip",
    "shape-appearance-property-native-undo",
    "text-appearance-property-native-undo",
  ]);
  assert.match(manifest.toolchain.emscripten.commit, /^[0-9a-f]{40}$/u);
  assert.match(manifest.toolchain.qt.commit, /^[0-9a-f]{40}$/u);
  assert.match(manifest.toolchain.qt.qtbaseCommit, /^[0-9a-f]{40}$/u);
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
  assert.equal(
    manifest.requiredDocumentHeaders["Cross-Origin-Resource-Policy"],
    "cross-origin",
  );
  assert.match(fetcher, /does not match the pinned/);
  assert.match(fetcher, /Content-Encoding/);
  assert.match(fetcher, /\.partial/);
});

test("browser LibreOffice patches name their complete source surface", () => {
  const paths = manifest.sourceCandidate.patches.flatMap((relativePatch) =>
    patchedSourcePaths(
      readFileSync(new URL(relativePatch, import.meta.url), "utf8"),
    ),
  );
  assert.deepEqual([...new Set(paths)].sort(), [
    "include/oox/drawingml/shape.hxx",
    "include/oox/export/shapes.hxx",
    "include/svx/svdotable.hxx",
    "oox/source/drawingml/connectorshapecontext.cxx",
    "oox/source/drawingml/graphicshapecontext.cxx",
    "oox/source/drawingml/shape.cxx",
    "oox/source/drawingml/shapecontext.cxx",
    "oox/source/drawingml/shapegroupcontext.cxx",
    "oox/source/drawingml/textcharacterproperties.cxx",
    "oox/source/export/drawingml.cxx",
    "oox/source/export/shapes.cxx",
    "oox/source/ppt/pptgraphicshapecontext.cxx",
    "sd/inc/drawdoc.hxx",
    "sd/inc/sdpage.hxx",
    "sd/qa/unit/misc-tests.cxx",
    "sd/qa/unit/uiimpress.cxx",
    "sd/source/core/drawdoc2.cxx",
    "sd/source/core/sdpage.cxx",
    "sd/source/filter/eppt/epptooxml.hxx",
    "sd/source/filter/eppt/pptx-epptooxml.cxx",
    "sd/source/ui/inc/unmodpg.hxx",
    "sd/source/ui/unoidl/unoobj.cxx",
    "sd/source/ui/unoidl/unopage.cxx",
    "sd/source/ui/view/drviews7.cxx",
    "sd/source/ui/view/unmodpg.cxx",
    "svx/source/inc/cell.hxx",
    "svx/source/svdraw/svdmodel.cxx",
    "svx/source/svdraw/svdundo.cxx",
    "svx/source/table/cell.cxx",
    "svx/source/table/svdotable.cxx",
    "svx/source/table/tablecolumn.cxx",
    "svx/source/table/tablemodel.cxx",
    "svx/source/table/tablerow.cxx",
    "svx/source/table/tableundo.cxx",
    "svx/source/unodraw/unoshtxt.cxx",
  ]);
});
