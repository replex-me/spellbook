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

Current score: **49 / 100 complete; 51 / 100 remaining**.

| Product outcome                               |  Weight | Earned | Current evidence                                                                                                                                                                                                                                                                                                                    | Remaining evidence                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------: | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open-core and cloud repository boundary       |      10 |      8 | The public runnable repository, MPL-2.0 boundary checks and private cloud ownership boundary exist                                                                                                                                                                                                                                  | Consume only pinned public artifacts through private adapters; prove migration, rollback, licensing and SBOM release evidence                                                                                                                                                                    |
| PowerPoint-like direct editing UX             |      20 |     10 | Slide pane, ribbon, canvas and integrated AI panel exist; the browser-owned LibreOffice canvas completes six structure-preserving slide operations and six-step Undo; the product session now performs a real text edit, reload recovery, Undo, Redo, save, validation and download through the same revision-bound journal         | Complete direct manipulation, property editing, responsive/Korean IME/accessibility behavior, measured interaction latency and final screenshot review                                                                                                                                           |
| Subscription AI collaboration                 |      15 |      9 | Real Codex and Claude Code subscriptions completed deployed read/edit/re-observe/self-review/save/Undo loops through the packaged macOS arm64 Connector; Codex image generation passed                                                                                                                                              | Complete permission switching and full tool exposure, reconnect/error UX, Developer ID/notarized packages, normal Finder lifecycle, upgrades, x64 macOS and Windows                                                                                                                              |
| PPT feature breadth for people and AI         |      25 |     10 | Typed bounded tools, stale-revision rejection, permission rebinding, dry-run and atomic rollback exist; the exact undo-v18 engine exercised all 63 exposed native operations across 10 browser scenarios with save/reopen and change-budget checks; browser slide topology covers all four shared commands                          | Complete and verify high-value gaps including deeper charts, SmartArt semantics, arbitrary master/theme authoring, media and effect insertion/removal; establish browser parity for the remaining command families                                                                               |
| Fidelity, Undo, save and PowerPoint integrity |      15 |      7 | Public corpus/evaluation harness, structural change budgets, font policy, 621-slide no-render-failure run and macOS PowerPoint topology/Undo identity checks exist; the real product text-save path changes only `ppt/slides/slide1.xml`, and both the browser verifier and server validator reject collateral package changes      | Extend localized save coverage to the remaining commands; run the exact promoted engine through corpus regression, text-reflow/font closure, wider preservation checks and repeatable Windows/macOS PowerPoint matrices; resolve the pinned browser renderer's observed text-position difference |
| Public infrastructure, performance and safety |      10 |      5 | Compose/local auth/storage, signed WOPI verification, backup/isolated restore, restart recovery, private GCP validation and central control-plane contracts provide the base; the product now consumes the browser runtime through a revision-bound bridge and recovers a reconciled candidate from the crash-tolerant OPFS journal | Public signup/deletion, direct object-storage transfer, browser reconciliation for untracked direct manipulation, multi-user isolation, load/backpressure/autoscaling, billing/entitlement, clean native host/TLS/disk/interrupted-job exercises                                                 |
| Final public launch evidence                  |       5 |      0 | No current build proves the complete promised public workflow                                                                                                                                                                                                                                                                       | Ship a signed release and deploy the exact artifacts; verify self-host and managed signup-to-edit-to-AI-review-to-download flows with rollback and support commitments                                                                                                                           |
| **Total**                                     | **100** | **49** |                                                                                                                                                                                                                                                                                                                                     | **51 points remain**                                                                                                                                                                                                                                                                             |

## Score change log

| Date       | Commit    | Delta | Evidence                                                                                                                                                                                                    |
| ---------- | --------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-15 | `cceb895` |    +2 | PowerPoint-like direct editing: headless product bridge completed edit, reload recovery, Undo, Redo and save without page or request failures                                                               |
| 2026-09-15 | `cceb895` |    +1 | Fidelity: browser and real self-host comparisons both found exactly one changed OOXML part for one text edit; the document worker independently returned `valid: true`, one in-scope change and zero errors |
| 2026-09-15 | `cceb895` |    +1 | Infrastructure: the real product session consumed the browser editor, persisted its command/revision journal and recovered it after reload; unsupported unreconciled commands failed before mutation        |

This four-point delta is limited to the proven text-edit path. It does not
claim browser parity for other commands, free-form canvas edits, PowerPoint
desktop reopen, production deployment or final UI quality.

## Unscored implementation evidence

These changes reduce product risk or prepare a missing capability, but they do
not change the completion score until the user outcome in the main table is
proven.

| Date       | Commit    | Improvement                                                                                                                                                                                                                          | Why it earns no point yet                                                                                                                |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-15 | `19f7806` | The product rejects six slide-structure commands before mutation when the browser runtime cannot safely observe and undo them; the verifier proves the revision and slide count remain unchanged                                     | It prevents corruption but does not make slide insertion, duplication, deletion, movement, rename or hide available to the user          |
| 2026-09-15 | `27b08cc` | The stock product path proves text replacement, move, resize and fill color through edit and Undo; unsafe rotation and line/transparency paths are gated; the `browser-undo-v6` source and bounded property adapter cover those gaps | The v6 C++ patch applies cleanly, but it has not yet been compiled or passed the integrated browser edit, Undo, recovery and save matrix |

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
