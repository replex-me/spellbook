import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  let extensionFrame;
  while (!extensionFrame) {
    extensionFrame = page
      .frames()
      .find((frame) =>
        frame.url().includes("/extensions/org.spellbook.editor/"),
      );
    if (Date.now() >= deadline)
      throw new Error("Native editor extension did not connect.");
    if (!extensionFrame) await page.waitForTimeout(250);
  }

  const result = await extensionFrame.evaluate(() =>
    cool.callRemote(function probeChartDataUndo() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const presentation = desktop.getCurrentFrame().getController().getModel();
      const pages = presentation.getDrawPages();
      let chart = null;
      for (
        let slideIndex = 0;
        slideIndex < pages.getCount() && !chart;
        slideIndex++
      ) {
        const slide = pages.getByIndex(slideIndex);
        for (let shapeIndex = 0; shapeIndex < slide.getCount(); shapeIndex++) {
          try {
            const model = slide
              .getByIndex(shapeIndex)
              .getPropertyValue("Model");
            if (
              model
                .getSupportedServiceNames()
                .includes("com.sun.star.chart2.ChartDocument")
            ) {
              chart = model;
              break;
            }
          } catch (_) {}
        }
      }
      if (!chart) throw new Error("chart_not_found");

      const provider = chart.getDataProvider();
      const original = provider.getData().map((row) => [...row]);
      if (!original.length || !original[0]?.length)
        throw new Error("chart_data_not_found");
      const changed = original.map((row) => [...row]);
      changed[0][0] = original[0][0] + 1;
      const presentationUndo = presentation.getUndoManager();
      const chartUndo = chart.getUndoManager();
      const presentationBefore =
        presentationUndo.getAllUndoActionTitles().length;
      const chartBefore = chartUndo.getAllUndoActionTitles().length;
      provider.setData(changed);
      const after = provider.getData().map((row) => [...row]);
      const presentationAdded =
        presentationUndo.getAllUndoActionTitles().length - presentationBefore;
      const chartAdded =
        chartUndo.getAllUndoActionTitles().length - chartBefore;
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      let undoDomain = "none";
      let restored = null;
      let redone = null;
      if (presentationAdded > 0) {
        undoDomain = "presentation";
        presentationUndo.undo();
        restored = provider.getData().map((row) => [...row]);
        presentationUndo.redo();
        redone = provider.getData().map((row) => [...row]);
        presentationUndo.undo();
      } else if (chartAdded > 0) {
        undoDomain = "chart";
        chartUndo.undo();
        restored = provider.getData().map((row) => [...row]);
        chartUndo.redo();
        redone = provider.getData().map((row) => [...row]);
        chartUndo.undo();
      } else {
        provider.setData(original);
        restored = provider.getData().map((row) => [...row]);
      }

      return {
        originalFirstValue: original[0][0],
        changedFirstValue: changed[0][0],
        applied: equal(after, changed),
        presentationUndoActionsAdded: presentationAdded,
        chartUndoActionsAdded: chartAdded,
        undoDomain,
        undoExact: equal(restored, original),
        redoExact: redone === null ? false : equal(redone, changed),
        finalRestored: equal(provider.getData(), original),
      };
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
