import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(directory, "../../..");
const runAudit = (relativeScript, args = []) => {
  const script = path.join(repoRoot, relativeScript);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${relativeScript} did not return JSON: ${result.stderr || result.stdout}`,
    );
  }
  return {
    ok: result.status === 0,
    status: result.status,
    report,
    diagnostic: result.stderr.trim() || null,
  };
};

const editor = runAudit(
  "services/office-editor/libreoffice/audit-upgrade.mjs",
  ["--ref", "latest"],
);
const renderer = runAudit(
  "services/document-worker/libreoffice/audit-upgrade.mjs",
);
const report = {
  checkedAt: new Date().toISOString(),
  updateAvailable: Boolean(
    editor.report.updateAvailable || renderer.report.updateAvailable,
  ),
  candidateBuildBlocked: Boolean(
    !editor.report.candidateReadyForBuild ||
      (renderer.report.updateAvailable &&
        !renderer.report.candidateReadyForBuild),
  ),
  editor,
  renderer,
  decision:
    "Detection never changes a manifest or deployment. Download/rebase the candidate, then pass engine, browser, save/reopen, corpus, PowerPoint and canary gates.",
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!editor.ok && editor.status !== 2) process.exitCode = editor.status ?? 1;
if (!renderer.ok && renderer.status !== 2)
  process.exitCode = renderer.status ?? 1;
