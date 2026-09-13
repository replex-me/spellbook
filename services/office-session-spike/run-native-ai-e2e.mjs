import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const screenshot = path.resolve(
  process.argv[3] ?? ".tmp-runtime-validation/native-ai-e2e.png",
);
const prompt =
  process.env.SPELLBOOK_NATIVE_AI_PROMPT ??
  "파란색 사각형의 채우기 색을 노란색으로 바꾸고, 다른 요소는 건드리지 마. 수정 후 화면을 다시 확인해.";
const expectedOperations = (
  process.env.SPELLBOOK_NATIVE_AI_EXPECT_OPS ??
  process.env.SPELLBOOK_NATIVE_AI_EXPECT_OP ??
  ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
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
  const fetchNativeEvents = (after) =>
    page.evaluate(async (afterEventId) => {
      const launch = window.__spellbookLaunch;
      const response = await fetch(`/native/poll?after=${afterEventId}`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${launch.accessToken}` },
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? `HTTP ${response.status}`);
      return value.events;
    }, after);
  const existingEvents = await fetchNativeEvents(0);
  const eventBaseline = existingEvents.reduce(
    (maximum, event) => Math.max(maximum, Number(event.id) || 0),
    0,
  );
  await page.locator(".native-permission select").selectOption("document");
  await page.getByLabel("AI에게 요청").fill(prompt);
  await page.getByLabel("메시지 보내기").click();
  await page.getByLabel("AI 작업 중지").waitFor({ timeout: 30_000 });
  await page.getByLabel("AI 작업 중지").waitFor({
    state: "hidden",
    timeout: 300_000,
  });
  const alert = page.locator(".native-chat-error");
  if (await alert.isVisible()) throw new Error(await alert.innerText());
  const assistant = page.locator(".native-chat-message.assistant").last();
  const response = (await assistant.innerText()).trim();
  if (!response) throw new Error("AI response was empty.");
  const nativeRequests = (await fetchNativeEvents(eventBaseline))
    .filter((event) => event.type === "native_request")
    .map(({ requestOperation, commandOps, dryRun }) => ({
      requestOperation,
      commandOps,
      dryRun,
    }));
  const usedOperations = new Set(
    nativeRequests.flatMap((request) => request.commandOps),
  );
  const missingOperations = expectedOperations.filter(
    (operation) => !usedOperations.has(operation),
  );
  if (missingOperations.length)
    throw new Error(
      `AI did not use expected native operations ${JSON.stringify(missingOperations)}: ${JSON.stringify(nativeRequests)}`,
    );
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForTimeout(2_000);
  const frameText = await Promise.all(
    page.frames().map((frame) =>
      frame
        .locator("body")
        .innerText({ timeout: 1_000 })
        .catch(() => ""),
    ),
  );
  const vendorPopupVisible = frameText.some(
    (text) =>
      text.includes("Explore The New") ||
      text.includes("legacy com.sun.star UNO API"),
  );
  await page.screenshot({ path: screenshot, fullPage: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        prompt,
        response,
        expectedOperations,
        eventBaseline,
        nativeRequests,
        screenshot,
        vendorPopupVisible,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
