const allowedOrigins =
  process.env.SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS?.trim() ||
  process.env.SPELLBOOK_PUBLIC_URL?.trim();
if (!allowedOrigins)
  throw new Error(
    "Set SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS to the exact Spellbook web origin.",
  );
if (!process.env.SPELLBOOK_LOCAL_EMAIL?.trim())
  throw new Error("SPELLBOOK_LOCAL_EMAIL is required.");

process.env.SPELLBOOK_CONNECTOR_MODE = "local";
process.env.SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS = allowedOrigins;
process.env.PORT = process.env.SPELLBOOK_LOCAL_CONNECTOR_PORT?.trim() || "43127";

await import("../apps/ai-connector/dist/server.js");

