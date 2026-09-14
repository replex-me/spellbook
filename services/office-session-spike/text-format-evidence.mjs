const EAST_ASIAN_SCRIPT =
  /[\p{Script_Extensions=Han}\p{Script_Extensions=Hangul}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Bopomofo}]/u;
const COMPLEX_SCRIPT =
  /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\p{Script_Extensions=Syriac}\p{Script_Extensions=Thaana}\p{Script_Extensions=Nko}\p{Script_Extensions=Samaritan}\p{Script_Extensions=Mandaic}\p{Script_Extensions=Devanagari}\p{Script_Extensions=Bengali}\p{Script_Extensions=Gurmukhi}\p{Script_Extensions=Gujarati}\p{Script_Extensions=Oriya}\p{Script_Extensions=Tamil}\p{Script_Extensions=Telugu}\p{Script_Extensions=Kannada}\p{Script_Extensions=Malayalam}\p{Script_Extensions=Sinhala}\p{Script_Extensions=Thai}\p{Script_Extensions=Lao}\p{Script_Extensions=Tibetan}\p{Script_Extensions=Myanmar}\p{Script_Extensions=Khmer}]/u;
const TEXTUAL_CHARACTER = /[\p{Letter}\p{Number}]/u;

const METRIC_COMPATIBLE_FONT_FAMILIES = new Map(
  [
    ["Arial", "Liberation Sans"],
    ["Arial Narrow", "Liberation Sans Narrow"],
    ["Calibri", "Carlito"],
    ["Calibri Light", "Carlito"],
    ["Cambria", "Caladea"],
    ["Times New Roman", "Liberation Serif"],
    ["Courier New", "Liberation Mono"],
  ].flatMap(([office, open]) => [
    [office.toLocaleLowerCase("en-US"), office],
    [open.toLocaleLowerCase("en-US"), office],
  ]),
);

export function canonicalFontFamily(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return (
    METRIC_COMPATIBLE_FONT_FAMILIES.get(trimmed.toLocaleLowerCase("en-US")) ??
    trimmed
  );
}

export function scriptFontSlot(character) {
  if (EAST_ASIAN_SCRIPT.test(character)) return "asian";
  if (COMPLEX_SCRIPT.test(character)) return "complex";
  if (TEXTUAL_CHARACTER.test(character)) return "western";
  return null;
}

const SLOT_SUFFIX = {
  western: "",
  asian: "Asian",
  complex: "Complex",
};

function activeSlots(text) {
  return new Set([...String(text ?? "")].map(scriptFontSlot).filter(Boolean));
}

export function normalizeActiveTextFormatting(formatting, text) {
  if (formatting === null || typeof formatting !== "object") return formatting;
  const slots = activeSlots(text);
  const scriptKeys = new Set(
    ["fontFamily", "fontSize", "fontWeight", "fontStyle"].flatMap((stem) =>
      Object.values(SLOT_SUFFIX).map((suffix) => `${stem}${suffix}`),
    ),
  );
  const normalized = Object.fromEntries(
    Object.entries(formatting).filter(([key]) => !scriptKeys.has(key)),
  );
  for (const slot of slots) {
    const suffix = SLOT_SUFFIX[slot];
    for (const stem of ["fontFamily", "fontSize", "fontWeight", "fontStyle"]) {
      const key = `${stem}${suffix}`;
      if (!(key in formatting)) continue;
      normalized[key] =
        stem === "fontFamily"
          ? canonicalFontFamily(formatting[key])
          : formatting[key];
    }
  }
  return normalized;
}

/**
 * Records the font slot that actually draws every textual character. This is
 * stable when OOXML splits or merges runs and avoids treating dormant western,
 * East Asian or complex-script defaults as visible formatting.
 */
export function activeTextFontEvidence(detailElement) {
  const evidence = [];
  for (const paragraph of detailElement?.paragraphs ?? []) {
    for (const portion of paragraph.portions ?? []) {
      let offset = Number(portion.startOffset ?? 0);
      for (const character of String(portion.text ?? "")) {
        const slot = scriptFontSlot(character);
        if (slot) {
          const suffix = SLOT_SUFFIX[slot];
          evidence.push({
            offset,
            character,
            slot,
            fontFamily: canonicalFontFamily(portion[`fontFamily${suffix}`]),
            fontSize: portion[`fontSize${suffix}`],
            fontWeight: portion[`fontWeight${suffix}`],
            fontStyle: portion[`fontStyle${suffix}`],
          });
        }
        offset += character.length;
      }
    }
  }
  return evidence;
}
