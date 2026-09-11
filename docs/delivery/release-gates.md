# Public release gates

The existence of code, a passing unit suite or a successful image build is not a public beta by itself. A release is usable only when every required evidence layer is green.

| Gate                      | Required evidence                                                                    | Current repository state                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Public boundary        | clean-history extraction, forbidden-pattern scan, license/notice inventory           | Clean-history extraction published; local boundary and REUSE checks passed; public CI must stay green                                                         |
| G1 Reproducible setup     | clean-machine setup, pinned dependencies, Compose health checks                      | Fresh local clone passed dependency install, tests, type checks and production builds; five-service Compose passed on arm64; native amd64 runtime pending     |
| G2 Login and isolation    | local owner login, secret length, worker network isolation, traversal tests          | Implemented; security review required                                                                                                                         |
| G3 First editable frame   | upload to editable canvas without manual recovery; measured warm/cold timing         | One 14-slide arm64 warm run reached document-ready in 5.398 s and the live canvas opened without the CODE welcome obstruction; distribution benchmark pending |
| G4 Direct edit round trip | edit, save, reopen and download in PowerPoint without corruption                     | Live Collabora element edit, WOPI save, validation and PPTX download passed after duplicate-job repair; real PowerPoint matrix pending                        |
| G5 AI loop                | connect, observe, permission request, edit, re-observe, self-review, approve/undo    | Implementation present; end-to-end provider run pending                                                                                                       |
| G6 Fidelity               | public coverage, hard-failure counts, text reflow and object-preservation thresholds | Harness and corpus present; release result pending                                                                                                            |
| G7 Operations             | backup/restore, restart recovery, disk limits, TLS/WOPI proof, vulnerability scan    | Partial                                                                                                                                                       |
| G8 Publication            | public repository, clean clone CI, tagged source release and SBOM                    | Public prerelease source exists at `replex-me/spellbook`; local clean-clone verification passed; green GitHub CI, tagged release and SBOM remain              |

## Hard failures

Regardless of average image score, a case fails when it has missing content, unexpected slide/page count, new text wrapping, clipped text, changed object editability, package corruption, unintended part changes or an unreported unsupported construct.

## Performance evidence

Measure upload acceptance, first preview, first editable frame, save-to-observation and AI turn completion separately. Report p50 and p95 for warm and cold starts and include file size, slide count, font state and renderer version. Do not describe a worker returning HTTP 202 as the document being ready.

## Publication decision

The first public push may be an explicit prerelease when G0–G2 pass. It must not be called a usable beta until G3–G7 have current runtime evidence. Repository visibility and service deployment are separate decisions.
