#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import { generateRuntimeMutationContract } from "../services/office-editor/mutation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256Pattern = /^[0-9a-f]{64}$/u;

export function promoteNativeRuntimeEvidence({
  capabilities,
  matrix,
  upstream,
  browserReport,
  validation,
  version,
  browserReportSha256,
  validationSha256,
}) {
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? ""))
    throw new Error("A semantic contract version is required.");
  for (const [name, value] of Object.entries({
    browserReportSha256,
    validationSha256,
  }))
    if (!sha256Pattern.test(value ?? "")) throw new Error(`Invalid ${name}.`);

  const operations = capabilities?.mutationModel?.operations ?? {};
  const expectedOperations = Object.entries(operations)
    .filter(([, operation]) => operation.availability !== "format_excluded")
    .map(([operation]) => operation);
  const selected = [...new Set(browserReport?.selectedOperations ?? [])];
  const executed = [...new Set(browserReport?.executedOperations ?? [])];
  const expectedSorted = [...expectedOperations].sort();
  if (
    browserReport?.status !== "browser_runtime_passed" ||
    JSON.stringify(selected.sort()) !== JSON.stringify(expectedSorted) ||
    JSON.stringify(executed.sort()) !== JSON.stringify(expectedSorted) ||
    (browserReport?.missingOperations ?? []).length !== 0 ||
    !Array.isArray(browserReport?.scenarios) ||
    browserReport.scenarios.length === 0 ||
    browserReport.scenarios.some(
      (scenario) =>
        scenario.status !== "passed" ||
        scenario.reopen?.verified !== true ||
        scenario.changeBudget?.valid !== true,
    )
  )
    throw new Error(
      "Browser report does not prove the complete operation set.",
    );

  const browserGate = validation?.gates?.browser;
  if (
    validation?.kind !== "spellbook-office-runtime-validation" ||
    validation?.gates?.native?.status !== "passed" ||
    !["agent_reviewed", "human_passed"].includes(
      validation?.gates?.visual?.status,
    ) ||
    validation?.gates?.powerPoint?.status !== "passed" ||
    browserGate?.status !== "passed" ||
    browserGate?.operationCount !== expectedOperations.length ||
    browserGate?.scenarioCount !== browserReport.scenarios.length ||
    browserGate?.sourceSha256 !== sha256Json(browserReport) ||
    validation?.release?.patchLevel !== upstream.patchLevel ||
    validation?.release?.patchSeriesSha256 !== upstream.patchSeriesSha256 ||
    validation?.release?.collaboraSourceCommit !== upstream.source?.commit
  )
    throw new Error("Runtime validation does not bind every required gate.");

  const nextCapabilities = structuredClone(capabilities);
  nextCapabilities.version = version;
  nextCapabilities.verifiedWith = {
    date: validation.createdAt.slice(0, 10),
    probe: `scripts/native-mutation-conformance-runner.mjs (${upstream.patchLevel}: complete browser operation set, native Undo/Redo, save/reopen, change budget, visual, playback and PowerPoint evidence)`,
    evidence: {
      patchLevel: upstream.patchLevel,
      operationCount: expectedOperations.length,
      scenarioCount: browserReport.scenarios.length,
      browserReportSha256,
      validationSha256,
    },
  };
  for (const operation of expectedOperations)
    nextCapabilities.mutationModel.operations[operation].availability =
      "runtime_verified";
  const stockEngineOperations = [
    ...new Set([
      ...(nextCapabilities.knownUnsafeOperations ?? []).map(({ op }) => op),
      ...(nextCapabilities.stockEngineLimitations ?? []).map(({ op }) => op),
    ]),
  ];
  nextCapabilities.stockEngineLimitations = stockEngineOperations.map((op) => ({
    op,
    minimumVerifiedPatch:
      nextCapabilities.mutationModel.operations[op]?.minEnginePatch ?? 0,
    reason:
      "This operation is verified only on the declared patched engine; the stock engine does not satisfy its native Undo or OOXML round-trip contract.",
  }));
  delete nextCapabilities.knownUnsafeOperations;
  nextCapabilities.candidateOperations = [];
  nextCapabilities.knownUnsafeTransactions = (
    nextCapabilities.knownUnsafeTransactions ?? []
  ).map((transaction) =>
    transaction.kind === "multi_command_slide_structure"
      ? {
          ...transaction,
          state: "runtime_verified_on_patched_engine",
          reason:
            "The stock engine can rename objects during page moves. The declared patched engine preserves identity and passed multi-command Undo, save/reopen and change-budget conformance; lower patch levels remain rejected.",
        }
      : transaction,
  );

  const nextMatrix = structuredClone(matrix);
  nextMatrix.reviewedAt = validation.createdAt.slice(0, 10);
  nextMatrix.operationCoverage.runtimeVerified = expectedOperations;
  nextMatrix.operationCoverage.enginePatchReady = [];
  nextMatrix.operationCoverage.runtimeValidationRequired = [];
  nextMatrix.operationCoverage.runtimeVerifiedTransactions = [
    "multi_command_slide_structure",
  ];
  nextMatrix.operationCoverage.enginePatchReadyTransactions = [];
  return { capabilities: nextCapabilities, matrix: nextMatrix };
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function writeFormattedJson(file, value) {
  fs.writeFileSync(
    file,
    await format(JSON.stringify(value), {
      filepath: file,
    }),
  );
}

async function run(args) {
  const browserReportPath = path.resolve(
    argument(args, "--browser-report") ?? "",
  );
  const validationPath = path.resolve(argument(args, "--validation") ?? "");
  const version = argument(args, "--version");
  if (!argument(args, "--browser-report") || !argument(args, "--validation"))
    throw new Error(
      "Usage: promote-native-runtime-evidence --browser-report <report.json> --validation <validation.json> --version <semver>",
    );
  const capabilitiesPath = path.join(
    root,
    "contracts/native-edit-capabilities.json",
  );
  const matrixPath = path.join(
    root,
    "contracts/impress-ai-capability-matrix.json",
  );
  const promoted = promoteNativeRuntimeEvidence({
    capabilities: readJson(capabilitiesPath),
    matrix: readJson(matrixPath),
    upstream: readJson(
      path.join(root, "services/office-editor/libreoffice/upstream.json"),
    ),
    browserReport: readJson(browserReportPath),
    validation: readJson(validationPath),
    version,
    browserReportSha256: sha256File(browserReportPath),
    validationSha256: sha256File(validationPath),
  });
  await writeFormattedJson(capabilitiesPath, promoted.capabilities);
  await writeFormattedJson(matrixPath, promoted.matrix);
  generateRuntimeMutationContract(capabilitiesPath);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
