import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const digestPattern = /@sha256:[0-9a-f]{64}$/u;

export function buildOfficeRuntimeValidation({
  releasePath,
  nativeDirectory,
  browserReportPath,
  visualReviewPath,
  powerPointEvidencePath,
}) {
  const release = readJson(releasePath);
  requireReleaseIdentity(release);

  const nativeTargets = release.nativeVerification.requiredCppunitTargets.map(
    (target) => verifyNativeTarget(nativeDirectory, target),
  );
  const browserReport = readJson(browserReportPath);
  const expectedPatchLevel = Number(
    release.runtime.patchLevel.replace(/^undo-v/u, ""),
  );
  const browser = verifyBrowserReport(browserReport, expectedPatchLevel);
  const visualReview = verifyVisualReview(
    readJson(visualReviewPath),
    browser.scenarios,
  );
  const powerPoint = powerPointEvidencePath
    ? verifyPowerPointEvidence(readJson(powerPointEvidencePath))
    : { status: "pending", reason: "powerpoint_evidence_not_supplied" };
  const releaseVerified =
    visualReview.status === "human_passed" && powerPoint.status === "passed";

  return {
    schemaVersion: 1,
    kind: "spellbook-office-runtime-validation",
    status: releaseVerified ? "release_verified" : "candidate",
    createdAt: new Date().toISOString(),
    release: {
      sha256: sha256File(releasePath),
      publicCommit: release.publicSource.commit,
      runtimeImage: release.runtime.image,
      engineImage: release.runtime.engineImage,
      patchLevel: release.runtime.patchLevel,
      patchSeriesSha256: release.runtime.patchSeriesSha256,
      collaboraSourceCommit: release.runtime.collaboraSourceCommit,
    },
    gates: {
      native: { status: "passed", targets: nativeTargets },
      browser,
      visual: {
        ...visualReview,
        sourceSha256: sha256File(visualReviewPath),
      },
      powerPoint,
    },
  };
}

function requireReleaseIdentity(release) {
  if (
    release?.kind !== "spellbook-office-runtime" ||
    !/^[0-9a-f]{40}$/u.test(release?.publicSource?.commit ?? "") ||
    !digestPattern.test(release?.runtime?.image ?? "") ||
    !digestPattern.test(release?.runtime?.engineImage ?? "") ||
    !/^undo-v[1-9][0-9]*$/u.test(release?.runtime?.patchLevel ?? "") ||
    !Array.isArray(release?.nativeVerification?.requiredCppunitTargets) ||
    release.nativeVerification.requiredCppunitTargets.length === 0
  )
    throw new Error("invalid_office_runtime_release");
}

function verifyNativeTarget(directory, target) {
  if (!/^[A-Za-z0-9_]+$/u.test(target))
    throw new Error(`invalid_native_target:${target}`);
  const statusPath = path.join(directory, `${target}.status`);
  const logPath = path.join(directory, `${target}.log`);
  const status = fs.readFileSync(statusPath, "utf8").trim();
  const log = fs.readFileSync(logPath, "utf8");
  if (status !== "0") throw new Error(`native_target_failed:${target}`);
  if (!log.includes(target))
    throw new Error(`native_target_log_mismatch:${target}`);
  return {
    name: target,
    status: "passed",
    statusSha256: sha256File(statusPath),
    logSha256: sha256File(logPath),
  };
}

function verifyBrowserReport(report, expectedPatchLevel) {
  const selected = new Set(report?.selectedOperations ?? []);
  const executed = new Set(report?.executedOperations ?? []);
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  const missing = [...selected].filter((operation) => !executed.has(operation));
  if (
    report?.status !== "browser_runtime_passed" ||
    report?.enginePatchLevel !== expectedPatchLevel ||
    selected.size === 0 ||
    executed.size !== selected.size ||
    missing.length > 0 ||
    (report?.missingOperations ?? []).length > 0 ||
    scenarios.length === 0 ||
    scenarios.some(
      (scenario) =>
        scenario.status !== "passed" ||
        scenario.reopen?.verified !== true ||
        scenario.changeBudget?.valid !== true,
    )
  )
    throw new Error("browser_runtime_validation_failed");
  return {
    status: "passed",
    sourceSha256: sha256Json(report),
    enginePatchLevel: report.enginePatchLevel,
    operationCount: selected.size,
    scenarioCount: scenarios.length,
    scenarios: scenarios.map((scenario) => scenario.scenario).sort(),
  };
}

function verifyVisualReview(review, expectedScenarios) {
  const scenarios = Array.isArray(review?.scenarios)
    ? [...new Set(review.scenarios)].sort()
    : [];
  const missing = expectedScenarios.filter(
    (scenario) => !scenarios.includes(scenario),
  );
  if (
    review?.kind !== "spellbook-visual-review" ||
    !["agent_reviewed", "human_passed"].includes(review?.status) ||
    !Number.isInteger(review?.screenshotCount) ||
    review.screenshotCount < 1 ||
    missing.length > 0
  )
    throw new Error("visual_review_incomplete");
  return {
    status: review.status,
    reviewedAt: requiredString(review.reviewedAt, "visual_reviewed_at"),
    reviewer: requiredString(review.reviewer, "visual_reviewer"),
    screenshotCount: review.screenshotCount,
    scenarios,
  };
}

function verifyPowerPointEvidence(evidence) {
  if (
    evidence?.kind !== "spellbook-powerpoint-validation" ||
    evidence?.status !== "passed" ||
    !Array.isArray(evidence?.files) ||
    evidence.files.length === 0
  )
    throw new Error("powerpoint_validation_failed");
  return {
    status: "passed",
    validatedAt: requiredString(
      evidence.validatedAt,
      "powerpoint_validated_at",
    ),
    platform: requiredString(evidence.platform, "powerpoint_platform"),
    applicationVersion: requiredString(
      evidence.applicationVersion,
      "powerpoint_application_version",
    ),
    fileCount: evidence.files.length,
    sourceSha256: sha256Json(evidence),
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(name);
  return value.trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--"))
      throw new Error(`unknown_argument:${argument}`);
    parsed[argument.slice(2)] = argv[++index];
  }
  for (const required of [
    "release",
    "native-directory",
    "browser-report",
    "visual-review",
    "output",
  ])
    if (!parsed[required]) throw new Error(`missing_argument:${required}`);
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const validation = buildOfficeRuntimeValidation({
    releasePath: path.resolve(args.release),
    nativeDirectory: path.resolve(args["native-directory"]),
    browserReportPath: path.resolve(args["browser-report"]),
    visualReviewPath: path.resolve(args["visual-review"]),
    powerPointEvidencePath: args["powerpoint-evidence"]
      ? path.resolve(args["powerpoint-evidence"])
      : undefined,
  });
  fs.writeFileSync(
    path.resolve(args.output),
    `${JSON.stringify(validation, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o644,
    },
  );
}
