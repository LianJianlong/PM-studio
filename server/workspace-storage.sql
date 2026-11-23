-- Control-plane metadata only. No remote database is contacted or activated.
CREATE TABLE IF NOT EXISTS storage_targets(
 id uuid PRIMARY KEY,
 name varchar(120) NOT NULL,
 engine text NOT NULL CHECK(engine IN ('postgres','mysql')),
 config_cipher text NOT NULL,
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage_targets DROP CONSTRAINT IF EXISTS storage_targets_engine_check;
ALTER TABLE storage_targets ADD CONSTRAINT storage_targets_engine_check CHECK(engine IN ('postgres','mysql'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS storage_target_id uuid REFERENCES storage_targets(id);
CREATE OR REPLACE FUNCTION guard_reserved_workspace_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND storage_target_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Selected workspace database is reserved but not connected; project creation is disabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_storage_ready ON projects;
CREATE TRIGGER workspace_storage_ready BEFORE INSERT OR UPDATE OF workspace_id ON projects FOR EACH ROW EXECUTE FUNCTION guard_reserved_workspace_storage();
GRANT SELECT,INSERT,UPDATE,DELETE ON storage_targets TO studio_app;
