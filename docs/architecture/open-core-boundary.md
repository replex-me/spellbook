# Open-core repository boundary

## Decision

This repository is the runnable self-hosted product, not an SDK teaser. A user can open, directly edit and AI-edit a supported document without a Replex account or Google Cloud project.

The hosted Replex product is a downstream distribution. Its private code may depend on public Spellbook contracts and packages. Public Spellbook may never depend on Replex identity, billing, infrastructure, customer data or private evaluation results.

## Ownership map

| Area                                                                | Public Spellbook | Hosted overlay                         |
| ------------------------------------------------------------------- | ---------------- | -------------------------------------- |
| Browser workspace and editor UX                                     | Yes              | Branding/configuration only            |
| WOPI host and editor bridge                                         | Yes              | Production routing and scaling         |
| Document adapters, validators and render evaluation                 | Yes              | Private fixtures and release evidence  |
| Local authentication                                                | Yes              | Replaced through an auth port          |
| Local filesystem object store                                       | Yes              | GCS/S3 adapter                         |
| Direct in-process job dispatch                                      | Yes              | Durable queue adapter                  |
| User-owned AI connector                                             | Yes              | Signed connector rendezvous and policy |
| Model tokens or subscription resale                                 | No               | No                                     |
| Replex SSO, billing, entitlement and admin policy                   | No               | Yes                                    |
| Cloud project IDs, service accounts, deployment scripts and secrets | No               | Yes                                    |
| Customer documents and private corpora                              | No               | Yes                                    |
| Product strategy, pricing and competitive notes                     | No               | Yes                                    |

## Enforced rules

- No public source may contain a hosted-service import, production identity, infrastructure endpoint or secret name.
- Interfaces live on the public side. Hosted adapters implement them downstream.
- A generally useful document fix starts public. A hosted-only operational capability stays private.
- Private code is never copied into public history and then removed; extraction happens from an explicit allowlist into a clean repository.
- The boundary test scans source, configuration, generated artifacts and forbidden paths on every pull request.
- Public fixtures must be redistributable and list their source and license. Customer fixtures never enter Git history.

## Authentication ports

Self-hosting starts with one local owner account whose password is stored only as a salted scrypt hash. Multi-user OIDC belongs behind an `IdentityProvider` port and should use issuer discovery rather than hard-coded vendor endpoints. Hosted Replex SSO implements the same port outside this repository.

## AI credential boundary

The self-hosted Compose profile runs the connector inside the user's deployment and keeps each runtime home in the local data volume. A public hosted service must not receive raw consumer-subscription credentials merely because this local mode can. Its safe direction is a signed user-device connector: provider authentication occurs in the provider's unmodified tool, while Spellbook exchanges scoped document operations and events.

Codex is the only implemented provider adapter in this repository. Claude Code and other runtimes remain design candidates until a connector, authentication ceremony, tests and provider-policy review ship.

## License boundary

Spellbook-authored files use MPL-2.0 so changes to covered files remain available while separately authored hosted files can remain private. Third-party files and binaries retain their own licenses. No modified Collabora container is published from this repository until branding, trademark, notice and corresponding-source obligations are reviewed for that distribution.
