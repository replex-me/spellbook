import { describe, expect, it } from "vitest";

import { automaticMigrationsEnabled, databasePoolMax } from "./db";

describe("databasePoolMax", () => {
  it("uses a bounded self-host default and accepts managed limits", () => {
    expect(databasePoolMax(undefined)).toBe(4);
    expect(databasePoolMax(" 1 ")).toBe(1);
    expect(databasePoolMax("50")).toBe(50);
  });

  it.each(["0", "51", "1.5", "many", "-1"])(
    "rejects an unsafe pool budget: %s",
    (value) => {
      expect(() => databasePoolMax(value)).toThrow(/SPELLBOOK_DB_POOL_MAX/);
    },
  );
});

describe("automaticMigrationsEnabled", () => {
  it("keeps self-host setup automatic by default", () => {
    expect(automaticMigrationsEnabled(undefined)).toBe(true);
    expect(automaticMigrationsEnabled("1")).toBe(true);
  });

  it("allows a managed release job to own schema changes", () => {
    expect(automaticMigrationsEnabled("0")).toBe(false);
    expect(() => automaticMigrationsEnabled("false")).toThrow(
      /SPELLBOOK_AUTO_MIGRATE/,
    );
  });
});
