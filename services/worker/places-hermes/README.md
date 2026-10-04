# Places Hermes service

The owner approved this separate execution service on 4 October 2026. See the
[architecture decision](../../../docs/decisions/2026-10-04-separate-places-service.md).

This slice provides the configured inference runtime. It does **not** consume
post jobs yet. Audio/video extraction and verified Places writes need their own
handler and API integration. No production backfill has been started.

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
