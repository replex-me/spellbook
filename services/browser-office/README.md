# Browser Office runtime

This directory makes the client-side LibreOffice experiment reproducible. It
does not make it the default Spellbook editor yet.

The first real browser probe used the official ZetaOffice Web Office demo and
proved this vertical with a PPTX: load, show an editable Impress canvas, insert
a slide, save, undo the insertion, save again, and reopen both outputs in
Microsoft PowerPoint. The probed binary identifies itself as ZetaOffice 24.2 at
LibreOffice commit `efaf0670b4d055f838a2849becb10f08aa06a257`; it is not the
same source line as Spellbook's current server-side Collabora engine.

[`upstream.json`](./upstream.json) pins that exact source identity, ZetaJS
identity, wire bytes, and browser isolation headers. The upstream URL contains
`latest`, so its name is not trusted: every downloaded byte must match the
manifest before it can be hosted.

```sh
pnpm browser-office:fetch
pnpm browser-office:serve
pnpm browser-office:verify
pnpm browser-office:verify:powerpoint
```

The command writes ignored runtime artifacts to `runtime/`. The `.wasm` and
`.data` responses are stored as Brotli bytes and must be hosted under their
original request names with the declared `Content-Type`, `Content-Encoding:
br`, CORS, CORP, and immutable cache headers.

The tracked shell now owns the canvas and two distinct workers. ZetaOffice is
the visual interaction engine; `ooxml-worker-source.mjs` applies the slide
topology command family (`add_slide`, `duplicate_slide`, `move_slide`, and
`delete_slide`) directly to the original package. All four commands share one
relationship-graph implementation: owned dependencies are cloned, reusable
layout/theme/media parts stay shared, and unreachable owned parts are removed.
This separation is mandatory. A stock ZetaOffice `store()` round trip was valid XML
and reopened in PowerPoint, but rewrote untouched slide, layout, master, theme
and font data. Spellbook therefore never promotes that whole-file output as
the authoritative PPTX.

Promotion still requires the rest of the shared edit-command contract,
Korean IME and accessibility checks, OPFS recovery, a current patched browser
LibreOffice build, public-corpus render comparison and a PowerPoint platform
matrix. Until those gates pass, `status` stays `viability_probe_only` and the
server editor remains the runtime fallback.

The Spellbook-owned conformance shell is available at
`http://127.0.0.1:4173/?autorun=1`. It loads the tracked public PPTX fixture,
adds, duplicates, moves, and deletes slides through the OOXML worker, reopening
every candidate in the canvas. It then undoes all four mutations and reopens
the restored original. The page reaches `body[data-state="complete"]` only when
the slide-count, saved-hash, and lifecycle invariants pass. This is a
development gate, not yet the product editor.

`browser-office:verify` launches a headless local browser, asserts isolation,
slide counts and a strict logical package-change budget, and writes both PPTX
files, a screenshot and machine-readable timing evidence to
`artifacts/browser-office/latest/`. Untouched ZIP parts must retain identical
uncompressed bytes and Undo must restore every original part. It does not
promote the browser runtime; the screenshot and PPTX outputs still need the
same visual and PowerPoint inspection required of the server engine.

`browser-office:verify:powerpoint` follows that browser run with native
PowerPoint reopen/export. It verifies slide counts and pixel-identical identity,
move, delete-round-trip, and Undo mappings across the generated files. Run it
only on a macOS host with PowerPoint and no unrelated presentation open.

Upstream references:

- <https://github.com/allotropia/zetajs>
- <https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2>
- <https://git.libreoffice.org/core/+/refs/heads/master/static/README.wasm.md>
