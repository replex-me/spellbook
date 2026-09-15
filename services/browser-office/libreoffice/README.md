# Browser LibreOffice source line

The browser runtime and the server Collabora runtime are two builds of
LibreOffice with different upstream ABIs. They share product invariants and the
JavaScript operation program, but they do not share binary patches blindly.

`../upstream.json` pins the exact ZetaOffice source commit, Emscripten fork,
Qt superproject and QtBase commit. The ordered patch series in `patches/` is
rebased against that exact browser source. `patchSeriesReady` means only that
the complete series applies without fuzz. It does not mean the WASM binary has
been built or promoted; `buildReady` remains false until the complete command,
Undo, save/reopen, visual and PowerPoint evidence is attached to one immutable
browser build.

The cumulative `browser-undo-v7` source series ports generic document behavior:
table structure, formatting and Undo; page and object identity; master-safe
layout support; sparse-master insertion; object-creation Undo; text-layout
invalidation; slide names and text shadows; object locks; object interactions;
editable placeholder inheritance; and native Undo for public UNO page and
object property writes. It also routes rotation, line color, line width and
fill/line transparency through bounded UNO property writes because the
equivalent stock WASM edit/Undo sequence can stop without a completion
response. Text size, family, weight, posture, underline, strikeout, color and
paragraph alignment likewise share one bounded text-property transaction
instead of mixing property writes with UI dispatch commands. The page/object
tests cover one-step Undo/Redo and PPTX save/reopen for slide names, visibility,
transition state, text margins, shadows and object locks. Browser-source CppUnit regressions are part of the
series but have not run yet. The remaining build-admission work is the
browser-native command adapter plus a clean native test run; only then is a
single integrated WASM build justified. `nativeSlideStructureReady` is
independent of `buildReady`: a compiled runtime must also survive the product
bridge's full slide lifecycle, observation, Undo/Redo, recovery and exact-save
checks before it can claim safe native structure editing. Collabora transport
handlers remain deliberately absent.

Verify every source edit before starting the expensive build:

```sh
pnpm browser-office:engine:verify -- --source /absolute/path/to/libreoffice-core
```

Build the admitted series from the pinned Linux, Emscripten and Qt toolchain:

```sh
docker buildx build \
  --platform=linux/amd64 \
  --file services/browser-office/libreoffice/Dockerfile.toolchain \
  --tag spellbook-browser-office-toolchain:v7 \
  --load .

docker run --rm --user=1000:1000 \
  --volume "$PWD:/workspace:ro" \
  --volume "/absolute/build-root:/build" \
  --volume "/absolute/output:/output" \
  --env SPELLBOOK_SOURCE_REVISION="$(git rev-parse HEAD)" \
  --env SPELLBOOK_BROWSER_BUILD_ROOT=/build \
  --env SPELLBOOK_BROWSER_OUTPUT_DIR=/output \
  spellbook-browser-office-toolchain:v7 \
  /workspace/services/browser-office/libreoffice/build-candidate-runtime.sh
```

The build root is deliberately external and keyed by the patch-series hash.
Native CppUnit targets and the WASM link each write a completion marker only
after success, so a failed step resumes from its existing object files instead
of restarting the preceding hour-long work. A root belonging to another source
or patch identity is rejected rather than cleaned implicitly. The output holds
the four raw runtime assets, Brotli serving variants and a receipt binding their
hashes to the exact public source, LibreOffice, patch-series, Emscripten and Qt
identities. Building does not set `buildReady`; promotion still requires the
integrated product, endurance, fidelity and PowerPoint gates.

General document fixes must be represented in both LibreOffice source lines or
explicitly proven unnecessary on one line. Collabora-only transport commands
are not copied into ZetaOffice: the browser calls the same bounded operation
program directly through ZetaJS and UNO.
