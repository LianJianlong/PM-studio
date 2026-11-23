CREATE TABLE IF NOT EXISTS activity_resource_actuals(
 allocation_id uuid PRIMARY KEY REFERENCES activity_resource_allocations(id) ON DELETE CASCADE,
 units numeric(20,4) CHECK(units>=0 AND units<=1000000000000000),
 reported_cost numeric(20,4) CHECK(reported_cost>=0 AND reported_cost<=1000000000000000),
 as_of_date date NOT NULL,version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity_resource_actuals ADD COLUMN IF NOT EXISTS reported_cost numeric(20,4) CHECK(reported_cost>=0 AND reported_cost<=1000000000000000);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON activity_resource_actuals TO studio_app; END IF; END $$;
