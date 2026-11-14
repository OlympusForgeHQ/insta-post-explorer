# Sights named without an address

## Authorization and scope

The 12 November worker audit left well-known sights of a Belgium guide
unresolved (Atomium, Gravensteen, Graslei, Hallerbos, Walibi, Plopsaland,
Dinant Citadel). The owner asked for the remaining reliability findings to be
fixed in priority order.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Critical (place identity);
READY. Web/API only. No migration, dependency, provider, model, consumer or
schedule change.

## Diagnosis

A read-only replay showed the provider returns the right entity each time; the
web/API rejected it for three reasons:

- homonyms: a monument shares its name with a pharmacy, a hotel or a bicycle
  parking in the same city, so the candidate was `ambiguous_branches`;
- several records of one large site (a forest and its entrance) lie more than
  100 m apart and were read as distinct branches;
- the provider catalogues the sight with a qualifier the post omits
  (`Walibi Belgium`, `Plopsaland Belgium`) or in another word order
  (`Citadel of Dinant`), so the name was `provider_entity_name_unverified`.

## Requirements and implementation

All rules apply only to a `voyage` candidate with a name and no address.

- S1: among same-named specific results, records whose provider classes are
  all services (commerce, catering, lodging, rental, parking, health,
  transport…) are set aside when at least one other record remains. Services
  alone stay ambiguous.
- S2: two same-named records are one site when one lies inside the other's
  provider bounds, within 5 km.
- S3: a provider name agrees when it contains every source word and each extra
  word comes from the provider's own country, city or class
  (`entertainment.theme_park` allows `Park`), on a record classified as a
  sight; or when both names have the same words in another order and the
  record is not a service. Reason `provider_name_qualified`; the result is at
  most `PROBABLE`.
- S4: a zero-confidence record still identifies nothing by itself. A qualified
  name now also qualifies it as a hint for the existing independent POI
  lookup within 200 m, which is what verifies it.
- S5: a host site (12 November) still needs its exact name.
- S6: restaurants, cafés, pastry shops, addressed candidates, another country
  and distinctive extra words (`Bellewaerde Aquapark`) are unaffected.

Affected modules: `src/lib/places/scoring.ts`, `src/lib/places/resolution.ts`,
`src/lib/places/approximate-resolution.ts`, `src/server/places/analysis.ts`,
`src/server/places/resolvers/geoapify.ts`. Policy `provider-context-v14`.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| S1, S2 | `places-resolution-plan.test.ts`, one table of five provider result sets, plus the restaurant negative |
| S3, S6 | Same file, one table of eight name/class/rank rows through `decidePlaceResolution`, each positive row re-checked as a restaurant and in another country |
| S4 | `geoapify-resolver.test.ts`: the POI lookup is made for `Walibi Belgium` and not for `Walibi Express` |
| S5 | Existing host table, unchanged, still green |

No test file is added. Three existing assertions change only the policy
version literal.

Read-only production replay of the 59 named, address-less candidates of the 60
latest travel analyses: no outcome is downgraded; 12 improve, among them
Atomium, Gravensteen (to `Castle of the Counts`), Graslei, Hallerbos, Walibi,
Plopsaland and Dinant Citadel.

## Limits

Bellewaerde, Hoge Venen, Semois Valley and Antwerp Central remain unresolved:
the provider returns no verifiable record for them. A lodging that shares the
name of a sight and is itself the subject of a travel post resolves to the
sight; the result is `PROBABLE` or follows the existing literal-name rule.

Saved posts are unchanged until reprocessed; receipts are private under
`.tmp/worker-audit-20261112/`.

## Rollback

Revert and redeploy the web/API. No data is written by the change itself.
