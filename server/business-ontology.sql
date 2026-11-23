CREATE TABLE IF NOT EXISTS project_business_objects(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),table_id uuid NOT NULL UNIQUE REFERENCES data_tables(id),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=24000),
 enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_business_objects_scope ON project_business_objects(project_id);
DROP TRIGGER IF EXISTS business_object_scope ON project_business_objects;
CREATE TRIGGER business_object_scope BEFORE INSERT OR UPDATE ON project_business_objects FOR EACH ROW EXECUTE FUNCTION guard_business_rule_scope();
GRANT SELECT,INSERT,UPDATE ON project_business_objects TO studio_app;
