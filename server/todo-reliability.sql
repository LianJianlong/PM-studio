ALTER TABLE todos ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE todos ADD COLUMN IF NOT EXISTS recurrence_day smallint CHECK(recurrence_day BETWEEN 1 AND 31);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS generated_from_id uuid REFERENCES todos(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS todos_one_generated ON todos(generated_from_id) WHERE generated_from_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS todos_parent ON todos(parent_todo_id) WHERE parent_todo_id IS NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe ON notifications(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL;
