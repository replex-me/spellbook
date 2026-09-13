# Self-hosting

## Requirements

- Docker Engine or Docker Desktop with Compose v2
- 4 CPU cores, 8 GB RAM and 10 GB free disk for a practical first build
- Node.js 22 and pnpm 10.26 for setup and verification
- outbound access during the first build for pinned base images and font/LibreOffice downloads

The document worker builds natively for both `linux/amd64` and `linux/arm64`. It installs the same pinned LibreOffice 26.8.0.3 Debian backport on both architectures and publishes the .NET worker for Docker's target architecture. This avoids x86 emulation on Apple Silicon. Architecture is still part of the renderer identity: fidelity reports must record it and compare both targets before a tagged beta.

## Start

```bash
pnpm install --frozen-lockfile
pnpm selfhost:setup
docker compose up --build -d
pnpm selfhost:doctor
```

The setup command creates `.env` with mode `0600`, generates independent secrets and prints the initial password once. Open `http://localhost:3000`, log in, then connect Codex from the AI panel if AI editing is needed.

The default `internal` mode keeps the connector in the private Compose network. To exercise the same user-device boundary used by a hosted Spellbook service, set `SPELLBOOK_AI_CONNECTOR_MODE=local` in `.env`, recreate only the web container, and start the loopback connector on the user's computer:

```bash
docker compose up -d --no-deps --force-recreate web
pnpm connector:start
```

The connector listens only on `127.0.0.1:43127` and starts without product-specific configuration. Each HTTPS Spellbook site must open a local approval page that names its exact origin before it receives a short-lived, origin-bound session. Set `SPELLBOOK_CONNECTOR_ALLOWED_ORIGINS` only when an operator wants to restrict the connector to a fixed comma-separated allowlist. By default it uses the same local Codex login cache as the CLI and IDE extension, so an already signed-in user does not authenticate again. Set `SPELLBOOK_CODEX_AUTH_MODE=isolated` to use a separate Spellbook-only login instead. The approval session is stored in browser session storage and expires; Codex credentials stay on the user's computer and are never copied into Spellbook storage. Do not expose the connector port through a reverse proxy or bind it to a LAN interface.

On macOS, contributors can assemble the same connector as a standalone app:

```bash
pnpm connector:package:macos
```

The build bundles the connector, the pinned official Node runtime and the matching Codex executable; verifies the Node download checksum; injects the connector with Node's single-executable format; signs the app; and runs loopback health, origin-bound pairing and approval-page smoke checks. The ignored result is written under `artifacts/connector/`. Without `SPELLBOOK_MACOS_SIGN_IDENTITY`, the app receives an ad-hoc signature for local verification only. A downloadable public macOS build must use a Developer ID Application identity and pass Apple notarization; the current source build is not a substitute for that release gate.

## Data and backup

`database-data` holds metadata and version lineage. `document-data` holds uploaded documents, derived renders and job receipts. `ai-auth-data` is mounted only into the AI connector and holds its provider runtime home. A usable document backup requires a consistent copy of the database and document volumes; back up the AI volume separately if reconnecting the provider is not acceptable.

The original upload is immutable. Deleting the Compose stack with `docker compose down` keeps volumes. Adding `--volumes` destroys document and database data and must not be used as a routine reset.

## Network and TLS

Only the web application and Collabora browser endpoint are published by the local profile. Worker ports stay on the private Compose network and require an internal token. For internet exposure, terminate TLS at a reverse proxy, set the two public URLs to their HTTPS origins, restrict frame ancestors, and do not publish PostgreSQL or worker ports.

WOPI access tokens are scoped to one document session and use a secret distinct from service-to-service authentication. A production deployment must additionally validate Collabora's WOPI proof signatures and run the official WOPI validator before public exposure; the local beta profile does not yet satisfy that release gate.

## Fonts and fidelity

The default image installs redistributable metric-compatible and Korean fallback fonts. It cannot lawfully bundle every Microsoft desktop font. Install fonts you are entitled to use into a private derived image, rebuild the font cache and run the public corpus. Missing fonts are surfaced in the document graph; they are not silently treated as fidelity success.

## Scaling boundary

The default dispatcher accepts work over the private HTTP network and workers persist completion receipts. It is sufficient for one-node self-hosting but does not provide a crash-durable queue. Internet-scale hosting must supply a durable queue adapter, retry policy, leases, rate limits and storage concurrency controls downstream without changing the document adapter contract.

## Live smoke test

After uploading a PPTX, copy its UUID from the document URL and run:

```bash
SPELLBOOK_SELFHOST_DOCUMENT_ID=<uuid> pnpm test:selfhost
```

The test uses the local session cookie created during manual login. It opens the real Collabora canvas, waits for the Spellbook extension bridge, changes an actual slide text object, saves it through WOPI, downloads the resulting PPTX, validates the ZIP package and checks the changed slide XML. It writes screenshots and the downloaded test file only under the ignored `.tmp-runtime/evidence/` directory.
