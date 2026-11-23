CREATE TABLE IF NOT EXISTS project_plan_summaries (
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 markdown text NOT NULL CHECK(char_length(markdown)<=200000),
 version integer NOT NULL CHECK(version>0)
);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
  GRANT SELECT,INSERT,UPDATE ON project_plan_summaries TO studio_app;
 END IF;
END $$;
