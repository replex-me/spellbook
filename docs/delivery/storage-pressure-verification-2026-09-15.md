# Storage-pressure verification — 2026-09-15

This exercise proves that both writable public runtimes reject writes before
exhausting their persistent volume, remove partial files and retain enough
emergency capacity to record a durable terminal result. It closes the local
disk-limit exercise within G7 Operations; deployed volume monitoring and the
managed-service load/backpressure proof remain separate work.

## Source and runtime identity

- public source: `417a9d96519073960a7dbb10186f120c91efe028`
- storage implementation introduced by: `c12663cf298d3d49d0fb87ec9d5b3b1bbcf65d9e`
- runtime architecture: Linux arm64 containers on the local Docker host
- AI connector image: `spellbook-ai-connector:storage-pressure-417a9d9-exact`
- document worker image: `spellbook-document-worker:storage-pressure-417a9d9-exact`
- both images carried the exact public source commit in the
  `org.opencontainers.image.revision` label and that label was checked before
  the probes ran

## AI connector object-store probe

Command:

```bash
pnpm selfhost:verify:storage-pressure \
  spellbook-ai-connector:storage-pressure-417a9d9-exact
```

The 80 MiB tmpfs probe exercised both failure paths: a preflight rejection when
the complete write would cross the 64 MiB reserve, and an actual filesystem
failure after a deliberately optimistic free-space observation. In both cases
the error was `storage_capacity_exhausted`, neither rejected destination
existed and no temporary file remained. A 56-byte terminal receipt was still
committed within the separate 16 MiB control reserve.

## Document-worker job probe

Command:

```bash
pnpm selfhost:verify:worker-storage-pressure \
  spellbook-document-worker:storage-pressure-417a9d9-exact
```

The probe started the packaged worker with the same 80 MiB tmpfs, copied the
real `general-native-surface.pptx` fixture into its local object store, filled
the volume below the normal reserve and submitted a real authenticated
`scan-render` job over HTTP. The worker accepted the job, failed the first
regular result write with `storage_capacity_exhausted`, then:

- atomically committed `/data/jobs/storage-pressure-render/worker-result.json`;
- delivered the same failure through an authenticated callback;
- left that receipt as the only file in the job result directory; and
- left no `*.tmp` file anywhere under `/data`.

This is an end-to-end worker-process result, not only a unit test of the storage
class. The verifier also removes its disposable container in a `finally` path.

## Remaining boundary

This proof does not show alerting or capacity behavior on the managed GCP
deployment, recovery after a host-level filesystem failure, distributed queue
leases or tenant-level quotas. Those remain in the infrastructure and release
work; they are not inferred from this local container result.
