import { readFile, writeFile } from "node:fs/promises";

const [dictionaryPath, overridesPath] = process.argv.slice(2);
if (!dictionaryPath || !overridesPath) {
  throw new Error(
    "usage: node patch-localization.mjs <dictionary.json> <overrides.json>",
  );
}

const dictionary = JSON.parse(await readFile(dictionaryPath, "utf8"));
const overrides = JSON.parse(await readFile(overridesPath, "utf8"));

for (const [source, translation] of Object.entries(overrides)) {
  if (
    typeof source !== "string" ||
    typeof translation !== "string" ||
    !source.trim() ||
    !translation.trim()
  ) {
    throw new Error("localization overrides must be non-empty strings");
  }
  dictionary[source] = translation;
}

await writeFile(dictionaryPath, `${JSON.stringify(dictionary)}\n`);
