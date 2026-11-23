CREATE TABLE IF NOT EXISTS app_login_appearance (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 image_data bytea CHECK(octet_length(image_data)<=1048576),
 image_mime text CHECK(image_mime IN ('image/png','image/jpeg')),
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 CHECK((image_data IS NULL)=(image_mime IS NULL))
);
INSERT INTO app_login_appearance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
 GRANT SELECT,UPDATE ON app_login_appearance TO studio_app;
 REVOKE INSERT,DELETE,TRUNCATE ON app_login_appearance FROM studio_app;
END IF; END $$;
