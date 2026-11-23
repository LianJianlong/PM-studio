CREATE SCHEMA IF NOT EXISTS analytics;
CREATE OR REPLACE VIEW analytics.activity_progress AS
SELECT a.project_id, a.id AS activity_id, a.code, a.name AS activity_name,
       d.name AS department, a.duration, a.progress,
       (a.duration * a.progress / 100)::numeric(20,2) AS completed_days,
       a.department_id
FROM activities a LEFT JOIN departments d ON d.id = a.department_id;

CREATE OR REPLACE VIEW analytics.resource_cost AS
SELECT a.project_id, a.id AS activity_id, a.code AS activity_code,
       a.name AS activity_name, d.name AS department,
       r.kind AS resource_kind, r.name AS resource_name, r.unit,
       x.quantity, x.planned_cost, x.actual_cost,
       (x.planned_cost - x.actual_cost)::numeric(20,4) AS cost_variance,
       a.department_id
FROM activity_resource_allocations x
JOIN activities a ON a.id = x.activity_id
JOIN project_resources r ON r.id = x.resource_id AND r.project_id = a.project_id
LEFT JOIN departments d ON d.id = a.department_id;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
