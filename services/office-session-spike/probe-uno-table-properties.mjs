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
    cool.callRemote(function probeTablePropertyUndo() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const model = desktop.getCurrentFrame().getController().getModel();
      const pages = model.getDrawPages();
      let shape = null;
      for (
        let pageIndex = 0;
        pageIndex < pages.getCount() && !shape;
        pageIndex++
      ) {
        const page = pages.getByIndex(pageIndex);
        for (let shapeIndex = 0; shapeIndex < page.getCount(); shapeIndex++) {
          const candidate = page.getByIndex(shapeIndex);
          if (String(candidate.getShapeType()).endsWith("TableShape")) {
            shape = candidate;
            break;
          }
        }
      }
      if (!shape) throw new Error("table_not_found");
      const table = shape.getPropertyValue("Model");
      const cell = table.getCellByPosition(0, 0);
      const cursor = cell.createTextCursor();
      cursor.gotoEnd(true);
      const undo = model.getUndoManager();
      const typeFor = (target, name) => {
        const typeName = String(
          target.getPropertySetInfo().getPropertyByName(name).Type,
        );
        return {
          boolean: uno.type.boolean,
          byte: uno.type.byte,
          short: uno.type.short,
          long: uno.type.long,
          float: uno.type.float,
          double: uno.type.double,
          string: uno.type.string,
        }[typeName];
      };
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      const cases = [
        ["cell", "FillColor", 65280],
        ["cell", "FillTransparence", 27],
        ["cell", "CharColor", 16711680],
        ["cell", "CharHeight", 20],
        ["cell", "CharWeight", 150],
        ["cell", "CharUnderline", 1],
        ["cell", "CharKerning", 100],
        ["cell", "ParaAdjust", 3],
        ["cell", "TextLeftDistance", 180],
        ["cursor", "CharColor", 255],
        ["cursor", "CharHeight", 18],
        ["cursor", "CharWeight", 150],
        ["cursor", "CharUnderline", 1],
        ["cursor", "CharKerning", 125],
      ];
      const properties = {
        cell: cell
          .getPropertySetInfo()
          .getProperties()
          .map((property) => ({
            name: property.Name,
            type: String(property.Type),
            attributes: property.Attributes,
          })),
        cursor: cursor
          .getPropertySetInfo()
          .getProperties()
          .map((property) => ({
            name: property.Name,
            type: String(property.Type),
            attributes: property.Attributes,
          })),
      };
      const results = [];
      for (const [targetKind, name, requested] of cases) {
        const target = targetKind === "cell" ? cell : cursor;
        const undoBefore = undo.getAllUndoActionTitles().length;
        let before;
        let contextOpen = false;
        try {
          before = target.getPropertyValue(name);
          const value = equal(requested, before)
            ? typeof requested === "number"
              ? requested + 1
              : requested
            : requested;
          const unoType = typeFor(target, name);
          if (!unoType) throw new Error(`unsupported_type:${name}`);
          undo.enterUndoContext(`Probe table ${name}`);
          contextOpen = true;
          target.setPropertyValue(name, new uno.Any(unoType, value));
          undo.leaveUndoContext();
          contextOpen = false;
          const after = target.getPropertyValue(name);
          const undoAdded = undo.getAllUndoActionTitles().length - undoBefore;
          if (undoAdded > 0) undo.undo();
          const restored = target.getPropertyValue(name);
          if (undoAdded > 0) undo.redo();
          const redone = target.getPropertyValue(name);
          if (undoAdded > 0) undo.undo();
          else target.setPropertyValue(name, new uno.Any(unoType, before));
          results.push({
            target: targetKind,
            name,
            before,
            requested: value,
            after,
            undoAdded,
            applied: equal(after, value),
            undoExact: undoAdded > 0 && equal(restored, before),
            redoExact: undoAdded > 0 && equal(redone, after),
          });
        } catch (error) {
          if (contextOpen)
            try {
              undo.leaveUndoContext();
            } catch (_) {}
          while (undo.getAllUndoActionTitles().length > undoBefore) undo.undo();
          results.push({
            target: targetKind,
            name,
            error: error.message,
          });
        }
      }
      const borderSummary = (value) => ({
        color: Number(value.Color),
        innerWidth: Number(value.InnerLineWidth),
        outerWidth: Number(value.OuterLineWidth),
        distance: Number(value.LineDistance),
        style: value.LineStyle === undefined ? null : Number(value.LineStyle),
        width: value.LineWidth === undefined ? null : Number(value.LineWidth),
      });
      const borderResults = [];
      for (const name of [
        "TopBorder",
        "RightBorder",
        "BottomBorder",
        "LeftBorder",
      ]) {
        const undoBefore = undo.getAllUndoActionTitles().length;
        const before = cell.getPropertyValue(name);
        const beforeSummary = borderSummary(before);
        const requested = {
          Color: beforeSummary.color === 16711935 ? 65535 : 16711935,
          InnerLineWidth: 0,
          OuterLineWidth: beforeSummary.outerWidth === 127 ? 106 : 127,
          LineDistance: 0,
        };
        const border = (value) =>
          new uno.idl.com.sun.star.table.BorderLine({
            Color: value.Color ?? value.color,
            InnerLineWidth: value.InnerLineWidth ?? value.innerWidth,
            OuterLineWidth: value.OuterLineWidth ?? value.outerWidth,
            LineDistance: value.LineDistance ?? value.distance,
          });
        let contextOpen = false;
        try {
          undo.enterUndoContext(`Probe table ${name}`);
          contextOpen = true;
          cell.setPropertyValue(name, border(requested));
          undo.leaveUndoContext();
          contextOpen = false;
          const afterSummary = borderSummary(cell.getPropertyValue(name));
          const undoAdded = undo.getAllUndoActionTitles().length - undoBefore;
          if (undoAdded > 0) undo.undo();
          const restoredSummary = borderSummary(cell.getPropertyValue(name));
          if (undoAdded > 0) undo.redo();
          const redoneSummary = borderSummary(cell.getPropertyValue(name));
          if (undoAdded > 0) undo.undo();
          else cell.setPropertyValue(name, before);
          borderResults.push({
            name,
            before: beforeSummary,
            requested,
            after: afterSummary,
            undoAdded,
            applied:
              afterSummary.color === requested.Color &&
              afterSummary.outerWidth === requested.OuterLineWidth,
            undoExact: undoAdded > 0 && equal(restoredSummary, beforeSummary),
            redoExact: undoAdded > 0 && equal(redoneSummary, afterSummary),
          });
        } catch (error) {
          if (contextOpen)
            try {
              undo.leaveUndoContext();
            } catch (_) {}
          while (undo.getAllUndoActionTitles().length > undoBefore) undo.undo();
          borderResults.push({ name, error: error.message });
        }
      }
      return {
        properties,
        samples: Object.fromEntries(
          ["TopBorder", "RightBorder", "BottomBorder", "LeftBorder"].map(
            (name) => [name, cell.getPropertyValue(name)],
          ),
        ),
        results,
        borderResults,
      };
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
