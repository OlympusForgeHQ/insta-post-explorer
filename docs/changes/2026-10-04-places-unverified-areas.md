# Reject unverified area substitutions

Status: implemented, verified and independently reviewed; live pilot pending.

## Scope and acceptance

The owner authorized complete Restaurant/Voyages review, corrections, publication
and deployment. The pilot demonstrated named venues outside their accepted city
circles and differently categorized businesses collapsing into the same city
record. Knowing a venue's city does not establish its position within a fixed
radius around the city center.

This bounded Standard correction remains in Phase H. It changes
`src/lib/places/scoring.ts`, existing scoring, resolution-plan and PostgreSQL analysis tests, the
caption workflow and Places precision documentation, this evidence record, and
the handoff/status. No schema, migration, dependency, API shape or scheduler change.

- R1: named businesses, monuments and addresses stay UNKNOWN when the provider
  only verifies their contextual city/region. Evidence is retained without Place
  creation; categories never come from Geoapify.
- R2: explicitly identified geographic destinations and area-only candidates keep
  APPROXIMATE with existing radii. Natural city/village labels still work.
- R3: specific verified points, owner isolation and confirmed corrections retain
  existing behavior. A business named after a city cannot inherit that city area.
- R4: do not approve the pilot or start full analysis until corrected geographic
  plans and persistence have been reviewed.

Tasks: reproduce false city substitutions and category collision at the existing
scoring/plan seams; implement the identity guard; run required checks and review;
release under existing authorization; re-evaluate private pilot previews.

## Evidence

The focused tests failed before implementation: the scoring returned APPROXIMATE
for a named destination/address and planning selected the same city for a cafe and
pastry shop. The focused suite initially passed after the guard (34 tests). Independent review
then exposed generic hotel prefixes, explicit-address bypasses and accepted legacy
city labels; dedicated red assertions reproduce these before correction. Existing city
and radius assertions remain; the PostgreSQL city fixtures now explicitly use the
city destination category instead of inheriting a restaurant default; no new test file is added. This is an intentional
conservative tightening of the earlier R7 fallback, not a threshold adjustment.

Fresh final verification: 581 application tests across 75 files with disposable
PostgreSQL, all 90 worker tests, lint, typecheck and production build pass. The
35 scoring/planning checks also pass independently. Review is clear after the
hotel/address/legacy-city cases were fixed. The first full run exposed the two
city fixtures described above; both retain their original persistence assertions.
The sandboxed build initially could not bind its internal CSS worker port; the
normal build passed with that local execution permission. No live migration ran.

## Risks and recovery

Fewer named venues will be placed until a provider verifies their own identity.
They remain reviewable through retained evidence. Existing area records are not
silently deleted by this code; authorized scoped data review handles obsolete
associations separately. Rollback is a code revert with no migration.
Private source payloads, provider identities and operational receipts stay local.
