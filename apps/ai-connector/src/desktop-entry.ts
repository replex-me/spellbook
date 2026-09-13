import path from "node:path";
import process from "node:process";

process.env.SPELLBOOK_CONNECTOR_MODE = "local";
process.env.SPELLBOOK_LOCAL_EMAIL ||= "local@spellbook";
process.env.PORT ||= "43127";
process.env.CODEX_BIN ||= path.resolve(
  path.dirname(process.execPath),
  "../Resources/codex/bin/codex",
);
process.env.SPELLBOOK_CONTRACTS_DIR ||= path.resolve(
  path.dirname(process.execPath),
  "../Resources/contracts",
);

void import("./server.js").catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
