# Permanent deletions and database journal: release procedure

The user authorized migration, merge and production deployment. PR #81 merged
at `0f81e604927c697a18bab9cadc18731162a2c4e8`; its quality and browser CI passed
(run `37138387603`). The reviewed source is `e1eb59ea92d0b238fac95bf08e5a170100fc67b5`.
Record the final deployment commit and live checks in the production release PR.

## Existing database history: preserve, do not replay

Live preview and production both had eight completed migrations. These three
legacy entries are absent:

- `20260712010000_fix_cuisine_theme`
- `20260713010000_add_sync_jobs`
- `20260714090000_add_collections`

The Sync/Collections objects are present. The historical effect of the Cuisine
data-only UPDATE is unknown and is not replayed.

The initial and worker-queue migrations also have historical checksums differing
from the current files. The old records are retained exactly. No historical
execution time or checksum is rewritten. A read-only preview schema comparison found
only intentional SQL features outside the Prisma model: the collections updated
at default, posts search index and seven composite owner foreign keys, all
represented in existing migration SQL.

Do not run `prisma migrate deploy` with the entire repository migration directory
on these databases until a separate reconciliation is reviewed. Replaying the
legacy collection migration could recreate removed favorites or overwrite their
settings. `migrate diff` output must not be executed to remove intentional SQL
features. A missing history entry alone does not authorize replaying a data fix.

## Targeted additive upgrade

Use the current Coolify web application's runtime connection, not the obsolete
Neon URLs. Native scheduled tasks are disabled and manually executed once; remove
the temporary task definitions when verification finishes. Commands and receipts
are saved locally under ignored `.tmp/permanent-post-deletions/release/`; no
connection string, token, password or session cookie is published.

1. Complete a fresh native database backup. Verified backups on 3 October 2026:
   preview `yxmkoi11cuy4jkrwxxteiopm` and production `7rfb4x0hbhbkdnwint7tsohz`.
2. Verify runtime database host/name, the exact existing history, 13 public tables,
   absence of prior custom triggers, and migration permissions in a read-only
   transaction. Snapshot every historical migration record for later comparison.
3. Clone the reviewed commit into a temporary directory separate from the served
   application. Assert its SHA. Create a separate Prisma directory with the
   approved schema, `migration_lock.toml`, and only the two new migration folders.
4. Use the installed Prisma 6.19.3 CLI to run `migrate deploy` on that directory.
   This preserves all eight old entries and adds exactly two successful entries:

| Migration | SQL SHA-256 |
| --- | --- |
| `20261003150000_permanent_post_deletions` | `ef252307a06ec7dadbc242e4a7026b1c61b1eacb88f618034d76f81226d5a3cd` |
| `20261003170000_database_audit` | `e0820b680793bbfe135cb02c00ae66fbc226789fae6d1f36dcced1a0dab59908` |

5. Verify the two checksums and finished states, every old record unchanged,
   15 public tables, all 40 expected triggers enabled, and journal SELECT with
   the application role. The full-repository migration status is not a clean
   history proof for this deliberately scoped upgrade.
6. Deploy preview application and worker; verify authenticated import, deletion,
   suppressed reimport and before-values in the admin journal against the new
   application. Only then migrate production and merge the release to main.
7. Confirm web/worker deployment SHAs, healthy runtime, public search consistency
   for `pomme de terre`, and journal access control. Preserve backups and receipts.

A disposable PostgreSQL 16 rehearsal simulated the observed missing entries and
checksum differences. Both migrations applied; all old records were unchanged
byte-for-byte; 40 triggers were installed; a second targeted deployment was a
no-op. The separate fresh-database rehearsal of all 13 migrations also passed.

The audit migration uses a 10-second DDL lock timeout. On failure, stop and inspect
the actual history/schema before retrying: the deletion migration may already be
applied. Never reset the shared database. Retain journal and deletion identities
on rollback; suspend imports if the old application is restored.

## Historical deletions

The inspected backup and both live pre-migration schemas had no deletion/audit
table or custom trigger. No reliable list of earlier manual deletions was found.
No real post was deleted based on a count or inferred absence. The journal records
committed modifications from installation onward, including future deletions;
reads and past events are not fabricated.

## Preview activation evidence

Preview web and worker deployed `0f81e60` successfully and report healthy. Two
authenticated Chromium checks passed against that deployed application, including
import, deletion, suppressed reimport (`imported=0`, `updated=0`, `skipped=1`),
zero matching posts afterward, and the deletion before-values in the journal.
The public `pomme de terre` query returned and displayed the same 12 post IDs.

## Shared database verification

Both targeted upgrades completed successfully before application activation:

| Environment | Migration execution | Post-migration verification |
| --- | --- | --- |
| Preview | `l7w4ewp9u7nf947uq3xqu3su` | `7rohix4nxofmnyqtidtw9hnc` |
| Production | `wcmceraxlgid6g94pte03heu` | `0ogdivgwcjbh0ji7ojumetbp` |

Each verification confirmed 15 public tables, the 40 expected enabled triggers,
read access to the journal with the application role, exact checksums for the two
new migrations, and the eight old migration records unchanged. No old data
migration or historical post deletion was replayed. Production application
activation and its final live checks are recorded separately in the release PR.
