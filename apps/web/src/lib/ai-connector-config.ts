export type AiConnectorConfig =
  | { mode: "internal" }
  | { mode: "local"; origin: string };

export function aiConnectorConfig(): AiConnectorConfig {
  const mode = process.env.SPELLBOOK_AI_CONNECTOR_MODE?.trim() || "internal";
  if (mode === "internal") return { mode };
  if (mode !== "local") throw new Error("invalid_ai_connector_mode");
  const value =
    process.env.SPELLBOOK_LOCAL_CONNECTOR_ORIGIN?.trim() ||
    "http://127.0.0.1:43127";
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  )
    throw new Error("invalid_local_connector_origin");
  return { mode, origin: url.origin };
}
