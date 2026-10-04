# Preserve confidence for the same shared place

**Mode:** Critical (concurrent persistence)  
**Status:** Implemented and independently reviewed  
**Owner:** Repository owner / Codex

## Problem and outcome

A second post with weaker textual evidence can replace an existing EXACT place
with PROBABLE even when Geoapify returns the same identity, address and point.
Each post needs its own confidence, while the shared place retains the strongest
verified resolution for unchanged geographic data.

## Requirements and acceptance

- REQ-001: Identical provider identity, name, category, address, locality, country
  and coordinates retain the better precision, then the higher confidence for
  equal precision. Approximation radius stays paired with the retained score.
- REQ-002: Each post link and its provider evidence retain their own analysis
  score. A weaker post does not inherit the other post's certainty.
- REQ-003: Changed geographic identity data or category use the new automatic
  proposal, allowing actual corrections. Confirmed canonical places remain
  protected by the existing policy.
- REQ-004: Existing canonical rows are locked before reading their score so a
  concurrent stronger update cannot be overwritten from an old snapshot.

The PostgreSQL analysis seam tests both processing orders, post-specific provider
evidence, changed-location corrections and a writer blocked by an uncommitted
stronger update. Existing tests cover ownership, confirmed edits, approximate areas,
unknown candidates, source freshness and atomic persistence.

## Design, scope and risk

Keep persistence in `src/server/places/analysis.ts`. A provider-identity row lock
within the existing transaction serializes updates to an existing shared place;
no new queue, endpoint, provider, schema or migration is introduced. An unlocked
read followed by a maximum computed in JavaScript is insufficient because its
snapshot can be stale. Scores are retained only for identical resolution data;
retaining all older coordinates could hide a real geographic correction.

The changes are confined to the analysis service, its existing PostgreSQL test,
this record, HANDOFF and IMPLEMENTATION_STATUS. Temporary tests use a separate
database. Public documentation contains no post identifiers or private evidence.
The lock can delay concurrent writers for one existing place until transaction
completion; existing timeout/rollback semantics apply. New-place insertion
conflicts continue to use the existing unique identity constraint.

## Rollout and rollback

Owner authorization covers publishing, merging, deploying and completing the
library correction. Require focused PostgreSQL tests, full app checks, independent
review and healthy deployment before the pending shared-place reevaluation.
No stored records are migrated. Roll back by deploying the previous application
revision; original post-specific evidence remains in the modification journal.

## Verification

The original strong-first case failed with PROBABLE instead of EXACT before the
fix. After the fix: focused PostgreSQL18/18, full application601/601, lint and
typecheck pass using Node24 and a disposable database. Production build passes.
Independent review found no blocking issue. The concurrent test waits for a real
PostgreSQL row lock, releases the stronger writer, and verifies that both the
shared certainty and weaker post score survive.

REQ-001 maps to the two processing-order cases; REQ-002 additionally asserts the
weaker provider evidence; REQ-003 maps to changed coordinates and existing manual
confirmation tests; REQ-004 maps to the blocked-writer case. Deployment health is
verified after merge. Library review continues separately and is not represented
as complete by this code change.
