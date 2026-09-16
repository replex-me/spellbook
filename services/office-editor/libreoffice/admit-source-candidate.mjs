import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computePatchSeriesSha256 } from "./upstream.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = path.join(directory, "upstream.json");

export function buildSourceCandidateAdmission({
  manifest,
  nativeDirectory,
  nativeArchivePath,
  buildResultPath,
  engineImageDigest,
  spellbookSourceRevision,
  completedAt = new Date().toISOString(),
  patchSeriesSha256 = computePatchSeriesSha256(),
}) {
  if (manifest?.sourceCandidateReady === true)
    throw new Error("source_candidate_already_admitted");
  if (patchSeriesSha256 !== manifest?.patchSeriesSha256)
    throw new Error("source_candidate_patch_series_mismatch");
  if (!/^sha256:[0-9a-f]{64}$/u.test(engineImageDigest ?? ""))
    throw new Error("source_candidate_engine_digest_invalid");
  if (!/^[0-9a-f]{40}$/u.test(spellbookSourceRevision ?? ""))
    throw new Error("source_candidate_spellbook_revision_invalid");
  if (!Number.isFinite(Date.parse(completedAt)))
    throw new Error("source_candidate_completion_time_invalid");

  const buildResult = fs.readFileSync(buildResultPath, "utf8").trim();
  if (buildResult !== "0")
    throw new Error(`source_candidate_build_failed:${buildResult || "empty"}`);

  const requiredCppunitStatuses = Object.fromEntries(
    manifest.requiredCppunitTargets.map((target) => {
      if (!/^[A-Za-z0-9_]+$/u.test(target))
        throw new Error(`source_candidate_target_invalid:${target}`);
      const statusPath = path.join(nativeDirectory, `${target}.status`);
      const logPath = path.join(nativeDirectory, `${target}.log`);
      const status = fs.readFileSync(statusPath, "utf8").trim();
      const log = fs.readFileSync(logPath, "utf8");
      if (status !== "0")
        throw new Error(`source_candidate_target_failed:${target}`);
      if (!log.includes(target))
        throw new Error(`source_candidate_target_log_mismatch:${target}`);
      return [target, 0];
    }),
  );

  const commandReportPath = path.join(
    nativeDirectory,
    "impress-command-surface.json",
  );
  const commandReport = JSON.parse(fs.readFileSync(commandReportPath, "utf8"));
  if (
    commandReport?.source?.ref !== manifest.source.ref ||
    commandReport?.source?.commit !== manifest.source.commit ||
    commandReport?.inventory?.count !== manifest.impressUiUnoCommandCount ||
    commandReport?.inventory?.sha256 !== manifest.impressUiUnoCommandsSha256 ||
    commandReport?.inventory?.exact !== true ||
    commandReport?.semanticRouting?.complete !== true ||
    commandReport?.semanticRouting?.unmappedCommands?.length !== 0 ||
    commandReport?.semanticRouting?.unknownSemanticFamilies?.length !== 0 ||
    commandReport?.semanticRouting?.contractMismatches?.length !== 0
  )
    throw new Error("source_candidate_command_surface_mismatch");
  verifyNativeArchive(nativeArchivePath, nativeDirectory, [
    ...manifest.requiredCppunitTargets.flatMap((target) => [
      `${target}.status`,
      `${target}.log`,
    ]),
    "impress-command-surface.json",
  ]);

  return {
    ...manifest,
    sourceCandidateReady: true,
    sourceCandidateEvidence: {
      completedAt,
      spellbookSourceRevision,
      patchSeriesSha256,
      engineImageDigest,
      nativeEvidenceSha256: sha256File(nativeArchivePath),
      buildResultSha256: sha256File(buildResultPath),
      impressCommandReportSha256: sha256File(commandReportPath),
      requiredCppunitStatuses,
      impressCommandSurface: {
        count: commandReport.inventory.count,
        sha256: commandReport.inventory.sha256,
        exact: true,
      },
    },
  };
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifyNativeArchive(archivePath, nativeDirectory, requiredFiles) {
  const entries = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
  })
    .split("\n")
    .map((entry) => entry.replace(/^\.\//u, ""))
    .filter(Boolean);
  for (const name of requiredFiles) {
    if (entries.filter((entry) => entry === name).length !== 1)
      throw new Error(`source_candidate_archive_entry_mismatch:${name}`);
    const archiveBytes = execFileSync("tar", [
      "-xOzf",
      archivePath,
      `./${name}`,
    ]);
    const extractedBytes = fs.readFileSync(path.join(nativeDirectory, name));
    if (!archiveBytes.equals(extractedBytes))
      throw new Error(`source_candidate_archive_content_mismatch:${name}`);
  }
}

function argument(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name}_requires_value`);
  return value;
}

function requiredArgument(args, name) {
  const value = argument(args, name);
  if (!value) throw new Error(`missing_argument:${name}`);
  return value;
}

function writeJsonAtomically(output, value) {
  const resolved = path.resolve(output);
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  fs.renameSync(temporary, resolved);
}

async function main(args) {
  const manifestPath = path.resolve(
    argument(args, "--manifest", defaultManifestPath),
  );
  const output = path.resolve(requiredArgument(args, "--output"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const admitted = buildSourceCandidateAdmission({
    manifest,
    nativeDirectory: path.resolve(requiredArgument(args, "--native-directory")),
    nativeArchivePath: path.resolve(requiredArgument(args, "--native-archive")),
    buildResultPath: path.resolve(requiredArgument(args, "--build-result")),
    engineImageDigest: requiredArgument(args, "--engine-image-digest"),
    spellbookSourceRevision: requiredArgument(
      args,
      "--spellbook-source-revision",
    ),
  });
  writeJsonAtomically(output, admitted);
  process.stdout.write(
    `${JSON.stringify(admitted.sourceCandidateEvidence, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
