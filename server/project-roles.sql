CREATE TABLE IF NOT EXISTS project_roles (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '',
 grant_config jsonb NOT NULL,
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 UNIQUE(project_id,name)
);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS project_role_id uuid REFERENCES project_roles(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS memberships_project_role_idx ON memberships(project_role_id);
