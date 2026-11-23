DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='system_admin') THEN
  ALTER TABLE users ADD COLUMN system_admin boolean NOT NULL DEFAULT false;
  UPDATE users SET system_admin=true WHERE username='superadmin';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS users_one_system_admin ON users(system_admin) WHERE system_admin;
CREATE OR REPLACE FUNCTION protect_system_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='studio_app' AND (TG_OP='INSERT' AND (NEW.system_admin OR lower(NEW.username)='superadmin') OR TG_OP='UPDATE' AND (NEW.system_admin IS DISTINCT FROM OLD.system_admin OR NEW.username IS DISTINCT FROM OLD.username AND lower(NEW.username)='superadmin')) THEN
  RAISE EXCEPTION '系统身份只能由独立初始化任务设置' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_system_identity ON users;
CREATE TRIGGER protect_system_identity BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_system_identity();
ALTER TABLE ai_changes DROP CONSTRAINT IF EXISTS ai_changes_status_check;
ALTER TABLE ai_changes ADD CONSTRAINT ai_changes_status_check CHECK(status IN ('pending','executing','unknown','done','failed','cancelled'));
CREATE TABLE IF NOT EXISTS ai_operation_receipts(change_id uuid PRIMARY KEY REFERENCES ai_changes(id) ON DELETE CASCADE,user_id uuid NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS execution_version integer NOT NULL DEFAULT 0;
ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS auth_stamp text;
