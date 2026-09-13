import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const manifestPath = fileURLToPath(
  new URL("./upstream.json", import.meta.url),
);

export const upstreamManifest = JSON.parse(readFileSync(manifestPath, "utf8"));

export function valueAtPath(path) {
  const value = path
    .split(".")
    .reduce((candidate, key) => candidate?.[key], upstreamManifest);
  if (value === undefined) throw new Error(`Unknown upstream key: ${path}`);
  return value;
}

export function compareVersions(left, right) {
  const leftParts = String(left).split(".").map(Number);
  const rightParts = String(right).split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function latestStableSourceVersion(html) {
  const versions = [...html.matchAll(/href="(\d+\.\d+\.\d+)\/"/gu)]
    .map((match) => match[1])
    .filter((version) => Number(version.split(".")[0]) >= 24)
    .sort(compareVersions);
  return versions.at(-1) ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "get" || !process.argv[3]) {
    process.stderr.write("usage: node upstream.mjs get <path>\n");
    process.exit(64);
  }
  const value = valueAtPath(process.argv[3]);
  process.stdout.write(
    Array.isArray(value)
      ? `${value.join("\n")}\n`
      : typeof value === "object"
        ? `${JSON.stringify(value)}\n`
        : `${value}\n`,
  );
}
