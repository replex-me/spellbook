import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STORAGE_RESERVE_BYTES = 512 * 1024 * 1024;
const MIN_STORAGE_RESERVE_BYTES = 64 * 1024 * 1024;
const MAX_STORAGE_RESERVE_BYTES = 1024 * 1024 * 1024 * 1024;
const CONTROL_STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;
const MAX_CONTROL_WRITE_BYTES = 1024 * 1024;

interface CapacityPolicy {
  reserveBytes: number;
  availableBytes(root: string): Promise<number>;
}

export interface StoredObject {
  download(options?: { destination?: string }): Promise<[Buffer]>;
  save(
    value: string | Buffer,
    options?: { createIfAbsent?: boolean; controlReceipt?: boolean },
  ): Promise<void>;
}

export interface ObjectStore {
  namespace(name: string): { object(name: string): StoredObject };
}

export class LocalStorage implements ObjectStore {
  constructor(
    private readonly root = path.resolve(
      process.env.SPELLBOOK_DATA_DIR?.trim() || ".spellbook/data",
    ),
    private readonly capacity: CapacityPolicy = {
      reserveBytes: storageReserveBytes(),
      availableBytes: availableStorageBytes,
    },
  ) {}

  namespace(_name: string) {
    return {
      object: (objectName: string): StoredObject => {
        const location = safeObjectPath(this.root, objectName);
        return {
          download: async (options) => {
            try {
              const data = await fs.readFile(location);
              if (options?.destination) {
                await fs.mkdir(path.dirname(options.destination), {
                  recursive: true,
                });
                await fs.writeFile(options.destination, data, { mode: 0o600 });
              }
              return [data];
            } catch (error) {
              if (hasCode(error, "ENOENT")) throw { code: 404 };
              throw error;
            }
          },
          save: async (value, options) => {
            await fs.mkdir(path.dirname(location), { recursive: true });
            const exclusive = options?.createIfAbsent === true;
            const bytes = Buffer.isBuffer(value)
              ? value.byteLength
              : Buffer.byteLength(value);
            const controlReceipt = options?.controlReceipt === true;
            if (controlReceipt && bytes > MAX_CONTROL_WRITE_BYTES)
              throw new Error("storage_control_receipt_too_large");
            const available = await this.capacity.availableBytes(this.root);
            const reserveBytes = controlReceipt
              ? CONTROL_STORAGE_RESERVE_BYTES
              : this.capacity.reserveBytes;
            if (available - bytes < reserveBytes)
              throw new Error("storage_capacity_exhausted");
            const temporary = `${location}.${process.pid}.${randomUUID()}.tmp`;
            try {
              await fs.writeFile(temporary, value, {
                flag: "wx",
                mode: 0o600,
              });
              if (exclusive) {
                await fs.link(temporary, location);
                return;
              }
              await fs.rename(temporary, location);
            } catch (error) {
              if (exclusive && hasCode(error, "EEXIST")) throw { code: 412 };
              if (hasCode(error, "ENOSPC"))
                throw new Error("storage_capacity_exhausted");
              throw error;
            } finally {
              await fs.rm(temporary, { force: true }).catch(() => undefined);
            }
          },
        };
      },
    };
  }
}

export function storageReserveBytes(
  value = process.env.SPELLBOOK_STORAGE_RESERVE_BYTES,
): number {
  if (value === undefined || value.trim() === "")
    return DEFAULT_STORAGE_RESERVE_BYTES;
  const bytes = Number(value);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < MIN_STORAGE_RESERVE_BYTES ||
    bytes > MAX_STORAGE_RESERVE_BYTES
  )
    throw new Error(
      `SPELLBOOK_STORAGE_RESERVE_BYTES must be an integer from ${MIN_STORAGE_RESERVE_BYTES} to ${MAX_STORAGE_RESERVE_BYTES}.`,
    );
  return bytes;
}

async function availableStorageBytes(root: string): Promise<number> {
  const capacity = await fs.statfs(root);
  return Number(capacity.bavail) * Number(capacity.bsize);
}

export function safeObjectPath(root: string, objectName: string): string {
  if (
    !objectName ||
    objectName.startsWith("/") ||
    objectName.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Unsafe object name.");
  const result = path.resolve(root, objectName);
  if (!result.startsWith(`${root}${path.sep}`))
    throw new Error("Unsafe object name.");
  return result;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
