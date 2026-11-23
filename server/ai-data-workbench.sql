CREATE TABLE IF NOT EXISTS ai_data_runs (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('reading','drafting','review','answer','blocked','failed','written','cancelled')),
 summary text NOT NULL DEFAULT '',
 auth_stamp text NOT NULL DEFAULT '',
 change_id uuid REFERENCES ai_changes(id) ON DELETE SET NULL,
 stages jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_data_runs_user_project_recent ON ai_data_runs(user_id,project_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_data_runs_change ON ai_data_runs(change_id) WHERE change_id IS NOT NULL;
