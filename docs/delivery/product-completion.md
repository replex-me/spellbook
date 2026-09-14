# Product completion ledger

Updated: 2026-09-14

This is the single progress denominator for the current delivery objective:
**a usable PPTX public beta, a runnable open-core self-host product, and the
Replex-managed public service that consumes it**. Future DOCX and native
page-layout editors are outside this score. Adding those formats requires an
explicit new scope decision; discovering a PPTX defect does not enlarge the
denominator.

## Accounting rule

The denominator is fixed at 100 points. Points represent user value and the
engineering risk that remains before the promised experience is real. A point
is earned only by the evidence named below. Source code, a patch, a download or
a running build does not earn the later runtime or deployment point. New
findings are recorded under the existing line item instead of adding new
points. Weights change only when the product scope changes explicitly.

Current score: **64 / 100 complete; 36 / 100 remaining**.

| Product outcome                                |  Weight | Earned | Current evidence                                                                                                                                                                                                                     | Remaining evidence                                                                                                                                                                                                  |
| ---------------------------------------------- | ------: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing PPTX lifecycle                        |      12 |     10 | Upload, real editor open, manual edit, native Undo/Redo, immutable original, version save, validation, approval and editable download work in the local/server path; restart recovery is covered                                     | Latest patched engine must pass the browser, save/reopen and PowerPoint matrix as one pinned build                                                                                                                  |
| PowerPoint-like direct editing UX              |      10 |      7 | Slide pane, ribbon, canvas and integrated AI panel exist; connection, model, permission, progress and recovery states have focused UI tests                                                                                          | Current runtime needs final screenshot review plus responsive, Korean IME, accessibility and measured interaction-latency acceptance                                                                                |
| Subscription AI collaboration                  |      12 |     10 | Real local ChatGPT/Codex and Claude Code subscriptions both completed the deployed read/edit/re-observe/self-review/save/Undo loop through the macOS arm64 packaged Connector; Codex image generation also passed                    | Developer ID/notarized fresh-install packages, normal Finder-launch status UX, upgrade/uninstall/single-instance handling, x64 macOS and Windows artifacts remain                                                   |
| Native edit breadth and transaction safety     |      16 |     10 | Typed bounded tools, stale-revision rejection, permission rebinding, dry-run and atomic rollback exist; one undo-v17 runtime executed all 62 bounded operations across 9 browser scenarios with save/reopen and change-budget checks | Real PowerPoint validation remains required before promotion; high-value gaps include deeper chart styling, SmartArt semantics, arbitrary master/theme authoring, media, links/actions and effect insertion/removal |
| Fidelity, editability and PowerPoint integrity |      16 |     11 | Public corpus/evaluation harness, structural change budgets, font policy, 621-slide no-render-failure run and representative PowerPoint reopen evidence exist                                                                        | The exact promoted engine needs corpus regression, hard-failure thresholds, wider object-preservation coverage, text-reflow/font closure and a repeatable PowerPoint platform matrix                                |
| Client-first browser Office and performance    |      10 |      2 | A pinned ZetaOffice viability probe opened, edited, saved, undid and produced PPTX files that reopened in PowerPoint                                                                                                                 | A Spellbook-owned Worker/canvas runtime, shared command parity, OPFS recovery, explicit local save/export, IME/accessibility/corpus validation and warm/cold performance proof remain                               |
| Self-host reliability and security             |       8 |      6 | Compose path, local auth/storage, signed WOPI verification, backup/isolated restore, restart recovery and fixable High/Critical image scanning exist                                                                                 | Clean native amd64-host run, deployed TLS proof, disk limits, interrupted-job recovery and final operator exercise remain                                                                                           |
| Managed public service and scale               |       8 |      2 | The existing private GCP validation service and central account/control-plane contracts provide a starting deployment path                                                                                                           | Public self-signup, account/deletion lifecycle, client-direct storage, Hosted Free/Plus boundaries, multi-user isolation, load/backpressure/autoscaling and billing/entitlement proof remain                        |
| Open-core repository boundary                  |       5 |      4 | `replex-me/spellbook` is a clean public runnable product with MPL-2.0 boundary checks and the private cloud ownership boundary is documented                                                                                         | `spellbook-cloud` must consume a pinned public artifact through adapters, then prove migration and rollback before duplicate core code is removed                                                                   |
| Release artifacts and stewardship              |       3 |      2 | Public CI, security automation, install/self-host documentation and a runtime-tested ad-hoc-signed macOS arm64 package exist                                                                                                         | Stable signed tag, SBOM, Developer ID/notarized macOS packages, Windows package and final stewardship/support promises remain                                                                                       |
| **Total**                                      | **100** | **64** |                                                                                                                                                                                                                                      | **36 points remain**                                                                                                                                                                                                |

## What the last three days produced

The initial public extraction was 261 files and 47,613 inserted lines. After
that extraction, 38 additional commits changed 215 files with 33,437 inserted
and 1,155 deleted lines. The current product tree contains about 60,000 lines
across application, engine, contract and verification source and 70 test
files, including generated test output. These figures demonstrate substantial
implementation work but do not substitute for the evidence-based score above.

## Update discipline

Every score change must name the exact line item, newly earned points and the
evidence artifact. Work in progress is reported in words without advancing the
number. Release blockers remain tracked separately in
[Public release gates](./release-gates.md); a blocker may prevent publication
without erasing implementation already completed.
