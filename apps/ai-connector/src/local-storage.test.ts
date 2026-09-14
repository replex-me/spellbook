import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LocalStorage,
  safeObjectPath,
  storageReserveBytes,
} from "./local-storage.js";

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

  it("rejects a write before consuming the configured reserve", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spellbook-store-"));
    temporary.push(root);
    const file = new LocalStorage(root, {
      reserveBytes: 100,
      availableBytes: async () => 104,
    })
      .namespace("local")
      .object("jobs/a.json");
    await expect(file.save("hello")).rejects.toThrow(
      "storage_capacity_exhausted",
    );
    await expect(fs.readdir(path.join(root, "jobs"))).resolves.toEqual([]);
  });

  it("uses the same bounded reserve contract as the web storage adapter", () => {
    expect(storageReserveBytes(undefined)).toBe(512 * 1024 * 1024);
    expect(storageReserveBytes(String(64 * 1024 * 1024))).toBe(
      64 * 1024 * 1024,
    );
    expect(() => storageReserveBytes("0")).toThrow();
  });

  it("uses only the isolated emergency margin for bounded control receipts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "spellbook-store-"));
    temporary.push(root);
    const file = new LocalStorage(root, {
      reserveBytes: 64 * 1024 * 1024,
      availableBytes: async () => 17 * 1024 * 1024,
    })
      .namespace("local")
      .object("jobs/result.json");

    await file.save("result", { controlReceipt: true });
    await expect(file.download()).resolves.toEqual([Buffer.from("result")]);
    await expect(
      file.save(Buffer.alloc(1024 * 1024 + 1), { controlReceipt: true }),
    ).rejects.toThrow("storage_control_receipt_too_large");
  });

  it("rejects traversal outside the configured data directory", () => {
    expect(() => safeObjectPath("/tmp/store", "../secret")).toThrow(
      "Unsafe object name",
    );
  });
});
