/* Only the embedding host can establish the port; document text and model
 * output cannot turn into scripts. The host checks the editor origin.
 */
window.presentNative = {
  observe: (detailSlideIndex = null) =>
    cool.callRemote(spellbookDocumentOperation, {
      operation: "observe",
      detailSlideIndex,
      mutationContracts: spellbookMutationContracts,
    }),
  edit: (request) =>
    cool.callRemote(spellbookDocumentOperation, {
      ...request,
      operation: "edit",
      mutationContracts: spellbookMutationContracts,
    }),
  editBatch: (request) =>
    cool.callRemote(spellbookDocumentOperation, {
      ...request,
      operation: "edit_batch",
      mutationContracts: spellbookMutationContracts,
    }),
};
let connection;
let readyTimer;
const imageSignatureIsValid = (bytes, mediaType) => {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const png =
    view.length === 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => view[index] === value,
    );
  const jpeg = view[0] === 0xff && view[1] === 0xd8;
  return mediaType === "image/png" ? png : mediaType === "image/jpeg" && jpeg;
};
const elementCount = (state) =>
  state.slides.reduce((total, slide) => total + slide.elements.length, 0);
const waitForInsertedImage = async (before, slideIndex) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = await window.presentNative.observe(slideIndex);
    const targetCount = state.slides[slideIndex]?.elements.length;
    const beforeTargetCount = before.slides[slideIndex]?.elements.length;
    const otherSlidesUnchanged = before.slides.every(
      (slide) =>
        slide.slideIndex === slideIndex ||
        state.slides[slide.slideIndex]?.elements.length ===
          slide.elements.length,
    );
    if (
      targetCount === beforeTargetCount + 1 &&
      elementCount(state) === elementCount(before) + 1 &&
      otherSlidesUnchanged
    ) {
      const issueKey = (issue) =>
        JSON.stringify({
          slideIndex: issue.slideIndex,
          code: issue.code,
          stableId: issue.stableId ?? null,
          stableIds: issue.stableIds ?? null,
        });
      const beforeIssues = new Set(
        (before.layoutAudit?.issues ?? []).map(issueKey),
      );
      const introducedIssues = (state.layoutAudit?.issues ?? []).filter(
        (issue) => !beforeIssues.has(issueKey(issue)),
      );
      return {
        ...state,
        changedSlideIndexes: [slideIndex],
        visualEvidenceComplete:
          state.images?.length === 1 &&
          state.images[0]?.slideIndex === slideIndex,
        layoutAudit: {
          ...state.layoutAudit,
          introducedIssueCount: introducedIssues.length,
          introducedIssues,
        },
      };
    }
  }
  throw new Error("generated_image_was_not_inserted");
};
const insertImage = async (request) => {
  const { imageBytes, mediaType, slideIndex, expectedRevision, permission } =
    request;
  if (
    !(imageBytes instanceof ArrayBuffer) ||
    !imageBytes.byteLength ||
    imageBytes.byteLength > 5_000_000 ||
    !imageSignatureIsValid(imageBytes, mediaType)
  )
    throw new Error("invalid_generated_image");
  const before = await window.presentNative.observe();
  if (
    typeof expectedRevision !== "string" ||
    before.revision !== expectedRevision
  )
    throw new Error("document_changed_observe_again");
  if (
    !Number.isInteger(slideIndex) ||
    slideIndex < 0 ||
    slideIndex >= before.slides.length ||
    before.activeSlide !== slideIndex
  )
    throw new Error("generated_image_slide_changed");
  if (
    !permission ||
    !["slides", "document"].includes(permission.mode) ||
    (permission.mode === "slides" &&
      !permission.slideIndexes?.includes(slideIndex))
  )
    throw new Error("outside_edit_permission");
  const extension = mediaType === "image/png" ? "png" : "jpg";
  const file = new File([imageBytes], `AI-generated.${extension}`, {
    type: mediaType,
  });
  const editorMap = window.parent.app?.map;
  if (!editorMap) throw new Error("native_editor_map_unavailable");
  editorMap.fire("insertgraphic", { file });
  return waitForInsertedImage(before, slideIndex);
};
window.addEventListener("message", (event) => {
  if (
    event.source !== window.top ||
    event.data?.type !== "spellbook.connect" ||
    !event.ports[0]
  )
    return;
  if (connection) return;
  connection = event.ports[0];
  clearInterval(readyTimer);
  const completed = new Map();
  let tail = Promise.resolve();
  connection.onmessage = (event) => {
    const message = event.data;
    if (
      !message?.id ||
      !["observe", "edit", "edit_batch", "insert_image"].includes(
        message.request?.operation,
      )
    )
      return;
    if (!completed.has(message.id)) {
      const task = tail.then(() =>
        message.request.operation === "insert_image"
          ? insertImage(message.request)
          : cool.callRemote(spellbookDocumentOperation, {
              ...message.request,
              mutationContracts: spellbookMutationContracts,
            }),
      );
      tail = task.catch(() => undefined);
      completed.set(message.id, task);
      // Pending/result receipts are bounded to this active page session.
      if (completed.size > 100) completed.delete(completed.keys().next().value);
    }
    completed.get(message.id).then(
      (value) => connection.postMessage({ id: message.id, value }),
      (error) =>
        connection.postMessage({ id: message.id, error: error.message }),
    );
  };
  connection.postMessage({ type: "ready" });
});
const announceReady = () => {
  if (connection) {
    clearInterval(readyTimer);
    return;
  }
  window.top.postMessage({ type: "spellbook.extension-ready" }, "*");
};
announceReady();
readyTimer = setInterval(announceReady, 250);
window.presentNative
  .observe()
  .then((state) => {
    document.getElementById("state").textContent =
      `${state.slides.length}개 슬라이드 연결됨`;
  })
  .catch((error) => {
    document.getElementById("state").textContent =
      `문서를 연결하지 못했습니다: ${error.message}`;
  });
