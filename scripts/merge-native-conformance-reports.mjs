import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildConformancePlan } from "./native-mutation-conformance.mjs";
import {
  assertObservedEngineIdentity,
  loadOfficeRuntimeRelease,
  verifyRunningRuntimeContainer,
} from "./office-runtime-identity.mjs";

const DEFAULT_CAPABILITIES = "contracts/native-edit-capabilities.json";
const DEFAULT_CONFORMANCE = "contracts/native-mutation-conformance.json";

const sortedUnique = (values) => [...new Set(values)].sort();

export function mergeConformanceEvidence({
  releaseEvidence,
  containerVerification,
  reports,
  capabilities,
  conformance,
}) {
  if (!Array.isArray(reports) || reports.length === 0)
    throw new Error("conformance_reports_required");
  const release = releaseEvidence.release;
  const patchLevel = Number(release.runtime.patchLevel.replace(/^undo-v/u, ""));
  const plan = buildConformancePlan(capabilities, conformance, {
    enginePatchLevel: patchLevel,
  });
  if (!plan.summary.complete)
    throw new Error("conformance_definition_incomplete");

  const expectedScenarios = Object.keys(plan.scenarios).sort();
  const scenarios = new Map();
  for (const source of reports) {
    const report = source.report;
    if (report?.enginePatchLevel !== patchLevel)
      throw new Error("conformance_patch_level_mismatch");
    for (const scenario of report?.scenarios ?? []) {
      if (!expectedScenarios.includes(scenario.scenario))
        throw new Error(`unexpected_conformance_scenario:${scenario.scenario}`);
      if (scenarios.has(scenario.scenario))
        throw new Error(`duplicate_conformance_scenario:${scenario.scenario}`);
      if (
        scenario.status !== "passed" ||
        scenario.reopen?.verified !== true ||
        scenario.changeBudget?.valid !== true
      )
        throw new Error(`conformance_scenario_failed:${scenario.scenario}`);
      assertObservedEngineIdentity(scenario.engineIdentity, release);
      scenarios.set(scenario.scenario, scenario);
    }
  }

  const missingScenarios = expectedScenarios.filter(
    (scenario) => !scenarios.has(scenario),
  );
  if (missingScenarios.length)
    throw new Error(
      `missing_conformance_scenarios:${missingScenarios.join(",")}`,
    );

  const selectedOperations = sortedUnique(
    Object.values(plan.families).flatMap((family) => family.operations),
  );
  const orderedScenarios = Object.keys(plan.scenarios).map((name) =>
    scenarios.get(name),
  );
  const executedOperations = sortedUnique(
    orderedScenarios.flatMap((scenario) => scenario.operations),
  );
  const missingOperations = selectedOperations.filter(
    (operation) => !executedOperations.includes(operation),
  );
  const unexpectedOperations = executedOperations.filter(
    (operation) => !selectedOperations.includes(operation),
  );
  if (missingOperations.length || unexpectedOperations.length)
    throw new Error(
      `conformance_operation_mismatch:missing=${missingOperations.join(",") || "none"};unexpected=${unexpectedOperations.join(",") || "none"}`,
    );

  return {
    contractVersion: conformance.version,
    mutationContractVersion: capabilities.mutationModel.version,
    enginePatchLevel: patchLevel,
    runtime: {
      releaseSha256: releaseEvidence.sha256,
      publicCommit: release.publicSource.commit,
      runtimeImage: release.runtime.image,
      engineImage: release.runtime.engineImage,
      patchLevel: release.runtime.patchLevel,
      patchSeriesSha256: release.runtime.patchSeriesSha256,
      collaboraSourceCommit: release.runtime.collaboraSourceCommit,
      container: containerVerification,
    },
    createdAt: new Date().toISOString(),
    definitionCoverage: plan.summary,
    sourceReports: reports.map((source) => ({
      path: source.path,
      sha256: source.sha256,
      status: source.report.status,
      scenarioCount: source.report.scenarios?.length ?? 0,
    })),
    scenarios: orderedScenarios,
    selectedOperations,
    executedOperations,
    missingOperations: [],
    nativeTests: Object.keys(plan.nativeTests).map((name) => ({
      name,
      status: "not_run_by_browser_runner",
    })),
    releaseEvidence: {
      browserRuntimePassed: true,
      nativeTestsPassed: false,
      visualReviewPassed: false,
      pendingVisualReviewFamilies: Object.entries(plan.families)
        .filter(([, family]) => family.requiredGates.includes("visual"))
        .map(([family]) => family),
    },
    status: "browser_runtime_passed",
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArguments(argv) {
  const parsed = { reports: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--report") parsed.reports.push(argv[++index]);
    else if (value === "--release") parsed.release = argv[++index];
    else if (value === "--runtime-container")
      parsed.runtimeContainer = argv[++index];
    else if (value === "--capabilities") parsed.capabilities = argv[++index];
    else if (value === "--conformance") parsed.conformance = argv[++index];
    else if (value === "--output") parsed.output = argv[++index];
    else throw new Error(`unknown_argument:${value}`);
  }
  for (const name of ["release", "runtimeContainer", "output"])
    if (!parsed[name]) throw new Error(`missing_argument:${name}`);
  if (!parsed.reports.length) throw new Error("missing_argument:report");
  return parsed;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const releasePath = path.resolve(args.release);
  const releaseEvidence = loadOfficeRuntimeRelease(releasePath);
  const reports = args.reports.map((file) => {
    const absolute = path.resolve(file);
    return {
      path: path.relative(process.cwd(), absolute),
      sha256: sha256File(absolute),
      report: readJson(absolute),
    };
  });
  const merged = mergeConformanceEvidence({
    releaseEvidence,
    containerVerification: verifyRunningRuntimeContainer(
      releaseEvidence.release,
      args.runtimeContainer,
    ),
    reports,
    capabilities: readJson(
      path.resolve(args.capabilities ?? DEFAULT_CAPABILITIES),
    ),
    conformance: readJson(
      path.resolve(args.conformance ?? DEFAULT_CONFORMANCE),
    ),
  });
  fs.writeFileSync(
    path.resolve(args.output),
    `${JSON.stringify(merged, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o644,
    },
  );
  process.stdout.write(
    `${JSON.stringify({ status: merged.status, operations: merged.executedOperations.length, scenarios: merged.scenarios.length }, null, 2)}\n`,
  );
}
