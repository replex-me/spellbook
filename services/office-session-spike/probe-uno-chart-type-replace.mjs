import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const requestedService = process.argv[3] ?? "com.sun.star.chart.LineDiagram";
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

  const result = await extensionFrame.evaluate(
    (serviceName) =>
      cool.callRemote(function probeChartTypeReplacement(serviceName) {
        const frame = uno.idl.com.sun.star.frame.Desktop.create(
          uno.componentContext,
        ).getCurrentFrame();
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
        const locateCharts = () => {
          const charts = [];
          for (
            let slideIndex = 0;
            slideIndex < pages.getCount();
            slideIndex++
          ) {
            const slide = pages.getByIndex(slideIndex);
            for (
              let shapeIndex = 0;
              shapeIndex < slide.getCount();
              shapeIndex++
            ) {
              const shape = slide.getByIndex(shapeIndex);
              const chart = chartForShape(shape);
              if (chart)
                charts.push({ slideIndex, slide, shapeIndex, shape, chart });
            }
          }
          return charts;
        };
        const chartTypes = (chart) =>
          chart
            .getFirstDiagram()
            .getCoordinateSystems()
            .flatMap((coordinateSystem) =>
              coordinateSystem
                .getChartTypes()
                .map((chartType) => chartType.getChartType()),
            );
        const identity = ({ slideIndex, shapeIndex, shape, chart }) => {
          const provider = chart.getDataProvider();
          const series = chart
            .getFirstDiagram()
            .getCoordinateSystems()
            .flatMap((coordinateSystem) =>
              coordinateSystem.getChartTypes().flatMap((chartType) =>
                chartType.getDataSeries().map((dataSeries) => ({
                  sequences: dataSeries
                    .getDataSequences()
                    .map((labeled) => {
                      const values = labeled.getValues();
                      const label = labeled.getLabel();
                      return {
                        role: values.getPropertyValue("Role"),
                        sourceRange: values.getSourceRangeRepresentation(),
                        label: label ? [...label.getData()] : null,
                        labelSourceRange: label
                          ? label.getSourceRangeRepresentation()
                          : null,
                      };
                    })
                    .sort((left, right) =>
                      `${left.role}\u0000${left.sourceRange}`.localeCompare(
                        `${right.role}\u0000${right.sourceRange}`,
                      ),
                    ),
                })),
              ),
            );
          const xValueColumns = new Set(
            series.flatMap((dataSeries) =>
              dataSeries.sequences
                .filter((sequence) => sequence.role === "values-x")
                .map((sequence) => Number(sequence.sourceRange)),
            ),
          );
          const rowDescriptions = [...provider.getRowDescriptions()];
          return {
            slideIndex,
            shapeIndex,
            name: shape.getName(),
            position: shape.getPosition(),
            size: shape.getSize(),
            chartTypes: chartTypes(chart),
            axes: chart
              .getFirstDiagram()
              .getCoordinateSystems()
              .flatMap((coordinateSystem) =>
                [0, 1].map((dimension) => {
                  const axis = coordinateSystem.getAxisByDimension(
                    dimension,
                    0,
                  );
                  return {
                    dimension,
                    numberFormat: axis.getPropertyValue("NumberFormat"),
                    linkNumberFormatToSource: axis.getPropertyValue(
                      "LinkNumberFormatToSource",
                    ),
                  };
                }),
              ),
            series,
            data: provider.getData().map((row) => [...row]),
            rowDescriptions: rowDescriptions.some(Boolean)
              ? rowDescriptions
              : [],
            columnDescriptions: [...provider.getColumnDescriptions()].map(
              (description, index) =>
                xValueColumns.has(index) ? "" : description,
            ),
          };
        };
        const semanticSeries = (snapshot) =>
          snapshot.series.map((series, seriesIndex) => {
            const values =
              series.sequences.find(
                (sequence) => sequence.role === "values-y",
              ) ?? series.sequences[0];
            const column = Number(values.sourceRange);
            return {
              label:
                values.label?.[0] ??
                snapshot.columnDescriptions[column] ??
                `Series ${seriesIndex + 1}`,
              values: snapshot.data.map((row) => row[column]),
            };
          });
        const equal = (left, right) =>
          JSON.stringify(left) === JSON.stringify(right);
        const beforeEntry = locateCharts()[0];
        if (!beforeEntry) throw new Error("chart_not_found");
        // Reading an automatic axis format can materialize the inherited
        // number-format key lazily. Warm the chart once so this diagnostic
        // compares the edit with a stable pre-edit model rather than treating
        // first-read materialization as Undo drift.
        identity(beforeEntry);
        const before = identity(beforeEntry);
        const undo = presentation.getUndoManager();
        const undoBefore = undo.getAllUndoActionTitles().length;

        undo.enterUndoContext("Change chart type");
        controller.select(beforeEntry.shape);
        dispatch(".uno:Copy");
        dispatch(".uno:Paste");
        let workingEntry = locateCharts().find(
          (entry) => !uno.sameUnoObject(entry.shape, beforeEntry.shape),
        );
        if (!workingEntry) throw new Error("chart_copy_not_found");
        const sourceSeries = before.series.map((series, seriesIndex) => {
          const ySequence =
            series.sequences.find((item) => item.role === "values-y") ??
            series.sequences[0];
          const xSequence = series.sequences.find(
            (item) => item.role === "values-x",
          );
          const yColumn = Number(ySequence.sourceRange);
          const xColumn = Number(xSequence?.sourceRange);
          return {
            label:
              ySequence.label?.[0] ??
              before.columnDescriptions[yColumn] ??
              `Series ${seriesIndex + 1}`,
            values: before.data.map((row) => row[yColumn]),
            xValues: Number.isInteger(xColumn)
              ? before.data.map((row) => row[xColumn])
              : null,
          };
        });
        workingEntry.chart.setDiagram(
          workingEntry.chart.createInstance(serviceName),
        );
        if (serviceName === "com.sun.star.chart.XYDiagram") {
          const provider = workingEntry.chart.getDataProvider();
          provider.setData(
            before.data.map((_, rowIndex) =>
              sourceSeries.flatMap((series) => [
                series.values[rowIndex],
                rowIndex + 1,
              ]),
            ),
          );
          provider.setRowDescriptions([]);
          provider.setColumnDescriptions(
            sourceSeries.flatMap((series) => [series.label, ""]),
          );
          const targetSeries = workingEntry.chart
            .getFirstDiagram()
            .getCoordinateSystems()[0]
            .getChartTypes()[0]
            .getDataSeries();
          for (
            let seriesIndex = 0;
            seriesIndex < targetSeries.length;
            seriesIndex++
          ) {
            const labeled = (column, role, withLabel) => {
              const values = provider.createDataSequenceByRangeRepresentation(
                String(column),
              );
              values.setPropertyValue("Role", role);
              const sequence =
                uno.idl.com.sun.star.chart2.data.LabeledDataSequence.create(
                  uno.componentContext,
                );
              sequence.setValues(values);
              if (withLabel)
                sequence.setLabel(
                  provider.createDataSequenceByRangeRepresentation(
                    `label ${column}`,
                  ),
                );
              return sequence;
            };
            targetSeries[seriesIndex].setData([
              labeled(seriesIndex * 2, "values-y", true),
              labeled(seriesIndex * 2 + 1, "values-x", false),
            ]);
          }
        } else {
          const provider = workingEntry.chart.getDataProvider();
          let providerColumnCount = provider
            .getData()
            .reduce((maximum, row) => Math.max(maximum, row.length), 0);
          while (providerColumnCount > sourceSeries.length) {
            provider.deleteSequence(providerColumnCount - 1);
            providerColumnCount--;
          }
          provider.setData(
            before.data.map((_, rowIndex) =>
              sourceSeries.map((series) => series.values[rowIndex]),
            ),
          );
          provider.setRowDescriptions(
            sourceSeries.find((series) => series.xValues)?.xValues ??
              before.rowDescriptions,
          );
          provider.setColumnDescriptions(
            sourceSeries.map((series) => series.label),
          );
          const chartType = workingEntry.chart
            .getFirstDiagram()
            .getCoordinateSystems()[0]
            .getChartTypes()[0];
          const dataSeries = chartType
            .getDataSeries()
            .slice(0, sourceSeries.length);
          chartType.setDataSeries(dataSeries);
          for (
            let seriesIndex = 0;
            seriesIndex < dataSeries.length;
            seriesIndex++
          ) {
            const values = provider.createDataSequenceByRangeRepresentation(
              String(seriesIndex),
            );
            values.setPropertyValue("Role", "values-y");
            const sequence =
              uno.idl.com.sun.star.chart2.data.LabeledDataSequence.create(
                uno.componentContext,
              );
            sequence.setValues(values);
            sequence.setLabel(
              provider.createDataSequenceByRangeRepresentation(
                `label ${seriesIndex}`,
              ),
            );
            dataSeries[seriesIndex].setData([sequence]);
          }
        }
        if (equal(chartTypes(workingEntry.chart), before.chartTypes))
          throw new Error("chart_type_not_changed");

        // Commit a second clipboard snapshot after all direct chart-model
        // changes. Undo/Redo can replay the inserted final object exactly;
        // direct provider changes on the first scratch object are otherwise
        // outside the presentation Undo manager.
        controller.select(workingEntry.shape);
        dispatch(".uno:Copy");
        dispatch(".uno:Delete");
        controller.select(beforeEntry.shape);
        dispatch(".uno:Delete");
        dispatch(".uno:Paste");
        workingEntry = locateCharts()[0];
        workingEntry.shape.setName(before.name);
        controller.select(workingEntry.shape);
        dispatch(".uno:TransformDialog", [
          prop("TransformPosX", uno.type.long, before.position.X),
          prop("TransformPosY", uno.type.long, before.position.Y),
        ]);
        while (workingEntry.shapeIndex > before.shapeIndex) {
          dispatch(".uno:ObjectBackOne");
          workingEntry.shapeIndex--;
        }
        while (workingEntry.shapeIndex < before.shapeIndex) {
          dispatch(".uno:ObjectForwardOne");
          workingEntry.shapeIndex++;
        }
        undo.leaveUndoContext();

        const after = identity(locateCharts()[0]);
        const undoActionsAdded =
          undo.getAllUndoActionTitles().length - undoBefore;
        undo.undo();
        const restored = identity(locateCharts()[0]);
        undo.redo();
        const redone = identity(locateCharts()[0]);
        undo.undo();
        const final = identity(locateCharts()[0]);
        return {
          requestedService: serviceName,
          applied:
            !equal(after.chartTypes, before.chartTypes) &&
            equal(semanticSeries(after), semanticSeries(before)),
          undoActionsAdded,
          undoExact: equal(restored, before),
          redoExact: equal(redone, after),
          finalRestored: equal(final, before),
          before,
          after,
          restored,
          final,
        };
      }, serviceName),
    requestedService,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
