/* SPDX-License-Identifier: MPL-2.0 */

"use strict";

let zetajs;
let css;
let context;
let desktop;
let model;

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
