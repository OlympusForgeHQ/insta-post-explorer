# Verified worker learning

**Mode:** Critical  
**Status:** Authorized by owner: integrate the proposed learning process, finish autonomously.  
**Owner:** Insta Explorer owner

## Problem and outcomes

The worker retries errors but cannot retrieve verified prior corrections or measure
its recovery choices across jobs. Existing protected tags include historical imports
and cannot be treated as human-reviewed training labels. Model success is not proof
of semantic correctness.

OUT-001: Future sync jobs automatically receive relevant, current, owner-scoped
verified examples; manual tag edits automatically feed memory. OUT-002: Every new
worker attempt records bounded, content-free diagnostics and recovery outcomes.
OUT-003: The same worker reports aggregate learning quality/cost/duration while idle.

## Requirements

- REQ-001: Persist verified examples and attempt observations in the existing
  PostgreSQL database, accessed only by server services. Additive migration only;
  no new provider, worker, database, embedding service or model training.
- REQ-002: Only authenticated manual corrections may create semantic examples.
  Existing manual/imported tags and successful model outputs are not auto-approved.
  Manual add/remove tag actions record positive/negative feedback. An authenticated
  review endpoint records explicit classification or translation corrections and
  supports revocation; records carry current content identity and provenance.
- REQ-003: Retrieve at most three relevant examples, same owner/domain, from at most
  200 recent candidates. Exclude the target itself, deleted/stale sources and invalid
  catalog labels. Require meaningful lexical overlap; author identity alone never
  transfers labels. Bound each source to 1200 characters and total examples to 8000.
  Examples are untrusted data, never instructions or authoritative target labels.
- REQ-004: Capture normalized error families, recovery strategy, example IDs,
  elapsed time and token use once per lease. No raw caption, provider response,
  reason prose, credentials or lease token in observations/logs. Completion replay
  is idempotent; stale/wrong-owner leases cannot write memory.
- REQ-005: Adapt only among shipped, regression-tested recovery strategies. Recent
  same-shape source-fidelity failures may select indexed spans immediately at the
  exact fallback; format failures supply explicit format guidance. Busy/transport,
  media failures and semantic uncertainty remain distinct; existing budgets apply.
  Never generate, execute or deploy new code/prompts from post contents.
- REQ-006: Evaluate daily while idle, using latest attempts per job plus separate
  attempt-error counts, review/correction evidence, durations and tokens. Semantic
  accuracy is unknown without verified labels. Missing/insufficient data is visible.
  No background LLM evaluation charges; deterministic regression corpus runs in CI.
- REQ-007: Preserve human category decisions, protected tags, removed tags on their
  source post, original captions, post deletion suppression and Places records.
  A reviewed example is retractable and ceases to be retrieved after source changes.

## Compatibility and rollout

Add optional learning fields to existing private worker contracts; old consumers
remain accepted. New worker feature flag requests learning only after web migration
and compatible API activation. New tables use owner-consistent foreign keys and
cascades. Completion receipts cover diagnostics as well as output. Existing jobs
are not requeued and historical successful posts are not reanalysed.

Stage web/schema then worker after graceful drain. Capture protected fingerprints,
verify schema and synthetic end-to-end flow, restore deployment controls, check
health. Rollback disables learning and restores prior immutable worker; additive
schema remains harmless. Do not drop tables in rollback.

## Architecture and alternatives

Dedicated small example/observation tables provide explicit provenance and efficient
bounded reads. Reusing generic audit JSON alone was rejected: tag edits currently
lack precise actions and model-produced history is not semantic ground truth.
Use lexical retrieval first; embeddings and a second agent would add unmeasured
cost. Existing audit events remain the operational journal; new writes are audited.
Manual review updates use the existing post write lock and owner scope. Worker
recovery options are typed data governed by existing validators.

## Acceptance and test seams

AC-001: PostgreSQL tests prove manual feedback capture, revocation, cross-owner
rejection, deletion/source invalidation, preservation and transactional replay.
AC-002: Pure retrieval tests prove relevance, caps, no author-only matching and no
blind copying of categories/tags/translation.
AC-003: Worker transport tests prove examples arrive as untrusted data, invalid
outputs remain rejected, source-fidelity strategy reduces repeated source echo
requests, and diagnostics have no private text.
AC-004: Runtime-loop tests prove daily idle evaluation does not interrupt owned
work or block draining and failures do not stop normal sync processing.
AC-005: Full app/worker tests, lint, types/build, independent review, migration
trial, synthetic pipeline and production preservation/health evidence.

## Risks and limits

Similar captions can describe different media: examples are hints, current complete
media evidence and existing coverage gates remain authoritative. Learning starts
with verified corrections, not fabricated historical ground truth. Daily metrics
measure observed outcomes, not unverified semantic accuracy. No self-deployment or
unbounded retry. No historical batch restart, no public raw-caption memory endpoint.

## Verification evidence

The application suite passed 674 tests with two concurrent test workers; the final
review/API-specific suite passed 8 tests (including two newly added API tests).
The worker suite passed 178 tests, plus four ASR Python tests and two classifier
installer tests. Web/worker builds, both TypeScript checks and lint passed.
Synthetic inference verifies example separation and direct indexed-span recovery
without provider calls. PostgreSQL tests cover tenant/source isolation, stale
failures, idempotent observations, imports, revocation and persistent removals.
Independent review findings were fixed, including inverse correction ordering.

No pre-existing tags or model outcomes are automatically seeded. Initial semantic
memory is empty until explicit feedback arrives. Semantic accuracy and strategy
effectiveness remain unmeasured until verified evaluation data accumulates.

Production migration history contains historical omissions; deployment must apply
only this additive migration, preserving existing migration receipts. Use a verified
private PostgreSQL 17 backup and retain before/after source/protection digests.

During publication, GitHub CI failed twice before checkout because Docker Hub
rejected the PostgreSQL service image with unauthenticated pull-rate limits.
Both CI services now use the Docker Official Image published on ECR Public
(`public.ecr.aws/docker/library/postgres:16-alpine`), preserving PostgreSQL 16
and every validation gate. Docker documents this distribution at
https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/.
The exact application commit subsequently passed 676 application tests locally.
