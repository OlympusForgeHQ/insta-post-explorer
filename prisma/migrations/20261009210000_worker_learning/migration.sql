-- Additive memory for verified corrections and content-free attempt diagnostics.
CREATE UNIQUE INDEX classification_jobs_owner_id_id_key ON post_classification_jobs(owner_id,id);
CREATE TABLE worker_learning_examples (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, post_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, removed_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 domain TEXT NOT NULL CHECK (domain IN ('classification','translation')),
 kind TEXT NOT NULL CHECK ((domain='classification' AND kind IN ('tags','classification')) OR (domain='translation' AND kind='translation')),
 provenance TEXT NOT NULL CHECK (provenance IN ('MANUAL_TAG_EDIT','MANUAL_REVIEW')),
 source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'), payload JSONB NOT NULL,
 reviewed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT worker_learning_examples_owner_post_fkey FOREIGN KEY (owner_id,post_id) REFERENCES posts(owner_id,id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX worker_learning_examples_identity_key ON worker_learning_examples(owner_id,post_id,domain,kind);
CREATE INDEX worker_learning_examples_lookup_idx ON worker_learning_examples(owner_id,domain,reviewed_at DESC);
CREATE TABLE worker_learning_observations (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
 lease_hash TEXT NOT NULL CHECK (lease_hash ~ '^[a-f0-9]{64}$'),
 domain TEXT NOT NULL CHECK (domain IN ('classification','translation')), shape TEXT NOT NULL,
 strategy TEXT NOT NULL CHECK (strategy IN ('standard','format_guidance','preserve_source')),
 outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','NEEDS_REVIEW','FAILED','RETRY')),
 error_family TEXT, signals TEXT[] NOT NULL, example_ids TEXT[] NOT NULL,
 elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms BETWEEN 0 AND 5400000),
 input_tokens INTEGER NOT NULL CHECK (input_tokens BETWEEN 0 AND 2000000),
 output_tokens INTEGER NOT NULL CHECK (output_tokens BETWEEN 0 AND 200000),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT worker_learning_observations_owner_job_fkey FOREIGN KEY (owner_id,job_id) REFERENCES post_classification_jobs(owner_id,id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX worker_learning_observations_attempt_key ON worker_learning_observations(job_id,lease_hash);
CREATE INDEX worker_learning_observations_lookup_idx ON worker_learning_observations(owner_id,domain,created_at DESC);
CREATE TRIGGER "00_audit_row_write" AFTER INSERT OR UPDATE ON worker_learning_examples FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');
CREATE TRIGGER audit_row_delete BEFORE DELETE ON worker_learning_examples FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');
CREATE TRIGGER "00_audit_row_write" AFTER INSERT OR UPDATE ON worker_learning_observations FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');
CREATE TRIGGER audit_row_delete BEFORE DELETE ON worker_learning_observations FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row('id');

CREATE TRIGGER audit_table_truncate BEFORE TRUNCATE ON worker_learning_examples FOR EACH STATEMENT EXECUTE FUNCTION public.capture_audit_truncate('id');
CREATE TRIGGER audit_table_truncate BEFORE TRUNCATE ON worker_learning_observations FOR EACH STATEMENT EXECUTE FUNCTION public.capture_audit_truncate('id');
