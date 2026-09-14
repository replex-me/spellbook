import { describe, expect, it } from "vitest";

import {
  hasStorageCapacity,
  StorageCapacityError,
  storageReserveBytes,
} from "./storage";
import { routeError } from "./http";

describe("local storage capacity boundary", () => {
  it("keeps a bounded reserve after the complete atomic write", () => {
    const reserve = 512 * 1024 * 1024;
    expect(storageReserveBytes(undefined)).toBe(reserve);
    expect(hasStorageCapacity(reserve + 10, 10, reserve)).toBe(true);
    expect(hasStorageCapacity(reserve + 9, 10, reserve)).toBe(false);
    expect(storageReserveBytes(String(64 * 1024 * 1024))).toBe(
      64 * 1024 * 1024,
    );
    expect(() => storageReserveBytes("0")).toThrow();
    expect(() => storageReserveBytes("1.5")).toThrow();
  });

  it("reports capacity exhaustion as HTTP 507 instead of an opaque server error", async () => {
    const response = routeError(new StorageCapacityError());
    expect(response.status).toBe(507);
    await expect(response.json()).resolves.toEqual({
      error: "storage_capacity_exhausted",
    });
  });
});
