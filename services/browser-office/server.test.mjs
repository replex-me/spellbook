import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutes, createHarnessServer } from "./server.mjs";

test("browser Office routes preserve isolation, asset identity and encodings", () => {
  const routes = buildRoutes();
  assert.ok(routes.has("/runtime/soffice.js"));
  assert.ok(routes.has("/runtime/zeta.js"));
  assert.ok(routes.has("/runtime/ooxml-worker.js"));
  assert.ok(routes.has("/harness/opfs-journal.mjs"));
  assert.ok(routes.has("/harness/mutation-contract.generated.js"));
  assert.ok(routes.has("/harness/operations.js"));
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
  const server = createHarnessServer();
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
    const html = await response.text();
    assert.match(html, /id="qtcanvas"/u);
    assert.match(html, /src="\/harness\/app\.js"/u);
    assert.match(html, /href="\/harness\/styles\.css"/u);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
