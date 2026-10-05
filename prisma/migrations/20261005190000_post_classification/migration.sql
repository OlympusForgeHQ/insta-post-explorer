CREATE TABLE "post_classification_jobs" (
 "id" TEXT NOT NULL,
 "owner_id" TEXT NOT NULL,
 "post_id" TEXT,
 "source_post_id" TEXT NOT NULL,
 "analysis_version" TEXT NOT NULL,
 "input_hash" TEXT NOT NULL,
 "status" "PlaceAnalysisStatus" NOT NULL DEFAULT 'PENDING',
 "attempt_count" INTEGER NOT NULL DEFAULT 0,
 "lease_owner" TEXT,
 "lease_expires_at" TIMESTAMPTZ(3),
 "heartbeat_at" TIMESTAMPTZ(3),
 "next_attempt_at" TIMESTAMPTZ(3),
 "error_code" TEXT,
 "result" JSONB,
 "started_at" TIMESTAMPTZ(3),
 "completed_at" TIMESTAMPTZ(3),
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updated_at" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "post_classification_jobs_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "classification_jobs_attempts_check" CHECK ("attempt_count" BETWEEN 0 AND 3),
 CONSTRAINT "classification_jobs_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "classification_jobs_owner_post_fkey" FOREIGN KEY ("owner_id","post_id") REFERENCES "posts"("owner_id","id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "classification_jobs_idempotency_key" ON "post_classification_jobs"("owner_id","source_post_id","analysis_version");
CREATE INDEX "classification_jobs_claim_idx" ON "post_classification_jobs"("owner_id","status","next_attempt_at","lease_expires_at","created_at");
-- Retain the job receipt and immediately fence all writes when its post is deleted.
CREATE FUNCTION public.cancel_deleted_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.status := 'CANCELLED'; NEW.error_code := 'POST_DELETED';
 NEW.lease_owner := NULL; NEW.lease_expires_at := NULL;
 NEW.heartbeat_at := NULL; NEW.next_attempt_at := NULL;
 NEW.completed_at := CURRENT_TIMESTAMP; NEW.updated_at := CURRENT_TIMESTAMP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER classification_post_deleted BEFORE UPDATE OF post_id ON post_classification_jobs
 FOR EACH ROW WHEN (OLD.post_id IS NOT NULL AND NEW.post_id IS NULL)
 EXECUTE FUNCTION public.cancel_deleted_classification();
CREATE TRIGGER "00_audit_row_write" AFTER INSERT OR UPDATE ON post_classification_jobs
 FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');
CREATE TRIGGER audit_row_delete BEFORE DELETE ON post_classification_jobs
 FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');
CREATE TRIGGER audit_table_truncate BEFORE TRUNCATE ON post_classification_jobs
 FOR EACH STATEMENT EXECUTE FUNCTION public.capture_audit_truncate('id');
