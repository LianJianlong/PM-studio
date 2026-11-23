CREATE TABLE IF NOT EXISTS report_documents (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  layout jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE report_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS report_documents_project ON report_documents(project_id, updated_at DESC);
INSERT INTO report_documents(id,project_id,name,layout,created_by,created_at,updated_at)
SELECT id,project_id,name,jsonb_build_object('sections',jsonb_build_object(
  'header',jsonb_build_array(jsonb_build_object('id',id::text||'-title','type','title','text',name)),
  'detail',jsonb_build_array(jsonb_build_object('id',id::text||'-chart','type',CASE WHEN chart_type='table' THEN 'table' ELSE 'chart' END,'source',source,'dimension',dimension,'metric',metric,'chartType',CASE WHEN chart_type='table' THEN 'bar' ELSE chart_type END,'title',name)),
  'summary','[]'::jsonb,'footer',jsonb_build_array(jsonb_build_object('id',id::text||'-footer','type','text','text','Project Studio · 项目数据报告')))),created_by,created_at,created_at
FROM visual_reports ON CONFLICT(id) DO NOTHING;
