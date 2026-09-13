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
  const surface = await extensionFrame.evaluate(() =>
    cool.callRemote(function inspectImpressUnoSurface() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const model = desktop.getCurrentFrame().getController().getModel();
      const pages = model.getDrawPages();
      const properties = (value) => {
        try {
          return value
            .getPropertySetInfo()
            .getProperties()
            .map((property) => ({
              name: property.Name,
              type: String(property.Type),
              attributes: property.Attributes,
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
        } catch (_) {
          return [];
        }
      };
      const services = (value) => {
        try {
          return value.getSupportedServiceNames().sort();
        } catch (_) {
          return [];
        }
      };
      const textStructure = (shape) => {
        try {
          const paragraphs = [];
          const paragraphEnumeration = shape.createEnumeration();
          let paragraphIndex = 0;
          while (paragraphEnumeration.hasMoreElements()) {
            const paragraph = paragraphEnumeration.nextElement();
            const portions = [];
            try {
              const portionEnumeration = paragraph.createEnumeration();
              let portionIndex = 0;
              while (portionEnumeration.hasMoreElements()) {
                const portion = portionEnumeration.nextElement();
                portions.push({
                  portionIndex,
                  text: portion.getString(),
                  services: services(portion),
                  properties: properties(portion),
                });
                portionIndex++;
              }
            } catch (_) {}
            paragraphs.push({
              paragraphIndex,
              text: paragraph.getString(),
              services: services(paragraph),
              properties: properties(paragraph),
              portions,
            });
            paragraphIndex++;
          }
          return paragraphs;
        } catch (_) {
          return null;
        }
      };
      const slides = [];
      for (let slideIndex = 0; slideIndex < pages.getCount(); slideIndex++) {
        const slide = pages.getByIndex(slideIndex);
        const shapes = [];
        for (let shapeIndex = 0; shapeIndex < slide.getCount(); shapeIndex++) {
          const shape = slide.getByIndex(shapeIndex);
          let tableCellProperties = [];
          try {
            const table = shape.getPropertyValue("Model");
            tableCellProperties = properties(table.getCellByPosition(0, 0));
          } catch (_) {}
          shapes.push({
            shapeIndex,
            shapeType: shape.getShapeType(),
            services: services(shape),
            properties: properties(shape),
            textStructure: textStructure(shape),
            tableCellProperties,
          });
        }
        let notes = null;
        try {
          const notesPage = slide.getNotesPage();
          notes = {
            services: services(notesPage),
            properties: properties(notesPage),
            shapeCount: notesPage.getCount(),
            shapes: Array.from({ length: notesPage.getCount() }, (_, index) => {
              const shape = notesPage.getByIndex(index);
              let text = null;
              try {
                text = shape.getString();
              } catch (_) {}
              return {
                shapeType: shape.getShapeType(),
                text,
                isPresentationObject: (() => {
                  try {
                    return shape.getPropertyValue("IsPresentationObject");
                  } catch (_) {
                    return null;
                  }
                })(),
              };
            }),
          };
        } catch (_) {}
        slides.push({
          slideIndex,
          services: services(slide),
          properties: properties(slide),
          notes,
          shapes,
        });
      }
      return { modelServices: services(model), slides };
    }),
  );
  process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
} finally {
  await browser.close();
}
