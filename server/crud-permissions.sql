ALTER TABLE memberships ADD COLUMN IF NOT EXISTS crud_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
