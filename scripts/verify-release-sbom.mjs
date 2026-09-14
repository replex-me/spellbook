import { readFileSync } from "node:fs";

function fail(message) {
  throw new Error(`Invalid release SBOM: ${message}`);
}

const [file, expectedName, expectedVersion, kind] = process.argv.slice(2);
if (
  !file ||
  !expectedName ||
  !expectedVersion ||
  !["source", "image"].includes(kind)
) {
  console.error(
    "Usage: node scripts/verify-release-sbom.mjs <file> <name> <version> <source|image>",
  );
  process.exit(2);
}

let sbom;
try {
  sbom = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  fail(`cannot read SPDX JSON at ${file}: ${error.message}`);
}

if (sbom.spdxVersion !== "SPDX-2.3") {
  fail(`expected SPDX-2.3, received ${sbom.spdxVersion ?? "no version"}`);
}
if (sbom.dataLicense !== "CC0-1.0") {
  fail(
    `expected CC0-1.0 document license, received ${sbom.dataLicense ?? "none"}`,
  );
}
if (sbom.name !== expectedName) {
  fail(
    `expected document name ${expectedName}, received ${sbom.name ?? "none"}`,
  );
}
if (!Array.isArray(sbom.packages) || sbom.packages.length < 2) {
  fail("package inventory is empty");
}
if (!Array.isArray(sbom.relationships) || sbom.relationships.length === 0) {
  fail("package relationships are empty");
}

const packageIds = new Set();
for (const item of sbom.packages) {
  if (!item?.SPDXID || !item?.name) {
    fail("a package is missing SPDXID or name");
  }
  if (packageIds.has(item.SPDXID)) {
    fail(`duplicate package SPDXID ${item.SPDXID}`);
  }
  packageIds.add(item.SPDXID);
}

const root = sbom.packages.find(
  (item) => item.name === expectedName && item.versionInfo === expectedVersion,
);
if (!root) {
  fail(`root package ${expectedName}@${expectedVersion} is missing`);
}
if (
  !sbom.relationships.some(
    (relationship) =>
      relationship.relationshipType === "DESCRIBES" &&
      relationship.relatedSpdxElement === root.SPDXID,
  )
) {
  fail("document does not describe the expected root package");
}

if (kind === "source") {
  const names = new Set(sbom.packages.map((item) => item.name));
  for (const dependency of [
    "next",
    "fflate",
    "@xmldom/xmldom",
    "DocumentFormat.OpenXml",
  ]) {
    if (!names.has(dependency)) {
      fail(`source dependency inventory is missing ${dependency}`);
    }
  }
}

console.log(
  JSON.stringify({
    file,
    kind,
    name: expectedName,
    version: expectedVersion,
    packages: sbom.packages.length,
    relationships: sbom.relationships.length,
  }),
);
