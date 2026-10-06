# Full classification of long originals — 6 October 2026

Three original videos exceed the previous classification media limits. The owner
approved including them with complete audio and distributed video frames, and
requested correction of categories and automatic tags throughout the existing
library while preserving protected tags.

The slice reuses the shared extractor with an explicit classification policy:
600 MiB MP4, sixty-minute actual duration, ninety-minute job/process deadline,
ten-minute download bound and two-hour signed owner/version-restricted reads.
Images retain 250 MiB; Places retains its fifteen-minute, 250 MiB, three-minute
download, ten-minute process and thirty-minute signature defaults. The download
bound now covers the entire body, closing an observed headers-only timeout gap.
The model, themes, proposed-tag count, ownership, leases, manual fences, deleted
posts, canonical original paths and successful V1 jobs stay compatible. There is
no migration, provider/dependency, extra service, sync schedule or Places requeue.

## Requirements and proof matrix

See [approved specification](../superpowers/specs/2026-10-06-classification-long-videos.md)
and [implementation plan](../superpowers/plans/2026-10-06-classification-long-videos.md).

| Requirement | Evidence |
| --- | --- |
| REQ-001 numeric media bounds | Classification app contract and worker claim tests; PostgreSQL 600 MiB acceptance with image/video over-limit failures |
| REQ-002 full media | Real sixty-minute video/audio fixture, independent full WAV duration assertion, final spoken segment passed to inference, twelve frames from 0 to 3,599,000 ms; 3,601-second rejection |
| REQ-003 deadlines/signatures | Ninety-minute runner abort, customized child-process deadline, full-body stalled-download abort, PostgreSQL signed query expiry 7,200 seconds |
| INV-001 Places compatibility | Existing Places 450/900/901-second tests and PostgreSQL classification-only size acceptance; default signatures still 1,800 seconds |
| INV-002 protected state | Existing and extended transactional/manual-tag/ownership/replay tests; private live bulk snapshots compared with initial digests |

## Verification and rollout

Regression tests were watched fail before changes: media/duration rejection,
short result deadline, 1,800-second classifier signature, twenty-minute runner
abort, ignored process override and a stalled body exceeding its download bound.
Focused app31/31 and worker23/23 pass, including cross-layer media and complete
sixty-minute extraction. Application642/642 and worker113/113 pass on disposable PostgreSQL, with
three transcription tests, lint, app/worker type checks and both builds. The
initial app build was blocked by sandbox-local port binding; the reviewed-access
build passed. The three transcription and two Python installer tests pass.
Independent review has no remaining findings. PRs #117/#119 and release #118
passed quality/browser CI and are merged. The reviewed source tree is
`907407a49f2fedebc79d346185cd3b62ce086701`; the web deployment of
`26f78b5cb5e679e4bd4332ed9422c3537c582915` finished and is healthy. Sync keeps
its existing image/cron, web classification capabilities are unchanged and the
initial auto-deployment settings were restored.

The verified 20261006 compatible consumer runs temporarily under the canonical
lock. All three original long videos are admitted with their original bytes.
The first 50.91-minute, 344,787,655-byte video succeeded on attempt one with
complete audio transcription, twelve timeline frames and five proposed tags.
The other two long videos and full library batch remain in progress.
Ordinary pending jobs without prior backoff are held temporarily for the pilot,
with exact IDs and previous schedules journaled; a conditional release restores
only those unchanged holds. They also expire at 06:00 UTC on 6 October.

All 3,910 historical posts have durable jobs. Eleven missing originals were
recovered without recreating posts; the last uses identity-verified official
DASH video/audio, fully decoded and remuxed without reencoding or trimming.
Its R2 upload is conditional on absence and existing objects must match exact
MD5, size and MIME. Media identity and job input were rebased through existing
business guards with named audits. Temporary recovery bytes were deleted.
The 01:31 UTC snapshot has 121 successes and 18 changed categories; protected
manual/imported tag links, deletion tombstones and Places fingerprints match
the baseline. Queue and audit remain authoritative after that snapshot.

Deploy web validation first, then the reviewed consumer, then admit large media.
Preserve the previous immutable release. On rollback keep queue/audit and larger
originals; stop consumption/admissions rather than hand them to an old client.
Temporary supervised processing is not permanent systemd activation. The latter
requires actual root handover and a fresh active/enabled/lock/startup check.

## Why the new test file exists

`classification-long-media.test.ts` protects full sixty-minute audio and final
frames, rejects overlong media, and verifies complete-download/process deadlines
without changing Places defaults. Other regressions extend existing test files.
