CREATE TABLE IF NOT EXISTS network_plans (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL,
 granularity text NOT NULL,
 start_date date NOT NULL,
 activities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(activities)='array'),
 version integer NOT NULL DEFAULT 1,
 lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','deleted')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_plans_project ON network_plans(project_id,lifecycle);
CREATE UNIQUE INDEX IF NOT EXISTS network_plans_name ON network_plans(project_id,name) WHERE lifecycle='active';

ALTER TABLE network_plans ADD COLUMN IF NOT EXISTS swimlanes jsonb NOT NULL DEFAULT '[]'::jsonb;
