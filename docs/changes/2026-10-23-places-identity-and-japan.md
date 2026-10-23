# Places identity and Japanese destinations

Owner authorization: 23 October 2026, implement the reviewed two-part correction,
publish and deploy it, and recover only the four unresolved mentions from the two
latest-sync posts. This is one Critical maintenance slice; no new service,
dependency, database schema or global reanalysis.

## Accepted design and alternatives

Keep the existing server-side resolver and persistence pipeline. A verified
building address must not be mistaken for a business name. Reconcile a legacy
automatic address-only record only when its existing post evidence establishes
the same business and its manual state is untouched. Conflicting occupants remain
separate; source proof cannot silently overwrite a confirmed identity.

Different catalog identifiers can describe an already saved landmark. Reuse a
unique live-linked precise travel POI without a source street address only through a literal provider name/alias,
compatible structured geography and a 25 m bound; leave the canonical row intact.
Address-only buildings and conflicting, removed or manually changed identities
must not authorize that reuse.

For Japanese destinations, use verified administrative containment and sourced
name variants, then independently check geographic identity. Extend the bounded
complementary research path to supported travel landmarks; do not infer coordinates
from model output or equate different wards, landmarks or building occupants.

Lowering generic acceptance thresholds and forcing four database links would hide
the recurring causes. A new provider or worker is unnecessary. The owner selected
the existing pipeline with these corrections in the preceding conversation.

## Acceptance criteria

- R1: Reuse and label a legacy automatic address record only with compatible
  historical business evidence; preserve its existing links and original proofs.
- R2: Manual renames, confirmations, rejections, deletions, owner isolation and
  conflicting or ambiguous occupant evidence remain authoritative.
- R3: A verified Japanese parent/ward relationship can establish locality
  compatibility; unrelated wards/cities and unsupported names remain distinct.
- R4: Complementary research handles travel destinations with real cited evidence
  and independent geocoding; retain the existing request/time/cost limits.
- R5: Recover only the four unresolved source mentions. Preserve the original
  completed jobs, eleven existing links, classifications, tags and translations.
  Reuse any uniquely proven existing landmark rather than create a duplicate.
- R6: Future automatic sync processing uses the deployed correction without a
  consumer restart or schedule change. Every scoped write has an audit receipt.

## Tasks and files

1. Persistence: `src/server/places/analysis.ts` and
   `tests/unit/places-analysis-postgres.test.ts`. Reproduce the legacy identity
   rejection first; verify compatible reuse and protected/conflicting refusal.
2. Japanese locality/retrieval: `src/lib/places/administrative-context.ts`,
   `src/lib/places/resolution.ts`, `src/server/places/resolvers/geoapify.ts` and
   their existing unit tests, as required by measured provider results. Reproduce
   the concrete name/locality rejection before broadening any rule.
3. Complementary research: `src/server/places/resolvers/complementary.ts`,
   `src/server/places/resolvers/web-search.ts`, resolver types and their existing
   tests, only where necessary to support sourced travel names/addresses.
4. Integration: version the resolution policy, update policy expectations,
   `docs/HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md` and this evidence record.
5. Run lint, types, the complete PostgreSQL-backed application suite and build;
   review the fixed diff. Publish through develop/main with required CI, deploy
   web/API only, then preview/apply/verify a private, scoped recovery.

## Risks and rollout

An address can contain multiple or successive businesses. Compatible history must
be proved, and manual audit history must not be ignored merely because current
flags are false. Geographic containment must be evidenced independently of the
query. English/Japanese names need supported aliases, not transliteration guesses.
The bounded research path keeps approximate fallbacks when proof is insufficient.

Production data is read-only during diagnosis. Recovery requires a fresh protected
snapshot and an exact reviewed manifest, uses a transaction, and stores receipts
privately. Roll back the web release or disable optional research if needed;
never undo manual edits or overwrite later changes while rolling back data.

## Verification record

Focused regression work is complete. Persistence tests reproduce legacy label
rejection, protected histories, alias reuse, neighboring addressed branches and
concurrent deletion before each correction. The final focused PostgreSQL run
passes 86 tests. Japanese and complementary resolver tests cover structured
containment, native aliases, zero-confidence observations, unrelated municipalities,
missing country codes and contradictory citation suffixes.

Independent code review is complete with no remaining actionable findings after
fixing the reproduced containment and deletion cases. A bounded live read-only
provider replay resolves all four scoped mentions precisely in eight requests.
The integrated checks passed: lint, TypeScript, all 1,033 tests in 105 files with
the isolated PostgreSQL database, and the production build. The benign test DOM
canvas notice does not affect the result. Production deployment and recovery
remain separately verified. Private runtime and recovery evidence lives under
`.tmp/places-fix-20261023/`; this document does not assert deployment or recovery.
