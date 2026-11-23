CREATE TABLE IF NOT EXISTS resource_rate_versions(
 id bigserial PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),resource_id uuid NOT NULL,
 rate numeric(20,4) NOT NULL,unit text NOT NULL,currency text NOT NULL,resource_version integer NOT NULL,
 actor_id uuid,captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL DEFAULT '',source text NOT NULL
);
CREATE INDEX IF NOT EXISTS resource_rate_versions_lookup ON resource_rate_versions(project_id,resource_id,id DESC);
CREATE OR REPLACE FUNCTION capture_resource_rate_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR OLD.rate IS DISTINCT FROM NEW.rate OR OLD.unit IS DISTINCT FROM NEW.unit OR OLD.currency IS DISTINCT FROM NEW.currency THEN
 INSERT INTO resource_rate_versions(project_id,resource_id,rate,unit,currency,resource_version,actor_id,reason,source)
 VALUES(NEW.project_id,NEW.id,NEW.rate,NEW.unit,NEW.currency,NEW.version,NULLIF(current_setting('app.actor_id',true),'')::uuid,COALESCE(NULLIF(current_setting('app.rate_reason',true),''),'资源池字段更新'),CASE WHEN TG_OP='INSERT' THEN 'initial' ELSE 'change' END);
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS resource_rate_version ON project_resources;
CREATE TRIGGER resource_rate_version AFTER INSERT OR UPDATE OF rate,unit,currency ON project_resources FOR EACH ROW EXECUTE FUNCTION capture_resource_rate_version();
INSERT INTO resource_rate_versions(project_id,resource_id,rate,unit,currency,resource_version,reason,source)
 SELECT project_id,id,rate,unit,currency,version,'升级时现行单价快照，不补造历史','migration' FROM project_resources r WHERE NOT EXISTS(SELECT 1 FROM resource_rate_versions v WHERE v.resource_id=r.id);
REVOKE ALL ON FUNCTION capture_resource_rate_version() FROM PUBLIC;
CREATE TABLE IF NOT EXISTS project_cost_accounts(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),code text NOT NULL,name text NOT NULL,
 parent_id uuid REFERENCES project_cost_accounts(id),active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,code),CHECK(id IS DISTINCT FROM parent_id)
);
CREATE TABLE IF NOT EXISTS allocation_cost_accounts(
 allocation_id uuid PRIMARY KEY REFERENCES activity_resource_allocations(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES project_cost_accounts(id),version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION guard_project_cost_account() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p uuid;q uuid;
BEGIN
 IF TG_TABLE_NAME='project_cost_accounts' THEN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_cost_accounts WHERE id=NEW.parent_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION '费用科目父级不属于当前项目';END IF;
 ELSE
  SELECT a.project_id INTO p FROM activity_resource_allocations x JOIN activities a ON a.id=x.activity_id WHERE x.id=NEW.allocation_id;
  SELECT project_id INTO q FROM project_cost_accounts WHERE id=NEW.account_id;
  IF p IS NULL OR q IS NULL OR p<>q THEN RAISE EXCEPTION '费用科目和分配必须属于同一项目';END IF;
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cost_account_scope ON project_cost_accounts;
CREATE TRIGGER cost_account_scope BEFORE INSERT OR UPDATE ON project_cost_accounts FOR EACH ROW EXECUTE FUNCTION guard_project_cost_account();
DROP TRIGGER IF EXISTS allocation_cost_scope ON allocation_cost_accounts;
CREATE TRIGGER allocation_cost_scope BEFORE INSERT OR UPDATE ON allocation_cost_accounts FOR EACH ROW EXECUTE FUNCTION guard_project_cost_account();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
 REVOKE ALL ON resource_rate_versions FROM studio_app;GRANT SELECT ON resource_rate_versions TO studio_app;
 GRANT SELECT,INSERT,UPDATE ON project_cost_accounts TO studio_app;
 GRANT SELECT,INSERT,UPDATE,DELETE ON allocation_cost_accounts TO studio_app;
 END IF;END $$;
