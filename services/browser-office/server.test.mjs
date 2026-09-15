import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildRoutes, createHarnessServer } from "./server.mjs";

const upstream = JSON.parse(
  readFileSync(new URL("./upstream.json", import.meta.url), "utf8"),
);

test("browser Office routes preserve isolation, asset identity and encodings", () => {
  const routes = buildRoutes();
  assert.ok(routes.has("/workspace"));
  assert.ok(routes.has("/runtime/soffice.js"));
  assert.ok(routes.has("/runtime/zeta.js"));
  assert.ok(routes.has("/runtime/ooxml-worker.js"));
  assert.ok(routes.has("/runtime/browser-candidate.js"));
  assert.ok(routes.has("/harness/opfs-journal.mjs"));
  assert.ok(routes.has("/harness/mutation-contract.generated.js"));
  assert.ok(routes.has("/harness/operations.js"));
  assert.ok(routes.has("/harness/native-transform-adapter.js"));
  assert.equal(
    routes.get("/runtime/soffice.wasm").headers["Content-Encoding"],
    "br",
  );
  assert.equal(
    routes.get("/runtime/soffice.wasm").headers["Content-Type"],
    "application/wasm",
  );
  assert.equal(
    routes.get("/runtime/zeta.js").headers["Cache-Control"],
    "public, max-age=31536000, immutable",
  );
});

test("browser Office server emits the required cross-origin isolation headers", async () => {
  const server = createHarnessServer({
    hostOrigin: "https://present.example",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cross-origin-opener-policy"),
      "same-origin",
    );
    assert.equal(
      response.headers.get("cross-origin-embedder-policy"),
      "require-corp",
    );
    assert.equal(
      response.headers.get("cross-origin-resource-policy"),
      "cross-origin",
    );
    const html = await response.text();
    assert.match(html, /id="qtcanvas"/u);
    assert.match(html, /src="\/harness\/app\.js"/u);
    assert.match(html, /href="\/harness\/styles\.css"/u);

    const workspace = await fetch(`http://127.0.0.1:${address.port}/workspace`);
    assert.equal(workspace.status, 200);
    assert.equal(
      workspace.headers.get("content-security-policy"),
      "frame-ancestors 'self' https://present.example",
    );

    const ready = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      status: "ok",
      protocolVersion: 1,
      buildCommit: upstream.source.buildCommit,
      candidateCommit: upstream.source.candidateCommit,
      ...upstream.sourceCandidate,
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
