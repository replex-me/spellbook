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

The cumulative `browser-undo-v5` source series ports generic document behavior:
table structure, formatting and Undo; page and object identity; master-safe
layout support; sparse-master insertion; object-creation Undo; text-layout
invalidation; slide names and text shadows; object locks; object interactions;
editable placeholder inheritance; and native Undo for public UNO page and
object property writes. The page/object tests cover one-step Undo/Redo and PPTX
save/reopen for slide names, visibility, transition state, text margins,
shadows and object locks. Browser-source CppUnit regressions are part of the
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

General document fixes must be represented in both LibreOffice source lines or
explicitly proven unnecessary on one line. Collabora-only transport commands
are not copied into ZetaOffice: the browser calls the same bounded operation
program directly through ZetaJS and UNO.
