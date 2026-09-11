import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalStorage, safeObjectPath } from "./local-storage.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((item) => fs.rm(item, { recursive: true, force: true })),
  );
});

describe("local object storage", () => {
  it("writes atomically and returns the stored bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spellbook-store-"));
    temporary.push(root);
    const file = new LocalStorage(root)
      .namespace("local")
      .object("docs/a.json");
    await file.save("hello");
    await expect(file.download()).resolves.toEqual([Buffer.from("hello")]);
  });

  it("implements create-if-absent for durable AI receipts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spellbook-store-"));
    temporary.push(root);
    const file = new LocalStorage(root)
      .namespace("local")
      .object("jobs/a.json");
    await file.save("first", { createIfAbsent: true });
    await expect(
      file.save("second", { createIfAbsent: true }),
    ).rejects.toMatchObject({ code: 412 });
  });

  it("rejects traversal outside the configured data directory", () => {
    expect(() => safeObjectPath("/tmp/store", "../secret")).toThrow(
      "Unsafe object name",
    );
  });
});
