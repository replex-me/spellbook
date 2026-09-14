export async function installNativeBridgeTrace(page) {
  await page.addInitScript(() => {
    globalThis.__spellbookBridgeTrace = [];
    const record = (event) =>
      globalThis.__spellbookBridgeTrace.push({
        href: window.location.href,
        ...event,
      });
    const describe = (data) => ({
      type: data?.type ?? null,
      id: data?.id ?? null,
      operation: data?.request?.operation ?? null,
      hasValue: data?.value !== undefined,
      error: data?.error ?? null,
    });
    const wrapPort = (port, label) => {
      if (!port || port.__spellbookTraceWrapped) return;
      Object.defineProperty(port, "__spellbookTraceWrapped", { value: true });
      const send = port.postMessage.bind(port);
      port.postMessage = (data, transfer) => {
        record({ channel: label, direction: "send", ...describe(data) });
        return transfer === undefined ? send(data) : send(data, transfer);
      };
      port.addEventListener("message", (event) =>
        record({
          channel: label,
          direction: "receive",
          ...describe(event.data),
        }),
      );
    };
    const NativeMessageChannel = globalThis.MessageChannel;
    if (NativeMessageChannel) {
      globalThis.MessageChannel = function MessageChannel() {
        const channel = new NativeMessageChannel();
        wrapPort(channel.port1, "created-port-1");
        wrapPort(channel.port2, "created-port-2");
        return channel;
      };
      globalThis.MessageChannel.prototype = NativeMessageChannel.prototype;
    }
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = data.type;
      if (typeof type !== "string" || !type.startsWith("spellbook.")) return;
      record({
        origin: event.origin,
        type,
        bridgeSessionId: data.bridgeSessionId ?? null,
        transferredPorts: event.ports.length,
      });
      if (type === "spellbook.connect" && event.ports[0])
        wrapPort(event.ports[0], "transferred-port");
    });
  });
}

export async function nativeBridgeDiagnostics(page) {
  return Promise.all(
    page.frames().map(async (frame) => ({
      url: frame.url(),
      events: await frame
        .evaluate(() => globalThis.__spellbookBridgeTrace ?? [])
        .catch(() => []),
    })),
  );
}

export async function waitForNativeBridge(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while ((await page.locator("body").innerText()).includes("편집기 연결 중")) {
    if (Date.now() >= deadline) {
      const trace = await nativeBridgeDiagnostics(page);
      throw new Error(
        `Native editor bridge did not connect: ${JSON.stringify(trace)}`,
      );
    }
    await page.waitForTimeout(100);
  }
}
