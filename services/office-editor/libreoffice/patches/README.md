# Ordered patch series

The order and aggregate byte hash of these patches are locked by `../upstream.json`. Later patches may extend tests or implementation introduced earlier, so apply the complete series cumulatively.

Each engine change must have a native regression test for the violated invariant: one Undo boundary, exact Undo/Redo, failure rollback, object identity, master/layout preservation, or save/reopen semantics. Case-specific slide numbers, object names, coordinates and corpus identifiers are not valid production conditions.

The current `undo-v9` r5 source candidate includes the final layout-animation Undo repair in `0026`. `sourceCandidateReady` records that the source-level native suite passed. Runtime promotion remains separate and requires the integrated image, browser, OOXML, visual and PowerPoint gates described in the parent README.
