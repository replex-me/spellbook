/* Only the embedding host can establish the port; document text and model
 * output cannot turn into scripts. The host checks the editor origin.
 */
window.presentNative = {
  observe: () =>
    cool.callRemote(presentDocumentOperation, { operation: "observe" }),
  edit: (request) =>
    cool.callRemote(presentDocumentOperation, {
      ...request,
      operation: "edit",
    }),
};
let connection;
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
const waitForInsertedImage = async (beforeCount) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = await window.presentNative.observe();
    if (elementCount(state) > beforeCount) return state;
  }
  throw new Error("generated_image_was_not_inserted");
};
const insertImage = async (request) => {
  const { imageBytes, mediaType } = request;
  if (
    !(imageBytes instanceof ArrayBuffer) ||
    !imageBytes.byteLength ||
    imageBytes.byteLength > 5_000_000 ||
    !imageSignatureIsValid(imageBytes, mediaType)
  )
    throw new Error("invalid_generated_image");
  const before = await window.presentNative.observe();
  const extension = mediaType === "image/png" ? "png" : "jpg";
  const file = new File([imageBytes], `AI-generated.${extension}`, {
    type: mediaType,
  });
  const editorMap = window.parent.app?.map;
  if (!editorMap) throw new Error("native_editor_map_unavailable");
  editorMap.fire("insertgraphic", { file });
  return waitForInsertedImage(elementCount(before));
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
  const completed = new Map();
  let tail = Promise.resolve();
  connection.onmessage = (event) => {
    const message = event.data;
    if (
      !message?.id ||
      !["observe", "edit", "insert_image"].includes(message.request?.operation)
    )
      return;
    if (!completed.has(message.id)) {
      const task = tail.then(() =>
        message.request.operation === "insert_image"
          ? insertImage(message.request)
          : cool.callRemote(presentDocumentOperation, message.request),
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
window.top.postMessage({ type: "spellbook.extension-ready" }, "*");
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
