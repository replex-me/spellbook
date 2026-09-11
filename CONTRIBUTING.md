# Contributing

Spellbook accepts focused fixes and format-adapter improvements that preserve native document editability and make fidelity measurable.

1. Open an issue for changes that alter file semantics, format support, security boundaries, or the editor experience.
2. Keep common platform code format-neutral. Put PPTX-specific behavior in the PPTX adapter or document engine.
3. Add a focused regression test and, for rendering changes, a redistributable public fixture or reproducible fixture source.
4. Run `pnpm verify`. For visible editor changes, also run `pnpm test:e2e` and attach screenshots.
5. Do not submit customer documents, private evaluation results, credentials, hosted-service adapters, or branded proprietary binaries.

By contributing, you agree that your contribution is licensed under MPL-2.0 unless a file clearly carries another compatible license notice.
