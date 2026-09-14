import { writeFileSync } from "node:fs";
import path from "node:path";

import { upstreamManifest as manifest } from "./upstream.mjs";

const [outputArg, runtimeImage, engineImage, publicCommit] =
  process.argv.slice(2);
const output = path.resolve(
  outputArg ?? "spellbook-office-runtime.release.json",
);
const digestImagePattern = /@sha256:[0-9a-f]{64}$/u;

if (!manifest.sourceCandidateReady)
  throw new Error(
    "The public engine source candidate has not passed the integrated native suites.",
  );
if (!runtimeImage || !digestImagePattern.test(runtimeImage))
  throw new Error(
    "The Office runtime image must be pinned by registry digest.",
  );
if (!engineImage || !digestImagePattern.test(engineImage))
  throw new Error(
    "The Collabora engine image must be pinned by registry digest.",
  );
if (!publicCommit || !/^[0-9a-f]{40}$/u.test(publicCommit))
  throw new Error(
    "The public Spellbook source must be pinned by full Git commit.",
  );

const release = {
  schemaVersion: 1,
  kind: "spellbook-office-runtime",
  publicSource: {
    repository: "https://github.com/replex-me/spellbook",
    commit: publicCommit,
  },
  runtime: {
    image: runtimeImage,
    engineImage,
    patchLevel: manifest.patchLevel,
    patchSeriesSha256: manifest.patchSeriesSha256,
    collaboraSourceCommit: manifest.source.commit,
  },
  nativeVerification: {
    requiredCppunitTargets: manifest.requiredCppunitTargets,
  },
};

writeFileSync(output, `${JSON.stringify(release, null, 2)}\n`, {
  flag: "w",
  mode: 0o644,
});
