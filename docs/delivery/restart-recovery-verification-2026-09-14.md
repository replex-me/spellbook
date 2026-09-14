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

## AI/native interruption boundary — 2026-09-15

A separate stuck state existed for subscription-backed local AI turns. Once the
connector claimed a job, the job became `running`; if the connector then exited,
browser polling could neither redispatch nor finish it. Replaying it automatically
would be unsafe because native tools may already have changed the live slide.

Native agent heartbeats now share one 60-second lease constant. The packaged
connector sends an independent heartbeat every 15 seconds, including while a
model is thinking and not producing tool or text events. Browser polling
atomically detects an expired connector lease in both local and internal modes,
fails the job and turn, expires unfinished browser tasks and emits one
user-visible recovery event. It leaves the live slide and native session intact
so the user can inspect any partial change and submit a new turn. A callback or
tool call from the abandoned connector can no longer reclaim the failed job.

The PostgreSQL integration suite exercised the entire transition for both
connector modes: start a turn, create a browser task, expire the heartbeat,
poll, reject the old worker and submit a replacement turn. All 12 native
orchestration integration cases passed against an isolated PostgreSQL 17
container.

## Packaged connector process kill — 2026-09-15

The process-level exercise first reproduced the missing internal-mode boundary
against the previous packaged runtime. Native job
`292924dd-6224-42af-ad02-6eb0f5c25206` was running with one live browser task
when `spellbook-ai-connector-1` received `SIGKILL`. After a fresh connector
process became healthy and its heartbeat had been absent for 74 seconds, an
authenticated native-session poll still left the job `running`. This demonstrated an actual stuck
job rather than inferring one from source.

The corrected public commit was
`cfac3a81cf67f8656f49565cb11eadaa4691e0fb`. Its packaged Linux arm64 runtime
images were:

- web: `sha256:c8f5fb65c26a166de2f9232dcce019d31e02d57fd0a22c77495f3a04f01a193c`
- AI connector: `sha256:46166613ab2656e6543bdfbfaf7918883e1e7a6068c83906e312839ba2d85b07`

A new native job, `8b56629e-5835-4129-a1ca-b6a0da3b3ae6`, entered `running`
with one task. Its heartbeat advanced from `21:41:59.518839Z` to
`21:42:01.656251Z` before the packaged connector received `SIGKILL`. After a
new connector process was healthy and the 60-second lease elapsed, an
authenticated native-session poll produced the following durable state:

```text
job=failed | error=native_agent_interrupted
turn=failed | message=AI 작업 연결이 중단되었습니다. 현재 슬라이드와 변경 내용을 확인한 뒤 다시 요청하세요.
task=expired | error=native_agent_interrupted
```

The same native session then accepted replacement job
`c71ab239-d8b4-4295-9d22-427ef9ce0629`. That replacement was explicitly
cancelled after admission so the evidence run left no active AI work. This
proves the packaged process-kill boundary and continued use after recovery; it
does not claim that a possibly applied edit was replayed.

## Remaining operations evidence

This closes the accepted document-job failure exercised above and the permanent
database/UI stuck state after an AI interruption. Packaged disk-capacity
behavior is recorded separately in
[Storage-pressure verification](./storage-pressure-verification-2026-09-15.md).
G7 still requires the deployed HTTPS/TLS path and therefore remains incomplete.
