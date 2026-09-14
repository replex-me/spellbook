# Public release gates

The existence of code, a passing unit suite or a successful image build is not a public beta by itself. A release is usable only when every required evidence layer is green.

## Completion accounting

Release completion uses the nine fixed gates G0 through G8 as its only denominator. A gate counts as complete only when every item in its required-evidence column has current passing evidence; partial evidence never counts as a fraction of a gate. The percentage is therefore `complete gates / 9`, changes only in 11.1 percentage-point steps, and must not be mixed with task, command or feature counts.

| Gate                      | Required evidence                                                                    | Current repository state                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0 Public boundary        | clean-history extraction, forbidden-pattern scan, license/notice inventory           | Clean-history extraction published; boundary and REUSE checks passed in public CI run `34597476608`                                                                                                                                                   |
| G1 Reproducible setup     | clean-machine setup, pinned dependencies, Compose health checks                      | Fresh local clone and public Ubuntu CI passed install, tests, type checks and builds; five-service Compose passed on arm64; native amd64 runtime pending                                                                                              |
| G2 Login and isolation    | local owner login, secret length, worker network isolation, traversal tests          | Implemented; security review required                                                                                                                                                                                                                 |
| G3 First editable frame   | upload to editable canvas without manual recovery; measured warm/cold timing         | One 14-slide arm64 warm run reached document-ready in 5.398 s and the live canvas opened without the CODE welcome obstruction; distribution benchmark pending                                                                                         |
| G4 Direct edit round trip | edit, save, reopen and download in PowerPoint without corruption                     | Live Collabora element edit, WOPI save, validation and PPTX download passed after duplicate-job repair; real PowerPoint matrix pending                                                                                                                |
| G5 AI loop                | connect, observe, permission request, edit, re-observe, self-review, approve/undo    | Real ChatGPT subscription account read, five-model catalog and structured app-server turn passed through the local connector; packaged-app native edit loop remains pending                                                                           |
| G6 Fidelity               | public coverage, hard-failure counts, text reflow and object-preservation thresholds | Harness and corpus present; release result pending                                                                                                                                                                                                    |
| G7 Operations             | backup/restore, restart recovery, disk limits, TLS/WOPI proof, vulnerability scan    | Signed Collabora WOPI edit/save passed locally and forged/stale requests failed closed; all four public runtime images passed fixable High/Critical scanning in GitHub run `34796064411`; backup/restore, restart, disk and deployed TLS proof remain |
| G8 Publication            | public repository, clean clone CI, tagged source release and SBOM                    | Public prerelease source and macOS app packager exist; clean clone and public CI passed; Developer ID/notarized binaries, tagged release and SBOM remain                                                                                              |

## Hard failures

Regardless of average image score, a case fails when it has missing content, unexpected slide/page count, new text wrapping, clipped text, changed object editability, package corruption, unintended part changes or an unreported unsupported construct.

## Performance evidence

Measure upload acceptance, first preview, first editable frame, save-to-observation and AI turn completion separately. Report p50 and p95 for warm and cold starts and include file size, slide count, font state and renderer version. Do not describe a worker returning HTTP 202 as the document being ready.

## Publication decision

The first public push may be an explicit prerelease when G0–G2 pass. It must not be called a usable beta until G3–G7 have current runtime evidence. Repository visibility and service deployment are separate decisions.
