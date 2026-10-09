# Verified worker learning implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. The owner authorized autonomous implementation; execute inline, with an independent whole-branch review.

**Goal:** Let future sync jobs reuse verified corrections and evaluated recovery strategies.
**Architecture:** Owner-scoped examples and observations in existing PostgreSQL; private worker API supplies bounded memory, the worker records typed outcomes, manual services supply trusted feedback. Existing validators and queues remain authoritative.
**Tech Stack:** TypeScript/Zod, Prisma/PostgreSQL, existing Next.js APIs and Node worker.
**Spec:** docs/changes/worker-learning/spec.md

## Global Constraints

No new provider/service/dependency. No historical reanalysis. Preserve manual categories/tags/deletions, captions and Places. Three examples maximum; 200 candidates; 1200 characters/source; 8000 characters total. Existing call/time/token budgets remain. No raw text in observations. Shipped policies only.

## Review Focus

- A deleted or edited example cannot teach another post: Task 2 database/retrieval tests.
- A successful model answer or imported manual flag cannot become verified memory: Task 2 provenance tests.
- Completion retry or stale lease cannot duplicate/poison learning: Task 4 lease/replay tests.
- A post or example with instructions cannot alter trusted prompt or validators: Task 3 transport tests.
- Idle evaluation cannot interrupt owned work or delay shutdown indefinitely: Task 5 loop tests.

### Task 1: Contracts, persistence and pure selection

Files: services/worker/src/classification/learning.ts; prisma/schema.prisma; prisma/migrations/*_worker_learning/migration.sql; services/worker/tests/learning.test.ts.
Interfaces: learningContextSchema, learningReportSchema, failureFamily(), selectExamples(), captionShape(); models WorkerLearningExample and WorkerLearningObservation.
- [x] Write and run failing tests for relevance/limits and content-free error classification.
- [x] Implement typed bounded contracts and lexical selection; additive tables with owner foreign keys.
- [x] Generate Prisma, apply migration only to disposable database, run pure/database tests.

### Task 2: Verified manual corrections and server memory

Files: src/server/classification/learning.ts; src/server/admin-library.ts; src/app/api/posts/[id]/learning/route.ts; tests/unit/worker-learning-postgres.test.ts; tests/unit/worker-learning-api.test.ts.
Interfaces: recordTagFeedback(tx,ownerId,postId,tag,operation); reviewWorkerLearning(ownerId,postId,input); revokeWorkerLearning(ownerId,postId,domain); loadLearningContext(tx,ownerId,postId,domain).
- [x] Failing tests cover automatic manual-tag capture, authenticated explicit reviews, source/owner/deletion gates and revocation.
- [x] Implement transactional feedback, current-content identity and bounded verified-example retrieval.
- [x] Run tests; preserve corrections on source post and reject historical inferred provenance.

### Task 3: Worker memory consumption and bounded recovery

Files: services/worker/src/classification/{api,inference,analyze,translation-inference,translation-context,translation-runner,runner,cli}.ts; existing focused worker tests.
Interfaces: optional LearningContext on claims; per-attempt LearningTracker; reports supplied separately from model output.
- [x] Failing transport tests prove examples and format guidance reach inference as data, rejected outputs stay rejected, indexed fallback avoids repeated echo when chosen.
- [x] Integrate optional memory and tracker without changing default behavior/budgets.
- [x] Run focused regression suite.

### Task 4: API claim/complete/fail persistence

Files: src/server/classification/{jobs,translation-jobs,inputs,learning}.ts; src/lib/classification/{contract,translation}.ts; private worker route adapters; database flow tests.
Interfaces: optional learning claim opt-in and optional learning report on complete/fail; recordLearningObservation() called only inside validated lease transaction.
- [x] Failing tests cover wrong owner, stale lease, duplicate completion, report bounds and protected-state consistency.
- [x] Load memory on opted-in claim, atomically store observations on terminal/retry outcomes, preserve old consumers.
- [x] Run end-to-end synthetic sync/claim/inference/complete path against disposable PostgreSQL.

### Task 5: Daily evaluation and operator visibility

Files: src/server/classification/learning-evaluation.ts; src/app/api/v1/classification/learning/route.ts; services/worker/src/classification/{loop,cli,learning-evaluation}.ts; tests for evaluation and loop scheduling.
Interfaces: getLearningEvaluation(ownerId), optional evaluate callback while idle once per 24h.
- [x] Failing tests cover latest-job outcome versus retry counts, insufficient data, privacy, bounded calls and shutdown.
- [x] Implement authenticated aggregate evaluation and daily idle report; no new model call.
- [x] Run focused and full verification; update operations docs.

### Task 6: Review and activation

Files: docs/changes/worker-learning/{verification,operations}.md; docs/HANDOFF.md; private execution receipts outside tracked source.
- [ ] Run lint, typecheck, full app and worker tests, app/worker builds and migration trial.
- [ ] Independent review; fix blockers with regression evidence.
- [ ] Publish reviewed PRs, require green CI, stage compatible web/schema and immutable worker.
- [ ] Controlled rollout with protected fingerprints, synthetic smoke, health and rollback checks; no requeue of old posts.
