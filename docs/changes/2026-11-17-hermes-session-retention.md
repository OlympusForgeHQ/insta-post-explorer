# Hermes session retention

## Incident

From 14 November 06:02 to 17 November 14:54 every classification, caption
translation and Places inference failed (`INFERENCE_FAILED`, family
`PROVIDER_ERROR`). Syncs of 15, 16 and 17 November imported seven posts whose
analyses never ran; no address was found.

The Places Hermes gateway (`insta-explorer-places.service`) crash-looped 2,065
times. At startup it recovers API turns and scans every stored transcript for
retained images. Its store held 18,048 sessions and 39,445 messages (552 MB):
every Places request opens an API session that is never ended. The scan, under
the service's one-CPU quota, outlived the gateway loop watchdog (about two
minutes); the watchdog exited with code 75 and systemd restarted it. The loop
began when the service was restarted after a Hermes update on 14 November.

## Recovery (owner-authorized, 17 November)

1. Service stopped; `state.db` backed up privately under
   `/var/lib/insta-explorer-places/backups/state-20261117/` (integrity `ok`).
2. All 18,048 sessions, idle for more than a day, deleted offline through
   Hermes' `SessionDB.delete_sessions`; store vacuumed (552 → 351 MB).
   `hermes sessions prune` matched nothing: it only deletes ended sessions.
3. Gateway restarted: no restart since, `/health` 200.
4. The 14 jobs (classification + translation of the seven posts) that failed
   only because of the outage were requeued; the normal automatic pipeline then
   admitted eligible posts to Places.

## Prevention

`session_retention.py`, installed with the drop-in `30-session-retention.conf`,
runs as `ExecStartPre` of the gateway: unpinned, unarchived sessions idle for
two days are deleted through Hermes' own API before each start, with no live
writer. Startup therefore scans at most two days of sessions. A failure is
ignored (`ExecStartPre=-`) so retention never blocks inference.

Tests: `services/worker/places-hermes/test_session_retention.py` (idle
selection across start, activity and message times; pinned and archived kept;
batches of 500; guarded rows reported; read-only selection) and an installer
test for root-owned 0644 files.

## Limits

Retention runs at gateway start only; the store grows between restarts, which
does not affect a running gateway. `install.py` still rewrites `config.yaml`
from `config.json`, which lacks settings added on the host; install only the
retention part on a running host (see the README).

## Rollback

Remove the drop-in and the script, `daemon-reload`. The backup restores the
previous store if ever needed.
