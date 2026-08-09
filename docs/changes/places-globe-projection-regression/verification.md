# Globe Places et isolation des E2E authentifiés — vérification

**Mode:** standard
**Status:** locally verified; Claude Opus review quota-blocked
**Branch:** `fix/places-globe-projection-regression`

## RED observé

- `env -u NODE_ENV npm run test -- --run tests/unit/playwright-e2e-config.test.ts` : échec attendu, car la configuration dédiée n'existait pas.
- `npm run places:test-e2e` : échec attendu, 1/15 ; un style local sans `projection` produisait `undefined` au lieu de `globe`.

## GREEN local

| Check | Result |
|---|---|
| `env -u NODE_ENV npm run test -- --run tests/unit/playwright-e2e-config.test.ts` | 3 passed |
| `env -u NODE_ENV npm run places:test-e2e` | 15 passed |
| `env -u NODE_ENV npm run test:e2e` | not green in fresh parallel runs; failures occurred in existing Library/mobile scenarios outside this diff (see limitations) |
| `env -u NODE_ENV npm run test:e2e -- --list` | 28 generic tests; no auth/import spec |
| `E2E_BASE_URL=http://127.0.0.1:4300 npm run test:e2e:auth-import -- --list` | 5 auth/import tests listed; no server started |
| dedicated config without `E2E_BASE_URL` | fails before test execution |
| `node --check scripts/places/visual-globe-harness.mjs` | passed |
| `npm run lint` | passed |
| `npm run typecheck` | passed |
| `env -u NODE_ENV npm run test` | 369 passed, 132 environment-bound DB skips |
| `env -u NODE_ENV npm run build` | passed |
| `git diff --check` | passed |

## Not executed

- Real-auth and PostgreSQL-import browser scenarios were not run: no disposable target or real credentials were supplied. Their configuration boundary is covered by unit tests and `--list` checks only.
- No application deployment, migration file, commit, push, or D6/FPS measurement.
  The Places harness invokes `prisma migrate deploy` only against its disposable
  local PostgreSQL container to apply existing migrations before seeding; that
  container is removed afterward.

## Limitations

- The generic parallel E2E suite did not produce a fresh green run: one attempt
  failed in the existing back-to-top Library scenario, and a second showed mixed
  existing Library/mobile API and filtering failures. The isolated rerun of the
  back-to-top scenario passed. These paths are outside this change; the generic
  configuration boundary itself is covered by unit tests and `--list` output.

## Review limitation

- A fresh read-only Claude Code session was launched with `--model opus` and the
  complete diff, requirements and evidence, but its weekly quota blocked analysis
  before any review output. Local verification remains valid; this change is not
  marked as Opus-approved.
