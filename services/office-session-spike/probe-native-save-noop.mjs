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
  await page.addInitScript(() => {
    globalThis.__spellbookBridgeTrace = [];
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = data.type;
      if (typeof type !== "string" || !type.startsWith("spellbook.")) return;
      globalThis.__spellbookBridgeTrace.push({
        href: window.location.href,
        origin: event.origin,
        type,
        bridgeSessionId: data.bridgeSessionId ?? null,
        transferredPorts: event.ports.length,
      });
    });
  });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
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
    if (Date.now() >= deadline) {
      const officeFrame = page
        .frames()
        .find((frame) => frame.url().includes("/browser/"));
      const registeredExtensions = officeFrame
        ? await officeFrame
            .evaluate(() => Object.keys(globalThis.app?.map?._extensions ?? {}))
            .catch(() => [])
        : [];
      throw new Error(
        `Native editor extension did not connect: ${JSON.stringify({ frames: page.frames().map((frame) => frame.url()), registeredExtensions, body: (await page.locator("body").innerText()).slice(0, 2_000), browserErrors: browserErrors.slice(-20) })}`,
      );
    }
    await page.waitForTimeout(250);
  }
  const bridgeDeadline = Date.now() + 20_000;
  while ((await page.locator("body").innerText()).includes("편집기 연결 중")) {
    if (Date.now() >= bridgeDeadline) {
      const trace = await Promise.all(
        page.frames().map(async (frame) => ({
          url: frame.url(),
          events: await frame
            .evaluate(() => globalThis.__spellbookBridgeTrace ?? [])
            .catch(() => []),
        })),
      );
      throw new Error(
        `Native editor bridge did not connect: ${JSON.stringify(trace)}`,
      );
    }
    await page.waitForTimeout(100);
  }
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "저장 확인 중…" }).waitFor({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_000);
  process.stdout.write("No-op save requested.\n");
} finally {
  await browser.close();
}
