CREATE TABLE IF NOT EXISTS visual_reports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('activity_progress','resource_cost')),
  dimension text NOT NULL,
  metric text NOT NULL,
  chart_type text NOT NULL CHECK (chart_type IN ('bar','line','pie','table')),
  superset_dashboard_id integer NOT NULL,
  superset_embed_uuid uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visual_reports_project ON visual_reports(project_id, created_at DESC);
