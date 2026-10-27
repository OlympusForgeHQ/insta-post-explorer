# Places evidence and geographic context

## Authorization and scope

The owner requests correcting the diagnosed post and improving future analysis.
Publication, deployment and scoped recovery are authorized. Existing categories,
protected tags, manual places, deletions and successful associations remain intact.
This is a bounded improvement to the existing Places domain.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Critical; high identity risk; READY.
No migration, new dependency, model, service, provider or historical backfill.
Reuse the current API, worker leases, resolver budgets and persistence services.

## Requirements and implementation

- E1: reject duplicate JSON keys, including escaped equivalents, before parsing
  can silently discard evidence. Use the existing bounded repair call.
- E2: require scope references to point to actual evidence. Validate in the
  consumer and server before provider requests or writes; retain compatibility
  when reading historical source payloads for audited recovery.
- E3: uncertain or differing OCR proposals trigger visual fusion review with
  same-media neighboring frames, bounded by the existing ten-image admission.
  Confidence triggers review, never automatic deletion. Keep distinct recommended
  businesses; product lettering alone does not establish another venue.
- E4: bind city variants only through the same verified administrative entity,
  explicit country, exact provider identity, full match and containing bounds.
  Preserve source evidence, grounded canonical cities and smaller verified areas.
  Inferred cities cannot use this path as literal geographic proof.
- E5: use the existing refinement slot for a provider's full researched street
  name. A narrow Italian given-name expansion preserves street type, surname,
  house number, postal code and locality. Directional, numeric, unit and unknown
  inserted qualifiers fail closed; misspellings are not globally equated.
- E6: recover one reviewed association using separately recorded external
  research and exact cached provider geometry. Preserve original model output,
  all unrelated data and manual history, with atomic audit and idempotent replay.

Affected modules are the Places consumer inference/evidence/frame-review helpers,
server completion validation, provider context/scoring/approximation, bounded
complementary resolution, and their existing tests. Policy version is v11.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| E1–E2 | Nested/escaped/string-content parser cases, bounded repair, actual evidence-index regressions, PostgreSQL preview/complete rejection with zero resolver calls or writes |
| E3 | Actual analyzer seam tests for review selection, timestamps, same-media boundaries and image capacity; private live replay using the diagnosed post's cached media |
| E4 | Country/entity/bounds negatives, immutable inputs, grounded city+alias with unverified unit preserving building fallback; no inferred-city bootstrap request |
| E5 | Full resolution tests for allowed name expansion and inserted directional/numeric/unit/unknown qualifiers; request-slot limits retained |
| E6 | Private cache-only operator preview, source/protected hashes, exact plan, audit transaction and durable replay on isolated PostgreSQL before production |

Fresh validation passes 1,165 application tests, 266 worker tests, eleven explicit
worker PostgreSQL checks and nine ASR tests. Lint, type checks, production builds
and independent reviews are release gates. Private verification receipts record their
actual results; public fixtures contain no saved posts, media or credentials.

## Limits and rollback

Visual context improves semantic grounding but cannot guarantee perfect OCR or
identify an unmarked establishment. Unsupported names and conflicting geography
must still remain reviewable. City approximation indicates a verified area, not
an established branch address. Research remains separate from Instagram evidence.

Deploy web/API before the Places consumer, only when its queue and inference
service are idle. Keep classification, sync and Hermes processes and credentials.
Roll back web to `7e0917b76a1df9a31fb0233fbb418ef5c66dd826` and Places consumer to
`20261026-video-frame-admission-v1` if runtime verification fails. Restore original
automatic deployment settings after success. Data rollback is audit-directed and
must not delete subsequent manual corrections or the immutable source job.
