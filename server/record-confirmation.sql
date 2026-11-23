DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='data_tables' AND column_name='review_mode') THEN
  ALTER TABLE data_tables ADD COLUMN review_mode text NOT NULL DEFAULT 'supervisor' CHECK(review_mode IN ('supervisor','approval'));
  UPDATE data_tables SET review_mode='approval' WHERE name ~ '人员分工|人员调配申请|采购申请|采购订单|物资需求|领料.*(申请|单)|出库申请|付款申请|支出申请|报销|合同|设备使用与租赁申请|设计变更申请|方案变更|签证申请';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION default_record_review_mode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.name ~ '人员分工|人员调配申请|采购申请|采购订单|物资需求|领料.*(申请|单)|出库申请|付款申请|支出申请|报销|合同|设备使用与租赁申请|设计变更申请|方案变更|签证申请' THEN NEW.review_mode='approval'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS default_record_review_mode ON data_tables;
CREATE TRIGGER default_record_review_mode BEFORE INSERT ON data_tables FOR EACH ROW EXECUTE FUNCTION default_record_review_mode();
ALTER TABLE records ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES users(id);
ALTER TABLE records ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE OR REPLACE FUNCTION clear_record_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status<>'approved' THEN NEW.confirmed_by=NULL;NEW.confirmed_at=NULL;END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clear_record_confirmation ON records;
CREATE TRIGGER clear_record_confirmation BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION clear_record_confirmation();
-- All published analytic sources exclude unconfirmed activities and dependants.
CREATE OR REPLACE VIEW analytics.confirmed_activities AS
WITH RECURSIVE excluded(id) AS (
 SELECT a.id FROM activities a WHERE EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.project_id=a.project_id)
 AND NOT EXISTS(SELECT 1 FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE l.activity_id=a.id AND r.status='approved' AND r.lifecycle='active')
 UNION
 SELECT a.id FROM activities a JOIN excluded e ON EXISTS(SELECT 1 FROM jsonb_array_elements(a.predecessors) d WHERE d->>'id'=e.id::text)
)
SELECT a.id AS activity_id FROM activities a WHERE NOT EXISTS(SELECT 1 FROM excluded e WHERE e.id=a.id);
CREATE OR REPLACE VIEW analytics.activity_progress AS
SELECT a.project_id,a.id AS activity_id,a.code,a.name AS activity_name,d.name AS department,a.duration,a.progress,
 (a.duration*a.progress/100)::numeric(20,2) AS completed_days,a.department_id
FROM activities a LEFT JOIN departments d ON d.id=a.department_id
WHERE a.id IN(SELECT activity_id FROM analytics.confirmed_activities);
CREATE OR REPLACE VIEW analytics.resource_cost AS
SELECT a.project_id,a.id AS activity_id,a.code AS activity_code,a.name AS activity_name,d.name AS department,
 r.kind AS resource_kind,r.name AS resource_name,r.unit,x.quantity,x.planned_cost,x.actual_cost,
 (x.planned_cost-x.actual_cost)::numeric(20,4) AS cost_variance,a.department_id
FROM activity_resource_allocations x JOIN activities a ON a.id=x.activity_id
JOIN project_resources r ON r.id=x.resource_id AND r.project_id=a.project_id
LEFT JOIN departments d ON d.id=a.department_id
WHERE a.id IN(SELECT activity_id FROM analytics.confirmed_activities);
UPDATE data_tables SET description=replace(description,'记录经审批后进入共享视图与报表','普通记录由部门主管确认有效后共享和计算；重大事项按流程审批')
WHERE description LIKE '%记录经审批后进入共享视图与报表%';
CREATE INDEX IF NOT EXISTS records_effective_lookup ON records(table_id,status,lifecycle);
