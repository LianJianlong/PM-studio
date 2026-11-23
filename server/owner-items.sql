ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK(kind IN ('approval','todo','owner_item'));

CREATE TABLE IF NOT EXISTS owner_items(
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  content text NOT NULL DEFAULT '' CHECK(length(content) <= 5000),
  proposer_id uuid NOT NULL REFERENCES users(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  approver_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','reviewed','approved','rejected','withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(proposer_id <> reviewer_id),
  CHECK(proposer_id <> approver_id),
  CHECK(reviewer_id <> approver_id)
);
CREATE INDEX IF NOT EXISTS owner_items_project_status ON owner_items(project_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS owner_items_reviewer ON owner_items(reviewer_id,status);
CREATE INDEX IF NOT EXISTS owner_items_approver ON owner_items(approver_id,status);

CREATE TABLE IF NOT EXISTS owner_item_events(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES owner_items(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK(action IN ('create','update','submit','review','approve','reject','withdraw')),
  from_status text CHECK(from_status IS NULL OR from_status IN ('draft','submitted','reviewed','approved','rejected','withdrawn')),
  to_status text NOT NULL CHECK(to_status IN ('draft','submitted','reviewed','approved','rejected','withdrawn')),
  opinion text NOT NULL DEFAULT '' CHECK(length(opinion) <= 2000),
  version integer NOT NULL CHECK(version > 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_item_events_item ON owner_item_events(item_id,id);
ALTER TABLE owner_item_events DROP CONSTRAINT IF EXISTS owner_item_events_action_check;
ALTER TABLE owner_item_events ADD CONSTRAINT owner_item_events_action_check CHECK(action IN ('create','update','submit','review','approve','reject','withdraw','reopen'));

CREATE OR REPLACE FUNCTION enforce_owner_item_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_project uuid; workspace_state text; project_state text;
BEGIN
  IF current_user <> 'studio_app' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME='owner_items' THEN
    item_project=CASE WHEN TG_OP='DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  ELSE
    SELECT project_id INTO item_project FROM owner_items WHERE id=NEW.item_id FOR SHARE;
  END IF;
  SELECT p.lifecycle,w.lifecycle INTO project_state,workspace_state
    FROM projects p JOIN workspaces w ON w.id=p.workspace_id
    WHERE p.id=item_project FOR SHARE OF p,w;
  IF project_state IS NULL THEN
    RAISE EXCEPTION 'LIFECYCLE:项目不存在' USING ERRCODE='P0001';
  END IF;
  IF workspace_state<>'active' THEN
    RAISE EXCEPTION 'LIFECYCLE:工作空间非活动状态，请先激活' USING ERRCODE='P0001';
  END IF;
  IF project_state<>'active' THEN
    RAISE EXCEPTION 'LIFECYCLE:项目非活动状态，请先激活' USING ERRCODE='P0001';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DROP TRIGGER IF EXISTS owner_item_lifecycle_guard ON owner_items;
CREATE TRIGGER owner_item_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON owner_items
  FOR EACH ROW EXECUTE FUNCTION enforce_owner_item_lifecycle();
DROP TRIGGER IF EXISTS owner_item_event_lifecycle_guard ON owner_item_events;
CREATE TRIGGER owner_item_event_lifecycle_guard
  BEFORE INSERT ON owner_item_events
  FOR EACH ROW EXECUTE FUNCTION enforce_owner_item_lifecycle();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON owner_items TO studio_app;
    GRANT SELECT,INSERT ON owner_item_events TO studio_app;
    GRANT USAGE,SELECT ON SEQUENCE owner_item_events_id_seq TO studio_app;
    REVOKE UPDATE,DELETE ON owner_item_events FROM studio_app;
  END IF;
END $$;
