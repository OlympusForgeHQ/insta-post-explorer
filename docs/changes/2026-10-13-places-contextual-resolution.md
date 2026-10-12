# Contextual Places resolution

Owner-approved scope: infer missing geography from combined context, use verified
corrections as memory, and recover remaining candidates without replaying the
completed historical review. Publication and deployment are authorized in-session.

## Requirements and implementation sequence

1. Replace the weighted-score acceptance gate in the current resolver path with
   explicit identity rules. Missing fields are neutral. Conflicting countries,
   cities, street numbers and named occupants cannot be outvoted. Multiple branches
   remain unresolved. Reuse the existing comparison helpers and precision contract.
2. Allow the model to infer country/city/region from the whole post and geographic
   knowledge, marking inferred fields separately from literal evidence. Never
   generate provider IDs or coordinates. Split distinct branch addresses.
3. Retrieve owner-scoped confirmed Places as contextual memory. Only corroborated
   identity/context may supply missing fields; no chain-wide street-address
   propagation, unreviewed model feedback loop or reuse of rejected places.
4. Add optional Google Places retrieval within the current resolver interface,
   with bounded requests, minimal fields, validated responses and stable errors.
   Keep Geoapify and existing jobs/API/worker services. No schema migration.
5. Store per-candidate decision reasons and inferred fields in existing JSON
   metadata. Preserve original evidence. Make partial success reviewable.
6. Verify, review and release the exact tested tree. Snapshot production first;
   preview a varied remaining-only cohort before committing justified associations.
   Respect current hashes, owner, manual changes, rejected places and deletions.

Files: `src/lib/places/{candidates,scoring,resolution}.ts`,
`src/server/places/{analysis,worker,resolution-memory}.ts`, resolver adapters,
`services/worker/src/places/{api,inference}.ts`, targeted unit/PostgreSQL tests,
deployment validation and this evidence document. Add recovery entry points only
if the existing guarded API cannot safely handle unresolved-only replay.

Tests: missing-country/low-model-confidence positives; contradictions, homonyms,
wrong occupants and area-vs-business negatives; owner-isolated verified memory;
Google parsing/timeouts/errors; inference provenance and partial-result receipts;
unchanged manual rows and idempotent replay. Run app lint/types/tests/build and
worker tests/types/build. Use the existing disposable PostgreSQL test database.

Risks: provider disagreement, branch ambiguity, inferred-context contamination,
duplicate canonicals across providers, stale jobs and automated feedback loops.
Mitigations are explicit evidence rules, bounded retrieval, no writes on stale
inputs, existing manual guards and before/after integrity receipts.

Rollback: disable Google fallback, restore prior web/worker release; retain audit
receipts. Any data rollback targets only this recovery's inserted links/places
after checking later manual changes, never a blanket database restore.

Validation: 693 application tests (92 files), 183 worker tests (27 files),
4 Python pretests, application/worker type checks and lint passed with Node 24.
Application and worker builds passed. One existing UI timing test failed during a
concurrent run; an unchanged full-suite rerun passed. Independent review found and
verified fixes for identity substitution, street/region contradictions, five-digit
house numbers, cross-provider manual rejection bypass and quota deletion races.
Synthetic live inference inferred France from Paris and returned no place for a
home recipe. No schema migration or new service.

Deployment, pilot, backup and remaining-only correction receipts are private in
`.tmp/places-context-20261013/`; read them before claiming live completion.
