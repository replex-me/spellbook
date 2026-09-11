import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Representative public fixtures, not a claim that every feature of every PPTX
// is supported. Inputs stay untouched; candidates and receipts are inspectable.
const root = path.resolve(".tmp-runtime-validation/extended-public");
await fs.mkdir(root, { recursive: true });
const manifestPath = path.resolve(".tmp-eval/public-corpus.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const tool = path.resolve(
  "services/document-worker/tools/Spellbook.Document.Tool/bin/Release/net10.0/Spellbook.Document.Tool.dll",
);
const cases = [
  ["lo-placeholders", "move_shape", "shape"],
  ["lo-picture-crop", "crop_image", "picture"],
  ["lo-table-borders", "set_table_cell", "table"],
  ["lo-group-rotation", "move_shape", "group"],
  ["ox-typical", "duplicate_slide", null],
  ["lo-shape-picture", "add_slide", null],
  ["lo-shape-lines", "set_line", "shape"],
  ["lo-numbered-list", "set_text_style", "shape"],
];
const results = [];
for (const [id, op, kind] of cases) {
  const deck = manifest.decks.find((deck) => deck.id === id);
  if (!deck) throw new Error(`Missing public fixture ${id}`);
  const input = path.resolve(path.dirname(manifestPath), deck.source);
  const directory = path.join(root, `${id}-${op}`);
  await fs.mkdir(directory, { recursive: true });
  const graphPath = path.join(directory, "graph.json");
  const inspected = spawnSync("dotnet", [tool, "inspect", input, graphPath], {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (inspected.status !== 0) throw new Error(inspected.stderr);
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"));
  let command;
  if (op === "duplicate_slide")
    command = { op, slideIndex: 0, insertIndex: graph.slides.length };
  else if (op === "add_slide")
    command = { op, templateSlideIndex: 0, insertIndex: graph.slides.length };
  else {
    const slide = graph.slides.find((slide) =>
      slide.elements.some((e) =>
        kind === "table"
          ? e.tableCells?.length
          : e.kind === kind && (op !== "set_text_style" || e.text),
      ),
    );
    const element = slide?.elements.find((e) =>
      kind === "table"
        ? e.tableCells?.length
        : e.kind === kind && (op !== "set_text_style" || e.text),
    );
    if (!element) throw new Error(`Fixture ${id} has no ${kind}`);
    const target = {
      slideIndex: slide.slideIndex,
      elementId: element.elementId,
      sourceHash: element.sourceHash,
    };
    command = {
      op,
      target,
      ...(op === "move_shape"
        ? { x: element.x + 100, y: element.y + 100 }
        : op === "crop_image"
          ? { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }
          : op === "set_table_cell"
            ? { row: 0, column: 0, text: "표 편집 검증" }
            : op === "set_line"
              ? { rgb: "2266AA", width: 2 }
              : { fontSize: 24, bold: true }),
    };
  }
  const commandPath = path.join(directory, "command.json");
  await fs.writeFile(
    commandPath,
    JSON.stringify({
      contractVersion: "1.0",
      baseDocumentSha256: graph.documentSha256,
      summary: "Public extended editing verification",
      commands: [command],
    }),
  );
  const patched = spawnSync(
    "dotnet",
    [tool, "patch", input, commandPath, path.join(directory, "candidate.pptx")],
    { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
  );
  await fs.writeFile(
    path.join(directory, "result.txt"),
    patched.stdout + patched.stderr,
  );
  results.push({
    id,
    op,
    passed: patched.status === 0,
    error: patched.status === 0 ? null : patched.stderr.slice(0, 1200),
  });
  console.log(`${id} ${op}: ${patched.status === 0 ? "PASS" : "FAIL"}`);
}
await fs.writeFile(
  path.join(root, "receipt.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);
if (results.some((result) => !result.passed)) process.exitCode = 1;
