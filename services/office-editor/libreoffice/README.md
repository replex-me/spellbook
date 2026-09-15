# Browser editing engine

Spellbook uses Collabora Online for the shared browser editor. Collabora embeds a LibreOffice engine, but its source release and ABI are different from the headless renderer used by the document worker. The two patch series are therefore versioned and tested independently; they are not two product editors.

`upstream.json` is the single source of truth for the browser engine:

- exact Collabora source ref and commit;
- approved stock runtime image digest;
- ordered patch files and their aggregate SHA-256;
- patch level, focused native tests and full C++ test targets;
- whether the patch series is admitted to the expensive integrated build, and
  whether the built source candidate has passed the native release boundary.

The patches add bounded document commands and exact native Undo/Redo behavior. They do not expose raw UNO, macros, external processes or arbitrary file/network access to the AI. A patch is kept only while the pinned upstream lacks equivalent behavior.

`audit-ai-command-surface.mjs` reads the complete Impress UI command inventory
from the pinned source and routes every command through
`impress-command-policy.mjs` into the product semantic families declared in
`contracts/impress-ai-capability-matrix.json`. An unmapped command fails the
audit. This routing is an inventory guarantee, not an execution shortcut: only
the bounded operations in `native-edit-capabilities.json` can reach the AI, and
each still needs its declared observation, permission, Undo, save/reopen,
visual and PowerPoint evidence.

## Upgrade flow

Check upstream and cumulative patch application without changing a manifest or deployment:

```bash
pnpm office:engine:audit
```

For a local checkout of a candidate:

```bash
node services/office-editor/libreoffice/audit-upgrade.mjs \
  --source /absolute/path/to/online.mirror \
  --ref cp-YY.MM.PATCH-REV
```

The audit compares the source identity, the complete Impress command inventory and every patch byte. If upstream absorbed a fix, remove that patch only after its regression test passes against the new source. If a patch conflicts, rebase its intent in a new candidate; never weaken context or apply with fuzz.

After the rebased series applies exactly to the pinned clean source and its
static source audit passes, mark `sourcePatchSeriesReady` true and perform one
integrated image build:

```bash
pnpm office:engine:build
```

That build reapplies the hash-locked series to a clean source tree, builds the
Online image and runs both declared C++ suites. Only after those native suites
pass may `sourceCandidateReady` become true with the immutable build, engine,
evidence-archive and command-surface identities recorded beside it. The thin
runtime wrapper may then be built. It is intentionally not the patch-development loop. Browser command,
Undo/Redo, failure rollback, save/reopen, OOXML change-budget, visual corpus and
PowerPoint checks must all point to the same source commit, patch hash and image
digest before `runtimeImage` and `runtimePatchLevel` are promoted.

The public source manifest records the engine's content digest, not the private
registry repository that happened to build or host it. A deployment-specific
release receipt binds that digest to its complete immutable image reference.
This keeps source provenance public and portable while registry locations and
credentials remain owned by each deployment.

On a regular Linux host, a failed integrated build preserves its printed
temporary build root. Diagnose the exact failure and use that tree for focused
incremental target rebuilds; do not relaunch the clean integrated build for
each source correction. A successful build removes the temporary tree. Cloud
Build uses a disposable fixed workspace and cleans it on exit.

Build the thin Spellbook editor image only from the approved runtime manifest:

```bash
pnpm office:runtime:build
```

After the integrated native suites pass, build a candidate wrapper from the
registry-resolved engine digest, never from its mutable tag:

```bash
pnpm office:runtime:build:candidate -- \
  registry.example/spellbook-engine@sha256:<engine-digest> \
  registry.example/spellbook-office:candidate
```

Push that wrapper, resolve its own registry digest, and create the downstream
release receipt from the two immutable image identities and the exact public
Git commit:

```bash
node services/office-editor/libreoffice/write-runtime-release.mjs \
  /secure/path/spellbook-office-runtime.release.json \
  registry.example/spellbook-office@sha256:<runtime-digest> \
  registry.example/spellbook-engine@sha256:<engine-digest> \
  <40-character-public-commit>
```

That file pins runtime identity; it does not claim that named tests ran. Create
a browser conformance report against a container started from that exact
runtime digest. The runner reads the container image configured by Docker and
the engine identity observed through the open document, so a matching patch
name from a different image cannot pass:

```bash
pnpm office:conformance:run -- \
  --runtime-release /secure/path/spellbook-office-runtime.release.json \
  --runtime-container spellbook-office-candidate \
  --output /secure/path/conformance
```

Then create a separate validation receipt from the actual native-suite logs,
that browser conformance report and visual review:

```bash
pnpm office:runtime:validate -- \
  --release /secure/path/spellbook-office-runtime.release.json \
  --native-directory /secure/path/native-cppunit-evidence \
  --browser-report /secure/path/conformance-report.json \
  --visual-review /secure/path/visual-review.json \
  --output /secure/path/spellbook-office-runtime.validation.json
```

The result remains `candidate` when review is agent-only or PowerPoint
evidence is absent. Add `--powerpoint-evidence` only for a recorded real
PowerPoint open/edit/save result. `release_verified` therefore means that the
same receipt has passing native suites, full browser execution, save/reopen and
change-budget checks, human visual review, and PowerPoint validation; image
existence or a list of required target names can no longer stand in for those
outcomes.

Promote individual native operations into the public runtime contract only
from that evidence-bound browser report and validation receipt:

```bash
pnpm office:runtime:promote -- \
  --browser-report /secure/path/conformance-report.json \
  --validation /secure/path/spellbook-office-runtime.validation.json \
  --version <next-contract-semver>
```

The promotion command rejects partial operation sets, failed native,
save/reopen, change-budget or PowerPoint gates, mismatched source and patch
identities, and unknown evidence hashes. It is idempotent and preserves the
stock-engine limitation list. Operation-level `runtime_verified` means the
bounded command passed its required gates on the declared patched engine; it
does not upgrade an agent-reviewed runtime candidate to the human-reviewed
`release_verified` state.

The candidate wrapper records the public source revision, Collabora source
commit, engine digest and patch-series hash as OCI labels. The receipt is the
only artifact a managed downstream needs to lock; it must not copy this patch
directory or rebuild a separate editor. The default public runtime remains the
pinned stock digest until all promotion checks pass. A newer upstream release
or a successful compile alone is not approval.

## Maintenance rule

General command and format fixes belong in this public patch series first. Hosted deployments consume a verified public engine digest and may add infrastructure around it, but must not maintain a private fork of document behavior.
