import { writeFileSync } from "node:fs";
import path from "node:path";
import { upstreamManifest as manifest } from "./upstream.mjs";

const output = path.resolve(
  process.argv[2] ?? "/workspace/.libreoffice-build.env",
);
const assetRoot = (process.env.SPELLBOOK_BUILD_ASSET_ROOT ?? "").replace(
  /\/+$/u,
  "",
);
if (!assetRoot) throw new Error("SPELLBOOK_BUILD_ASSET_ROOT is required.");

const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const sourceCacheName = `libreoffice-${manifest.source.version}-source.tar.xz`;
const values = {
  LO_BINARY_VERSION: manifest.binaryRelease.version,
  LO_INSTALL_SERIES: manifest.binaryRelease.installSeries,
  LO_BINARY_ARCHIVE_URL: manifest.binaryRelease.archiveUrl,
  LO_BINARY_ARCHIVE_SHA256: manifest.binaryRelease.archiveSha256,
  LO_SOURCE_VERSION: manifest.source.version,
  LO_SOURCE_REF: manifest.source.ref,
  LO_SOURCE_COMMIT: manifest.source.commit,
  LO_SOURCE_ARCHIVE_URL: manifest.source.archiveUrl,
  LO_SOURCE_ARCHIVE_SHA256: manifest.source.archiveSha256,
  LO_SOURCE_CACHE_URI: `${assetRoot}/${sourceCacheName}`,
  LO_PATCH_LEVEL: manifest.patchLevel,
  LO_PATCH_SERIES: manifest.patches
    .map((value) => path.basename(value))
    .join(" "),
  LO_BUILD_TARGETS: manifest.buildTargets.join(" "),
  LO_CPPUNIT_TARGETS: manifest.requiredCppunitTargets.join(" "),
  LO_ARTIFACT_NAME: manifest.artifact.name,
  LO_ARTIFACT_URI: `${assetRoot}/${manifest.artifact.name}`,
  LO_CCACHE_URI: `${assetRoot}/ccache/libreoffice-${manifest.source.version}-release-lto.tar.gz`,
  LO_EXTERNAL_TARBALLS_URI: `${assetRoot}/external-tarballs/libreoffice-${manifest.source.version}`,
};

writeFileSync(
  output,
  `${Object.entries(values)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join("\n")}\n`,
  { flag: "w", mode: 0o600 },
);
