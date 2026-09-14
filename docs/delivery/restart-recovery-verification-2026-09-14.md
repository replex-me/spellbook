# Restart recovery verification — 2026-09-14

## Failure found

Self-hosted jobs were durable in PostgreSQL and workers wrote durable result receipts, but a successful HTTP acceptance set `dispatched_at` permanently. If the process died after acceptance and before writing its receipt or callback, document polling excluded that queued job forever. Container restart alone therefore did not guarantee recovery.

## Systemic correction

The local dispatcher now treats `dispatched_at` as a bounded delivery lease instead of a permanent delivered flag. A queued job is eligible again after `SPELLBOOK_JOB_REDELIVERY_SECONDS`, which defaults to 15 seconds and is bounded to 5–900 seconds. Repeat delivery has two safe outcomes:

- the same live worker joins or ignores its in-memory execution for that job ID;
- a restarted worker replays the durable result receipt, or reruns the still-version-isolated job when no receipt exists.

The same lease predicate is used by conversational job recovery and the internal native-session polling path. This provides single-worker Compose recovery; it is not a substitute for a shared lease and durable queue in a multi-worker deployment.

## Automated evidence

- parser and boundary tests passed for the 5–900 second lease;
- PostgreSQL integration tests proved that a ten-minute-old accepted job is redelivered and a current lease is not duplicated;
- the full isolated version-transition suite passed: 23/23;
- the ordinary web suite passed: 71 passed, 33 intentionally skipped.

The integration harness itself was corrected to set its isolated `search_path` on every PostgreSQL pool connection. Its prior session-local `SET` sent the second concurrent transaction to the default schema, causing the concurrency test to wait on a barrier until timeout.

## Destructive runtime test

A real PPTX upload created document `484bdb99-b111-4454-a03d-4c7d0b648dd9`. The document worker was paused immediately after accepting the scan and forcibly removed before it could write a receipt. The durable state at failure was:

```text
document=processing | job=queued | dispatched=true
```

A fresh document-worker container reached healthy status. After the 15-second lease expired, normal document polling redelivered the job and the new worker completed it:

```text
document=ready | job=succeeded | error=<empty>
```

The proof document is retained in the local test account so the saved output and database events remain inspectable.

## Remaining operations evidence

This closes the accepted document-job failure exercised above. G7 still requires explicit recovery evidence for an interrupted AI/native turn, enforceable storage-capacity behavior and the deployed HTTPS/TLS path. It therefore remains incomplete.
