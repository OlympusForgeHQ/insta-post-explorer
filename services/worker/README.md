# Global worker foundation

This private Node.js workspace contains the Phase E worker foundation. Its
normal production registry is intentionally empty until a separately reviewed
Places handler is delivered. It does not expose a public API.

Use `npm run worker:test`, `npm run worker:typecheck` and
`npm run worker:build` from the repository root. PostgreSQL integration tests
require `TEST_DATABASE_URL` pointing to an ephemeral PostgreSQL 16 database.
The smoke command additionally requires `NODE_ENV=test` and a database whose
name ends in `_test`, unless `WORKER_SMOKE_CONFIRM=EPHEMERAL` is set explicitly.

The Compose service publishes no host port. Health endpoints are available only
inside the container at `127.0.0.1:$WORKER_HEALTH_PORT` (default `8080`), and the
image healthcheck uses the same configured port.

Handlers never receive an R2 key or a general-purpose S3 client. Their
job-scoped media capability can list persisted `VERIFIED` media references and
download one by media id; the repository re-authorizes owner, post, identity
state and canonical object key before each `GetObject` request.

`WORKER_TEMP_ROOT` must be a non-root absolute path. Relative paths are rejected
before normalization. On SIGTERM/SIGINT the worker stops polling immediately,
continues heartbeat renewal during the grace window, and aborts the active
handler only when `WORKER_SHUTDOWN_TIMEOUT_MS` expires. Timeout work is retried
with `WORKER_STOPPING` when the lease is still authoritative, or left for lease
expiry when PostgreSQL is unavailable.

## Daily Instagram command

The existing image also contains a separate Instagram command entry point. It
uses bundled Chromium and the unchanged Insta Saved Sync extension 4.2.8; the
normal worker `CMD`, healthcheck and Places registry remain as above. Build first
with `npm run worker:build`, then run from the repository root:

```bash
node services/worker/dist/sync/cli.js check
node services/worker/dist/sync/cli.js login
node services/worker/dist/sync/cli.js run
node services/worker/dist/sync/cli.js scheduled
```

`check` opens the dedicated profile headlessly and checks Instagram login through
the extension, without creating an app sync session. `login_present` confirms
cookie presence only; a real run verifies acceptance by Instagram. `login` opens Chromium on
an existing private display (`:N` or SSH-forwarded `localhost:N`) and waits for
the operator to log in or resolve the Instagram challenge, then close Chromium.
Run `check` afterwards. Login never reads or prints a password, cookie, account
name or profile dump. Do not expose X11, VNC or a debugging port publicly.

`run` checks Instagram login before requesting a temporary session through
`/api/v1/sync/session`, then sends only
that session to the extension, and polls the authoritative API status. A
collector success without DB completion fails with `SYNC_COMPLETION_UNCONFIRMED`.
After exclusive admission, the runner stops the old extension service worker and
clears only its obsolete `web-sync` task/pages, preserving archives, cookies and
other task data. Node renews the lease independently of collection, every 30 seconds as announced
by the server. Interruptions, timeouts, lost heartbeats and interactive challenges
close Chromium and best-effort mark the run failed. The API's lease recovery
handles process death or unavailable cleanup requests. Admission is never blindly
retried; safe status/heartbeat requests have at most three attempts and a
10-second request timeout. Logs contain fixed status/error codes only.

`scheduled` is suitable for an **hourly** scheduler invocation: it skips before
04:00 Europe/Brussels and attempts catch-up afterwards. The server enforces
owner exclusivity and one successful automatic run per local calendar day,
including DST changes. `SYNC_IN_PROGRESS` and `SYNC_ALREADY_COMPLETED` are normal
skips (exit 0); `SYNC_DAILY_LIMIT` requires operator review after three admissions
in a day (exit 1). Use the same timezone for the scheduler and application's
daily-run configuration. This change does not install or enable a schedule.

| Variable | Purpose |
| --- | --- |
| `SYNC_APP_URL` | Required exact app origin: production or preview HTTPS; `http://localhost:3000` permitted only outside production for disposable tests. |
| `INSTAGRAM_AUTO_SYNC_KEY` | Dedicated raw `ips_sync_…` credential, required only for `run` or a due `scheduled` run. Store as a worker secret; the app stores its digest. |
| `SYNC_PROFILE_DIR` | Dedicated absolute profile outside the checkout; defaults to `/var/lib/insta-sync/profile`. Private persistent volume owned by UID/GID 10001 in the image. |
| `SYNC_EXTENSION_DIR` | Defaults to the repository's `extension/ig-saved-sync`, or `/app/extension/ig-saved-sync` in the image. |
| `SYNC_TIMEZONE` / `SYNC_HOUR` | Defaults `Europe/Brussels` / `4`; hour accepts 0–23. |
| `SYNC_MAX_RUN_MS` | Defaults 10,800,000 (3 hours); accepts 60,000 through 10,800,000, below the 4-hour run-token lifetime. |
| `DISPLAY` / `XAUTHORITY` | Existing private interactive display settings for `login` only. |

The profile must have mode 0700 and belong to the process user. Symlinks,
insecure permissions and reuse with a different app origin are rejected.
Chromium owns profile locking: stop the existing browser cleanly before another
command; never remove its lock to override a running process. Mount a dedicated
persistent volume at `/var/lib/insta-sync` for a deployment; keep production and
preview profiles and keys separate. Chromium receives an allowlist of OS display
and locale environment variables, excluding the automation key and other worker
service credentials. Profile contents are sensitive operational state and must
never enter Git or evidence.

Verification from the root:

```bash
npm run worker:test
npm run worker:typecheck
npm run worker:build
node services/worker/scripts/sync-browser-smoke.mjs
```

The browser smoke uses a fresh temporary profile and proves extension messaging,
login detection without a session, lock refusal, service-worker restart
recovery and stale-task cleanup that preserves the archive. Its only output is a sanitized result. It requires the matching bundled
Chromium installed (`PLAYWRIGHT_BROWSERS_PATH` can point to an existing cache).
A real account login, measured real import and approved scheduler activation
remain deployment pilot checks; synthetic verification does not prove Instagram
will keep accepting an unattended session.

Full deployment, API, manual-sync and end-to-end verification instructions:
[Daily sync](../../docs/daily-instagram-sync.md).
