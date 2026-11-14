# Japanese block addresses located by a retrieval hint

## Authorization and scope

The 14 November sync imported a Tokyo guide reel. Its analysis read five
venues with their on-screen addresses; three stayed unresolved although the
owner finds them on Google Maps. The owner asked for the option that keeps
Google out of persistence.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Critical (place identity);
READY. Web/API only. No migration, dependency, provider, model, consumer or
schedule change.

## Diagnosis

Extraction is complete (12 frames, transcript, 20 evidence rows). Resolution
fails at the geographic provider:

- it holds no POI for these restaurants, so the Google hint cannot be
  corroborated by a same-named record within 100 m;
- it cannot retrieve a romanised block address (`3 Chome-11-6 Shinjuku`)
  from text, or returns several `29-3` buildings of one ward with zero
  confidence;
- it does hold the right unnamed building: `11-6 新宿３丁目` lies 6 m from the
  Google hint, `29-3 宇田川町` 10 m.

## Requirements and implementation

- H1: only a Japanese candidate whose address carries exactly one block
  number (`3 Chome-11-6`, `3-11-6`, `29-3`) and one postcode (`160-0022`),
  both literal in the source evidence, is concerned.
- H2: the hints are those already obtained by precise retrieval for the same
  candidate. No extra Google request; at most three hints, two neutral
  provider lookups each (the source address biased to the hint, then the
  buildings at the hint). Requests carry an address or a point, never a
  business name.
- H3: a provider record qualifies when it is an unnamed building within 50 m
  of the hint, in Japan, in the source city without administrative conflict,
  with the same postcode and the same block number. The chōme is read from the
  provider's own label (`３丁目`, `三丁目`) or full number (`3-11-6`); a source
  without chōme does not match a numbered chōme.
- H4: several qualifying buildings more than 100 m apart resolve nothing.
- H5: the result is `APPROXIMATE`, building level, radius 100 m, named by the
  grounded source name, reason `hint_located_building`. It is never `EXACT`.
  It replaces only no result or a district/city zone.
- H6: nothing from Google is kept: no text, identifier or coordinate. Only the
  distance in metres between the provider building and the hint remains in
  memory during planning.

Affected modules: `src/lib/places/approximate-resolution.ts`,
`src/server/places/analysis.ts`, `src/server/places/resolvers/{types,fallback,complementary,geoapify}.ts`.
Policy `provider-context-v15`.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| H1, H3, H4, H5 | `places-resolution-plan.test.ts`, "Japanese block address located by a retrieval hint": two positives, eight rejected provider variants, literal-evidence and ambiguity negatives, precise result untouched |
| H2 | `places-google-hints.test.ts`: hints reused for the same candidate only, one Google search; `geoapify-resolver.test.ts`: request order, bounds, no business name, no request without hint or block address |
| H6 | Same resolver tests: no hint field in the returned records beyond the distance |

Read-only production replay of the job: Shinjuku Tei and Halal Wagyu Stall
move from `UNKNOWN` to an approximate building zone; Tendon Itsuki and Ramen
Honolulu are unchanged.

## Limits

Kineya Mugimaru (Narita airport, 5F) stays unresolved: the source names its
host in French and gives no block address, and the provider catalogues the
airport under another name. Tendon Itsuki keeps its district zone: its
on-screen address has no usable block number. Other countries are unaffected.

Saved posts are unchanged until reprocessed; receipts are private under
`.tmp/sync-places-20261114/`.

## Rollback

Revert and redeploy the web/API. No data is written by the change itself.
