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

Lease conflicts and changed/noneligible inputs are HTTP 409; missing resources
are 404; invalid output is 400. Replaying a completed request with the same lease
and payload returns its stored receipt. Unrecognized failures expose no internals.

Deployment is staged: isolated additive evidence-enum migration, application/API,
then named-post worker preview and commit. Disable the feature flag to stop new
worker requests. Keep places, evidence and the database mutation journal on
rollback. Do not replay the repository's historical production migrations.
