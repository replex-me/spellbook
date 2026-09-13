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

  const active = await call({ operation: "observe", detailSlideIndex: null });
  if (active.textDetails?.slideIndex !== active.activeSlide)
    throw new Error("Active-slide text details do not match the active slide.");
  const detailSlideIndex = active.slides.find(
    (slide) => slide.slideIndex !== active.activeSlide,
  )?.slideIndex;
  if (!Number.isInteger(detailSlideIndex))
    throw new Error("Observation probe requires at least two slides.");
  const detailed = await call({ operation: "observe", detailSlideIndex });
  if (
    detailed.activeSlide !== active.activeSlide ||
    detailed.revision !== active.revision ||
    detailed.textDetails?.slideIndex !== detailSlideIndex ||
    detailed.images?.[0]?.slideIndex !== detailSlideIndex
  )
    throw new Error(
      "Non-active detail observation changed the document/view or returned mismatched evidence.",
    );
  const observedIds = new Set(
    detailed.slides[detailSlideIndex].elements.map(
      (element) => element.elementId,
    ),
  );
  if (
    detailed.textDetails.elements.some(
      (element) => !observedIds.has(element.elementId),
    )
  )
    throw new Error("Text details contain an element from another slide.");

  process.stdout.write(
    `${JSON.stringify(
      {
        enginePatchLevel: detailed.engine?.patchLevel,
        activeSlide: detailed.activeSlide,
        detailSlideIndex,
        revisionUnchanged: true,
        imageSlideIndex: detailed.images[0].slideIndex,
        elementCount: detailed.textDetails.elements.length,
        paragraphCount: detailed.textDetails.elements.reduce(
          (total, element) => total + element.paragraphs.length,
          0,
        ),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
