# Automatic Places and bounded failure learning

Spec: `docs/decisions/2026-10-15-automatic-places-after-sync.md`.
Route: Critical. Owner authorization covers implementation and activation.
Execute inline in the existing isolated worktree on `feat/automatic-places-learning`.

## Constraints

No historical backfill, new provider, schema migration or dependency. Preserve
owner/manual decisions and explicit CLI compatibility. Never claim deployment or
database verification without executing it. Keep private data out of Git.

## Task 1: Transactional admission

Files: `src/server/places/automation.ts`, `src/server/sync-post.ts`,
`src/server/classification/jobs.ts`, `src/server/places/worker.ts`,
`src/lib/places/worker-contract.ts`; existing sync/classification/Places tests.
Interface: versioned new-sync marker; optional claim scope `automatic`.
Write regression tests for new import, replay, final theme, no-place exclusion,
feature flag and historical queue isolation; observe failure, then implement.
Expected: one eligible job per new post/input, none for historical or excluded posts.

## Task 2: Failure learning

Files: `services/worker/src/places/learning.ts`, `src/server/places/learning.ts`,
`src/server/places/worker.ts`, `src/lib/places/worker-contract.ts`,
`services/worker/src/places/{api,inference,pipeline}.ts`; associated tests.
Interface: bounded learning context, fixed strategies, typed failures, persisted
job observations. Test format/evidence recovery, bounded sampling, success decay,
owner scope and stale leases before implementation.
Expected: fixed relevant guidance on the next attempt without accepting invalid
evidence; existing verified owner memory remains authoritative.

## Task 3: Independent serial consumer

Files: `services/worker/src/places/{consumer,loop}.ts`, worker package scripts,
`services/worker/places-consumer/*`; loop/pipeline tests.
Interface: automatic-only claims; abortable idle/backoff; drain active work.
Expected: empty queue consumes no inference, no broad enqueue, no concurrent jobs,
clean shutdown and finite retries. Prepare systemd template and activation runbook.

## Task 4: Verification, review and release

Files: `AGENTS.md`, `docs/{HANDOFF,IMPLEMENTATION_STATUS}.md`, this plan and spec,
worker runbooks. Run focused tests, full app/worker tests, lint, types and builds.
Expected: all executable checks pass; report unavailable database/live checks.
Independent review focuses on admission races, evidence poisoning, compatibility,
lease fencing, historical isolation and activation/rollback. Resolve findings.
Publish/deploy under standing authorization if runtime access permits; otherwise
leave a tested reviewable release and precise activation blocker.

## Evidence ledger

- Discovery: sync enqueues classification only; Places CLI currently needs explicit
  invocation. Existing verified identity memory already respects owner confirmation.
- Environment: production service activation and PostgreSQL tests must be checked
  against the current session's available access, not yesterday's privileges.

## Verification at review handoff

- New contract regression failed before implementation; learning/inference and
  consumer regressions failed on the absent behavior before implementation.
- Focused worker suite: 24 tests pass, plus 4 ASR pretests. App/worker TypeScript
  and lint pass; worker build passes. Both isolated Places and classification
  release packages import successfully. Rendered systemd unit verifies cleanly.
- Full local app suite: 516 pass, 245 database tests skip; three preflight tests
  cannot capture subprocess output because spawnSync returns EPERM. The unchanged
  develop preflight reproduces the identical error in this session.
- Full local worker suite: 179 pass, 7 DB tests skip; five health-server tests fail
  with listen EPERM. Default Next/Turbopack build is blocked by the same local port
  restriction. These are verification limitations, not passing checks.
- Independent review found no important/critical issues. Clarified pause semantics:
  turning the flag off stops new opt-ins and claims; already opted-in posts still
  queue durably after in-flight classification, so resuming does not lose work.
  PostgreSQL regression explicitly covers that transition.
- Remaining gates: CI with PostgreSQL and normal process/network capability,
  production installation/flag activation and a real new-sync receipt.
