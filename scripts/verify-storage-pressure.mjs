import { spawnSync } from "node:child_process";

const image = process.argv[2];
if (!image) {
  console.error(
    "Usage: node scripts/verify-storage-pressure.mjs <ai-connector-image>",
  );
  process.exit(2);
}

const mebibyte = 1024 * 1024;
const reserveBytes = 64 * mebibyte;
const probe = String.raw`
import fs from "node:fs/promises";
import { LocalStorage } from "/app/apps/ai-connector/dist/local-storage.js";

const MiB = 1024 * 1024;
const root = "/data";
const reserveBytes = 64 * MiB;
const regular = new LocalStorage(root);
await regular.namespace("local").object("objects/small.bin").save(Buffer.alloc(1 * MiB));

let preflightError = "";
try {
  await regular.namespace("local").object("objects/rejected.bin").save(Buffer.alloc(20 * MiB));
} catch (error) {
  preflightError = error instanceof Error ? error.message : String(error);
}

await fs.writeFile("/data/fill.bin", Buffer.alloc(58 * MiB));
await regular.namespace("local").object("jobs/failure.json").save(
  JSON.stringify({ status: "failed", error: "storage_capacity_exhausted" }),
  { createIfAbsent: true, controlReceipt: true },
);
const raced = new LocalStorage(root, {
  reserveBytes,
  availableBytes: async () => 200 * MiB,
});
let raceError = "";
try {
  await raced.namespace("local").object("objects/raced.bin").save(Buffer.alloc(24 * MiB));
} catch (error) {
  raceError = error instanceof Error ? error.message : String(error);
}

const objectNames = await fs.readdir("/data/objects");
const result = {
  preflightError,
  raceError,
  smallBytes: (await fs.stat("/data/objects/small.bin")).size,
  receiptBytes: (await fs.stat("/data/jobs/failure.json")).size,
  rejectedExists: objectNames.includes("rejected.bin"),
  racedExists: objectNames.includes("raced.bin"),
  temporaryFiles: objectNames.filter((name) => name.endsWith(".tmp")),
};
console.log(JSON.stringify(result));
if (
  preflightError !== "storage_capacity_exhausted" ||
  raceError !== "storage_capacity_exhausted" ||
  result.smallBytes !== 1 * MiB ||
  result.receiptBytes < 1 ||
  result.rejectedExists ||
  result.racedExists ||
  result.temporaryFiles.length !== 0
) process.exit(1);
`;

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--tmpfs",
    "/data:rw,size=80m,mode=1777",
    "--env",
    `SPELLBOOK_STORAGE_RESERVE_BYTES=${reserveBytes}`,
    "--entrypoint",
    "node",
    image,
    "--input-type=module",
    "--eval",
    probe,
  ],
  { encoding: "utf8", env: process.env },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Storage pressure probe failed with exit ${result.status}.`);
