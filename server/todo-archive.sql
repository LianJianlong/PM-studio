ALTER TABLE todos ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS todos_active_project ON todos(project_id,archived,done,due_date);
