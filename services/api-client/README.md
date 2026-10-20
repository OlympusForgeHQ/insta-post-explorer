# Insta Explorer API client for Argos

A Python 3.10+ standard-library client for all 13 read endpoints (14 commands,
including random discovery). It uses the current `/api/v1` API. No MCP process,
bot token, model dependency, database credential or web deployment is needed for
the client itself. The external API hash must be configured on the web runtime.

## Usage

```sh
python3 services/api-client/client.py catalog
python3 services/api-client/client.py posts --params '{"q":"pistache","tag":["Dessert","Rapide"],"tagMode":"or","limit":10,"sort":"relevance"}' --pages 2
python3 services/api-client/client.py post --id POST_ID
python3 services/api-client/client.py places --params '{"country_code":"JP","categories":"restaurant","min_confidence":0.8}'
python3 services/api-client/client.py places-stats --params '{"source_theme":"Restaurant"}'
```

The catalog lists every operation and its exact filters. Unsupported filters
are rejected locally. Responses preserve the API JSON and add `_meta` containing
the command, pages fetched and whether more results remain. For multiple pages,
`items` is concatenated and `nextCursor` is the last page's continuation. Totals
remain those of the first response. On a subsequent page failure, the command
fails rather than representing the first pages as complete. Reads are not a
transactional snapshot. Fetch post details for complete captions and media.

Each page has a 30-second socket inactivity timeout and 4 MiB response cap.
This is not a total wall-clock deadline for a slowly streaming response. Requests are
GET only; redirects are rejected even on the same origin. HTTPS is required
except loopback for testing. Error bodies are never printed; credentials cannot
be supplied in CLI arguments. There is no retry loop. Pagination defaults to
one page; explicit traversal is capped at 20 pages and 100 items per page.

## Private configuration

The client reads `~/.config/insta-explorer/client.json`, or the path specified
by `INSTA_EXPLORER_CONFIG`. The file must be owned by the executing account,
regular, not a symlink, at most 8 KiB, and inaccessible to group/other (0600).
Use a private parent directory (0700). The JSON fields are:

```json
{"base_url":"https://insta-explorer.hz.kalyros.dev","api_key":"<privately provisioned read-only key>"}
```

Alternatively inject both `INSTA_EXPLORER_API_URL` and
`INSTA_EXPLORER_API_KEY` through an existing secure environment mechanism.
Partial environment configuration fails instead of falling back to a different
account. Never print real configuration or place it in Git or agent messages.

## Argos installation and activation

The user selected the existing Argos Discord bot. After validation, install
`client.py` to `/home/argos/.local/share/insta-explorer/client.py` and the supplied
`argos-skill/SKILL.md` to
`/home/argos/.hermes/profiles/argos/skills/insta-explorer/SKILL.md`, as Argos.
Use its native `skills_list` / `skill_view` to verify discovery. Existing Discord
terminal and skills permissions suffice; no YAML, SOUL, gateway or MCP change.

Production activation is a separate reviewed administrative operation:

1. Confirm the exact application `disf6wn5vqdgox1djtihgmmx`, running image and
   revision. Preserve the prior hash variable and deployment configuration in
   private rollback material. Refuse if an external key is already configured
   unless its replacement is separately authorized.
2. Generate one random `ipe_` key in the final private Argos configuration.
   Configure only its SHA-256 as the runtime `EXTERNAL_API_KEY_SHA256` on the
   existing web application. Never transfer database, worker or admin keys.
3. Recreate the web app from the same verified revision/image using the existing
   platform mechanism, preserving all other environment variables and services.
   Do not implicitly build a newer branch HEAD.
4. Verify health 200, anonymous/invalid-key reads 401, real authenticated search,
   full detail, Places, statistics and pagination. Record only statuses/counts.
5. Verify the installed client and native Argos skill. A Discord conversation
   test is separate; installation and API checks alone do not prove a bot reply.

Rollback: restore only the previous external hash variable state and same web
revision; remove only the new skill, client and dedicated configuration if they
did not exist before. Never restore entire profiles or application environments.
No application data is changed by this integration.

## Verification

```sh
python3 -m unittest discover -s services/api-client -p 'test_*.py'
```

The test server binds only loopback on an ephemeral port. No real Instagram or
Discord request, production key or database is used. Test rationale: protect the
new public client boundary, filter/pagination correctness and key confinement.
