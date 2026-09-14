# WOPI security and lock-lifecycle verification

Date: 2026-09-14

## Outcome

The self-hosted runtime now authenticates Collabora-to-host WOPI traffic as well as validating the document-scoped access token. Setup generated one persistent 4096-bit RSA private key, Compose mounted it read-only into Collabora, discovery advertised the matching current and old public-key attributes, and the web host required a valid signature and fresh timestamp before reading or changing document state.

## Evidence

- `pnpm selfhost:setup` upgraded an existing installation without changing `.env`, created `.spellbook/secrets/wopi-proof-key.pem` and set its mode to `0600`.
- `pnpm selfhost:doctor` passed the required proof mode, persistent key, Compose configuration and both public runtimes.
- Live `/hosting/discovery` returned `proof-key` with current and old modulus/exponent fields after the editor restart.
- The existing headless self-host smoke test opened an actual PPTX in Collabora, observed and changed a real slide object, saved through WOPI, downloaded the PPTX and verified its ZIP and slide XML. Result: 1 passed in 9.0 seconds.
- After the lock-lifecycle change, the same complete browser-to-Collabora-to-WOPI-to-worker-to-download path passed again in 8.4 seconds. The captured screen showed the changed native text, saved state, editable canvas and disconnected-AI guidance together without an error overlay.
- A request with a valid unexpired document token but no proof headers returned HTTP 500 `invalid_wopi_proof`.
- A request with a valid token, invalid signatures and a stale timestamp returned HTTP 500 `invalid_wopi_proof`.
- The unit suite passed Microsoft's published known-good proof vector, signature tampering, full-URL construction, timestamp expiry and discovery parsing cases.
- PostgreSQL integration tests passed all 16 document-session cases, including a 90-second client-selected lock lifetime, the 30-minute default, automatic abandoned-lock expiry, `Lock` refresh, atomic `UnlockAndRelock`, unlocked `RefreshLock` conflict behavior, and the 1,024-character ASCII lock-ID boundary.

## Design boundary

The verification URL is reconstructed from the configured WOPI source origin plus the received path and query. This is required behind containers and TLS terminators because the framework-facing request origin can differ from the URL signed by the WOPI client. Arbitrary forwarded-host headers are not used as signature authority.

The private key is intentionally not stored in Git or in the database. Losing or rotating it invalidates the proof identity advertised by a running Collabora installation, so it belongs in backup and restore procedures. Collabora currently advertises the same key as current and old; the host nevertheless implements the WOPI three-combination verifier and discovery refresh behavior so a client with real key rotation remains compatible.

WOPI locks are file-scoped leases rather than user ownership. The host stores an absolute expiry alongside each lock, honors the protocol's optional 60-3,600 second timeout, and falls back to 30 minutes for locks created before that column existed. Every read, save, lock operation and browser-mode transition expires an abandoned lease before deciding whether the file remains locked. `Lock`, `RefreshLock`, `Unlock`, `GetLock` and `UnlockAndRelock` use one database row as the serialized state machine, so switching between Collabora and the browser-owned editor cannot silently bypass an active writer.

## Remaining release evidence

This closes the local signed-request path. It does not prove HTTPS proxy configuration, backup restoration, restart recovery, disk exhaustion behavior or a deployed conformance run; those remain part of G7.

## Primary references

- [Microsoft WOPI proof keys](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proofkeys)
- [Microsoft WOPI custom headers](https://learn.microsoft.com/en-us/openspecs/office_protocols/ms-wopi/70254fa6-9d3d-4f93-9b1a-e6597a63b900)
- [Microsoft WOPI lock requirements](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/rest/concepts#lock)
- [Microsoft extended WOPI lock timeouts](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/plus/coauthoring/wopi-locks)
- [Microsoft proof-key sample tests](https://github.com/microsoft/Office-Online-Test-Tools-and-Documentation/tree/master/samples)
- [Collabora proof-key implementation](https://github.com/CollaboraOnline/online/blob/distro/collabora/co-25.04/wsd/ProofKey.cpp)
