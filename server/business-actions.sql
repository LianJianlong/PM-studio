CREATE TABLE IF NOT EXISTS project_business_action_rules(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),table_id uuid NOT NULL REFERENCES data_tables(id),
 action text NOT NULL CHECK(action IN ('create','update','delete','status')),definition jsonb NOT NULL CHECK(octet_length(definition::text)<=16000),
 enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(table_id,action)
);
CREATE INDEX IF NOT EXISTS business_action_rules_scope ON project_business_action_rules(project_id,table_id);
DROP TRIGGER IF EXISTS business_action_rule_scope ON project_business_action_rules;
CREATE TRIGGER business_action_rule_scope BEFORE INSERT OR UPDATE ON project_business_action_rules FOR EACH ROW EXECUTE FUNCTION guard_business_rule_scope();
GRANT SELECT,INSERT,UPDATE ON project_business_action_rules TO studio_app;
ALTER TABLE ai_changes ADD COLUMN IF NOT EXISTS action_policy_stamp text;
CREATE OR REPLACE FUNCTION track_ai_record_action() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE t uuid;
BEGIN
 IF current_setting('app.ai_action_tracking',true)='on' THEN
  IF TG_OP='DELETE' THEN t=OLD.table_id;ELSE t=NEW.table_id;END IF;
  IF EXISTS(SELECT 1 FROM project_business_action_rules WHERE table_id=t AND enabled) THEN
   INSERT INTO pg_temp.studio_ai_action_events(table_id,before_row,after_row) VALUES(t,CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_record_action_tracking ON records;
CREATE TRIGGER ai_record_action_tracking AFTER INSERT OR UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION track_ai_record_action();
