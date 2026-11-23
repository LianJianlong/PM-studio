CREATE TABLE IF NOT EXISTS record_file_links (
 id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES project_file_versions(id),
 file_name text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(record_id,file_version_id)
);
CREATE INDEX IF NOT EXISTS record_file_links_record ON record_file_links(record_id);
CREATE TABLE IF NOT EXISTS record_activity_links (
 record_id uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 activity_id uuid NOT NULL REFERENCES activities(id), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(record_id,activity_id)
);
CREATE OR REPLACE FUNCTION enforce_record_link_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r records%ROWTYPE; t data_tables%ROWTYPE; v record; target_project uuid;
BEGIN
 IF current_user <> 'studio_app' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'LIFECYCLE:关联不可直接覆盖' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN v=OLD; ELSE v=NEW; END IF;
 SELECT * INTO r FROM records WHERE id=v.record_id FOR UPDATE;
 SELECT * INTO t FROM data_tables WHERE id=r.table_id FOR SHARE;
 IF r.status NOT IN ('draft','rejected') OR r.lifecycle<>'active' OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'LIFECYCLE:仅活动草稿可修改关联' USING ERRCODE='P0001'; END IF;
 PERFORM id FROM projects WHERE id=t.project_id AND lifecycle='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIFECYCLE:项目非活动状态' USING ERRCODE='P0001'; END IF;
 PERFORM w.id FROM workspaces w JOIN projects p ON p.workspace_id=w.id WHERE p.id=t.project_id AND w.lifecycle='active' FOR SHARE OF w;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIFECYCLE:工作空间非活动状态' USING ERRCODE='P0001'; END IF;
 IF TG_TABLE_NAME='record_file_links' THEN SELECT f.project_id INTO target_project FROM project_file_versions fv JOIN project_files f ON f.id=fv.file_id WHERE fv.id=v.file_version_id;
 ELSE SELECT project_id INTO target_project FROM activities WHERE id=v.activity_id; END IF;
 IF target_project IS DISTINCT FROM t.project_id THEN RAISE EXCEPTION 'LIFECYCLE:关联必须属于同一项目' USING ERRCODE='P0001'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS record_file_link_guard ON record_file_links;
CREATE TRIGGER record_file_link_guard BEFORE INSERT OR UPDATE OR DELETE ON record_file_links FOR EACH ROW EXECUTE FUNCTION enforce_record_link_write();
DROP TRIGGER IF EXISTS record_activity_link_guard ON record_activity_links;
CREATE TRIGGER record_activity_link_guard BEFORE INSERT OR UPDATE OR DELETE ON record_activity_links FOR EACH ROW EXECUTE FUNCTION enforce_record_link_write();
