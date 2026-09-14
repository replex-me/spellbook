import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareEditorImage } from "../../scripts/evaluate-office-editor-corpus.mjs";
import { detectImageMagick } from "../../scripts/evaluate-render-corpus.mjs";
import { exportPowerPointReferences } from "../../scripts/export-powerpoint-references.mjs";

const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serviceRoot, "../..");
const browserEvidenceRoot = path.resolve(
  process.argv[2] ??
    path.join(repositoryRoot, "artifacts/browser-office/latest"),
);
const evidenceParent = path.join(repositoryRoot, "artifacts/browser-office");
await fs.mkdir(evidenceParent, { recursive: true });
const outputRoot = await fs.mkdtemp(
  path.join(evidenceParent, "powerpoint-topology-"),
);
const manifestPath = path.join(outputRoot, "manifest.json");
const referencesRoot = path.join(outputRoot, "references");
const expectedSlides = new Map([
  ["after-insert", 2],
  ["after-duplicate", 3],
  ["after-move", 3],
  ["after-delete", 2],
  ["after-rename", 2],
  ["after-hide", 1],
  ["after-undo", 1],
]);
const decks = [...expectedSlides].map(([id]) => ({
  id,
  source: path.join(browserEvidenceRoot, `${id}.pptx`),
}));
for (const deck of decks) await fs.access(deck.source);
await fs.writeFile(
  manifestPath,
  `${JSON.stringify({ contractVersion: "1.0", decks }, null, 2)}\n`,
  { mode: 0o600 },
);

const exported = await exportPowerPointReferences({
  manifestPath,
  referencesRoot,
});
const errors = exported.failures.map(
  (failure) => `${failure.id}: ${failure.error}`,
);
if (exported.failures.length === 0) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  for (const [id, expected] of expectedSlides) {
    const actual = manifest.decks.find((item) => item.id === id);
    const metadata = actual
      ? JSON.parse(
          await fs.readFile(
            path.join(referencesRoot, id, "reference-metadata.json"),
            "utf8",
          ),
        )
      : null;
    if (metadata?.slides !== expected)
      errors.push(
        `${id}: PowerPoint exported ${metadata?.slides} of ${expected} slides`,
      );
  }
}

const imageMagick = detectImageMagick();
if (!imageMagick)
  errors.push("ImageMagick is unavailable for PowerPoint pixel checks");
const comparisons = [];
if (imageMagick && exported.failures.length === 0)
  for (const [label, left, right] of [
    ["delete-round-trip-slide-1", ["after-insert", 1], ["after-delete", 1]],
    ["delete-round-trip-slide-2", ["after-insert", 2], ["after-delete", 2]],
    ["rename-is-nonvisual", ["after-delete", 1], ["after-rename", 1]],
    [
      "hidden-slide-keeps-visible-slide",
      ["after-rename", 1],
      ["after-hide", 1],
    ],
    ["undo-original-slide-1", ["after-insert", 1], ["after-undo", 1]],
    [
      "duplicate-slide-identity",
      ["after-duplicate", 1],
      ["after-duplicate", 3],
    ],
    ["move-duplicate-to-front", ["after-duplicate", 3], ["after-move", 1]],
    ["move-original-to-second", ["after-duplicate", 1], ["after-move", 2]],
    ["move-blank-to-third", ["after-duplicate", 2], ["after-move", 3]],
  ]) {
    const comparison = compareEditorImage(
      slideImage(referencesRoot, left),
      slideImage(referencesRoot, right),
      imageMagick,
    );
    comparisons.push({ label, left, right, ...comparison });
    if (comparison.normalizedRmse !== 0)
      errors.push(`${label}: normalized RMSE ${comparison.normalizedRmse}`);
  }

const report = {
  valid: errors.length === 0,
  errors,
  browserEvidenceRoot,
  outputRoot,
  renderer: exported.referenceRenderer,
  expectedSlides: Object.fromEntries(expectedSlides),
  comparisons,
};
await fs.writeFile(
  path.join(outputRoot, "result.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600 },
);
if (!report.valid) throw new Error(errors.join("; "));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function slideImage(root, [deck, slide]) {
  return path.join(root, deck, `slide-${slide}.png`);
}
