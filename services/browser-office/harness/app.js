/* SPDX-License-Identifier: MPL-2.0 */

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
let currentBytes;
let currentSlideCount = 0;

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
  undoButton.disabled = history.length === 0;
  return result;
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
  const initial = await writeAndOpen(fixture, "general-native-surface.pptx");
  const addMutation = await addSlide();
  if (currentSlideCount !== initial.slideCount + 1)
    throw new Error("OOXML add_slide did not add exactly one slide.");
  const added = await recordBytes(
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
  const deleted = await recordBytes(
    "after-delete",
    currentBytes,
    currentSlideCount,
    deleteMutation,
  );

  const undoCounts = [
    initial.slideCount + 2,
    initial.slideCount + 2,
    initial.slideCount + 1,
    initial.slideCount,
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
  if (deleted.entry.sha256 === restored.entry.sha256)
    throw new Error("Mutation and undone saves unexpectedly match.");
  const reopenPath = "/tmp/spellbook/reopened.pptx";
  FS.writeFile(reopenPath, restored.bytes);
  const reopened = await request("open", { path: reopenPath });
  if (reopened.slideCount !== initial.slideCount)
    throw new Error("The undone PPTX changed after browser reopen.");
  await waitForUiPaint("reopen");
  body.dataset.initialSlides = String(initial.slideCount);
  body.dataset.reopenedSlides = String(reopened.slideCount);
  body.dataset.mutatedSha256 = deleted.entry.sha256;
  body.dataset.restoredSha256 = restored.entry.sha256;
  body.dataset.addedSha256 = added.entry.sha256;
  body.dataset.topologyOperations = "add,duplicate,move,delete";
  setState(
    "complete",
    "Browser slide topology, four-step Undo and reopen passed",
  );
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  history.length = 0;
  undoButton.disabled = true;
  await writeAndOpen(new Uint8Array(await file.arrayBuffer()), file.name);
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
  artifact(label) {
    const bytes = savedArtifacts.get(label);
    return bytes ? Array.from(bytes) : null;
  },
  evidence: observed,
};
