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
  const report = await extensionFrame.evaluate(() =>
    cool.callRemote(function probePicturePropertiesAndUndo() {
      const frame = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      ).getCurrentFrame();
      const model = frame.getController().getModel();
      const page = model.getDrawPages().getByIndex(0);
      const safe = (target, name) => {
        try {
          return target.getPropertyValue(name);
        } catch (_) {
          return null;
        }
      };
      const properties = (shape) =>
        shape
          .getPropertySetInfo()
          .getProperties()
          .map((property) => property.Name)
          .filter((name) =>
            /Graphic|Bitmap|FillStyle|Crop|Mirror|Transpar/i.test(name),
          )
          .sort();
      const summarize = (shape) => {
        const graphic = safe(shape, "Graphic");
        const fillBitmap = safe(shape, "FillBitmap");
        const bitmap = safe(shape, "Bitmap");
        const bitmapSize = (value) => {
          try {
            return value.getSize();
          } catch (_) {
            return null;
          }
        };
        return {
          name: shape.getName(),
          kind: shape.getShapeType(),
          position: shape.getPosition(),
          size: shape.getSize(),
          graphicCrop: safe(shape, "GraphicCrop"),
          graphicUrl: safe(shape, "GraphicURL"),
          graphicStreamUrl: safe(shape, "GraphicStreamURL"),
          graphicType: (() => {
            try {
              return graphic.getType();
            } catch (_) {
              return null;
            }
          })(),
          graphicSizePixel: graphic?.SizePixel ?? null,
          graphicSize100thMM: graphic?.Size100thMM ?? null,
          fillBitmapSizePixel: bitmapSize(fillBitmap),
          bitmapSizePixel: bitmapSize(bitmap),
          fillBitmapSize100thMM: safe(fillBitmap, "Size100thMM"),
          bitmapSize100thMM: safe(bitmap, "Size100thMM"),
          fillStyle: safe(shape, "FillStyle"),
          fillBitmapName: safe(shape, "FillBitmapName"),
          fillBitmapMode: safe(shape, "FillBitmapMode"),
          fillBitmapSizeX: safe(shape, "FillBitmapSizeX"),
          fillBitmapSizeY: safe(shape, "FillBitmapSizeY"),
          fillBitmapLogicalSize: safe(shape, "FillBitmapLogicalSize"),
          propertyNames: properties(shape),
        };
      };
      let shape = null;
      for (let index = 0; index < page.getCount(); index++) {
        const candidate = page.getByIndex(index);
        const crop = safe(candidate, "GraphicCrop");
        if (
          crop &&
          [crop.Left, crop.Top, crop.Right, crop.Bottom].some(
            (value) => Number(value) !== 0,
          )
        ) {
          shape = candidate;
          break;
        }
      }
      if (!shape) throw new Error("cropped_picture_not_found");
      const before = summarize(shape);
      const undo = model.getUndoManager();
      const presentationUndoBefore = undo.getAllUndoActionTitles().length;
      const nextCrop = new uno.idl.com.sun.star.text.GraphicCrop({
        Left: before.graphicCrop.Left + 100,
        Top: before.graphicCrop.Top,
        Right: before.graphicCrop.Right,
        Bottom: before.graphicCrop.Bottom,
      });
      shape.setPropertyValue("GraphicCrop", nextCrop);
      const changed = summarize(shape);
      const presentationUndoAdded =
        undo.getAllUndoActionTitles().length - presentationUndoBefore;
      shape.setPropertyValue(
        "GraphicCrop",
        new uno.idl.com.sun.star.text.GraphicCrop(before.graphicCrop),
      );
      const restored = summarize(shape);
      return {
        before,
        changed,
        restored,
        presentationUndoAdded,
        manualRestoreExact: JSON.stringify(before) === JSON.stringify(restored),
      };
    }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
