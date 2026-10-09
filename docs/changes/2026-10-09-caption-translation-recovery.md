# Caption translation recovery

Route: Critical. Owner approved the diagnosed fixes and failed-job recovery on
9 October, with standing publication/deployment permission and no interruption of
active work. Same worker, model, API, schema and original-caption contract.

## Problem and outcomes

121 terminal INVALID_RESULT jobs conceal distinct validator failures. Copying the
entire source makes even unchanged French/English expensive and fragile. Immediate
HTTP 429 refusals consume the same three attempts as actual inference failures.

- REQ-001: Return indexed sentence/line units rather than copied source. Retain
  French/English/nonlinguistic units locally. Mixed-language units use the existing
  exact-segment path so protected prose cannot be rewritten as a whole.
- REQ-002: Mask URLs, mentions, hashtags, numbers and emoji locally, validate each
  marker exactly once and in order, then restore them. Preserve source separators.
  Retain existing final content checks; reject incomplete or unknown outputs.
- REQ-003: Log allowlisted rejection reasons only, never captions/provider bodies.
- REQ-004: HTTP 429 honors a bounded Retry-After pause. Busy deferrals do not consume
  inference attempts and remain retryable for at most 24 hours since first claim.
  Other transient failures retain the three-attempt policy. No unbounded busy loop.
- REQ-005: Requeue only failed translation jobs with unchanged current input and a
  live owner post. Preserve completed results, active leases and classification.
  Journal before/after and prove idempotency; do not redo the successful batch.

## Invariants and architecture

No original-caption, Post.updatedAt, category, tag, deletion or Places mutation.
No schema/dependency/provider/new service. Existing claim lock and classification
priority remain. Translation DTO/result/API contracts unchanged. The new internal
provider protocol uses indexed units; the old exact-segment validator remains the
fallback for mixed units. Safer than relaxing content validation or changing model
before fixing transport/protocol failures. Input is untrusted and never invokes tools.

Risks: marker corruption, missing/duplicate IDs, mixed-language rewriting, provider
saturation and stale recovery. Bound provider calls/time; never publish partial work.
Fallback and retries retain lease heartbeat/deadline and owner/source-hash fencing.

## Tasks, tests and rollout

1. Worker inference/unit codec and tests: unchanged captions without echo, marker
   restoration, malformed IDs/markers, mixed-source fallback, detailed safe errors,
   Retry-After and cancellation. Files: translation-inference.ts,
   translation-units.ts, cli.ts, caption-translation.test.ts and new unit tests.
2. Server fail policy + PostgreSQL tests: busy attempt refund, delayed retry,
   24-hour expiry, stale lease and ordinary failure limits.
3. Full app/worker checks and independent review. Real synthetic provider pilot;
   production replay keeps captions in the normal processing boundary.
4. Publish web API first, gracefully drain the existing Node consumer, activate
   immutable release, verify completed work, then scoped/audited failed-job recovery.
   Preserve sync image/cron. Rollback to the prior consumer after owned work drains;
   web policy remains backward compatible. No blind kill or broad queue reset.

Implementation and independent review are complete. Red/green regressions cover
indexed inference, protected-unit preservation, busy attempt refund and scoped
recovery. Full local suites: 666 app and 146 worker tests including PostgreSQL.
Lint/types/builds and both PR quality/browser CI runs passed (#131/#132).

Production evidence: web/main `e84e96c` is healthy. At 08:12 UTC the old consumer
finished its owned job and released the canonical lock before activation. Five
synthetic cases passed against the real provider in 1.9–4.8 seconds; the pilot uses
one global five-minute deadline and execve to avoid orphan processes on timeout.
The new immutable release `20261009-translation-recovery` retains four CPUs and
the environment, with Node main PID and zero restarts. At 08:13 UTC, 141 failed
jobs were requeued under fixed cutoff `2026-10-09T08:12:24.908Z`; an identical
replay requeued zero. At 08:14 UTC, five recovered jobs had succeeded with no
new cohort failures. The remainder continues; this is not a claim that all
historical translations are complete. Source captions, 2,763 protected tag links,
36 tombstones, 1,230 Places and 1,165 place links match their prior fingerprints.
Web/sync deployment controls were restored and the sync image/cron preserved.

Detailed private activation, recovery, replay, integrity and cohort receipts are
in `.tmp/caption-recovery-20261009/`. Future status must separate versions and
use the recorded cohort, not the entire translation queue. Do not repeat recovery
with a later cutoff merely to hide new failures; inspect the new diagnostic codes.

## Mixed-language fallback follow-up

The live cohort exposed repeated TRANSLATION_TOKENS_CHANGED in the exact fallback:
its input was being unmasked before inference. Keep markers throughout that path,
then validate their presence/order and restore protected content locally. The exact
prompt now explicitly excludes marker letters from language detection. Original
FR/EN segment copying and final raw-caption checks remain unchanged. Regressions
cover a mixed-language quantity and marker permutation through both fallback entry
paths. This is a worker-only follow-up; no API/schema or sync change is needed.
The current activation and recovery outcome is recorded in the private execution
receipt, with separate receipts for this follow-up. The original 141-job cohort
remains the observation scope; do not infer completion from enqueue success.
