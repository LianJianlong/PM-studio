CREATE TABLE IF NOT EXISTS project_public_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL,
 definition jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS public_view_name ON project_public_views(project_id,name) WHERE deleted_at IS NULL;
