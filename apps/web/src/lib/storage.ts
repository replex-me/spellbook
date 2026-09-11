import fs from "node:fs/promises";
import path from "node:path";

export function accountPrefix(accountId: string, documentId: string): string {
  const accountKey = Buffer.from(accountId).toString("base64url");
  return `accounts/${accountKey}/documents/${documentId}`;
}

export function storageNamespace(): string {
  return process.env.SPELLBOOK_STORAGE_NAMESPACE?.trim() || "local";
}

export async function putObject(
  objectName: string,
  data: Buffer,
  _contentType: string,
): Promise<void> {
  const destination = objectPath(objectName);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await fs.rename(temporary, destination);
}

export async function getObject(objectName: string): Promise<Buffer> {
  return fs.readFile(/* turbopackIgnore: true */ objectPath(objectName));
}

export async function deleteObject(objectName: string): Promise<void> {
  await fs.rm(objectPath(objectName), { force: true });
}

export async function getJsonObject<T>(objectName: string): Promise<T> {
  return JSON.parse((await getObject(objectName)).toString("utf8")) as T;
}

export function objectPath(objectName: string): string {
  if (
    !objectName ||
    objectName.startsWith("/") ||
    objectName.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("Unsafe object name.");
  const base = path.resolve(
    /* turbopackIgnore: true */
    process.env.SPELLBOOK_DATA_DIR?.trim() || ".spellbook/data",
  );
  const result = path.resolve(base, objectName);
  if (!result.startsWith(`${base}${path.sep}`))
    throw new Error("Unsafe object name.");
  return result;
}
