import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const screenshot = path.resolve(
  process.argv[3] ?? ".tmp-runtime-validation/native-image-insert.png",
);
const browser = await chromium.launch({ headless: true });
const logs = [];

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("console", (message) =>
    logs.push(`console:${message.type()}:${message.text()}`),
  );
  page.on("pageerror", (error) => logs.push(`pageerror:${error.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const extensionDeadline = Date.now() + 60_000;
  while (
    !page
      .frames()
      .some((frame) =>
        frame.url().includes("/extensions/org.spellbook.editor/"),
      )
  ) {
    if (Date.now() >= extensionDeadline)
      throw new Error("Native editor extension did not connect.");
    await page.waitForTimeout(250);
  }
  const call = (request) =>
    page.evaluate(async (input) => {
      const launch = window.__spellbookLaunch;
      const response = await fetch("/native/probe", {
        method: "POST",
        headers: {
          authorization: `Bearer ${launch.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? `HTTP ${response.status}`);
      return value;
    }, request);
  const before = await call({ operation: "observe" });
  const permission = {
    mode: "slides",
    slideIndexes: [before.activeSlide],
    elementIds: [],
  };
  const result = await call({
    operation: "insert_image",
    assetId: "00000000-0000-4000-8000-000000000001",
    slideIndex: before.activeSlide,
    expectedRevision: before.revision,
    expectedSlides: JSON.stringify(before.slides),
    permission,
  });
  const beforeCount = before.slides.reduce(
    (total, slide) => total + slide.elements.length,
    0,
  );
  const afterCount = result.slides.reduce(
    (total, slide) => total + slide.elements.length,
    0,
  );
  const graphic = result.slides
    .flatMap((slide) => slide.elements)
    .find((element) => String(element.kind).includes("GraphicObjectShape"));
  if (afterCount !== beforeCount + 1 || !graphic)
    throw new Error("Generated image was not inserted as one native picture.");

  const waitForCount = async (expected) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const observed = await call({ operation: "observe" });
      const count = observed.slides.reduce(
        (total, slide) => total + slide.elements.length,
        0,
      );
      if (count === expected) return observed;
      await page.waitForTimeout(200);
    }
    throw new Error(`Timed out waiting for ${expected} elements.`);
  };
  await page.getByRole("button", { name: "실행 취소" }).click();
  const undone = await waitForCount(beforeCount);
  await page.getByRole("button", { name: "다시 실행" }).click();
  const redone = await waitForCount(afterCount);
  const redoneGraphic = redone.slides
    .flatMap((slide) => slide.elements)
    .find((element) => String(element.kind).includes("GraphicObjectShape"));
  if (!redoneGraphic)
    throw new Error("Redo did not restore the generated image.");
  await page.screenshot({ path: screenshot, fullPage: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        beforeCount,
        afterCount,
        undoCount: undone.slides.reduce(
          (total, slide) => total + slide.elements.length,
          0,
        ),
        redoCount: redone.slides.reduce(
          (total, slide) => total + slide.elements.length,
          0,
        ),
        graphic: { elementId: graphic.elementId, kind: graphic.kind },
        screenshot,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error.message, logs }, null, 2)}\n`,
  );
  throw error;
} finally {
  await browser.close();
}
