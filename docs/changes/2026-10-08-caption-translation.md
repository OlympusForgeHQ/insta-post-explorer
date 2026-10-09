# French translations of foreign Instagram captions

**Mode:** Critical
**Status:** Scope authorized; implementation in progress
**Owner:** Application owner, 8 October conversation (existing and future posts)

## Problem and outcomes

Descriptions in languages other than French or English are difficult for the
owner to read. The existing DeepSeek service should translate them automatically,
including the historical library, without rerunning media/category/tag analysis.

- `OUT-001`: Foreign prose has a readable French translation in the library.
- `OUT-002`: Original text and all existing classification work remain intact.

## Functional requirements

- `REQ-001`: Detect prose languages and translate foreign passages to French.
  French/English captions and passages remain unchanged. Names, URLs, mentions,
  hashtags, numbers, emoji and meaningful line breaks are preserved. Content
  without linguistic prose needs no translation; uncertain detection stays explicit.
- `REQ-002`: Keep `Post.caption` byte-for-byte unchanged. Store a separate result
  tied to the owner, post and complete source-caption hash. Never display stale
  translations. Show French by default on cards/detail with access to the original.
- `REQ-003`: Enqueue new/changed captions transactionally on imports, including
  sync. Identical reimports reuse the result and do not reset failures/attempts.
  Admit historical captions once through an audited operator action.
- `REQ-004`: Reuse the existing independent consumer, API credential, Hermes model
  and durable leased jobs. No additional service, provider, dependency or migration.
  Translation is text-only and never replays completed multimodal classifications.
- `REQ-005`: Preserve owned leases, heartbeat, bounded retries, completion replay,
  source/deletion fencing and auditable results. A changed caption revokes an old
  translation lease; tags/themes/manual edits alone do not invalidate translations.
- `REQ-006`: Classification takes priority; translation runs when its claim finds
  no classification available. Existing backlog therefore finishes first, then
  the caption backlog drains. Future imports still classify and translate serially.
- `REQ-007`: Original classification counters filter their analysis version;
  translation counts distinguish translated, unchanged, review and failed results.

## Non-functional requirements

- `NFR-001`: Bound caption input to the existing 100,000-character contract;
  process long text in bounded chunks, never silently truncate it. Invalid copies
  retry with smaller chunks down to 500 characters, bounded to 100 provider calls
  and the overall 15-minute job deadline. Provider output
  and elapsed time are bounded; no incomplete translation is published.
- `NFR-002`: One owned job at a time and no media download/transcription for captions.
  An empty queue retains its existing 15-second wait; successful work advances.
- `NFR-003`: No caption or translation in worker logs; only IDs, language, status,
  usage and duration. Display text as escaped text, never HTML.

## Invariants and architecture

- `INV-001`: Captions, Post.updatedAt, categories, tags, Places and deletions are
  not modified by translation completion. This also preserves active classification
  input hashes, which currently include caption and Post.updatedAt.
- `INV-002`: `PostClassificationJob.analysisVersion` explicitly discriminates
  `post-classification-v1` and `caption-translation-v1`. Both use the existing
  owner/post/version idempotency key and audit triggers; their result contracts,
  claims, maintenance and counters are separate. PROCESSING exclusion is shared.
- `INV-003`: Imports and completion lock post before job. Enqueue never acquires
  the classification advisory lock while holding a post-write lock.
- `INV-004`: DTO retains original caption semantics and adds only a sanitized,
  optional current translation. Validate its hash before list-caption truncation;
  never expose a job receipt, lease or model-internal result as a public DTO.

Overwriting caption was rejected because it loses the original and invalidates
classification. A second job table/service would duplicate the already available
lease/idempotency infrastructure. The chosen extension reuses the existing table
with an explicit typed analysis version and requires no data migration. Search
continues to use its existing authoritative text; translated-text search is out
of scope for this increment.

## Errors and edge cases

- `ERR-001`: French/English/nonlinguistic text is recorded as checked/unchanged.
- `ERR-002`: Ambiguous language or invalid/incomplete output retains the original
  and an explicit review/failure outcome. Busy/network errors retry with bounds.
- `ERR-003`: Deleted posts cannot be recreated. Late completion cannot overwrite
  a newer caption result, and a lost completion response is safely replayable.
- `ERR-004`: Mixed text translates foreign passages, leaving English/French
  passages and protected tokens intact. Captions are untrusted input, never commands.

## Rollout and rollback

Deploy additive API/UI support first. A new claim protocol distinguishes the
replacement consumer from old consumers: legacy claims return null permanently,
while their heartbeat/complete/fail remain accepted for the active job. Verify
old web instances are withdrawn before treating this as a claim fence. After
that job finishes and no PROCESSING lease remains, stop the old consumer, verify
its exit and canonical lock release, and start the reviewed replacement.
An arbitrarily delayed legacy claim still returns null after the replacement starts.
Prepare a protocol-compatible prior consumer for rollback; never revert to an
old claim sender that the new API intentionally fences. New consumer shutdown
must stop future polling and let its owned job finish within the configured bound.
Use `flock --no-fork` so Node is the systemd MainPID, `KillMode=mixed` so SIGTERM
reaches only Node while media children drain, and `TimeoutStopSec=96min` before
forced cgroup cleanup. Keep one canonical lock and verify it with a subprocess test.

Run a real-provider pilot with synthetic French, English, mixed and foreign prose,
then admit the historical queue idempotently. Private production descriptions stay
in the normal service flow; operator proofs return aggregate fingerprints/counts. Read-only proofs compare originals,
manual tags, tombstones and Places; retain private audit receipts and counts.
Disabling translation claims leaves originals/classification intact. Once a new
consumer owns a job, allow it to drain before replacing code. No destructive rollback.

## Acceptance and test seams

| Acceptance | Requirements | Proof |
| --- | --- | --- |
| FR/EN unchanged; foreign text translated; protected tokens preserved | REQ-001 | contract/provider tests and real pilot |
| Current translation visible with original toggle; stale hidden | REQ-002, INV-004 | database DTO and UI/browser tests |
| New/change/identical imports and historical idempotency | REQ-003 | transactional integration tests |
| No media/classification replay and priority scheduling | REQ-004/006 | consumer tests and runtime observations |
| Ownership, deletion/edit fencing, replay, retries | REQ-005 | real PostgreSQL tests |
| Version-scoped maintenance/counts and persistent legacy claim fence | REQ-007 | API/queue tests and rollout receipts |

## Implementation slices and files

1. Add translation contract and transactional jobs in `src/lib/classification/`
   and `src/server/classification/`; add a dedicated translation route with the
   existing scoped classification credential and a 1 MiB body bound (classification
   keeps 128 KiB),
   version-scoped classification maintenance and the import admission hook.
2. Add text-only translation inference/runner in `services/worker/src/classification/`,
   claim protocol, priority dispatch and graceful draining in the existing CLI.
3. Add the current translation to `src/server/library.ts`, `LibraryPost`, cards
   and detail; document the additive API/operations contract and test the UI.
4. Run local app/worker suites, types/builds/lint, independent review and CI;
   publish/deploy with safe drain, pilot and audited historical admission.

Authorization comes from the owner's explicit feature request, choice of existing
and future posts, and continuing authorization to finish implementation/publication
without repeated permission requests. Independent review already identified and
resolved the design hazards around version scoping, row locks, stale DTOs and
legacy requests. Implementation evidence: 664 app and 139 worker tests pass; app and worker builds
pass. Chromium verifies French/default and the original toggle. Independent review corrected paragraph/emoji preservation, copied FR/EN
source segments, transient response-body errors, and systemd child drainage. A real
isolated systemd test proves one claim, an unaborted active signal, a successful
child exit and lock release only after draining. Production activation completed at 21:24 UTC on 8 October: web `365f545`
(PR #129, green CI) fences legacy claims, then the consumer was replaced only after
zero active jobs. Subsequent classification successes, Node main PID, canonical
lock, four CPU quota and zero restarts were verified. All 3,923 existing captions
were admitted at 21:25 UTC; translation processing follows eligible classification,
so this is an admission/activation claim, not a completed-library claim. Future
imports use the enabled transactional admission hook. Aggregate fingerprints prove
original captions, 2,763 protected tag links, 36 deletion tombstones, 1,230 Places
and 1,165 place links unchanged. Original auto-deployment controls and sync cron
were restored. Detailed private receipts are in
`.tmp/caption-translation-20261008/`; use version-filtered operational counts.

Release CI exposed a slow Ubuntu regional mirror. The follow-up reuses installed
FFmpeg/ffprobe, bounds package installation, retains Ubuntu signature verification,
and uses the official archive without optional recommended packages. All validation
steps remain enabled.
