CREATE TABLE IF NOT EXISTS table_print_forms(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),table_id uuid NOT NULL REFERENCES data_tables(id),definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS table_print_forms_scope ON table_print_forms(project_id,table_id) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS print_form_scope ON table_print_forms;
CREATE TRIGGER print_form_scope BEFORE INSERT OR UPDATE ON table_print_forms FOR EACH ROW EXECUTE FUNCTION guard_business_rule_scope();
GRANT SELECT,INSERT,UPDATE ON table_print_forms TO studio_app;
