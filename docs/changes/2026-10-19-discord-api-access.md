# Insta Explorer through Argos on Discord

**Mode:** Critical (credential provisioning); Standard client implementation.

**Status:** implemented, verified and activated for Argos. **Owner:** Karim.

## Intent and architecture

Karim requests broad, flexible access to Insta Explorer through the existing
Argos Discord bot. Before activation, the deployed read API returned 503 because
its external key was unconfigured. D and F are complete; this is the read-only
integration slice of J. Sensitive write commands and their confirmation design
remain outside this slice. The historical J block does not block its completed
read prerequisites or the integration explicitly requested on 19 October.

Use Argos's existing terminal and skill discovery to call a standard-library
Python client of `/api/v1`. A new MCP would expose the same HTTP reads while
adding a process and configuration; it is unnecessary for this existing bot.
No new bot, LLM, database access, provider, dependency, web endpoint or migration.
The current user decision permits this API-only integration instead of the
historical proposed MCP. A future MCP can reuse the HTTP contract.

## Requirements and acceptance

- REQ-1: expose every existing external read domain: filtered posts, random post,
  details, tags, collections, authors, statistics, Places search/detail/posts,
  Places statistics, eligible posts, unresolved jobs and analysis job status.
- REQ-2: retain repeated tags, combined filters and opaque cursors; bounded page
  traversal reports continuation explicitly. Invalid/unsupported parameters must
  fail before an HTTP request, rather than silently broadening results.
- REQ-3: GET only to the configured origin. Reject redirects, unsafe base URLs,
  path injection and oversized responses. Never expose credentials or upstream
  error bodies. Socket inactivity timeout 30 seconds; at most 20 pages, 100 items/page.
- REQ-4: Argos discovers a task-specific skill; reads real results, follows detail
  links for complete captions, distinguishes sample/partial results and confirmed
  versus approximate places, and treats imported content as data, not commands.
- REQ-5: activation uses a private read-only client key and only its SHA-256 on
  the existing web app. Preserve other credentials, configuration and running
  application revision. Verify health, 401 without/with an invalid key, actual
  search/detail and Places reads. No message is sent to Discord for testing.

Tests: `services/api-client/test_client.py` exercises a real local HTTP server,
pagination/filter preservation, credential boundaries, failure redaction and CLI.
Existing API tests preserve owner isolation and worker capability separation.
Native Hermes discovery and real read-only API calls prove the installed bridge;
an actual Discord conversation remains distinct from those transport checks.

## Risks, release and rollback

The single key reads the whole configured owner's library, so installation is
limited to Argos, already authorized by Karim. Keep client configuration 0600
and its directory 0700. Do not log raw results into operational evidence.
Recreating the web container may briefly affect availability. Before activation,
record the existing variable's exact state and current image/revision privately;
recreate only that revision and verify it. No new HEAD, worker or sync deployment.
Activation is a separate final administrative step after the client and
concrete release procedure have been verified. The current request for functional
Argos access authorizes this scoped integration; it does not expand the delegated
Talos service-admin relay. Karim's administrative account applies the configuration.
Roll back only the new variable
and skill/client installation; preserve application data and all worker secrets.

## Verification

19 October 2026, fresh checks:

| Requirement | Evidence | Result |
| --- | --- | --- |
| REQ-1/2 | Standard-library HTTP/CLI tests; actual reads of all 14 commands | 6 tests pass; real searches, detail, Places and analysis job reads pass |
| REQ-3 | Redirect, protocol-error, malformed JSON, invalid-filter and permission regressions | Pass; independent review findings corrected |
| REQ-4 | Native Hermes `skills_list`, `skill_view`, then Argos `terminal_tool` calling installed `stats` | Skill discovered/loaded, terminal exit 0, 4,001 posts |
| REQ-5 | Scoped Coolify activation and real authentication checks | Health 200, anonymous/invalid key 401, authenticated reads succeed |
| Compatibility | `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build -- --webpack` | Pass; 615 app tests passed, 259 DB-dependent tests skipped |

The initial sandbox run blocked three existing subprocess tests; the permitted
rerun passed all 615 runnable application tests. The six Python tests use a real
loopback fixture and include RED/GREEN fixes from independent review. Webpack is
used for the isolated worktree with external dependency symlinks. No application
source, dependencies, database schema or data changed.

Live search `cookie` returned 397 matching posts and traversed two pages. The
library contains 4,001 posts and Places reports 1,726 identified places at the
time of verification. Full post, place and linked-post details and a real analysis
job read passed. These counts are observations, not fixed product assertions.

Coolify deployment `n5dynzl37xlf33yz0mlxcedm` finished on the original revision
`dbc88f53d494f41b33cfd9ed7b0aad0e3911550c`; Docker image identity remained exactly
the same. Other containers and non-platform runtime environment were preserved.
Original `HEAD` tracking and automatic-deployment settings were restored. The
dedicated private Argos configuration is 0600; no raw key entered evidence.

Installed client: `/home/argos/.local/share/insta-explorer/client.py`. Installed
skill: `/home/argos/.hermes/profiles/argos/skills/insta-explorer/SKILL.md`.
Sanitized runtime receipt: `/home/argos/workspace/setup/evidence/insta-discord-api-20261019/verification.json`.
Private administrative release/rollback tooling remains under the repository's
`.tmp/discord-api-20261019/`, outside Git. The implementation is on the isolated
`feat/discord-api-access` branch. Karim explicitly authorized publication and
PR merge into `develop` on 19 October. The six client regressions are included
in `scripts/ci/check.sh`, using Python's standard library without dependencies
or generated bytecode. The PR records remote CI and merge evidence.

No actual Discord conversation or LLM response was exercised. Native skill
discovery, the exact Argos terminal tool, and the production HTTP path were
verified without sending messages. Access is read-only; writing, deleting,
syncing or triggering analysis is not exposed by this client.
