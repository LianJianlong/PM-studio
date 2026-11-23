-- Planned cost has one authoritative formula, including existing assignments.
CREATE OR REPLACE FUNCTION calculate_assignment_planned_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT round(NEW.quantity*r.rate*a.duration,4) INTO NEW.planned_cost
    FROM activities a JOIN project_resources r ON r.project_id=a.project_id
    WHERE a.id=NEW.activity_id AND r.id=NEW.resource_id;
  IF NEW.planned_cost IS NULL THEN RAISE EXCEPTION '资源和作业必须属于同一项目'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assignment_duration_cost ON activity_resource_allocations;
CREATE TRIGGER assignment_duration_cost BEFORE INSERT OR UPDATE ON activity_resource_allocations
FOR EACH ROW EXECUTE FUNCTION calculate_assignment_planned_cost();
CREATE OR REPLACE FUNCTION refresh_assignment_planned_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='activities' THEN
    UPDATE activity_resource_allocations x SET planned_cost=round(x.quantity*r.rate*NEW.duration,4),version=x.version+1
      FROM project_resources r WHERE x.activity_id=NEW.id AND x.resource_id=r.id
      AND x.planned_cost IS DISTINCT FROM round(x.quantity*r.rate*NEW.duration,4);
  ELSE
    UPDATE activity_resource_allocations x SET planned_cost=round(x.quantity*NEW.rate*a.duration,4),version=x.version+1
      FROM activities a WHERE x.resource_id=NEW.id AND x.activity_id=a.id
      AND x.planned_cost IS DISTINCT FROM round(x.quantity*NEW.rate*a.duration,4);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS activity_duration_cost ON activities;
CREATE TRIGGER activity_duration_cost AFTER UPDATE OF duration ON activities
FOR EACH ROW WHEN (OLD.duration IS DISTINCT FROM NEW.duration) EXECUTE FUNCTION refresh_assignment_planned_cost();
DROP TRIGGER IF EXISTS resource_rate_cost ON project_resources;
CREATE TRIGGER resource_rate_cost AFTER UPDATE OF rate ON project_resources
FOR EACH ROW WHEN (OLD.rate IS DISTINCT FROM NEW.rate) EXECUTE FUNCTION refresh_assignment_planned_cost();
UPDATE activity_resource_allocations x SET planned_cost=round(x.quantity*r.rate*a.duration,4),version=x.version+1
FROM activities a,project_resources r WHERE x.activity_id=a.id AND x.resource_id=r.id
AND x.planned_cost IS DISTINCT FROM round(x.quantity*r.rate*a.duration,4);
