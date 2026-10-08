# Operational Handoff

Last updated: 6 October 2026
Repository: `OlympusForgeHQ/insta-post-explorer`  
Reference development base for classification: `develop` at `586a97a`
Current classification web release: `main` at `5620a9d`
Sync retains its previous image and hourly recovery command.
Older phase references below are historical.

## Classification throughput — 8 October 2026

The owner authorized optimization without interrupting the active analysis.
The two-CPU live trial preserved the PID/start time and zero restarts. The reviewed
replacement removes the fixed 15-second success delay and configures four CPU
threads, supported by five identical-transcript ASR trials (about 43 → 27 seconds).
Manual tags, deletions, Places, full audio and serial inference remain protected.
Local app/worker gates passed; release activation and post-rollout observation
are pending. Web/main and the sync image/schedule are outside this worker-only
rollout. The library batch is still running; this is not a batch completion claim.
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
its artifacts (7 unlinked places, 47 duplicate normalized names). F…15526 tokens truncated…ts original one
  approximate primary because the run was non-committing. PR #54 is merged at
  `f98da30`; CI #157 and the READY develop Preview pass. A final merged-revision
  dry-run remains required before any separately approved data write.
- PR #40 extension/web reconciliation is merged at ba56573 and PR #42 exact
  develop Preview support is merged at 2b877ba. The 4.2.6 DB-first follow-up
  preserves the additive legacy contract, repairs the no-progress watchdog and
  has fresh local verification. Extension reload and authenticated smoke remain.
- Production Places data was replaced on 8 August 2026 with develop's dataset:
  301 places, 182 map-visible, 180 linked posts, review queue at 559. Destructive,
  owner-authorized, rollback branch backup-main-2026-08-08. See
  changes/2026-08-08-places-production-data-replacement.md.
- Phase H and Phase J remain blocked.

Reference develop implementation
`a91f254`, including PR #52, PR #54, specs 007 and 008, PR #58, PR #59, PR #57,
the 4.2.6 DB-first synchronization correction, PR #68 (globe projection fix),
and PR #71 (D6 harness repair and DB error logging).

Reference production base
`daaca2c` (merge commit, 24 August 2026). `main` and `develop` are aligned.
Production now includes: the address contract, specs 007/008, VibeSpec 2.3.0, CI
alignment, MapLibre renderer, worker fix, continuous globe, vector style support,
projection regression fix, D6 harness repair and DB error logging. The full delta
was validated by a 3-agent Fable review before alignment.

Recorded proof for Phase I
- PR #36 reviewed twice and squash-merged after the WebGL lazy-load defect was fixed.
- Phase I performance validated on real GPU hardware (NVIDIA GeForce RTX 5090, ANGLE/D3D11):
  240 fps and 276-326 ms first globe render at 100, 500 and 1000 places, desktop and
  mobile viewport. All D6 budgets met.
- Status: FPS_BUDGET_VALIDATED_ON_REAL_GPU.
- No Prisma migration, no public-contract break, no Neon change, no secret.

Recorded proof for global test consolidation
- PR #38 squash-merged with zero production-code changes.
- Unit tests: 466 -> 448.
- E2E scenarios: 56 -> 46.
- E2E executions: 112 -> 46; mobile executions: 56 -> 1.
- CI #121 green.
- PostgreSQL ownership, idempotence, P2002, transactions, worker isolation,
  security boundaries, API contracts and FR-I-12 lazy-loading regression preserved.
```

## Next agent action

1. Configure `DATABASE_URL` and `GEOAPIFY_API_KEY`. The repository has no `.env`,
   only `.env.example`, so the Places dry-run cannot run.
2. Re-run the read-only hungryconsti dry-run from the merged PR #68 application
   revision `056cfdda1de4b697bf4c4f4ae4a0dc88cb982abe` on develop, then promote
   develop to main as a reviewed pull request. The merge is a
   Production deployment and needs owner authorization at that moment.
3. Close the MapLibre D6 FPS derogation on a machine with a real GPU: local
   throwaway PostgreSQL, build with `NEXT_PUBLIC_PLACES_BENCHMARK=1`, then
   `npm run places:measure-globe`. The Phase I RTX 5090 evidence validated the
   Three.js runtime and does not transfer to MapLibre.
4. Use the consolidated baseline for future PRs; do not reintroduce duplicate desktop/mobile E2E executions without a real device-specific behavior.
5. Reload extension 4.2.6 from `C:\tmp\insta-saved-sync-v4.2.6-db-first.zip`
   in the existing Chrome extension directory and run
   the documented stable develop Preview smoke.
6. Phase H remains blocked until Phase E VPS operational activation is separately authorized.
7. Spec `006` (Places v5 international addresses) remains blocked until an OpenAI
   key, an approved spend cap and an explicit caption-egress authorization exist.
8. Keep Phase E activation, H and J in separate changes; do not mix worker operations, deep analysis, Hermes or MCP work.
9. Branch and open a pull request for every change; never push to develop directly.

## MapLibre 2D + globe renderer — merged on develop

PR #57, squash `78b3bbf`, merged 7 August 2026. It supersedes the historical
Phase G Leaflet and Phase I Three.js renderers in
`src/features/places/components/places-map.tsx`. The historical Phase G and
Phase I status rows are deliberately left intact: they record the runtime that
was shipped and validated at the time, and Production still serves it.

The first-render budget passes. The D6 FPS budget does not: it was derogated,
not met. `HANDOFF.md` §7 holds the full record — what is proven, what is not,
why no better measurement exists in the agent environment, and the exact
procedure to close it. Change record:
`docs/changes/2026-08-03-maplibre-2d-renderer.md`.
