import fs from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: patch-host-bridge.mjs <cool.html>");

const source = fs.readFileSync(file, "utf8");
const headMarker = "</head>";
const marker = "</body>";
const stylesheet =
  '<link rel="stylesheet" href="%SERVICE_ROOT%/browser/%VERSION%/spellbook-host.css">';
const script =
  '<script src="%SERVICE_ROOT%/browser/%VERSION%/spellbook-host.js"></script>';

if (source.includes(script) || source.includes(stylesheet))
  throw new Error("host bridge is already installed");
const headMatches = source.split(headMarker).length - 1;
const matches = source.split(marker).length - 1;
if (headMatches !== 1 || matches !== 1) {
  throw new Error(
    `expected one ${headMarker} and one ${marker} marker, found ${headMatches} and ${matches}`,
  );
}

fs.writeFileSync(
  file,
  source
    .replace(headMarker, `${stylesheet}\n${headMarker}`)
    .replace(marker, `${script}\n${marker}`),
);
