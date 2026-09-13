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
    cool.callRemote(function probeChartTypeUndoDomain() {
      const presentation = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      )
        .getCurrentFrame()
        .getController()
        .getModel();
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
            const candidate = slide
              .getByIndex(shapeIndex)
              .getPropertyValue("Model");
            if (
              candidate
                .getSupportedServiceNames()
                .includes("com.sun.star.chart2.ChartDocument")
            ) {
              chart = candidate;
              break;
            }
          } catch (_) {}
        }
      }
      if (!chart) throw new Error("chart_not_found");

      const chartTypes = () =>
        chart
          .getFirstDiagram()
          .getCoordinateSystems()
          .flatMap((coordinateSystem) =>
            coordinateSystem
              .getChartTypes()
              .map((chartType) => chartType.getChartType()),
          );
      const originalDiagram = chart.getDiagram();
      const before = chartTypes();
      const presentationUndo = presentation.getUndoManager();
      const chartUndo = chart.getUndoManager();
      const presentationBefore =
        presentationUndo.getAllUndoActionTitles().length;
      const chartBefore = chartUndo.getAllUndoActionTitles().length;
      const replacementDiagram = chart.createInstance(
        "com.sun.star.chart.LineDiagram",
      );
      chart.setDiagram(replacementDiagram);
      const after = chartTypes();
      const presentationAdded =
        presentationUndo.getAllUndoActionTitles().length - presentationBefore;
      const chartAdded =
        chartUndo.getAllUndoActionTitles().length - chartBefore;
      let undoDomain = "none";
      let restored = null;
      let redone = null;
      if (presentationAdded > 0) {
        undoDomain = "presentation";
        presentationUndo.undo();
        restored = chartTypes();
        presentationUndo.redo();
        redone = chartTypes();
        presentationUndo.undo();
      } else if (chartAdded > 0) {
        undoDomain = "chart";
        chartUndo.undo();
        restored = chartTypes();
        chartUndo.redo();
        redone = chartTypes();
        chartUndo.undo();
      } else {
        chart.setDiagram(originalDiagram);
        restored = chartTypes();
      }
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      return {
        before,
        after,
        applied: !equal(after, before),
        presentationUndoActionsAdded: presentationAdded,
        chartUndoActionsAdded: chartAdded,
        undoDomain,
        undoExact: equal(restored, before),
        redoExact: redone !== null && equal(redone, after),
        finalRestored: equal(chartTypes(), before),
      };
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
