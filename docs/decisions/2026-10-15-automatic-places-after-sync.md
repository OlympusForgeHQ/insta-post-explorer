# Automatic Places after synchronization

Status: authorized by the owner on 15 October 2026; activation requires a verified release.

The owner requests Places analysis after every synchronization and improvement from
failures. This extends the separate Places service decision of 4 October. A serial
consumer of the existing Places API may run continuously alongside its existing
Hermes inference service. It has no database or bucket credentials.

## Accepted behavior

1. With `PLACES_AUTO_ENABLED=1`, only newly imported sync posts receive a durable
   admission marker. Existing posts, import replays and historical classification
   jobs do not create new automatic work.
2. Successful classification admits an eligible post in the same transaction,
   using its final category and tags. If classification is disabled, sync admits
   the post using its current category after verified media persistence.
3. Only normalized Restaurant/Voyages qualify. Owner exclusions, manual categories,
   confirmed links and deletions retain their existing protections. Inconclusive
   classification waits for review; it is never treated as a successful category.
4. The daemon claims only jobs carrying sync provenance. The existing owner lock,
   leases and idempotency key serialize manual and automatic work. It never runs
   a global enqueue. Turning the app flag off stops new sync opt-ins and automatic claims.
   Already opted-in posts may finish classification and queue durably while paused.
5. Failures are recorded in bounded, lease-fenced job result metadata. Recognized
   format/evidence failures influence the next attempt; repeated failures on
   comparable posts select fixed corrective instructions. Recent outcomes and the
   selected strategy are auditable. No generated text becomes a learned rule.
6. Existing owner-confirmed identity memory continues to resolve missing geography.
   Geographical providers still verify candidates; learning cannot invent places,
   weaken evidence validation, restore deletions or rewrite manual corrections.

## Implementation and limits

Use existing Post.metadata and PlaceAnalysisJob.result for versioned admission and
learning metadata. No schema migration, queue, provider or dependency is introduced.
An optional additive claim scope preserves compatibility with the explicit CLI.
The consumer polls at rest, processes one job at a time, backs off on service errors
and drains a bounded in-flight analysis on shutdown. Retries have a finite budget.

This is adaptive retry guidance and verified memory, not model training or an
automatic change to source code. It cannot guarantee identification of an unnamed
venue. Such results remain in review. Classification failures remain visible in
the classification queue and require its existing recovery/review path.

## Risks and rollback

Duplicate dispatch: transaction + unique owner/post/input/version key. Historical
reprocessing: explicit new-import marker + automatic claim provenance. Cross-owner
learning: owner-scoped reads and lease checks. Self-reinforcing mistakes: fixed
strategies, bounded recent window, explicit confirmed identities only. Outages:
idle/error backoff, bounded retries, no parallel inference from this consumer.

Deploy the compatible app and worker while admission is off; verify the consumer,
then enable admission and observe one new sync through classification, Places and
provider resolution. Disable new opt-ins/claims and stop the consumer to roll back; queued
jobs and their audit history remain. Do not restart the sync/classification services
or replay historical posts as part of activation.

Alternative considered: start a subprocess directly at the end of each sync.
Rejected because retries/restarts could lose dispatch or create overlapping runs,
and classification might not have finished. The transactional queue preserves work
without blocking synchronization.
