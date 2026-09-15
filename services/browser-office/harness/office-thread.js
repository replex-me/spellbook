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
            value: spellbookDocumentOperation({
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
