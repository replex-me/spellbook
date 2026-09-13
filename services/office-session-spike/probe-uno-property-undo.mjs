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
  const cases = [
    ["Title", "AI accessible title"],
    ["Description", "AI accessible description"],
    ["TextLeftDistance", 321],
    ["TextRightDistance", 432],
    ["TextUpperDistance", 213],
    ["TextLowerDistance", 342],
    ["CharKerning", 125],
    ["CharEscapement", 33],
    ["CharEscapementHeight", 58],
    ["Shadow", true],
    ["ShadowColor", 3368601],
    ["ShadowTransparence", 37],
    ["ShadowXDistance", 240],
    ["ShadowYDistance", 260],
    ["MoveProtect", true],
    ["SizeProtect", true],
    ["Printable", false],
    ["TextWordWrap", false],
    ["Hyperlink", "https://example.invalid/present"],
  ];
  const result = await extensionFrame.evaluate(
    (propertyCasesJson) =>
      cool.callRemote(function probePropertyUndo(remoteCasesJson) {
        const desktop = uno.idl.com.sun.star.frame.Desktop.create(
          uno.componentContext,
        );
        const frame = desktop.getCurrentFrame();
        const controller = frame.getController();
        const model = controller.getModel();
        const shape = model.getDrawPages().getByIndex(0).getByIndex(0);
        const undo = model.getUndoManager();
        const remoteCases = JSON.parse(remoteCasesJson);
        const typeFor = (name) =>
          ({
            string: uno.type.string,
            boolean: uno.type.boolean,
            byte: uno.type.byte,
            short: uno.type.short,
            long: uno.type.long,
          })[String(shape.getPropertySetInfo().getPropertyByName(name).Type)];
        const equal = (left, right) =>
          JSON.stringify(left) === JSON.stringify(right);
        const results = [];
        for (const [name, requested] of remoteCases) {
          const before = shape.getPropertyValue(name);
          const value =
            typeof requested === "boolean" && requested === before
              ? !requested
              : requested === before && typeof requested === "number"
                ? requested + 1
                : requested === before
                  ? `${requested} updated`
                  : requested;
          const unoType = typeFor(name);
          if (!unoType) throw new Error(`unsupported_probe_type:${name}`);
          const undoBefore = undo.getAllUndoActionTitles().length;
          undo.enterUndoContext(`Probe ${name}`);
          shape.setPropertyValue(name, new uno.Any(unoType, value));
          undo.leaveUndoContext();
          const after = shape.getPropertyValue(name);
          const undoAdded = undo.getAllUndoActionTitles().length - undoBefore;
          undo.undo();
          const restored = shape.getPropertyValue(name);
          undo.redo();
          const redone = shape.getPropertyValue(name);
          undo.undo();
          results.push({
            name,
            before,
            requested: value,
            after,
            undoAdded,
            applied: equal(after, value),
            undoExact: equal(restored, before),
            redoExact: equal(redone, after),
          });
        }
        return results;
      }, propertyCasesJson),
    JSON.stringify(cases),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.some(
      (entry) =>
        !entry.applied ||
        !entry.undoExact ||
        !entry.redoExact ||
        entry.undoAdded !== 1,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
