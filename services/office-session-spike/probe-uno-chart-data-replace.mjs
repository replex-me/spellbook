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
    cool.callRemote(function probeChartDataObjectReplacement() {
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
      const chartForShape = (shape) => {
        try {
          const model = shape.getPropertyValue("Model");
          return model
            .getSupportedServiceNames()
            .includes("com.sun.star.chart2.ChartDocument")
            ? model
            : null;
        } catch (_) {
          return null;
        }
      };
      const locateChart = () => {
        for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
          const slide = pages.getByIndex(slideIndex);
          for (
            let shapeIndex = 0;
            shapeIndex < slide.getCount();
            shapeIndex++
          ) {
            const shape = slide.getByIndex(shapeIndex);
            const chart = chartForShape(shape);
            if (chart) return { slideIndex, slide, shapeIndex, shape, chart };
          }
        }
        throw new Error("chart_not_found");
      };
      const identity = ({ slideIndex, shapeIndex, shape, chart }) => ({
        slideIndex,
        shapeIndex,
        name: shape.getName(),
        shapeType: shape.getShapeType(),
        position: shape.getPosition(),
        size: shape.getSize(),
        data: chart
          .getDataProvider()
          .getData()
          .map((row) => [...row]),
        rowDescriptions: [...chart.getDataProvider().getRowDescriptions()],
        columnDescriptions: [
          ...chart.getDataProvider().getColumnDescriptions(),
        ],
      });
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      const originalChart = locateChart();
      const before = identity(originalChart);
      const changedData = before.data.map((row) => [...row]);
      changedData[0][0] += 1;
      const provider = originalChart.chart.getDataProvider();

      // Prepare the complete changed chart on the native clipboard, then put
      // the original live object back before the one-action replacement.
      provider.setData(changedData);
      controller.select(originalChart.shape);
      dispatch(".uno:Copy");
      provider.setData(before.data);

      const undo = presentation.getUndoManager();
      const undoBefore = undo.getAllUndoActionTitles().length;
      undo.enterUndoContext("Edit chart data");
      controller.select(originalChart.shape);
      dispatch(".uno:Delete");
      dispatch(".uno:Paste");
      const replacement = locateChart();
      const pasted = identity(replacement);
      controller.select(replacement.shape);
      dispatch(".uno:TransformDialog", [
        prop("TransformPosX", uno.type.long, before.position.X),
        prop("TransformPosY", uno.type.long, before.position.Y),
      ]);
      undo.leaveUndoContext();

      const after = identity(locateChart());
      const undoActionsAdded =
        undo.getAllUndoActionTitles().length - undoBefore;
      undo.undo();
      const restored = identity(locateChart());
      undo.redo();
      const redone = identity(locateChart());
      undo.undo();
      const final = identity(locateChart());

      return {
        applied: equal(after.data, changedData),
        undoActionsAdded,
        undoExact: equal(restored, before),
        redoExact: equal(redone, after),
        finalRestored: equal(final, before),
        identity: {
          before: {
            name: before.name,
            shapeIndex: before.shapeIndex,
            position: before.position,
            size: before.size,
          },
          after: {
            name: after.name,
            shapeIndex: after.shapeIndex,
            position: after.position,
            size: after.size,
          },
          pasted: {
            name: pasted.name,
            shapeIndex: pasted.shapeIndex,
            position: pasted.position,
            size: pasted.size,
          },
        },
        expectedFinal: before,
      };
    }),
  );
  await page.waitForTimeout(1_500);
  const settled = await extensionFrame.evaluate(() =>
    cool.callRemote(function readSettledChartIdentity() {
      const model = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      )
        .getCurrentFrame()
        .getController()
        .getModel();
      const pages = model.getDrawPages();
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
            return {
              slideIndex,
              shapeIndex,
              name: shape.getName(),
              shapeType: shape.getShapeType(),
              position: shape.getPosition(),
              size: shape.getSize(),
              data: chart
                .getDataProvider()
                .getData()
                .map((row) => [...row]),
              rowDescriptions: [
                ...chart.getDataProvider().getRowDescriptions(),
              ],
              columnDescriptions: [
                ...chart.getDataProvider().getColumnDescriptions(),
              ],
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
    `${JSON.stringify(
      { ...report, finalRestoredAfterSettle, settledIdentity: settled },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
