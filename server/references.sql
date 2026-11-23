CREATE TABLE IF NOT EXISTS record_references(
  source_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_id text NOT NULL,
  target_id uuid NOT NULL REFERENCES records(id),
  PRIMARY KEY(source_id,field_id,target_id)
);
CREATE INDEX IF NOT EXISTS references_target ON record_references(target_id,field_id,source_id);
CREATE OR REPLACE FUNCTION synchronize_record_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f jsonb; target uuid; linked records; target_table data_tables; inherited boolean;
BEGIN
  IF TG_OP='UPDATE' AND NEW.data IS NOT DISTINCT FROM OLD.data AND NEW.lifecycle=OLD.lifecycle THEN RETURN NEW; END IF;
  FOR f IN SELECT value FROM data_tables t,jsonb_array_elements(t.columns) WHERE t.id=NEW.table_id AND value->>'type'='reference' LOOP
    IF NEW.data->(f->>'id') IS NULL OR NEW.data->(f->>'id')='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(NEW.data->(f->>'id'))<>'array' OR jsonb_array_length(NEW.data->(f->>'id'))>100 THEN RAISE EXCEPTION 'REFERENCE:引用内容无效' USING ERRCODE='P0001'; END IF;
    FOR target IN SELECT value::uuid FROM jsonb_array_elements_text(NEW.data->(f->>'id')) LOOP
      SELECT * INTO linked FROM records WHERE id=target FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'REFERENCE:关联记录不存在' USING ERRCODE='P0001'; END IF;
      SELECT * INTO target_table FROM data_tables WHERE id=linked.table_id;
      IF linked.table_id<>(f->>'target_table')::uuid OR target_table.project_id<>(SELECT project_id FROM data_tables WHERE id=NEW.table_id) THEN RAISE EXCEPTION 'REFERENCE:关联记录不属于配置的表或项目' USING ERRCODE='P0001'; END IF;
      inherited=false;
      IF TG_OP='UPDATE' THEN inherited=coalesce(OLD.data->(f->>'id') ? target::text,false); END IF;
      IF NEW.supersedes IS NOT NULL THEN inherited=inherited OR coalesce((SELECT data->(f->>'id') ? target::text FROM records WHERE id=NEW.supersedes),false); END IF;
      IF NOT inherited AND (linked.lifecycle<>'active' OR target_table.lifecycle<>'active') THEN RAISE EXCEPTION 'REFERENCE:不能新增指向非活动记录或数据表的关联' USING ERRCODE='P0001'; END IF;
    END LOOP;
  END LOOP;
  DELETE FROM record_references WHERE source_id=NEW.id;
  INSERT INTO record_references(source_id,field_id,target_id)
    SELECT NEW.id,definition.value->>'id',v.value::uuid FROM data_tables t,jsonb_array_elements(t.columns) definition,
    LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(NEW.data->(definition.value->>'id'))='array' THEN NEW.data->(definition.value->>'id') ELSE '[]'::jsonb END) v
    WHERE t.id=NEW.table_id AND definition.value->>'type'='reference';
  FOR f IN SELECT value FROM data_tables t,jsonb_array_elements(t.columns) WHERE t.id=NEW.table_id AND value->>'type'='reference' AND value->>'bidirectional'='true' LOOP
    IF EXISTS(SELECT 1 FROM record_references rr JOIN records r ON r.id=rr.source_id WHERE rr.field_id=f->>'id' AND r.table_id=NEW.table_id AND r.lifecycle<>'deleted' AND rr.target_id IN(SELECT target_id FROM record_references WHERE source_id=NEW.id AND field_id=f->>'id') GROUP BY rr.target_id HAVING count(*)>100) THEN RAISE EXCEPTION 'REFERENCE:单个反向单元格最多关联100条记录' USING ERRCODE='P0001'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_reference_sync ON records;
CREATE TRIGGER record_reference_sync AFTER INSERT OR UPDATE OF data,lifecycle ON records FOR EACH ROW EXECUTE FUNCTION synchronize_record_references();
