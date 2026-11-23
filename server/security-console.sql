CREATE TABLE IF NOT EXISTS operation_events(id bigserial PRIMARY KEY,actor_id uuid REFERENCES users(id),username text NOT NULL,workspace_id uuid,project_id uuid,method text NOT NULL,path text NOT NULL,status integer NOT NULL,address text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS operation_events_scope_time ON operation_events(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS database_backup_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,directory text NOT NULL DEFAULT '/var/lib/project-studio/backups',interval_minutes integer NOT NULL DEFAULT 1440 CHECK(interval_minutes>=15),next_run timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO database_backup_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS database_backup_runs(id bigserial PRIMARY KEY,status text NOT NULL,filename text,error text,bytes bigint,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
REVOKE UPDATE,DELETE ON operation_events FROM studio_app;
ALTER TABLE database_backup_settings ADD COLUMN IF NOT EXISTS retention integer NOT NULL DEFAULT 5 CHECK(retention IN (1,3,5));
ALTER TABLE database_backup_runs ADD COLUMN IF NOT EXISTS retained boolean NOT NULL DEFAULT true;
