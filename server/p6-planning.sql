CREATE TABLE IF NOT EXISTS project_schedule_options(
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 options jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
UPDATE data_tables t SET columns=t.columns||'[{"id": "activity_type", "name": "作业类型", "type": "single_select", "options": ["任务", "开始里程碑", "完成里程碑"]}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='activity_type');
UPDATE data_tables t SET columns=t.columns||'[{"id": "percent_complete_type", "name": "完成率类型", "type": "single_select", "options": ["实物", "工期", "步骤"]}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='percent_complete_type');
UPDATE data_tables t SET columns=t.columns||'[{"id": "remaining_duration", "name": "剩余工期（工作日）", "type": "number"}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='remaining_duration');
UPDATE data_tables t SET columns=t.columns||'[{"id": "actual_start", "name": "实际开始", "type": "date"}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='actual_start');
UPDATE data_tables t SET columns=t.columns||'[{"id": "actual_finish", "name": "实际完成", "type": "date"}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='actual_finish');
UPDATE data_tables t SET columns=t.columns||'[{"id": "constraint_type", "name": "日期约束", "type": "single_select", "options": ["尽早开始", "开始不早于", "开始不晚于", "完成不早于", "完成不晚于", "开始于", "完成于"]}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='constraint_type');
UPDATE data_tables t SET columns=t.columns||'[{"id": "constraint_date", "name": "约束日期", "type": "date"}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='constraint_date');

UPDATE data_tables t SET columns=t.columns||'[{"id":"activity_steps","name":"作业步骤","type":"json"}]'::jsonb WHERE EXISTS(SELECT 1 FROM plan_data_tables b WHERE b.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='activity_steps');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON project_schedule_options TO studio_app; END IF; END $$;
