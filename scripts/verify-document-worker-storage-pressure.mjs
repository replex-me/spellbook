import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const image = process.argv[2];
if (!image) {
  console.error(
    "Usage: node scripts/verify-document-worker-storage-pressure.mjs <document-worker-image>",
  );
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(
  root,
  "eval/public/fixtures/general-native-surface.pptx",
);
const container = `spellbook-worker-pressure-${randomUUID()}`;
const token = randomUUID();
const callback = deferred();
const callbackServer = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/callback") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers["x-spellbook-internal-token"] !== token) {
    response.writeHead(401).end();
    callback.reject(new Error("worker_callback_was_not_authenticated"));
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_048_576) throw new Error("callback_too_large");
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.once("finish", () => callback.resolve(value));
    response.writeHead(204, { connection: "close" }).end();
  } catch (error) {
    response.writeHead(400).end();
    callback.reject(error);
  }
});

try {
  await listen(callbackServer);
  const callbackPort = callbackServer.address().port;
  runDocker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--publish",
    "127.0.0.1::8080",
    "--tmpfs",
    "/data:rw,size=80m,mode=1777",
    "--env",
    "SPELLBOOK_DATA_DIR=/data",
    "--env",
    "SPELLBOOK_STORAGE_RESERVE_BYTES=67108864",
    "--env",
    `SPELLBOOK_INTERNAL_TOKEN=${token}`,
    image,
  ]);
  const workerOrigin = await waitForWorker(container);
  runDocker(["exec", container, "mkdir", "-p", "/data/objects"]);
  // Docker Desktop cannot copy directly into a container tmpfs path. Stage the
  // fixture on the container overlay, then copy it as the worker user so the
  // storage-pressure check still exercises the mounted /data filesystem.
  runDocker(["cp", fixture, `${container}:/tmp/storage-pressure-source.pptx`]);
  runDocker([
    "exec",
    container,
    "cp",
    "/tmp/storage-pressure-source.pptx",
    "/data/objects/source.pptx",
  ]);
  runDocker([
    "exec",
    container,
    "dd",
    "if=/dev/zero",
    "of=/data/fill.bin",
    "bs=1048576",
    "count=17",
  ]);

  const accepted = await fetch(`${workerOrigin}/internal/jobs/scan-render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spellbook-internal-token": token,
    },
    body: JSON.stringify({
      jobId: "storage-pressure-render",
      callbackUrl: `http://host.docker.internal:${callbackPort}/callback`,
      storageNamespace: "local",
      formatId: "pptx",
      inputObject: "objects/source.pptx",
      outputPrefix: "jobs/storage-pressure-render",
    }),
  });
  if (accepted.status !== 202)
    throw new Error(`worker_job_not_accepted:${accepted.status}`);

  const result = await withTimeout(callback.promise, 60_000);
  await closeServer(callbackServer);
  if (
    result?.jobId !== "storage-pressure-render" ||
    result?.status !== "failed" ||
    result?.error !== "storage_capacity_exhausted"
  )
    throw new Error(`unexpected_worker_callback:${JSON.stringify(result)}`);

  const receipt = JSON.parse(
    runDocker([
      "exec",
      container,
      "cat",
      "/data/jobs/storage-pressure-render/worker-result.json",
    ]),
  );
  const files = runDocker([
    "exec",
    container,
    "find",
    "/data/jobs/storage-pressure-render",
    "-type",
    "f",
    "-print",
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  const temporaryFiles = runDocker([
    "exec",
    container,
    "find",
    "/data",
    "-name",
    "*.tmp",
    "-print",
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
  if (
    receipt?.JobId !== result.jobId ||
    receipt?.Status !== result.status ||
    receipt?.Outputs !== result.outputs ||
    receipt?.Error !== result.error ||
    files.length !== 1 ||
    !files[0].endsWith("/worker-result.json") ||
    temporaryFiles.length !== 0
  )
    throw new Error(
      `worker_failure_receipt_was_not_atomic:${JSON.stringify({ result, receipt, files, temporaryFiles })}`,
    );

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "passed",
        callback: result,
        durableReceipt: files[0],
        temporaryFiles,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (callbackServer.listening) await closeServer(callbackServer);
  spawnSync("docker", ["rm", "--force", container], {
    encoding: "utf8",
    stdio: "ignore",
  });
}

function runDocker(args) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `docker ${args[0]} failed (${result.status}): ${result.stderr.trim()}`,
    );
  return result.stdout;
}

async function waitForWorker(name) {
  const deadline = Date.now() + 60_000;
  let origin = "";
  while (Date.now() < deadline) {
    if (!origin) {
      const output = runDocker(["port", name, "8080/tcp"]).trim();
      const port = Number(output.slice(output.lastIndexOf(":") + 1));
      if (!Number.isInteger(port)) throw new Error("invalid_worker_port");
      origin = `http://127.0.0.1:${port}`;
    }
    try {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return origin;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("document_worker_did_not_become_healthy");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

async function withTimeout(promise, timeoutMilliseconds) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("worker_callback_timed_out")),
          timeoutMilliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
