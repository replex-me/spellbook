import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const screenshot = path.resolve(
  process.argv[3] ?? ".tmp-runtime-validation/native-editor-shell.png",
);
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
  const observed = await page.evaluate(async () => {
    const launch = window.__spellbookLaunch;
    const response = await fetch("/native/probe", {
      method: "POST",
      headers: {
        authorization: `Bearer ${launch.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "observe" }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
    return value;
  });
  await page.waitForTimeout(1_000);
  const frameText = await Promise.all(
    page.frames().map((frame) =>
      frame
        .locator("body")
        .innerText({ timeout: 1_000 })
        .catch(() => ""),
    ),
  );
  const legacyUnoWarningVisible = frameText.some((text) =>
    text.includes("legacy com.sun.star UNO API"),
  );
  const vendorWelcomeVisible = frameText.some(
    (text) =>
      text.includes("Explore The New") ||
      text.includes("Collabora Online Development Edition"),
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        editorConnected: true,
        enginePatchLevel: observed.engine?.patchLevel,
        slideCount: observed.slides.length,
        legacyUnoWarningVisible,
        vendorWelcomeVisible,
        screenshot,
      },
      null,
      2,
    )}\n`,
  );
  if (legacyUnoWarningVisible)
    throw new Error("Managed editor exposed the legacy UNO warning.");
  if (vendorWelcomeVisible)
    throw new Error("Managed editor exposed the Collabora welcome overlay.");
} finally {
  await browser.close();
}
