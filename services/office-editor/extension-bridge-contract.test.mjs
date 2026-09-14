import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("extension repeats its ready handshake until the host transfers a port", async () => {
  const source = fs.readFileSync(
    "services/office-editor/extension/bridge.js",
    "utf8",
  );
  const messages = [];
  const listeners = new Map();
  const intervals = new Map();
  const cleared = [];
  let nextInterval = 1;
  const portMessages = [];
  const top = {
    postMessage(message, targetOrigin) {
      messages.push({ message, targetOrigin });
    },
  };
  const window = {
    top,
    parent: { app: { map: {} } },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const context = {
    window,
    document: {
      getElementById() {
        return { textContent: "" };
      },
    },
    cool: {
      callRemote() {
        return Promise.resolve({
          slides: [],
          activeSlide: 0,
          revision: "r1",
        });
      },
    },
    spellbookDocumentOperation() {},
    spellbookMutationContracts: {},
    File: class File {},
    setInterval(callback) {
      const id = nextInterval++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      cleared.push(id);
      intervals.delete(id);
    },
    setTimeout,
    Uint8Array,
    ArrayBuffer,
    Promise,
    Error,
    Map,
  };
  vm.runInNewContext(source, context);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.type, "spellbook.extension-ready");
  assert.equal(messages[0].targetOrigin, "*");
  assert.equal(intervals.size, 1);
  const repeat = [...intervals.values()][0];
  repeat();
  assert.equal(messages.length, 2);

  const port = {
    postMessage(message) {
      portMessages.push(message);
    },
  };
  listeners.get("message")({
    source: top,
    data: { type: "spellbook.connect" },
    ports: [port],
  });
  assert.equal(cleared.length, 1);
  assert.equal(portMessages.length, 1);
  assert.equal(portMessages[0].type, "ready");
  repeat();
  assert.equal(messages.length, 2);
});
