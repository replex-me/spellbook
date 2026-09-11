import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: patch-host-bridge.mjs <cool.html>");

const source = fs.readFileSync(file, "utf8");
const marker = "</body>";
const script =
  '<script src="%SERVICE_ROOT%/browser/%VERSION%/spellbook-host.js"></script>';

if (source.includes(script))
  throw new Error("host bridge is already installed");
const matches = source.split(marker).length - 1;
if (matches !== 1) {
  throw new Error(`expected one ${marker} marker, found ${matches}`);
}

fs.writeFileSync(file, source.replace(marker, `${script}\n${marker}`));
