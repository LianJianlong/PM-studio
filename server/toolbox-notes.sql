CREATE TABLE IF NOT EXISTS toolbox_notes(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),name text NOT NULL,content text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS toolbox_notes_project ON toolbox_notes(project_id);
