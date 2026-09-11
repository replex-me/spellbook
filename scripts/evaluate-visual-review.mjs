import fs from "node:fs/promises";
import path from "node:path";
import { EditRunner } from "../apps/ai-worker/dist/edit-runner.js";
import { SessionManager } from "../apps/ai-worker/dist/session-manager.js";

// Opt-in integration evaluation: uses the configured user's connected subscription.
// Images and graphs are local evaluation artifacts; no product jobs are created.
const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath)
  throw new Error(
    "Usage: node scripts/evaluate-visual-review.mjs manifest.json output.json",
  );
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.cases) || !manifest.cases.length || !manifest.email)
  throw new Error("An email and nonempty evaluation case list are required.");
for (const item of manifest.cases) {
  if (typeof item.expectedApproved !== "boolean")
    throw new Error("Expected verdict required.");
  for (const file of [item.graph, item.before, item.after])
    await fs.access(file);
}
const sessions = new SessionManager();
const client = await sessions.client(manifest.email);
const results = [];
try {
  for (const item of manifest.cases) {
    const storage = {
      bucket: () => ({
        file: (name) => ({
          download: async ({ destination }) => {
            if (name === "validation") {
              await fs.writeFile(
                destination,
                JSON.stringify({ valid: true, errors: [] }),
              );
            } else {
              await fs.copyFile(name, destination);
            }
          },
        }),
      }),
    };
    const started = Date.now();
    try {
      const review = await new EditRunner(sessions, storage).run({
        jobId: item.id,
        callbackUrl: "",
        mode: "review",
        email: manifest.email,
        bucket: "local-evaluation",
        requestText: item.requestText,
        selectedElementIds: [],
        selectedSlideIndexes: [item.slideIndex],
        baseGraphObject: item.graph,
        candidateGraphObject: item.graph,
        basePreviewObjects: [item.before],
        candidatePreviewObjects: [item.after],
        validationObject: "validation",
      });
      results.push({
        id: item.id,
        expectedApproved: item.expectedApproved,
        matched: review.approved === item.expectedApproved,
        review,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        id: item.id,
        expectedApproved: item.expectedApproved,
        matched: false,
        error: error.message,
        elapsedMs: Date.now() - started,
      });
    }
    await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          contractVersion: "1.0",
          createdAt: new Date().toISOString(),
          note: "Small diagnostic set; not a population detection-rate estimate. Graphs are held constant to test visual evidence.",
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        id: item.id,
        matched: results.at(-1).matched,
        approved: results.at(-1).review?.approved,
        error: results.at(-1).error,
      }),
    );
  }
} finally {
  client.close();
}
if (results.some((result) => !result.matched)) process.exitCode = 1;
