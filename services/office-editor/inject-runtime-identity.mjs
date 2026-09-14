import fs from "node:fs";

const [
  target,
  patchLevel,
  publicCommit,
  engineImage,
  patchSeriesSha256,
  collaboraSourceCommit,
] = process.argv.slice(2);

if (!target) throw new Error("Missing operations.js path.");
if (!/^(?:stock|undo-v[1-9][0-9]*)$/u.test(patchLevel ?? ""))
  throw new Error("Invalid engine patch level.");

const releaseIdentity = patchLevel !== "stock";
if (releaseIdentity) {
  if (!/^[0-9a-f]{40}$/u.test(publicCommit ?? ""))
    throw new Error("Invalid public source commit.");
  if (!/@sha256:[0-9a-f]{64}$/u.test(engineImage ?? ""))
    throw new Error("The engine image must be digest-pinned.");
  if (!/^[0-9a-f]{64}$/u.test(patchSeriesSha256 ?? ""))
    throw new Error("Invalid patch-series digest.");
  if (!/^[0-9a-f]{40}$/u.test(collaboraSourceCommit ?? ""))
    throw new Error("Invalid Collabora source commit.");
}

const values = {
  __SPELLBOOK_ENGINE_PATCH_LEVEL__: patchLevel,
  __SPELLBOOK_PUBLIC_SOURCE_REVISION__: publicCommit ?? "development",
  __SPELLBOOK_COLLABORA_ENGINE_IMAGE__: engineImage ?? "stock",
  __SPELLBOOK_COLLABORA_PATCH_SERIES_SHA256__:
    patchSeriesSha256 ?? "development",
  __SPELLBOOK_COLLABORA_SOURCE_COMMIT__: collaboraSourceCommit ?? "development",
};

let source = fs.readFileSync(target, "utf8");
for (const [token, value] of Object.entries(values)) {
  const quotedToken = JSON.stringify(token);
  if (source.split(quotedToken).length !== 2)
    throw new Error(`Expected exactly one ${token} placeholder.`);
  source = source.replace(quotedToken, JSON.stringify(value));
}
if (/__SPELLBOOK_[A-Z0-9_]+__/u.test(source))
  throw new Error("An unresolved Spellbook runtime placeholder remains.");
fs.writeFileSync(target, source);
