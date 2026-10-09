# Operational Handoff

Last updated: 9 October 2026
Repository: `OlympusForgeHQ/insta-post-explorer`  
Reference development base: `develop` at `5130362` (translation recovery)
Current web release: `main` at `e84e96c`
Sync retains its previous image and hourly recovery command.
Older phase references below are historical.

## Verified worker memory — 9 October 2026

Owner-authorized integration adds explicit manual correction memory, bounded
retrieval and content-free attempt observations to the existing classification/
translation consumer. No historical batch is requeued. Protected imported tags
never become verified examples automatically. See
[specification](changes/worker-learning/spec.md) and
[operations](../services/worker/classification/README.md#verified-learning-memory-9-october).
Rollout order: additive migration → compatible web API → opt-in independent worker.
Deployment receipts and integrity hashes: private `.tmp/worker-learning-20261009/`.


## Contextual translation review — 9 October 2026

The completed historical pass left 58 language reviews and one technical failure.
A bounded second opinion now supplies neighboring caption context only for uncertain
units. Accepted units and originals remain locally preserved; unresolved cases stay
NEEDS_REVIEW. Explicit snapshot recovery is operator-only and audited. See
[context review evidence](changes/2026-10-09-caption-context-review.md) and private
`.tmp/caption-review-20261009/` receipts for diagnostic and activation outcomes.

## Latest caption worker follow-ups

Mixed-language marker restoration shipped through PRs #134/#135 (main `e30677a`),
while web remains `e84e96c`. A further sentence-boundary defect was reproduced and
fixed: protected markers must remain atomic when punctuation touches an emoji or
other protected value. See the recovery evidence for the red/green regression and
`.tmp/caption-recovery-20261009/` for current activation/cohort receipts. The
initial 08:14 observations below are historical; do not treat them as live counts.

## Caption translation recovery — 9 October 2026

The owner approved fixing invalid responses and transient busy failures. The
reviewed correction uses indexed sentence/line units, local protected-token/emoji
restoration, exact fallback for mixed-language units and allowlisted diagnostics.
Busy deferrals refund the inference attempt within a 24-hour window; genuine
failures remain bounded. Failed-job recovery is owner/version/hash/cutoff scoped,
audited and idempotent. Successful work and active leases are excluded.
PR #131 merged at `5130362`; release PR #132 deployed web/main `e84e96c`
after green quality/browser CI. The previous consumer finished its owned task;
zero processing jobs and a free canonical lock were verified before the synthetic
pilot. All five real-provider cases passed (French, English, Spanish, mixed and
Russian). Immutable consumer `20261009-translation-recovery` is active with four
CPUs, unchanged environment, Node main PID and zero restarts. At 08:13 UTC,
141 failed translations were requeued with cutoff `2026-10-09T08:12:24.908Z`;
replay requeued zero. At 08:14 UTC, five recovered jobs had succeeded and none had
failed again; the remaining cohort is still processing, not claimed complete.
Original-caption and all protected fingerprints match; deployment controls were
restored and the sync image/cron were preserved. Private receipts and cohort status:
`.tmp/caption-recovery-20261009/`. See
[recovery specification](changes/2026-10-09-caption-translation-recovery.md).

## Caption translation — 8 October 2026

The owner requested French translations for descriptions in languages other than
French/English, for both existing and future posts. Implementation adds a separate
versioned text-only queue in the existing classification table, transactional import
admission, current-hash DTOs and French/default + original toggle. It preserves
original captions, Post.updatedAt, categories, protected tags, deletions and Places.
Classification retains priority. No schema migration or additional service is needed.

PR #127 merged into develop at `edf507f`; release PR #129 deployed web/main
`365f545` after green quality/browser CI. At 21:24 UTC the protocol fence let the
active post finish before replacing the consumer with release
`20261008-translation`; Node owns the canonical lock, quota remains four CPUs,
`KillMode=mixed`, and zero restarts were observed. New classification jobs completed
successfully after activation. At 21:25 UTC all 3,923 existing captions were admitted
to `caption-translation-v1`; these jobs are queued, not claimed to be translated.
Future imports admit new/changed descriptions automatically. Classification retains
priority: the 21:25 UTC snapshot has 3,501 successes, one active and 417 pending;
four historical failures remain. Original-caption and protected-tag/deletion/Places
fingerprints match. Web/sync auto-deployment controls were restored; sync image and
hourly recovery command remain unchanged.

Validation: 664 app tests, 139 worker tests, builds/types/lint and Chromium toggle
passed. Five synthetic cases passed against the real provider, including mixed
languages and long text; no production captions were exported for testing. The
isolated systemd test proves child drainage and lock retention until completion.
Private receipts live in `.tmp/caption-translation-20261008/` (activation, admission,
API proof, deployment controls and aggregate integrity snapshots). Future status
queries must filter analysisVersion to avoid counting translations as classification.
See [translation specification and rollout](changes/2026-10-08-caption-translation.md).

## Classification throughput — 8 October 2026

The owner authorized optimization without interrupting the active analysis.
The two-CPU live trial preserved the PID/start time and zero restarts. The reviewed
replacement removes the fixed 15-second success delay and configures four CPU
threads, supported by five identical-transcript ASR trials (about 43 → 27 seconds).
Manual tags, deletions, Places, full audio and serial inference remain protected.
PR #125 merged at `bb3d5e3` after green quality/browser CI. Release 20261008
was activated at 09:58:40 UTC, after the old post completed. Three new successful
posts verify ASR/image coverage and 0.15–0.17-second success-to-next-job gaps.
Effective quota/threads are four, with zero restarts and the same 2 GiB cap.
The 10:00 UTC snapshot has 2,392 successes; all protected fingerprints match.
Web/main and sync image/schedule are unchanged. The library batch is still
running; this is not a batch completion claim.
See [requirements, measurements and rollout](changes/2026-10-08-classification-throughput.md).

## Current classification extension — 6 October 2026

The owner now explicitly authorizes classifying the existing library as well as
future imports, correcting existing themes and automatic tags while retaining
all protected imported/manual tags, deletion tombstones and confirmed Places.
Private operational helpers reused successful jobs, verified historical media
and recovered missing originals; the completed geographic analysis was not rerun.
The bulk queue is running serially. This is an ongoing batch, not a completion
claim for the whole library.

Branch `fix/classification-long-videos`, based on `develop` `fa5b7e3`, scopes
classification to 600 MiB MP4 originals and sixty-minute full coverage, with a
ninety-minute job/process deadline, ten-minute full-body download deadline and
two-hour owner/version-bound signatures. Images and Places keep their old limits.
Real sixty-minute audio/frame extraction, boundary and transactional tests pass.
PRs #117/#119 and release #118 are merged after green quality/browser CI.
The reviewed feature tree matched `develop` and the web release at publication;
web and sync are healthy, their initial auto-deployment settings are restored,
and the classification flag/digest and sync schedule are preserved.
The permanent 20261006 consumer is active and enabled under the canonical lock. The root handover ran on 6 October at 09:35 Brussels; read-only systemd, cgroup, parent/child and kernel-lock checks passed at 09:55, with no restart loop and successful classifications after handover.
All 3,910 historical posts have durable classification jobs. Eleven missing
originals were recovered, including one complete official DASH video/audio
remux without reencoding or trimming; no deleted post was recreated.
All three long originals (50.91, 51.63 and 36 minutes) passed complete audio
transcription and twelve-frame inference. The last restored DASH post also
succeeded. At the 08:31 UTC snapshot, 486 jobs succeeded and 3,424 were pending, with no reviews or failures; 126 categories had changed. All 2,763 protected links were compared per post, and protected tags, tombstones and Places fingerprints still matched the baseline. All 3,786 unchanged pilot holds were released at
02:33 UTC, and the compatible consumer started the next ordinary post.
The library batch remains in progress; the long-video pilot is complete.
See [scope/evidence](changes/2026-10-06-classification-long-videos.md).

An earlier supervised-pilot consumer had remained orphaned without the canonical
lock. Its old claim schema rejected the third large video before analysis;
three leases expired. Exact process identity was checked before its graceful
stop. A conditional one-time retry succeeded and retained the earlier attempts
in the audit. Only the compatible consumer remains. The reviewed permanent
handover now refuses unaccounted consumers before downtime and verifies no
survivors after stop and exclusive startup; ten private guard tests pass. The initial installer falsely reported FOREIGN_CONSUMER_PROCESS during flock’s fork-before-exec transition, despite a working permanent unit. The corrected check waits at most ten seconds for exact identity, then requires twelve strict stable samples. The installed service was not restarted for this correction.

Two understood image posts were incorrectly left for review because the model interpreted Divers and ingredient-only Cuisine too narrowly. PR #122 and release #123 passed quality/browser CI and deployed application-owned schema descriptions on web only. The installed consumer received the metadata without a new release or restart. A guarded audited retry preserved prior results/attempts and both posts’ ten protected links; DeepSeek then classified them as Divers and Cuisine on attempt two. Compiled production guidance, dedicated capabilities, unchanged sync deployment history and restored controls were verified. See [scope, compatibility and rollout evidence](changes/2026-10-06-classification-theme-guidance.md). Successful jobs and Places were not reanalyzed.

## Classification rollout — independent DeepSeek worker — 5 October 2026

The owner approved implementation of an independent worker called by sync for
every new imported post. Branch `feat/post-classification-worker` implements the
transactional application-owned queue, scoped API, multimodal serial consumer and
private staged systemd unit. It chooses one of the eight existing themes and 3–5
precise proposed tags, reusing/creating tags while preserving manual edits and
deletions. It does not reanalyze the completed library or enqueue Places work.
Global manual catalog corrections also fence stale classification.

Application637/637, worker107/107, eight Python tests, lint, types and both builds
pass with disposable PostgreSQL; real media/cross-layer and built-release smoke
pass. Independent review has no outstanding findings. PR #111 is merged in
`develop` at `2371239`; release PR #112 is merged in `main` at `ec2bc14`. Their
quality and browser CI passed. The reviewed additive production migration is
recorded by Prisma. The web flag is now 1 with its dedicated digest; the owner
explicitly authorized DeepSeek via OpenRouter for the pilot and future imports.

The real incremental pilot imported seven new posts and nine verified media,
without updating existing posts or resetting automatic sync admissions. All
seven classification jobs succeeded on their first attempt, saving an existing
theme and four or five automatic tags. Six videos received full-audio local ASR
and twelve frames each; the three-image carousel was inspected and fused.
All 3,903 prior post/media/tag fingerprints, 36 deletion tombstones, Places
links/jobs and prior sync admissions were preserved. Each completion has an audit
receipt; temporary media were removed and the Whisper cache retained.

The pilot used the installed consumer supervised under Argos with the canonical
flock. The owner then enabled/started `insta-explorer-classification.service` at
23:41 Brussels time. It is active/enabled, with one correctly scoped Node process,
the exclusive lock held and no restarts. All pilot jobs were already complete;
the activation check verifies the real unit's startup/configuration and idle
state, rather than another media job under systemd. Future new imports are queued
transactionally and consumed automatically. Web, sync and Hermes remain healthy;
both auto-deployment settings and the enabled hourly recovery cron are preserved.
See [evidence and rollout](changes/2026-10-05-post-classification.md).

The previous Places recovery and sync-profile repair are separate completed
operational work. Preserve their manual suppressions and persistent sync hotfix;
this branch changes neither the extension nor the sync image. This automation
classifies new imports only; it does not automate geographical Places analysis.

## Local correction — active Places visibility — 5 October 2026

Branch `fix/places-active-visibility` filters inactive canonicals and rejections
before list/map limits, preserving manual confirmations and owner-owned links
regardless of current post theme. Statistics share the same presence rule;
explicit review filters and details preserve historical access. No data changes.
Lint, typecheck, build and 437 application tests pass; 171 PostgreSQL tests,
including four new regressions, are skipped without a local database.
Independent review is clear; 16 read-only production getter checks pass.
Disposable PostgreSQL regression execution is delegated to CI before merge.
See [scope and evidence](changes/2026-10-05-places-active-visibility.md).

## Current correction — long Places itineraries — 5 October 2026

The deployed candidate-capacity correction expands the dedicated worker contract from
50 to 200 candidates and removes its smaller duplicated inference bound. A model
response reaching or exceeding its declared capacity, or its output-token limit fails without a
compacting retry. Fusion output is bounded to 32,768 tokens. Caption imports remain
limited to 50. No schema migration, schedule or automatic reanalysis is introduced.
Branch `fix/places-video-duration` aligns extraction, coverage and evidence timestamps
at 15 minutes, preserving the actual media timeline. Real 450s/900s extraction
passes; 901s media and timestamps/durations above 900,000ms remain rejected.
Follow-up checks: app437 passed/167 DB skips, worker88 passed/7 DB skips, three
Python tests, lint, both type checks and both builds pass. Independent review
has no blocking findings; its 15 targeted tests pass. Deployment verification
of this video follow-up remains pending.
The earlier candidate-capacity verification below used disposable PostgreSQL:
Application 603/603 and worker 94/94 tests pass with disposable PostgreSQL;
three Python transcription tests, lint, type checks and worker build also pass.
Independent review has no blocking findings; application production build passes.
The candidate-capacity correction is deployed at production `bf22721` (PR #106).
The serial library review continues. See [scope and verification](changes/2026-10-05-places-long-post-capacity.md).

## Current correction — shared place certainty — 4 October 2026

Branch `fix/places-shared-resolution-confidence` preserves the stronger canonical
precision/confidence when another post resolves to identical place data. Each
post link and its evidence retain their own score. Changed coordinates or
classification can still be corrected, and manually confirmed places remain
protected. A row lock prevents reading stale certainty during concurrent writes.
Focused PostgreSQL18/18, full app601/601, lint, types, build and independent review
pass. No schema or scheduling change. See [scope and verification](changes/2026-10-04-places-shared-confidence.md).
The remaining-library review is still running; this correction does not mark it
complete. Deployment health must be checked after merge.

## Previous correction — library review quality — 4 October 2026

The40-post pilot is persisted and verified; its measured gate passed. The first
example is also rechecked. Serial analysis and manual review of381remaining posts
are running, with incremental synchronization checking for arrivals. This does not
complete the entire library or enable unattended scheduling.

Branch `fix/places-review-quality` fixes speech segment ends beyond real audio,
GB-scoped London locality context, and zero-confidence specific matches. See
[scope and evidence](changes/2026-10-04-places-review-quality.md). Prior geographic
previews must be refreshed before persistence. Temporary sync auto-deployment
protection must be restored after the active manual synchronization terminates.

## Previous correction — unverified area substitutions — 4 October 2026

Branch `fix/places-unverified-areas` prevents named venues from becoming a city
circle based only on contextual locality. The pilot demonstrated incorrect
envelopes and category collisions. Explicit geographic areas remain supported.
581 app tests and 90 worker tests, lint/typecheck/build and independent review
pass. See [scope and evidence](changes/2026-10-04-places-unverified-areas.md).

## Previous correction — geographic language matching, 4 October 2026

The owner authorized geographic verification, full eligible-library review and
correction, including newly arrived Restaurant/Voyages posts. The geographic
pilot exposed false contradictions between translated country labels and
bilingual provider localities. Branch `fix/places-geographic-matching` fixes
these exact comparisons and rejects conflicting entity names, namesake amenities,
unrelated areas and unresolved branches. Scoring thresholds and owner categories
are preserved. Final checks: 580 app tests and 90 worker tests with disposable
PostgreSQL, lint/types/build pass; independent review is clear.
Source results and geographic previews remain private and resumable. The full
library remains gated on measured pilot quality. See
[scope and evidence](changes/2026-10-04-places-geographic-matching.md).

## Previous task — 40-post pilot and execution hardening, 4 October 2026

Branch `fix/places-pilot-hardening` starts at develop `e3cd1d5`. The owner approved
a fixed 40-post pilot (20 Restaurant, 20 Voyages), then review/correction of the
eligible library after the pilot succeeds. The live inventory contains 422
eligible posts, including the already completed named-post pilot. Local private
operator checkpoints are resumable and keep original and reviewed results apart.
The40-post pilot gate subsequently passed; the remaining-library run is now active.

Real attempts exposed strict JSON failures and frame seeks beyond the actual
video stream end when audio lasts longer. Bounded inference repair and video
stream-aware frame sampling are covered by 90 passing worker tests; 570 app tests,
lint, type checks and app build pass. Independent review is clear. See
[scope and verification](changes/2026-10-04-places-pilot-hardening.md).
Never publish private source/evidence payloads, signed URLs or operator secrets.

## Previous task — owner categories and serial Places pipeline, 4 October 2026

Implementation branch: `feat/places-analysis-pipeline`. The owner requires exactly
Restaurant, Café & brunch, Pâtisserie, Voyage and Divers. Geoapify classification
has no authority: the model proposes one of these categories with evidence.
Legacy provider category strings appear in Divers until reanalysis; confirmed
manual records remain protected. The detail sheet displays the actual category.

The application owns the new scoped `POST /api/v1/places/worker` queue, signed
media reads, geocoding and atomic completion. The CLI in `services/worker/src/places`
processes serially through the existing isolated Hermes service. Caption, up to
12 video frames, full available audio (local Whisper), OCR and fusion are joined
before persistence. No DB/bucket credentials enter the CLI or Hermes. All media
artifacts are temporary. No unattended backfill or third service is installed.

Code review is clear after fixing truncated-media detection, interrupted response
replay, private-content logging and street-first house-number matching. Local
PostgreSQL suites: application 570/570, worker 85/85; lint/types/build pass.
An isolated additive evidence-enum migration was rehearsed against divergent
legacy history. Never run the repository's full historical migrations on live DB.

Real named-post analysis completed in 57.351 seconds: one 42.768-second video,
12 sampled frames, 11 audio segments, three DeepSeek V4.1 Flash calls, 13,680 input
and 2,058 output tokens, one candidate categorized cafe. PyAV 19 broke the pinned
Whisper API; requirements now pin PyAV 18.0.0 and actual transcription passes.
A zero-write geographic preview passed. PRs #91/#92 are merged; release #93 is
deployed at `810ad4151dd44bf41ed4a6ccfd9600247af35643`. Production web and sync
deployments finished healthy, and the isolated Places service remains active.
The authorized production pilot completed in 60.412 seconds using the same model,
12 frames and 11 audio segments (13,761 input / 2,106 output tokens). It updated
the existing Terre d'Azur place and link to cafe with EXACT precision, without a
duplicate. Nine evidence records include caption, audio and OCR. Database audit
events confirm atomic persistence; the live post → Places → Google Maps browser
journey and Café & brunch badge pass with no page errors. The additive migration
was applied alone. The temporary media workspace is empty, and private candidate
and signed-media payload files were removed after verification. Sanitized private
operator receipts live under `.tmp/places-pipeline-release`; release evidence is
also recorded on PR #93. This does not complete Phase H.
The measured 30–50 post pilot and unattended scheduling remain separate gates.

Contracts: `docs/places-worker-api.md`; operations:
`services/worker/places-hermes/README.md`; scope and verification:
`docs/changes/2026-10-04-places-pipeline/`.

## Previous task — separate Places service and OpenRouter, 4 October 2026

The owner approved two execution services and requested the new service be
configured with OpenRouter DeepSeek V4.1 Flash. Branch
`feat/places-worker-openrouter` starts at develop `a9b18da`.

`insta-explorer-places.service` is installed, enabled and running on the VPS.
It reuses Hermes 0.21.5 with a dedicated `/var/lib/insta-explorer-places` state,
loopback API `127.0.0.1:8645`, its own API credential, and the existing upstream
OpenRouter credential. Model and vision model: `deepseek/deepseek-v4.1-flash`.
One admitted API run, 1 CPU, 2 GiB RAM; no agent tools or inherited messaging
profiles. This runtime does not yet consume the post queue or write Places.

Live synthetic text and image OCR passed. Session metadata confirms all three
inference calls used OpenRouter and the exact requested model, with zero tool
calls. Simultaneous requests returned 200 and 429. Unauthenticated access returns
401; only loopback listens. Namespace checks hide Argos/Cortana configs and the
source secret. State is 0700, secrets 0600. Sync/web remain healthy and both
existing Hermes gateways remain active.

Independent review caught and resolved the UV interpreter bind and native HTTP
concurrency limit. Startup additionally proved that the interpreter's `3.11`
alias must be bound as well as the real `3.11.15` directory. Artifacts and rollback:
`services/worker/places-hermes/README.md`; accepted architecture:
`docs/decisions/2026-10-04-separate-places-service.md`. Sanitized live evidence:
`.tmp/places-worker/verification.json` (never copy the runtime `.env`).

Verification: installer 3/3, app lint/types/build, worker types/build, app tests
412 passed with 159 DB-dependent skips, worker tests 70 passed with 7 DB skips.
Sandbox port/subprocess restrictions required rerunning app/worker suites and
the build outside the sandbox; those reruns passed. No DB migration or schema
change. Next work is the multimodal handler/API integration and a measured pilot;
the 421-post backfill has not been started.

## Previous task — preserve Places camera on detail close, 4 October 2026

`fix/preserve-places-viewport` starts at develop `19b7825`. Closing a place/post
sheet used to fit all visible places again, losing the user's zoom and center.
The renderer now fits an unselected view only for a new map or a changed filtered
place set. Closing the sheet preserves center, zoom, bearing and pitch. Initial
place links, selection focus and deliberate filtering retain their behavior.
No migration, dependency, API or worker change.

The real MapLibre browser regression failed before the patch (zoom 16 → 1.847)
and passed after, including repeat close/reopen, filter framing and deep links.
571 PostgreSQL-backed tests, lint/types/build and independent review passed.
See [scope and proof](changes/2026-10-04-preserve-places-viewport.md).
Merge/deployment authorization persists; record live receipts in the associated
PRs and `.tmp/camera/`. Preserve the database-history exception below.

## Previous task — post links to Places and Google Maps, 3 October 2026

`feat/post-place-navigation` starts at develop `0f348d9`. Full post details expose
owner-scoped, valid associated places, primary first, with a distinct “Voir dans
Places” link for each. The existing `placeId` route opens the selected place.
Known addresses link to Google Maps from the post detail, Places detail and list;
missing addresses fall back to the known name/locality. Free-text captions remain
unchanged. Rejected results are excluded; theme changes do not erase prior links.
No migration, dependency, worker or public V1 contract change.

Local verification passed: 571 PostgreSQL-backed application tests, lint, types,
build and one real-browser post → place → Maps journey using local synthetic data.
Desktop/mobile layout has no horizontal overflow at 390px; links have 44px touch
targets and visible keyboard focus. Independent review found no blocking issue.
See [scope and evidence](changes/2026-10-03-post-place-navigation.md).
PR #86 and test follow-up #88 merged to develop at `19b7825`; release #87 merged
to main at `e620920`. CI passed, both environments' web/worker are healthy, and
read-only browser checks passed on existing posts with two linked places. Google
Maps, unlinked absence and mobile layout passed; production search was 14/14.
Receipts are in PR #87 and `.tmp/place-links/`. No database migration.

## Previous task — admin multiselection, 3 October 2026

`feat/post-multiselection` starts at develop `b17c4a8`. Admins can select loaded
cards in either grid, select all displayed cards, and confirm grouped permanent
deletion. Filter/search/sort changes clear selection; pagination and view changes
preserve explicit choices. Deletion reuses the existing authenticated endpoint
sequentially, freezes confirmed IDs, stops on error and retries only remaining IDs.
Lost responses, partial completion, unmount and failed filter refresh are covered.
No server, worker, dependency or database migration changes.

Local verification: 566 PostgreSQL-backed application tests, lint, types, build,
three real-auth/import browser scenarios, desktop/mobile layout and keyboard
checks passed. Independent final review is favorable. See
[scope and proof matrix](changes/2026-10-03-post-multiselection.md).
PR #84 merged to develop at `0f348d9`; release PR #85 merged to main at
`5c1667d`. CI passed, preview and production web/worker are healthy. Three preview
browser scenarios and production read-only verification passed, including search
at 14/14 and private journal access. Receipts are in PRs #84/#85 and
`.tmp/multiselection/`. Never use real posts for destructive QA.

## Previous task — permanent deletions and mutation journal, 3 October 2026

Local branch `fix/persist-manual-post-deletions` starts at develop `53db233`.
Admin deletion atomically records minimal identities and removes linked URL
aliases. Imports and sync snapshots honor these identities; concurrent imports
cannot resurrect deleted posts. The admin-only mutation journal records actual
row changes across all 13 business tables, including worker/direct SQL and
cascades, with before/after values. Reads are excluded. Owner transfers split
snapshots so neither owner sees the other's private values. Gérer exposes filters,
keyset pagination and event details.

Both changes passed independent source review. Fresh verification on the final
migration: 557 application tests, 77 worker tests, lint, app/worker type checks,
production build, and two targeted browser scenarios including the journal.
The broader auth suite has an unrelated legacy selector/logout failure, recorded
in the [deletion change](changes/2026-10-03-permanent-post-deletions.md).
See the [audit design and evidence](changes/2026-10-03-database-audit.md).

The user explicitly approved production access, migrations, merge and deployment.
PR #81 merged at `0f81e60` after green CI and the preview database migration.
Preview web/worker are healthy and the live deletion/reimport/journal smoke
passed. Both database migrations and their exact post-checks succeeded.
PR #82 merged to main at `f4aa7a2`, both production web/worker deployments finished
and were healthy. Production checks confirmed authenticated journal access,
anonymous denial and `pomme de terre` at 14/14 displayed results. PR #83 synced
the release documentation to develop at `b17c4a8`.
Native disabled, manually executed Coolify scheduled tasks use the running web
application's existing DATABASE_URL; no sensitive-read permission or exported
credential is needed. Do not use old Neon environment files or GitHub secrets for
these current Coolify databases. Completed release receipts are recorded in
PR #82 and `.tmp/permanent-post-deletions/release/`.

**Migration exception:** both current databases contain eight historical migration
records, three absent legacy migrations and two legacy checksum differences.
Sync/Collections objects already exist; the old Cuisine data update remains
historically unverified and is not replayed.
Preview schema comparison showed compatible, intentional raw-SQL indexes/
defaults and owner constraints; both databases passed the catalogue checks. Do not run a full-repository `prisma migrate deploy`,
`db push`, or replay old data migrations until that history is separately
reconciled. This release uses an isolated bundle containing only
`20261003150000_permanent_post_deletions` and
`20261003170000_database_audit`, with original SQL, schema and lock file.
Rehearsal on the observed divergent history proved that only these two migrations
are applied, a retry is a no-op, and all old migration records remain unchanged.
See [the release procedure and evidence](changes/2026-10-03-audit-release.md).

Preserve audit events and deletion identities on rollback; suspend imports if
reverting to application code without suppression. Both the fresh-database
13-migration rehearsal and this targeted upgrade path passed independently.

Historical recovery was investigated against the backup and live database
metadata. Neither had a previous deletion/audit table or custom trigger. No
reliable list of past manual deletions was found; import counts cannot establish
that list. No historical posts were selected or deleted. The journal starts when
its migration is applied and does not invent earlier events.

## Previous task — search result visibility, 27 September 2026

The local branch `fix/search-results-count` starts at develop `ec46735`.
The UI no longer repeats text search against truncated cards; stale pagination
and discovery responses cannot pollute a newer search. Independent review
approved the final diff. Verification: 396 unit tests passed (138 database-bound
skips), 20 library browser tests passed, lint/typecheck/build passed.
See [change and evidence](changes/2026-09-27-search-results-count.md).
The owner authorized merge and production deployment after an exact
`pomme de terre` check: the corrected build displayed all 14 production results,
versus 7 with the old UI. PR #79 merged to develop and PR #80 to main; CI and
production verification passed at `cd58ab9`, including 14/14 results and healthy
web/worker deployments. No migration.

## Previous task — daily sync, 11 September 2026

The active local branch `feat/daily-instagram-sync` starts at develop `3dc1e85`.
Production main was last observed at `995c56e` after extension 4.2.8 publication;
the older August references below are historical. Functional daily-sync code is
implemented, independently reviewed and verified: app 527/527 + worker 77/77 tests,
lint/types/builds, Chromium collector and real Next/PostgreSQL integration.
The worker Docker image has been built and rehearsed locally. See
[daily-sync operations](daily-instagram-sync.md) and
[change/evidence matrix](changes/2026-09-11-functional-sync-worker.md).
No feature commit/push, production migration, real-account pilot or schedule
activation has occurred. Resume at the publication/deployment authorization gate,
then provision the private profile, interactive login and first real import.
Do not restart phase 1 implementation or modify unrelated Places gates.

## 1. Purpose and authority

This file records the current operational state for the next agent session. It does not replace product or architecture contracts.

Authority order:

1. `../AGENTS.md` for global rules and prohibitions;
2. this file for the active phase and verified state;
3. `CODEX_IMPLEMENTATION_ORDER.md` for phase dependencies and exit gates;
4. the reviewed design and implementation brief for the active phase;
5. the code on the latest `develop`.

Stop and document any conflict between this handoff, an authoritative contract and the current code before editing.

## 2. Completed work

| Phase | Outcome |
| --- | --- |
| 0 — API and Places audit | PR #15. Architecture locked to one app, one PostgreSQL project, one R2 account, one global worker and one global MCP. Places eligibility comes only from `Post.mainTheme`. |
| A — Library filter consistency | PR #18, squash `69ea0da`. Shared predicates and PostgreSQL regressions. |
| B — Places theme eligibility | PR #19, squash `2323e0d`. Canonical Places eligibility. |
| C — R2 media identity and worker isolation | PR #24, squash `0870d69`. Authoritative R2 identity, owner backfill and restricted worker role. |
| D — External API V1 | PR #26, squash `9e57f93`. Read-only Bearer API and stable errors. |
| F1 — Places schema and domain contracts | PR #29, squash `8bf8523`. Places schema, SQL invariants, owner-scoped inputs and idempotent jobs. |
| F2 — Geoapify and caption resolution | PR #30, squash `7cc05e2`; hardened by PR #32, squash `216b975`. Deterministic resolver, JSONL workflow, retries, quiet idempotence. |
| F3 — Read API, statistics and review | PR #31, squash `15356e9`. Read-only Places routes, statistics, durable review decisions and audit evidence. |
| F — Places metadata-first domain | COMPLETE. Exit gate accepted after successful real local validation with idempotent re-import, recovered transient errors and correct `UNKNOWN` handling. |
| G — Places 2D UI and contextual navigation | PR #34, squash `2bd2098`. `/places`, Leaflet clustering, Geoapify raster tiles, synchronized list, filters, statistics, detail sheet, review actions, deep links, responsive and keyboard-accessible UI. |
| I design — Places 3D globe | PR #35, squash `3fef818`. ADR `ACCEPTED`, six decisions closed, T0 satisfied. |
| I implementation — Places 3D globe | PR #36, squash `08be9f0`. T1–T10 merged after two review rounds. WebGL-gated lazy loading, risk-based test consolidation, local Natural Earth texture, shared 2D/3D state and documented performance evidence. |
| Places points-only map detail | Direct push on `develop` at `626aee5` (spec `007`). Exact points and post detail refinement. No PR — see the git-discipline note in section 3. |
| Places panel coordination | Direct push on `develop` at `0a933a1` (spec `008`). Detail sheet and explorer panel coordination, post preview. No PR — see the git-discipline note in section 3. |
| VibeSpec cloud bundle 2.3.0 | PR #58, squash `9e3a749`. Tooling-only migration; the repository test policy moved out of the managed block byte-for-byte. |
| CI standardization on `develop` | PR #59, squash `439ec57`. Cherry-picks `4fb05e3`, `85a70f5` and `bb77f56` from `main` (PR #56) so both branches validate identically. |
| MapLibre 2D + globe renderer | PR #57, squash `78b3bbf`. Supersedes the Leaflet and Three.js renderers. Merged with an explicit D6 FPS derogation — see section 7. |
| Continuous globe and local verification harness | PR #67, squash `438f7ff`. Continuous MapLibre globe, local ephemeral PostgreSQL/tile harness and Places browser proof. D6/FPS remains derogated and unmeasured. |

## 3. Current execution pointer

### Main alignment (24 August 2026)

`main` was aligned with `develop` through a merge commit at `daaca2c`. The
alignment required resolving 13 file conflicts caused by the divergent squash
merge histories; all conflicts were resolved by taking develop's version, which
is the reviewed superset. A 3-agent Fable review validated the full
`main..develop` delta before the alignment:

- **Config & dependencies**: clean — CI byte-identical, dep migration coherent
- **Regression fix (PR #68)**: APPROVE — correct root cause, RED/GREEN evidence
- **Full code review**: 2 High corrected (projection fix PR #68, D6 harness
  PR #71), 3 Medium (1 fixed in PR #71, 2 non-blocking), 4 Low cosmetic

Validation on the merged result: ESLint 0, TypeScript 0, 369 tests passed,
production build PASS.

PR #71 repaired the D6 measure-globe harness for the continuous globe (navigates
to `/places?view=globe` instead of clicking a removed "3D" button) and added
`console.error` logging to the places page DB catch that previously swallowed
errors silently.

### Globe projection regression correction (9 August 2026)

PR #67 is merged on `develop` at `438f7ff`, but an external vector style without
`projection` exposed a post-load MapLibre regression. Its correction was
squash-merged into `develop` as PR #68,
`056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe`. The pre-merge local verification and
attempted Claude Opus read-only review remain recorded historical evidence; the
latter was quota-blocked. The correction adds no migration file or application
deployment, does not apply a migration outside its disposable harness, and does
not change the D6/FPS derogation. The harness applies existing Prisma migrations
only in its disposable local PostgreSQL container before seeding it.

### Places Production data replaced (8 August 2026)

Production Neon `main` now carries the develop Places dataset: **301 places, 313
links, 3,805 evidence rows, 1,628 jobs, 180 linked posts and 182 map-visible
places**, up from 51 places of which only 12 reached the map.

This was a **destructive data operation**, authorized explicitly after its cost
was measured: it gains 33 map points and removes the place linkage of 96 posts,
so the footer count fell from 254 to 180. Executed as one transaction — delete
the four Places tables in dependency order, reload develop's rows in reverse —
from a checksummed script (`ffb8b98a…`) rehearsed first on a copy of `main` that
produced an identical result.

Rollback point: Neon branch `backup-main-2026-08-08`, verified by its contents
(51 places, 407 `places-v1` jobs) rather than by the Neon API, which was not
available.

Eight safety invariants are zero and the live map was checked visually. The
review queue grew from 100 to 559 entries.

Production's Places data no longer derives from a reproducible import of a
tracked candidate file; it is a copy of develop's accumulated state and carries
its artifacts (7 unlinked places, 47 duplicate normalized names). Full record:
`changes/2026-08-08-places-production-data-replacement.md`.

**A Production database password was exposed in a chat transcript during this
work and must be rotated.**

### Places promoted to Production (7 August 2026)

`main` is at `36fc98a` through PR #61. It carries the whole reviewed `develop`
history at `cc6590f`: the address contract, specs `007` and `008`, VibeSpec 2.3.0,
the CI alignment, the MapLibre renderer and its worker fix.

The handoff entry gate was satisfied first. The hungryconsti dry-run was re-run
from merged `develop`, read-only: Geoapify returned `amenity` / rank 1 /
`inner_part`, scoring returned `EXACT`, confidence 1, radius null, the importer
exited 0 without writing, and Neon develop was verified unchanged afterwards —
301 places, 313 links, the same single primary link. The connected branch was
identified by its data, not by its DSN name.

Release verification: CI green on `36fc98a`, `/api/health` reports `ok` and
`version: 36fc98a`, `/places` returns 200, the MapLibre worker starts from
`/maplibre/maplibre-gl-worker.mjs` and stays alive, `isSourceLoaded` is true, and
clusters were **confirmed visually on the live map** — not merely inferred from a
status code, because a blank map had passed CI and a review earlier the same day.

Expected user-visible change: spec `007` renders only `EXACT` and `PROBABLE`, so
Production now sources 12 map features out of 51 places. Approximate places remain
in the list, the review flow and the database. Confirmed as intended before
promotion.

Full record: `changes/2026-08-07-places-production-release.md`.

### develop consolidated (7 August 2026)

`develop` is at `78b3bbf` and carries, in order: `626aee5`, `0a933a1`, PR #58
(`9e3a749`), PR #59 (`439ec57`) and PR #57 (`78b3bbf`).

Four facts a previous session left unrecorded, corrected here:

- `626aee5` and `0a933a1` were **pushed directly to `develop` without a pull
  request** on 1 August 2026, contrary to `AGENTS.md` §8. Both are CI-green and
  both carry a spec with convergence `PASS` (`007` and `008`), so they are not
  reverted; the process deviation is recorded rather than hidden. Future work
  goes through a branch and a PR;
- `main` had received the CI standardization through PR #56 on 30 July 2026 and
  it had never come down to `develop`. The two branches validated with different
  pipelines, so a green `develop` PR was not evidence for Production. PR #59
  fixes this;
- PR #59 **cherry-picks** rather than back-merges. A trial `git merge origin/main`
  was run and rejected: the merge base is `67e3c1b` (PR #46), so every Production
  squash since — `66cfd78`, `8dbfd46`, `bebf680` — reads as new work on `main` and
  the merge produced four conflicts, two of which would have re-applied the
  pre-address-contract `places-scoring.test.ts` and `places-actions.test.ts` over
  the work merged by PR #52/#54. Do not back-merge `main` into `develop`;
- `bb77f56` is part of that cherry-pick and is not optional. `scripts/ci/check.sh`
  fails the job when validation modifies repository state, and `develop` shipped
  the `.next/dev/types` variant of `next-env.d.ts`, so every `npm run build`
  dirtied the tree.

Fresh gates on `develop` at `78b3bbf`:

```text
eslint . --max-warnings=0 ...... exit 0, zero findings
tsc --noEmit ................... exit 0
npm run test ................... 369 passed, 132 environment-bound skips (60 files)
npm run build .................. PASS
check.sh state guard ........... PASS, tree identical before and after
playwright --list .............. 47 scenarios in 6 files
```

The 132 skips are the PostgreSQL suites, which need `TEST_DATABASE_URL`. They are
not counted as executed. CI runs them, together with the worker PostgreSQL
invariants, the worker smoke and the Docker container contract, none of which are
runnable in the agent environment.

`git diff origin/main origin/develop -- .github/ scripts/ci/ next-env.d.ts` is now
**empty**: both branches validate with byte-identical CI. The remaining commit
divergence is SHA-level only, caused by squash merges and this cherry-pick, and
must not be read as missing work. Production promotion is prepared but not
performed — see section 8.

### Places address contract merged on develop (28 July 2026)

- PR #52 was squash-merged into `develop` at `71106cc`; the merge also
  reconciles the seven already approved Production commits and preserves the
  10 km radius correction;
- GitHub CI #153 passed, including PostgreSQL invariants, worker checks, unit
  tests, build and Playwright;
- Vercel Preview deployment `dpl_632ZKgw3HdT6XwuCfynP3RQkBZBc` is READY and
  its immutable deployment URL returns HTTP 200;
- VibeSpec: `specs/005-places-address-contract`, Critical;
- strict candidates now require bounded `address: string | null`; export schema
  is v3 and default analysis identity is `places-v2`;
- Geoapify receives a free-form address query when available and returns bounded
  rank/match-type evidence to deterministic scoring;
- address-authorized `EXACT` requires matching house number, specific result,
  provider rank at least 0.90, full/building match type (or `inner_part` at
  rank 0.95+), and no contradiction;
- a schema-v3 export of the single `hungryconsti` post from Neon develop passed
  with `business_writes=false`; the temporary export was removed afterward;
- the owner authorized the live single-post Geoapify dry-run. The real response
  is `amenity`, rank 1, `inner_part`; the refined scoring returns `EXACT`,
  confidence 1, radius null, and the importer exits 0 without writing;
- Neon develop still has the original single automatic approximate primary for
  this post after the dry-run, proving rollback. PR #54, squash `f98da30`, adds
  narrow atomic supersession for the later committed re-analysis while
  preserving user-confirmed links and historical places/evidence;
- CI #157 passed, including the PostgreSQL supersession invariant and
  Playwright. Vercel develop deployment `dpl_GWMGkdvQptBCz1icJidE6zUJM8vL` is
  READY and its immutable root returns HTTP 200;
- no Prisma migration, dependency, Production deployment, Neon write, candidate
  import, or existing place mutation is included. Production remains unchanged.

### Places usability correction released (28 July 2026)

- PR #49 merged on `main` at `8dbfd46`; CI #149 passed and Vercel Production
  deployment `dpl_HHKuBeSYf5L9izLHqCfMsyxmCNMh` is READY;
- VibeSpec `specs/004-places-mobile-usability` is Critical with convergence
  `PASS`;
- the mobile 2D/3D control is fully visible, `Retour aux posts` is available,
  public configured-owner post thumbnails load, and new city-like approximate
  results use 10 km;
- Neon backup `backup-main-before-places-radius-2026-07-28`
  (`br-curly-firefly-asy8hqti`) preserves the pre-change state;
- exactly 29 existing approximate rows were changed from 25 km to 10 km in a
  guarded transaction; no 25 km row remains and aggregate counts are unchanged;
- Production health, `/places`, a real 390 x 844 linked-post browser smoke and
  the initial Vercel runtime-error window all pass.

```text
Active code review branch: none; PR #52 is merged
Reference: main at bebf680; develop at 71106cc
Mode: critical
VibeSpec convergence: PASS for develop; Production gate remains pending

Production baseline:
- PR #45 deployed the DB-first extension convergence to `main` at `64f14cb`;
- the current promotion merges the complete reviewed `develop` history without
  discarding either Production hotfix commit.

Verified correction:
- PR #40 merged the extension/web refresh correction into develop at ba56573;
- PR #42 merged exact develop Preview support into develop at 2b877ba;
- the 4.2.6 follow-up makes the owner-scoped PostgreSQL snapshot authoritative
  for new/imported identity and preserves the legacy session arrays;
- extension archive and web ownership are separated;
- archive-only posts become durable reconciliation targets;
- a successful web sync aligns the extension archive to paired DB identities
  plus rows accepted during the run, including after a fresh installation;
- repeated Instagram cursors terminate;
- the web button observes its owner-scoped /api/sync/jobs/{id};
- the first terminal extension/server signal settles the UI once;
- duplicate running messages do not reset the watchdog; 90 seconds without a
  changed work checkpoint or durable job heartbeat becomes an actionable error;
- extension 4.2.6 allows the exact stable develop Preview at all three origin
  gates while preserving Production and localhost;
- arbitrary `*.vercel.app` deployments remain blocked.

Fresh gates:
- focused DB/extension/UI/media tests: 13/13;
- lint and typecheck: PASS;
- full unit suite: 329 passed, 129 skipped;
- production build: PASS, 32 pages;
- VibeSpec validation: 0 errors, 0 warnings;
- traceability: zero uncovered requirements;
- flat extension ZIP SHA-256:
  `E7EF63C70AC5054975A5B07C51BF6388EBC2048797719B6FE93008A237C5A48E`;
- git diff --check: PASS.

No migration, dependency, authentication, R2 permission or new API route is
included. The existing session response receives one additive `knownPosts`
field. Controlled Chromium discovers unpacked 4.2.6 on Production; authenticated
Preview and Instagram smoke plus Chrome Web Store publication remain operational
actions.

Phase F is CLOSED and COMPLETE.
Phase G is CLOSED and COMPLETE.
Phase I design is CLOSED and APPROVED (PR #35, squash 3fef818; ADR ACCEPTED).
Phase I implementation is CLOSED and COMPLETE (PR #36, squash 08be9f0).

CI #115 passed on reviewed head:
7477ac3c8e7f567051d3eb86cdf2fd91ddcbf1dc

Merge commit on develop:
08be9f04df60c9d8e138242fc0d7b0504e0ba51e

Performance validation:
FPS_BUDGET_VALIDATED_ON_REAL_GPU — closed 25 July 2026. Measured on an NVIDIA
GeForce RTX 5090 (ANGLE / Direct3D11): 240 fps and 276-326 ms first globe render
at 100, 500 and 1000 places, desktop and mobile viewport. All D6 budgets met.
No Phase I follow-up remains open.
```

### Places complete analysis JSON export

The tool on `codex/places-analysis-json-export` is verified and ready for review.
PR: `#46 — feat(places): export complete caption analysis JSON`.
It adds `npm run places:export-analysis-json` over the existing Phase F
caption-analysis workflow. It uses explicit develop/production database
variables, performs reads only, validates one strict JSON document, and writes
atomically below `.tmp`.

Fresh evidence:

- focused exporter and neighboring Places contracts: 45 passed;
- PostgreSQL caption workflow: 13 tests discovered but skipped without
  `TEST_DATABASE_URL`;
- full suite: 361 passed, 130 environment-bound skips;
- Prisma generation, lint, typecheck, build, and `git diff --check`: PASS;
- VibeSpec convergence: PASS;
- production smoke: correctly stopped with
  `TARGET_DATABASE_NOT_CONFIGURED`.

No production file exists yet. Configure `PLACES_PRODUCTION_DATABASE_URL` with
the intended read-only SSL DSN before running the command; never infer production
from the existing generic `DATABASE_URL`.

Phase G owner decisions remain final for the 2D implementation:

- Leaflet + `leaflet.markercluster`;
- Geoapify raster tiles with mandatory attribution;
- all canonical places loaded client-side because the expected maximum remains below 1000;
- no bbox/viewport querying and no map pagination;
- `PlacesMap` kept as a lightweight swappable abstraction;
- Apple-Plans-inspired minimal design;
- brunch provisionally folded into the café group;
- multi-select filters enabled.

Phase I owner decisions remain recorded as historical project context:

- `react-globe.gl` / `globe.gl` with Three.js underneath;
- Concept 2 sober with restrained Concept 1 elements;
- static public-domain Natural Earth texture with documented licence;
- additive `view=map|globe`, 2D default and independent cameras;
- full mobile 3D where WebGL is supported;
- accessible fallback to 2D;
- shared filters, search, selection, list, statistics and detail;
- no replacement of Leaflet.

The current unmerged follow-up supersedes the engine and map decisions above:

- MapLibre GL JS now powers both Mercator 2D and native globe projection;
- one MapLibre canvas/source is retained across 2D ↔ 3D switching when MapLibre is
  active; the no-raster 2D view intentionally remains on its no-map fallback;
- Leaflet, `react-globe.gl` and the old Three.js scene are no longer runtime dependencies;
- the local Natural Earth texture and the shared Places contract remain.

## 4. Merge proof

### Phase G

- PR: `#34 — feat(places): Phase G — Places 2D UI and contextual navigation`;
- reviewed head: `82a9760df92b5aa58f6a411c3f90bb07fb7cb46a`;
- squash merge on `develop`: `2bd2098472c65eeb24c52aa0ee893e09b8e20261`;
- CI run #107 completed successfully;
- no migration, no Prisma schema change and no breaking API change.

### Phase I design

- PR: `#35 — docs(places): Phase I — 3D globe design pack`;
- reviewed head: `d4f7cc87435de66a05d41b126294f1292413ab17`;
- squash merge on `develop`: `3fef818df96f127d5ba9486650a231f6ee2629b4`;
- ADR accepted and all six owner decisions closed.

### Phase I implementation

- PR: `#36 — feat(places): Phase I — implémentation du globe 3D (T1–T10)`;
- reviewed head: `7477ac3c8e7f567051d3eb86cdf2fd91ddcbf1dc`;
- squash merge on `develop`: `08be9f04df60c9d8e138242fc0d7b0504e0ba51e`;
- CI #115 completed successfully;
- review round 1 found a real FR-I-12 defect: the 3D chunk could be requested before the WebGL probe answered;
- final implementation has explicit `map | probing | globe` states and does not request the 3D chunk before proven WebGL support;
- Phase I tests consolidated to 18 unit, 8 component and 7 e2e scenarios;
- repository verification: 466 unit tests and 92 e2e passed;
- initial `/places` 2D JS increased by 4.2 KiB (+1.08 %);
- the 1.86 MiB 3D chunk is absent from the initial 2D entry;
- first globe render measured at 907–1033 ms with about 1000 places;
- no migration, no public API break, no Neon change and no secret committed.

## 5. Environment and deployment state

### Vercel

| Environment | Git branch | State |
| --- | --- | --- |
| Production | `main` | Isolated from development. |
| Preview development | `develop` | Tracks the merged Phase I implementation. |

Stable URLs:

```text
Production: https://insta-saved-post-explorer.vercel.app
Develop:    https://insta-saved-post-explorer-git-develop-l1nk4r1ms-projects.vercel.app
```

### Neon

Project: `fancy-mud-69762258`

| Environment | Neon branch | Verified schema state |
| --- | --- | --- |
| Production | `main` / `br-super-snow-asyrmnbm` | Phase C, F1 and Phase E queue migrations applied. Application commit `66cfd78` is deployed; the validated Places batch is imported. VPS worker activation remains pending. |
| Development | `develop` / `br-sparkling-glade-as9gow4m` | Phase C and F1 migrations applied. F2, F3, G and I require no migration. |

Do not run `prisma migrate dev`, `prisma db push` or seeds against either deployed database.

### Places Production release (28 July 2026)

- PR #47 merged after CI #145 passed, including PostgreSQL, worker, browser and
  production-build jobs;
- Vercel deployment `dpl_2GFsngT1j5DtoypxtnGFpobUu4Po` is `READY`; `/api/health`
  reports database connected and version `44b0da0`;
- the Phase E queue migration was rehearsed on a disposable Neon branch and
  promoted transactionally with checksum
  `4c7b1d89faf0690bc9927f5966f12163403544e3a0bbd1159b8de153e7129bae`;
- rollback branch `backup-main-before-phase-e-2026-07-28`
  (`br-bold-salad-asxuxn2s`) is retained;
- candidate file SHA-256:
  `27d9f9e69631190cbe4cf344a64fe82e7f67a441bf19faba4844770204cc4a87`;
- import report: 407 valid, 0 invalid, 307 succeeded, 100 need review,
  0 failed, 154 unknown candidates and 0 errors;
- final unique aggregates: 51 places, 301 links, 254 linked posts,
  1,203 evidence rows and 407 analysis jobs;
- invariants: 0 failed/errored jobs, 0 owner mismatches and 0 approximate
  places without a radius;
- Production `/places` returns HTTP 200 and renders 51 places / 254 posts;
  Vercel reports no runtime error after release.

## 6. Phase state

| Phase | State | Reason |
| --- | --- | --- |
| C — R2 media identity and worker isolation | COMPLETE | PR #24; migration applied to Neon `main` and `develop`. |
| D — External API V1 | COMPLETE | PR #26. Distributed rate limiting remains deferred. |
| E — Global worker foundation | SCHEMA DEPLOYED, VPS ACTIVATION PENDING | PR #39 code and the additive queue migration are on Production. No VPS deployment or worker activation is claimed. |
| F — Places metadata-first domain | COMPLETE | F1/F2/F3 and hardening merged; exit gate accepted. |
| G — Places 2D UI | COMPLETE | PR #34, squash `2bd2098`; CI #107 green. |
| H — Deep Places analysis | BLOCKED | Requires Phase E operational activation and stable worker infrastructure. |
| I — Places 3D globe | COMPLETE | PR #35 design + PR #36 implementation merged. CI #115 green; WebGL lazy loading corrected; tests consolidated; no migration. Its Three.js runtime is superseded on `develop` by PR #57. |
| I follow-up — MapLibre 2D + globe renderer | MERGED ON DEVELOP, D6 DEROGATED | PR #57, squash `78b3bbf`. CI green under the standardized pipeline. The FPS budget is **not** measured on real hardware — see section 7. |
| J — Unified MCP and Hermes | BLOCKED | Requires later orchestration decisions and confirmations. |
| Places v5 international addresses | CONTRACT DRAFTED ONLY | Spec `006`, convergence `PENDING`. No implementation, no model call, no data write. Blocked on Phase H activation, an OpenAI key, an owner-approved spend cap and an explicit caption-egress authorization. |

## 6.1 Test suite baseline (25 July 2026)

The global suite was audited and consolidated in a dedicated PR (documentation:
`changes/2026-07-25-global-test-suite-consolidation.md`). Current baseline:

```text
unit ...... 60 files, 369 passed + 132 environment-bound skips, ~20-56 s
e2e ....... 47 scenarios in 6 files
```

Measured on `develop` at `78b3bbf` on 7 August 2026. The 25 July figures below
(54 files / 448 tests, 46 scenarios) describe the consolidation itself and are
kept as the rationale, not as the current count. The renderer migration replaced
the Three.js globe suites with MapLibre equivalents, which is why the file count
rose while the executed-test count fell.

Desktop is the default Playwright project and runs everything; the mobile project
runs only `@mobile`-tagged scenarios. Every viewport-sensitive test sets its own
viewport, so running it on both projects duplicated identical work — that was the
suite's largest single cost and it is removed.

The 11 PostgreSQL suites (129 tests, 61 % of unit time) are deliberately untouched:
ownership, composite FKs, idempotence, the P2002 regression, cursors, atomic
transactions, worker isolation and audit completeness.

## 7. Open decisions and operational follow-ups

- ~~**Historical Phase I GPU measurement**~~ — **closed 25 July 2026** for the superseded Three.js renderer, status `FPS_BUDGET_VALIDATED_ON_REAL_GPU`. Measured on an NVIDIA GeForce RTX 5090: 240 fps and 276-326 ms first render at every place count, desktop and mobile viewport. That evidence does **not** validate the MapLibre renderer, which replaced that runtime.
- **MapLibre D6 FPS budget — OPEN, EXPLICITLY DEROGATED on 7 August 2026.** PR #57
  was merged into `develop` with this gate unsatisfied, on an explicit owner
  decision, so the renderer work is not held hostage to hardware the agent
  environment does not have. What is and is not proven:
  - **proven**: first render stays below 1.2 s; lint, typecheck, 369 unit tests,
    build, browser tests and the repository state guard are green under the
    standardized CI;
  - **not proven**: the D6 frame-rate budget of 50–60 fps desktop and at least
    30 fps mobile. The only figures that exist are software-rasterized — 35–38 fps
    desktop and 23–24 fps mobile viewport on SwiftShader;
  - **why no better figure exists**: the agent host has a paravirtualized
    Red Hat Virtio 1.0 GPU. Chromium was probed under three configurations —
    defaults, `--use-angle=vulkan --enable-features=Vulkan`, and
    `--use-gl=egl --ignore-gpu-blocklist --enable-gpu-rasterization`. The first
    and third both report
    `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`;
    the second loses WebGL2 entirely. There is no hardware path, so re-running
    the harness here can only reproduce the numbers already recorded;
  - **how to close it**: on a machine with a real GPU, point `DATABASE_URL` at a
    local throwaway PostgreSQL, build with `NEXT_PUBLIC_PLACES_BENCHMARK=1`,
    serve it, then run `npm run places:measure-globe`. The harness refuses any
    `DATABASE_URL` that does not look local. Report the measured number as
    measured; do not relax the budget;
  - **risk accepted**: a genuine frame-rate regression in the MapLibre renderer
    would not be caught by CI until that measurement is run.
- server-side AI providers, models, budgets and escalation thresholds for Phase H;
- VPS credentials, firewall, backups, alerting and deployment authorization for Phase E;
- final confirmation model for sensitive Phase J commands.

## 8. Exact next action

Ordered. Items 1 and 2 gate the Production promotion; nothing below item 3 may be
used to bypass them. The previous revision listed the same instruction twice as
items 3 and 4; that duplicate is removed.

1. **Provide credentials.** No `.env` file exists in the repository — only
   `.env.example`. The dry-run cannot run without `DATABASE_URL` (Neon `develop`)
   and `GEOAPIFY_API_KEY`. Never infer a Production DSN from a generic
   `DATABASE_URL`.
2. **Re-run the single hungryconsti dry-run from the merged PR #68 application
   revision `056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe` on `develop`**,
   read-only, before any data write. The earlier run at `f98da30` returned
   `amenity` / rank 1 / `inner_part`, scored `EXACT` at confidence 1 with no
   radius, and the importer exited 0 without writing. A merged-revision rerun is
   required because `develop` has moved since.
3. **Then promote `develop` → `main`.** Prepare it as a pull request; the merge is
   a Production deployment and needs explicit owner authorization at that moment,
   not inherited from an earlier one.
4. Treat any single-post `--commit` on Neon develop as a separate owner decision;
   verify one exact primary, zero stale automatic approximate link, and preserved
   historical place/evidence after any approved write.
5. Replace files in the existing unpacked extension directory with
   `C:\tmp\insta-saved-sync-v4.2.6-db-first.zip`, reload the extension and run the
   Preview smoke in `specs/002-extension-web-sync-reconciliation/08-release.md`.
   Operator action; it cannot be performed from the agent environment.
6. Confirm extension discovery on the stable develop alias, click
   **Actualiser les posts**, and compare the extension count with the Preview
   library count.
7. Reload the exact 4.2.6 package against Production and confirm a refresh imports
   DB-missing posts, terminates, and a second refresh reports zero only when the DB
   and extension index are aligned.
8. Close the MapLibre D6 FPS derogation on real hardware — see section 7.
9. Keep Phase H blocked until Phase E VPS operational activation is separately
   approved.
10. Keep spec `006` (Places v5 international addresses) blocked until an OpenAI
    key, an approved spend cap and an explicit caption-egress authorization exist.
11. Keep worker activation, Hermes, MCP, OCR, transcription and multimodal
    analysis outside this correction.
12. Use a branch and a pull request for every change. Two commits reached
    `develop` directly on 1 August 2026; that must not recur.

## 9. MapLibre 2D + globe renderer — merged on develop

PR #57, squash `78b3bbf`, merged 7 August 2026. This supersedes the historical
Phase G Leaflet and Phase I Three.js renderers in
`src/features/places/components/places-map.tsx`. It is **not** part of the PR #34
or PR #36 merge proofs, which stay as historical records of the runtime it
replaced.

The renderer uses MapLibre GL JS with native Mercator 2D and globe projections,
native GeoJSON clustering and the same raster tile and attribution contract. One
MapLibre canvas and source is retained across 2D ↔ 3D switching; the no-raster 2D
view intentionally stays on its no-map fallback. Leaflet, `react-globe.gl` and the
Three.js scene are no longer runtime dependencies; `three-globe` remains only as a
build-time source of texture data. The local Natural Earth texture, the WebGL2
gate and the shared Places server contracts are unchanged.

Merged with the D6 FPS budget derogated, not satisfied. Section 7 records exactly
what is proven, what is not, why no better measurement exists here, and how to
close it.

**PR #57 shipped a blank map, fixed the same day.** MapLibre 6 locates its worker
from `import.meta.url`, which Turbopack does not expose as an http(s) URL inside
the bundled chunk. MapLibre fell back to `new Worker("")`, which does not throw:
the worker loaded the HTML document, died on the parse error and closed silently,
leaving every GeoJSON source unloaded. Raster tiles kept rendering, so `/places`
looked healthy while drawing zero places. The renderer now calls `setWorkerUrl`
against copies served from `public/maplibre`, kept in sync by
`scripts/places/sync-maplibre-worker.mjs` on `prebuild`. Full record:
`changes/2026-08-07-maplibre-worker-url.md`.

Two process facts worth keeping: CI, an independent review and the D6 discussion
all passed over a map that rendered nothing, because the database-less e2e
environment has no marker to assert on and the suite only checked that a canvas
was visible. The defect was found by looking at the running Preview.

This renderer is on `develop` only. Production still serves the Three.js and
Leaflet runtime until the promotion in section 8 is performed.
