# Provider context recovery

The owner requested completion of the remaining Places cohort, preserving manual
decisions and using the existing extracted evidence. Live diagnostics reproduce
false conflicts caused by translated provider names, bilingual street components,
country aliases and structured name queries returning only a city fallback.

Route: Standard. Existing architecture, schema, providers and service schedules
remain unchanged. The owner has authorized correction, publication and deployment.

## Requirements and acceptance

- PC-1: A failed structured lookup gets bounded free-form retrieval using the
  original name and geography, in English and French. Successful existing lookup
  paths incur no extra requests. Retrieved alternatives still pass identity rules.
- PC-1b: If name retrieval still fails, query the POI catalog only within a
  uniquely verified city boundary. Preserve that boundary as provider evidence;
  ambiguous branches still require their existing scope/identity checks.
- PC-2: Current names/translated aliases explicitly returned for the same provider
  entity can corroborate its identity. Historical names and arbitrary metadata
  cannot. Entity aliases cannot become locality aliases for unrelated businesses.
- PC-3: Complete bilingual street components and common unambiguous country
  aliases must not cause false contradictions. Street extensions, different house
  numbers and different countries still reject.
- PC-4: A named geographical destination is represented as an approximate area
  when provider identity and geography corroborate it. An unrelated business or
  a city-named shop cannot become the destination. Area evidence retains bounds.
- PC-5: Apply only independently verified remaining candidates; retain original
  signed source evidence, category, candidate index and all existing manual data.
  Every correction has a durable receipt and replay creates no duplicate writes.

## Tasks and verification

1. Reproduce PC-1..4 in resolver/identity tests, then implement at the existing
   resolver and scoring seams. Use synthetic venue fixtures; no private posts.
2. Replay private provider diagnostics without writes, review changed decisions,
   and apply the targeted cohort through existing transaction/persistence logic.
3. Run lint, types, tests, build, independent review, CI and runtime checks.
   Compare before/after protected post data, deletions, Places and associations.

Public files: resolver/types, Geoapify adapter, identity comparison/resolution,
focused tests and affected worker documentation. Private probes, source inputs,
backups and receipts stay under `.tmp/places-remainder-20261013/`.

No change to automatic retry ceilings, provider quotas or canonical Google-data
policy. Remaining genuine ambiguities are surfaced with concrete evidence, not
converted into invented exact coordinates. Rollback uses the previous web image;
data additions remain independently journaled and existing records preserved.

## Evidence

| Contract | Verification |
| --- | --- |
| Retrieval, aliases, type discrimination and strict geography | `tests/unit/places-provider-context.test.ts`: eight focused tests, including wrong-country/cross-state boundaries and complete street negatives |
| Existing resolver and worker persistence behavior | Full suite: 725 tests across 95 files passed; PostgreSQL-backed cases included |
| Compile and style | TypeScript, lint, production build and diff whitespace checks passed |
| Independent review | Area guard propagation, city boundary address/region scope, directional street truncation and provider bounds audit findings corrected and regression-tested |
| Private corrections | Separate reviewed maintenance receipts; no batch completion claimed by this code change |

The new test file protects false positive locations and bounded provider recovery,
using synthetic fixtures only. No source posts or private research enter Git.
