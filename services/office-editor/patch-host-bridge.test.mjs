import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const patcher = path.resolve("services/office-editor/patch-host-bridge.mjs");

test("installs the host bridge once before body close", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spellbook-host-"));
  const target = path.join(directory, "cool.html");
  fs.writeFileSync(target, "<html><body>editor</body></html>");

  const result = spawnSync(process.execPath, [patcher, target], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fs.readFileSync(target, "utf8"),
    /spellbook-host\.js"><\/script>\n<\/body>/,
  );

  const duplicate = spawnSync(process.execPath, [patcher, target], {
    encoding: "utf8",
  });
  assert.notEqual(duplicate.status, 0);
});
