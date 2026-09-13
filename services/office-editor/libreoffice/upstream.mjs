import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
export const upstreamManifest = JSON.parse(
  readFileSync(path.join(directory, "upstream.json"), "utf8"),
);

export function valueAtPath(valuePath) {
  const value = valuePath
    .split(".")
    .reduce((current, key) => current?.[key], upstreamManifest);
  if (value === undefined)
    throw new Error(`Unknown upstream key: ${valuePath}`);
  return value;
}

export function computePatchSeriesSha256(
  manifest = upstreamManifest,
  patchDirectory = directory,
) {
  const hash = createHash("sha256");
  for (const relativePatch of manifest.patches) {
    hash.update(relativePatch);
    hash.update("\0");
    hash.update(readFileSync(path.join(patchDirectory, relativePatch)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function compareCollaboraRefs(left, right) {
  const parts = (value) => {
    const match = /^cp-(\d+)\.(\d+)\.(\d+)-(\d+)$/.exec(value);
    if (!match) return null;
    return match.slice(1).map(Number);
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  if (!leftParts || !rightParts)
    throw new Error(
      `Invalid Collabora release ref: ${!leftParts ? left : right}`,
    );
  for (let index = 0; index < leftParts.length; index++) {
    const difference = leftParts[index] - rightParts[index];
    if (difference) return difference;
  }
  return 0;
}

export function latestCollaboraRef(refs) {
  const valid = refs.filter((value) => /^cp-\d+\.\d+\.\d+-\d+$/.test(value));
  if (!valid.length) throw new Error("No Collabora release refs found.");
  return valid.sort(compareCollaboraRefs).at(-1);
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
