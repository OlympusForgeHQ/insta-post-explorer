# Places street-number parsing

## Authorization and scope

The owner reported that the 12 November 2026 sync placed two Paris cafés in a
city-wide approximate zone although both addresses are written in the caption
and shown in the video. The owner asked for the fix to be completed.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Standard; medium risk; READY.
No migration, dependency, provider, model, consumer or schedule change. The
owner then authorized publication, deployment, recovery of the two saved places
and further hardening of the same comparison (N6–N7).

## Diagnosis

Extraction was correct. The worker stored both literal addresses:
`11 bis Rue Georges Berger, 75017` and `30, avenue Montaigne 75008`. The failure
is in the web/API comparison of a source address with a provider building:

- `11 bis` was read as house number `11`. A provider building numbered `11 bis`
  or `11bis` therefore contradicted the source, and the street fallback compared
  `bis Rue Georges Berger` with the provider street.
- In `30, avenue Montaigne 75008` the number stands alone before its comma, so
  the trailing postcode `75008` was taken as the house number. The numbered
  street segment also never equalled the provider's `30 Avenue Montaigne`.

Every building-level result was rejected as `address_contradiction`, so only the
city result survived and the contextual fallback used the whole of Paris.

## Requirements and implementation

- N1: `bis`, `ter` and `quater` are part of the house number. `11 bis` equals
  `11bis` and differs from `11`, in both directions.
- N2: a short number alone in the first component, followed by a street
  component, is that street's number. A lone 4–6 digit value keeps the previous
  behavior because it is more plausibly a postcode.
- N3: a postcode written after the street without a separator is ignored only
  when it equals the provider's own structured postcode. A different postcode
  still fails.
- N4: a provider street whose own name starts with a suffix word
  (`5 Ter Platen`) keeps verifying against number `5`.
- N5: the street-envelope fallback removes the suffix together with the number.
- N6: the provider's own postcode followed by its own locality is ignored the
  same way (`30 avenue Montaigne 75008 Paris`).
- N7: a street followed only by the provider's postcode has no house number.
  It is left uncorroborated instead of contradicting the provider's number, so
  the street envelope remains available.

Affected modules: `src/lib/places/scoring.ts`,
`src/lib/places/approximate-resolution.ts`. Policy version is
`provider-context-v12`, following the convention for resolution-rule changes.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| N1–N4, N6–N7 | `places-scoring.test.ts`, one table of ten cases through `decidePlaceResolution`; the five affected rows failed before the change |
| N5 | `places-resolution-plan.test.ts`, one added row in the existing street-envelope table; failed before the change |

Fresh local results on the final tree: lint, typecheck and production build
pass; 875 unit tests pass with 320 database-bound skips.

No test file is added; both suites already cover this module.

## Limits

The provider payloads for these two addresses were not replayed: the read-only
production probe was not permitted in this session. The fixtures use the
structured shape Geoapify returned for the six sibling addresses of the same
post. If Geoapify has no `11 bis` building, that café resolves to its street
envelope instead of an exact pin.

The post writes number 30 for the Dior café; the venue's own site lists 32. The
source address is what is verified, so the pin follows the post.

The two saved places are unchanged until the web/API is deployed and the post is
reprocessed. Release and recovery receipts are recorded on the pull requests and
privately under `.tmp/places-street-number-20261112/`.

## Rollback

Revert this change and redeploy the web/API. No data is written by the change
itself.
