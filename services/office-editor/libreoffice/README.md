# Browser editing engine

Spellbook uses Collabora Online for the shared browser editor. Collabora embeds a LibreOffice engine, but its source release and ABI are different from the headless renderer used by the document worker. The two patch series are therefore versioned and tested independently; they are not two product editors.

`upstream.json` is the single source of truth for the browser engine:

- exact Collabora source ref and commit;
- approved stock runtime image digest;
- ordered patch files and their aggregate SHA-256;
- patch level, focused native tests and full C++ test targets;
- whether the source candidate is ready for the expensive integrated build.

The patches add bounded document commands and exact native Undo/Redo behavior. They do not expose raw UNO, macros, external processes or arbitrary file/network access to the AI. A patch is kept only while the pinned upstream lacks equivalent behavior.

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

After all focused native tests pass in an incremental worktree, mark the source candidate ready and perform one integrated image build:

```bash
pnpm office:engine:build
```

That build reapplies the hash-locked series to a clean source tree, builds the Online image and runs both declared C++ suites. It is intentionally not the patch-development loop. Browser command, Undo/Redo, failure rollback, save/reopen, OOXML change-budget, visual corpus and PowerPoint checks must all point to the same source commit, patch hash and image digest before `runtimeImage` and `runtimePatchLevel` are promoted.

Build the thin Spellbook editor image only from the approved runtime manifest:

```bash
pnpm office:runtime:build
```

The default public runtime remains the pinned stock digest until those promotion gates pass. A newer upstream release or a successful compile alone is not approval.

## Maintenance rule

General command and format fixes belong in this public patch series first. Hosted deployments consume a verified public engine digest and may add infrastructure around it, but must not maintain a private fork of document behavior.
