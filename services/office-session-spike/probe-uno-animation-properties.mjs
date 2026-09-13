import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const url = process.argv[2] ?? "http://localhost:3190";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 60_000;
  let extensionFrame;
  while (!extensionFrame) {
    extensionFrame = page
      .frames()
      .find((frame) =>
        frame.url().includes("/extensions/org.spellbook.editor/"),
      );
    if (Date.now() >= deadline)
      throw new Error("Native editor extension did not connect.");
    if (!extensionFrame) await page.waitForTimeout(250);
  }

  const result = await extensionFrame.evaluate(() =>
    cool.callRemote(function probeAnimationPropertyUndo() {
      const desktop = uno.idl.com.sun.star.frame.Desktop.create(
        uno.componentContext,
      );
      const model = desktop.getCurrentFrame().getController().getModel();
      const slide = model.getDrawPages().getByIndex(0);
      const undo = model.getUndoManager();
      const root = slide.getAnimationNode();
      const nodes = [];
      const readDuration = (node) => {
        try {
          return node.Duration;
        } catch (_) {
          return node.getDuration();
        }
      };
      const visit = (node, path) => {
        if (!node || nodes.length >= 200) return;
        let duration = null;
        try {
          duration = readDuration(node);
        } catch (_) {}
        nodes.push({ node, path, duration });
        try {
          const children = node.createEnumeration();
          let index = 0;
          while (children.hasMoreElements() && index < 50) {
            visit(children.nextElement(), [...path, index]);
            index++;
          }
        } catch (_) {}
      };
      visit(root, [0]);
      const candidate = nodes.find(
        (entry) =>
          typeof entry.duration === "number" &&
          Number.isFinite(entry.duration) &&
          entry.duration >= 0.1,
      );
      if (!candidate) throw new Error("animation_duration_candidate_missing");

      const before = candidate.duration;
      const requested = before === 1.25 ? 1.5 : 1.25;
      const undoBefore = undo.getAllUndoActionTitles().length;
      let contextOpen = false;
      try {
        undo.enterUndoContext("Probe animation duration");
        contextOpen = true;
        candidate.node.Duration = new uno.Any(uno.type.double, requested);
        undo.leaveUndoContext();
        contextOpen = false;
        const after = readDuration(candidate.node);
        const undoAdded = undo.getAllUndoActionTitles().length - undoBefore;
        let restored = null;
        let redone = null;
        if (undoAdded > 0) {
          undo.undo();
          restored = readDuration(candidate.node);
          undo.redo();
          redone = readDuration(candidate.node);
          undo.undo();
        } else {
          candidate.node.Duration = new uno.Any(uno.type.double, before);
          restored = readDuration(candidate.node);
        }
        return {
          path: candidate.path,
          before,
          requested,
          after,
          undoAdded,
          applied: after === requested,
          undoExact: undoAdded > 0 && restored === before,
          redoExact: undoAdded > 0 && redone === after,
          restoredAfterProbe: restored === before,
        };
      } catch (error) {
        if (contextOpen)
          try {
            undo.leaveUndoContext();
          } catch (_) {}
        while (undo.getAllUndoActionTitles().length > undoBefore) undo.undo();
        try {
          candidate.node.Duration = new uno.Any(uno.type.double, before);
        } catch (_) {}
        throw error;
      }
    }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
