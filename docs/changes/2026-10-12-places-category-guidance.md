# Places category guidance and incremental refresh

Mode: Critical (production data writes). Owner-authorized: improve the existing
Places worker and run it after Restaurant/Voyages post classifications changed.
No new taxonomy, service architecture, provider, schema or eligibility rule.

## Requirements and scope

- REQ-001: Classify each recommended entity independently into the existing
  restaurant, cafe, patisserie, voyage or divers category. Distinguish a venue's
  purpose from incidental products, neighboring venues and the post theme.
- REQ-002: Keep a known canonical category and its supporting metadata when a
  later post cannot identify the venue type. A supported specific correction
  remains possible; manually confirmed places and earlier PLACE_CATEGORY_CORRECTED audit
  evidence remain protected even when legacy confirmation flags are absent.
- REQ-003: Refresh only currently eligible posts never previously analyzed.
  Capture an immutable private cohort; do not bulk-enqueue the entire library.
  Revalidate eligibility and source identity at claim/completion.
- REQ-004: Preserve original captions, user tags, deletion tombstones, manual
  confirmations and existing reviewed post associations. Record new attempts,
  geographic decisions and writes in existing jobs/evidence/audit facilities.
- REQ-005: A bounded serial batch uses the existing scoped API, media extractor,
  inference endpoint, lease, heartbeat and cleanup. Unknown locations remain
  unresolved. Existing classification/translation and sync keep running.

## Design and verification

Server-owned category instructions travel through the existing prepare/claim
contract. No keyword-only classifier or provider-category mapping is added.
Canonical persistence protects a specific category from an unknown later guess,
while still storing the later post's evidence and link separately.

Tests: existing category/worker contracts and PostgreSQL integration; add one
shared-place regression covering unknown proposals and specific corrections,
and a legacy correction regression covering unflagged manual review. A synthetic real-provider category exercise measures the
prompt against mixed itineraries and misleading food/product mentions. This
does not establish accuracy across the whole library.

Operational phases: private inventory and protection snapshot; exact source
build/tests/review; web rollout with sync deployment controls preserved; limited
live pilot; scoped background batch after pilot verification; status and journal.
The owner already authorized execution and publication/deployment in this thread.

## Risks and recovery

- Reclassification changed tags/hashes on previously reviewed posts. Never use
  a changed hash alone to select a historical post for this refresh.
- Shared canonicals may be encountered again. Manual confirmation wins and a
  less informative classification cannot erase a known category.
- Provider ambiguity is not repaired with invented addresses or coordinates.
- Stop batch admission on repeated infrastructure failures. In-flight work owns
  its lease and cleans temporary files. Resume from durable jobs/checkpoints.
- Roll back code to the prior web revision if health or pilot checks fail;
  preserve audited additions for review rather than delete existing data.

## Evidence

Private inventory, pilot, deployment, queue and preservation receipts are stored
under `.tmp/places-refresh-20261012/`, excluded from version control. Never publish
source captions, provider credentials or private snapshots.

Local verification: 679 application tests passed with the disposable PostgreSQL
service. Lint, TypeScript, application build and unchanged worker build passed.
The two new persistence scenarios demonstrated failures before their fixes.
Independent review confirmed the final canonical-action filter; link-only review
continues to allow supported automatic category corrections. Eight synthetic
real-provider cases passed across all five categories, without extra places.
Production deployment and batch admission are separately gated on live access
and pilot evidence; local test success is not a rollout completion claim.
