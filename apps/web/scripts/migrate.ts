import { closeDb, runMigrations } from "../src/lib/db";

try {
  await runMigrations();
  process.stdout.write("Spellbook schema migration completed.\n");
} finally {
  await closeDb();
}
