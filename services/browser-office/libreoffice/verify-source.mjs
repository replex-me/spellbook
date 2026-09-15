import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  computePatchSeriesSha256,
  patchFiles,
  patchedSourcePaths,
  upstreamManifest,
} from "./upstream.mjs";

const sourceFlag = process.argv.indexOf("--source");
if (sourceFlag < 0 || !process.argv[sourceFlag + 1])
  throw new Error("Usage: node verify-source.mjs --source /path/to/libreoffice-core");

const source = path.resolve(process.argv[sourceFlag + 1]);
const expectedCommit = upstreamManifest.source.candidateCommit;
const actualCommit = git(source, ["rev-parse", "HEAD"]).trim();
if (actualCommit !== expectedCommit)
  throw new Error(
    `Expected browser LibreOffice ${expectedCommit}, got ${actualCommit}.`,
  );

const actualPatchHash = computePatchSeriesSha256();
if (actualPatchHash !== upstreamManifest.sourceCandidate.patchSeriesSha256)
  throw new Error(
    `Expected browser patch series ${upstreamManifest.sourceCandidate.patchSeriesSha256}, got ${actualPatchHash}.`,
  );

const patches = patchFiles();
const sourcePaths = [
  ...new Set(
    patches.flatMap((patchFile) =>
      patchedSourcePaths(readFileSync(patchFile, "utf8")),
    ),
  ),
].sort();
if (!sourcePaths.length) throw new Error("The browser patch series is empty.");

const verificationRoot = mkdtempSync(
  path.join(tmpdir(), "spellbook-browser-libreoffice-"),
);
try {
  // A source checkout may itself be a partial clone. Cloning a promisor
  // repository through a local transport disables lazy fetching and can fail
  // before verification starts. A no-checkout worktree reuses the source
  // object's promisor remote while keeping every patch change isolated.
  git(source, [
    "worktree",
    "add",
    "--quiet",
    "--detach",
    "--no-checkout",
    verificationRoot,
    expectedCommit,
  ]);
  git(verificationRoot, ["sparse-checkout", "init", "--no-cone"]);
  git(verificationRoot, ["sparse-checkout", "set", "--no-cone", "--", ...sourcePaths]);
  git(verificationRoot, ["checkout", "--quiet", "--detach", expectedCommit]);
  for (const patchFile of patches) {
    git(verificationRoot, ["apply", "--check", "--whitespace=error-all", patchFile]);
    git(verificationRoot, ["apply", "--whitespace=error-all", patchFile]);
  }
  git(verificationRoot, ["diff", "--check"]);
  const changedPaths = git(verificationRoot, ["diff", "--name-only"])
    .trim()
    .split("\n")
    .filter(Boolean);
  if (changedPaths.join("\n") !== sourcePaths.join("\n"))
    throw new Error(
      `Browser patch path mismatch. Expected ${sourcePaths.join(", ")}; got ${changedPaths.join(", ")}.`,
    );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "source-patch-series-verified",
        sourceCommit: expectedCommit,
        patchLevel: upstreamManifest.sourceCandidate.patchLevel,
        patchSeriesSha256: actualPatchHash,
        patchCount: patches.length,
        changedPaths,
        requiredCppunitTargets:
          upstreamManifest.sourceCandidate.requiredCppunitTargets,
        buildReady: upstreamManifest.sourceCandidate.buildReady,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  try {
    git(source, ["worktree", "remove", "--force", verificationRoot]);
  } catch {
    rmSync(verificationRoot, { recursive: true, force: true });
    git(source, ["worktree", "prune"]);
  }
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
