import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const browserOfficeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const upstreamManifest = JSON.parse(
  readFileSync(path.join(browserOfficeRoot, "upstream.json"), "utf8"),
);

export function valueAtPath(valuePath) {
  const value = valuePath
    .split(".")
    .reduce((current, key) => current?.[key], upstreamManifest);
  if (value === undefined)
    throw new Error(`Unknown browser upstream key: ${valuePath}`);
  return value;
}

export function computePatchSeriesSha256(
  manifest = upstreamManifest,
  root = browserOfficeRoot,
) {
  const hash = createHash("sha256");
  for (const relativePatch of manifest.sourceCandidate.patches) {
    hash.update(relativePatch);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, relativePatch)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function patchFiles(
  manifest = upstreamManifest,
  root = browserOfficeRoot,
) {
  return manifest.sourceCandidate.patches.map((relativePatch) =>
    path.join(root, relativePatch),
  );
}

export function patchedSourcePaths(patchText) {
  return [...patchText.matchAll(/^\+\+\+ b\/(.+)$/gmu)].map(
    (match) => match[1],
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "patch-series-sha256") {
    process.stdout.write(`${computePatchSeriesSha256()}\n`);
    process.exit(0);
  }
  if (process.argv[2] !== "get" || !process.argv[3])
    throw new Error(
      "Usage: node upstream.mjs get <key.path> | patch-series-sha256",
    );
  const value = valueAtPath(process.argv[3]);
  process.stdout.write(
    `${Array.isArray(value) ? value.join("\n") : String(value)}\n`,
  );
}
