-- Future allocations are separate from original planned assignments and actual costs.
CREATE TABLE IF NOT EXISTS activity_resource_remaining(
 allocation_id uuid PRIMARY KEY REFERENCES activity_resource_allocations(id) ON DELETE CASCADE,
 quantity numeric(20,4) NOT NULL CHECK(quantity>=0 AND quantity<=1000000000000),
 as_of_date date NOT NULL,
 version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON activity_resource_remaining TO studio_app; END IF; END $$;
