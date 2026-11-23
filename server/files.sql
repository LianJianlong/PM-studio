CREATE TABLE IF NOT EXISTS project_files(
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES project_files(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('folder','file')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
  mime_type text,
  current_version integer NOT NULL DEFAULT 0 CHECK(current_version >= 0),
  object_version integer NOT NULL DEFAULT 1 CHECK(object_version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','deleted')),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  deleted_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='folder' AND mime_type IS NULL AND current_version=0) OR
        (kind='file' AND mime_type IS NOT NULL AND current_version > 0)),
  CHECK((lifecycle='deleted')=(deleted_at IS NOT NULL)),
  CHECK((deleted_at IS NULL)=(deleted_by IS NULL))
);

ALTER TABLE project_files ADD COLUMN IF NOT EXISTS deletion_batch uuid;

CREATE UNIQUE INDEX IF NOT EXISTS project_files_active_sibling_name
  ON project_files(project_id,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name))
  WHERE lifecycle='active';
CREATE INDEX IF NOT EXISTS project_files_parent
  ON project_files(project_id,parent_id,kind,name) WHERE lifecycle='active';
CREATE INDEX IF NOT EXISTS project_files_deleted
  ON project_files(project_id,deleted_at DESC) WHERE lifecycle='deleted';

CREATE TABLE IF NOT EXISTS project_file_versions(
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version > 0),
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 0 AND 1258291),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(file_id,version),
  CHECK(octet_length(content)=size_bytes)
);
CREATE INDEX IF NOT EXISTS project_file_versions_file
  ON project_file_versions(file_id,version DESC);

-- Application-role writes respect the containing project/workspace lifecycle.
-- Versions are immutable; offline cleanup remains possible through the privileged role.
CREATE OR REPLACE FUNCTION enforce_project_file_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid; project_state text; workspace_state text;
BEGIN
  IF current_user <> 'studio_app' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='project_files' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'LIFECYCLE:文件仅支持软删除' USING ERRCODE='P0001';
    END IF;
    p=NEW.project_id;
  ELSE
    IF TG_OP<>'INSERT' THEN
      RAISE EXCEPTION 'LIFECYCLE:文件版本不可修改或删除' USING ERRCODE='P0001';
    END IF;
    SELECT project_id INTO p FROM project_files WHERE id=NEW.file_id;
  END IF;
  SELECT pr.lifecycle,w.lifecycle INTO project_state,workspace_state
  FROM projects pr JOIN workspaces w ON w.id=pr.workspace_id WHERE pr.id=p FOR SHARE OF pr,w;
  IF project_state<>'active' THEN
    RAISE EXCEPTION 'LIFECYCLE:项目非活动状态，请先激活' USING ERRCODE='P0001';
  END IF;
  IF workspace_state<>'active' THEN
    RAISE EXCEPTION 'LIFECYCLE:工作空间非活动状态，请先激活' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_file_lifecycle_guard ON project_files;
CREATE TRIGGER project_file_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON project_files
  FOR EACH ROW EXECUTE FUNCTION enforce_project_file_lifecycle();
DROP TRIGGER IF EXISTS project_file_version_lifecycle_guard ON project_file_versions;
CREATE TRIGGER project_file_version_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON project_file_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_project_file_lifecycle();
