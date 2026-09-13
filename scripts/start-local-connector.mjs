process.env.SPELLBOOK_CONNECTOR_MODE = "local";
if (!process.env.SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS?.trim()) {
  const configuredOrigin = process.env.SPELLBOOK_PUBLIC_URL?.trim();
  if (configuredOrigin)
    process.env.SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS = configuredOrigin;
}
process.env.SPELLBOOK_LOCAL_EMAIL ||= "local@spellbook";
process.env.PORT = process.env.SPELLBOOK_LOCAL_CONNECTOR_PORT?.trim() || "43127";

await import("../apps/ai-connector/dist/server.js");
