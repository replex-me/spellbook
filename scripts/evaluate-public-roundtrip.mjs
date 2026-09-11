import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL =
  "services/document-worker/tools/Spellbook.Document.Tool/bin/Release/net10.0/Spellbook.Document.Tool.dll";

export function selectEditableTextElement(graph) {
  for (const slide of graph.slides ?? [])
    for (const element of slide.elements ?? [])
      if (
        element.editable &&
        element.kind === "shape" &&
        typeof element.text === "string" &&
        element.text.length > 0
      )
        return { slideIndex: slide.slideIndex, element };
  return null;
}

export async function evaluatePublicRoundtrip({
  manifestPath,
  outputPath,
  toolPath = DEFAULT_TOOL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8"));
  if (manifest.contractVersion !== "1.0" || !Array.isArray(manifest.decks))
    throw new Error("A corpus 1.0 manifest with decks is required.");
  const absoluteTool = path.resolve(toolPath);
  await fs.access(absoluteTool);
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "spellbook-public-roundtrip-"),
  );
  const decks = [];

  try {
    for (const [index, deck] of manifest.decks.entries()) {
      const source = path.resolve(manifestDirectory, deck.source);
      const deckDirectory = path.join(workspace, safeName(deck.id));
      await fs.mkdir(deckDirectory, { recursive: true, mode: 0o700 });
      const graphPath = path.join(deckDirectory, "graph.json");
      const candidatePath = path.join(deckDirectory, "candidate.pptx");
      const commandPath = path.join(deckDirectory, "command.json");
      const sourceBefore = await sha256(source);
      const result = {
        id: deck.id,
        categories: deck.categories,
        sourceSha256: sourceBefore,
        status: "failed",
        slides: 0,
        editableElements: 0,
        changedParts: [],
        warnings: [],
        error: null,
      };

      try {
        requireTool(absoluteTool, ["inspect", source, graphPath], timeoutMs);
        const graph = JSON.parse(await fs.readFile(graphPath, "utf8"));
        result.slides = graph.slides?.length ?? 0;
        result.editableElements = (graph.slides ?? []).reduce(
          (sum, slide) =>
            sum +
            (slide.elements ?? []).filter((element) => element.editable).length,
          0,
        );
        result.warnings = graph.warnings ?? [];
        const selected = selectEditableTextElement(graph);
        if (!selected) {
          result.status = "inspected-read-only";
        } else {
          const command = {
            contractVersion: "1.0",
            baseDocumentSha256: graph.documentSha256,
            summary: "Public corpus single-shape round-trip verification",
            commands: [
              {
                op: "replace_text",
                target: {
                  slideIndex: selected.slideIndex,
                  elementId: selected.element.elementId,
                  sourceHash: selected.element.sourceHash,
                },
                text: "Spellbook round-trip verification",
              },
            ],
          };
          await fs.writeFile(
            commandPath,
            `${JSON.stringify(command, null, 2)}\n`,
            {
              mode: 0o600,
            },
          );
          const patch = requireTool(
            absoluteTool,
            ["patch", source, commandPath, candidatePath],
            timeoutMs,
          );
          const patchResult = JSON.parse(patch.stdout);
          result.changedParts = patchResult.validation?.changedParts ?? [];
          result.warnings = [
            ...result.warnings,
            ...(patchResult.validation?.warnings ?? []),
          ];
          if (patchResult.validation?.valid !== true)
            throw new Error(
              `Candidate validation failed: ${(patchResult.validation?.errors ?? []).join(" ")}`,
            );
          if (
            result.changedParts.length !== 1 ||
            !result.changedParts[0].startsWith("ppt/slides/slide")
          )
            throw new Error(
              `Unexpected changed parts: ${result.changedParts.join(", ") || "none"}`,
            );
          result.status = "patched-one-slide";
        }

        const sourceAfter = await sha256(source);
        if (sourceAfter !== sourceBefore)
          throw new Error("The public source PPTX changed during evaluation.");
      } catch (error) {
        result.error = compactError(error);
      }
      decks.push(result);
      console.log(
        `[roundtrip] ${index + 1}/${manifest.decks.length} ${deck.id}: ${result.status}${result.error ? ` (${result.error})` : ""}`,
      );
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }

  const report = {
    contractVersion: "1.0",
    corpusId: manifest.corpusId,
    generatedAt: new Date().toISOString(),
    tool: absoluteTool,
    summary: {
      decks: decks.length,
      patched: decks.filter((deck) => deck.status === "patched-one-slide")
        .length,
      inspectedReadOnly: decks.filter(
        (deck) => deck.status === "inspected-read-only",
      ).length,
      failed: decks.filter((deck) => deck.status === "failed").length,
    },
    decks,
  };
  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), {
    recursive: true,
    mode: 0o700,
  });
  const temporaryOutput = `${absoluteOutput}.tmp-${process.pid}`;
  await fs.writeFile(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporaryOutput, absoluteOutput);
  return { output: absoluteOutput, summary: report.summary };
}

function requireTool(tool, args, timeoutMs) {
  const result = spawnSync("dotnet", [tool, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      [result.error?.message, result.stderr, result.stdout]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 1600) || `document tool exited with ${result.status}`,
    );
  return result;
}

async function sha256(file) {
  return createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function compactError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1600);
}

function parseArguments(argv) {
  const parsed = {
    manifest: ".tmp-eval/public-corpus.json",
    output: ".tmp-eval/results/public-pptx-feature-corpus-roundtrip.json",
    tool: DEFAULT_TOOL,
    timeout_ms: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (["--manifest", "--output", "--tool"].includes(value))
      parsed[value.slice(2)] = argv[++index];
    else if (value === "--timeout-ms")
      parsed.timeout_ms = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(parsed.timeout_ms) || parsed.timeout_ms < 10_000)
    throw new Error("--timeout-ms must be an integer of at least 10000.");
  return {
    manifestPath: parsed.manifest,
    outputPath: parsed.output,
    toolPath: parsed.tool,
    timeoutMs: parsed.timeout_ms,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await evaluatePublicRoundtrip(
      parseArguments(process.argv.slice(2)),
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.summary.failed > 0) process.exitCode = 2;
  } catch (error) {
    console.error(compactError(error));
    process.exitCode = 1;
  }
}
