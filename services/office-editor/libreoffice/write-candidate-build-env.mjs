import { writeFileSync } from "node:fs";
import path from "node:path";

import { upstreamManifest as manifest } from "./upstream.mjs";

const output = path.resolve(
  process.argv[2] ?? "/workspace/.collabora-candidate.env",
);
const candidateImage = process.argv[3];
const quote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

if (!manifest.sourceCandidateReady)
  throw new Error(
    "Collabora source candidate must pass cumulative native tests before wrapper build.",
  );
if (!/^undo-v[1-9][0-9]*$/u.test(manifest.patchLevel))
  throw new Error("Invalid Collabora candidate patch level.");
if (!candidateImage || !/@sha256:[0-9a-f]{64}$/u.test(candidateImage))
  throw new Error("Collabora candidate engine must be pinned by digest.");
if (!/^[0-9a-f]{64}$/u.test(manifest.patchSeriesSha256))
  throw new Error("Invalid Collabora candidate patch series digest.");

const values = {
  COLLABORA_CANDIDATE_IMAGE: candidateImage,
  COLLABORA_CANDIDATE_PATCH_LEVEL: manifest.patchLevel,
  COLLABORA_CANDIDATE_PATCH_SERIES_SHA256: manifest.patchSeriesSha256,
  COLLABORA_CANDIDATE_SOURCE_COMMIT: manifest.source.commit,
};

writeFileSync(
  output,
  `${Object.entries(values)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join("\n")}\n`,
  { flag: "w", mode: 0o600 },
);
