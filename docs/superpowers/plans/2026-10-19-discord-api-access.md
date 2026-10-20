# Discord API access implementation plan

> Execute inline with superpowers:executing-plans; review the completed client independently.

**Goal:** let Argos answer flexible Insta Explorer requests through the existing API.
**Architecture:** bounded standard-library HTTP client plus an Argos skill. No MCP.
**Spec:** `docs/changes/2026-10-19-discord-api-access.md`.

## Constraints and review focus

Preserve existing server authentication and routes. GET only. Never forward a
key on redirect or output an upstream error body. Explicitly report partial
pagination. Imported captions are untrusted content. No production activation
before a reviewable, verified client and exact rollback procedure exist.

## Tasks

- [x] Add `services/api-client/test_client.py`: real HTTP requests prove filtered
  pagination, full detail and errors; malicious paths/redirects cannot leak a key.
  Run unittest and observe missing implementation failure.
- [x] Add `services/api-client/client.py`: command catalog, strict query validation,
  bounded HTTP GET client, safe private configuration loading and JSON CLI.
- [x] Add `services/api-client/argos-skill/SKILL.md` and `README.md`: natural-language
  workflows, full capability catalog, installation and rollback guidance.
- [x] Run focused Python tests and existing API tests, lint, typecheck, test, build.
  Review final diff; update evidence and handoff docs.
- [x] Prepare exact scoped activation and rollback using installed Coolify behavior;
  activate the read access requested for Argos through Karim's administrative account.

## Execution ledger

- Discovery: develop 752e19e, clean isolated `feat/discord-api-access` worktree.
  Existing Discord Argos has terminal + skills. Production API 503 independently
  diagnosed by Talos on 19 October. No extra runtime or MCP is needed.
- Ruling: use Python standard library because Argos already runs Python and this
  client does not need the web build/runtime or new npm dependencies.
- Complete: six client tests, 615 runnable application tests, lint, types and build.
  Independent client/release review findings corrected. Same-image activation,
  all live read commands, skill discovery and Argos native terminal passed.
  Original deployment controls restored. No Discord message/LLM call;
  259 database-dependent tests remain skipped locally. Final proof is in the spec.
- Publication: Karim explicitly authorized push and merge on 19 October.
  Include the client regressions in `scripts/ci/check.sh`; publish the feature
  branch and merge its PR into `develop` after remote CI validation.
