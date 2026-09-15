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
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const target = routes.get(pathname);
    for (const [name, value] of Object.entries(
      manifest.requiredDocumentHeaders,
    ))
      response.setHeader(name, value);
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
  const portFlag = process.argv.indexOf("--port");
  const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : 4173);
  const server = createHarnessServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
      `Spellbook Browser Office: http://127.0.0.1:${port}/?autorun=1\n`,
    );
  });
}
