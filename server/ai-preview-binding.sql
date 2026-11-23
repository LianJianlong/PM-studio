ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS preview_digest text;
ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS preview_auth_stamp text;
ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS preview_at timestamptz;
