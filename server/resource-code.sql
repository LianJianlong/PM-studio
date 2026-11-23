ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS planning_settings jsonb NOT NULL DEFAULT '{}';
WITH numbered AS (
 SELECT id, row_number() OVER(PARTITION BY project_id ORDER BY created_at,id) AS n FROM project_resources WHERE code=''
) UPDATE project_resources r SET code='RES-'||lpad(numbered.n::text,greatest(3,length(numbered.n::text)),'0') FROM numbered WHERE r.id=numbered.id;
CREATE UNIQUE INDEX IF NOT EXISTS project_resource_code_unique ON project_resources(project_id,code);
CREATE OR REPLACE FUNCTION assign_project_resource_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE highest bigint; candidate bigint; code_value text; rule jsonb; prefix text; first_number bigint; step_number bigint; width_number integer; fill_gaps boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text||':resource-code',0));
 code_value=nullif(btrim(NEW.code),'');
 IF TG_OP='UPDATE' AND code_value IS NULL THEN code_value=OLD.code; END IF;
 IF code_value IS NULL THEN
  SELECT planning_settings->'resource_code' INTO rule FROM projects WHERE id=NEW.project_id;
  prefix=coalesce(rule->>'prefix','RES-'); first_number=coalesce((rule->>'start')::bigint,1);
  step_number=coalesce((rule->>'step')::bigint,1); width_number=coalesce((rule->>'width')::integer,3);
  fill_gaps=coalesce((rule->>'fill_gaps')::boolean,false);
  IF NOT fill_gaps THEN
   SELECT max(substring(code from length(prefix)+1)::bigint) INTO highest FROM project_resources
    WHERE project_id=NEW.project_id AND left(code,length(prefix))=prefix AND substring(code from length(prefix)+1) ~ '^[0-9]{1,12}$';
  END IF;
  candidate=greatest(first_number,coalesce(highest+step_number,first_number));
  LOOP
   IF candidate>999999999999 THEN RAISE EXCEPTION 'AUTOCODE:资源编码已达到数字上限'; END IF;
   code_value=prefix||lpad(candidate::text,greatest(width_number,length(candidate::text)),'0');
   EXIT WHEN NOT EXISTS(SELECT 1 FROM project_resources r WHERE r.project_id=NEW.project_id AND r.code=code_value);
   candidate=candidate+step_number;
  END LOOP;
 END IF;
 IF length(code_value)>40 THEN RAISE EXCEPTION 'AUTOCODE:资源编码不能超过40个字符'; END IF;
 IF EXISTS(SELECT 1 FROM project_resources r WHERE r.project_id=NEW.project_id AND r.id<>NEW.id AND r.code=code_value) THEN RAISE EXCEPTION 'AUTOCODE:资源编码 % 已存在于当前项目',code_value; END IF;
 NEW.code=code_value;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_project_resource_code ON project_resources;
CREATE TRIGGER a_project_resource_code BEFORE INSERT OR UPDATE ON project_resources FOR EACH ROW EXECUTE FUNCTION assign_project_resource_code();
