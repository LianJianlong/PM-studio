-- pg_dump must read counters to restore the next auto-increment values.
-- Runtime code may read them for backup but must never mutate them directly.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
  GRANT SELECT ON integer_field_counters TO studio_app;
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON integer_field_counters FROM studio_app;
 END IF;
END $$;
