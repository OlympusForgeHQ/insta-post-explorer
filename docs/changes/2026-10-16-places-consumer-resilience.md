# Places consumer recovery and resilience

Route: Standard, medium risk. Owner authorizes correction, publication, deployment
and recovery of the six failed Places jobs from the 16 October synchronization.
No migration, new service, provider, dependency or historical backfill.

## Evidence and requirements

The sync imported 13 posts and 31 media successfully. Classification and caption
translation succeeded for all 13. Six eligible posts exhausted three Places
attempts. In the consumer's actual mount namespace, download, ffprobe, video decode,
frame extraction and audio extraction succeed. Whisper initialization tries to
read a Hugging Face token under the protected home directory and fails. The generic
MEDIA_UNAVAILABLE code hides this runtime problem. HTTP 429 also consumes attempts.

- RES-1: Cached public ASR loads and transcribes under ProtectHome without reading
  home credentials or downloading models on each job. Missing cache/import and
  transcription failures have distinct sanitized codes; decoder, download, timeout
  and cancellation remain distinguishable. Classification's existing contract stays
  compatible with its shared extractor.
- RES-2: Before claiming work, verify ASR, media tools and writable temporary storage.
  Runtime faults open a circuit: no subsequent claims until checks recover, with
  abortable exponential waits capped at 15 minutes. No caption-only success fallback.
- RES-3: Transient inference failures retry the same request within the existing
  deadline, honoring bounded Retry-After, without consuming format-repair attempts.
  Busy/runtime deferrals preserve analysis budget but have a separate six-deferral
  limit. Provider cooldowns up to 15 minutes block owner claims durably; longer
  Retry-After values are capped at this operational limit.
- RES-4: An explicit, once-only infrastructure repair may grant three additional
  attempts to a named failed job. Preserve its attempt history, provenance and audit;
  enforce owner, input hash, eligibility, manual exclusions and no active/successful
  work. Replays cannot repeatedly extend its budget.
- RES-5: Deploy the compatible application before the consumer; verify a real
  transcription in its service sandbox and recover only the six identified jobs.
  Preserve running classification and sync processes and all manually protected data.

## Delivery and validation

Files: Places media/transcription and inference modules/tests; consumer loop/pipeline,
worker error contract/learning, server fail/retry and focused PostgreSQL tests;
consumer readiness/runbook and this record. Root coordinates shared contracts, agents
independently implement ASR and inference retries; a third agent reviews correctness.

Use red/green regressions for offline ASR initialization, bounded transport retries,
preflight/circuit behavior, temporary-storage failure after claim, lease-fenced
deferrals and explicit repair idempotency. Run application and worker suites with
disposable PostgreSQL, lint, types, build/package checks and independent review.
Final evidence includes exact release, real service sandbox smoke, six job receipts,
unchanged protected-data digests and unchanged sync/classification processes.

Rollback: gracefully stop only the Places consumer, restore its previous immutable
release/unit and the preceding web image if required. Retain durable queue/audit rows;
do not reset successes, delete evidence or replay synchronization. Runtime deployment
is already owner-authorized; sandbox escalation still applies to privileged actions.

## Verification

The original sandbox failure is resolved: the corrected script returns
`{"ready":true}` with the installed model in the active service mount namespace.
Red/green regressions cover ASR import/cache isolation, actual FFmpeg decoding and
storage errors, API cooldown propagation, lease-fenced deferrals, bounded repair,
manual exclusions and compatibility of classification errors.

Local validation: 774 application tests with disposable PostgreSQL, 231 worker tests
including its PostgreSQL suite, six Python transcription tests, lint, both type
checks and application/worker production builds pass. Three independent review
rounds resolved subprocess disk-full classification, executable readiness, retained
provider cooldowns, cleanup-failure backoff and concurrent claim/fail admission.
No code-review blocker remains. The release package contains only Places/runtime,
its existing zod dependency and transcription script; no DB client or credentials.

CI uses the Google cache of the official PostgreSQL image. Registry metadata was
checked against Docker Hub: both serve the identical manifest digest for
`postgres:16-alpine`. This changes only the ephemeral CI database image source.

Live deployment and six-job recovery receipts are recorded privately under
`.tmp/places-resilience-20261016/`. Completion requires full real-video transcription,
recovered terminal job receipts, protected-data comparison and restored deployment
controls; those cannot be inferred from a running systemd unit alone.
