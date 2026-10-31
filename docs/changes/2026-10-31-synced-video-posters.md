# Preserve stored video posters

## Scope and entry evidence

Patch to the existing media URL resolver. Synced videos store a distinct poster
object, while the library previously replaced its name with the video filename
and a `.jpg` extension. That reconstructed object can return 404 in hover and
detail previews even when the card image itself loads.

The latest sync and the thirty newest cards were inspected separately. All thirty
stored card previews decoded and rendered in desktop and mobile browser checks.
This fix addresses the reproduced video-poster defect; it does not establish the
cause of the two missing card previews reported by the owner.

## Acceptance criteria and tasks

- P1: preserve an explicit, canonical poster URL in the configured public media
  namespace instead of guessing a different filename.
- P2: retain the archive mapping for legacy source paths and fallbacks outside
  that namespace, including image and multi-media paths.
- P3: preserve stored posts, media objects, manual changes, worker state and the
  daily sync schedule. No migration, dependency or worker release is required.

Implementation files: `src/lib/media-url.ts` and the existing
`tests/unit/media-url.test.ts`. Documentation: this record and `docs/HANDOFF.md`. Add a focused regression, verify its failure,
correct the resolver, run the application gates, and independently review the
fixed diff before the existing web deployment procedure.

## Verification

| Requirement | Evidence | Result |
| --- | --- | --- |
| P1 | Regression for separately stored synced video posters | RED reproduced; GREEN 7/7 targeted tests passed |
| P2 | Existing archive mapping tests and namespace boundary cases | Passed; independent review found no blocking issue |
| P3 | Source diff, deployment receipts and runtime comparison | No persistent data changes; release checks recorded privately |
| Application gates | Lint, typecheck, unit tests and production build | Passed: 851 tests; 316 database-dependent tests skipped locally |

Three subprocess-output checks failed under the filesystem sandbox and passed
when the suite ran outside that restriction; no source workaround was applied.
CI runs the database-dependent checks with an ephemeral database. The production
browser recheck is recorded in private receipts after deployment.

Private diagnostic, validation and release receipts live under
`.tmp/sync-preview-20261031/`. No post content or media is included in this change.
Roll back by deploying the previous web commit; no data rollback is necessary.
