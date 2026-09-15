# Format support

This page is the user-facing support truth. “Planned” means architecture only, not an upload promise.

| Format                 | Status                        | Direct browser editing | AI observation/edit/review           | Editable download |
| ---------------------- | ----------------------------- | ---------------------- | ------------------------------------ | ----------------- |
| PowerPoint `.pptx`     | Prerelease under verification | Impress through WOPI   | Implemented for supported operations | Implemented       |
| Word `.docx`           | Planned                       | Not exposed            | Not implemented                      | Not exposed       |
| Spellbook `.spellbook` | Planned                       | Not implemented        | Not implemented                      | Not exposed       |

## PPTX prerelease scope

The engine currently inspects text boxes, shapes, pictures, connectors, groups and graphic frames; records geometry, z-order, text, fonts and support warnings; and supports the operations declared in `contracts/native-edit-capabilities.json` and `contracts/edit-target-capabilities.json`.

The native mutation model currently classifies 67 operations, of which 66 bounded operations are exposed to the AI tool schema. 63 have passed the live runtime path against the exact `undo-v18` engine, including image crop, native Undo/Redo, save/reopen, scoped package-change checks and PowerPoint reopening. Slide metadata, line style and paragraph format are implemented in the cumulative `undo-v19` and `browser-undo-v8` source candidates but still require final native/browser release validation; printable-state mutation is explicitly excluded because PPTX cannot preserve it. Every execution is rebound to the current document permission and live engine patch level. “Implemented in LibreOffice,” “available to the model” and “release-verified for autonomous execution” remain separate states.

The file is rejected or marked with warnings when the engine cannot safely promise its behavior. SmartArt, charts, embedded/OLE objects, media, macros, unusual font embedding and renderer-specific effects require corpus evidence before they can be called faithful. An element visible in the browser editor is not automatically AI-editable.

## Fidelity language

- **Structurally valid** means the edited package opens and only allowed package parts changed.
- **Visually reviewed** means before/after renders were supplied to the review loop and its evidence was internally consistent.
- **PowerPoint-faithful** requires comparison against a PowerPoint reference corpus on supported operating systems. LibreOffice-to-LibreOffice similarity does not prove it.
- No aggregate pixel score may hide text reflow, missing content, changed pagination/slide count or a broken editable object. Those are hard failures.

The prerelease can be promoted to beta only with published corpus coverage, pass/fail thresholds and a list of known unsupported constructs, plus the operational evidence required by the release gates.
