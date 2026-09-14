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

let port;
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
    port.postMessage({ command, requestId, ...details });
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
    }),
  );
  location.reload();
}

async function resumeConformance(expected) {
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
    port = messagePort;
    port.onmessage = async (event) => {
      const message = event.data;
      if (message.command === "runtime-ready") {
        setState("runtime-ready", "Engine ready");
        if (new URLSearchParams(location.search).get("autorun") === "1") {
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
