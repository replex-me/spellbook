import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const slideIndex = Number(process.argv[3] ?? 0);
const objectIndex = Number(process.argv[4] ?? 0);
const kerningMm100 = Number(process.argv[5] ?? 44);
if (
  !Number.isInteger(slideIndex) ||
  slideIndex < 0 ||
  !Number.isInteger(objectIndex) ||
  objectIndex < 0 ||
  !Number.isInteger(kerningMm100)
)
  throw new Error(
    "Expected non-negative slide/object indexes and integer kerning.",
  );

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
    ({ slideIndex: requestedSlide, objectIndex: requestedObject, kerning }) =>
      cool.callRemote(
        function probeTextProperties(remoteRequestJson) {
          const request = JSON.parse(remoteRequestJson);
          const desktop = uno.idl.com.sun.star.frame.Desktop.create(
            uno.componentContext,
          );
          const frame = desktop.getCurrentFrame();
          const model = frame.getController().getModel();
          const pages = model.getDrawPages();
          const shape = pages
            .getByIndex(request.slideIndex)
            .getByIndex(request.objectIndex);
          const undo = model.getUndoManager();
          const safeProperty = (target, name) => {
            try {
              return target.getPropertyValue(name);
            } catch (error) {
              return `error:${error.message}`;
            }
          };
          const read = () => {
            const portions = [];
            const paragraphs = shape.createEnumeration();
            while (paragraphs.hasMoreElements()) {
              const paragraph = paragraphs.nextElement();
              const enumeration = paragraph.createEnumeration();
              while (enumeration.hasMoreElements()) {
                const portion = enumeration.nextElement();
                portions.push({
                  text: portion.getString(),
                  kerning: safeProperty(portion, "CharKerning"),
                  escapement: safeProperty(portion, "CharEscapement"),
                  escapementHeight: safeProperty(
                    portion,
                    "CharEscapementHeight",
                  ),
                });
              }
            }
            const cursor = shape.createTextCursor();
            return {
              cursorKerning: safeProperty(cursor, "CharKerning"),
              portions,
            };
          };
          const before = read();
          const undoBefore = undo.getAllUndoActionTitles().length;
          const property = new uno.idl.com.sun.star.beans.PropertyValue({
            Name: "DataJson",
            Value: new uno.Any(
              uno.type.string,
              JSON.stringify({
                Strict: true,
                Transforms: {
                  SlideCommands: [
                    { JumpToSlide: request.slideIndex },
                    {
                      [`SetTextProperties.${request.objectIndex}`]: {
                        Kerning: request.kerning,
                      },
                    },
                  ],
                },
              }),
            ),
          });
          uno.idl.com.sun.star.frame.DispatchHelper.create(
            uno.componentContext,
          ).executeDispatch(frame, ".uno:TransformDocumentStructure", "", 0, [
            property,
          ]);
          const after = read();
          const undoAfter = undo.getAllUndoActionTitles().length;
          undo.undo();
          const restored = read();
          undo.redo();
          const redone = read();
          return {
            before,
            after,
            restored,
            redone,
            undoAdded: undoAfter - undoBefore,
          };
        },
        JSON.stringify({
          slideIndex: requestedSlide,
          objectIndex: requestedObject,
          kerning,
        }),
      ),
    { slideIndex, objectIndex, kerning: kerningMm100 },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
