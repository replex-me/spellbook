# Document platform architecture

## Product invariant

Spellbook edits the user's real document. It does not replace the file with a generated screenshot or migrate it into a proprietary format. A human and an AI operate on the same versioned, editable document; a candidate must pass structural validation and rendered review before approval.

## Dependency direction

```text
hosted service overlay (private, optional)
                  ↓
web workspace → platform contracts ← AI connector
      ↓                 ↓                 ↓
 WOPI host       format adapter       provider runtime
                        ↓
                 native document file
```

The public platform never imports a hosted module. Hosting adds adapters around public ports; it does not fork document behavior.

## Common platform responsibilities

The common layer owns behavior that is true for every document type:

- immutable upload identity and version lineage;
- authentication, document ownership and edit permission;
- local object naming and storage-port contracts;
- job acceptance, idempotent result receipts and callbacks;
- conversation state, model choice and interruption;
- before/after evidence and approval state;
- capability discovery and honest unsupported-state reporting.

It must not encode a slide, paragraph, cell, canvas node or OOXML part as a universal concept.

## Format adapter responsibilities

Each adapter owns its package rules, semantic units, inspection graph, edit commands, renderer and validators. `IDocumentFormatAdapter` is the worker composition seam. The registry in `contracts/document-formats.json` controls whether a format is exposed to users.

The current `pptx` adapter owns:

- ZIP/OOXML safety scanning and relationship checks;
- slide and element inspection, including position, z-order, groups and fonts;
- minimal-part patching and round-trip validation;
- LibreOffice rendering and PowerPoint-oriented compatibility patches;
- the Impress WOPI editor bridge and native editing operations.

The PPTX adapter uses two independently versioned LibreOffice lineages. The document worker's headless renderer produces comparison and self-review evidence; Collabora's embedded engine powers the live browser editor. They serve one product loop but cannot share binaries or patches because their upstream releases and ABIs differ. Each lineage has a pinned manifest, an ordered patch series, native regression tests and an explicit promotion gate. See the [browser-engine maintenance contract](../../services/office-editor/libreoffice/README.md) and [renderer-engine contract](../../services/document-worker/libreoffice/README.md).

## Current limitation that matters for expansion

The worker boundary and upload registry are format-aware, but the current element graph, edit-command schema, conversation scope and UI still contain slide-specific fields. They are valid PPTX adapter contracts, not the future universal interchange model. Before enabling DOCX, introduce a small format-neutral observation envelope whose payload is validated by an adapter-owned schema. Do not stretch `slides[]` into `pages[]` or `paragraphs[]`.

## Adding a format

A format can move from `planned` to `experimental` only after it has:

1. an adapter implementation and adapter-owned observation/edit schemas;
2. a browser editor route or native editor with stable document identity;
3. package-preserving validation and corrupted-file rejection;
4. public, redistributable fidelity and round-trip fixtures;
5. before/after visual review semantics appropriate to that format;
6. UI language and selection rules that do not leak PPTX concepts;
7. passing release gates without weakening the PPTX path.

DOCX should use sections, paragraphs, runs, tables, headers and anchored/floating objects as its own semantics. The proposed Spellbook format should use pages and layout nodes and must not become an intermediate representation used to rewrite imported Office files.
