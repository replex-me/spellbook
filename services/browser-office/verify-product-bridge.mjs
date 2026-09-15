import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { createHarnessServer } from "./server.mjs";

const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serviceRoot, "../..");
const fixture = new Uint8Array(
  await readFile(
    path.join(
      repositoryRoot,
      "eval/public/fixtures/general-native-surface.pptx",
    ),
  ),
);
const outputFlag = process.argv.indexOf("--output");
const outputRoot = path.resolve(
  outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : "artifacts/browser-office/product-bridge",
);
await mkdir(outputRoot, { recursive: true });

const server = createHarnessServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const pageErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    }),
  );
  await page.goto(
    `${origin}/workspace?hostOrigin=${encodeURIComponent(origin)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  await page.waitForFunction(
    () => document.body.dataset.state === "runtime-ready",
    null,
    { timeout: 60_000 },
  );
  await page.evaluate((hostOrigin) => {
    const events = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => events.push(event.data);
    channel.port1.start();
    globalThis.__spellbookProductHost = {
      events,
      port: channel.port1,
    };
    window.postMessage(
      {
        type: "spellbook.browser-office-connect",
        protocolVersion: 1,
      },
      hostOrigin,
      [channel.port2],
    );
  }, origin);
  await waitForEvent(page, { type: "ready" });

  await page.evaluate(
    ({ bytes }) => {
      const value = Uint8Array.from(bytes);
      globalThis.__spellbookProductHost.port.postMessage(
        {
          type: "open",
          requestId: "open-1",
          fileName: "product-bridge.pptx",
          revision:
            '"baseline:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
          maxBytes: 64 * 1024 * 1024,
          bytes: value.buffer,
        },
        [value.buffer],
      );
    },
    { bytes: Array.from(fixture) },
  );
  const opened = await waitForEvent(page, { type: "open-complete" });
  assert.equal(opened.slideCount > 0, true);
  assert.equal(opened.recovered, false);

  const before = await nativeTask(page, "observe-before", {
    operation: "observe",
    captureSlideIndexes: [],
  });
  const target = before.slides
    .flatMap((slide) => slide.elements)
    .find((element) => typeof element.text === "string" && element.text);
  assert.ok(target, "The product bridge fixture needs editable text.");
  const replacement = `${target.text} · product bridge`;
  const edited = await nativeTask(page, "edit-1", {
    operation: "edit",
    expectedRevision: before.revision,
    expectedSlides: JSON.stringify(before.slides),
    command: {
      op: "replace_text",
      elementId: target.elementId,
      text: replacement,
    },
    permission: {
      mode: "selection",
      elementIds: [target.elementId],
      slideIndexes: [],
    },
    suppressCapture: true,
  });
  assert.equal(
    edited.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.elementId === target.elementId)?.text,
    replacement,
  );

  await sendHostCommand(page, "Send_UNO_Command", {
    Command: ".uno:Undo",
  });
  const restored = await nativeTask(page, "observe-restored", {
    operation: "observe",
    captureSlideIndexes: [],
  });
  assert.equal(
    restored.revision,
    before.revision,
    `Undo state differs at ${firstDifference(
      { slides: before.slides, masters: before.masters },
      { slides: restored.slides, masters: restored.masters },
      "document",
    )}`,
  );

  const editedForSave = await nativeTask(page, "edit-2", {
    operation: "edit",
    expectedRevision: restored.revision,
    expectedSlides: JSON.stringify(restored.slides),
    command: {
      op: "replace_text",
      elementId: target.elementId,
      text: replacement,
    },
    permission: {
      mode: "selection",
      elementIds: [target.elementId],
      slideIndexes: [],
    },
    suppressCapture: true,
  });
  assert.notEqual(editedForSave.revision, restored.revision);
  await page.evaluate(() => {
    const saveCommand = {
      type: "command",
      messageId: "Action_Save",
      values: { Notify: true },
    };
    globalThis.__spellbookProductHost.port.postMessage(saveCommand);
    globalThis.__spellbookProductHost.port.postMessage(saveCommand);
  });
  const save = await waitForEvent(page, { type: "save" });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.__spellbookProductHost.events.filter(
          (event) => event.type === "save",
        ).length,
    ),
    1,
    "Concurrent host save commands must share one export request.",
  );
  const savedBytes = await page.evaluate((requestId) => {
    const event = globalThis.__spellbookProductHost.events.find(
      (candidate) =>
        candidate.type === "save" && candidate.requestId === requestId,
    );
    return Array.from(new Uint8Array(event.bytes));
  }, save.requestId);
  assert.equal(savedBytes[0], 0x50);
  assert.equal(savedBytes[1], 0x4b);
  const savedRevision =
    '"saved:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"';
  await page.evaluate(
    ({ requestId, revision }) =>
      globalThis.__spellbookProductHost.port.postMessage({
        type: "save-result",
        requestId,
        ok: true,
        revision,
      }),
    { requestId: save.requestId, revision: savedRevision },
  );
  await waitForEvent(page, { type: "save-response", success: true });
  await waitForEvent(page, { type: "modified", modified: false });

  const result = {
    status: "browser-product-bridge-verified",
    crossOriginIsolated: await page.evaluate(() => crossOriginIsolated),
    slideCount: opened.slideCount,
    editedElementId: target.elementId,
    undoRestoredRevision: restored.revision,
    savedRevision,
    savedBytes: savedBytes.length,
    pageErrors,
    requestFailures,
  };
  assert.equal(result.crossOriginIsolated, true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(requestFailures, []);
  await writeFile(
    path.join(outputRoot, "saved-product-bridge.pptx"),
    Uint8Array.from(savedBytes),
  );
  await writeFile(
    path.join(outputRoot, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitForEvent(page, expected) {
  await page.waitForFunction(
    (match) =>
      globalThis.__spellbookProductHost?.events.some((event) =>
        Object.entries(match).every(([key, value]) => event[key] === value),
      ),
    expected,
    { timeout: 30_000 },
  );
  return page.evaluate(
    (match) =>
      globalThis.__spellbookProductHost.events.find((event) =>
        Object.entries(match).every(([key, value]) => event[key] === value),
      ),
    expected,
  );
}

async function nativeTask(page, id, request) {
  await page.evaluate(
    ({ taskId, nativeRequest }) =>
      globalThis.__spellbookProductHost.port.postMessage({
        id: taskId,
        request: nativeRequest,
      }),
    { taskId: id, nativeRequest: request },
  );
  const event = await waitForEvent(page, { id });
  if (event.error) throw new Error(event.error);
  return event.value;
}

async function sendHostCommand(page, messageId, values) {
  await page.evaluate(
    ({ command, payload }) =>
      globalThis.__spellbookProductHost.port.postMessage({
        type: "command",
        messageId: command,
        values: payload,
      }),
    { command: messageId, payload: values },
  );
  await waitForEvent(page, {
    type: "command-complete",
    messageId,
  });
}

function firstDifference(left, right, path = "slides") {
  if (Object.is(left, right)) return null;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return path;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const difference = firstDifference(left[key], right[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}
