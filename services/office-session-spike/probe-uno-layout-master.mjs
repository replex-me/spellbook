import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const reportPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const browser = await chromium.launch({ headless: true });
const stable = (value) => JSON.stringify(value);

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  while (
    !page
      .frames()
      .some((frame) =>
        frame.url().includes("/extensions/org.spellbook.editor/"),
      )
  ) {
    if (Date.now() >= deadline)
      throw new Error("Native editor extension did not connect.");
    await page.waitForTimeout(250);
  }
  const call = (request) =>
    page.evaluate(async (input) => {
      const launch = window.__spellbookLaunch;
      const response = await fetch("/native/probe", {
        method: "POST",
        headers: {
          authorization: `Bearer ${launch.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? `HTTP ${response.status}`);
      return value;
    }, request);
  const history = (direction = null) => {
    const frame = page
      .frames()
      .find((candidate) =>
        candidate.url().includes("/extensions/org.spellbook.editor/"),
      );
    if (!frame) throw new Error("Native extension frame was lost.");
    return frame.evaluate(
      (requestedDirection) =>
        cool.callRemote(function spellbookLayoutHistory(value) {
          const undo = uno.idl.com.sun.star.frame.Desktop.create(
            uno.componentContext,
          )
            .getCurrentFrame()
            .getController()
            .getModel()
            .getUndoManager();
          if (value === "undo") undo.undo();
          else if (value === "redo") undo.redo();
          else if (value !== null) throw new Error("invalid_history_direction");
          return {
            undo: undo.getAllUndoActionTitles(),
            redo: undo.getAllRedoActionTitles(),
          };
        }, requestedDirection),
      direction,
    );
  };
  const waitForState = async (expected, label) => {
    const stop = Date.now() + 10_000;
    let observed;
    do {
      observed = await call({ operation: "observe" });
      if (
        observed.revision === expected.revision &&
        stable(observed.slides) === stable(expected.slides) &&
        stable(observed.masters) === stable(expected.masters)
      )
        return observed;
      await page.waitForTimeout(100);
    } while (Date.now() < stop);
    throw new Error(`${label} did not restore every slide and master exactly.`);
  };

  const before = await call({ operation: "observe" });
  const patchLevelMatch = /^undo-v([1-9][0-9]*)$/.exec(
    before.engine?.patchLevel ?? "",
  );
  if (!patchLevelMatch || Number(patchLevelMatch[1]) < 12)
    throw new Error("The slide-layout master repair is unavailable.");
  const slideIndex = before.activeSlide;
  const targetMaster = before.masters.find(
    (candidate) =>
      candidate.masterIndex !== before.slides[slideIndex].masterIndex,
  );
  if (!targetMaster) throw new Error("No alternate slide layout exists.");
  const { masterIndex, layout } = targetMaster;
  const historyBefore = await history();
  const after = await call({
    operation: "edit_batch",
    expectedRevision: before.revision,
    expectedSlides: stable(before.slides),
    commands: [{ op: "set_slide_layout", slideIndex, masterIndex, layout }],
    dryRun: false,
    permission: { mode: "document", slideIndexes: [], elementIds: [] },
  });
  const historyAfter = await history();
  if (
    after.slides[slideIndex].layout !== layout ||
    after.slides[slideIndex].masterIndex !== masterIndex ||
    after.slides[slideIndex].masterName !== targetMaster.name ||
    after.revision === before.revision ||
    after.transaction?.status !== "applied" ||
    after.transaction?.commandCount !== 1 ||
    after.transaction?.undoActionsAdded !== 1 ||
    historyAfter.undo.length !== historyBefore.undo.length + 1
  )
    throw new Error("Slide layout did not apply as one native Undo action.");

  await history("undo");
  await waitForState(before, "Slide layout Undo");
  await history("redo");
  const redone = await waitForState(after, "Slide layout Redo");

  if (process.env.SPELLBOOK_PROBE_SCREENSHOT) {
    const image = redone.images?.[0];
    if (!image?.pngBytes?.length)
      throw new Error("Slide layout returned no verification image.");
    await writeFile(
      path.resolve(process.env.SPELLBOOK_PROBE_SCREENSHOT),
      Buffer.from(image.pngBytes),
    );
  }
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "저장 확인 중…" }).waitFor({
    timeout: 20_000,
  });

  const report = {
    enginePatchLevel: redone.engine.patchLevel,
    operation: "set_slide_layout",
    atomic: true,
    undoExact: true,
    redoExact: true,
    persistenceBefore: {
      slides: before.slides,
      masters: before.masters,
    },
    persistenceExpected: {
      slideIndex,
      masterIndex,
      masterName: targetMaster.name,
      layout,
      slides: redone.slides,
      masters: redone.masters,
    },
  };
  if (reportPath)
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
