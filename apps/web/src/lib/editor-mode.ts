export type EditorMode = "wopi" | "browser";

export function configuredEditorMode(
  value = process.env.SPELLBOOK_EDITOR_MODE,
): EditorMode {
  const normalized = value?.trim().toLowerCase() || "wopi";
  if (normalized !== "wopi" && normalized !== "browser")
    throw new Error("SPELLBOOK_EDITOR_MODE must be wopi or browser.");
  return normalized;
}
