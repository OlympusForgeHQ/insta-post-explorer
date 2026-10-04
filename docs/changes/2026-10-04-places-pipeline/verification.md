# Places multimodal integration verification

**Date:** 2026-10-04
**Revision:** production `810ad4151dd44bf41ed4a6ccfd9600247af35643`, release PR #93

## Evidence

| Claim | Command or observation | Result | Evidence summary |
|---|---|---|---|
| Owner-only categories/provenance | App PostgreSQL suite | Pass | cafe wins over provider fast_food; filters and confirmed edits protected |
| Queue/auth/atomicity | App PostgreSQL suite and real route adapter tests | Pass | owner scope, concurrent claim/completion, replay, expiry, stale/deleted inputs, invalid bodies |
| Complete media/cleanup | Worker suite with real FFmpeg fixtures | Pass | serial jobs, interruption cleanup, download bounds, corrupted MP4 rejection |
| Retry after committed response interruption | Worker transport regression | Pass | identical complete body retried after broken HTTP response body |
| Geographic identity | Resolver/scoring suite | Pass | named business retained only near verified address; apostrophes/postcodes/districts and street-first house numbers |
| Full app suite | TEST_DATABASE_URL=… npm test -- --reporter=dot | Pass | 570 tests, 74 files; disposable PostgreSQL 16, no skipped DB tests |
| Full worker suite | TEST_DATABASE_URL=… npm run worker:test | Pass | 85 tests, 12 files; no skips |
| Quality | npm run lint; npm run typecheck; npm run worker:typecheck | Pass | all exit 0 |
| Builds | npm run build; npm run worker:build | Pass | Next.js production and Node worker builds |
| Migration rehearsal | Isolated schema/migration bundle on disposable divergent-history DB | Pass | new enum values only, historical entry preserved |
| Independent review | Fresh reviewer and follow-up | Pass | four important findings corrected; 8 worker and 56 geographic tests independently rerun |
| Real multimodal analysis | Named existing example through installed Hermes/OpenRouter | Pass | 42.768 s video, 12 frames, 11 transcript segments, one cafe candidate; 57.351 s total |
| Geographic preview | Named-post pilot, zero writes | Pass | same canonical provider identity, EXACT 0.92, cafe; caption/audio/OCR evidence |
| Browser category journey | Places disposable harness + Chromium | Pass | real cafe filter and category detail badge, 2 tests |
| Production persistence/browser | Authorized named-post pilot | Pass | existing place/link updated to cafe, EXACT; nine evidence records, atomic audit, live navigation/category/Maps |
| Production deployment | Coolify deployment receipts and runtime health | Pass | web and sync finished on release SHA; isolated Places service active; normal main tracking restored |
| Cleanup | Local workspace and private input/result inspection | Pass | zero temporary media; private candidate and signed-media payload files removed |

## Original scenario and traceability

AC-001–003 verified. Geoapify category strings no longer classify Places. Model
coordinates/provider IDs/extra fields are rejected. Real analysis uses three
DeepSeek V4.1 Flash calls with 13,680 input and 2,058 output tokens, according to
reported usage; no claim about billed cost. Actual configured model route was
checked before execution. Audio is local Whisper small int8 with language detection.
The real pilot exposed the PyAV 19 incompatibility; pinning 18.0.0 fixed it.

AC-004 and AC-005 pass. The final production run completed in 60.412 seconds with
13,761 input and 2,106 output tokens. The existing place and association retained
their identities, with no duplicate. The nine new evidence records include
CAPTION, HASHTAG, AUDIO_TRANSCRIPT, VIDEO_OCR and PROVIDER_MATCH. The job completed
with a cleared lease; place, link, evidence and completion audit events share one
database transaction. The live browser verifies the owner category, associated
post, map canvas and Google Maps link with no page errors. Private receipts under
`.tmp/places-pipeline-release` retain identifiers and metrics, not candidate
excerpts or signed URLs. Temporary media and the private input/result files were
removed. Final release evidence is also recorded on PR #93.

## Limits

Up to 12 sampled frames can miss fleeting on-screen text. Uncertain/unresolved
candidates stay reviewable; they do not create invented pins. No website crawling
is added by this slice. Only content-supported categories are proposed, otherwise
Divers. Processing limits are documented in the API/operations guide.

The measured 30–50-post gate, accuracy review and unattended scheduling are not
complete. No all-library job execution was started. Production migration history
is divergent: only the reviewed isolated additive migration bundle may be used.

Sandbox port restrictions required rerunning build/network tests with local
network permissions. Initial node_modules symlink prevented Turbopack resolution;
a private dependency copy fixed the worktree environment. Neither affects product
behavior. Existing jsdom canvas warning remains non-fatal.
