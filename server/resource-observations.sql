-- Only confirmed resource-unit observations form historical points. No daily actuals are inferred.
CREATE TABLE IF NOT EXISTS resource_unit_observations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id),
 allocation_id uuid NOT NULL,resource_id uuid NOT NULL,activity_id uuid NOT NULL,
 source_version integer NOT NULL,record_id uuid NOT NULL,record_version integer NOT NULL,
 as_of_date date NOT NULL,units numeric(20,4) CHECK(units>=0 AND units<=1000000000000000),unit text NOT NULL,
 reported_by uuid NOT NULL,confirmed_by uuid,confirmed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(allocation_id,source_version)
);
CREATE INDEX IF NOT EXISTS resource_unit_observations_lookup ON resource_unit_observations(project_id,resource_id,allocation_id,source_version);
CREATE OR REPLACE FUNCTION capture_confirmed_resource_units() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='approved' AND NEW.lifecycle='active' THEN
 INSERT INTO resource_unit_observations(project_id,allocation_id,resource_id,activity_id,source_version,record_id,record_version,as_of_date,units,unit,reported_by,confirmed_by)
 SELECT a.project_id,x.id,x.resource_id,a.id,v.version,NEW.id,NEW.version,v.as_of_date,v.units,r.unit,v.updated_by,NEW.confirmed_by
 FROM plan_activity_records l JOIN activities a ON a.id=l.activity_id JOIN activity_resource_allocations x ON x.activity_id=a.id
 JOIN project_resources r ON r.id=x.resource_id AND r.project_id=a.project_id JOIN activity_resource_actuals v ON v.allocation_id=x.id
 WHERE l.record_id=NEW.id ON CONFLICT(allocation_id,source_version) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capture_confirmed_resource_units ON records;
CREATE TRIGGER capture_confirmed_resource_units AFTER INSERT OR UPDATE OF status,version ON records FOR EACH ROW EXECUTE FUNCTION capture_confirmed_resource_units();
-- Seed only the existing latest, confirmed snapshot; never invent older points.
INSERT INTO resource_unit_observations(project_id,allocation_id,resource_id,activity_id,source_version,record_id,record_version,as_of_date,units,unit,reported_by,confirmed_by)
 SELECT a.project_id,x.id,x.resource_id,a.id,v.version,r.id,r.version,v.as_of_date,v.units,pr.unit,v.updated_by,r.confirmed_by
 FROM activity_resource_actuals v JOIN activity_resource_allocations x ON x.id=v.allocation_id JOIN activities a ON a.id=x.activity_id
 JOIN project_resources pr ON pr.id=x.resource_id AND pr.project_id=a.project_id JOIN plan_activity_records l ON l.activity_id=a.id
 JOIN records r ON r.id=l.record_id WHERE r.status='approved' AND r.lifecycle='active'
 ON CONFLICT(allocation_id,source_version) DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='studio_app') THEN
 REVOKE ALL ON resource_unit_observations FROM studio_app; GRANT SELECT ON resource_unit_observations TO studio_app;
 END IF; END $$;
REVOKE ALL ON FUNCTION capture_confirmed_resource_units() FROM PUBLIC;
