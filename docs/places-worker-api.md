# Places worker API

`POST /api/v1/places/worker` reuses V1 Bearer authentication with the dedicated
`PLACES_WORKER_API_KEY_SHA256` scope. `PLACES_WORKER_ENABLED=1` enables it. Read and
Instagram sync keys are rejected. Owner identity is server configured, never
accepted from a body. Replies use private/no-store headers; bodies are at most
512 KiB. No credentials, media payloads or signed URLs belong in logs.

Commands are strict JSON with an `action` field:

- `prepare`: `postId`. Read-only pilot input, current hash, rules/output schema and
  GET-only signed media URLs. Does not create a job.
- `enqueue`: optional `postId`, otherwise optional `cursor`. At most 100 source
  posts/page, only eligible themes, idempotent current-input DEEP jobs. Returns
  `queued` and `nextCursor`. No model is called.
- `claim`: optional `postId`. Returns one job, random lease token and prepared
  input, or null. One live job per owner; expired leases are reclaimable.
- `heartbeat`: `jobId`, `leaseToken`. Extends an unexpired claim.
- `complete`: `jobId`, `leaseToken`, `result`. Validates strict candidates, media
  coverage and evidence; resolves geographically; locks and rechecks the current
  input and lease; persists atomically with audit action `places.worker.complete`.
- `preview`: `postId`, `inputHash`, `result`. Same validation/resolution, no writes.
- `fail`: `jobId`, `leaseToken`, bounded `code`. Transient failures retry within
  three attempts; invalid/oversized media or invalid output fail visibly.

The claim supplies the model JSON schema and owner category rules. The worker
must not propose coordinates, provider IDs or provider categories. Completion
requires the exact model ID and bounded token/time metrics, full media coverage,
and timestamped audio/OCR evidence referencing a media ID from this post.
Video duration and evidence timestamps are bounded to 900,000 ms (15 minutes).
Evidence must also remain within that media's actual duration. The worker keeps
the full measured timeline and samples at most 12 real frames; longer videos
fail with `MEDIA_LIMIT` rather than being truncated to fit.

Lease conflicts and changed/noneligible inputs are HTTP 409; missing resources
are 404; invalid output is 400. Replaying a completed request with the same lease
and payload returns its stored receipt. Unrecognized failures expose no internals.

Deployment is staged: isolated additive evidence-enum migration, application/API,
then named-post worker preview and commit. Disable the feature flag to stop new
worker requests. Keep places, evidence and the database mutation journal on
rollback. Do not replay the repository's historical production migrations.

## Contextual resolution and bounded recovery

`prepare.categoryRules` includes contextual geography instructions for existing
worker clients. `inferredFields` marks inferred city/country/region; evidence stays
literal. Canonical memory is owner-isolated and requires identity confirmation.
Manual rejections and deleted associations are retained across provider changes.

When `GOOGLE_PLACES_API_KEY` is configured server-side, worker resolution uses
Google Places Text Search only after Geoapify has no acceptable identity. Requests
are bounded to five responses, 15 seconds and 512 KB. Only Google IDs and locations
are requested; locations remain request-local retrieval hints. The resolver
re-queries Geoapify with a proximity bias and validates every result against the
unchanged source candidate, within 100 metres of a hint. Only independently
retrieved Geoapify fields/coordinates can reach persistence or confirmed memory.
If geocoding yields no acceptable business identity, a named Geoapify Places
lookup searches within 200 metres (maximum 20 POIs); the final 100-metre gate
still applies. Generic venue descriptors may be omitted from an otherwise exact
distinctive name, but incompatible explicit business types remain conflicts.
Provider reference: https://apidocs.geoapify.com/docs/places/.
Recovery receipts include the resolution-policy version in their identity, so a
new policy can revisit old refusals without replaying writes for the same policy.
The normal limit is three contextual recovery jobs per post. Policy
`structured-identity-v3` permits one additional recovery after three older-policy
jobs, with an absolute maximum of four. Same-policy attempts cannot repeatedly
claim that extra slot; exhausted requests are rejected before provider calls.
Google-only results stay unresolved; Google payloads are never journaled. `PLACES_GOOGLE_MONTHLY_CAP` defaults
to 4000 (maximum 4000). Migration of prior usage uses
`PLACES_GOOGLE_BASELINE_MONTH=YYYY-MM` and `PLACES_GOOGLE_BASELINE_REQUESTS`.
UTC and Pacific month windows are both enforced, preserving the prior guard.
Reservations are serialized per owner and recorded in append-only audit before
spending; failed calls consume budget and deletion/restarts cannot refund it.
Dry runs also consume provider quota. Operators should bound each recovery run.
Temporary Google 429/503 responses receive at most three attempts, each reserved
against quota. Retry-After is respected; delays above 60 seconds are returned to
the caller without an early retry. Without it, waits are 15 and 30 seconds.

Authenticated action `recover` accepts `postId`, `sourceJobId`, `inputHash`, the
server-accepted `originalResult`, zero-based `sourceCandidateIndices`, enriched
`result`, and `commit` (default false). It verifies the original completion hash,
owner, current input hash, all unresolved identities and media coverage. It cannot
omit an unresolved candidate or replace an asserted identity/geography/address.
Explicitly separated complete branch addresses may be split; missing geography
must be marked inferred. Evidence and categories remain unchanged.

Committed recovery is additive, idempotent per policy and payload, and subject to
the bounded recovery allowance above. Existing canonicals/links/primary associations are preserved;
active leases and stale inputs block writes. Every recovery stores its source job,
indices, decisions and receipt. Reports and original payloads remain private.

Policy `structured-identity-v3` retains provider street/number and postal locality
components for identity checks. Complete street segments must agree; different
unit numbers, occupants or countries remain conflicts. A narrow exact structured
identity can remain PROBABLE despite zero global query confidence, preserving the
raw provider rank and decision reason. Explicit multi-address recommendations
enumerate verified city branches internally without changing source evidence;
saturated city-result pages are rejected before filtering.

Owner-approved country-only travel recommendations resolve as APPROXIMATE zones
when country identity, provider bounds and a full country match agree. They never
substitute for an unidentified business or a more specific destination. The radius
is a conservative display zone, not a political boundary. See
[scope and verification](changes/2026-10-13-places-structured-evidence.md).
