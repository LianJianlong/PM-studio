CREATE TABLE IF NOT EXISTS app_startup_defaults(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
 project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
 version integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_startup_defaults(singleton) VALUES(true) ON CONFLICT DO NOTHING;
