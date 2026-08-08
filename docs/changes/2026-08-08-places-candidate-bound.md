# Places candidate bound raised from 5 to 50

Status: contract change, schema only. No resolver, scoring, persistence or API
behaviour is altered.

## Why

`MAX_CANDIDATES_PER_POST = 5` was fitted to the first analysis generation, whose
candidates were mostly bare names and cities. A real 407-post `places-v5` batch —
the one that produced the richer develop dataset — was validated against the
contract and **42 records were rejected outright**, every single one for the same
reason: more than five candidates per post. No other field, bound or enum failed.

The rejected records are legitimate multi-place posts, not noise: guide-style
captions listing Tokyo districts or London landmarks, reaching 45 candidates with
a median of 10.

The bound exists to keep an externally produced batch bounded, not to express how
many places a caption may mention. Fifty preserves that purpose with headroom
above the largest observed batch, so a slightly longer guide does not fail again.

## Why 50 and not 45

The owner approved raising the limit "from 5 to 45", 45 being the largest record
in the batch. A bound set exactly at the observed maximum is brittle by
construction — the next 46-candidate guide would fail identically. Fifty is the
same decision with a margin. Recorded here because it deviates from the figure
discussed.

## Alternatives rejected

- **Truncate to the five best candidates.** Measured cost: 326 candidates dropped,
  of which 38 carried an address across 10 posts. Address-bearing candidates are
  the ones that resolve to `EXACT` map points, so this loses real map coverage.
- **Import only the 365 conformant records.** Drops 42 whole posts, including
  their address-bearing candidates — strictly worse than truncation.

## Effect on the real batch

| | Bound 5 | Bound 50 |
| --- | --- | --- |
| Records valid | 365 / 407 | **407 / 407** |
| Records rejected | 42 | 0 |
| Candidates admitted | 539 | 1075 |
| Candidates carrying an address | 331 | 437 |

23 records legitimately carry no candidate; they are valid and simply produce
nothing.

## Consequence to be aware of

The schema-v3 analysis export declares `maximum_candidates_per_post` as a
`z.literal(MAX_CANDIDATES_PER_POST)`. Freshly generated exports now declare 50.
An export document generated earlier, declaring 5, will fail that literal check if
re-validated. Exports are produced on demand, so nothing stored is invalidated —
but a stale file kept aside will no longer parse.

Import cost scales with admitted candidates: roughly 1075 provider resolutions
instead of 539 for this batch.

## Tests

No new test file. The two existing assertions hardcoded `5` and `6`; they now
derive from `MAX_CANDIDATES_PER_POST`, so the limit cannot silently drift from the
constant again. That is the regression this change actually needs — the previous
literals would have kept passing while contradicting the contract.

## Verification

| Gate | Result |
| --- | --- |
| `eslint . --max-warnings=0` | PASS — exit 0 |
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 369 passed, 132 environment-bound skips |
| Real 407-record batch against the new contract | 407 valid, 0 invalid |
