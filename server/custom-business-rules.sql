CREATE TABLE IF NOT EXISTS project_business_rules(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),table_id uuid NOT NULL REFERENCES data_tables(id),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=16000),
 enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS project_business_rules_lookup ON project_business_rules(project_id,table_id) WHERE deleted_at IS NULL;
CREATE OR REPLACE FUNCTION guard_business_rule_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM data_tables WHERE id=NEW.table_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION '业务规则的表不属于该项目';END IF;
 IF TG_OP='UPDATE' AND (OLD.id<>NEW.id OR OLD.project_id<>NEW.project_id OR OLD.table_id<>NEW.table_id) THEN RAISE EXCEPTION '业务规则所属范围不可变更';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_rule_scope ON project_business_rules;
CREATE TRIGGER business_rule_scope BEFORE INSERT OR UPDATE ON project_business_rules FOR EACH ROW EXECUTE FUNCTION guard_business_rule_scope();
GRANT SELECT,INSERT,UPDATE ON project_business_rules TO studio_app;
