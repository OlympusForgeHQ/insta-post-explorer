# Classification throughput with an uninterrupted active job

**Mode:** Critical (production service rollout)  
**Status:** Deployed and verified; historical queue continues
**Owner:** Application owner; authorization in the 8 October conversation

## Problem and measured baseline

The historical classification queue is progressing serially. A measured sample
of 38 successful posts averaged 54.6 seconds preparing media and full audio,
24.1 seconds waiting for inference, and 78.6 seconds analyzing each post. The
consumer then waits another 15 seconds even when the queue contains work.
The host has 16 logical CPUs; the service is capped at one CPU despite ASR using
two threads. The owner authorizes improving performance while preserving the
work currently running.

## Requirements and acceptance

- `REQ-001`: Trial two CPUs live without changing the PID, start time or restart count,
  then configure four CPUs and four ASR threads for the reviewed replacement.
  Keep the shared transcriber default at two threads for Places.
- `REQ-002`: After a successful classification, attempt the next job promptly.
  Preserve the 15-second wait for an empty queue and unsuccessful job outcomes,
  and the 60-second wait after an unexpected polling/cleanup error.
- `REQ-003`: Preserve serial execution, owned leases, heartbeats, full-media
  coverage, cleanup, manual tags, deletions and existing Places.
- `REQ-004`: Activate changed program code only after the current job completes.
  Use the verified old consumer’s 15-second pause after an acknowledged
  completion; never signal an analyzing consumer, reset a job or change scheduling.
- `REQ-005`: Keep a release and resource rollback, record all operational changes
  privately, and observe actual successful jobs after activation.
- `NFR-001`: No fixed 15-second gap between successful jobs with work available.
- `NFR-002`: No unbounded polling on idle/error and no new parallel inference.

## Architecture and scope

The same service, API, PostgreSQL queue, canonical flock, models and media limits
remain authoritative. CPU accounting changes through systemd's live property
interface. A small consumer loop seam makes scheduling behavior testable.
No migration, dependency, public API change, sync deployment or Places run is
required. Persistent ASR and batched inference remain separate potential work;
the measured CPU and scheduling changes are the bounded first optimization.

## Rollout and recovery

1. Record the current process identity, service properties and queue.
2. Trial two CPUs live, verify unchanged process identity, and observe continued
   completion while preparing/testing the consumer change.
3. Build an immutable release and verify integrity before any handover.
4. Verify the actual old CLI hash and its unconditional 15-second pause. Watch
   the current boot/unit/Node PID journal for an acknowledged successful completion.
   Recheck identity and monotonic event age (maximum two seconds) immediately
   before stopping the old unit. If the window is missed, leave it running.
   After its process disappears and the canonical flock is free, replace only
   the unit and ASR script path in the private environment, then start the release.
5. Verify successful jobs, inter-job timing, protections and unrelated services.

If no fresh completion arrives within the bounded watch, leave the old consumer
running. Before the replacement starts, failed activation restores the saved unit
and private environment. After it starts, do not blindly stop it on verification
failure: it may already own a job and no longer has a success pause. Diagnose and
allow that job to finish before any further replacement. Resource rollback can
be performed live without a restart. No rollback resets completed jobs.

## Risks and test seams

The primary hazard is interrupting a job. This one-time handover relies on the
verified old pause and prompt local journal delivery; journal timestamps measure
receipt, not emission. Process/boot identity and a strict freshness check reject
stale observations. The mechanism must not be reused for the new immediate loop.
Resource gains vary with audio, network and provider latency; throughput
comparisons are observations, not a promise of linear CPU scaling.

| Requirement | Evidence seam |
| --- | --- |
| REQ-001 | Live systemd properties and same process identity before/after |
| REQ-002, NFR-001/002 | Consumer loop timing tests with controlled work outcomes |
| REQ-003 | Existing lifecycle/lease tests, protected database fingerprints |
| REQ-004 | Operator refusal/timeout/recovery tests and actual handover receipt |
| REQ-005 | Release hashes, rollback checks and post-activation completions |

Verification results and independent review will be recorded before activation.

## Measured ASR choice and verification

A private copy of one 60.395-second audio was transcribed five times in sequence
with the installed small/int8 model, beam five and VAD unchanged. Two-thread
runs took 41.889/43.632 seconds, three threads 32.933, and four threads
26.189/28.423. Every transcript and timestamp was identical. Four threads reduced
sample ASR elapsed time by 36.1% compared with the two-thread mean; this is not a
whole-pipeline or universal throughput promise. No provider/model switch is made.

Local validation: app 644/644 and worker 120/120 tests passed with a disposable
local PostgreSQL database, plus lint, app/worker types and builds. ASR tests cover
unchanged default two, accepted thread counts and rejection outside 1–4; four
Python tests pass, as do two installer tests. The scheduling regression failed
with the original unconditional delay and passes with the new loop. Seven loop
cases protect serial cleanup-before-next-job, idle/error waits and shutdown.
Independent source and handover design review found no remaining functional issue.

Private receipts, release manifest and logs are under
`.tmp/classification-performance-20261008/`; no transcripts, post identifiers or
secrets are published. Runtime activation evidence is recorded below.

## Production activation and observations

PR #125 merged to develop at `bb3d5e3` after quality and browser CI #307 passed;
the merged tree exactly matches the reviewed source. Main remains `5620a9d`.
The classifier-only immutable 20261008 release became active at 09:58:40 UTC
on 8 October. The old job completed successfully at 09:58:37; the controller
confirmed the old process stopped about 0.11 seconds after the journaled acknowledgment,
inside the verified old 15-second pause. No active analysis was cancelled or
requeued. The old process exited and released its canonical flock before the
replacement started. Seven operator guard tests and independent review passed.

Effective process environment selects the 20261008 transcriber and four threads.
Systemd confirms a four-CPU quota, the unchanged 2 GiB memory cap, active/enabled
service and zero restarts. The unit persists both CPU/thread settings across
reboots; the prior live trial override now also reads 400%. The private environment
change updates only the ASR script path; old secrets/unit are backed up privately.

At 10:00:52 UTC three new jobs had completed successfully: a six-image carousel
and two videos with complete ASR and eight/twelve frames. The next jobs started
149.8–166.9 milliseconds after successful completion, replacing the old fixed
15-second pause. Memory peak was about 803 MiB. This small live sample confirms
the scheduling/configuration change, not a long-term posts/hour guarantee.

The 10:00:39 UTC database snapshot has 2,392 successes, one processing, 1,526
pending and the four pre-existing failures across 3,923 jobs. All 2,763 protected
manual/imported tag links compare unchanged per post; deletion and Places
fingerprints also match. No failed post was retried by this optimization.
Web/sync remain healthy; main, auto-deploy settings and the exact sync schedule
are unchanged. Private operational receipts and the historical CSV are updated.
The full library batch is still running under the existing durable queue.
