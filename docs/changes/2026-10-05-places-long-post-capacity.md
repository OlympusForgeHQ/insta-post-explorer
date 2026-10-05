# Complete long Places itineraries

**Mode:** Standard  
**Status:** Candidate capacity deployed at `bf22721` (PR #106); video-duration follow-up independently reviewed, deployment verification pending
**Owner:** Places worker

## Problem and outcome

A reviewed multi-image itinerary contains more than 50 distinct destinations.
Its OCR stages retain the later items, but fusion stops at the schema's 50-item
maximum. The worker also independently rejects any larger array. A structurally
valid truncated itinerary must not be presented as a complete analysis.

## Requirements and acceptance

- `REQ-001`: The dedicated worker contract supports up to 200 candidates per
  post. The existing caption-import contract retains its 50-candidate bound.
- `REQ-002`: Inference follows the prepared server schema instead of imposing a
  second, smaller candidate limit. A 51-candidate result survives parsing,
  geographic planning, transactional persistence and replay without lost items.
- `REQ-003`: An inference result reaching or exceeding its declared candidate capacity fails
  visibly without a compacting retry that could remove candidates. Server-side
  validation still allows a fully reviewed result of exactly 200 candidates.
- `REQ-004`: Fusion receives a bounded 32,768-token output allowance; caption and
  individual-media extraction retain their existing allowance. Provider length
  termination remains an error, never a valid partial result.
- `REQ-005`: Videos up to 900,000 ms (15 minutes) retain their full measured
  duration and valid late evidence. The previous five-minute bound rejects a
  real 454,766-ms source before analysis. Extraction, API coverage and evidence
  timestamps share the new bound; longer videos still fail visibly.
- `INV-001`: Owner isolation, leases, stale-input checks, categories, geographical
  verification, evidence validation and manual corrections remain enforced.
- `INV-002`: JSON input/output remains bounded to 512 KiB. No migration,
  dependency, scheduling change or automatic reanalysis of completed posts.

The 200-candidate limit bounds resource use while covering the observed long
itinerary. It is a capacity limit, not a promise that inference finds every place;
source review and precise geographic identity checks remain required.

## Task and test seams

One vertical task implements `REQ-001`–`REQ-004` across the worker's prepared
schema, inference client and existing persistence seam.

| Seam | Acceptance evidence |
|---|---|
| Worker contract | Above-50 results accepted; over-200 rejected; caption import unchanged |
| Hermes inference | All supplied candidates preserved; saturation fails without retry; fusion allowance |
| PostgreSQL completion | 51 distinct places, links and source proofs persisted and replayed once |
| Video extraction/contract | Real 450s/900s videos retain full coverage and final frame timestamps; 901s media and 900001ms contract values are rejected |
| Original itinerary | Full independent source inventory validated, resolved and committed after deployment |

Files: `src/lib/places/worker-contract.ts`,
`services/worker/src/places/inference.ts`, their focused tests, worker README,
implementation status and handoff. No provider category or private post data is
published. This document describes the defect without reproducing private sources.

## Risk, rollout and rollback

Larger results require more model output and database writes. The existing
deadlines, byte limits and transaction boundary remain in force. A capacity or
timeout failure is retained for review rather than silently reduced. Tests must
exercise more than 50 records against disposable PostgreSQL.

Deploy the backward-compatible server expansion before restarting the serial
worker with its matching parser. Preserve raw attempts and review checkpoints;
the affected long post has not been committed. Rollback uses the preceding app
and worker revision; larger uncommitted results remain private pending recovery.

## Verification

Red/green reproduced the 51-candidate rejection and the capacity/length retry
that could discard candidates. The independent review also reproduced an
above-capacity response being retried as a shorter list; its guard now runs
before schema validation.

- Application: 603 tests pass across 76 files, including PostgreSQL integration
  against an isolated disposable database.
- Worker: 94 tests across 13 files and three Python transcription tests pass;
  focused inference/pipeline coverage passes 13 cases.
- Lint and application/worker type checks pass; worker build passes.
- Application production build passes. Its first sandboxed attempt could not
  bind the local compiler port; the permitted local build then completed.
- Deployed original-post verification pending.
- Independent review: no remaining blocking finding.

New test file `tests/unit/places-worker-contract.test.ts` is necessary to protect
the distinct worker and caption-import limits without network or database setup.
The existing inference tests protect saturation and output termination; the
existing PostgreSQL test proves more than 50 places survive persistence/replay.
The full library review remains in progress and is not claimed complete.

The follow-up video regression first reproduced `MEDIA_LIMIT` for a real
450-second fixture and contract rejection for both duration and evidence at
454,766 ms. The duration expansion adds no truncation, frame-count increase,
dependency or migration. The 250 MiB/media, 12-frame/media and 20-minute job
limits still apply, so a long post may still fail its existing resource budget.
Follow-up verification: application 437 passed/167 DB-dependent skipped;
worker 88 passed/7 DB-dependent skipped and three Python transcription tests
passed. Lint, both type checks and both builds passed. PostgreSQL credentials
were unavailable for this follow-up. The application suite emitted its existing
jsdom canvas warning. Two unrelated LibraryExplorer search tests timed out while
the app build ran concurrently; the full suite passed when rerun alone, with no
UI changes. Independent review has no blocking findings and its 15 targeted
tests pass. Deployment verification of the video-duration follow-up remains pending.
