import assert from "node:assert/strict";
import fs from "node:fs";
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

test("source build admission and candidate promotion are separate evidence states", () => {
  assert.equal(typeof manifest.sourcePatchSeriesReady, "boolean");
  assert.equal(typeof manifest.sourceCandidateReady, "boolean");
  assert.match(sourceBuild, /get sourcePatchSeriesReady/u);
  assert.doesNotMatch(sourceBuild, /get sourceCandidateReady/u);
  assert.match(candidateWrapper, /manifest\.sourceCandidateReady/u);
  assert.doesNotMatch(candidateWrapper, /sourcePatchSeriesReady/u);
});
