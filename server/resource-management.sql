CREATE TABLE IF NOT EXISTS project_resources(
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK(kind IN ('human','equipment','material','expense')),
  name text NOT NULL,
  unit text NOT NULL DEFAULT '',
  rate numeric(20,4) NOT NULL DEFAULT 0 CHECK(rate>=0),
  capacity numeric(20,4) NOT NULL DEFAULT 0 CHECK(capacity>=0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,name)
);
CREATE TABLE IF NOT EXISTS activity_resource_allocations(
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES project_resources(id) ON DELETE CASCADE,
  quantity numeric(20,4) NOT NULL CHECK(quantity>=0),
  planned_cost numeric(20,4) NOT NULL DEFAULT 0 CHECK(planned_cost>=0),
  actual_cost numeric(20,4) NOT NULL DEFAULT 0 CHECK(actual_cost>=0),
  UNIQUE(activity_id,resource_id)
);
CREATE INDEX IF NOT EXISTS activity_resource_activity ON activity_resource_allocations(activity_id);
CREATE INDEX IF NOT EXISTS activity_resource_resource ON activity_resource_allocations(resource_id);
