import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function fixture(overrides = {}) {
  const root = {
    SPDXID: "SPDXRef-DocumentRoot-Directory-spellbook-source",
    name: "spellbook-source",
    versionInfo: "0123456789abcdef0123456789abcdef01234567",
  };
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    name: "spellbook-source",
    packages: [
      root,
      { SPDXID: "SPDXRef-next", name: "next", versionInfo: "16.3.3" },
      { SPDXID: "SPDXRef-fflate", name: "fflate", versionInfo: "0.8.3" },
      {
        SPDXID: "SPDXRef-xmldom",
        name: "@xmldom/xmldom",
        versionInfo: "0.9.12",
      },
      {
        SPDXID: "SPDXRef-openxml",
        name: "DocumentFormat.OpenXml",
        versionInfo: "3.5.1",
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: root.SPDXID,
      },
    ],
    ...overrides,
  };
}

function verify(sbom, kind = "source") {
  const directory = mkdtempSync(join(tmpdir(), "spellbook-sbom-"));
  const file = join(directory, "sbom.spdx.json");
  writeFileSync(file, JSON.stringify(sbom));
  return spawnSync(
    process.execPath,
    [
      "scripts/verify-release-sbom.mjs",
      file,
      "spellbook-source",
      "0123456789abcdef0123456789abcdef01234567",
      kind,
    ],
    { encoding: "utf8" },
  );
}

test("accepts a release-bound SPDX source inventory", () => {
  const result = verify(fixture());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"packages":5/);
});

test("rejects an SBOM that is not bound to the release revision", () => {
  const sbom = fixture();
  sbom.packages[0].versionInfo = "different";
  const result = verify(sbom);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /root package .* is missing/);
});

test("rejects a source inventory that omits a governed dependency family", () => {
  const sbom = fixture({
    packages: fixture().packages.filter(
      (item) => item.name !== "DocumentFormat.OpenXml",
    ),
  });
  const result = verify(sbom);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing DocumentFormat\.OpenXml/);
});

test("rejects duplicate SPDX package identities", () => {
  const sbom = fixture();
  sbom.packages.push({ ...sbom.packages[1] });
  const result = verify(sbom);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate package SPDXID/);
});
