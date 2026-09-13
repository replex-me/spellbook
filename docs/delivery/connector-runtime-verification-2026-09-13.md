# Local AI connector verification — 2026-09-13

This is evidence from one Apple Silicon development machine and one existing ChatGPT subscription. It is not a compatibility claim for every account, model or operating system.

## Verified

1. The source connector started with no product origin or email configuration, bound only to `127.0.0.1`, and returned protocol version 1 from `/health`.
2. An arbitrary HTTPS product origin could begin pairing only through the explicit local approval page. The resulting session remained bound to that exact origin.
3. A standalone macOS app was assembled with Node's single-executable format from a SHA-256-verified official Node 22.22.3 binary and the matching arm64 Codex package.
4. The packaged app passed strict local code-signature verification, process startup, health, pairing and approval-page smoke checks.
5. After pairing, the packaged app reused the existing Codex login cache without copying credentials. `account/status` returned a ChatGPT account and the connector returned five available models.
6. The same connector/app-server path completed a real structured turn with the connected subscription.

No credential, session token or provider response body is committed as evidence.

## Still required for a public installer

- Developer ID Application signing and Apple notarization; the current app uses an ad-hoc development signature.
- An x64 macOS artifact and a signed Windows artifact.
- A packaged-app run of the complete document loop: observe, request permission, edit, re-observe, self-review, approve and undo.
- Upgrade, uninstall, single-instance and visible running-status behavior.
- Explicit verification for any provider other than Codex.
