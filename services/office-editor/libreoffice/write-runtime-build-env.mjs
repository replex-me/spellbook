import { writeFileSync } from "node:fs";
import path from "node:path";

import { upstreamManifest as manifest } from "./upstream.mjs";

const output = path.resolve(
  process.argv[2] ?? "/workspace/.collabora-runtime.env",
);
const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const values = {
  COLLABORA_RUNTIME_IMAGE: manifest.runtimeImage,
  COLLABORA_RUNTIME_PATCH_LEVEL: manifest.runtimePatchLevel,
};

if (!/^(stock|undo-v\d+)$/u.test(values.COLLABORA_RUNTIME_PATCH_LEVEL))
  throw new Error("Invalid Collabora runtime patch level.");
if (!/@sha256:[0-9a-f]{64}$/u.test(values.COLLABORA_RUNTIME_IMAGE))
  throw new Error("Collabora runtime image must be pinned by digest.");

writeFileSync(
  output,
  `${Object.entries(values)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join("\n")}\n`,
  { flag: "w", mode: 0o600 },
);
