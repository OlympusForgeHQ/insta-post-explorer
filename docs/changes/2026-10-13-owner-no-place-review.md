# Durable owner confirmation that a post has no place

The owner can mark an informational post as containing no recommended place.
`confirmPostHasNoPlace(ownerId, postId, context)` records this decision in the
existing review service. It never deletes or edits the post, its classification,
tags, original extraction, job result, existing places or links.

## Accepted scope and design

This is a bounded change to the existing Places pipeline, approved on 13 October
2026. VibeSpec route: Critical because the decision must dominate concurrent
admission and persistence. The entry gate is the already implemented owner-scoped
worker and review pipeline at `9e6b594`. No schema, dependency, deployment,
service, endpoint or UI addition is required.

The decision is a `PlaceEvidence` row with `placeId: null`, type
`USER_CORRECTION`, and metadata exactly identifying the action
`POST_NO_PLACE_CONFIRMED`, `actorType: USER`, and `actorId` equal to `ownerId`.
The bounded review context remains mandatory. MCP, system, admin and another
owner's actor cannot issue this decision. A previous owner-scoped analysis job
must exist to carry the proof; otherwise the operation fails atomically with
`PLACE_REVIEW_AUDIT_CONTEXT_MISSING`.

The transaction locks the owner-owned post first. It inserts the correction only
once and cancels pending, processing and review jobs with
`errorCode: OWNER_NO_PLACE_REVIEW`. Lease and retry fields are cleared; result
JSON and automatic evidence are preserved. Successful historical jobs remain
successful. The existing database audit journal receives the transaction-local
action `places.review.post_no_place`.

## Admission, concurrency and compatibility

Worker input preparation, metadata job admission, metadata analysis, preview,
recovery and completion check the durable evidence independently of the input
hash or analysis version. A changed caption, theme or version cannot bypass it.
Bulk enqueue skips the post. Claim cancels an excluded queued job without issuing
a lease. Cached completion and recovery receipts cannot bypass the decision.

Admission and persistence use the same post-before-job lock order as owner review.
Claim's exhausted-attempt cleanup now happens under each post lock, avoiding a
jobs-before-post inversion. Persistence checks before deleting automatic evidence
or writing places, links, evidence or a result. Metadata failure handling cannot
change a concurrently cancelled job back to failed. Provider calls stay outside
transactions; an owner decision made during a call wins at the final gate.
Previews and dry runs also recheck before returning their plan.

The existing worker API error `POST_NOT_PLACES_ELIGIBLE` remains a 409. The
metadata importer also receives that stable code rather than a generic error; no new
external mutation route or scope is introduced. Classification, display of prior
links, theme counts, and source results retain their existing meaning. An excluded
post must be reported separately from a successfully resolved place.

## Acceptance and proof matrix

| Requirement | Executable proof |
| --- | --- |
| Only the owning user's explicit action excludes a post | PostgreSQL worker test: owner-authored correction; invalid MCP/system/foreign actors |
| Atomic and idempotent review preserves source and domain data | Concurrent confirmations; exact before/after post, links, automatic evidence and result comparisons |
| Changed inputs and versions cannot re-enable admission | Changed caption/theme plus new metadata analysis version |
| Review wins while provider work is in flight | Completion, preview, metadata persistence and contextual recovery with review during resolver execution |
| Cached receipts and direct persistence cannot bypass review | Completed recovery replay and direct persistence tests |
| Admission uses consistent serialization | Real concurrent confirmation, worker enqueue, metadata admission and claim |

All tests are added to the existing `tests/unit/places-worker-postgres.test.ts`:
this exercises the service boundaries with real PostgreSQL transactions and no
provider network access. No additional test file is introduced.

The initial focused regression failed because preparation accepted an existing
owner exclusion; after the guard it passed. The adjacent PostgreSQL suites
(worker, jobs, analysis and review) passed 78 tests before the final two
concurrency/recovery cases; the final focused worker suite passed all 19 tests.
Final integrated verification:

- `npm run lint` and `npm run typecheck`: passed.
- `npm test -- --maxWorkers=4`: 739 tests in 96 files passed with PostgreSQL.
- `npm run build`: production Turbopack build passed on the exact final code.
- Independent review found no remaining concrete blocker in authorization,
  locking, idempotence or source preservation.

The importer regression reproduced a generic error before the stable eligibility
code was added; the final full suite verifies that correction. The isolated
worker tests use a real disposable database and no provider network access.

## Risks and rollback

The decision has no automatic expiry or reset, by design. Internal maintenance
must use the same validated evidence when distinguishing ignored posts from
resolved recommendations. An older application version does not understand the
marker, so rolling back code alone loses enforcement: pause Places processing
until the guard is restored, and retain the evidence and source history. Existing
places and links are not removed even if a post is subsequently excluded.

No production database operation, publication or deployment is part of this
change. Release and an actual owner correction remain separate authorized actions.
