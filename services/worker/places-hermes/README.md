# Places Hermes service

The owner approved this separate execution service on 4 October 2026. See the
[architecture decision](../../../docs/decisions/2026-10-04-separate-places-service.md).

The isolated service provides inference. A separate invocation of the serial
client described below handles media and calls the application queue/Places API.
Deployment does not launch a library-wide backfill.

## Deployment

Requires the installed Hermes 0.21.5, the `argos` service account and its verified
OpenRouter key. The installer copies only that credential and generates an
independent API-server key. No other profiles, messaging tokens, cron jobs,
database credentials, Instagram cookies or agent tools are inherited.

From the repository root, after review:

```bash
python3 -m unittest discover -s services/worker/places-hermes -p 'test_*.py'
sudo python3 services/worker/places-hermes/install.py
sudo systemd-analyze verify /etc/systemd/system/insta-explorer-places.service
sudo systemctl daemon-reload
sudo systemctl enable --now insta-explorer-places.service
```

The installer refuses foreign state and a different existing unit. Reinstallation
preserves the local API key. For a reviewed unit update, back up the old unit
privately, install the reviewed replacement, reload and restart only this service.
Never print `.env` or use credentials as command arguments.

API base: `http://127.0.0.1:8645/v1`; advertised alias: `insta-places`.
Actual model: `deepseek/deepseek-v4.1-flash`; provider: OpenRouter. This endpoint
is for trusted backend clients. It has no public hostname or reverse proxy route.
Future container clients need an explicitly reviewed private-network route;
host loopback is not container loopback.

## Verification and operations

Check `/health`, authenticated `/health/detailed` and `/v1/models`; a request
without a key to `/v1/models` must return 401. Health alone does not validate
upstream inference. Send short synthetic text/image requests through Hermes and
verify the actual model/provider metadata. This smoke consumes a small amount
of inference credit; do not use real captions or start the backfill here.
Receipts contain only sanitized status, model, usage and timing.

Verify active systemd state, one-CPU quota, 2 GiB limit, loopback-only listening,
and pre-existing service health. Writes are restricted to the new state and
private temporary directory; other homes are hidden except the read-only engine.

Rollback: `sudo systemctl disable --now insta-explorer-places.service`. Retain
state for diagnosis. This does not change Instagram sync, Argos or Cortana.

## Serial multimodal client

The next integration slice adds `services/worker/src/places/cli.ts`. It calls the
application's scoped worker API and this Hermes endpoint; it has no database or
bucket credentials. It is invoked explicitly, not installed as a third service.
Its full-audio ASR uses a separate Python venv with
`requirements-asr.txt` (faster-whisper 1.2.1 and PyAV 18.0.0, CPU int8, automatic language).
FFmpeg and ffprobe must be available at `/usr/bin`.

Configure a private 0600 environment file outside Git with:

- `PLACES_APP_ORIGIN`: application HTTPS origin.
- `PLACES_WORKER_API_KEY`: high-entropy dedicated raw key; only its SHA-256 hash
  belongs in the application's `PLACES_WORKER_API_KEY_SHA256` variable.
- `PLACES_HERMES_URL`: `http://127.0.0.1:8645/v1`.
- `PLACES_HERMES_KEY`: the isolated service's local API credential.
- `PLACES_TEMP_ROOT`: absolute private media workspace directory.
- `PLACES_ASR_PYTHON`: absolute path to the separate ASR venv Python.
- `PLACES_ASR_SCRIPT`: absolute path to `transcribe.py` in this release.
- `PLACES_ASR_CACHE`: private model-weight cache, separate from media workspaces.

With that environment loaded by the operator:

```bash
npm run worker:build
npm run places --workspace services/worker -- --post POST_ID --preview
npm run places --workspace services/worker -- --post POST_ID --commit
npm run places --workspace services/worker -- --limit 10 --commit
```

Preview analyzes and resolves without job/domain writes. Commit enqueues current
eligible inputs idempotently and processes at most the requested number, serially
(maximum 50). A named post limits both enqueue and consumption to that post.
A completed current input is not reprocessed. Failed jobs retry at most three
times with backoff; a future explicit invocation consumes due retries. No timer
or continuous backfill is enabled by deployment. Never interpret zero claimed
jobs as proof that every post has succeeded; inspect pending/review/failed jobs.

For each post the client analyzes the caption, validates and decodes all media,
samples up to 12 frames including the end, transcribes all available audio, reads
visible text, then fuses the evidence through DeepSeek. Limits are 250 MiB/media,
5 minutes/video, 20 media/post and 20 minutes/post. Oversized/unreadable media fail
visibly. Sampling is not exhaustive video OCR: a short text between sampled
frames can be missed. The measured 30–50-post pilot remains the quality gate
before unattended processing of the full library.

The worker contract allows up to 200 textual place candidates per post, separately
from the caption-import contract's 50-candidate bound. Fusion has a 32,768-token
output allowance; caption and media extraction retain 12,000. A model response
that reaches or exceeds the declared candidate capacity or ends because of its output length
fails as `INVALID_RESULT` without a compacting retry. Review the original sources
before retrying such a post: a shorter list is not proof of complete coverage.
Strict field validation, the 512 KiB JSON bounds and geographic verification
still apply. Fully reviewed results can contain exactly 200 candidates.

All media artifacts are removed on success/error/interruption and stale job
workspaces are removed at startup. Logs contain post IDs, stages, coverage counts,
usage and stable error codes; no source excerpts, signed URLs or keys. Hermes may
retain its own inference sessions according to its existing private runtime
policy. Model weights remain cached. Disable `PLACES_WORKER_ENABLED` to close the
application endpoint; retain Places data and audit history on rollback.

ASR dependency compatibility: PyAV 19 removed the API used by faster-whisper 1.2.1.
The explicit PyAV pin prevents that observed runtime failure; see
[upstream issue 1589](https://github.com/SYSTRAN/faster-whisper/issues/1589).
