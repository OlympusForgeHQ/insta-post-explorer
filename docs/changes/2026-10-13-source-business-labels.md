# Source business names at verified anonymous addresses

An anonymous Geoapify building previously became a Place whose display name was
only its address, even when the accepted source candidate named the business.
The existing canonical upsert now uses the source business name in this narrow
case while preserving the provider response, identity, location and score.

## Approved scope and contract

This bounded correction starts at `67948aee`. It changes only Places persistence,
its existing PostgreSQL tests and this documentation. VibeSpec route: Critical
because a building provider ID may be shared by distinct occupants. The existing
owner-scoped worker and metadata pipeline satisfies the entry gate. No schema,
dependency, provider, service, endpoint or UI change is required.

All conditions must hold to create a source label:

- `resolved.providerName` is explicitly `null`; an absent legacy field is not
  proof that the provider returned no name.
- Provider type is `building`, `house` or `housenumber`.
- The accepted score is `EXACT`, including `verified_street_address`.
- Source category is `restaurant`, `cafe`, `patisserie` or legacy `lodging`.
- The source candidate has a nonempty name.

`displayName` retains that source name's spelling after trimming, and
`normalizedName` uses the existing search normalizer. No title-case transform,
provider-name replacement or score promotion occurs. Named POIs retain their
existing provider display behavior.

The exact metadata contract is `Place.metadata.label`:

```json
{
  "source": "source_candidate_verified_address",
  "candidateName": "Maison Étoile",
  "sourcePostId": "source-post-id",
  "providerName": null,
  "providerDisplayName": "10 Main Street, Dubai, United Arab Emirates"
}
```

These five fields describe a source business name at a verified address. They do
not assert that the provider identified the occupant, create a USER confirmation,
or teach the verified identity memory. Original source and provider evidence stay
unchanged. Repeated recognized aliases retain the first label and provenance.

## Occupants, legacy data and manual decisions

The existing unique key `(ownerId, provider, providerPlaceId)` cannot represent two
businesses sharing one anonymous building ID. Before any early return, including
manual confirmation, legacy category protection and `preserveExisting`, the
upsert compares the incoming identity with the recorded source label or existing
business label. A different occupant remains `UNKNOWN` with
`existing_identity_conflict`; its evidence is retained for review without a new
link or mutation of the existing place.

A later manual canonical rename may leave the old source-label metadata behind.
If its business identity disagrees with the current display name, neither name
can authorize automatic reuse: the candidate stays in review. This gate applies
to both the same provider key and cross-provider alternatives before returning a
manually confirmed place. Equivalent spelling/descriptor aliases remain valid.

The comparison reuses `entityNamesAgree` in both directions because a compact
source handle can be on either side. Its complete-name and generic-descriptor
rules remain unchanged. A distinct commercial alias needs separate proof; nearby
coordinates or a shared street address do not establish identity.

Old address-only rows without reliable business identity are not renamed by the
next candidate. They remain for a separate reviewed historical audit. Existing
manual labels and rejections retain priority; they must not be used to attach an
unrelated new occupant. Cross-provider reuse compares the business identity but
retains the existing same-address, distance, uniqueness and owner constraints.
A neighboring branch is never collapsed into the existing one.

The first canonical source label remains stable for accepted aliases or a later
unspecified category. Existing stronger canonical certainty remains protected,
while each link retains its own score. If a later provider supplies a matching
named entity, its normal provider display behavior can resume.

## Separate historical maintenance

No historical backfill is included in this product change. An approved maintenance
batch must restrict itself to its reviewed creation cohort, reload current rows
and check all current linked candidate identities and evidence for each provider
ID. It must exclude USER-protected names, ambiguous occupants and missing
provenance. Names are copied from an identified source candidate, never inferred
from the address or selected arbitrarily among conflicting candidates. Provider
identity, location, score, category, flags and original evidence remain unchanged.
The five-field metadata contract above is also used by reviewed source-label
backfills; it is not a manual USER identity correction.

## Acceptance and evidence

| Risk | Existing PostgreSQL test coverage |
| --- | --- |
| Address shown instead of an accepted source business | Anonymous verified building receives source label and provenance; raw provider is unchanged |
| Two occupants collapse under the same provider ID | Sequential automatic/manual/preserve cases and concurrent transactions; no second link |
| Alias churn or weaker mention erases a label | Descriptor and compact aliases reuse one identity with original spelling, provenance and stronger certainty |
| Legacy address is assigned to a new occupant | Address-only row remains unchanged and the source stays in review |
| Stale source provenance overrides a manual rename | Same-provider and cross-provider renames retain the canonical row and reject links for either conflicting name |
| Wrong owner or neighboring branch is merged | Owner isolation and cross-provider same-site versus neighboring-address checks |
| Named provider behavior changes | Named POI, nonbusiness categories and missing provider-name field retain provider labels |

All new scenarios live in the existing `tests/unit/places-analysis-postgres.test.ts`.
The first regression failed on the address-only label. Eight identity/alias cases
then failed before the collision guard; the compact alias separately reproduced
the directional comparison problem. Tests use real disposable PostgreSQL with
synthetic provider responses, without provider network access.

The final integrated patch passed all 752 tests in 96 files, including the
manual-rename follow-up, plus lint, typecheck and the production Turbopack build.
Independent review covered
specification compliance and canonical identity safety. Runtime rollout evidence
is recorded separately before release.

Rollback is code-only: retain source labels and provenance; an older implementation
may resume overwriting labels, so suspend affected reanalysis until enforcement is
restored. Historical data maintenance remains separately reviewed and journaled.
