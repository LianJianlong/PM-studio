ALTER TABLE projects ADD COLUMN IF NOT EXISTS calendar_config jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS calendar_version integer NOT NULL DEFAULT 1;
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS productivity numeric(20,4) NOT NULL DEFAULT 0 CHECK(productivity>=0);
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS configuration text NOT NULL DEFAULT '';
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS planning_tables (
 project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
 kind text CHECK(kind IN ('wbs','organization')),
 table_id uuid UNIQUE REFERENCES data_tables(id),
 PRIMARY KEY(project_id,kind)
);
ALTER TABLE planning_tables DROP CONSTRAINT IF EXISTS planning_tables_kind_check;
ALTER TABLE planning_tables ADD CONSTRAINT planning_tables_kind_check CHECK(kind IN ('wbs','organization','constraints','risk'));
CREATE OR REPLACE FUNCTION validate_planning_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid; bad boolean; ancestor_count integer; descendant_depth integer;
BEGIN
 IF current_user<>'studio_app' OR NEW.lifecycle<>'active' OR NOT EXISTS(SELECT 1 FROM planning_tables WHERE table_id=NEW.table_id AND kind IN ('wbs','organization')) THEN RETURN NEW; END IF;
 IF NEW.data->>'code' IS NULL OR NEW.data->>'name' IS NULL THEN RAISE EXCEPTION 'LIFECYCLE:层级编码和名称不能为空'; END IF;
 IF NEW.status<>'obsolete' AND EXISTS(SELECT 1 FROM records r WHERE r.table_id=NEW.table_id AND r.id<>NEW.id AND r.id<>COALESCE(NEW.supersedes,NEW.id) AND r.supersedes IS DISTINCT FROM NEW.id AND r.lifecycle='active' AND r.status<>'obsolete' AND r.data->>'code'=NEW.data->>'code') THEN RAISE EXCEPTION 'LIFECYCLE:同一层级表的编码不能重复'; END IF;
 IF jsonb_array_length(CASE WHEN jsonb_typeof(NEW.data->'parent')='array' THEN NEW.data->'parent' ELSE '[]'::jsonb END)>1 THEN RAISE EXCEPTION 'LIFECYCLE:层级对象只能有一个上级'; END IF;
 parent_id=(NEW.data->'parent'->>0)::uuid;
 IF parent_id IS NOT NULL THEN
  WITH RECURSIVE ancestors AS (
   SELECT r.id,r.data,ARRAY[r.id] path FROM records r WHERE r.id=parent_id AND r.table_id=NEW.table_id
   UNION ALL SELECT r.id,r.data,a.path||r.id FROM ancestors a JOIN records r ON r.id=(a.data->'parent'->>0)::uuid AND r.table_id=NEW.table_id WHERE NOT r.id=ANY(a.path)
  ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id OR id=NEW.supersedes) INTO bad;
  IF bad THEN RAISE EXCEPTION 'LIFECYCLE:上级关系不能形成循环'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM planning_tables WHERE table_id=NEW.table_id AND kind='wbs') THEN
  WITH RECURSIVE ancestors AS (
   SELECT r.id,r.data,ARRAY[r.id] path FROM records r WHERE r.id=parent_id AND r.table_id=NEW.table_id
   UNION ALL SELECT r.id,r.data,a.path||r.id FROM ancestors a JOIN records r ON r.id=(a.data->'parent'->>0)::uuid AND r.table_id=NEW.table_id WHERE NOT r.id=ANY(a.path)
  ) SELECT count(*)::integer INTO ancestor_count FROM ancestors;
  WITH RECURSIVE descendants AS (
   SELECT r.id,r.data,1 AS depth,ARRAY[r.id] path FROM records r WHERE r.table_id=NEW.table_id AND r.lifecycle='active' AND r.status<>'obsolete' AND (r.data->'parent'->>0)=ANY(ARRAY[NEW.id::text,NEW.supersedes::text]) AND r.id<>NEW.id
   UNION ALL SELECT r.id,r.data,d.depth+1,d.path||r.id FROM descendants d JOIN records r ON (r.data->'parent'->>0)=d.id::text AND r.table_id=NEW.table_id AND r.lifecycle='active' AND r.status<>'obsolete' WHERE NOT r.id=ANY(d.path)
  ) SELECT COALESCE(max(depth),0) INTO descendant_depth FROM descendants;
  IF ancestor_count+1+descendant_depth>50 THEN RAISE EXCEPTION 'LIFECYCLE:WBS最多50层，顶层为第1层'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS planning_hierarchy_guard ON records;
CREATE TRIGGER planning_hierarchy_guard BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION validate_planning_hierarchy();
CREATE OR REPLACE FUNCTION protect_planning_hierarchy_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; f jsonb;
BEGIN
 IF current_user<>'studio_app' OR NOT EXISTS(SELECT 1 FROM planning_tables WHERE table_id=OLD.id AND kind IN ('wbs','organization')) THEN RETURN NEW; END IF;
 IF NEW.project_id<>OLD.project_id THEN RAISE EXCEPTION 'LIFECYCLE:计划层级表不能移出当前项目'; END IF;
 FOREACH key IN ARRAY ARRAY['code','name','parent'] LOOP
  SELECT value INTO f FROM jsonb_array_elements(NEW.columns) WHERE value->>'id'=key;
  IF f IS NULL OR COALESCE(f->>'lifecycle','active')<>'active' OR f->>'type'<>(CASE WHEN key='parent' THEN 'reference' ELSE 'text' END) THEN RAISE EXCEPTION 'LIFECYCLE:层级核心列不能删除、停用或改型'; END IF;
  IF key='parent' AND f->>'target_table'<>NEW.id::text THEN RAISE EXCEPTION 'LIFECYCLE:上级必须引用本层级表'; END IF;
  IF key<>'parent' AND NOT COALESCE((f->>'required')::boolean,false) THEN RAISE EXCEPTION 'LIFECYCLE:层级编码和名称必须必填'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS planning_hierarchy_columns ON data_tables;
CREATE TRIGGER planning_hierarchy_columns BEFORE UPDATE ON data_tables FOR EACH ROW EXECUTE FUNCTION protect_planning_hierarchy_columns();
