# Places pilot: bounded inference repair and video frame timing

## Scope

The owner requested a 40-post test split across Restaurant and Voyages, followed
by review and correction of the eligible library only after the pilot passes.
The sample is fixed before analysis; failed posts are retried, never replaced.
Private captions, transcripts, media identities and operator review payloads stay
outside Git. Geographic verification and the broad backfill are separate from
the code verification below; this change does not declare the pilot complete.

The initial pilot exposed two execution failures: a model sometimes adds fields
outside the strict candidate schema, and a video's container duration can exceed
its video stream duration because the audio track continues after the last frame.

## Behavior and acceptance criteria

| Requirement | Implementation | Evidence |
|---|---|---|
| Repair malformed model content once without weakening validation | Reuse the original source/schema with fixed feedback; at most two calls share one deadline; both usages are counted | Inference regression suite |
| Do not retry cancellation, HTTP failure or the wrong response model | Validate transport/envelope separately from candidate content | Inference failure table |
| Never accept coordinates or extra fields through repair | Both replies pass the same strict schema; invalid output is not injected into retry context | Inference rejection regression |
| Sample actual video frames while retaining complete audio | Bound frame timestamps by video stream duration/frame rate; keep container duration for audio extraction/coverage | Real FFmpeg audio-tail and low-frame-rate fixtures |
| Return stable media errors without local paths | Frame read failures become MEDIA_UNAVAILABLE | Existing media failure coverage and review |

No schema, dependency, API contract or deployment topology change. No new
scheduling or automatic bulk execution. Existing confirmed corrections, owner
scope and deletion protection remain governed by the application API.

## Verification

- Application: 570 tests pass against disposable PostgreSQL 16.
- Worker: 90 tests pass, including all database tests.
- Lint, application and worker type checks, and application production build pass.
- Worker TypeScript build passes into an isolated output directory, preserving
  the baseline worker used by the ongoing sample. Real-post retry receipts are
  recorded before production integration.
- Independent code review found no blocking issue. Its suggestions to assert a
  shared retry signal and the complete extracted WAV duration are included.
- Initial sandbox-only worker failures were local HTTP listen restrictions; the
  full rerun with local network permission passes.

New test file `services/worker/tests/places-inference.test.ts` is necessary to
protect strict-schema repair, bounded provider spend, cancellation and accounting.
The added table in `places-media.test.ts` protects the real last-frame failure
without truncating the audio track.

## Pilot quality gate

Review exact excerpts, recognized names, classification, branch/address identity
and geographic precision separately. An absent address or ambiguous chain branch
is not an exact location. Owner categories come only from supported content, never
Geoapify classifications. Retain raw and reviewed results separately so manual
corrections cannot inflate the measured automatic accuracy. Record failed-attempt
tokens as well as successful usage. Delete downloaded media after every attempt
and after manual image inspection. Do not call this gate passed until geographic
resolution and persisted Places results have also been checked.

## Rollback

Revert this patch and rebuild the worker. There is no database migration or data
rollback. Preserve private pilot checkpoints for review rather than re-running
successful model calls unnecessarily.
