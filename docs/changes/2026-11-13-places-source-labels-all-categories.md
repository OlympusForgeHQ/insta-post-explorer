# Source names for shops and sights at verified addresses

## Authorization and scope

A worker audit found Brussels shops shown under their street address although
the post names each of them. The owner asked for the rule to be corrected and
for a reliable fix, including the saved places.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Critical (persistent place
identity, same route as the 13 October label change); READY. No migration,
dependency, provider, model, consumer or schedule change.

## Diagnosis

`sourceBusinessLabel` keeps the source name of a candidate verified by its
street address on an anonymous provider building. Since 13 October it applied
only to `restaurant`, `cafe`, `patisserie` and legacy `lodging`. The worker
classifies shops as `divers` and sights as `voyage`, so those places were saved
with the provider address as their name.

A read-only production count on 13 November found 230 building-level places
whose name is their address. Most are older than the 13 October rule or belong
to the two excluded categories; no later candidate has reached them.

## Requirements and implementation

- L1: the four business categories keep their exact previous behavior.
- L2: any other category receives the same label when the candidate name is a
  grounded venue name (`groundedVenueName`: written in the source evidence or
  spelled by a source handle, and distinctive beyond city, region, country and
  generic words).
- L3: a name contained in the verified address (a street or a square) is not a
  venue identity and gets no label.
- L4: everything downstream is unchanged: label contract, occupant conflict
  (`existing_identity_conflict`), legacy-address proof, manual protections,
  named provider entities.

Affected module: `sourceBusinessLabel` in `src/server/places/analysis.ts`. The
resolution policy version is unchanged: no candidate resolves differently, only
the label of an already accepted EXACT address.

## Changed expectation

The 13 October table test asserted that `voyage` and `divers` keep the provider
address. That expectation is the defect reported here and is changed on the
owner's decision; the test is kept and extended, not removed.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| L1, L4 | Existing label, occupant, legacy and manual-rename cases in `places-analysis-postgres.test.ts`, unchanged |
| L2 | Two rows of the existing table: `divers` and `voyage` names written in the caption are labelled |
| L3 | Three rows: name absent from the source, street name, city name keep the provider address |

No test file is added.

## Saved places

The change itself writes nothing. Existing address-named places are corrected
by a separate reviewed maintenance batch under the contract of
`2026-10-13-source-business-labels.md` (one proven source name per place, no
manual history, provider identity untouched). Receipts are private, under
`.tmp/source-labels-20261113/`; this record does not assert its completion.

## Limits

A second differently named occupant of the same anonymous building stays in
review, as it already does for restaurants. Before this change two shops of one
building shared a single address-named place.

## Rollback

Revert and redeploy the web/API. Labels already written stay valid under the
unchanged label contract.
