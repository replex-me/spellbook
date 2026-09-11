# Local runtime verification — 2026-09-11

This is evidence from one development machine, not a general performance claim or a public-beta approval.

## Environment

- Apple M4 Pro, arm64, 48 GiB host memory
- Docker Compose v2
- document worker: native arm64 self-contained .NET 10 build
- renderer: Debian trixie-backports LibreOffice 26.8.0.3
- browser editor: pinned Collabora CODE 26.04.3.2 image

## Verified path

1. All five Compose services reported healthy: PostgreSQL, web, document worker, AI connector and Office editor.
2. `ox-typical.pptx`, a 14-slide public fixture, changed from `processing` to `ready` with a graph in 5.398 seconds after upload acceptance.
3. A fresh headless Chromium context opened the live Collabora Impress canvas through the actual WOPI launch route.
4. The host dismissed CODE's first-run welcome obstruction and loaded the origin-checked Spellbook extension bridge.
5. The bridge observed the open document, replaced the first-slide title through a fixed UNO operation, and returned a fresh observation.
6. The host saved through WOPI; the document worker validated the new version and the session returned to `active`.
7. The UI downloaded a PPTX. `unzip -t` passed and `ppt/slides/slide1.xml` contained the replacement text.
8. With no Codex account connected, the canvas remained directly editable and the chat panel showed the connection action instead of presenting a usable composer.
9. Repeated delivery of one save-validation job was collapsed to one in-process execution. The previously observed duplicate LibreOffice launch no longer occurred, and the live save round trip completed in 2.1 seconds on the final run.
10. The document-worker image completed a full `linux/amd64` build, including the pinned LibreOffice package and native `linux-x64` .NET publish. It was not executed under a native amd64 host in this verification.
11. Commit `3503f53` was cloned into a new empty directory. A frozen dependency install and the complete `pnpm verify` suite passed without relying on the development checkout's generated files or caches.
12. Public GitHub Actions run `34597476608` passed the boundary check, documentation and contract checks, REUSE licensing, Python/Node/Go/.NET tests, type checks and production builds on Ubuntu after undeclared `PyMuPDF` use was added to the pinned Python requirements.

The repeatable command is `SPELLBOOK_SELFHOST_DOCUMENT_ID=<uuid> pnpm test:selfhost`. Evidence files are deliberately local and ignored from Git.

## Performance finding

The previous forced `linux/amd64` worker on this arm64 host remained in `processing` beyond 150 seconds and consumed roughly 2.37 GiB under emulation. The native worker completed the same fixture in 5.398 seconds; its idle resident use was roughly 53–60 MiB before processing and about 140 MiB after this run. This proves that cross-architecture emulation was the dominant local stall, not that all decks meet a 5.398-second SLO.

## Reliability finding

An early live save exposed two independent defects: duplicate delivery could start the same job twice because `ConcurrentDictionary.GetOrAdd` may run its value factory more than once, and a failed native session was excluded from the status poll that needed to report that failure. The worker now claims a job with `TryAdd` before starting work, known transient LibreOffice process terminations receive one isolated retry, and a signed session can poll its terminal failure state. The final live round trip passed after these changes; cross-process and multi-replica idempotency remains a hosted-adapter responsibility.

## Still unverified

- warm and cold p50/p95 across small, normal and large decks;
- real PowerPoint reopen and visual comparison of this downloaded file;
- amd64 runtime parity for the new Debian package path;
- a live Codex login, permission, edit, re-observation and self-review turn;
- WOPI proof-key validation, backup/restore, restart recovery and load saturation;
- complex PPTX fidelity and round-trip preservation across the public corpus.
- a tagged source release and SBOM.
