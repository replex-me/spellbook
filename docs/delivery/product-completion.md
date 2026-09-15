# Product completion ledger

Updated: 2026-09-15

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

Current score: **45 / 100 complete; 55 / 100 remaining**.

| Product outcome                               |  Weight | Earned | Current evidence                                                                                                                                                                                                                                                                                           | Remaining evidence                                                                                                                                                                                                                             |
| --------------------------------------------- | ------: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open-core and cloud repository boundary       |      10 |      8 | The public runnable repository, MPL-2.0 boundary checks and private cloud ownership boundary exist                                                                                                                                                                                                         | Consume only pinned public artifacts through private adapters; prove migration, rollback, licensing and SBOM release evidence                                                                                                                  |
| PowerPoint-like direct editing UX             |      20 |      8 | Slide pane, ribbon, canvas and integrated AI panel exist; the browser-owned LibreOffice canvas completes six structure-preserving slide operations, survives a real page reload through a two-slot OPFS journal, and restores six-step Undo                                                                | Integrate the browser journal into the product session, then complete direct manipulation, property editing, responsive/Korean IME/accessibility behavior, measured interaction latency and final screenshot review                            |
| Subscription AI collaboration                 |      15 |      9 | Real Codex and Claude Code subscriptions completed deployed read/edit/re-observe/self-review/save/Undo loops through the packaged macOS arm64 Connector; Codex image generation passed                                                                                                                     | Complete permission switching and full tool exposure, reconnect/error UX, Developer ID/notarized packages, normal Finder lifecycle, upgrades, x64 macOS and Windows                                                                            |
| PPT feature breadth for people and AI         |      25 |     10 | Typed bounded tools, stale-revision rejection, permission rebinding, dry-run and atomic rollback exist; the exact undo-v18 engine exercised all 63 exposed native operations across 10 browser scenarios with save/reopen and change-budget checks; browser slide topology covers all four shared commands | Complete and verify high-value gaps including deeper charts, SmartArt semantics, arbitrary master/theme authoring, media and effect insertion/removal; establish browser parity for the remaining command families                             |
| Fidelity, Undo, save and PowerPoint integrity |      15 |      6 | Public corpus/evaluation harness, structural change budgets, font policy, 621-slide no-render-failure run and macOS PowerPoint topology/Undo identity checks exist                                                                                                                                         | Run the exact promoted engine through corpus regression, text-reflow/font closure, wider preservation checks and repeatable Windows/macOS PowerPoint matrices; resolve the pinned browser renderer's observed text-position difference         |
| Public infrastructure, performance and safety |      10 |      4 | Compose/local auth/storage, signed WOPI verification, backup/isolated restore, restart recovery, private GCP validation, central control-plane contracts, crash-tolerant OPFS and a revision-bound browser reconciliation API provide the base                                                             | Public signup/deletion, direct object-storage transfer, product integration of browser recovery/reconciliation, multi-user isolation, load/backpressure/autoscaling, billing/entitlement, clean native host/TLS/disk/interrupted-job exercises |
| Final public launch evidence                  |       5 |      0 | No current build proves the complete promised public workflow                                                                                                                                                                                                                                              | Ship a signed release and deploy the exact artifacts; verify self-host and managed signup-to-edit-to-AI-review-to-download flows with rollback and support commitments                                                                         |
| **Total**                                     | **100** | **45** |                                                                                                                                                                                                                                                                                                            | **55 points remain**                                                                                                                                                                                                                           |

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
