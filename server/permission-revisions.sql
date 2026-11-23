ALTER TABLE memberships ADD COLUMN IF NOT EXISTS revision uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS revision uuid NOT NULL DEFAULT gen_random_uuid();
CREATE OR REPLACE FUNCTION refresh_permission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision = gen_random_uuid();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS permission_revision ON memberships;
CREATE TRIGGER permission_revision BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION refresh_permission_revision();
DROP TRIGGER IF EXISTS user_revision ON users;
CREATE TRIGGER user_revision BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION refresh_permission_revision();
