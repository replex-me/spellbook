# Backup and restore verification — 2026-09-14

## Claim under test

The self-hosted stack can capture a write-consistent backup of all durable product state, resume the source service, restore that backup into an isolated Compose project and recover the same database records and file bytes. This is one required part of G7 Operations; it does not close G7 by itself.

## Environment and procedure

- source project: `spellbook`
- isolated restore project: `spellbook-restore-proof`
- source commit recorded by the manifest: `c5cf98564c94abdd74a2f6ef403cde4100d43613`
- backup destination: ignored local directory `.spellbook/backups/runtime-verify-2026-09-14`
- backup behavior: web, office, document worker and AI connector writers stopped; PostgreSQL dumped; document and AI-auth volumes archived; configuration and WOPI key copied; manifest hashes verified; prior writers resumed
- restore behavior: manifest verified before mutation; isolated database and named volumes created; database and both volumes restored; database analyzed

## Results

The backup completed and its manifest recorded all five required members:

| Member                 |      Bytes | SHA-256                                                            |
| ---------------------- | ---------: | ------------------------------------------------------------------ |
| `database.dump`        |     46,362 | `add21c538b625135760ef9ebc63af8a1c582c8bcd367a91a2288edcb9b5de13d` |
| `document-data.tar.gz` | 47,760,365 | `e690da2034381a044d3163a00b07822c40d759f52cecd0de8bab4a157f4efbc5` |
| `ai-auth-data.tar.gz`  | 25,860,107 | `79600b7ec7c5119d3926f4311d0933c7278b7e38a5e61f8c097315b0958106d8` |

Post-restore comparisons were exact:

| Check                     |                                                             Source | Restored | Result |
| ------------------------- | -----------------------------------------------------------------: | -------: | ------ |
| documents                 |                                                                  8 |        8 | pass   |
| jobs                      |                                                                 19 |       19 | pass   |
| versions                  |                                                                 19 |       19 | pass   |
| document volume tree hash | `ee6aa1a522645169a745a2a85f9287a87176081f394283f1d080d3a3182e93eb` |     same | pass   |
| AI-auth volume tree hash  | `30530348311044581b41f04f26c2ca6f096f7318499116a84a6109064cb2d64f` |     same | pass   |

The disposable restore project's containers, network and volumes were deleted after comparison. The source volumes and ignored backup remain intact and the five source services returned healthy.

## Remaining G7 evidence

This proves backup consistency and byte-for-byte isolated recovery for the exercised state. G7 still requires restart recovery with in-flight work, enforceable disk-capacity behavior and the deployed HTTPS/TLS path. Backup authenticity, off-device encrypted retention and scheduled restore drills are operator responsibilities and must be defined before a hosted beta.
