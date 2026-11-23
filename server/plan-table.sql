CREATE TABLE IF NOT EXISTS plan_data_tables(project_id uuid PRIMARY KEY REFERENCES projects(id),table_id uuid UNIQUE NOT NULL REFERENCES data_tables(id));
CREATE TABLE IF NOT EXISTS plan_activity_records(activity_id uuid PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,record_id uuid UNIQUE NOT NULL REFERENCES records(id));
CREATE OR REPLACE FUNCTION sync_plan_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; a uuid; explicit_id uuid; c text; n text; d numeric; progress_value numeric;
BEGIN
 IF current_user <> 'studio_app' THEN RETURN NEW; END IF;
 SELECT project_id INTO p FROM plan_data_tables WHERE table_id=NEW.table_id;
 IF p IS NULL THEN RETURN NEW; END IF;
 SELECT activity_id INTO a FROM plan_activity_records WHERE record_id=NEW.id;
 IF NEW.lifecycle='deleted' THEN
  IF a IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM activities x,jsonb_array_elements(x.predecessors) dep WHERE x.project_id=p AND dep->>'id'=a::text) OR EXISTS(SELECT 1 FROM record_activity_links WHERE activity_id=a) THEN RAISE EXCEPTION 'LIFECYCLE:作业仍有依赖或业务记录关联，请先解除'; END IF;
   DELETE FROM activities WHERE id=a;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.supersedes IS NOT NULL AND NEW.status<>'approved' THEN RETURN NEW; END IF;
 IF a IS NULL AND NEW.supersedes IS NOT NULL THEN
  SELECT activity_id INTO a FROM plan_activity_records WHERE record_id=NEW.supersedes;
  IF a IS NOT NULL THEN UPDATE plan_activity_records SET record_id=NEW.id WHERE activity_id=a; END IF;
 END IF;
 c=NEW.data->>'code'; n=NEW.data->>'name'; d=(NEW.data->>'duration')::numeric; progress_value=(NEW.data->>'progress')::numeric;
 IF c IS NULL OR n IS NULL OR d IS NULL OR progress_value IS NULL THEN RAISE EXCEPTION 'Plan core fields are required'; END IF;
 IF a IS NULL THEN
  explicit_id=nullif(current_setting('app.plan_activity_id',true),'')::uuid;
  IF explicit_id IS NOT NULL THEN SELECT id INTO a FROM activities WHERE id=explicit_id AND project_id=p; END IF;
  IF a IS NULL THEN a=gen_random_uuid(); INSERT INTO activities(id,project_id,code,name,duration,progress) VALUES(a,p,c,n,d,progress_value); END IF;
  INSERT INTO plan_activity_records(activity_id,record_id) VALUES(a,NEW.id);
 END IF;
 UPDATE activities SET code=c,name=n,duration=d,progress=progress_value,version=version+1 WHERE id=a AND (code,name,duration,progress) IS DISTINCT FROM (c,n,d,progress_value);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_record_sync ON records;
CREATE TRIGGER plan_record_sync AFTER INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION sync_plan_record();
CREATE OR REPLACE FUNCTION protect_plan_core_columns() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text; f jsonb;
BEGIN
 IF current_user <> 'studio_app' OR NOT EXISTS(SELECT 1 FROM plan_data_tables WHERE table_id=OLD.id) THEN RETURN NEW; END IF;
 IF NEW.project_id<>OLD.project_id THEN RAISE EXCEPTION 'LIFECYCLE:计划作业表不能跨项目移动'; END IF;
 FOREACH key IN ARRAY ARRAY['code','name','duration','progress'] LOOP
  SELECT value INTO f FROM jsonb_array_elements(NEW.columns) WHERE value->>'id'=key;
  IF f IS NULL OR coalesce(f->>'lifecycle','active')<>'active' OR f->>'type'<>(CASE WHEN key IN ('code','name') THEN 'text' ELSE 'number' END) OR NOT coalesce((f->>'required')::boolean,false) THEN RAISE EXCEPTION 'LIFECYCLE:计划核心列不能删除、停用或修改类型'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS plan_core_columns ON data_tables;
CREATE TRIGGER plan_core_columns BEFORE UPDATE ON data_tables FOR EACH ROW EXECUTE FUNCTION protect_plan_core_columns();
