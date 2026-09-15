/* SPDX-License-Identifier: MPL-2.0 */

"use strict";

let zetajs;
let css;
let context;
let desktop;
let model;

function installSpellbookUnoAdapter() {
  globalThis.uno = {
    idl: zetajs.uno,
    componentContext: context,
    Any: zetajs.Any,
    sameUnoObject: zetajs.sameUnoObject,
    type: zetajs.type,
  };
}

let nativeAdapter;

function post(command, details = {}) {
  zetajs.mainPort.postMessage({ command, ...details });
}

function slideCount() {
  return model?.getDrawPages().getCount() ?? 0;
}

function dispatch(command) {
  const url = {
    val: new css.util.URL({ Complete: `.uno:${command}` }),
  };
  css.util.URLTransformer.create(context).parseStrict(url);
  const controller = model.getCurrentController();
  const dispatcher = controller.queryDispatch(url.val, "_self", 0);
  if (!dispatcher) throw new Error(`UNO command is unavailable: ${command}`);
  dispatcher.dispatch(url.val, []);
}

function property(Name, type, value) {
  return new css.beans.PropertyValue({
    Name,
    Value: new zetajs.Any(type, value),
  });
}

function imageSignatureIsValid(bytes, mediaType) {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const png =
    view.length === 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => view[index] === value,
    );
  const jpeg = view[0] === 0xff && view[1] === 0xd8;
  return mediaType === "image/png" ? png : mediaType === "image/jpeg" && jpeg;
}

function observeDocument(request = {}) {
  return spellbookDocumentOperation({
    operation: "observe",
    ...request,
    mutationContracts: spellbookMutationContracts,
    nativeAdapter,
  });
}

function insertImage(request) {
  const { imageBytes, mediaType, slideIndex, expectedRevision, permission } =
    request;
  if (
    !(imageBytes instanceof ArrayBuffer) ||
    !imageBytes.byteLength ||
    imageBytes.byteLength > 5_000_000 ||
    !imageSignatureIsValid(imageBytes, mediaType)
  )
    throw new Error("invalid_generated_image");
  const before = observeDocument();
  if (
    typeof expectedRevision !== "string" ||
    before.revision !== expectedRevision
  )
    throw new Error("document_changed_observe_again");
  if (
    !Number.isSafeInteger(slideIndex) ||
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
  const path = `/tmp/spellbook/generated-${Date.now()}.${extension}`;
  const undo = model.getUndoManager();
  const undoCount = undo.getAllUndoActionTitles().length;
  let contextOpen = false;
  try {
    FS.writeFile(path, new Uint8Array(imageBytes));
    const provider = css.graphic.GraphicProvider.create(context);
    const graphic = provider.queryGraphic([
      property("URL", zetajs.type.string, `file://${path}`),
    ]);
    if (!graphic) throw new Error("generated_image_decode_failed");
    const page = model.getDrawPages().getByIndex(slideIndex);
    const shape = model.createInstance(
      "com.sun.star.drawing.GraphicObjectShape",
    );
    const pageWidth = Number(page.getPropertyValue("Width")) || 28_000;
    const pageHeight = Number(page.getPropertyValue("Height")) || 15_750;
    const sourceSize = graphic.Size100thMM ?? { Width: 4, Height: 3 };
    const sourceWidth = Math.max(1, Number(sourceSize.Width) || 4);
    const sourceHeight = Math.max(1, Number(sourceSize.Height) || 3);
    const scale = Math.min(
      (pageWidth * 0.7) / sourceWidth,
      (pageHeight * 0.7) / sourceHeight,
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    shape.setPosition(
      new css.awt.Point({
        X: Math.round((pageWidth - width) / 2),
        Y: Math.round((pageHeight - height) / 2),
      }),
    );
    shape.setSize(new css.awt.Size({ Width: width, Height: height }));
    shape.setPropertyValue(
      "Graphic",
      new zetajs.Any(zetajs.type.interface(css.graphic.XGraphic), graphic),
    );
    undo.enterUndoContext("AI generated image");
    contextOpen = true;
    page.add(shape);
    undo.leaveUndoContext();
    contextOpen = false;
    const after = observeDocument({
      detailSlideIndex: slideIndex,
      captureSlideIndexes: [slideIndex],
    });
    const beforeCount = before.slides.reduce(
      (total, slide) => total + slide.elements.length,
      0,
    );
    const afterCount = after.slides.reduce(
      (total, slide) => total + slide.elements.length,
      0,
    );
    if (
      afterCount !== beforeCount + 1 ||
      undo.getAllUndoActionTitles().length !== undoCount + 1
    )
      throw new Error(
        afterCount !== beforeCount + 1
          ? "generated_image_was_not_inserted"
          : "native_undo_not_recorded",
      );
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
    const introducedIssues = (after.layoutAudit?.issues ?? []).filter(
      (issue) => !beforeIssues.has(issueKey(issue)),
    );
    return {
      ...after,
      changedSlideIndexes: [slideIndex],
      visualEvidenceComplete:
        after.images?.length === 1 &&
        after.images[0]?.slideIndex === slideIndex,
      layoutAudit: {
        ...after.layoutAudit,
        introducedIssueCount: introducedIssues.length,
        introducedIssues,
      },
    };
  } catch (error) {
    if (contextOpen) undo.leaveUndoContext();
    while (undo.getAllUndoActionTitles().length > undoCount) undo.undo();
    throw error;
  } finally {
    try {
      FS.unlink(path);
    } catch {}
  }
}

function storeDocument(path, requestId) {
  if (!model) throw new Error("No browser Office document is open.");
  model.storeToURL(`file://${path}`, [
    property("FilterName", zetajs.type.string, "Impress Office Open XML"),
    property("Overwrite", zetajs.type.boolean, true),
  ]);
  post("store-complete", {
    requestId,
    path,
    modified: model.isModified(),
  });
}

function closeDocument() {
  if (!model) return;
  try {
    model.close(true);
  } catch {
    model.dispose();
  }
  model = undefined;
}

function openDocument(path, requestId) {
  closeDocument();
  model = desktop.loadComponentFromURL(`file://${path}`, "_default", 0, []);
  const controller = model.getCurrentController();
  controller.getFrame().getContainerWindow().FullScreen = true;
  post("document-ready", { requestId, slideCount: slideCount() });
}

function reportError(error, requestId) {
  post("error", {
    requestId,
    message: error instanceof Error ? error.message : String(error),
  });
}

function start() {
  context = zetajs.getUnoComponentContext();
  css = zetajs.uno.com.sun.star;
  desktop = css.frame.Desktop.create(context);
  installSpellbookUnoAdapter();
  if (typeof createSpellbookBrowserNativeAdapter !== "function")
    throw new Error("Spellbook browser native adapter is unavailable.");
  nativeAdapter = createSpellbookBrowserNativeAdapter({
    uno: globalThis.uno,
    runtimeIdentity: globalThis.spellbookBrowserRuntimeCandidate,
  });
  zetajs.mainPort.onmessage = (event) => {
    const { command, requestId } = event.data;
    try {
      switch (command) {
        case "open":
          openDocument(event.data.path, requestId);
          break;
        case "dispatch":
          dispatch(event.data.unoCommand);
          post("dispatch-complete", {
            requestId,
            unoCommand: event.data.unoCommand,
            slideCount: slideCount(),
          });
          break;
        case "native":
          if (
            typeof spellbookDocumentOperation !== "function" ||
            typeof spellbookMutationContracts !== "object"
          )
            throw new Error(
              "Spellbook native operation program is unavailable.",
            );
          post("native-complete", {
            requestId,
            value:
              event.data.nativeRequest?.operation === "insert_image"
                ? insertImage(event.data.nativeRequest)
                : spellbookDocumentOperation({
                    ...event.data.nativeRequest,
                    mutationContracts: spellbookMutationContracts,
                    nativeAdapter,
                  }),
          });
          break;
        case "status":
          post("status-complete", {
            requestId,
            modified: Boolean(model?.isModified()),
            slideCount: slideCount(),
          });
          break;
        case "store":
          storeDocument(event.data.path, requestId);
          break;
        case "mark-saved":
          if (!model) throw new Error("No browser Office document is open.");
          model.setModified(false);
          model.getUndoManager().clear();
          post("mark-saved-complete", { requestId });
          break;
        case "close":
          closeDocument();
          post("close-complete", { requestId });
          break;
        default:
          throw new Error(`Unknown browser Office command: ${command}`);
      }
    } catch (error) {
      reportError(error, requestId);
    }
  };
  post("runtime-ready");
}

Module.zetajs.then((bridge) => {
  zetajs = bridge;
  start();
});
