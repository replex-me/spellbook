import { createRequire } from "node:module";
import {
  installNativeBridgeTrace,
  nativeBridgeDiagnostics,
} from "./native-bridge-probe.mjs";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await installNativeBridgeTrace(page);
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
  await page.waitForTimeout(1_000);
  const launch = await page.evaluate(() => window.__spellbookLaunch);
  const response = await page.evaluate(async ({ accessToken }) => {
    const result = await fetch("/native/probe", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "observe" }),
    });
    return { status: result.status, value: await result.json() };
  }, launch);
  if (response.status !== 200 || !Array.isArray(response.value.slides))
    throw new Error(
      `Hidden extension bridge failed: ${JSON.stringify({ response, bridge: await nativeBridgeDiagnostics(page), frames: page.frames().map((frame) => frame.url()) })}`,
    );
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
  process.stdout.write(
    `${JSON.stringify(
      {
        hiddenBridgeWorked: true,
        bridgeClassActive: await office.evaluate(() =>
          document.documentElement.classList.contains(
            "spellbook-extension-bridge-active",
          ),
        ),
        observedSlides: response.value.slides.length,
        extensionFrameAlive: page
          .frames()
          .some((frame) =>
            frame.url().includes("/extensions/org.spellbook.editor/"),
          ),
        nodes,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
