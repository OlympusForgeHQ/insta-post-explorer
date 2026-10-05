# Independent classification of newly synchronized posts

Implementation based on `origin/develop` `77aff3d`, published through PR #111
after the owner's explicit authorization of publication, migration, deployment
and a restricted pilot before unattended activation. Release PR #112 targets
production. Activation remains pending administrator access and the real-post pilot.
See the [accepted decision](../decisions/2026-10-05-independent-classification-worker.md),
[specification](../superpowers/specs/2026-10-05-post-classification.md) and
[operations](../../services/worker/classification/README.md).

Previously synchronization classified from description keywords and up to ten
heuristic tags. It now optionally creates one durable classification job for each
new verified import in the same transaction. The independent DeepSeek consumer
analyzes description, images, sampled video frames and complete available audio
transcription, then saves an existing theme and 3–5 relevant proposed tags.
Existing tags are reused by normalized slug; new precise tags are allowed.
Manual tag links survive. Insufficient evidence retains the provisional result
and marks the job NEEDS_REVIEW.

No existing library backfill, Places job, extension change, historical category
rewrite or restoration of deleted posts is introduced. Sync does not wait for
inference. Worker outages leave already committed imports consultable. The
classification flag defaults off; queue persistence failure rolls back its import
so no new post loses the promised durable handoff.

All ownership, lease, media/source and result validation remains in the
application. The isolated host consumer has only dedicated application/Hermes
keys, no SQL or R2 credentials and no public port. Serial processing, heartbeat,
three bounded attempts and completion receipts protect retries and response
loss. Deleting a post cancels its job while retaining the journal. Per-post manual
edits and global catalog corrections fence stale results under a shared write
gate. The latter use the latest manual catalog audit revision; automatic tag
creation does not invalidate other queued posts.

The additive migration creates `post_classification_jobs`, ownership/idempotency
constraints, claim index, deletion cancellation and audit triggers. Prisma uses
the existing status enum. Its scalar SetNull relation is supplemented by a manual
composite owner/post FK which future generated migrations must preserve.

## Verification — 5 October 2026

Node 24.18.1; a disposable loopback PostgreSQL 16.15 cluster, all 15 migrations
applied. These implementation checks used the disposable database; the separate
authorized production rollout is recorded below.

| Boundary | Evidence |
|---|---|
| Application regression suite | 637 tests passed, 81 files, no skips; includes real PostgreSQL |
| Worker regression suite | 107 tests passed, 15 files, no skips; includes existing restricted-role database checks |
| Classification contracts/API | Canonical theme, 3–5 tags, duplicates/theme repetition/injected fields rejected; bounded authenticated route, server-derived owner |
| Transactional queue | Exactly one enqueue/claim; rollback; canonical tag reuse; owner isolation; expiry/retry; atomic completion replay; review without overwrite |
| Manual changes | Per-post edit/promotion/delete and global rename/merge/delete; real PostgreSQL blocking gate and deleted unassigned catalog-tag regression |
| Cross-layer flow | Real sync import → signed media → built media extraction → inference transport → actual API adapter → PostgreSQL completion; second queued import remains eligible after automatic tag creation |
| Video/audio | Real image + 2-second video with 3-second audio tail; full extracted audio supplied to test ASR; actual JPEG frames/transcript serialized to controlled inference |
| Failure/restart | 429, invalid/length-limited JSON, heartbeat loss, stop, NEEDS_REVIEW, private cleanup, lost completion response; fresh abandoned media removed at startup under exclusive service flock |
| Static/build | Lint, application/worker type checks, production Next.js build and worker build passed |
| Installation | 2 private/idempotent state tests; 6 existing Hermes installer/transcription tests passed; generated systemd unit syntax verification passed |
| Release | Classifier-only bundle and SHA-256 file manifest; built CLI smoke with canonical trailing-slash origin, one fake poll, SIGTERM exit, startup cleanup/cache retention passed |
| Independent review | No unresolved Critical, Important or Minor findings; three identified issues fixed and rechecked |

The inference transport and ASR transcription fixture are controlled test
substitutes. These tests prove dataflow/extraction/persistence, not deployed
provider quality or real credentials. The restricted live pilot remains pending.
The existing jsdom canvas notice is unrelated and does not fail tests.

Regression failures were observed before each relevant fix: missing contract/API
and worker modules, shared credentials, invalid classification preflight,
unserialized global tag edits/recreated deleted tag, trailing-slash endpoint and
missing startup cleanup helper. The harness initially passed the wrong stdin
argument to its built-CLI smoke; correcting that test invocation passed without
changing product code.

## Rollout gate

Publication is authorized. Migrate/deploy the application disabled;
stage the immutable Node 24/ASR release and private stopped unit; provision only
the dedicated digest in the web app and raw key in the classifier; run deployment
preflight; enable for a restricted newly imported real post and verify provider,
theme/tags, media coverage, journal, usage, cleanup and existing sync/Places health.
Only then enable unattended service startup. The previous durable sync hotfix
must be preserved; this branch changes no extension or sync image.

Rollback stops/disables only the classification consumer and flag, preserving
saved posts, manual edits/deletions, jobs and audit history.

## Production rollout checkpoint — 5 October 2026

PR #111 quality/browser CI passed and the source is merged into `develop` at
`2371239`. The production additive migration was applied using Prisma's normal
deploy engine and recorded with the committed SQL checksum; no manual history
receipt was fabricated. Three earlier migrations are absent from production
history although their structures already exist. The private migration staging
contained only the new reviewed migration, so their historical DML/DDL was not
replayed. This existing history discrepancy is not repaired by this feature and
must be considered before a future full `migrate deploy`.

The before/after fingerprints of all existing posts/media/tag links, permanent
deletions, Places/links/jobs and sync admissions match. The new queue is empty.
A dedicated digest and flag 0 are prepared in the application. Shared Hermes
health and real synthetic image recognition succeeded (938 input tokens,
41 output tokens). This probe did not analyze a saved post or mutate the library.
The real newly imported post, deployed consumer/ASR, final theme/tags and cleanup
are still unverified. The reviewed host installer remains stopped pending an
administrator installation path; current Karim/Argos sudo requires a password.
The hourly synchronization remained enabled and its 18:00 UTC execution succeeded.

## Why each new test file exists

- `classification-contract.test.ts`: rejects invalid model output and unauthorized command shapes.
- `classification-api.test.ts`: protects dedicated key isolation and the bounded owner-derived API adapter.
- `classification-postgres.test.ts`: protects durable enqueue, serial leases, completion replay and manual-write fencing under real transactions.
- `classification-flow-postgres.test.ts`: proves new sync imports reach multimodal persistence, response-loss recovery and atomic enqueue failure without touching historical posts.
- Worker `classification.test.ts`: protects private configuration, canonical transport and bounded strict inference.
- Worker `classification-runner.test.ts`: protects heartbeat loss, shutdown/review and private media cleanup after normal or crash paths.
- `classification/test_install.py`: protects private permissions, idempotent credentials and refusal of foreign/symlinked state.

The existing deployment preflight test additionally covers missing/shared
classification credentials without exposing secret values.
