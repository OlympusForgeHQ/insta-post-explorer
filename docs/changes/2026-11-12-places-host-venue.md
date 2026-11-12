# Venues located by their host site

## Authorization and scope

The 12 November worker audit showed attractions located only by the park that
hosts them ("Cars Land", address "Disney California Adventure") ending as
unresolved or as a city-wide zone. The owner decided they must be attached to
the host site automatically.

VIBESPEC PREFLIGHT: insta-saved-post-explorer; Standard; medium risk; READY.
Web/API change only. No migration, dependency, new provider, model, prompt,
consumer release or schedule change.

## Requirements and implementation

- H1: a host is a single literal, non-numbered name in the candidate's address,
  present in that candidate's own evidence. Streets, lists, numbered addresses,
  the venue's own name and its city, region or country never qualify.
- H2: the host is looked up only when no precise result exists and the best
  available zone is a district, a city or nothing.
- H3: the host must be one geographic-provider entity bearing exactly that name
  (or one of its own aliases), with its own bounds, in the source city. A hotel,
  station or shop named after the host is a different entity. A same-named
  record outside the chosen site's own extent makes the host ambiguous.
- H3b: a city the model only deduced is a retrieval hint, not source evidence.
  The literal host name and the country then carry the identity. A city written
  in the source must still agree.
- H4: when the provider knows the venue itself inside the host's bounds, that
  entity is kept with its normal precision (`verified_inside_host_venue`).
- H5: otherwise the venue is saved as an approximate zone covering the host
  (`contextual_area_venue`, level `venue`), never as an exact pin. Source name,
  source evidence and provider fields are unchanged.
- H6: host lookups use the geographic provider only. They never spend Google
  hint or web-research requests.

Affected modules: `approximate-resolution.ts`, `analysis.ts`, the resolver
interface with its Geoapify, fallback and complementary implementations, the
area-level contract in `map-view.ts`, and the place detail sheet wording.
Policy version is `provider-context-v13`.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| H1–H5 | `places-resolution-plan.test.ts`, "venues hosted inside a named site": zone, inside entity, five refused hosts, entity outside bounds, four non-host addresses, existing precise result. The three positive cases failed before the change |
| H6 | `places-complementary-resolver.test.ts`: the composite resolver forwards the host lookup and calls neither Google hints nor web research |

A read-only replay of the recent unresolved candidates against the live provider
is recorded privately under `.tmp/worker-audit-20261112/`; it determines the
actual recovery, not this document.

## Limits

The host must exist in the geographic provider under the name the post uses.
On the audited post (ten attractions), a read-only run against the live provider
attaches seven: five host zones, one attraction found inside its park, one
smaller host record. Three stay unresolved: the provider names one park
differently ("Disney's Animal Kingdom") and lacks usable records for two.
The zone covers the whole host; it does not locate the venue inside it.

## Rollback

Revert and redeploy the web/API. Places saved with level `venue` would then be
shown with the generic approximate wording.
