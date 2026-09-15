/* SPDX-License-Identifier: MPL-2.0 */

import {
  openBrowserDocumentJournal,
  requestPersistentBrowserStorage,
} from "/harness/opfs-journal.mjs";

const body = document.body;
const canvas = document.querySelector("#qtcanvas");
const status = document.querySelector("#status");
const evidence = document.querySelector("#evidence");
const fileInput = document.querySelector("#file-input");
const insertSlideButton = document.querySelector("#insert-slide");
const undoButton = document.querySelector("#undo");
const saveButton = document.querySelector("#save");
const productMode = location.pathname === "/workspace";
const productBridgeSessionId = productMode ? crypto.randomUUID() : "";
const expectedHostOrigin = productMode
  ? new URLSearchParams(location.search).get("hostOrigin")
  : null;

let enginePort;
let hostPort;
let hostRevision = "";
let hostMaximumBytes = 0;
let lastReportedModified = false;
let filename = "document.pptx";
let activePath = "/tmp/spellbook/document.pptx";
let requestSequence = 0;
const pending = new Map();
const mutationPending = new Map();
const observed = { marks: {}, events: [], runs: [] };
const savedArtifacts = new Map();
const upstreamUiSettleMs = 1_000;
const history = [];
const verifiedTopologyOperations = "add,duplicate,move,delete";
const verifiedMetadataOperations = "rename,hide";
const recoveryMarker = "spellbook-browser-office-recovery-v1";
const conformanceLabels = [
  "after-insert",
  "after-duplicate",
  "after-move",
  "after-delete",
  "after-rename",
  "after-hide",
];
let currentBytes;
let currentSlideCount = 0;
let baseBytes;
let journal;
let productExportQueue = Promise.resolve();
const commands = [];

function setState(nextState, message) {
  body.dataset.state = nextState;
  status.textContent = message;
  observed.marks[nextState] = Math.round(performance.now());
  observed.events.push({
    state: nextState,
    atMs: observed.marks[nextState],
    message,
  });
  evidence.value = JSON.stringify(observed);
}

function request(command, details = {}) {
  const requestId = `browser-office-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, command });
    enginePort.postMessage({ command, requestId, ...details });
  });
}

function settle(message) {
  if (!message.requestId) return;
  const waiter = pending.get(message.requestId);
  if (!waiter) return;
  pending.delete(message.requestId);
  if (message.command === "error") waiter.reject(new Error(message.message));
  else waiter.resolve(message);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function writeAndOpen(bytes, name = "document.pptx") {
  currentBytes = bytes.slice();
  filename = name;
  activePath = `/tmp/spellbook/${name.replace(/[^a-zA-Z0-9._-]/gu, "-")}`;
  try {
    FS.mkdir("/tmp/spellbook");
  } catch {}
  FS.writeFile(activePath, bytes);
  setState("opening", `Opening ${filename}`);
  const result = await request("open", { path: activePath });
  currentSlideCount = result.slideCount;
  await waitForUiPaint("document");
  setState("document-ready", `${filename} · ${result.slideCount} slides`);
  for (const button of [insertSlideButton, undoButton, saveButton])
    button.disabled = false;
  return result;
}

async function runNativeBridgeProbe() {
  const probePackage = await applyMutation(currentBytes, {
    op: "duplicate_slide",
    slideIndex: 0,
    insertIndex: 1,
  });
  await writeAndOpen(
    new Uint8Array(probePackage.bytes),
    "general-native-surface-navigation-probe.pptx",
  );
  const before = (
    await request("native", {
      nativeRequest: { operation: "observe", captureSlideIndexes: [] },
    })
  ).value;
  if (!before?.slides?.length || before.unit !== "1/100mm")
    throw new Error(
      "Browser native observation did not return the PPTX model.",
    );
  const targetSlideIndex = before.slides.findIndex(
    (slide, slideIndex) =>
      slideIndex !== before.activeSlide &&
      slide.elements.some(
        (element) => typeof element.text === "string" && element.text,
      ),
  );
  const target = before.slides[targetSlideIndex]?.elements.find(
    (element) => typeof element.text === "string" && element.text,
  );
  if (!target)
    throw new Error(
      "Browser native bridge fixture has no editable text target on a non-active slide.",
    );
  const replacement = `${target.text} · browser AI bridge`;
  const edited = (
    await request("native", {
      nativeRequest: {
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
      },
    })
  ).value;
  const changed = edited.slides
    .flatMap((slide) => slide.elements)
    .find((element) => element.elementId === target.elementId);
  if (changed?.text !== replacement || edited.revision === before.revision)
    throw new Error("Browser native edit did not change the selected text.");
  await request("dispatch", { unoCommand: "Undo" });
  const restored = (
    await request("native", {
      nativeRequest: { operation: "observe", captureSlideIndexes: [] },
    })
  ).value;
  if (restored.revision !== before.revision)
    throw new Error(
      "Browser native Undo did not restore the observed revision.",
    );
  observed.nativeBridge = {
    operation: "replace_text",
    slideCount: before.slides.length,
    sourceActiveSlide: before.activeSlide,
    targetSlideIndex,
    editedActiveSlide: edited.activeSlide,
    elementId: target.elementId,
    editedRevision: edited.revision,
    restoredRevision: restored.revision,
    status: "observe-edit-undo-passed",
  };
  body.dataset.nativeBridge = "observe-edit-undo";
}

async function recordBytes(label, bytes, slideCount, mutation) {
  const entry = {
    label,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    slideCount,
    mutation,
  };
  observed.runs.push(entry);
  savedArtifacts.set(label, bytes);
  evidence.value = JSON.stringify(observed);
  return { bytes, entry };
}

async function waitForUiPaint(label) {
  window.dispatchEvent(new Event("resize"));
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  // ZetaOffice's own Web Office example uses this temporary settle window
  // after resize while the upstream Qt canvas-ready signal remains pending.
  await new Promise((resolve) => setTimeout(resolve, upstreamUiSettleMs));
  observed.marks[`${label}-visual-ready`] = Math.round(performance.now());
}

function applyMutation(bytes, command) {
  const requestId = `ooxml-${++requestSequence}`;
  const transferable = bytes.slice();
  return new Promise((resolve, reject) => {
    mutationPending.set(requestId, { resolve, reject });
    ooxmlWorker.postMessage(
      { requestId, bytes: transferable.buffer, command },
      [transferable.buffer],
    );
  });
}

async function mutate(command) {
  if (!currentBytes) throw new Error("Open a PPTX before editing slides.");
  const before = currentBytes.slice();
  const result = await applyMutation(before, command);
  history.push(before);
  await writeAndOpen(new Uint8Array(result.bytes), filename);
  commands.push(command);
  await persistCheckpoint();
  undoButton.disabled = false;
  observed.lastMutation = result.report;
  evidence.value = JSON.stringify(observed);
  return result.report;
}

async function addSlide() {
  return mutate({
    op: "add_slide",
    templateSlideIndex: 0,
    insertIndex: currentSlideCount,
  });
}

async function undoMutation() {
  const previous = history.pop();
  if (!previous) throw new Error("There is no browser mutation to undo.");
  const result = await writeAndOpen(previous, filename);
  commands.pop();
  await persistCheckpoint();
  undoButton.disabled = history.length === 0;
  return result;
}

async function openJournal(initialBytes, name) {
  baseBytes = initialBytes.slice();
  journal = await openBrowserDocumentJournal({
    identity: `${name}:${await sha256(initialBytes)}`,
  });
  return journal;
}

async function persistCheckpoint() {
  if (!journal || !baseBytes || !currentBytes) return;
  await journal.save({
    fileName: filename,
    baseVersionId: await sha256(baseBytes),
    baseBytes,
    candidateBytes: currentBytes,
    commands,
  });
}

function download(bytes) {
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function requireProductHostOrigin() {
  if (!expectedHostOrigin)
    throw new Error("Browser Office host origin is required.");
  const parsed = new URL(expectedHostOrigin);
  if (
    parsed.origin !== expectedHostOrigin ||
    !["http:", "https:"].includes(parsed.protocol)
  )
    throw new Error("Browser Office host origin is invalid.");
  return parsed.origin;
}

function postHost(message, transfer = []) {
  if (!hostPort) throw new Error("Browser Office host is not connected.");
  hostPort.postMessage(message, transfer);
}

function reportHostModified(modified) {
  if (modified === lastReportedModified) return;
  lastReportedModified = modified;
  postHost({ type: "modified", modified });
}

async function exportProductDocumentNow({ checkpoint = true } = {}) {
  if (!currentBytes || !journal)
    throw new Error("No browser Office document is open.");
  const exportPath = "/tmp/spellbook/product-export.pptx";
  await request("store", { path: exportPath });
  const bytes = new Uint8Array(FS.readFile(exportPath)).slice();
  if (!bytes.byteLength || bytes.byteLength > hostMaximumBytes)
    throw new Error("Browser Office export exceeded the document limit.");
  currentBytes = bytes;
  if (checkpoint) await persistCheckpoint();
  return bytes;
}

function exportProductDocument(options = {}) {
  const pendingExport = productExportQueue.then(() =>
    exportProductDocumentNow(options),
  );
  productExportQueue = pendingExport.catch(() => undefined);
  return pendingExport;
}

async function openProductDocument(message) {
  if (
    typeof message.requestId !== "string" ||
    typeof message.fileName !== "string" ||
    !message.fileName.trim() ||
    message.fileName.length > 255 ||
    typeof message.revision !== "string" ||
    !message.revision ||
    !Number.isSafeInteger(message.maxBytes) ||
    message.maxBytes <= 0 ||
    message.maxBytes > 64 * 1024 * 1024 ||
    !(message.bytes instanceof ArrayBuffer) ||
    !message.bytes.byteLength ||
    message.bytes.byteLength > message.maxBytes
  )
    throw new Error("Browser Office open request is invalid.");
  const initial = new Uint8Array(message.bytes);
  if (initial[0] !== 0x50 || initial[1] !== 0x4b)
    throw new Error("Browser Office received an invalid PPTX package.");
  hostRevision = message.revision;
  hostMaximumBytes = message.maxBytes;
  history.length = 0;
  commands.length = 0;
  await requestPersistentBrowserStorage();
  await openJournal(initial, message.fileName);
  const recovered = await journal.load();
  const candidate = recovered?.candidateBytes ?? initial;
  baseBytes = initial.slice();
  currentBytes = candidate.slice();
  await writeAndOpen(currentBytes, message.fileName);
  const modified = Boolean(recovered);
  lastReportedModified = !modified;
  reportHostModified(modified);
  postHost({
    type: "open-complete",
    requestId: message.requestId,
    revision: hostRevision,
    slideCount: currentSlideCount,
    recovered: Boolean(recovered),
  });
}

let hostSaveRequestId = null;
async function saveProductDocument() {
  if (hostSaveRequestId) return;
  const requestId = `browser-save-${++requestSequence}`;
  hostSaveRequestId = requestId;
  try {
    const bytes = await exportProductDocument();
    const transferable = bytes.slice();
    postHost(
      {
        type: "save",
        requestId,
        revision: hostRevision,
        bytes: transferable.buffer,
      },
      [transferable.buffer],
    );
  } catch (error) {
    hostSaveRequestId = null;
    throw error;
  }
}

async function handleProductHostMessage(message) {
  if (!message || typeof message !== "object")
    throw new Error("Browser Office host message is invalid.");
  if (message.type === "open") {
    await openProductDocument(message);
    return;
  }
  if (message.type === "command") {
    if (message.messageId === "Action_Save") {
      await saveProductDocument();
      return;
    }
    if (message.messageId === "Send_UNO_Command") {
      const command = String(message.values?.Command ?? "").replace(
        /^\.uno:/u,
        "",
      );
      if (!["Undo", "Redo"].includes(command))
        throw new Error("Browser Office host command is not allowed.");
      await request("dispatch", { unoCommand: command });
      const status = await request("status");
      reportHostModified(Boolean(status.modified));
      postHost({
        type: "command-complete",
        messageId: message.messageId,
        command,
      });
      return;
    }
    if (
      message.messageId === "welcome-close" ||
      message.messageId === "Host_PostmessageReady"
    )
      return;
    throw new Error("Browser Office host command is not supported.");
  }
  if (message.type === "save-result") {
    if (!hostSaveRequestId || message.requestId !== hostSaveRequestId)
      throw new Error("Browser Office save response is stale.");
    hostSaveRequestId = null;
    if (message.ok !== true) {
      reportHostModified(true);
      postHost({
        type: "save-response",
        success: false,
        error: String(message.error ?? "browser_document_save_failed"),
      });
      return;
    }
    if (typeof message.revision !== "string" || !message.revision)
      throw new Error("Browser Office save revision is invalid.");
    hostRevision = message.revision;
    baseBytes = currentBytes.slice();
    await request("mark-saved");
    await journal.clear();
    lastReportedModified = true;
    reportHostModified(false);
    postHost({ type: "save-response", success: true });
    return;
  }
  if (typeof message.id === "string" && message.request) {
    try {
      const result = await request("native", {
        nativeRequest: message.request,
      });
      const status = await request("status");
      reportHostModified(Boolean(status.modified));
      postHost({ id: message.id, value: result.value });
    } catch (error) {
      postHost({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }
  throw new Error("Browser Office host message is unsupported.");
}

function connectProductHost(event) {
  if (
    !productMode ||
    event.source !== window.parent ||
    event.origin !== requireProductHostOrigin() ||
    event.data?.type !== "spellbook.browser-office-connect" ||
    event.data?.protocolVersion !== 1 ||
    event.ports.length !== 1 ||
    hostPort
  )
    return;
  hostPort = event.ports[0];
  hostPort.onmessage = (hostEvent) => {
    void handleProductHostMessage(hostEvent.data).catch((error) => {
      postHost({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  hostPort.start();
  postHost({ type: "ready", protocolVersion: 1 });
  startProductHeartbeat();
}

let runtimeReady = false;
let productHeartbeat = null;
let checkpointInFlight = false;
let lastCheckpointAt = 0;
function startProductHeartbeat() {
  if (!productMode || !runtimeReady || !hostPort || productHeartbeat) return;
  const poll = async () => {
    if (!currentBytes || checkpointInFlight) return;
    checkpointInFlight = true;
    try {
      const current = await request("status");
      const modified = Boolean(current.modified);
      reportHostModified(modified);
      if (modified && Date.now() - lastCheckpointAt >= 10_000) {
        await exportProductDocument();
        lastCheckpointAt = Date.now();
      }
    } catch (error) {
      postHost({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      checkpointInFlight = false;
    }
  };
  productHeartbeat = setInterval(() => void poll(), 750);
}

async function runConformance() {
  const fixture = new Uint8Array(
    await (await fetch("/fixtures/general-native-surface.pptx")).arrayBuffer(),
  );
  await requestPersistentBrowserStorage();
  await openJournal(fixture, "general-native-surface.pptx");
  const pendingRecovery = sessionStorage.getItem(recoveryMarker);
  if (pendingRecovery) {
    sessionStorage.removeItem(recoveryMarker);
    await resumeConformance(JSON.parse(pendingRecovery));
    return;
  }
  await journal.clear();
  commands.length = 0;
  history.length = 0;
  const initial = await writeAndOpen(fixture, "general-native-surface.pptx");
  await runNativeBridgeProbe();
  await writeAndOpen(fixture, "general-native-surface.pptx");
  const addMutation = await addSlide();
  if (currentSlideCount !== initial.slideCount + 1)
    throw new Error("OOXML add_slide did not add exactly one slide.");
  await recordBytes(
    "after-insert",
    currentBytes,
    currentSlideCount,
    addMutation,
  );

  const duplicateMutation = await mutate({
    op: "duplicate_slide",
    slideIndex: 0,
    insertIndex: currentSlideCount,
  });
  if (currentSlideCount !== initial.slideCount + 2)
    throw new Error("OOXML duplicate_slide did not add exactly one slide.");
  await recordBytes(
    "after-duplicate",
    currentBytes,
    currentSlideCount,
    duplicateMutation,
  );

  const moveMutation = await mutate({
    op: "move_slide",
    slideIndex: currentSlideCount - 1,
    insertIndex: 0,
  });
  if (currentSlideCount !== initial.slideCount + 2)
    throw new Error("OOXML move_slide changed the slide count.");
  await recordBytes(
    "after-move",
    currentBytes,
    currentSlideCount,
    moveMutation,
  );

  const deleteMutation = await mutate({
    op: "delete_slide",
    slideIndex: 0,
  });
  if (currentSlideCount !== initial.slideCount + 1)
    throw new Error("OOXML delete_slide did not remove exactly one slide.");
  await recordBytes(
    "after-delete",
    currentBytes,
    currentSlideCount,
    deleteMutation,
  );

  const renameMutation = await mutate({
    op: "rename_slide",
    slideIndex: 0,
    name: "Browser 검증 슬라이드",
  });
  await recordBytes(
    "after-rename",
    currentBytes,
    currentSlideCount,
    renameMutation,
  );

  const hideMutation = await mutate({
    op: "set_slide_hidden",
    slideIndex: 1,
    hidden: true,
  });
  const hidden = await recordBytes(
    "after-hide",
    currentBytes,
    currentSlideCount,
    hideMutation,
  );

  sessionStorage.setItem(
    recoveryMarker,
    JSON.stringify({
      initialSlideCount: initial.slideCount,
      mutatedSha256: hidden.entry.sha256,
      nativeBridge: observed.nativeBridge,
    }),
  );
  location.reload();
}

async function resumeConformance(expected) {
  if (expected.nativeBridge?.status !== "observe-edit-undo-passed")
    throw new Error("Browser native bridge evidence was not retained.");
  observed.nativeBridge = expected.nativeBridge;
  body.dataset.nativeBridge = "observe-edit-undo";
  const checkpoint = await journal.load();
  if (!checkpoint)
    throw new Error("OPFS did not retain a valid browser edit checkpoint.");
  if (checkpoint.metadata.commands.length !== conformanceLabels.length)
    throw new Error(
      "OPFS did not retain the complete browser command journal.",
    );
  baseBytes = checkpoint.baseBytes.slice();
  currentBytes = baseBytes.slice();
  commands.length = 0;
  history.length = 0;
  for (let index = 0; index < checkpoint.metadata.commands.length; index += 1) {
    const command = checkpoint.metadata.commands[index];
    history.push(currentBytes.slice());
    const result = await applyMutation(currentBytes, command);
    currentBytes = new Uint8Array(result.bytes);
    currentSlideCount = result.report.slideCount;
    commands.push(command);
    await recordBytes(
      conformanceLabels[index],
      currentBytes,
      currentSlideCount,
      result.report,
    );
  }
  if ((await sha256(currentBytes)) !== checkpoint.metadata.candidateSha256)
    throw new Error(
      "The replayed command journal differs from the OPFS candidate.",
    );
  await writeAndOpen(checkpoint.candidateBytes, checkpoint.metadata.fileName);
  observed.marks["opfs-recovered"] = Math.round(performance.now());
  observed.events.push({
    state: "opfs-recovered",
    atMs: observed.marks["opfs-recovered"],
    message: "Recovered candidate and Undo history after page reload",
  });

  const undoCounts = [
    expected.initialSlideCount + 1,
    expected.initialSlideCount + 1,
    expected.initialSlideCount + 2,
    expected.initialSlideCount + 2,
    expected.initialSlideCount + 1,
    expected.initialSlideCount,
  ];
  let undone;
  for (const expectedCount of undoCounts) {
    undone = await undoMutation();
    if (undone.slideCount !== expectedCount)
      throw new Error(
        `Browser undo restored ${undone.slideCount} slides instead of ${expectedCount}.`,
      );
  }
  const restored = await recordBytes(
    "after-undo",
    currentBytes,
    currentSlideCount,
    { operation: "restore_original" },
  );
  if (expected.mutatedSha256 === restored.entry.sha256)
    throw new Error("Mutation and undone saves unexpectedly match.");
  const reopenPath = "/tmp/spellbook/reopened.pptx";
  FS.writeFile(reopenPath, restored.bytes);
  const reopened = await request("open", { path: reopenPath });
  if (reopened.slideCount !== expected.initialSlideCount)
    throw new Error("The undone PPTX changed after browser reopen.");
  await waitForUiPaint("reopen");
  body.dataset.initialSlides = String(expected.initialSlideCount);
  body.dataset.reopenedSlides = String(reopened.slideCount);
  body.dataset.mutatedSha256 = expected.mutatedSha256;
  body.dataset.restoredSha256 = restored.entry.sha256;
  body.dataset.addedSha256 = observed.runs.find(
    (entry) => entry.label === "after-insert",
  ).sha256;
  body.dataset.topologyOperations = verifiedTopologyOperations;
  body.dataset.metadataOperations = verifiedMetadataOperations;
  body.dataset.recovery = "opfs-two-slot";
  await journal.clear();
  setState(
    "complete",
    "Browser edits, page-reload recovery, six-step Undo and reopen passed",
  );
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  history.length = 0;
  commands.length = 0;
  undoButton.disabled = true;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await openJournal(bytes, file.name);
  await journal.clear();
  await writeAndOpen(bytes, file.name);
});

insertSlideButton.addEventListener("click", async () => {
  await addSlide();
});

undoButton.addEventListener("click", async () => {
  await undoMutation();
});

saveButton.addEventListener("click", async () => {
  if (!currentBytes) throw new Error("Open a PPTX before saving.");
  await recordBytes("manual-save", currentBytes, currentSlideCount, {
    operation: "export_current_candidate",
  });
  download(currentBytes);
});

if (productMode) {
  body.dataset.mode = "product";
  window.addEventListener("message", connectProductHost);
}

window.addEventListener("error", (event) => {
  body.dataset.error = event.message;
  setState("error", event.message);
});

const runtimeBase = new URL("/runtime/", location.href).href;
const ooxmlWorker = new Worker(new URL("ooxml-worker.js", runtimeBase), {
  type: "module",
});
ooxmlWorker.onmessage = (event) => {
  const waiter = mutationPending.get(event.data.requestId);
  if (!waiter) return;
  mutationPending.delete(event.data.requestId);
  if (event.data.error) waiter.reject(new Error(event.data.error));
  else waiter.resolve(event.data);
};
ooxmlWorker.onerror = (event) => {
  body.dataset.error = event.message;
  setState("error", event.message);
};
globalThis.Module = {
  canvas,
  uno_scripts: [
    new URL("zeta.js", runtimeBase).href,
    new URL("browser-candidate.js", runtimeBase).href,
    new URL("/harness/mutation-contract.generated.js", location.href).href,
    new URL("/harness/operations.js", location.href).href,
    new URL("/harness/native-transform-adapter.js", location.href).href,
    new URL("/harness/office-thread.js", location.href).href,
  ],
  locateFile: (path, prefix) => (prefix || runtimeBase) + path,
};
Module.mainScriptUrlOrBlob = new Blob(
  [
    `importScripts(${JSON.stringify(new URL("soffice.js", runtimeBase).href)});`,
  ],
  { type: "text/javascript" },
);

const script = document.createElement("script");
script.src = new URL("soffice.js", runtimeBase).href;
script.onload = () => {
  Module.uno_main.then((messagePort) => {
    enginePort = messagePort;
    enginePort.onmessage = async (event) => {
      const message = event.data;
      if (message.command === "runtime-ready") {
        runtimeReady = true;
        setState("runtime-ready", "Engine ready");
        if (productMode) {
          window.parent.postMessage(
            {
              type: "spellbook.browser-office-ready",
              protocolVersion: 1,
              bridgeSessionId: productBridgeSessionId,
            },
            requireProductHostOrigin(),
          );
          startProductHeartbeat();
        } else if (
          new URLSearchParams(location.search).get("autorun") === "1"
        ) {
          try {
            await runConformance();
          } catch (error) {
            body.dataset.error = error.message;
            setState("error", error.message);
          }
        }
        return;
      }
      settle(message);
    };
  });
};
script.onerror = () =>
  setState("error", "Failed to load Browser Office runtime");
document.body.append(script);

globalThis.spellbookBrowserOffice = {
  artifactLabels() {
    return [...savedArtifacts.keys()];
  },
  artifact(label) {
    const bytes = savedArtifacts.get(label);
    return bytes ? Array.from(bytes) : null;
  },
  evidence: observed,
};
