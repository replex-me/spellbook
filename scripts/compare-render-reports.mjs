import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

function metricSummary(values) {
  if (values.length === 0)
    return { count: 0, mean: null, p50: null, p95: null, max: null };
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function slideMetrics(report, deckIds) {
  const metrics = new Map();
  for (const deck of report.decks ?? []) {
    if (deckIds.size > 0 && !deckIds.has(deck.id)) continue;
    for (const slide of deck.slides ?? []) {
      const rmse = slide.comparison?.normalizedRmse;
      if (!Number.isFinite(rmse)) continue;
      metrics.set(`${deck.id}:${slide.slideNumber}`, {
        deckId: deck.id,
        slideNumber: slide.slideNumber,
        sourceSha256: deck.sourceSha256,
        rmse,
      });
    }
  }
  return metrics;
}

export function compareRenderReports(
  baseline,
  candidate,
  { epsilon = 0.000001, top = 20, deckIds = [] } = {},
) {
  const selectedDecks = new Set(deckIds);
  const baselineSlides = slideMetrics(baseline, selectedDecks);
  const candidateSlides = slideMetrics(candidate, selectedDecks);
  const rows = [];

  if (baselineSlides.size === 0)
    throw new Error("Baseline report has no compared slides.");

  for (const [key, baselineSlide] of baselineSlides) {
    const candidateSlide = candidateSlides.get(key);
    if (!candidateSlide) throw new Error(`Candidate report is missing ${key}.`);
    if (
      baselineSlide.sourceSha256 &&
      candidateSlide.sourceSha256 &&
      baselineSlide.sourceSha256 !== candidateSlide.sourceSha256
    )
      throw new Error(`Source SHA-256 differs for ${baselineSlide.deckId}.`);
    rows.push({
      deckId: baselineSlide.deckId,
      slideNumber: baselineSlide.slideNumber,
      baselineRmse: baselineSlide.rmse,
      candidateRmse: candidateSlide.rmse,
      delta: candidateSlide.rmse - baselineSlide.rmse,
    });
  }

  if (rows.length !== candidateSlides.size)
    throw new Error(
      "Candidate report contains a different compared slide set.",
    );

  const improved = rows.filter((row) => row.delta < -epsilon);
  const regressed = rows.filter((row) => row.delta > epsilon);
  const unchanged = rows.length - improved.length - regressed.length;
  const byDeltaAscending = [...rows].sort(
    (left, right) => left.delta - right.delta,
  );

  return {
    contractVersion: "1.0",
    baseline: {
      renderer: baseline.renderer,
      metrics: metricSummary(rows.map((row) => row.baselineRmse)),
    },
    candidate: {
      renderer: candidate.renderer,
      metrics: metricSummary(rows.map((row) => row.candidateRmse)),
    },
    delta: {
      mean: rows.reduce((sum, row) => sum + row.delta, 0) / rows.length || 0,
      improvedSlides: improved.length,
      regressedSlides: regressed.length,
      unchangedSlides: unchanged,
      biggestImprovements: byDeltaAscending.slice(0, top),
      biggestRegressions: byDeltaAscending.slice(-top).reverse(),
    },
  };
}

export async function compareRenderReportFiles({
  baselinePath,
  candidatePath,
  outputPath,
  deckIds = [],
}) {
  const [baseline, candidate] = await Promise.all(
    [baselinePath, candidatePath].map(async (file) =>
      JSON.parse(await fs.readFile(path.resolve(file), "utf8")),
    ),
  );
  const result = compareRenderReports(baseline, candidate, { deckIds });
  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  return { output: absoluteOutput, slides: result.baseline.metrics.count };
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (["--baseline", "--candidate", "--output"].includes(value))
      parsed[value.slice(2)] = argv[++index];
    else if (value === "--deck-id")
      (parsed.deck_ids ??= []).push(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!parsed.baseline || !parsed.candidate || !parsed.output)
    throw new Error(
      "Usage: --baseline <report.json> --candidate <report.json> --output <comparison.json> [--deck-id <id> ...]",
    );
  return {
    baselinePath: parsed.baseline,
    candidatePath: parsed.candidate,
    outputPath: parsed.output,
    deckIds: parsed.deck_ids ?? [],
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        await compareRenderReportFiles(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
