# Places analysis integration and owner categories

**Mode:** Critical
**Status:** Implemented and code-reviewed; production pilot pending
**Owner:** Karim, instructions of 4 October 2026

## Problem and outcome

The isolated Hermes endpoint can analyze real posts, but it has no production
orchestrator. The metadata importer currently overwrites the proposed category
with Geoapify's classification. The owner explicitly rejects that behavior.
Deliver the next coherent Phase H slice: serial post analysis through Hermes,
validated evidence and categories, and authenticated atomic Places persistence.
The existing Instagram synchronization remains independent.

## Requirements

- REQ-001: Use exactly Restaurant, Café & brunch, Pâtisserie, Voyage, Divers.
  Machine keys: restaurant, cafe, patisserie, voyage, divers. Classify the actual
  establishment/destination from its description, spoken content and visible
  text. Cafes/brunch and pastry specialists take their specific category; travel
  destinations/accommodation/attractions use Voyage; unknown types use Divers.
  Neither the post theme nor Geoapify's category decides the classification.
- REQ-002: Geoapify only verifies identity/address/coordinates. Persist the model
  classification with bounded source evidence and provenance. Preserve confirmed
  manual data. Historical provider strings have no classification authority and
  fall in Divers until reanalysis; do not mass-rewrite existing rows.
- REQ-003: The application owns all queue and domain writes behind the existing
  V1 Bearer mechanism with a separate worker scope. Read and sync keys cannot
  write Places. Hermes has no DB/R2 credentials or tools.
- REQ-004: Process one eligible Restaurant/Voyages post at a time. Use owner,
  input hash, pipeline version, finite retry, lease and heartbeat. Completion
  rechecks the post under lock: deletion, changed input/theme or lost lease
  prevents all Places writes. Retried completion does not duplicate data.
- REQ-005: Analyze caption, image/video text and full available audio. Download
  only server-authorized VERIFIED media with a GET-only signed URL. Probe before
  processing; bound size/duration/frames. Unavailable/truncated required media
  cannot be reported as a complete successful analysis. Multiple places supported.
- REQ-006: Treat every caption/transcript/frame as untrusted data. Strict schema
  rejects model coordinates/provider IDs and extra fields. Keep only bounded
  text/timestamps/provenance; no intermediate media in DB or R2. Cleanup on every
  exit and expired workspaces at startup.
- REQ-007: A named post pilot and explicit bounded batch command use the same
  pipeline. Retain a zero-write preview mode. No unattended all-library launch
  as a side effect of deploying configuration.

## Limits and compatibility

- At most 250 MiB per medium, 300 seconds per video, 12 sampled frames per video,
  20 media per post, 50 candidates, 8 excerpts of 500 characters per candidate.
- At most 3 attempts per job, 15-minute lease, 30-second heartbeat, 20-minute
  processing deadline. Server uses its own clock and a fresh claim token.
- Server geocoding is authoritative. Unknown results create review evidence,
  not invented pins. All business mutations keep the existing audit triggers.
- No new business table. One additive migration adds AUDIO_TRANSCRIPT, VIDEO_OCR
  and VISUAL_LANDMARK to PlaceEvidenceType: the design documents named them but
  the live schema only implemented metadata evidence. Place.metadata stores
  classification provenance. Production uses an isolated migration bundle due
  to the documented historical migration divergence; rollback leaves unused enum
  labels in place and retains all evidence.
- Existing read API, caption import and synchronization remain compatible.

## Architecture and risks

Selected: a thin V1 worker adapter over src/server/places, plus a CLI orchestrator
in services/worker calling the isolated Hermes API. The application issues
short-lived GET-only media URLs for known objects. This avoids distributing DB
or bucket credentials to inference. Rejected: direct DB writes from Hermes;
rejected: a duplicate Places storage/queue or third permanent service.

The new CLI is invoked explicitly for the first pilot. Continuous scheduling is
enabled only after measured validation; the existing Hermes unit is sufficient
for inference and no extra long-running service is introduced by this slice.
Provider timeouts retry boundedly; uncertain candidates remain reviewable.
Sensitive URLs/keys/content never appear in logs. Feature flag off closes worker
endpoints; rollback disables orchestration and retains places/audit history.

## Acceptance and evidence

AC-001: A cafe proposal with Geoapify fast_food persists cafe and filters as
Café & brunch; unknown category is Divers. Existing confirmed edits survive.
AC-002: Real PostgreSQL integration proves claim exclusion, stale/deleted input,
expired claim rejection, completion replay and atomic results/evidence.
AC-003: Worker tests prove serial operation, abort/timeout/error cleanup and
bounded media handling; malformed/injected model output cannot write data.
AC-004: Real single-post pilot updates Terre d'Azur to Café & brunch based on the
post, retains its existing canonical identity, and shows it in Places. Record
actual stages, model, counts, audit IDs and any limitations.
AC-005: Lint, app/worker types, tests, build, targeted browser checks and an
independent review pass. Full Phase H approval still requires the 30–50 post
measured pilot; a single-post success does not claim that gate complete.

## Out of scope

Unified MCP commands, new website crawling service, historical deletion recovery,
new storage, and an unattended full backfill before the pilot review.
