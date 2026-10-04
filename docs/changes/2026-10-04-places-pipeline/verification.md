# Places multimodal integration verification

**Date:** 2026-10-04
**Revision:** feat/places-analysis-pipeline (reviewed working tree)

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
| Production persistence/browser | Named-post pilot | Pending | explicit owner authorization; awaiting deployment |

## Original scenario and traceability

AC-001–003 verified. Geoapify category strings no longer classify Places. Model
coordinates/provider IDs/extra fields are rejected. Real analysis uses three
DeepSeek V4.1 Flash calls with 13,680 input and 2,058 output tokens, according to
reported usage; no claim about billed cost. Actual configured model route was
checked before execution. Audio is local Whisper small int8 with language detection.
The real pilot exposed the PyAV 19 incompatibility; pinning 18.0.0 fixed it.

AC-004 geographic preview passed; write/browser checks remain pending. AC-005 code-level
gates and review pass; production/browser verification is not yet claimed.
Temporary raw media have been removed. Detailed candidate output is held privately
for the pending pilot, excluded from Git/logs, and must be removed afterwards.

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
