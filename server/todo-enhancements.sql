ALTER TABLE todos ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent'));
ALTER TABLE todos ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly','monthly'));
ALTER TABLE todos ADD COLUMN IF NOT EXISTS parent_todo_id uuid REFERENCES todos(id) ON DELETE SET NULL;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS recurrence_until date;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS todos_due_priority ON todos(project_id,done,due_date,priority);
