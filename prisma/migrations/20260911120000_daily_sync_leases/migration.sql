-- Nullable fields preserve pre-upgrade runs and permit an additive rollback.
ALTER TABLE "sync_jobs"
  ADD COLUMN "automation_day" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "run_expires_at" TIMESTAMPTZ(3);

CREATE INDEX "sync_jobs_owner_automation_day_idx"
  ON "sync_jobs" ("owner_id", "automation_day");
