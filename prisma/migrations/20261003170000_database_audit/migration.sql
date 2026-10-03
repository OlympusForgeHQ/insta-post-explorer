BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE public.audit_events (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  record_key JSONB NOT NULL,
  before_data JSONB,
  after_data JSONB,
  database_user TEXT NOT NULL DEFAULT session_user,
  application_name TEXT NOT NULL DEFAULT current_setting('application_name'),
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  action TEXT
);
CREATE INDEX audit_events_owner_id_idx ON public.audit_events(owner_id, id DESC);
CREATE INDEX audit_events_parent_before_idx
  ON public.audit_events(transaction_id, (before_data->>'id'), id DESC)
  WHERE table_name = 'posts' AND before_data IS NOT NULL;
REVOKE ALL ON public.audit_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.audit_events_id_seq FROM PUBLIC;

-- Resolve old and new ownership separately, including cascades after a parent
-- is deleted or renamed. The parent trigger runs before FK cascade triggers.
CREATE FUNCTION public.audit_row_owner(source_table TEXT, row_data JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE row_owner TEXT := row_data->>'owner_id';
BEGIN
  IF row_data IS NULL THEN RETURN NULL; END IF;
  IF row_owner IS NULL AND source_table IN ('post_tags', 'collection_posts') THEN
    SELECT owner_id INTO row_owner FROM public.posts WHERE id = row_data->>'post_id';
    IF row_owner IS NULL THEN
      SELECT before_data->>'owner_id' INTO row_owner FROM public.audit_events
        WHERE transaction_id = txid_current() AND table_name = 'posts'
          AND before_data IS NOT NULL AND before_data->>'id' = row_data->>'post_id'
        ORDER BY id DESC LIMIT 1;
    END IF;
  END IF;
  IF row_owner IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve audit owner for %', source_table;
  END IF;
  RETURN row_owner;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_row_owner(TEXT, JSONB) FROM PUBLIC;

-- The owner of this function must own the journal. Worker roles need no grants
-- on the journal itself. Only trigger functions call this internal writer.
CREATE FUNCTION public.write_audit_event(
  source_table TEXT, operation TEXT, row_before JSONB, row_after JSONB, key_columns TEXT[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  row_data JSONB := COALESCE(row_after, row_before);
  old_owner TEXT := public.audit_row_owner(source_table, row_before);
  new_owner TEXT := public.audit_row_owner(source_table, row_after);
  row_key JSONB;
BEGIN
  IF row_before IS NOT NULL AND row_after IS NOT NULL AND old_owner IS DISTINCT FROM new_owner THEN
    -- Never disclose one owner's old values to the recipient of a transfer.
    PERFORM public.write_audit_event(source_table, operation, row_before, NULL, key_columns);
    PERFORM public.write_audit_event(source_table, operation, NULL, row_after, key_columns);
    RETURN;
  END IF;
  SELECT jsonb_object_agg(key, row_data->key) INTO row_key FROM unnest(key_columns) AS key;
  INSERT INTO public.audit_events(owner_id, table_name, operation, record_key, before_data, after_data, action)
    VALUES (COALESCE(new_owner, old_owner), source_table, operation, row_key, row_before, row_after,
      nullif(current_setting('ipe.audit_action', true), ''));
END;
$$;
REVOKE ALL ON FUNCTION public.write_audit_event(TEXT, TEXT, JSONB, JSONB, TEXT[]) FROM PUBLIC;

CREATE FUNCTION public.capture_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_event(TG_TABLE_NAME, TG_OP, NULL, to_jsonb(NEW), TG_ARGV);
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
      PERFORM public.write_audit_event(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW), TG_ARGV);
    END IF;
  ELSE
    PERFORM public.write_audit_event(TG_TABLE_NAME, TG_OP, to_jsonb(OLD), NULL, TG_ARGV);
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_audit_row() FROM PUBLIC;

CREATE FUNCTION public.capture_audit_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE row_data JSONB;
BEGIN
  -- All BEFORE TRUNCATE triggers run before any table is emptied, including
  -- cascades. This preserves both removed values and join ownership.
  FOR row_data IN EXECUTE format('SELECT to_jsonb(row) FROM %I.%I AS row', TG_TABLE_SCHEMA, TG_TABLE_NAME) LOOP
    PERFORM public.write_audit_event(TG_TABLE_NAME, TG_OP, row_data, NULL, TG_ARGV);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_audit_truncate() FROM PUBLIC;

CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_audit_mutation() FROM PUBLIC;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();

DO $$
DECLARE source_table TEXT; key_arguments TEXT;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'posts', 'deleted_posts', 'collections', 'collection_posts', 'post_media',
    'tags', 'post_tags', 'import_jobs', 'sync_jobs', 'places', 'post_places',
    'place_evidence', 'place_analysis_jobs'
  ] LOOP
    key_arguments := CASE source_table
      WHEN 'post_tags' THEN '''post_id'', ''tag_id'''
      WHEN 'collection_posts' THEN '''collection_id'', ''post_id'''
      WHEN 'deleted_posts' THEN '''owner_id'', ''post_url'''
      ELSE '''id''' END;
    -- PostgreSQL fires same-kind triggers alphabetically; capture parent UPDATE
    -- before RI_ConstraintTrigger cascades so old join ownership remains known.
    EXECUTE format('CREATE TRIGGER "00_audit_row_write" AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row(%s)', source_table, key_arguments);
    EXECUTE format('CREATE TRIGGER audit_row_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_audit_row(%s)', source_table, key_arguments);
    EXECUTE format('CREATE TRIGGER audit_table_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.capture_audit_truncate(%s)', source_table, key_arguments);
  END LOOP;
END;
$$;
COMMIT;
