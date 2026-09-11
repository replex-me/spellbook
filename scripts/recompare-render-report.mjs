import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessCorpus,
  compareImages,
  detectImageMagick,
} from "./evaluate-render-corpus.mjs";

export async function recompareRenderReport({
  reportPath,
  inputRoot,
  renderRoot,
  outputPath,
}) {
  const report = JSON.parse(
    await fs.readFile(path.resolve(reportPath), "utf8"),
  );
  const absoluteInputRoot = path.resolve(inputRoot);
  const absoluteRenderRoot = path.resolve(renderRoot);
  const imageMagick = detectImageMagick();
  if (!imageMagick) throw new Error("ImageMagick is required.");
  let compared = 0;

  for (const deck of report.decks ?? []) {
    for (const slide of deck.slides ?? []) {
      if (!slide.reference?.path || !slide.rendered) continue;
      const reference = path.join(absoluteInputRoot, slide.reference.path);
      const rendered = path.join(absoluteRenderRoot, slide.rendered);
      await fs.access(reference);
      await fs.access(rendered);
      slide.reference.exists = true;
      slide.comparison = compareImages(reference, rendered, imageMagick);
      compared += 1;
    }
  }

  report.recomparedAt = new Date().toISOString();
  report.recomparisonEnvironment = {
    platform: process.platform,
    architecture: process.arch,
    imageMagick,
  };
  report.gate = assessCorpus(report, report.decks ?? []);
  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  return { output: absoluteOutput, compared };
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (
      ["--report", "--input-root", "--render-root", "--output"].includes(value)
    )
      parsed[value.slice(2).replaceAll("-", "_")] = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (
    !parsed.report ||
    !parsed.input_root ||
    !parsed.render_root ||
    !parsed.output
  )
    throw new Error(
      "Usage: --report <report.json> --input-root <staged-input> --render-root <downloaded-output> --output <report.json>",
    );
  return {
    reportPath: parsed.report,
    inputRoot: parsed.input_root,
    renderRoot: parsed.render_root,
    outputPath: parsed.output,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        await recompareRenderReport(parseArguments(process.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
