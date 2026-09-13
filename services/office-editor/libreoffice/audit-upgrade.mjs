import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  compareCollaboraRefs,
  computePatchSeriesSha256,
  latestCollaboraRef,
  upstreamManifest,
} from "./upstream.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argument = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    ...options,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
};

let source = argument("--source");
let candidateRef = argument("--ref");
let temporaryRoot;
let seriesRoot;

try {
  if (!source) {
    if (!candidateRef || candidateRef === "latest") {
      const remote = run("git", [
        "ls-remote",
        "--tags",
        "--refs",
        upstreamManifest.source.repository,
        "refs/tags/cp-*",
      ]);
      if (!remote.ok) throw new Error(remote.stderr || "git ls-remote failed");
      candidateRef = latestCollaboraRef(
        remote.stdout
          .split("\n")
          .map((line) => line.split("refs/tags/")[1])
          .filter(Boolean),
      );
    }
    temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "spellbook-collabora-upgrade-"),
    );
    source = path.join(temporaryRoot, "source");
    const clone = run("git", [
      "clone",
      "--quiet",
      "--depth=1",
      "--branch",
      candidateRef,
      upstreamManifest.source.repository,
      source,
    ]);
    if (!clone.ok) throw new Error(clone.stderr || "candidate clone failed");
  }

  const commit = run("git", ["-C", source, "rev-parse", "HEAD"]);
  if (!commit.ok)
    throw new Error(commit.stderr || "candidate commit read failed");
  const patchPaths = upstreamManifest.patches.map((relativePatch) =>
    path.join(directory, relativePatch),
  );
  seriesRoot = mkdtempSync(
    path.join(tmpdir(), "spellbook-collabora-patch-series-"),
  );
  const seriesSource = path.join(seriesRoot, "source");
  const seriesClone = run("git", [
    "clone",
    "--quiet",
    "--shared",
    "--no-checkout",
    source,
    seriesSource,
  ]);
  if (!seriesClone.ok)
    throw new Error(seriesClone.stderr || "candidate series clone failed");
  const seriesCheckout = run("git", [
    "-C",
    seriesSource,
    "checkout",
    "--quiet",
    "--detach",
    commit.stdout,
  ]);
  if (!seriesCheckout.ok)
    throw new Error(seriesCheckout.stderr || "candidate checkout failed");
  const patchResults = upstreamManifest.patches.map((relativePatch, index) => {
    const patchPath = patchPaths[index];
    const check = run("git", [
      "-C",
      seriesSource,
      "apply",
      "--check",
      "--whitespace=error-all",
      "--directory=engine",
      patchPath,
    ]);
    const applied = check.ok
      ? run("git", [
          "-C",
          seriesSource,
          "apply",
          "--whitespace=error-all",
          "--directory=engine",
          patchPath,
        ])
      : null;
    return {
      patch: relativePatch,
      appliesExactly: check.ok && applied?.ok === true,
      diagnostic: check.ok
        ? applied?.ok
          ? null
          : applied?.stderr || applied?.stdout
        : check.stderr || check.stdout,
    };
  });
  const seriesDiff = run("git", ["-C", seriesSource, "diff", "--check"]);
  const inventory = run("bash", [
    "-ceu",
    [
      "rg --only-matching --no-filename '\\.uno:[A-Za-z0-9_]+'",
      `  ${JSON.stringify(path.join(source, "engine/sd/uiconfig/simpress"))}`,
      `  ${JSON.stringify(path.join(source, "browser/src/control/Control.NotebookbarImpress.js"))}`,
      "  | sort --unique",
    ].join(" "),
  ]);
  if (!inventory.ok)
    throw new Error(inventory.stderr || "command inventory failed");
  const commands = inventory.stdout.split("\n").filter(Boolean);
  const commandCount = commands.length;
  const commandHash = createHash("sha256")
    .update(`${commands.join("\n")}\n`)
    .digest("hex");
  const candidatePatchSeriesSha256 = computePatchSeriesSha256();
  const patchSeriesMatchesManifest =
    candidatePatchSeriesSha256 === upstreamManifest.patchSeriesSha256;
  const report = {
    baseline: {
      ref: upstreamManifest.source.ref,
      commit: upstreamManifest.source.commit,
      patchSeriesSha256: upstreamManifest.patchSeriesSha256,
      commandCount: upstreamManifest.impressUiUnoCommandCount,
      commandHash: upstreamManifest.impressUiUnoCommandsSha256,
    },
    candidate: {
      ref: candidateRef ?? "local-source",
      commit: commit.stdout,
      patchSeriesSha256: candidatePatchSeriesSha256,
      commandCount,
      commandCountDelta:
        commandCount - upstreamManifest.impressUiUnoCommandCount,
      commandHash,
      commandInventoryChanged:
        commandHash !== upstreamManifest.impressUiUnoCommandsSha256,
    },
    updateAvailable:
      candidateRef && candidateRef !== "local-source"
        ? compareCollaboraRefs(candidateRef, upstreamManifest.source.ref) > 0
        : commit.stdout !== upstreamManifest.source.commit,
    runtime: {
      image: upstreamManifest.runtimeImage,
      patchLevel: upstreamManifest.runtimePatchLevel,
    },
    patchResults,
    patchSeriesMatchesManifest,
    seriesAppliesExactly:
      seriesDiff.ok && patchResults.every((result) => result.appliesExactly),
    seriesDiagnostic: seriesDiff.ok
      ? null
      : seriesDiff.stderr || seriesDiff.stdout,
    candidateReadyForBuild:
      patchSeriesMatchesManifest &&
      seriesDiff.ok &&
      patchResults.every((result) => result.appliesExactly),
    nextGate:
      "Build the candidate, run required C++ tests, browser native-operation probes, corpus render/round-trip comparisons, save/reopen validation, and only then update upstream.json.",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.candidateReadyForBuild) process.exitCode = 2;
} finally {
  if (seriesRoot) rmSync(seriesRoot, { recursive: true, force: true });
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
