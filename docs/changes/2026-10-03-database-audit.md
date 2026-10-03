# Database mutation journal

**Route:** Critical. **Authorization:** user approved implementation, migration,
merge and deployment; clarified that only modifications must be recorded.

## Contract and architecture

Record committed INSERT, UPDATE, DELETE and TRUNCATE effects on every existing
application table in the same PostgreSQL database. Store timestamp, table, row
identity, owner, operation, database login, application name, transaction ID,
optional business action, and complete JSON values before/after. Do not log reads
or raw SQL/connection strings. No retroactive events are fabricated. Database
schema changes remain tracked by Prisma migrations; this journal covers data.

Use an additive `audit_events` table without cascading foreign keys. Database
triggers cover web, worker and direct SQL. BEFORE DELETE captures parents before
cascades; AFTER INSERT/UPDATE captures stored rows and suppresses no-op updates.
BEFORE TRUNCATE captures removed rows. Join ownership resolves from the live post
or its before-snapshot in the current transaction. The parent AFTER trigger is
ordered before FK cascade triggers, preserving old IDs on cascading renames.
Owner transfers produce two partial events, keeping each owner’s values private. Unresolvable ownership fails
closed. Functions use only pg_catalog and pg_temp in search_path and SECURITY DEFINER so restricted
worker roles do not need access to the journal. Normal UPDATE/DELETE/TRUNCATE of
the journal are rejected. Database owners/superusers can still disable triggers;
this is an operational history, not a tamper-proof security boundary.

The admin-only endpoint filters by authenticated owner, operation and table,
uses bounded keyset pagination, and never caches responses. Gérer exposes a
read-only journal with before/after details. No automatic retention/purge is
introduced. Deleted content is intentionally retained in this private journal.

## Exact slice and proof

Source: `prisma/schema.prisma`,
`prisma/migrations/20261003170000_database_audit/migration.sql`,
`src/server/audit-log.ts`, `src/server/admin-library.ts`,
`src/features/library/audit-types.ts`,
`src/app/api/admin/audit/route.ts`,
`src/features/library/components/admin/audit-log-dialog.tsx`,
`src/features/library/components/library-explorer.tsx`.

Tests: `tests/unit/audit-log-postgres.test.ts` proves real SQL/Prisma capture,
rollback, cascade ownership, restrictions, truncation and pagination;
`tests/unit/audit-log-api.test.ts` proves authentication and input handling;
`tests/e2e/auth-and-import.spec.ts` exercises the admin journal after deletion.
Update this file, permanent-deletion release notes, HANDOFF and implementation
status. No dependency, provider, worker or new database is introduced.

## Rollout and rollback

Rehearse additive migrations on disposable PostgreSQL before preview/production.
Deploy tables/triggers before application code and verify normal writes and
owner-scoped reads. Both existing Coolify tokens currently redact DB credentials;
permission read:sensitive has been requested, not another release approval.
Preserve the audit table during rollback. Old application code remains compatible
with the audit triggers. To disable capture during an incident, explicitly remove
only the audit triggers; retain all recorded events. Monitor table size and write
latency because snapshots increase storage. Future application tables need the
same trigger installation in their migration.


## Verification evidence — 3 October 2026

| Requirement/risk | Proof | Result |
| --- | --- | --- |
| Every business table participates | PostgreSQL catalog check against all public business tables | PASS; 13 tables |
| Actual changes only | Real SQL/Prisma create/update/delete, read, failed transaction | PASS; correct before/after and no read/rollback events |
| Cascade and admin intent | Real import/delete with tags, media, collection links | PASS; one transaction, manual action preserved |
| Worker least privilege | Restricted SQL role can mutate its granted table but cannot read journal | PASS |
| Privileged function safety | Malicious public.to_jsonb overload in isolated rollback fixture | Reproduced failure, then PASS with trusted search_path |
| Owner transfers and parent rename | Direct link transfer followed by parent ID/owner update and FK cascade | Reproduced disclosure, then PASS; two private snapshots |
| Journal integrity and truncation | UPDATE/DELETE/TRUNCATE rejection; business TRUNCATE and rollback | PASS |
| Private API and pagination | Session owner, no-store, validation, bounded keyset paging | PASS |
| Application suite | TEST_DATABASE_URL=local npm test | PASS; 557 tests / 69 files, no DB skips |
| Worker compatibility | Worker typecheck and tests with audit triggers active | PASS; 77 tests / 10 files |
| Static/build gates | lint, typecheck, production build, git diff --check | PASS |
| Browser journey | Real login/import/delete/suppressed reimport, Gérer > journal, filters and before-values | PASS; 2 targeted Playwright tests |
| Migration rehearsal | Fresh disposable PostgreSQL 16, all 13 migrations in order | PASS |
| Source review | Independent review, including follow-up of all three findings | APPROVED |

The first journal browser run revealed ambiguous implicit select labels; explicit
labels fixed the issue and the final run passed. The initial broader auth-suite
logout issue predates this addition and remains out of scope (see deletion notes).
No new tests mirror presentation details: the PostgreSQL file protects persistence,
privileges and ownership; the API file protects authenticated access to deleted
content; the existing browser scenario proves the complete admin journey.

Evidence logs are copied to ignored `.tmp/permanent-post-deletions/`. The new
journal cannot reconstruct earlier deletions absent a trustworthy historical
record. Production data has not been changed; release is pending technical DB
access and migration, not another user authorization.


Publication note: the grouped GitHub create-tree call exceeded automatic approval
review's 200,000-byte input limit. The user subsequently explicitly authorized
publishing code/tests/migrations and documentation as two separately reviewed
commits. No further publication approval is required; current database access
and migration remain the release gate.
