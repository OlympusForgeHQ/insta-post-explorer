# Separate Instagram sync and Places execution

**Status:** Accepted by the owner, 4 October 2026.

The owner approved two services and requested configuration of the new service
with OpenRouter and DeepSeek V4.1 Flash. This supersedes the single-deployment
worker restriction in the July architecture documents for this specific split.

Instagram synchronization retains its existing Coolify deployment and schedule.
Places receives a separate systemd service, `insta-explorer-places.service`, using
the installed Hermes runtime with its own state, secrets, local API and resource
limits. The deployment artifacts live in `services/worker/places-hermes` in the
same repository. This uses Hermes' existing API adapter, not a new MCP server,
database, application API, or storage service.

Alternatives considered: adding inference to the sync process couples failure
and resource use; duplicating the entire application would duplicate business
rules. Separate execution with shared application contracts preserves both
operational independence and one source of business truth.

The current slice provisions the inference runtime. Its model is
`deepseek/deepseek-v4.1-flash` through `https://openrouter.ai/api/v1`. It does not
yet poll the Places queue: the multimodal handler and application write API are
separate, unfinished work. In particular, an empty handler must never claim or
complete a real post job. Future orchestration must use the existing owner-scoped
queue and application API, preserve deletion tombstones and confirmed edits,
and process one post at a time.

The runtime reuses Hermes 0.21.5 installed at commit
`f97608f178d1ffeca59860195ab7da295f7c8e5f`. Other Hermes profiles are hidden from
the service filesystem. Its local API has a dedicated random Bearer credential;
the existing OpenRouter credential is copied privately without logging it.
Sharing that upstream key shares its account quota; a scoped key can replace it
later without changing the service architecture.

Rollback stops/disables only the new unit. Keep its state and evidence; do not
modify the Instagram schedule, Argos, Cortana, or production application data.
