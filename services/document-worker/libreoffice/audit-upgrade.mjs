import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareVersions,
  latestStableSourceVersion,
  upstreamManifest,
} from "./upstream.mjs";

const args = process.argv.slice(2);
const sourceIndexUrl =
  "https://download.documentfoundation.org/libreoffice/src/";
const requestedVersion = args.includes("--version")
  ? args[args.indexOf("--version") + 1]
  : null;
const providedSource = args.includes("--source")
  ? path.resolve(args[args.indexOf("--source") + 1])
  : null;
const download = args.includes("--download");
const temporaryRoot = mkdtempSync(
  path.join(os.tmpdir(), "spellbook-lo-upgrade-"),
);

const fetchText = (url) =>
  execFileSync(
    "curl",
    ["--fail", "--location", "--silent", "--show-error", url],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

try {
  const sourceIndex = fetchText(sourceIndexUrl);
  const latestRelease = latestStableSourceVersion(sourceIndex);
  if (!latestRelease)
    throw new Error("No stable LibreOffice source release found.");
  const releaseDirectory = requestedVersion
    ? requestedVersion.split(".").slice(0, 3).join(".")
    : latestRelease;
  const releaseIndexUrl = `${sourceIndexUrl}${releaseDirectory}/`;
  const releaseIndex = fetchText(releaseIndexUrl);
  const candidates = [
    ...releaseIndex.matchAll(
      /href="libreoffice-(\d+\.\d+\.\d+\.\d+)\.tar\.xz"/gu,
    ),
  ]
    .map((match) => match[1])
    .sort(compareVersions);
  const candidateVersion = requestedVersion ?? candidates.at(-1);
  if (!candidateVersion || !candidates.includes(candidateVersion))
    throw new Error(
      `LibreOffice source ${candidateVersion ?? "unknown"} is not published at ${releaseIndexUrl}`,
    );
  const ref = `libreoffice-${candidateVersion}`;
  const refs = execFileSync(
    "git",
    [
      "ls-remote",
      "--tags",
      upstreamManifest.source.repository,
      `refs/tags/${ref}*`,
    ],
    { encoding: "utf8" },
  );
  const peeled = refs
    .trim()
    .split("\n")
    .find((line) => line.endsWith(`refs/tags/${ref}^{}`));
  const commit = peeled?.split(/\s+/u)[0] ?? null;
  const archiveUrl = `${releaseIndexUrl}libreoffice-${candidateVersion}.tar.xz`;
  let sourceRoot = providedSource;
  let archiveSha256 = null;
  if (download) {
    const archive = path.join(
      temporaryRoot,
      `libreoffice-${candidateVersion}.tar.xz`,
    );
    execFileSync("curl", [
      "--fail",
      "--location",
      "--retry",
      "3",
      "--output",
      archive,
      archiveUrl,
    ]);
    archiveSha256 = sha256(archive);
    execFileSync("tar", [
      "--extract",
      "--xz",
      "--file",
      archive,
      "--directory",
      temporaryRoot,
    ]);
    sourceRoot = path.join(temporaryRoot, `libreoffice-${candidateVersion}`);
  }
  const patchResults = [];
  if (sourceRoot) {
    for (const relativePatch of upstreamManifest.patches) {
      const patchPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        relativePatch,
      );
      const result = spawnSync(
        "patch",
        [
          "--batch",
          "--dry-run",
          "--fuzz=0",
          "--directory",
          sourceRoot,
          "--strip=1",
        ],
        { input: readFileSync(patchPath), encoding: "utf8" },
      );
      patchResults.push({
        patch: relativePatch,
        appliesExactly: result.status === 0,
        diagnostic:
          result.status === 0
            ? null
            : `${result.stdout ?? ""}${result.stderr ?? ""}`
                .trim()
                .slice(0, 2000),
      });
    }
  }
  const patchAuditComplete = Boolean(sourceRoot);
  const candidateReadyForBuild =
    patchAuditComplete && patchResults.every((result) => result.appliesExactly);
  const report = {
    baseline: {
      binaryVersion: upstreamManifest.binaryRelease.version,
      sourceVersion: upstreamManifest.source.version,
      sourceCommit: upstreamManifest.source.commit,
      patchLevel: upstreamManifest.patchLevel,
    },
    published: {
      latestRelease,
      candidateVersion,
      ref,
      commit,
      archiveUrl,
      archiveSha256,
    },
    updateAvailable:
      compareVersions(candidateVersion, upstreamManifest.source.version) > 0,
    patchAuditComplete,
    patchResults,
    candidateReadyForBuild,
    nextGate: patchAuditComplete
      ? candidateReadyForBuild
        ? "Build both engine libraries, verify embedded manifest and markers, run unit and corpus gates, then canary before updating upstream.json."
        : "Rebase the failing patch by intent, determine whether upstream absorbed it, add a regression test, and repeat the exact audit."
      : "Run again with --download or --source <extracted official source> before considering the candidate buildable.",
  };
  writeFileSync(
    path.join(temporaryRoot, "report.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (patchAuditComplete && !candidateReadyForBuild) process.exitCode = 2;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
