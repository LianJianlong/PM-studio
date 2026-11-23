CREATE TABLE IF NOT EXISTS report_schedules (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),report_id uuid NOT NULL REFERENCES report_documents(id),
 created_by uuid NOT NULL REFERENCES users(id),name text NOT NULL,run_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,
 error text,filename text,content bytea,report_version integer
);
CREATE INDEX IF NOT EXISTS report_schedule_due ON report_schedules(run_at) WHERE status='pending';
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS repeat_kind text NOT NULL DEFAULT 'once';
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS repeat_interval integer NOT NULL DEFAULT 1;
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS weekdays jsonb NOT NULL DEFAULT '[]';
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'Europe/Helsinki';
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS anchor_at timestamptz;
ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
UPDATE report_schedules SET anchor_at=run_at WHERE anchor_at IS NULL;
CREATE TABLE IF NOT EXISTS report_schedule_runs(
 id uuid PRIMARY KEY,schedule_id uuid NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
 scheduled_at timestamptz NOT NULL,started_at timestamptz,finished_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL CHECK(status IN ('succeeded','failed')),error text,filename text,content bytea,report_version integer,
 UNIQUE(schedule_id,scheduled_at)
);
INSERT INTO report_schedule_runs(id,schedule_id,scheduled_at,started_at,finished_at,status,error,filename,content,report_version)
 SELECT id,id,run_at,started_at,coalesce(finished_at,now()),status,error,filename,content,report_version FROM report_schedules
 WHERE status IN ('succeeded','failed') ON CONFLICT DO NOTHING;

ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS month_days jsonb NOT NULL DEFAULT '[]';
