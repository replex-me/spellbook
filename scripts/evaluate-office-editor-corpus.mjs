import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectImageMagick,
  imageMagickInvocation,
  parseRmse,
} from "./evaluate-render-corpus.mjs";
import {
  dotnetHostCommand,
  isTransientEditorConnectionFailure,
  runHostedProbe,
} from "./native-mutation-conformance-runner.mjs";

const MAX_ASPECT_EDGE_ERROR_PIXELS = 2;
const DOCUMENT_TOOL_DLL =
  "services/document-worker/tools/Spellbook.Document.Tool/bin/Release/net10.0/Spellbook.Document.Tool.dll";

export function classifyScaledDimensionComparison(referenceSize, renderedSize) {
  if (
    referenceSize.width === renderedSize.width &&
    referenceSize.height === renderedSize.height
  )
    return { mode: "exact" };
  const referenceAspect = referenceSize.width / referenceSize.height;
  const renderedAspect = renderedSize.width / renderedSize.height;
  const aspectDelta = Math.abs(referenceAspect - renderedAspect);
  const edgeErrorPixels = Math.abs(
    (renderedSize.height * referenceSize.width) / renderedSize.width -
      referenceSize.height,
  );
  if (edgeErrorPixels <= MAX_ASPECT_EDGE_ERROR_PIXELS)
    return {
      mode: "scale",
      aspectDelta,
      edgeErrorPixels,
      target: `${referenceSize.width}x${referenceSize.height}!`,
    };
  return { mode: "mismatch", aspectDelta, edgeErrorPixels };
}

function requireCommand(command, args, allowedStatuses = [0]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || !allowedStatuses.includes(result.status ?? -1))
    throw new Error(
      [result.error?.message, result.stderr, result.stdout]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 1200) || `${command} exited with ${result.status}`,
    );
  return result;
}

function identifyImage(file, imageMagick) {
  const invocation = imageMagickInvocation(imageMagick, "identify", [
    "-format",
    "%w %h",
    file,
  ]);
  const result = requireCommand(invocation.command, invocation.args);
  const [width, height] = result.stdout.trim().split(/\s+/u).map(Number);
  return { width, height };
}

export function compareEditorImage(reference, rendered, imageMagick) {
  const referenceSize = identifyImage(reference, imageMagick);
  const renderedSize = identifyImage(rendered, imageMagick);
  const dimension = classifyScaledDimensionComparison(
    referenceSize,
    renderedSize,
  );
  if (dimension.mode === "mismatch")
    return {
      status: "dimension_mismatch",
      referenceSize,
      renderedSize,
      aspectDelta: dimension.aspectDelta,
      edgeErrorPixels: dimension.edgeErrorPixels,
      normalizedRmse: null,
      similarity: null,
    };
  const target =
    dimension.mode === "scale"
      ? ["(", rendered, "-resize", dimension.target, ")"]
      : [rendered];
  const invocation = imageMagickInvocation(imageMagick, "compare", [
    "-metric",
    "RMSE",
    reference,
    ...target,
    "null:",
  ]);
  const result = requireCommand(invocation.command, invocation.args, [0, 1]);
  const normalizedRmse = parseRmse(result.stderr || result.stdout);
  return {
    status: dimension.mode === "scale" ? "compared_scaled" : "compared",
    referenceSize,
    renderedSize,
    normalizedRmse,
    similarity: 1 - normalizedRmse,
  };
}

function issueKey(issue) {
  return JSON.stringify({
    slideIndex: issue.slideIndex,
    code: issue.code,
  });
}

function introducedLayoutIssues(before, after) {
  const knownCounts = new Map();
  for (const issue of before.slides.flatMap((slide) =>
    slide.layoutIssues.map((issue) => ({
      slideIndex: slide.slideIndex,
      ...issue,
    })),
  )) {
    const key = issueKey(issue);
    knownCounts.set(key, (knownCounts.get(key) ?? 0) + 1);
  }
  const introduced = [];
  for (const issue of after.slides.flatMap((slide) =>
    slide.layoutIssues.map((issue) => ({
      slideIndex: slide.slideIndex,
      ...issue,
    })),
  )) {
    const key = issueKey(issue);
    const known = knownCounts.get(key) ?? 0;
    if (known > 0) knownCounts.set(key, known - 1);
    else introduced.push(issue);
  }
  return introduced;
}

export function stableSlideSemantics(state) {
  return state.slides.map(({ name, hidden, layout, elementCount }) => ({
    name,
    hidden,
    layout,
    elementCount,
  }));
}

export function isTransientCorpusProbeFailure(error) {
  const message = String(error?.message ?? error);
  return (
    isTransientEditorConnectionFailure(error) ||
    message.includes("편집 응답을 확인하지 못했습니다")
  );
}

async function runCorpusProbe(options) {
  try {
    return { probe: await runHostedProbe(options), retried: false };
  } catch (error) {
    if (!isTransientCorpusProbeFailure(error)) throw error;
    const retryLogPath = options.logPath?.endsWith(".log")
      ? `${options.logPath.slice(0, -4)}.retry.log`
      : `${options.logPath ?? "probe"}.retry.log`;
    return {
      probe: await runHostedProbe({
        ...options,
        output: `${options.output}-retry`,
        fileId: `${options.fileId}-retry`,
        logPath: retryLogPath,
      }),
      retried: true,
    };
  }
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-");
}

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function preserveUnsupportedFeatures({
  root,
  baseline,
  candidate,
  output,
  report,
}) {
  const documentTool = path.resolve(root, DOCUMENT_TOOL_DLL);
  if (!(await exists(documentTool)))
    throw new Error(
      "The release Document Tool must be built before editor corpus evaluation.",
    );
  requireCommand(dotnetHostCommand(), [
    documentTool,
    "preserve-unsupported",
    baseline,
    candidate,
    output,
    report,
  ]);
  return JSON.parse(await fs.readFile(report, "utf8"));
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

export function summarizeEditorCorpus(decks) {
  const passed = decks.filter((deck) => deck.status === "passed");
  const evidenceGapDecks = passed.filter(
    (deck) => deck.evidenceGaps?.length > 0,
  );
  const referenceRmse = passed.flatMap((deck) =>
    deck.slides
      .map((slide) => slide.powerPointComparison?.normalizedRmse)
      .filter(Number.isFinite),
  );
  const roundtripRmse = passed.flatMap((deck) =>
    deck.slides
      .map((slide) => slide.roundtripComparison?.normalizedRmse)
      .filter(Number.isFinite),
  );
  return {
    decks: decks.length,
    passedDecks: passed.length,
    failedDecks: decks.length - passed.length,
    evidenceGapDecks: evidenceGapDecks.length,
    evidenceGaps: evidenceGapDecks.reduce(
      (sum, deck) => sum + deck.evidenceGaps.length,
      0,
    ),
    slides: passed.reduce((sum, deck) => sum + deck.slideCount, 0),
    referenceComparison: {
      comparedSlides: referenceRmse.length,
      p50Rmse: percentile(referenceRmse, 0.5),
      p95Rmse: percentile(referenceRmse, 0.95),
      maxRmse: referenceRmse.length ? Math.max(...referenceRmse) : null,
    },
    saveReopenComparison: {
      comparedSlides: roundtripRmse.length,
      p50Rmse: percentile(roundtripRmse, 0.5),
      p95Rmse: percentile(roundtripRmse, 0.95),
      maxRmse: roundtripRmse.length ? Math.max(...roundtripRmse) : null,
    },
  };
}

export function selectCorpusDecks(decks, deckIds = []) {
  if (!deckIds.length) return decks;
  const requested = new Set(deckIds);
  const selected = decks.filter((deck) => requested.has(deck.id));
  const missing = [...requested].filter(
    (id) => !selected.some((deck) => deck.id === id),
  );
  if (missing.length)
    throw new Error(`Corpus deck ids were not found: ${missing.join(", ")}`);
  return selected;
}

export async function evaluateOfficeEditorCorpus({
  root = ".",
  manifestPath,
  outputPath,
  editorOrigin,
  expectedPatchLevel,
  deckIds = [],
}) {
  const absoluteRoot = path.resolve(root);
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8"));
  if (manifest.contractVersion !== "1.0" || !Array.isArray(manifest.decks))
    throw new Error("A corpus 1.0 manifest with decks is required.");
  const selectedDecks = selectCorpusDecks(manifest.decks, deckIds);
  if (!/^undo-v[1-9][0-9]*$/u.test(expectedPatchLevel))
    throw new Error("An undo-vN expected patch level is required.");
  const imageMagick = detectImageMagick();
  if (!imageMagick)
    throw new Error("ImageMagick is required for editor corpus comparison.");
  const absoluteOutput = path.resolve(outputPath);
  try {
    await fs.access(absoluteOutput);
    throw new Error(`Refusing to overwrite existing output: ${absoluteOutput}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(absoluteOutput, { recursive: true, mode: 0o700 });

  const decks = [];
  for (const [index, deck] of selectedDecks.entries()) {
    const started = Date.now();
    const source = path.resolve(manifestDirectory, deck.source);
    const deckDirectory = path.join(absoluteOutput, safeName(deck.id));
    const directRender = path.join(deckDirectory, "direct-render");
    const reopenedRender = path.join(deckDirectory, "reopened-render");
    await fs.mkdir(deckDirectory, { recursive: true, mode: 0o700 });
    const result = {
      id: deck.id,
      source: deck.source,
      sourceSha256: null,
      supportClass: deck.supportClass,
      categories: deck.categories,
      status: "failed",
      slideCount: 0,
      introducedLayoutIssues: [],
      persistenceWarnings: [],
      evidenceGaps: [],
      transientRetries: 0,
      preservation: null,
      slides: [],
      durationMs: null,
      error: null,
    };
    try {
      result.sourceSha256 = await sha256(source);
      const directRun = await runCorpusProbe({
        root: absoluteRoot,
        source,
        output: path.join(deckDirectory, "direct-session"),
        editorOrigin,
        fileId: `editor-corpus-${safeName(deck.id)}-direct`,
        script: "services/office-session-spike/probe-uno-render-all.mjs",
        args: [directRender],
        env: {
          SPELLBOOK_PROBE_EXPECTED_PATCH_LEVEL: expectedPatchLevel,
          SPELLBOOK_PROBE_SAVE: "1",
        },
        expectSave: true,
        logPath: path.join(deckDirectory, "direct.log"),
      });
      const direct = directRun.probe;
      if (directRun.retried) result.transientRetries++;
      const directState = JSON.parse(direct.stdout);
      const preservedPath = path.join(deckDirectory, "preserved.pptx");
      const preservationReport = path.join(
        deckDirectory,
        "preservation-report.json",
      );
      result.preservation = await preserveUnsupportedFeatures({
        root: absoluteRoot,
        baseline: source,
        candidate: direct.savedPath,
        output: preservedPath,
        report: preservationReport,
      });
      const reopenedRun = await runCorpusProbe({
        root: absoluteRoot,
        source: preservedPath,
        output: path.join(deckDirectory, "reopen-session"),
        editorOrigin,
        fileId: `editor-corpus-${safeName(deck.id)}-reopen`,
        script: "services/office-session-spike/probe-uno-render-all.mjs",
        args: [reopenedRender],
        env: {
          SPELLBOOK_PROBE_EXPECTED_PATCH_LEVEL: expectedPatchLevel,
        },
        expectSave: false,
        logPath: path.join(deckDirectory, "reopen.log"),
      });
      const reopened = reopenedRun.probe;
      if (reopenedRun.retried) result.transientRetries++;
      const reopenedState = JSON.parse(reopened.stdout);
      if (directState.slideCount !== reopenedState.slideCount)
        throw new Error(
          `Save/reopen changed slide count from ${directState.slideCount} to ${reopenedState.slideCount}.`,
        );
      if (directState.masterCount !== reopenedState.masterCount)
        result.persistenceWarnings.push({
          code: "runtime_master_projection_changed",
          before: directState.masterCount,
          after: reopenedState.masterCount,
        });
      const changedMasterNames = directState.slides
        .map((slide, slideIndex) => ({
          slideNumber: slideIndex + 1,
          before: slide.masterName,
          after: reopenedState.slides[slideIndex]?.masterName,
        }))
        .filter(({ before, after }) => before !== after);
      if (changedMasterNames.length)
        result.persistenceWarnings.push({
          code: "runtime_master_name_projection_changed",
          slides: changedMasterNames,
        });
      if (
        JSON.stringify(stableSlideSemantics(directState)) !==
        JSON.stringify(stableSlideSemantics(reopenedState))
      )
        throw new Error("Save/reopen changed stable slide semantics.");
      result.slideCount = reopenedState.slideCount;
      result.introducedLayoutIssues = introducedLayoutIssues(
        directState,
        reopenedState,
      );
      if (result.introducedLayoutIssues.length)
        throw new Error(
          `Save/reopen introduced ${result.introducedLayoutIssues.length} layout issue(s).`,
        );

      for (let slideIndex = 0; slideIndex < result.slideCount; slideIndex++) {
        const directImage = path.join(
          directRender,
          `slide-${slideIndex + 1}.png`,
        );
        const reopenedImage = path.join(
          reopenedRender,
          `slide-${slideIndex + 1}.png`,
        );
        const referenceImage = deck.references
          ? path.resolve(
              manifestDirectory,
              deck.references,
              `slide-${slideIndex + 1}.png`,
            )
          : null;
        if (!(await exists(directImage)) || !(await exists(reopenedImage)))
          throw new Error(
            `Slide ${slideIndex + 1} has incomplete PNG evidence.`,
          );
        const hidden = reopenedState.slides[slideIndex]?.hidden ?? false;
        const hasReference =
          Boolean(referenceImage) && (await exists(referenceImage));
        if (!hidden && !hasReference)
          result.evidenceGaps.push({
            code: "missing_powerpoint_reference",
            slideNumber: slideIndex + 1,
          });
        const powerPointComparison = hasReference
          ? compareEditorImage(referenceImage, reopenedImage, imageMagick)
          : null;
        if (powerPointComparison?.status === "dimension_mismatch")
          throw new Error(
            `Slide ${slideIndex + 1} has a PowerPoint aspect-ratio mismatch.`,
          );
        result.slides.push({
          slideNumber: slideIndex + 1,
          hidden,
          direct: path.relative(absoluteOutput, directImage),
          reopened: path.relative(absoluteOutput, reopenedImage),
          reference: referenceImage
            ? path.relative(manifestDirectory, referenceImage)
            : null,
          powerPointComparison,
          roundtripComparison: compareEditorImage(
            directImage,
            reopenedImage,
            imageMagick,
          ),
        });
      }
      if ((await sha256(source)) !== result.sourceSha256)
        throw new Error("The source PPTX changed during evaluation.");
      result.status = "passed";
    } catch (error) {
      result.status = "failed";
      result.error = (error instanceof Error ? error.message : String(error))
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 1600);
    }
    result.durationMs = Date.now() - started;
    decks.push(result);
    process.stdout.write(
      `[editor-corpus] ${index + 1}/${selectedDecks.length} ${deck.id}: ${result.status}\n`,
    );
  }

  const summary = summarizeEditorCorpus(decks);
  const report = {
    contractVersion: "1.0",
    corpusId: manifest.corpusId,
    generatedAt: new Date().toISOString(),
    editor: {
      origin: editorOrigin,
      patchLevel: expectedPatchLevel,
    },
    referenceRenderer: manifest.referenceRenderer,
    summary,
    gate: {
      status: summary.failedDecks === 0 ? "runtime_passed" : "failed",
      referenceEvidence: summary.evidenceGaps === 0 ? "complete" : "incomplete",
      visualReviewRequired: true,
    },
    decks,
  };
  await fs.writeFile(
    path.join(absoluteOutput, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  return report;
}

function parseArguments(argv) {
  const parsed = { root: ".", deck_ids: [] };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--deck-id") parsed.deck_ids.push(argv[++index]);
    else if (
      [
        "--root",
        "--manifest",
        "--output",
        "--editor-origin",
        "--expected-patch-level",
      ].includes(value)
    )
      parsed[value.slice(2).replaceAll("-", "_")] = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (
    !parsed.manifest ||
    !parsed.output ||
    !parsed.editor_origin ||
    !parsed.expected_patch_level
  )
    throw new Error(
      "Usage: --manifest CORPUS.json --output DIRECTORY --editor-origin URL --expected-patch-level undo-vN",
    );
  return {
    root: parsed.root,
    manifestPath: parsed.manifest,
    outputPath: parsed.output,
    editorOrigin: parsed.editor_origin,
    expectedPatchLevel: parsed.expected_patch_level,
    deckIds: parsed.deck_ids,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const report = await evaluateOfficeEditorCorpus(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(
      `${JSON.stringify({ report: path.resolve(process.argv[process.argv.indexOf("--output") + 1], "report.json"), gate: report.gate, summary: report.summary }, null, 2)}\n`,
    );
    if (report.gate.status === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
