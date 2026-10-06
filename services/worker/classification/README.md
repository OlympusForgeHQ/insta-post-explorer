# Independent DeepSeek classification consumer

Initial production activation was verified on 5 October at 23:41 Brussels.
During the historical pilot on 6 October the permanent unit was stopped; a
supervised temporary consumer now continues under the canonical lock. Root
handover remains pending. The compatible 20261006 temporary consumer and web
release are deployed; all three real 50.91/51.63/36-minute originals passed full
ASR and twelve-frame inference. The historical batch continues after its 3,786
pilot holds were released. An orphaned old pilot consumer was stopped and its
large-video job succeeded on an audited retry. The reviewed root handover checks
all classification consumers before downtime and verifies exclusive startup. See
[the current change](../../../docs/changes/2026-10-06-classification-long-videos.md).
The owner authorized
implementation, publication/migration/deployment, DeepSeek via OpenRouter and the
real-post pilot before unattended activation. The additive production migration
is applied and the web flag is 1. The permanent unit remains enabled.
Seven new imports passed the installed consumer's supervised real pilot: six
videos/full-audio ASR and a three-image carousel, with four or five saved tags
each. The permanent unit's startup/configuration and idle state were verified
after those jobs completed; the pilot itself ran under Argos and the same flock.
Historical library, deletions, Places and sync quotas were preserved. See the [decision](../../../docs/decisions/2026-10-05-independent-classification-worker.md)
and [specification](../../../docs/superpowers/specs/2026-10-05-post-classification.md).

`sync-post` enqueues every **new** successful sync import in its transaction,
after verified media persistence, when `CLASSIFICATION_WORKER_ENABLED=1`.
The independent host consumer polls that durable queue every 15 seconds and
processes one post at a time. No synchronous inference call blocks Instagram.
Sync does not scan historical posts or enqueue Places jobs. The separately
authorized historical batch uses the same durable classification queue.

The worker uses only its scoped application key and the existing private Hermes
inference key. `/api/v1/classification/worker` accepts `claim`, `heartbeat`,
`complete`, `fail`; it derives the owner from application configuration.
There is no arbitrary enqueue API, database DSN, R2 access key or public port.
Hermes must already be running at `http://127.0.0.1:8645/v1`; alias `insta-places`
routes to the configured DeepSeek model. The classifier does not change that
runtime or the sync extension.

All verified media are processed (maximum 20; videos up to 600 MiB, images up to
250 MiB). Images and actual video frames are submitted; video sampling covers the timeline with up to 12
frames per video, maximum duration 60 minutes. Audio is extracted completely
and transcribed locally with the existing Whisper implementation. Multiple media
are summarized individually and fused with the description and tag catalog.
These limits bound cost; the entire video is not sent as a continuous stream.

Each inference has a six-minute deadline and 2,048 output-token limit. A post
has a 90-minute deadline, 90-second lease, 30-second heartbeat and at most three
claims. Transient failures retry after 60/300 seconds. Busy shared inference
(429) releases the claim for retry. NEEDS_REVIEW, FAILED and CANCELLED are
explicit terminal database/audit outcomes; no generic tags are added to fill a
list. Global manual tag rename/merge/delete also cancels classification queued
before that catalog correction; automatic tag creation does not cancel other
queued posts. Media workspaces are deleted on success/error/shutdown. The unit
holds an exclusive process `flock`; on restart all abandoned media in its private
work root are removed immediately. A between-job janitor also removes stale
owned workspaces after six hours. The separate private model cache is retained.
Use the systemd unit to run against this state; any explicit diagnostic Node
invocation against the same state must acquire the same `flock` first.

Classification downloads have a ten-minute deadline covering the full response
body; subprocesses share the ninety-minute post bound. Classification media
signatures last two hours, retaining canonical owner/version restrictions. These
explicit classification policies preserve Places' fifteen-minute, 250 MiB,
three-minute download, ten-minute process and thirty-minute signing defaults.
The long-media release must be installed before admitting larger originals;
old consumers cannot parse those claims. Missing originals remain explicit
failures rather than thumbnail substitutions. Historical-library requeue is now
authorized by the owner, with protected imported/manual tags retained; completed
classification jobs are reused and the finished geographic review is preserved.

## Build and stage

No command below publishes automatically. Review/authorize production deployment
before performing migrations, root installation or service activation.

1. Run `npm run worker:build` with Node 24 and installed repository dependencies.
2. Build a new release: `python3 -B services/worker/classification/build-release.py /tmp/classification-release-RELEASE`.
   It copies only classification, shared media/workdir helpers and existing Zod;
   no database clients, sync extension, environment file or media is packaged.
3. Transfer the verified bundle to `/opt/insta-explorer-classification/releases/RELEASE`.
   Files/directories must be root-owned and unwritable by group/others, without
   symlinks. Retain previous releases for rollback.
4. Prepare the separate `/opt/insta-explorer-classification/asr` Python venv using
   the release's pinned `requirements-asr.txt`. Do not modify Hermes's venv.
5. Prepare a private mode-0600 environment file with the five fields below. Use
   a newly generated 32-byte base64url `ips_classify_` key. Only its SHA-256 digest
   goes to the application's `CLASSIFICATION_WORKER_API_KEY_SHA256`; it must differ
   from read, sync and Places key hashes. Never put the raw key in terminal output,
   Git or the web environment. The Hermes local key is provisioned privately.

```dotenv
CLASSIFICATION_APP_ORIGIN=https://insta-explorer.hz.kalyros.dev
CLASSIFICATION_WORKER_API_KEY=<private dedicated key>
CLASSIFICATION_HERMES_URL=http://127.0.0.1:8645/v1
CLASSIFICATION_HERMES_KEY=<existing private Hermes key>
CLASSIFICATION_ASR_PYTHON=/opt/insta-explorer-classification/asr/bin/python
```

6. Stage with the installer (canonical, non-symlink Node 24 binary under `/usr`
   or `/opt`):

```sh
sudo python3 -B services/worker/classification/install.py \
  --release /opt/insta-explorer-classification/releases/RELEASE \
  --node /usr/local/bin/node \
  --env-file /private/path/classification.env
```

The installer creates a private Argos-owned state/env, sets the release-specific
ASR script and state/cache paths, and writes the unit. It refuses foreign state,
symlinks, credential rotation and an existing differing unit. A release change
therefore requires reviewing and replacing the old unit explicitly. It never
starts/enables the service or logs credentials. Validate the generated unit with
`systemd-analyze verify` before activation.

## Authorized rollout and rollback

Deploy the additive migration with classification disabled, then the reviewed web
code and dedicated digest. Run `npm run deploy:check` with the real configuration.
Keep the independent unit stopped until its bundle/config/media capabilities are
verified. Enabling the flag activates both durable enqueue and the scoped API;
there is deliberately no historical requeue command.

For the restricted real-account pilot, enable the flag, start the staged unit,
and sync one newly saved post with representative media. Check its category,
3–5 relevant tags, manual protections, coverage, usage, completed job/audit and
temporary cleanup. Verify the hourly sync still completes or skips successfully,
and that Places/Hermes remain healthy. A live pilot is necessary to verify
provider behavior, network credentials and the deployed unit; synthetic tests
do not prove those. Only then enable the unit for unattended startup.

Rollback: stop/disable `insta-explorer-classification.service` and set
`CLASSIFICATION_WORKER_ENABLED=0`. Leave the additive table, jobs, saved
classifications and audit intact. Existing web browsing and sync continue.
Expired in-flight jobs can resume if re-enabled; source changes/deletions fence
them automatically. Do not revert manual edits or recreate deleted posts.

Logs contain IDs, stages, coverage and numeric usage/duration only. Inspect
status via the application audit and owner-scoped database administration, not
by giving the worker SQL credentials. Monitor terminal failure/review counts and
old PENDING/PROCESSING jobs; this change adds no external alerting channel.
