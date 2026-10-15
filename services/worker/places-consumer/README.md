# Automatic Places consumer

New synchronized posts opt in when the application has `PLACES_AUTO_ENABLED=1`.
Successful classification transactionally queues eligible Restaurant/Voyages posts
using their final theme and tags. If classification is disabled, sync admits using
its provisional current theme. Uncertain classification stays in review. Existing
posts and sync replays do not opt in retroactively. No backfill command is used.

The consumer is independent of Instagram sync and classification. It polls the
existing scoped Places API every 15 seconds at rest, performs one bounded analysis
at a time and immediately continues after success. A failed job or API poll waits
60 seconds. Server retries wait 1 then 5 minutes, within three attempts. Persistent
failures remain visible as FAILED; ambiguous geographical results remain in review.
The daemon never silently turns them into successes.

## Learning and audit

Each opt-in claim receives a bounded strategy selected from its prior failed attempt
and at most 100 recent jobs from the same owner, one sample per other post, within
30 days and matching media/caption shape. Format and evidence failures select fixed
corrective instructions; recovered jobs reduce their influence. No post content or
model-written rule is stored in this learning metadata. Busy-provider errors have
backoff, not fabricated extraction guidance. Only a live lease may record outcomes.

`PlaceAnalysisJob.result` retains sync provenance, selected strategy, up to three
attempt outcomes, final resolution decisions and completion receipt. Existing audit
triggers preserve changes. Logs include sanitized failure codes and strategy counts,
never captions, media URLs or credentials. Existing explicitly owner-confirmed
identity memory supplies geographical context; providers still validate candidates.
Manual exclusions, rejected links, categories and confirmed places remain protected.

This is bounded adaptive guidance plus verified memory, not fine-tuning or automatic
code changes. Set `PLACES_LEARNING_ENABLED=0` in the consumer to disable guidance
without stopping processing. The historical CLI stays explicit and compatible.

## Build and stage

Run normal app/worker lint, types, tests and builds, including the PostgreSQL
integration suites. Then package the built worker using:

```sh
python3 services/worker/places-consumer/build-release.py /tmp/places-consumer-release
```

The package contains only Places/runtime modules, zod and the existing transcription
script/requirements. It has no Prisma client, DB driver, bucket credentials or
private state. Copy the verified package to an immutable, root-owned directory
`/opt/insta-explorer-places-consumer/releases/<commit>` (not under `/home`, which is
hidden by service hardening). Use the installed Node 24 executable and the existing
ASR Python runtime; ffmpeg/ffprobe must be installed. Do not change Hermes secrets
or the classification service to install this consumer.

Create `/var/lib/insta-explorer-places-consumer/{work,cache}` owned by argos, mode
0700, and a private `.env`, mode 0600, owned by argos. Required values:

```dotenv
PLACES_APP_ORIGIN=https://YOUR-APP-HOST
PLACES_WORKER_API_KEY=EXISTING-PLACES-CAPABILITY
PLACES_HERMES_URL=http://127.0.0.1:8645/v1
PLACES_HERMES_KEY=EXISTING-HERMES-CAPABILITY
PLACES_TEMP_ROOT=/var/lib/insta-explorer-places-consumer/work
PLACES_ASR_PYTHON=/opt/YOUR-ASR-RUNTIME/bin/python
PLACES_ASR_SCRIPT=/opt/insta-explorer-places-consumer/releases/COMMIT/transcribe.py
PLACES_ASR_CACHE=/var/lib/insta-explorer-places-consumer/cache
PLACES_LEARNING_ENABLED=1
```

Reuse the installed ASR cache by copying it to this dedicated cache if available,
so the first post does not need a model download. Keep secrets out of command-line
arguments, Git, chat and logs. The app retains `PLACES_WORKER_ENABLED=1`, its existing
scoped key hash and configured geographic provider keys.

Render `@NODE@` and `@RELEASE@` in `insta-explorer-places-consumer.service` with those
absolute paths, review the result, then install it to `/etc/systemd/system`.
Run `systemd-analyze verify` before `systemctl daemon-reload` and
`systemctl enable --now insta-explorer-places-consumer.service`.
The unit allows two CPU cores, 2 GiB RAM, serial jobs and 35 minutes to drain its
bounded active analysis. Its lock and temporary directories are dedicated.

## Activation proof and rollback

1. Deploy the compatible app with `PLACES_AUTO_ENABLED=0`; stage/start this consumer.
2. Verify automatic claims return null while disabled and the daemon remains idle.
3. Enable `PLACES_AUTO_ENABLED=1` in the app and deploy that configuration.
4. Observe a genuinely new sync import through successful classification, one
   automatic Places job and its final SUCCEEDED/NEEDS_REVIEW receipt. Verify the
   provider result/link and unchanged manually protected records. A post without
   a recommended place may succeed with zero links.
5. Check `journalctl -u insta-explorer-places-consumer.service` and the job's persisted
   result. A started systemd unit alone is not proof of end-to-end success.

Rollback: turn `PLACES_AUTO_ENABLED=0` in the app and stop the consumer gracefully.
New imports no longer opt in; in-flight classification of existing opt-ins may
still queue durably; no automatic jobs are claimed while disabled. An already
claimed Places job may complete under its existing safeguards. Do not delete queue
rows or restart sync/classification. Re-enable to process the retained queue.
