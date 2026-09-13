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
```

The command writes ignored runtime artifacts to `runtime/`. The `.wasm` and
`.data` responses are stored as Brotli bytes and must be hosted under their
original request names with the declared `Content-Type`, `Content-Encoding:
br`, CORS, CORP, and immutable cache headers.

Promotion requires a self-hosted immutable asset origin, a Spellbook-owned
worker and canvas shell, the shared native edit-command conformance suite,
Korean IME and accessibility checks, OPFS recovery, public corpus render and
round-trip comparison, and PowerPoint reopen evidence. Until those gates pass,
`status` stays `viability_probe_only` and the server editor remains the runtime
fallback.

Upstream references:

- <https://github.com/allotropia/zetajs>
- <https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2>
- <https://git.libreoffice.org/core/+/refs/heads/master/static/README.wasm.md>
