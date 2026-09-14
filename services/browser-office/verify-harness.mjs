import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHarnessServer } from "./server.mjs";

const outputFlag = process.argv.indexOf("--output");
const outputRoot = path.resolve(
  outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : "artifacts/browser-office/latest",
);
const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serviceRoot, "../..");
const baselinePath = path.join(
  repositoryRoot,
  "eval/public/fixtures/general-native-surface.pptx",
);
await mkdir(outputRoot, { recursive: true });

const server = createHarnessServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  page.on("console", (message) =>
    consoleMessages.push(`${message.type()}: ${message.text()}`),
  );
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    }),
  );

  const startedAt = performance.now();
  await page.goto(`http://127.0.0.1:${port}/?autorun=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => ["complete", "error"].includes(document.body.dataset.state),
    null,
    { timeout: 60_000 },
  );

  const result = await page.evaluate(() => ({
    state: document.body.dataset.state,
    error: document.body.dataset.error ?? null,
    initialSlides: Number(document.body.dataset.initialSlides),
    reopenedSlides: Number(document.body.dataset.reopenedSlides),
    mutatedSha256: document.body.dataset.mutatedSha256 ?? null,
    addedSha256: document.body.dataset.addedSha256 ?? null,
    restoredSha256: document.body.dataset.restoredSha256 ?? null,
    topologyOperations: document.body.dataset.topologyOperations ?? null,
    status: document.querySelector("#status")?.textContent ?? null,
    evidence: globalThis.spellbookBrowserOffice.evidence,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  }));
  result.elapsedMs = Math.round(performance.now() - startedAt);
  result.console = consoleMessages;
  result.pageErrors = pageErrors;
  result.requestFailures = requestFailures;

  const artifactPaths = new Map();
  for (const [label, filename] of [
    ["after-insert", "after-insert.pptx"],
    ["after-duplicate", "after-duplicate.pptx"],
    ["after-move", "after-move.pptx"],
    ["after-delete", "after-delete.pptx"],
    ["after-undo", "after-undo.pptx"],
  ]) {
    const values = await page.evaluate(
      (artifactLabel) =>
        globalThis.spellbookBrowserOffice.artifact(artifactLabel),
      label,
    );
    if (!values) throw new Error(`Browser did not preserve ${label}.`);
    const artifactPath = path.join(outputRoot, filename);
    await writeFile(artifactPath, Uint8Array.from(values));
    artifactPaths.set(label, artifactPath);
  }
  await page.screenshot({
    path: path.join(outputRoot, "browser-office.png"),
    fullPage: true,
  });
  result.packageIntegrity = evaluatePackageIntegrity({
    baselinePath,
    artifactPaths,
    undonePath: artifactPaths.get("after-undo"),
    runs: result.evidence.runs,
  });

  const failures = [
    result.state !== "complete" ? `state=${result.state}` : null,
    result.error ? `page error: ${result.error}` : null,
    !result.crossOriginIsolated ? "crossOriginIsolated=false" : null,
    result.initialSlides !== result.reopenedSlides
      ? "reopened slide count differs"
      : null,
    result.mutatedSha256 === result.restoredSha256
      ? "mutated and restored hashes match"
      : null,
    result.topologyOperations !== "add,duplicate,move,delete"
      ? "browser topology sequence is incomplete"
      : null,
    pageErrors.length ? `${pageErrors.length} uncaught page error(s)` : null,
    requestFailures.length
      ? `${requestFailures.length} failed request(s)`
      : null,
    !result.packageIntegrity.valid
      ? `package integrity: ${result.packageIntegrity.errors.join("; ")}`
      : null,
  ].filter(Boolean);
  await writeFile(
    path.join(outputRoot, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (failures.length) throw new Error(failures.join("; "));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Evidence: ${outputRoot}\n`);
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function evaluatePackageIntegrity({
  baselinePath,
  artifactPaths,
  undonePath,
  runs,
}) {
  const inserted = comparePackages(
    baselinePath,
    artifactPaths.get("after-insert"),
  );
  const duplicated = comparePackages(
    artifactPaths.get("after-insert"),
    artifactPaths.get("after-duplicate"),
  );
  const moved = comparePackages(
    artifactPaths.get("after-duplicate"),
    artifactPaths.get("after-move"),
  );
  const deleted = comparePackages(
    artifactPaths.get("after-move"),
    artifactPaths.get("after-delete"),
  );
  const deleteRoundTrip = comparePackages(
    artifactPaths.get("after-insert"),
    artifactPaths.get("after-delete"),
  );
  const undone = comparePackages(baselinePath, undonePath);
  const controlParts = new Set([
    "[Content_Types].xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/presentation.xml",
  ]);
  const mutation = (label) =>
    runs.find((entry) => entry.label === label)?.mutation;
  const errors = [];
  validateCreateDiff(
    "add",
    inserted,
    mutation("after-insert"),
    controlParts,
    errors,
  );
  validateCreateDiff(
    "duplicate",
    duplicated,
    mutation("after-duplicate"),
    controlParts,
    errors,
  );
  validateBoundedDiff(
    "move",
    moved,
    new Set(["ppt/presentation.xml"]),
    new Set(),
    new Set(),
    errors,
  );
  const deleteMutation = mutation("after-delete");
  validateBoundedDiff(
    "delete",
    deleted,
    controlParts,
    new Set(),
    new Set(
      (deleteMutation?.changedParts ?? []).filter(
        (part) => !controlParts.has(part),
      ),
    ),
    errors,
  );
  validateEmptyDiff("add/delete round trip", deleteRoundTrip, errors);
  validateEmptyDiff("four-step undo", undone, errors);
  return {
    valid: errors.length === 0,
    errors,
    inserted: summarizeDiff(inserted),
    duplicated: summarizeDiff(duplicated),
    moved: summarizeDiff(moved),
    deleted: summarizeDiff(deleted),
    deleteRoundTrip: summarizeDiff(deleteRoundTrip),
    undone: summarizeDiff(undone),
  };
}

function validateCreateDiff(label, diff, mutation, controlParts, errors) {
  validateBoundedDiff(
    label,
    diff,
    controlParts,
    new Set(
      (mutation?.changedParts ?? []).filter((part) => !controlParts.has(part)),
    ),
    new Set(),
    errors,
  );
}

function validateBoundedDiff(
  label,
  diff,
  allowedChanged,
  expectedAdded,
  expectedRemoved,
  errors,
) {
  const unexpectedChanged = diff.changedSharedParts.filter(
    (part) => !allowedChanged.has(part),
  );
  const unexpectedAdded = diff.addedParts.filter(
    (part) => !expectedAdded.has(part),
  );
  const missingAdded = [...expectedAdded].filter(
    (part) => !diff.addedParts.includes(part),
  );
  const unexpectedRemoved = diff.removedParts.filter(
    (part) => !expectedRemoved.has(part),
  );
  const missingRemoved = [...expectedRemoved].filter(
    (part) => !diff.removedParts.includes(part),
  );
  if (unexpectedChanged.length)
    errors.push(
      `${label} changed unexpected parts: ${unexpectedChanged.join(", ")}`,
    );
  if (unexpectedAdded.length)
    errors.push(
      `${label} added unexpected parts: ${unexpectedAdded.join(", ")}`,
    );
  if (missingAdded.length)
    errors.push(`${label} missed added parts: ${missingAdded.join(", ")}`);
  if (unexpectedRemoved.length)
    errors.push(
      `${label} removed unexpected parts: ${unexpectedRemoved.join(", ")}`,
    );
  if (missingRemoved.length)
    errors.push(`${label} missed removed parts: ${missingRemoved.join(", ")}`);
}

function validateEmptyDiff(label, diff, errors) {
  if (
    diff.changedSharedParts.length ||
    diff.addedParts.length ||
    diff.removedParts.length
  )
    errors.push(`${label} differs from its original package parts`);
}

function comparePackages(before, after) {
  const result = spawnSync(
    "python3",
    [
      path.join(
        repositoryRoot,
        "services/office-session-spike/compare-packages.py",
      ),
      before,
      after,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Package comparison failed: ${result.stderr || result.error?.message}`,
    );
  return JSON.parse(result.stdout);
}

function summarizeDiff(diff) {
  return {
    originalPartCount: diff.originalPartCount,
    savedPartCount: diff.savedPartCount,
    changedSharedParts: diff.changedSharedParts,
    addedParts: diff.addedParts,
    removedParts: diff.removedParts,
    unchangedSharedPartCount: diff.unchangedSharedPartCount,
  };
}
