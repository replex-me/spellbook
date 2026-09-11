import fs from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  download(options?: { destination?: string }): Promise<[Buffer]>;
  save(
    value: string | Buffer,
    options?: { createIfAbsent?: boolean },
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
            try {
              if (exclusive) {
                await fs.writeFile(location, value, {
                  flag: "wx",
                  mode: 0o600,
                });
                return;
              }
              const temporary = `${location}.${process.pid}.${Date.now()}.tmp`;
              await fs.writeFile(temporary, value, { mode: 0o600 });
              await fs.rename(temporary, location);
            } catch (error) {
              if (exclusive && hasCode(error, "EEXIST")) throw { code: 412 };
              throw error;
            }
          },
        };
      },
    };
  }
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
