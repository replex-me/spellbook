# Ordered patch series

The order and aggregate byte hash of these patches are locked by `../upstream.json`. Later patches may extend tests or implementation introduced earlier, so apply the complete series cumulatively.

Each engine change must have a native regression test for the violated invariant: one Undo boundary, exact Undo/Redo, failure rollback, object identity, master/layout preservation, or save/reopen semantics. Case-specific slide numbers, object names, coordinates and corpus identifiers are not valid production conditions.

The current `undo-v16` r1 development candidate extends the cumulative series through table API inheritance, table text-cursor Undo, exact existing-master layout selection, observable mixed-script text formatting, native object creation/duplication, metric-driven text-layout invalidation and sparse-master-safe slide insertion in `0027`–`0034`. `sourceCandidateReady` stays false until the source-level native suites pass. Runtime promotion remains separate and requires the integrated image, browser, OOXML, visual and PowerPoint gates described in the parent README.
