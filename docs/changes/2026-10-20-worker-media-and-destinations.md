# Media transcription and empty destination recovery

## Scope and evidence

The owner requested investigation of the latest sync's classification media
failure and empty Places result. Existing authorization covers fixing the workers,
deployment and narrowly scoped recovery, preserving manual tags, deletions and
confirmed places. No historical batch is restarted.

This Critical maintenance change keeps the existing APIs, queues, provider
verification and service boundaries. It adds no schema, dependency or provider.
The entry gates are satisfied by the deployed multimodal pipeline and its existing
owner, source-hash, evidence and lease protections.

Production evidence localizes two faults:

- A verified, complete MP4 downloads successfully and decodes with FFmpeg. The
  installed local transcriber raises `TRANSCRIPT_TIMING_INVALID`; the older
  classification runtime reports this as `MEDIA_UNAVAILABLE`.
- Places proposes one caption candidate, then returns an empty fusion result.
  The valid empty JSON bypasses repair and provider resolution, becoming a
  successful analysis with no links.

Private source, runtime and recovery receipts belong under
`.tmp/places-review-20261020/` and must not enter Git.

## Requirements and tasks

| ID | Requirement | Implementation / evidence |
| --- | --- | --- |
| R1 | Preserve valid speech and reject unsupported timing; diagnose the actual ASR fault without exposing transcript content. | Shared transcriber, Python timing tests and scoped real-media replay. |
| R2 | A fusion that drops all prior proposals receives one bounded semantic review using original evidence. | Places inference and regression tests. |
| R3 | A recommended unnamed stay/activity may retain its explicit region/country as a destination; incidental geography remains excluded. | Inference instructions, valid-empty and recovered-destination cases, real preview. |
| R4 | Schema, source evidence, model deadline, token accounting and provider verification remain authoritative. | Existing inference/evidence suites and targeted regressions. |
| R5 | Recovery affects only the two identified posts and respects manual decisions. | Owner/source-scoped recovery journal and before/after integrity checks. |
| R6 | Activate immutable verified bundles without disrupting sync or active analyses. | Empty-queue check, graceful service switch, readiness and completion receipts. |

Expected source files: `services/worker/src/places/inference.ts`,
`services/worker/places-hermes/transcribe.py`, their existing test files, and the
classification runner/test only for sanitized diagnostic detail if needed.
Implementation must follow reproduced timing evidence before changing R1.

## Risk and rollback

A semantic recheck must not copy previous proposals into final output or turn a
context-only landmark into a recommendation. Valid empty results remain possible.
No invented venue name or coordinate is allowed; existing geographic providers
determine whether a source-supported area can be persisted.

Timing repairs must never move out-of-audio text into a plausible interval.
The regression must distinguish harmless decoder artifacts from corrupt timing.
Source media and caption are immutable.

Keep the prior immutable service releases and unit configuration. Drain active
work before activation; restore the prior unit/release on runtime failure.
Retain successful job receipts and audit history during rollback.

## Verification

Required: red/green focused regressions, independent diff review, worker types,
tests/build, Python tests, repository lint/types/tests/build, real media replay,
actual Places provider preview and post-recovery database receipts. Record skipped
database-dependent tests explicitly; run relevant integration checks when a
recovery changes business data. Do not claim production correction from unit
tests or a running service alone.

Local verification: 615 application tests passed; 259 PostgreSQL tests require
an isolated test database and remain for CI. The first restricted run hit blocked
subprocesses and one timing-sensitive UI assertion; the unrestricted full rerun
passed. Lint, application types and production build passed. Worker verification:
241 tests passed, seven PostgreSQL tests remain for CI; nine Python tests, worker
types and build passed. Independent review found no blocking issues.

Real-media replay preserved all 17 valid transcript segments exactly and discarded
one wholly out-of-audio terminal segment. The initial model replay retained the
explicit region this time, confirming nondeterministic fusion loss rather than a
permanent media/provider failure. The new guard targets the observed total-loss
case; it does not claim to detect partial candidate loss or guarantee model accuracy.

Production activation and recovery remain pending; private receipts establish their
actual state.
