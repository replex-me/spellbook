import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.addEventListener(
      "message",
      (event) => {
        try {
          const data =
            typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          if (data?.MessageId === "Hide_Sidebar") event.stopImmediatePropagation();
        } catch {}
      },
      true,
    );
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.innerText.includes("편집기 연결 중"),
    undefined,
    { timeout: 60_000 },
  );
  const office = page
    .frames()
    .find((frame) => frame.url().includes("/browser/"));
  if (!office) throw new Error("Office frame is missing.");
  const nodes = await office.evaluate(() =>
    [...document.querySelectorAll("[id*='sidebar'], [class*='sidebar'], .extension-panel")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          id: element.id,
          className:
            typeof element.className === "string" ? element.className : "",
          extensionId: element.dataset.extensionId ?? null,
          display: style.display,
          visibility: style.visibility,
          position: style.position,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      })
      .filter(
        (element) =>
          element.extensionId ||
          element.rect.width > 0 ||
          element.rect.height > 0,
      ),
  );
  process.stdout.write(`${JSON.stringify(nodes, null, 2)}\n`);
} finally {
  await browser.close();
}
