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

Verify every source edit before starting the expensive build:

```sh
pnpm browser-office:engine:verify -- --source /absolute/path/to/libreoffice-core
```

General document fixes must be represented in both LibreOffice source lines or
explicitly proven unnecessary on one line. Collabora-only transport commands
are not copied into ZetaOffice: the browser calls the same bounded operation
program directly through ZetaJS and UNO.
