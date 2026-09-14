import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createProbe } from "../services/office-session-spike/host.mjs";
import { buildConformancePlan } from "./native-mutation-conformance.mjs";

const DEFAULT_CAPABILITIES = "contracts/native-edit-capabilities.json";
const DEFAULT_CONFORMANCE = "contracts/native-mutation-conformance.json";
const DOCUMENT_TOOL_PROJECT =
  "services/document-worker/tools/Spellbook.Document.Tool/Spellbook.Document.Tool.csproj";
const DOCUMENT_TOOL_DLL =
  "services/document-worker/tools/Spellbook.Document.Tool/bin/Release/net10.0/Spellbook.Document.Tool.dll";
const SAVE_TIMEOUT_MS = 30_000;
const PROCESS_TIMEOUT_MS = 180_000;
export const CONTAINER_REACHABLE_PROBE_BIND_ADDRESS = "0.0.0.0";

const sortedUnique = (values) => [...new Set(values)].sort();

export function dotnetHostCommand(environment = process.env) {
  return environment.DOTNET_HOST_PATH?.trim() || "dotnet";
}

export function localProbeBrowserOrigin(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("The local probe port is invalid.");
  // createProbe advertises this exact origin through WOPI PostMessageOrigin.
  // Binding the server to 127.0.0.1 still keeps the probe loopback-only.
  return `http://localhost:${port}`;
}

export function operationsFromReport(report) {
  const commands = Array.isArray(report?.commands)
    ? report.commands.map((command) =>
        typeof command === "string" ? command : command?.op,
      )
    : [];
  return sortedUnique(
    [...commands, report?.operation].filter(
      (operation) => typeof operation === "string" && operation,
    ),
  );
}

export function persistenceStateFromProbeOutput(output) {
  let state;
  try {
    state = JSON.parse(output);
  } catch (error) {
    throw new Error("The baseline persistence probe returned invalid JSON.", {
      cause: error,
    });
  }
  if (!Array.isArray(state?.slides) || !Array.isArray(state?.masters))
    throw new Error(
      "The baseline persistence probe returned no slide/master state.",
    );
  return { slides: state.slides, masters: state.masters };
}

export function isTransientEditorConnectionFailure(error) {
  return String(error?.message ?? error).includes(
    "Native editor extension did not connect.",
  );
}

export function buildScenarioExecutionPlan(
  capabilities,
  conformance,
  conformancePlan,
) {
  const selectedFamilies = new Set(Object.keys(conformancePlan.families));
  const eligibleOperations = Object.entries(
    capabilities.mutationModel.operations,
  )
    .filter(
      ([, operation]) =>
        operation.availability !== "format_excluded" &&
        operation.minEnginePatch <= conformancePlan.enginePatchLevel,
    )
    .map(([name, operation]) => [name, operation]);

  return Object.entries(conformancePlan.scenarios).map(([name, scenario]) => {
    const routedFamilies = Object.entries(capabilities.mutationModel.families)
      .filter(([, family]) =>
        conformance.fixtures[family.fixture].scenarios.includes(name),
      )
      .map(([familyName]) => familyName);
    const allowedOperations = eligibleOperations
      .filter(([, operation]) => routedFamilies.includes(operation.family))
      .map(([operation]) => operation)
      .sort();
    const selectedOperations = eligibleOperations
      .filter(
        ([, operation]) =>
          selectedFamilies.has(operation.family) &&
          routedFamilies.includes(operation.family),
      )
      .map(([operation]) => operation)
      .sort();
    if (!scenario.source)
      throw new Error(`Scenario ${name} has no source PPTX.`);
    if (!allowedOperations.length || !selectedOperations.length)
      throw new Error(
        `Scenario ${name} is not routed to a selected mutation family.`,
      );
    return {
      name,
      expectedPatchLevel:
        conformancePlan.enginePatchLevel === 0
          ? "stock"
          : `undo-v${conformancePlan.enginePatchLevel}`,
      source: scenario.source,
      sourceSha256: scenario.sourceSha256,
      targetSlideIndexes: scenario.targetSlideIndexes ?? null,
      apply: scenario.apply,
      reopen: scenario.reopen,
      proves: scenario.proves,
      routedFamilies: routedFamilies.sort(),
      selectedOperations,
      allowedOperations,
    };
  });
}

export function buildChangeBudget(
  capabilities,
  operations,
  targetSlideIndexes,
) {
  if (!operations.length)
    throw new Error("A mutation scenario reported no executed operations.");
  const unknown = operations.filter(
    (operation) => !capabilities.mutationModel.operations[operation],
  );
  if (unknown.length)
    throw new Error(
      `Mutation report contains unknown operations: ${unknown.join(", ")}`,
    );
  const families = sortedUnique(
    operations.map(
      (operation) => capabilities.mutationModel.operations[operation].family,
    ),
  );
  const allowedCategories = sortedUnique(
    families.flatMap(
      (family) => capabilities.mutationModel.families[family].changeBudget,
    ),
  );
  const allowPartCreationOrDeletion =
    families.some(
      (family) =>
        capabilities.mutationModel.families[family]
          .allowPartCreationOrDeletion === true,
    ) ||
    operations.some((operation) =>
      ["create", "delete"].includes(
        capabilities.mutationModel.operations[operation].identityEffect,
      ),
    );
  return {
    contractVersion: "1.0",
    allowedCategories,
    targetSlideIndexes,
    allowedExactParts: null,
    allowPartCreationOrDeletion,
  };
}

function processError(command, args, code, stdout, stderr) {
  const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  return new Error(
    `${command} ${args.join(" ")} exited with ${code}.${detail ? `\n${detail}` : ""}`,
  );
}

async function runProcess(command, args, { cwd, env, timeoutMs, logPath }) {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  let forceKillTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  }, timeoutMs);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(forceKillTimer);
  });
  const result = {
    command,
    args,
    exitCode: code,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr,
  };
  if (logPath)
    await fs.writeFile(
      logPath,
      `${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`,
    );
  if (timedOut)
    throw new Error(
      `${command} ${args.join(" ")} timed out after ${timeoutMs}ms.`,
    );
  if (code !== 0) throw processError(command, args, code, stdout, stderr);
  return result;
}

async function closeServer(server) {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitForSavedFile(probe, output) {
  const deadline = Date.now() + SAVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const version = probe.receipt().version;
    if (version > 0) return path.join(output, `saved-${version}.pptx`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `The editor did not PUT a saved PPTX within ${SAVE_TIMEOUT_MS}ms.`,
  );
}

export async function runHostedProbe({
  root,
  source,
  output,
  editorOrigin,
  fileId,
  script,
  args = [],
  env = {},
  expectSave,
  logPath,
}) {
  const probe = await createProbe({
    source,
    output,
    editorOrigin,
    port: 0,
    native: true,
    nativeProbe: true,
    fileId,
  });
  await new Promise((resolve, reject) => {
    probe.server.once("error", reject);
    // The browser reaches this probe through localhost, while Collabora runs
    // in a separate container and reaches the same ephemeral server through
    // host.docker.internal. Binding only loopback works in Docker Desktop but
    // is unreachable from a native Linux bridge. createProbe still enforces
    // an exact Host allowlist and a random one-hour bearer token.
    probe.server.listen(0, CONTAINER_REACHABLE_PROBE_BIND_ADDRESS, resolve);
  });
  const url = localProbeBrowserOrigin(probe.server.address().port);
  try {
    const processResult = await runProcess(
      process.execPath,
      [path.resolve(root, script), url, ...args],
      {
        cwd: root,
        env,
        timeoutMs: PROCESS_TIMEOUT_MS,
        logPath,
      },
    );
    const savedPath = expectSave ? await waitForSavedFile(probe, output) : null;
    return {
      process: {
        command: processResult.command,
        args: processResult.args,
        exitCode: processResult.exitCode,
        durationMs: processResult.durationMs,
      },
      receipt: probe.receipt(),
      savedPath,
      stdout: processResult.stdout,
    };
  } finally {
    await closeServer(probe.server);
  }
}

async function runReadOnlyProbeWithRetry(options) {
  try {
    return await runHostedProbe(options);
  } catch (error) {
    if (!isTransientEditorConnectionFailure(error)) throw error;
    const retryLogPath = options.logPath?.endsWith(".log")
      ? `${options.logPath.slice(0, -4)}.retry.log`
      : `${options.logPath ?? "probe"}.retry.log`;
    return runHostedProbe({
      ...options,
      output: `${options.output}-retry`,
      fileId: `${options.fileId}-retry`,
      logPath: retryLogPath,
    });
  }
}

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function ensureNewDirectory(directory) {
  try {
    await fs.access(directory);
  } catch {
    await fs.mkdir(directory, { recursive: true });
    return;
  }
  throw new Error(
    `Refusing to overwrite an existing conformance run: ${directory}`,
  );
}

async function ensureEditor(editorOrigin) {
  const response = await fetch(`${editorOrigin}/hosting/discovery`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    throw new Error(`Editor discovery failed with HTTP ${response.status}.`);
  const discovery = await response.text();
  if (!discovery.includes('ext="pptx"'))
    throw new Error("The editor does not advertise PPTX support.");
}

function visualEnvironment(name, scenarioDirectory, phase) {
  if (phase === "reopen")
    return {
      SPELLBOOK_PROBE_REOPEN_SCREENSHOT: path.join(
        scenarioDirectory,
        "reopen.png",
      ),
    };
  if (name === "general-native-surface" || name === "table-structure")
    return {
      SPELLBOOK_PROBE_SCREENSHOT_DIR: path.join(
        scenarioDirectory,
        "apply-screenshots",
      ),
    };
  return {
    SPELLBOOK_PROBE_SCREENSHOT: path.join(scenarioDirectory, "apply.png"),
  };
}

async function runScenario({
  root,
  outputRoot,
  editorOrigin,
  capabilities,
  scenario,
  documentToolDll,
}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const scenarioDirectory = path.join(outputRoot, scenario.name);
  await fs.mkdir(scenarioDirectory);
  const source = path.resolve(root, scenario.source);
  const sourceSha256 = await sha256(source);
  if (sourceSha256 !== scenario.sourceSha256)
    throw new Error(
      `Scenario ${scenario.name} source changed: expected ${scenario.sourceSha256}, got ${sourceSha256}.`,
    );
  const reportPath = path.join(scenarioDirectory, "mutation-report.json");

  const baseline = await runReadOnlyProbeWithRetry({
    root,
    source,
    output: path.join(scenarioDirectory, "baseline-session"),
    editorOrigin,
    fileId: `${scenario.name}-baseline`,
    script: "services/office-session-spike/probe-native-save-noop.mjs",
    expectSave: true,
    logPath: path.join(scenarioDirectory, "baseline.log"),
  });
  const mutated = await runHostedProbe({
    root,
    source,
    output: path.join(scenarioDirectory, "mutation-session"),
    editorOrigin,
    fileId: `${scenario.name}-mutated`,
    script: scenario.apply.script,
    args: [reportPath, ...(scenario.apply.args ?? [])],
    env: {
      ...(scenario.apply.env ?? {}),
      SPELLBOOK_PROBE_EXPECTED_PATCH_LEVEL: scenario.expectedPatchLevel,
      SPELLBOOK_PROBE_EXPECTED_OPERATIONS: JSON.stringify(
        scenario.allowedOperations,
      ),
      ...visualEnvironment(scenario.name, scenarioDirectory, "apply"),
    },
    expectSave: true,
    logPath: path.join(scenarioDirectory, "mutation.log"),
  });
  // Let the baseline COOL session leave memory while the independent mutation
  // runs. Reopening the just-saved baseline immediately can otherwise attach
  // to the closing in-memory document instead of reading the persisted bytes.
  const baselineReopened = await runReadOnlyProbeWithRetry({
    root,
    source: baseline.savedPath,
    output: path.join(scenarioDirectory, "baseline-reopen-session"),
    editorOrigin,
    fileId: `${scenario.name}-baseline-reopen`,
    script: "services/office-session-spike/probe-uno-read.mjs",
    expectSave: false,
    logPath: path.join(scenarioDirectory, "baseline-reopen.log"),
  });
  const persistenceBaseline = persistenceStateFromProbeOutput(
    baselineReopened.stdout,
  );
  const mutationReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
  mutationReport.persistenceBaseline = persistenceBaseline;
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(mutationReport, null, 2)}\n`,
  );
  const operations = operationsFromReport(mutationReport);
  const disallowed = operations.filter(
    (operation) => !scenario.allowedOperations.includes(operation),
  );
  if (disallowed.length)
    throw new Error(
      `Scenario ${scenario.name} executed operations outside its routed families: ${disallowed.join(", ")}.`,
    );
  const missingSelected = scenario.selectedOperations.filter(
    (operation) => !operations.includes(operation),
  );

  const reopened = await runReadOnlyProbeWithRetry({
    root,
    source: mutated.savedPath,
    output: path.join(scenarioDirectory, "reopen-session"),
    editorOrigin,
    fileId: `${scenario.name}-reopen`,
    script: scenario.reopen.script,
    args: [reportPath, ...(scenario.reopen.args ?? [])],
    env: {
      ...(scenario.reopen.env ?? {}),
      SPELLBOOK_PROBE_EXPECTED_PATCH_LEVEL: scenario.expectedPatchLevel,
      ...visualEnvironment(scenario.name, scenarioDirectory, "reopen"),
    },
    expectSave: false,
    logPath: path.join(scenarioDirectory, "reopen.log"),
  });

  const budget = buildChangeBudget(
    capabilities,
    operations,
    scenario.targetSlideIndexes,
  );
  const budgetPath = path.join(scenarioDirectory, "change-budget.json");
  await fs.writeFile(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
  const validation = await runProcess(
    dotnetHostCommand(),
    [
      documentToolDll,
      "validate-change-budget",
      baseline.savedPath,
      mutated.savedPath,
      budgetPath,
    ],
    {
      cwd: root,
      timeoutMs: PROCESS_TIMEOUT_MS,
      logPath: path.join(scenarioDirectory, "change-budget.log"),
    },
  );
  const changeBudgetReport = JSON.parse(validation.stdout);

  return {
    scenario: scenario.name,
    status: "passed",
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    source: {
      path: path.relative(root, source),
      sha256: sourceSha256,
    },
    baseline: {
      path: path.relative(outputRoot, baseline.savedPath),
      sha256: await sha256(baseline.savedPath),
      receipt: baseline.receipt,
      reopenReceipt: baselineReopened.receipt,
    },
    candidate: {
      path: path.relative(outputRoot, mutated.savedPath),
      sha256: await sha256(mutated.savedPath),
      receipt: mutated.receipt,
    },
    reopen: { verified: true, receipt: reopened.receipt },
    operations,
    selectedOperations: scenario.selectedOperations,
    missingSelectedOperations: missingSelected,
    routedFamilies: scenario.routedFamilies,
    gates: sortedUnique([...scenario.proves, "change_budget"]),
    changeBudget: changeBudgetReport,
  };
}

export async function runConformance(options = {}) {
  const root = path.resolve(options.root ?? ".");
  const capabilities = JSON.parse(
    await fs.readFile(
      path.resolve(root, options.capabilitiesPath ?? DEFAULT_CAPABILITIES),
      "utf8",
    ),
  );
  const conformance = JSON.parse(
    await fs.readFile(
      path.resolve(root, options.conformancePath ?? DEFAULT_CONFORMANCE),
      "utf8",
    ),
  );
  const plan = buildConformancePlan(capabilities, conformance, {
    enginePatchLevel: options.enginePatchLevel,
    families: options.families,
  });
  if (!plan.summary.complete)
    throw new Error(
      `Conformance definition has ${plan.summary.missingGates} uncovered gates.`,
    );
  const scenarios = buildScenarioExecutionPlan(capabilities, conformance, plan);
  const outputRoot = path.resolve(
    root,
    options.outputPath ??
      `.tmp-runtime-validation/native-conformance-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`,
  );
  await ensureNewDirectory(outputRoot);
  const editorOrigin = options.editorOrigin ?? "http://localhost:9980";
  await ensureEditor(editorOrigin);
  const editorAssetsBuild = await runProcess(
    process.execPath,
    ["services/office-editor/build.mjs"],
    {
      cwd: root,
      timeoutMs: PROCESS_TIMEOUT_MS,
      logPath: path.join(outputRoot, "editor-assets-build.log"),
    },
  );
  const documentToolBuild = await runProcess(
    dotnetHostCommand(),
    ["build", DOCUMENT_TOOL_PROJECT, "--configuration", "Release", "--nologo"],
    {
      cwd: root,
      timeoutMs: PROCESS_TIMEOUT_MS,
      logPath: path.join(outputRoot, "document-tool-build.log"),
    },
  );
  const report = {
    contractVersion: conformance.version,
    mutationContractVersion: capabilities.mutationModel.version,
    enginePatchLevel: plan.enginePatchLevel,
    editorOrigin,
    output: path.relative(root, outputRoot),
    startedAt: new Date().toISOString(),
    definitionCoverage: plan.summary,
    build: {
      editorAssets: {
        exitCode: editorAssetsBuild.exitCode,
        durationMs: editorAssetsBuild.durationMs,
      },
      documentTool: {
        exitCode: documentToolBuild.exitCode,
        durationMs: documentToolBuild.durationMs,
      },
    },
    scenarios: [],
    status: "running",
  };
  const reportPath = path.join(outputRoot, "conformance-report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    for (const scenario of scenarios) {
      const evidence = await runScenario({
        root,
        outputRoot,
        editorOrigin,
        capabilities,
        scenario,
        documentToolDll: path.resolve(root, DOCUMENT_TOOL_DLL),
      });
      report.scenarios.push(evidence);
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    const executedOperations = sortedUnique(
      report.scenarios.flatMap((scenario) => scenario.operations),
    );
    const selectedOperations = sortedUnique(
      Object.values(plan.families).flatMap((family) => family.operations),
    );
    const missingOperations = selectedOperations.filter(
      (operation) => !executedOperations.includes(operation),
    );
    const nativeTests = Object.keys(plan.nativeTests).map((name) => ({
      name,
      status: "not_run_by_browser_runner",
    }));
    const visualReviewFamilies = Object.entries(plan.families)
      .filter(([, family]) => family.requiredGates.includes("visual"))
      .map(([family]) => family);
    report.completedAt = new Date().toISOString();
    report.executedOperations = executedOperations;
    report.selectedOperations = selectedOperations;
    report.missingOperations = missingOperations;
    report.nativeTests = nativeTests;
    report.releaseEvidence = {
      browserRuntimePassed: missingOperations.length === 0,
      nativeTestsPassed: false,
      visualReviewPassed: false,
      pendingVisualReviewFamilies: visualReviewFamilies,
    };
    report.status = missingOperations.length
      ? "failed"
      : "browser_runtime_passed";
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (missingOperations.length)
      throw new Error(
        `Browser scenarios did not execute selected operations: ${missingOperations.join(", ")}.`,
      );
    return { report, reportPath };
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  }
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--capabilities") parsed.capabilitiesPath = argv[++index];
    else if (value === "--conformance") parsed.conformancePath = argv[++index];
    else if (value === "--output") parsed.outputPath = argv[++index];
    else if (value === "--editor-origin") parsed.editorOrigin = argv[++index];
    else if (value === "--engine-patch-level")
      parsed.enginePatchLevel = Number(argv[++index]);
    else if (value === "--families")
      parsed.families = argv[++index].split(",").filter(Boolean);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await runConformance(parseArguments(process.argv.slice(2)));
    process.stdout.write(
      `${JSON.stringify({ status: result.report.status, operations: result.report.executedOperations.length, report: result.reportPath }, null, 2)}\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
