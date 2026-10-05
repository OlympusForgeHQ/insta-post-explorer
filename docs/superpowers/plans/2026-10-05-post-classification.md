# Post classification worker implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** New synchronized posts emit durable work to an independent DeepSeek classifier which saves one existing theme and 3–5 meaningful tags.
**Architecture:** Application-owned dedicated queue, scoped HTTP API and separate host consumer of the existing Hermes runtime. The synchronization transaction queues verified new posts and never waits for inference.
**Tech Stack:** Existing Next.js/Prisma/PostgreSQL, Node/Vitest, systemd, FFmpeg/Whisper, Hermes.
**Spec:** `docs/superpowers/specs/2026-10-05-post-classification.md`

## Global constraints

Eight existing themes; 3–5 automatic tags, reuse then create as needed. New sync imports only; no historical/Places backfill. One post at a time, 15s idle poll, 90s lease/30s heartbeat, 20min/post, 6min/inference, three attempts with 60s/300s retry. Existing media limits. No new dependency or extension change. No credentials/content in logs. No Git commit/push/production migration/deployment without authorization.

## Review focus

Lost completion response/double delivery; same-value manual tag promotion; deletion after inference; cross-owner claims; concurrent Places inference/429. Each gets a focused regression below.

## Task 1 — Contract and transactional queue

Files: `src/lib/classification/contract.ts`, `src/server/classification/{inputs,jobs}.ts`, `prisma/schema.prisma`, additive migration, `src/server/sync-post.ts`; `tests/unit/classification-{contract,postgres}.test.ts`.
Interfaces: `enqueueClassification(ownerId,postId,tx): Promise<void>`, `claimClassification(ownerId,deps): Promise<Claim|null>`, `heartbeatClassification(ownerId,lease)`, `completeClassification(ownerId,lease & {result},deps)`, `failClassification(ownerId,lease & {code})`. Strict result/coverage/prepared claim/command schemas. Fingerprint: sources, updatedAt, theme, all tag links including isManual and verified media identities.
- [x] RED contract: 3–5 distinct tags/canonical theme; reject duplicates, theme-as-tag, unknown category, injected fields. RED PostgreSQL: claim contention, rollback/idempotency, atomic completion/replay, expiry, other owner, edits/manual promotion/deletion, NEEDS_REVIEW.
- [x] Observe missing contract/service failures before implementing.
- [x] Implement additive owner/post constraints, transaction/lease/source gates, cancellation and audit; new verified sync imports enqueue in the enclosing transaction; preserve manual tags and searchText.
- [x] GREEN focused contract and disposable PostgreSQL tests.

## Task 2 — Scoped API

Files: `src/auth/api-key.ts`, `src/app/api/v1/classification/worker/route.ts`, `.env.example`, deployment preflight script, `tests/unit/classification-api.test.ts`.
Interface: POST `claim|heartbeat|complete|fail`, owner derived server-side. Dedicated CLASSIFICATION_WORKER_API_KEY_SHA256 and CLASSIFICATION_WORKER_ENABLED=1; raw key differs from read/Places/sync.
- [x] RED disabled/missing/shared/wrong key; invalid command/body; correct key invokes only scoped services.
- [x] Implement bounded adapter and configuration without changing existing routes.
- [x] GREEN API/auth regressions.

## Task 3 — Multimodal consumer

Files: `services/worker/src/classification/{config,api,inference,analyze,runner,cli}.ts`, worker package scripts; `services/worker/tests/classification{,-runner}.test.ts`.
Interfaces: `ClassificationApi.call(command,signal)`, `analyzeClassification(claim,dir,signal): Promise<Result>`, `runClassificationOnce(deps,signal)`; continuous serial CLI with heartbeat/cleanup/shutdown.
- [x] RED real serialized source caption/frames/transcript, strict JSON and max tokens, repair/busy, heartbeat loss, complete response replay, stop/review/temp cleanup.
- [x] Implement existing extraction/workdir reuse, six-minute inference, 2048 output tokens, sanitized logs; no privileged client.
- [x] GREEN worker tests and real media fixtures.

## Task 4 — Operations, integration and review

Files: `services/worker/classification/{insta-explorer-classification.service,README.md,install.py,test_install.py}`, ADR, handoff/status/operations docs.
- [x] RED private installation/foreign state/idempotency, staged worker stays stopped; no credential logging.
- [x] Implement isolated host unit, private release/state/env, loopback inference, disabled rollout/rollback.
- [x] Real migrated PostgreSQL + media/fake inference integration; full lint/types/tests/build and Python tests.
- [x] Fresh independent branch review; fix correctness findings RED→GREEN. Record production activation as pending until authorized, with concrete deployment artifacts ready.

Inline execution under explicit user implementation authorization. `.tmp/classification/ledger.md` records task evidence/rulings. User requested implementation; routine plan execution proceeds here. Final publication is distinct and subject to repository authorization.

Production migration/deployment/activation and live provider pilot remain pending and require explicit publication authorization; they are not marked completed by this implementation plan.
