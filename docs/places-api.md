# Places read API and review services (Phase F3)

Phase F3 completes the metadata-first Places backend: a read-only external API,
distinct statistics, and internal review/merge services. No UI, map, worker,
video/OCR/transcription, MCP, or Hermes integration is part of F3.

## 1. Authentication and security

All `/api/v1/places*` routes reuse the Phase D external Bearer key
(`Authorization: Bearer ipe_<secret>`, `requireExternalApiKey`). The key is
**read-only**: no route mutates data, and every route exposes only `GET`.
Responses carry the V1 security headers (`Cache-Control: private, no-store`,
`Vary: Authorization`). Missing/invalid key → `401`; unconfigured API → `503`.
Every query is owner-scoped; a resource owned by someone else behaves as absent
(`404`), never confirming its existence.

Errors use the stable V1 contract `{ "error": { "code", "message" } }`:

| Situation | HTTP | code |
| --- | --- | --- |
| Missing/invalid key | 401 | UNAUTHORIZED |
| API not configured | 503 | SERVICE_UNAVAILABLE |
| Invalid params / invalid cursor | 400 | BAD_REQUEST |
| Resource absent for owner | 404 | NOT_FOUND |
| Unexpected | 500 | INTERNAL_ERROR |

## 2. Endpoints

```text
GET /api/v1/places
GET /api/v1/places/{id}
GET /api/v1/places/{id}/posts
GET /api/v1/places/stats
GET /api/v1/places/eligible-posts
GET /api/v1/places/unresolved
GET /api/v1/places/analysis-jobs/{id}
```

### GET /api/v1/places

Owner-scoped, cursor-paginated list ordered `updatedAt DESC, id DESC`.

By default, only active Places are returned: non-rejected and linked to at least
one owner-owned post, or manually confirmed (`isUserConfirmed` or legacy
`reviewStatus=CONFIRMED`). A linked post's current theme does not affect this
default visibility. An explicit `review_status` filter includes historical
unlinked Places of that status. Detail and evidence access remains owner-scoped
and is not restricted to active Places.

Query parameters:

| Param | Meaning |
| --- | --- |
| `cursor` | Opaque F1 cursor from a previous `nextCursor`. |
| `limit` | 1–100, default 50. |
| `country_code` | ISO-2 country filter. |
| `continent_code` | Continent filter (AF/AN/AS/EU/NA/OC/SA). |
| `review_status` | UNREVIEWED / CONFIRMED / REJECTED / CONFLICT. |
| `precision` | EXACT / PROBABLE / APPROXIMATE. |
| `city`, `category` | Case-insensitive equality. |
| `categories` | Comma-separated place-type groups (multi-select): `restaurant`, `cafe`, `patisserie`, `bar`, `hotel`, `plage`, `monument`. Matches provider categories by group prefix; unknown keys are dropped. |
| `source_theme` | `Voyages` or `Restaurant` after the shared normalization; restricts to places linked to at least one post of that theme (never a collection join). |
| `min_confidence` | 0–1 lower bound. |
| `q` | Text search on display name, normalized name, and city. |

`categories` and `source_theme` were added additively in Phase G; the historical
single `category` filter and every existing response shape are unchanged.

Response:

```json
{ "items": [ { "id": "...", "displayName": "...", "postCount": 3, "precision": "EXACT", "reviewStatus": "UNREVIEWED", "updatedAt": "2026-07-24T00:00:00.000Z" } ], "nextCursor": null }
```

`bbox`/`nearby` remain intentionally deferred: the owner capped Places at under
~1000 active places, so the Phase G map loads the owner-scoped active set and
filters it in the browser instead of querying by viewport. The `source_theme`
list filter, deferred in F3, shipped in Phase G (see above).
Inactive and rejected Places are excluded before the map's 1,000-place cap.

### GET /api/v1/places/{id}

Full detail for one place: canonical identity, coordinates, precision,
confidence, city/region/country/continent, review status, `postCount`,
non-sensitive provider metadata (`provider`, `providerResultType`,
`attribution`), and a bounded list (≤20) of recent evidence. Never returns the
Geoapify key, OAuth data, or raw provider payloads. `404` when absent.

### GET /api/v1/places/{id}/posts

Cursor-paginated posts linked to a place (`postId`, `postUrl`, `thumbnailUrl`,
`authorUsername`, `mainTheme`, `isPrimary`, `precision`, `confidence`,
`linkedAt`). `404` when the place is absent for the owner.

### GET /api/v1/places/stats

Distinct statistics (see §3). Accepts `country_code`, `continent_code`,
`precision` filters on the place-scoped aggregations.

### GET /api/v1/places/eligible-posts

Cursor-paginated eligible posts (theme `Voyages`/`Restaurant`) with **no** place
link yet — the unanalyzed backlog. No collection is consulted.

### GET /api/v1/places/unresolved

Cursor-paginated analysis jobs in `NEEDS_REVIEW` (the UNKNOWN outcomes).

### GET /api/v1/places/analysis-jobs/{id}

One job's safe fields (status, stage, depth, source theme, analysis version,
attempt count, bounded `errorCode`, structured `result`, timestamps). The raw
`errorMessage` is never exposed.

## 3. Statistics semantics

```json
{
  "totals": { "eligiblePosts": 0, "identifiedPlaces": 0, "countries": 0, "continents": 0, "postsWithPlaces": 0, "needsReview": 0 },
  "byTheme": [], "byCountry": [], "byContinent": [], "byPrecision": [], "byReviewStatus": []
}
```

- `identifiedPlaces`: distinct active canonical places excluding `REJECTED`.
  Place-scoped aggregations require an owner-owned post link or manual/legacy
  confirmation, as for the default list. The review-status breakdown preserves
  rejected linked/confirmed Places; historical analysis-job counters are unchanged.
- `countries` / `continents`: distinct codes among identified places.
- `postsWithPlaces`: distinct posts linked to an identified place (a post linked
  to several places counts once).
- `needsReview`: `NEEDS_REVIEW` jobs (UNKNOWN outcomes) plus `CONFLICT` places.
- `eligiblePosts`: eligible posts under the shared theme predicate.
- Breakdowns use distinct place and distinct post counts; multiple evidence rows
  never inflate a count, and `CollectionPost` is never joined.

## 4. Internal review and merge services

`src/server/places/review.ts` exposes service-only mutations — **never** wired to
the read-only external API and reserved for a future authenticated admin UI or
scoped MCP command. Each takes a validated `context = { actor, reason }`:

- `confirmPlace(ownerId, placeId, context)` — mark CONFIRMED and user-confirmed.
- `rejectPlaceResult(ownerId, placeId, context)` — mark REJECTED durably
  (`isUserConfirmed`) without deleting links or evidence.
- `correctPostPlace(ownerId, { postId, placeId, isPrimary? }, context)` — mark a
  link user-confirmed, optionally set the single primary, and record a bounded
  `USER_CORRECTION` evidence row.
- `mergePlaces(ownerId, { sourcePlaceId, targetPlaceId }, context)` —
  transactional merge: move/dedup links, re-point evidence, preserve user
  corrections, keep one primary per post, delete the source, roll back on failure.

A user correction dominates automatic re-analysis (enforced by the F2 analysis
service, which never overwrites user-confirmed places or links). Every method is
owner-scoped; a cross-owner resource behaves as `PLACE_NOT_FOUND`.

### Auditable actions and complete audit context

Every human action is auditable and the audit is **all-or-nothing**. An action
persists a bounded `USER_CORRECTION` evidence row — the action and actor identity
in `metadata`, the reason in the `excerpt`, `confidence = 1` — in the **same
transaction** as the mutation. A `PlaceEvidence` row structurally requires a
non-null `postId` **and** `analysisJobId`, so a proof exists only when the
affected post resolves to an analysis job.

Before any mutation, every affected post must resolve to exactly one job — its
link's own `analysisJobId` (only after validation, see below), otherwise the
latest owner-scoped job for that post. If **any** affected post cannot be
resolved, the whole action fails with `PLACE_REVIEW_AUDIT_CONTEXT_MISSING` and
**nothing** is written; a partial or empty audit trail is never left behind:

- `confirmPlace` / `rejectPlaceResult`: every post linked to the place. A place
  with no links has nothing to audit and is refused.
- `correctPostPlace`: the single corrected post.
- `mergePlaces`: every post linked to the **source**. Exactly one audit row is
  written per distinct affected post (audit rows == distinct affected posts), so a
  partially auditable merge never mutates. A **link-free merge** (a source with no
  links) is refused before any write, so the source is never deleted without a
  recorded proof — stray evidence with no link does not count as a link-level
  audit context. Merging an orphan (linkless) place would require a valid audit
  context or a future explicit evolution of the audit model; it is out of scope
  for F3.

A job id carried by a link is **never trusted on its own**. Before it can carry a
proof it must be validated as an exact `(jobId, ownerId, postId)` match against
`place_analysis_jobs`:

- a job of another owner is ignored;
- a job of another post is ignored;
- an ignored direct job never blocks a valid fallback — the resolver then uses the
  latest owner-scoped job for that post;
- if neither a valid direct job nor a valid owner-scoped fallback exists, the
  action fails with `PLACE_REVIEW_AUDIT_CONTEXT_MISSING`;
- when several links of the same post carry different jobs, the first valid one in
  a stable order is chosen (deterministic), then the latest owner-scoped job.

The composite foreign keys `post_places_owner_post_job_fkey` and
`place_evidence_owner_post_job_fkey` already bind `(owner_id, post_id,
analysis_job_id)` to the same owner and post at the database level, so a coherent
schema cannot store a cross-owner or cross-post link job. This validation is
defense-in-depth for legacy or imported rows predating that constraint, and it
turns such a row into a clean refusal or a valid fallback instead of a raw
foreign-key failure. `writeAuditEvidence` keeps a final structural check so a
proof is never created from an unvalidated job id.

Validation and audit codes never carry a post id, job id, actor id, or reason: an
invalid `context` fails with `INVALID_REVIEW_CONTEXT`, a missing or invalid audit
context with `PLACE_REVIEW_AUDIT_CONTEXT_MISSING`, and the thrown message is the
stable code only.

### Merge review-state resolution

`mergePlaces` never loses a durable user decision carried by either place. The
target's review state is recomputed from both sides with a deterministic,
commutative policy (`resolveMergedPlaceReviewState`) inside the same transaction
as the source deletion:

- `isUserConfirmed` is preserved as a logical OR — true when **either** place was
  confirmed or corrected by the user, so F2 automatic re-analysis can no longer
  overwrite the merged canonical place;
- `CONFIRMED` dominates `UNREVIEWED` (a confirmation is never silently downgraded);
- `REJECTED` dominates `UNREVIEWED` only when no confirmation is involved;
- a confirmation-versus-rejection contradiction becomes `CONFLICT` (the user
  confirmation is still retained via `isUserConfirmed`);
- `CONFLICT` dominates every automatic or ambiguous state and is never downgraded.

| source \ target | UNREVIEWED | CONFIRMED | REJECTED | CONFLICT |
| --- | --- | --- | --- | --- |
| **UNREVIEWED** | UNREVIEWED | CONFIRMED | REJECTED | CONFLICT |
| **CONFIRMED** | CONFIRMED | CONFIRMED | CONFLICT | CONFLICT |
| **REJECTED** | REJECTED | CONFLICT | REJECTED | CONFLICT |
| **CONFLICT** | CONFLICT | CONFLICT | CONFLICT | CONFLICT |

The target update and the source deletion share the merge transaction: any
failure rolls both back, leaving the source present and the target untouched.
