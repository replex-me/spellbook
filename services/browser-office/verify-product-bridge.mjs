import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

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
  await connectProductHost(page, origin);
  await openProductFixture(page, fixture, "open-1");
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
  const geometryTarget = before.slides
    .flatMap((slide) => slide.elements)
    .find(
      (element) =>
        element.elementId !== target.elementId &&
        Number.isSafeInteger(element.x) &&
        Number.isSafeInteger(element.y) &&
        Number.isSafeInteger(element.width) &&
        Number.isSafeInteger(element.height) &&
        element.textAutoGrowHeight !== true,
    );
  assert.ok(geometryTarget, "The product bridge fixture needs a fixed shape.");
  await assert.rejects(
    nativeTask(page, "unsupported-edit", {
      operation: "edit",
      expectedRevision: before.revision,
      expectedSlides: JSON.stringify(before.slides),
      command: {
        op: "rotate",
        elementId: target.elementId,
        degrees: 15,
      },
      permission: {
        mode: "selection",
        elementIds: [target.elementId],
        slideIndexes: [],
      },
      suppressCapture: true,
    }),
    /browser_ooxml_reconciliation_required:rotate/u,
  );
  const moved = await nativeTask(page, "move-1", {
    operation: "edit",
    expectedRevision: before.revision,
    expectedSlides: JSON.stringify(before.slides),
    command: {
      op: "move",
      elementId: geometryTarget.elementId,
      x: geometryTarget.x + 100,
      y: geometryTarget.y + 100,
    },
    permission: {
      mode: "selection",
      elementIds: [geometryTarget.elementId],
      slideIndexes: [],
    },
    suppressCapture: true,
  });
  const movedTarget = moved.slides
    .flatMap((slide) => slide.elements)
    .find((element) => element.elementId === geometryTarget.elementId);
  assert.equal(movedTarget?.x, geometryTarget.x + 100);
  assert.equal(movedTarget?.y, geometryTarget.y + 100);
  await sendHostCommand(page, "Send_UNO_Command", {
    Command: ".uno:Undo",
  });
  const resized = await nativeTask(page, "resize-1", {
    operation: "edit",
    expectedRevision: before.revision,
    expectedSlides: JSON.stringify(before.slides),
    command: {
      op: "resize",
      elementId: geometryTarget.elementId,
      width: geometryTarget.width + 100,
      height: geometryTarget.height + 100,
    },
    permission: {
      mode: "selection",
      elementIds: [geometryTarget.elementId],
      slideIndexes: [],
    },
    suppressCapture: true,
  });
  const resizedTarget = resized.slides
    .flatMap((slide) => slide.elements)
    .find((element) => element.elementId === geometryTarget.elementId);
  assert.equal(resizedTarget?.width, geometryTarget.width + 100);
  assert.equal(resizedTarget?.height, geometryTarget.height + 100);
  await sendHostCommand(page, "Send_UNO_Command", {
    Command: ".uno:Undo",
  });
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

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await connectProductHost(page, origin);
  await openProductFixture(page, fixture, "open-recovered");
  const recoveredOpen = await waitForEvent(page, {
    type: "open-complete",
    requestId: "open-recovered",
  });
  assert.equal(recoveredOpen.recovered, true);
  const recoveredEdit = await nativeTask(page, "observe-recovered", {
    operation: "observe",
    captureSlideIndexes: [],
  });
  assert.equal(
    recoveredEdit.slides
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

  await sendHostCommand(page, "Send_UNO_Command", {
    Command: ".uno:Redo",
  });
  const redone = await nativeTask(page, "observe-redone", {
    operation: "observe",
    captureSlideIndexes: [],
  });
  assert.equal(
    redone.slides
      .flatMap((slide) => slide.elements)
      .find((element) => element.elementId === target.elementId)?.text,
    replacement,
  );
  await sendHostCommand(page, "Send_UNO_Command", {
    Command: ".uno:Undo",
  });

  const editedForSave = await nativeTask(page, "edit-2", {
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
  assert.notEqual(editedForSave.revision, before.revision);
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
  const savedPackage = unzipSync(Uint8Array.from(savedBytes));
  const changedParts = changedLogicalParts(unzipSync(fixture), savedPackage);
  assert.deepEqual(
    changedParts,
    ["ppt/slides/slide1.xml"],
    "A single text edit must not rewrite unrelated OOXML parts.",
  );
  assert.ok(
    strFromU8(savedPackage["ppt/slides/slide1.xml"]).includes(replacement),
    "The localized OOXML part must contain the edited text.",
  );
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
    recovered: recoveredOpen.recovered,
    savedRevision,
    savedBytes: savedBytes.length,
    changedParts,
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

async function connectProductHost(page, origin) {
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
}

async function openProductFixture(page, bytes, requestId) {
  await page.evaluate(
    ({ source, id }) => {
      const value = Uint8Array.from(source);
      globalThis.__spellbookProductHost.port.postMessage(
        {
          type: "open",
          requestId: id,
          fileName: "product-bridge.pptx",
          revision:
            '"baseline:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
          maxBytes: 64 * 1024 * 1024,
          bytes: value.buffer,
        },
        [value.buffer],
      );
    },
    { source: Array.from(bytes), id: requestId },
  );
}

async function waitForEvent(page, expected) {
  try {
    await page.waitForFunction(
      (match) =>
        globalThis.__spellbookProductHost?.events.some((event) =>
          Object.entries(match).every(([key, value]) => event[key] === value),
        ),
      expected,
      { timeout: 30_000 },
    );
  } catch (error) {
    const events = await page.evaluate(() =>
      (globalThis.__spellbookProductHost?.events ?? []).map((event) => ({
        type: event.type,
        id: event.id,
        error: event.error,
        messageId: event.messageId,
        command: event.command,
        requestId: event.requestId,
        modified: event.modified,
        valueRevision: event.value?.revision,
        bytes:
          event.bytes instanceof ArrayBuffer
            ? `<${event.bytes.byteLength} bytes>`
            : undefined,
      })),
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; expected=${JSON.stringify(expected)}; events=${JSON.stringify(events)}`,
    );
  }
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
  const requestId = `host-command-${messageId}-${Date.now()}-${Math.random()}`;
  await page.evaluate(
    ({ command, payload, requestId: id }) =>
      globalThis.__spellbookProductHost.port.postMessage({
        type: "command",
        messageId: command,
        values: payload,
        requestId: id,
      }),
    { command: messageId, payload: values, requestId },
  );
  await waitForEvent(page, {
    type: "command-complete",
    messageId,
    requestId,
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

function changedLogicalParts(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((name) => !equalBytes(before[name], after[name]))
    .sort();
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
