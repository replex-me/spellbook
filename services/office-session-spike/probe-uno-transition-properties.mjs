import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2];
if (!url)
  throw new Error("Usage: node probe-uno-transition-properties.mjs URL");

const browser = await chromium.launch({ headless: true });
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
  const extension = page
    .frames()
    .find((frame) => frame.url().includes("/extensions/org.spellbook.editor/"));
  const result = await extension.evaluate(() =>
    cool.callRemote(function spellbookTransitionPropertyProbe() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const frame = desktop.getCurrentFrame();
      const model = frame.getController().getModel();
      const page = model.getDrawPages().getByIndex(0);
      const undo = model.getUndoManager();
      const undoCount = undo.getAllUndoActionTitles().length;
      const read = () => ({
        type: page.getPropertyValue("TransitionType"),
        subtype: page.getPropertyValue("TransitionSubtype"),
        direction: page.getPropertyValue("TransitionDirection"),
        duration: page.getPropertyValue("TransitionDuration"),
        fadeColor: page.getPropertyValue("TransitionFadeColor"),
      });
      const before = read();
      const prop = (Name, type, value) =>
        new uno.idl.com.sun.star.beans.PropertyValue({
          Name,
          Value: new uno.Any(type, value),
        });
      uno.idl.com.sun.star.frame.DispatchHelper.create(
        uno.componentContext,
      ).executeDispatch(frame, ".uno:TransformDocumentStructure", "", 0, [
        prop(
          "DataJson",
          uno.type.string,
          JSON.stringify({
            Strict: true,
            Transforms: {
              SlideCommands: [
                { JumpToSlide: 0 },
                {
                  SetSlideTransition: {
                    Type: 37,
                    Subtype: 101,
                    Direction: true,
                    Duration: 0.75,
                    FadeColor: 0,
                  },
                },
              ],
            },
          }),
        ),
      ]);
      const after = read();
      const undoActionsAdded = undo.getAllUndoActionTitles().length - undoCount;
      while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
      return { before, after, undoActionsAdded, restored: read() };
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
