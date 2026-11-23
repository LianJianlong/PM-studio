ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS table_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(table_ids)='array');
CREATE INDEX IF NOT EXISTS workflows_table_scope ON workflow_definitions USING gin(table_ids) WHERE active;
CREATE TABLE IF NOT EXISTS project_business_templates(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('table','view','report','workflow')),
 template_key text NOT NULL,
 object_id uuid NOT NULL,
 applied_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,kind,template_key)
);
