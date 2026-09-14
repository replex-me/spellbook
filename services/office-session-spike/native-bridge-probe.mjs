export async function installNativeBridgeTrace(page) {
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
}

export async function waitForNativeBridge(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while ((await page.locator("body").innerText()).includes("편집기 연결 중")) {
    if (Date.now() >= deadline) {
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
}
