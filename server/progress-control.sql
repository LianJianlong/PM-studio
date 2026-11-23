CREATE TABLE IF NOT EXISTS plan_period_snapshots(
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 series text NOT NULL CHECK(series IN ('weekly','monthly','custom')),
 name text NOT NULL,
 period_start date NOT NULL,period_end date NOT NULL,data_date date NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 previous_id uuid REFERENCES plan_period_snapshots(id),
 previous_period_id uuid REFERENCES plan_period_snapshots(id),
 baseline_id uuid REFERENCES baselines(id),
 source_hash text NOT NULL,
 payload jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 captured_at timestamptz NOT NULL DEFAULT now(),
 CHECK(period_start<=data_date AND data_date<=period_end),
 UNIQUE(project_id,series,period_start,period_end,revision)
);
CREATE INDEX IF NOT EXISTS period_project_series ON plan_period_snapshots(project_id,series,period_start DESC);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
 GRANT SELECT,INSERT ON plan_period_snapshots TO studio_app;
 REVOKE UPDATE,DELETE ON plan_period_snapshots FROM studio_app;
 END IF; END $$;
-- Conversion coefficients are settings, not historical work records. Preserve all shift periods.
UPDATE projects SET calendar_config=jsonb_set(calendar_config,'{hours_per_month}',to_jsonb(round((calendar_config->>'hours_per_month')::numeric))),calendar_version=calendar_version+1
WHERE calendar_config IS NOT NULL AND (calendar_config->>'hours_per_month')::numeric<>round((calendar_config->>'hours_per_month')::numeric);
