# Globe Places et isolation des E2E authentifiés Traceability

| Requirement | Acceptance criterion | Ticket | Test or check | Evidence | Status |
|---|---|---|---|---|---|
| `REQ-001` | `AC-001` | `TASK-01` | `npm run places:test-e2e` | Verification § GREEN local | Pass, Opus review blocked |
| `REQ-002` | `AC-001` | `TASK-01` | raw `/style.json` assertion + map capture | Verification § GREEN local | Pass, Opus review blocked |
| `REQ-003` | `AC-002`, `AC-003` | `TASK-01` | `tests/unit/playwright-e2e-config.test.ts` | Verification § GREEN local | Pass, Opus review blocked |
| `NFR-001` | `AC-002` | `TASK-01` | configuration unit test | Verification § GREEN local | Pass, Opus review blocked |
| `NFR-002` | n/a | `TASK-01` | diff review + Gitleaks changed-content scan | Verification § Safety | Pass, Opus review blocked |
