CREATE TABLE IF NOT EXISTS drawing_boards(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),name text NOT NULL,xml text NOT NULL,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS drawing_boards_project ON drawing_boards(project_id);
