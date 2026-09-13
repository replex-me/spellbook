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
  await page.waitForTimeout(1_000);

  const result = await extensionFrame.evaluate(() =>
    cool.callRemote(function probeChartLabels() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const frame = desktop.getCurrentFrame();
      const controller = frame.getController();
      const presentation = controller.getModel();
      const pages = presentation.getDrawPages();
      const prop = (Name, type, value) =>
        new uno.idl.com.sun.star.beans.PropertyValue({
          Name,
          Value: new uno.Any(type, value),
        });
      const dispatch = (command, args = []) =>
        uno.idl.com.sun.star.frame.DispatchHelper.create(
          uno.componentContext,
        ).executeDispatch(frame, command, "", 0, args);
      const locateChart = () => {
        for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
          const slide = pages.getByIndex(slideIndex);
          for (
            let shapeIndex = 0;
            shapeIndex < slide.getCount();
            shapeIndex++
          ) {
            const shape = slide.getByIndex(shapeIndex);
            try {
              const chart = shape.getPropertyValue("Model");
              if (
                chart
                  .getSupportedServiceNames()
                  .includes("com.sun.star.chart2.ChartDocument")
              )
                return { slideIndex, slide, shapeIndex, shape, chart };
            } catch (_) {}
          }
        }
        throw new Error("chart_not_found");
      };
      const identity = ({ slideIndex, shapeIndex, shape, chart }) => {
        const provider = chart.getDataProvider();
        return {
          slideIndex,
          shapeIndex,
          name: shape.getName(),
          shapeType: shape.getShapeType(),
          position: shape.getPosition(),
          size: shape.getSize(),
          data: provider.getData().map((row) => [...row]),
          rowDescriptions: [...provider.getRowDescriptions()],
          columnDescriptions: [...provider.getColumnDescriptions()],
        };
      };
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      const original = locateChart();
      const before = identity(original);
      if (!before.rowDescriptions.length || !before.columnDescriptions.length)
        throw new Error("chart_labels_not_found");
      const changedRows = [...before.rowDescriptions];
      const changedColumns = [...before.columnDescriptions];
      changedRows[0] = `${changedRows[0]} edited`;
      changedColumns[0] = `${changedColumns[0]} edited`;
      const provider = original.chart.getDataProvider();
      const presentationUndo = presentation.getUndoManager();
      const chartUndo = original.chart.getUndoManager();
      const directPresentationUndoBefore =
        presentationUndo.getAllUndoActionTitles().length;
      const directChartUndoBefore = chartUndo.getAllUndoActionTitles().length;
      provider.setRowDescriptions(changedRows);
      provider.setColumnDescriptions(changedColumns);
      const directChanged = identity(locateChart());
      const directUndo = {
        presentation:
          presentationUndo.getAllUndoActionTitles().length -
          directPresentationUndoBefore,
        chart:
          chartUndo.getAllUndoActionTitles().length - directChartUndoBefore,
      };
      provider.setRowDescriptions(before.rowDescriptions);
      provider.setColumnDescriptions(before.columnDescriptions);
      if (!equal(identity(locateChart()), before))
        throw new Error("direct_label_restore_failed");

      // The production chart operation uses this complete-object replacement
      // because the chart data provider itself does not participate in Undo.
      provider.setRowDescriptions(changedRows);
      provider.setColumnDescriptions(changedColumns);
      controller.select(original.shape);
      dispatch(".uno:Copy");
      provider.setRowDescriptions(before.rowDescriptions);
      provider.setColumnDescriptions(before.columnDescriptions);
      if (!equal(identity(locateChart()), before))
        throw new Error("clipboard_source_restore_failed");

      const undoBefore = presentationUndo.getAllUndoActionTitles().length;
      presentationUndo.enterUndoContext("Edit chart labels");
      controller.select(original.shape);
      dispatch(".uno:Delete");
      dispatch(".uno:Paste");
      const replacement = locateChart();
      controller.select(replacement.shape);
      dispatch(".uno:TransformDialog", [
        prop("TransformPosX", uno.type.long, before.position.X),
        prop("TransformPosY", uno.type.long, before.position.Y),
      ]);
      presentationUndo.leaveUndoContext();

      const after = identity(locateChart());
      const expected = {
        ...before,
        rowDescriptions: changedRows,
        columnDescriptions: changedColumns,
      };
      const undoActionsAdded =
        presentationUndo.getAllUndoActionTitles().length - undoBefore;
      presentationUndo.undo();
      const restored = identity(locateChart());
      presentationUndo.redo();
      const redone = identity(locateChart());
      presentationUndo.undo();
      const final = identity(locateChart());
      return {
        directApplied:
          equal(directChanged.rowDescriptions, changedRows) &&
          equal(directChanged.columnDescriptions, changedColumns),
        directUndo,
        replacementApplied: equal(after, expected),
        undoActionsAdded,
        undoExact: equal(restored, before),
        redoExact: equal(redone, expected),
        finalRestored: equal(final, before),
        expectedFinal: before,
      };
    }),
  );
  await page.waitForTimeout(1_000);
  const settled = await extensionFrame.evaluate(() =>
    cool.callRemote(function readSettledChartLabels() {
      const presentation = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      )
        .getCurrentFrame()
        .getController()
        .getModel();
      const pages = presentation.getDrawPages();
      for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
        const slide = pages.getByIndex(slideIndex);
        for (let shapeIndex = 0; shapeIndex < slide.getCount(); shapeIndex++) {
          const shape = slide.getByIndex(shapeIndex);
          try {
            const chart = shape.getPropertyValue("Model");
            if (
              !chart
                .getSupportedServiceNames()
                .includes("com.sun.star.chart2.ChartDocument")
            )
              continue;
            const provider = chart.getDataProvider();
            return {
              slideIndex,
              shapeIndex,
              name: shape.getName(),
              shapeType: shape.getShapeType(),
              position: shape.getPosition(),
              size: shape.getSize(),
              data: provider.getData().map((row) => [...row]),
              rowDescriptions: [...provider.getRowDescriptions()],
              columnDescriptions: [...provider.getColumnDescriptions()],
            };
          } catch (_) {}
        }
      }
      throw new Error("chart_not_found");
    }),
  );
  const finalRestoredAfterSettle =
    JSON.stringify(settled) === JSON.stringify(result.expectedFinal);
  const { expectedFinal: _, ...report } = result;
  process.stdout.write(
    `${JSON.stringify({ ...report, finalRestoredAfterSettle }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
