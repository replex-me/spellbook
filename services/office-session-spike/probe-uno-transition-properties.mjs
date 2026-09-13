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
    cool.callRemote(function probeTransitionPropertyUndo() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const model = desktop.getCurrentFrame().getController().getModel();
      const page = model.getDrawPages().getByIndex(0);
      const undo = model.getUndoManager();
      const equal = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
      const typeFor = (name) => {
        const typeName = String(
          page.getPropertySetInfo().getPropertyByName(name).Type,
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
      const cases = [
        ["TransitionType", 1],
        ["TransitionSubtype", 1],
        ["TransitionDirection", false],
        ["TransitionDuration", 1.25],
        ["TransitionFadeColor", 16711935],
      ];
      const results = [];
      for (const [name, preferred] of cases) {
        const undoBefore = undo.getAllUndoActionTitles().length;
        const before = page.getPropertyValue(name);
        const requested = equal(before, preferred)
          ? typeof preferred === "boolean"
            ? !preferred
            : preferred + 1
          : preferred;
        let contextOpen = false;
        try {
          const type = typeFor(name);
          if (!type) throw new Error(`unsupported_type:${name}`);
          undo.enterUndoContext(`Probe ${name}`);
          contextOpen = true;
          page.setPropertyValue(name, new uno.Any(type, requested));
          undo.leaveUndoContext();
          contextOpen = false;
          const after = page.getPropertyValue(name);
          const undoAdded = undo.getAllUndoActionTitles().length - undoBefore;
          if (undoAdded > 0) undo.undo();
          const restored = page.getPropertyValue(name);
          if (undoAdded > 0) undo.redo();
          const redone = page.getPropertyValue(name);
          if (undoAdded > 0) undo.undo();
          else page.setPropertyValue(name, new uno.Any(type, before));
          results.push({
            name,
            type: String(
              page.getPropertySetInfo().getPropertyByName(name).Type,
            ),
            before,
            requested,
            after,
            undoAdded,
            applied: equal(after, requested),
            undoExact: undoAdded > 0 && equal(restored, before),
            redoExact: undoAdded > 0 && equal(redone, after),
          });
        } catch (error) {
          if (contextOpen)
            try {
              undo.leaveUndoContext();
            } catch (_) {}
          while (undo.getAllUndoActionTitles().length > undoBefore) undo.undo();
          results.push({ name, before, requested, error: error.message });
        }
      }
      return { results };
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
