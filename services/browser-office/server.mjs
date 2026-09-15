import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serviceRoot, "../..");
const manifest = JSON.parse(
  readFileSync(path.join(serviceRoot, "upstream.json"), "utf8"),
);

export function buildRoutes(root = serviceRoot, upstream = manifest) {
  const routes = new Map([
    [
      "/",
      route(path.join(root, "harness/index.html"), "text/html; charset=utf-8"),
    ],
    [
      "/workspace",
      route(path.join(root, "harness/index.html"), "text/html; charset=utf-8"),
    ],
    [
      "/harness/app.js",
      route(
        path.join(root, "harness/app.js"),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/opfs-journal.mjs",
      route(
        path.join(root, "opfs-journal.mjs"),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/office-thread.js",
      route(
        path.join(root, "harness/office-thread.js"),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/mutation-contract.generated.js",
      route(
        path.join(
          repositoryRoot,
          "services/office-editor/extension/mutation-contract.generated.js",
        ),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/operations.js",
      route(
        path.join(
          repositoryRoot,
          "services/office-editor/extension/operations.js",
        ),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/native-transform-adapter.js",
      route(
        path.join(root, "harness/native-transform-adapter.js"),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/harness/styles.css",
      route(path.join(root, "harness/styles.css"), "text/css; charset=utf-8"),
    ],
    [
      "/fixtures/general-native-surface.pptx",
      route(
        path.join(
          repositoryRoot,
          "eval/public/fixtures/general-native-surface.pptx",
        ),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ],
    [
      "/runtime/ooxml-worker.js",
      route(
        path.join(root, "runtime/ooxml-worker.js"),
        "text/javascript; charset=utf-8",
      ),
    ],
    [
      "/runtime/browser-candidate.js",
      route(
        path.join(root, "runtime/browser-candidate.js"),
        "text/javascript; charset=utf-8",
      ),
    ],
  ]);

  for (const asset of [
    ...upstream.runtimeAssets,
    upstream.javascriptBridge.runtimeAsset,
  ]) {
    const requestedPath =
      asset.path ?? path.basename(new URL(asset.url).pathname);
    routes.set(
      `/runtime/${requestedPath}`,
      route(path.join(root, "runtime", asset.storedPath), asset.contentType, {
        ...(asset.contentEncoding
          ? { "Content-Encoding": asset.contentEncoding }
          : {}),
        ...upstream.requiredAssetHeaders,
      }),
    );
  }
  return routes;
}

export function createHarnessServer(options = {}) {
  const routes = options.routes ?? buildRoutes();
  const hostOrigin = validateHostOrigin(
    options.hostOrigin ?? process.env.SPELLBOOK_BROWSER_HOST_ORIGIN,
  );
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    for (const [name, value] of Object.entries(
      manifest.requiredDocumentHeaders,
    ))
      response.setHeader(name, value);
    if (pathname === "/workspace" && hostOrigin)
      response.setHeader(
        "Content-Security-Policy",
        `frame-ancestors 'self' ${hostOrigin}`,
      );
    if (pathname === "/readyz") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          status: "ok",
          protocolVersion: 1,
          buildCommit: manifest.source.buildCommit,
          candidateCommit: manifest.source.candidateCommit,
          ...manifest.sourceCandidate,
        }),
      );
      return;
    }
    const target = routes.get(pathname);
    if (!target || !existsSync(target.file)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, target.headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(target.file).pipe(response);
  });
}

function validateHostOrigin(value) {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.origin !== value || !["http:", "https:"].includes(parsed.protocol))
    throw new Error("SPELLBOOK_BROWSER_HOST_ORIGIN must be an HTTP origin.");
  return parsed.origin;
}

export function configuredServerPort(
  argv = process.argv,
  environment = process.env,
) {
  const portFlag = argv.indexOf("--port");
  const port = Number(
    portFlag >= 0 ? argv[portFlag + 1] : (environment.PORT ?? 4173),
  );
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  return port;
}

function route(file, contentType, headers = {}) {
  return {
    file,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      ...headers,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = configuredServerPort();
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createHarnessServer();
  server.listen(port, host, () => {
    process.stdout.write(
      `Spellbook Browser Office: http://${host}:${port}/?autorun=1\n`,
    );
  });
}
