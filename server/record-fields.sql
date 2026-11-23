ALTER TABLE records ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);

CREATE OR REPLACE FUNCTION maintain_record_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
  IF current_user <> 'studio_app' THEN RETURN NEW; END IF;
  actor=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF actor IS NULL THEN RAISE EXCEPTION 'Record mutation requires an authenticated actor'; END IF;
  IF TG_OP='INSERT' THEN
    NEW.created_by=actor;
    NEW.created_at=clock_timestamp();
  ELSE
    NEW.created_by=OLD.created_by;
    NEW.created_at=OLD.created_at;
  END IF;
  NEW.updated_by=actor;
  NEW.updated_at=clock_timestamp();
  RETURN NEW;
END $$;
-- Runs after object_lifecycle_guard, whose frozen-object comparisons see only the requested changes.
DROP TRIGGER IF EXISTS record_provenance ON records;
CREATE TRIGGER record_provenance BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION maintain_record_provenance();

CREATE OR REPLACE FUNCTION record_field_values(r records, cols jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT r.data || coalesce(jsonb_object_agg(f->>'id',
    CASE f->>'type'
      WHEN 'created_time' THEN to_jsonb(to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      WHEN 'modified_time' THEN to_jsonb(to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      WHEN 'created_user' THEN to_jsonb(r.created_by)
      WHEN 'modified_user' THEN to_jsonb(r.updated_by)
    END),'{}'::jsonb)
  FROM jsonb_array_elements(cols) f
  WHERE f->>'type' IN ('created_time','modified_time','created_user','modified_user')
    AND coalesce(f->>'lifecycle','active')<>'deleted';
$$;
