# Independent post classification worker

Status: accepted by owner on 5 October 2026; implementation authorized, production publication pending.

The owner requested classification of every newly synchronized Instagram post by
DeepSeek, with one existing category and 3–5 contextual tags, reusing tags and
creating them when necessary. The owner explicitly requested an independent
worker called by synchronization. This decision authorizes that additional host
consumer beyond the two services documented on 4 October.

The synchronization transaction creates a classification job after persisting
verified media. It returns without waiting for inference. The independent
`insta-explorer-classification.service` claims those jobs through the existing
application `/api/v1`, using a separate scoped key. It shares the existing private
Hermes inference runtime and uses the existing FFmpeg/Whisper extraction code.
No second Hermes profile, MCP, database, storage, auth system or provider is added.

Business logic and writes remain in `src/server`. The worker has no database or
R2 credentials. Signed media links are short lived and owner-scoped. A dedicated
additive table provides transactional enqueue, claim/lease, heartbeat, bounded
retries, input fingerprint fencing, replay receipts and retained deletion history.
The manually enforced composite owner/post foreign key supplements Prisma's
scalar nullable relation; keep that constraint when generating future migrations.

Only new successful sync imports enqueue work while explicitly enabled. Existing
posts, manual deletions and the completed Places review are outside this change.
Changing a source/category/tag during inference cancels that classification.
Global manual tag rename/merge/delete operations share the owner write gate;
their latest audit revision fences pending/in-flight classification so it cannot
recreate a manually removed catalog tag. Automatic tag creation does not change
this revision and therefore does not cancel other newly queued posts.
Manual tag links survive completion; the 3–5 requirement applies to automatic
tags and may coexist with additional manual tags. Insufficient context becomes
`NEEDS_REVIEW` without overwriting the provisional category/tags.

Rollout is disabled by default: migrate and deploy the application, stage the
independent unit, run the restricted pilot, then enable new-import consumption.
Publication requires the repository's explicit authorization. Stopping the unit
and disabling the flag provide rollback without deleting classification history.
See [operations](../../services/worker/classification/README.md).
