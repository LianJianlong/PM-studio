-- Extend all native activity tables without changing existing records.
UPDATE data_tables t SET columns=(SELECT jsonb_agg(CASE WHEN f->>'id'='activity_type' THEN jsonb_set(f,'{options}',coalesce(f->'options','[]'::jsonb)||'["LOE持续性作业"]'::jsonb) ELSE f END ORDER BY i) FROM jsonb_array_elements(t.columns) WITH ORDINALITY x(f,i))
WHERE EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.table_id=t.id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='activity_type' AND NOT coalesce(f->'options','[]'::jsonb)?'LOE持续性作业');
UPDATE data_tables t SET columns=t.columns||jsonb_build_array(jsonb_build_object('id','loe_scope','name','LOE关联作业','type','reference','target_table',t.id::text,'display_column','name'))
WHERE EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='loe_scope');
CREATE OR REPLACE FUNCTION mark_loe_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project uuid; dirty jsonb;
BEGIN
 IF current_user<>'studio_app' OR coalesce(current_setting('app.loe_refreshing',true),'')='on' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='activities' THEN project=coalesce(NEW.project_id,OLD.project_id);
 ELSIF TG_TABLE_NAME='records' THEN SELECT project_id INTO project FROM plan_data_tables WHERE table_id=coalesce(NEW.table_id,OLD.table_id);
 ELSIF TG_TABLE_NAME='projects' THEN project=NEW.id;
 ELSE project=coalesce(NEW.project_id,OLD.project_id); END IF;
 IF project IS NOT NULL THEN dirty=coalesce(nullif(current_setting('app.loe_dirty',true),''),'[]')::jsonb;IF NOT dirty?project::text THEN PERFORM set_config('app.loe_dirty',(dirty||jsonb_build_array(project::text))::text,true);END IF;END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS loe_activity_dirty ON activities;
CREATE TRIGGER loe_activity_dirty AFTER INSERT OR UPDATE OR DELETE ON activities FOR EACH ROW EXECUTE FUNCTION mark_loe_dirty();
DROP TRIGGER IF EXISTS loe_record_dirty ON records;
CREATE TRIGGER loe_record_dirty AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION mark_loe_dirty();
DROP TRIGGER IF EXISTS loe_calendar_dirty ON projects;
CREATE TRIGGER loe_calendar_dirty AFTER UPDATE OF calendar_config,start_date ON projects FOR EACH ROW EXECUTE FUNCTION mark_loe_dirty();
DROP TRIGGER IF EXISTS loe_policy_dirty ON project_schedule_options;
CREATE TRIGGER loe_policy_dirty AFTER INSERT OR UPDATE OR DELETE ON project_schedule_options FOR EACH ROW EXECUTE FUNCTION mark_loe_dirty();

CREATE OR REPLACE VIEW analytics.confirmed_activities AS
WITH RECURSIVE graph AS (
 SELECT a.id,a.project_id,a.predecessors,r.id record_id,r.status,r.lifecycle,coalesce(r.data->>'activity_type','任务') activity_type,CASE WHEN jsonb_typeof(r.data->'loe_scope')='array' THEN r.data->'loe_scope' ELSE '[]'::jsonb END scope
 FROM activities a LEFT JOIN plan_activity_records l ON l.activity_id=a.id LEFT JOIN records r ON r.id=l.record_id
), excluded(id) AS (
 SELECT g.id FROM graph g WHERE
 (EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.project_id=g.project_id) AND (g.status IS DISTINCT FROM 'approved' OR g.lifecycle IS DISTINCT FROM 'active'))
 OR (g.activity_type='LOE持续性作业' AND (jsonb_array_length(g.scope)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(g.scope) x WHERE NOT EXISTS(SELECT 1 FROM graph n WHERE n.record_id::text=x.value AND n.project_id=g.project_id AND n.activity_type<>'LOE持续性作业'))))
 UNION
 SELECT g.id FROM graph g JOIN excluded e ON
 (g.activity_type='LOE持续性作业' AND EXISTS(SELECT 1 FROM graph n WHERE n.id=e.id AND g.scope?n.record_id::text))
 OR (g.activity_type<>'LOE持续性作业' AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.predecessors) d WHERE d->>'id'=e.id::text) AND NOT EXISTS(SELECT 1 FROM graph n WHERE n.id=e.id AND n.activity_type='LOE持续性作业'))
)
SELECT g.id activity_id FROM graph g WHERE NOT EXISTS(SELECT 1 FROM excluded e WHERE e.id=g.id);
CREATE OR REPLACE FUNCTION protect_loe_scope_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='studio_app' AND EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.table_id=OLD.id) AND EXISTS(SELECT 1 FROM records r WHERE r.table_id=OLD.id AND r.lifecycle='active' AND r.status<>'obsolete' AND r.data->>'activity_type'='LOE持续性作业') THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.columns) f WHERE f->>'id'='loe_scope' AND f->>'type'='reference' AND f->>'target_table'=OLD.id::text AND coalesce(f->>'lifecycle','active')='active') THEN RAISE EXCEPTION 'LIFECYCLE:请先解除LOE类型，再移除LOE关联作业列'; END IF;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS loe_scope_guard ON data_tables;
CREATE TRIGGER loe_scope_guard BEFORE UPDATE OF columns ON data_tables FOR EACH ROW EXECUTE FUNCTION protect_loe_scope_column();
