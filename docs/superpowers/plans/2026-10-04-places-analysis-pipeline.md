# Places analysis pipeline implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and a final independent review.

**Goal:** Connect serial Hermes analysis to verified Places writes using only Karim's five categories.
**Architecture:** Existing V1 auth and server business services own queue, resolution and persistence. A worker CLI uses signed media reads and the isolated Hermes endpoint, without DB credentials.
**Tech Stack:** Existing TypeScript/Next.js/Prisma/PostgreSQL, Node 24, FFmpeg and local faster-whisper 1.2.1 (already used in the real demonstration).
**Spec:** `docs/changes/2026-10-04-places-pipeline/spec.md`

## Global constraints

- Exact categories restaurant/cafe/patisserie/voyage/divers; never provider-derived.
- One additive evidence-enum migration; preserve owner boundaries, deletions and confirmed edits.
- 250 MiB, 300 seconds, 12 frames/video, 20 media/post, 50 candidates, 8 excerpts.
- Claims 15 minutes, heartbeat 30 seconds, 3 attempts; no unattended backfill.
- Native execution under the user's instruction to proceed. Do not insert another permission gate for already requested implementation.

## Review focus

- A provider classifies a brunch venue as fast food: the proposed cafe category wins.
- A post changes/disappears during expensive inference: no stale Places writes.
- A lease expires and another worker resumes: the old completion is rejected.
- Media/transcription fails: cleanup runs and the job does not pretend complete.
- A response is lost after commit: retries return the completed receipt, without duplication.

### Task 1: Category and multimodal result contract

Files: src/lib/places/{categories,candidates}.ts, src/server/places/{analysis,queries}.ts,
tests/unit/places-{categories,candidates,analysis-postgres,queries-postgres}.test.ts.
Produces strict candidates with the owner category and bounded multimodal evidence;
the existing importer persists classification and timestamps, never Geoapify category.

- [x] Add regression for cafe versus fast_food and valid audio/OCR evidence; observe RED.
- [x] Implement five categories, backward-compatible legacy candidate mapping, provenance and filters.
- [x] Verify targeted tests and preserve confirmed data; record evidence.

### Task 2: Scoped worker queue and atomic completion

Files: src/auth/api-key.ts; src/lib/places/worker-contract.ts;
src/server/places/{worker,worker-media}.ts; src/app/api/v1/places/worker/route.ts;
src/server/places/{analysis,repository}.ts; .env.example; API docs;
tests/unit/places-worker-{api,postgres}.test.ts.
Consumes Task 1 candidates; produces enqueue/claim/heartbeat/complete/fail operations
with input record, lease token and signed media descriptors. Model output schema
and category rules travel with the claim so the worker does not duplicate rules.

- [x] Test scope rejection and PostgreSQL lease/stale/deletion/replay behavior; observe RED.
- [x] Implement thin route, server-owned queue, signed reads and guarded atomic persistence.
- [x] Verify real transactions, no media artifacts, audit and idempotence.

### Task 3: Serial multimodal worker client

Files: services/worker/src/places/{api,config,inference,media,pipeline,cli}.ts;
services/worker/places-hermes/transcribe.py and requirements-asr.txt;
services/worker/package.json; services/worker/tests/places-pipeline.test.ts.
Consumes Task 2 claims/schema; produces strict evidence candidates for completion.
Reuse the existing temporary-directory manager and safe process/network patterns.

- [x] Test serial processing, untrusted/invalid responses, failure and abort cleanup; observe RED.
- [x] Implement caption, bounded frame OCR, local full-audio transcript and fusion via Hermes.
- [x] Add --post, --limit, --preview and explicit --commit modes; cap total work.
- [x] Verify worker types/build/tests and real FFmpeg fixtures.

### Task 4: Geographic verification, pilot and review

Files: src/server/places/resolvers/geoapify.ts; src/lib/places/scoring.ts;
tests/unit/places-{geoapify,scoring}.test.ts; operations docs; HANDOFF and status.
Retain named provider identity while checking the caption address; fix apostrophe
normalization and avoid treating an arrondissement/postcode as a house number.

- [x] Reproduce Terre d'Azur name/address issue in a focused regression; observe RED.
- [x] Implement bounded named/address resolution without merging fabricated provider data.
- [x] Run all quality gates and final independent review; address blocking findings.
- [x] Exercise the real named-post pipeline, verify Places/category/audit/cleanup and record results.
- [x] Update scope, evidence and remaining measured-batch gate before final delivery.
