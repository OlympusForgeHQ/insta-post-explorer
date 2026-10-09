# Independent DeepSeek classification consumer

Initial production activation was verified on 5 October at 23:41 Brussels.
The owner performed the reviewed permanent 20261006 root handover on 6 October at 09:35 Brussels. The unit is active/enabled, has one flock parent and one Node consumer in its systemd cgroup, owns the canonical kernel lock and has no restart loop. New jobs succeeded after handover. The earlier temporary consumer is gone. All three 50.91/51.63/36-minute originals passed full ASR and twelve-frame inference; the library batch continues after its pilot holds were released. The initial installer’s FOREIGN_CONSUMER_PROCESS report was a reproduced fork-before-exec readiness race. The corrected private operator waits up to ten seconds for exact identity, then verifies twelve strict stable samples; all ten guards pass. No restart of the working unit was needed. See [the long-media change](../../../docs/changes/2026-10-06-classification-long-videos.md).
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
The independent host consumer processes one post at a time. The throughput
release immediately advances after successful completion and cleanup, retaining
15-second idle/unsuccessful waits and 60-second unexpected-error waits. No synchronous inference call blocks Instagram.
Sync does not scan historical posts or enqueue Places jobs. The separately
authorized historical batch uses the same durable classification queue.

The worker uses only its scoped application key and the existing private Hermes
inference key. `/api/v1/classification/worker` accepts `claim`, `heartbeat`,
`complete`, `fail`; it derives the owner from application configuration.
There is no arbitrary enqueue API, database DSN, R2 access key or public port.
Hermes must already be running at `http://127.0.0.1:8645/v1`; alias `insta-places`
routes to the configured DeepSeek model. The classifier does not change that
runtime or the sync extension.

The application-owned claim output schema supplies theme/tag guidance to the installed consumer. Divers covers understood subjects outside the other seven themes; Cuisine includes ingredient/product information without a recipe. Tags may describe any evidenced topic, reusing relevant names and creating precise French entries when needed. Unknown context remains NEEDS_REVIEW; the three-to-five-tag and existing-theme validators still apply. This metadata-only web change was deployed through PRs #122/#123 with green quality/browser CI, without consumer replacement or restart. Compiled production guidance and scoped capabilities were confirmed at 08:29 UTC. Two previously refused understood posts then succeeded as Divers/Cuisine on guarded audited retries; their ten protected links and prior results were preserved. The 08:31 UTC snapshot has 486 successes, 3,424 pending and zero reviews/failures. Sync deployment history and schedule remain unchanged. See [guidance evidence](../../../docs/changes/2026-10-06-classification-theme-guidance.md).

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

## Throughput release — 8 October 2026

Release 20261008 is active/enabled since 09:58:40 UTC after PR #125 and green
quality/browser CI. The old post completed before the replacement. Three new
successful posts (six-image carousel and two fully transcribed videos) showed
0.15–0.17-second success-to-next-job gaps, zero restarts and unchanged protections.
The actual process uses four threads and the new ASR script; systemd confirms
400% CPU and the same 2 GiB cap. Web and sync were not redeployed.

The reviewed template permits four CPUs and sets `CLASSIFICATION_ASR_CPU_THREADS=4`.
The shared Python transcriber accepts 1–4 and defaults to two when unset, keeping
Places unchanged. Five local full-audio trials produced identical text/timestamps;
four threads took about 27 seconds versus 43 at two on that sample. This improves
local ASR, not remote DeepSeek latency. Full audio, frames, model, memory cap and
serial queue semantics remain unchanged.

Activation is separate from source publication. Replace the old 20261006 consumer
only in its verified 15-second post-completion pause, with exact process/boot and
fresh journal checks. Update the private `CLASSIFICATION_ASR_SCRIPT` to the new
immutable release too; changing only the unit leaves the old script selected.
After activation, that success pause no longer exists: never use the same timed
stop procedure for a subsequent rollback. See [scope and evidence](../../../docs/changes/2026-10-08-classification-throughput.md).

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

## Caption translation (8 October extension)

`CAPTION_TRANSLATION_ENABLED=1` on the web app admits new/changed descriptions
transactionally and enables the scoped `/api/v1/classification/translation` route.
The same serial consumer first claims classification (`protocol:2`), then translation
only when no classification is available. No image, video or audio is reprocessed.
Existing descriptions are admitted by a reviewed, idempotent private operator.

Translation jobs use `analysisVersion=caption-translation-v1` in the existing table.
Always filter classification reports to `post-classification-v1`. Translation reports
count `TRANSLATED`, `UNCHANGED`, `NEEDS_REVIEW` and failures separately. Original
captions, classification hashes, themes, protected tags, deletions and Places remain
unchanged; the library exposes only a current French translation with an original toggle.
A changed description resets its translation job; an identical import reuses it.

The translation provider receives text only, in chunks of at most 4,000 characters
for the existing 100,000-character caption bound. It preserves English/French passages
and protected URLs, handles, hashtags and numbers. Invalid results get one inference
retry, then smaller chunks for copying failures (minimum 500 characters; at most
100 calls under the overall deadline); transient job errors get at most three attempts. No partial result is published.
The overall job deadline is 15 minutes. Unsupported/uncertain text remains explicit.

Upgrade API first: legacy classification claims return null but their owned job can
heartbeat/finish. Withdraw old web instances, wait for the active job to finish, then
replace the consumer under its canonical lock. Keep a protocol-2-compatible old release
for rollback. Translation can be disabled independently by its flag. New systemd units
use `flock --no-fork` and `KillMode=mixed`: SIGTERM stops future claims while Node and
its media children finish owned work; after 96 minutes systemd may kill the cgroup.
Do not stop a legacy consumer in the middle of a job: its old shutdown aborts it.

### Translation recovery (9 October)

Caption inference uses indexed sentence/line units; original English/French and
nonlinguistic units are copied locally. Protected tokens and emoji are masked and
restored in exact order. Mixed units retain the exact-segment fallback. Diagnostics
record bounded rejection codes, never caption/provider content. HTTP 429 honors a
bounded Retry-After pause (1–60 seconds); server deferrals wait five minutes and
refund the inference attempt for up to 24 hours from first claim. Other retry
limits, the global call budget, lease heartbeat and job deadline remain enabled.
Operator recovery is restricted to failed, unchanged translation inputs before a
fixed cutoff and journals each row. See the recovery specification for rollout.
