import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { admitCandidateRuntime } from "./candidate-runtime.mjs";
import {
  candidateBrowserReportErrors,
  candidateNativeConformanceErrors,
} from "./verify-candidate-powerpoint.mjs";

export function createCandidatePromotion({
  admittedRuntime,
  browserReport,
  browserReportSha256,
  nativeConformanceReport,
  nativeConformanceReportSha256,
  powerpointReport,
  powerpointReportSha256,
  verifiedAt = new Date().toISOString(),
}) {
  const errors = [
    ...candidateBrowserReportErrors(browserReport),
    ...candidateNativeConformanceErrors(nativeConformanceReport),
  ];
  if (
    admittedRuntime.receiptSha256 !==
    browserReport.candidateRuntime?.receiptSha256
  )
    errors.push("browser report does not identify the admitted build receipt");
  if (
    admittedRuntime.receiptSha256 !==
    nativeConformanceReport?.candidateReceiptSha256
  )
    errors.push(
      "native conformance report does not identify the admitted build receipt",
    );
  if (powerpointReport?.valid !== true || powerpointReport.errors?.length !== 0)
    errors.push("native PowerPoint evidence is not valid");
  if (powerpointReport?.browserReceiptSha256 !== admittedRuntime.receiptSha256)
    errors.push(
      "PowerPoint evidence does not identify the admitted build receipt",
    );
  if (powerpointReport?.savedSha256 !== browserReport.savedSha256)
    errors.push("PowerPoint evidence does not identify the browser-saved PPTX");
  if (
    powerpointReport?.nativeConformanceSha256 !== nativeConformanceReportSha256
  )
    errors.push(
      "PowerPoint evidence does not identify the native conformance report",
    );
  if (!/^[0-9a-f]{64}$/u.test(browserReportSha256 ?? ""))
    errors.push("browser evidence digest is invalid");
  if (!/^[0-9a-f]{64}$/u.test(nativeConformanceReportSha256 ?? ""))
    errors.push("native conformance evidence digest is invalid");
  if (!/^[0-9a-f]{64}$/u.test(powerpointReportSha256 ?? ""))
    errors.push("PowerPoint evidence digest is invalid");
  if (errors.length) throw new Error(errors.join("; "));

  return {
    schemaVersion: 1,
    status: "verified_not_published",
    verifiedAt,
    spellbookSourceRevision: admittedRuntime.receipt.spellbookSourceRevision,
    runtime: {
      receiptSha256: admittedRuntime.receiptSha256,
      libreOffice: admittedRuntime.receipt.libreOffice,
      toolchain: admittedRuntime.receipt.toolchain,
      artifacts: admittedRuntime.receipt.artifacts,
    },
    evidence: {
      browserReportSha256,
      nativeConformanceReportSha256,
      powerpointReportSha256,
      verifiedElementOperations: browserReport.verifiedElementOperations,
      verifiedNativeOperations: nativeConformanceReport.executedOperations,
      enduranceCycles: browserReport.endurance.cycles,
      changedParts: browserReport.changedParts,
      savedSha256: browserReport.savedSha256,
      powerpointRenderer: powerpointReport.renderer,
      powerpointSlideCounts: powerpointReport.slideCounts,
      powerpointVisibleEdit: powerpointReport.visibleEdit,
    },
  };
}

async function main() {
  const runtimeDirectory = path.resolve(
    requiredFlagValue("--candidate-runtime", process.argv),
  );
  const browserReportPath = path.resolve(
    requiredFlagValue("--browser-report", process.argv),
  );
  const nativeConformanceReportPath = path.resolve(
    requiredFlagValue("--native-conformance", process.argv),
  );
  const powerpointReportPath = path.resolve(
    requiredFlagValue("--powerpoint-report", process.argv),
  );
  const output = path.resolve(requiredFlagValue("--output", process.argv));
  const admittedRuntime = await admitCandidateRuntime({ runtimeDirectory });
  const [browserBytes, nativeConformanceBytes, powerpointBytes] =
    await Promise.all([
      fs.readFile(browserReportPath),
      fs.readFile(nativeConformanceReportPath),
      fs.readFile(powerpointReportPath),
    ]);
  const promotion = createCandidatePromotion({
    admittedRuntime,
    browserReport: JSON.parse(browserBytes.toString("utf8")),
    browserReportSha256: sha256(browserBytes),
    nativeConformanceReport: JSON.parse(
      nativeConformanceBytes.toString("utf8"),
    ),
    nativeConformanceReportSha256: sha256(nativeConformanceBytes),
    powerpointReport: JSON.parse(powerpointBytes.toString("utf8")),
    powerpointReportSha256: sha256(powerpointBytes),
  });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(promotion, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(promotion, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requiredFlagValue(name, argv) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
