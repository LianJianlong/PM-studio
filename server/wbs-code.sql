ALTER TABLE records ADD COLUMN IF NOT EXISTS wbs_code_auto boolean NOT NULL DEFAULT false;
UPDATE data_tables t
 SET columns=(SELECT jsonb_agg(CASE WHEN f->>'id'='code' THEN f||'{"auto_code":true}'::jsonb ELSE f END ORDER BY i)
              FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS a(f,i))
 FROM planning_tables b
 WHERE b.table_id=t.id AND b.kind='wbs'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='code' AND f->>'auto_code' IS DISTINCT FROM 'true');

CREATE OR REPLACE FUNCTION assign_wbs_hierarchy_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_key text; prefix text := ''; highest bigint; next_number bigint; candidate text; rule jsonb; first_number bigint:=1; step_number bigint:=1; pad_width integer:=1; fill_gaps boolean:=false;
BEGIN
 IF NEW.lifecycle<>'active' OR NOT EXISTS(SELECT 1 FROM planning_tables WHERE table_id=NEW.table_id AND kind='wbs') THEN RETURN NEW; END IF;
 parent_key=NEW.data->'parent'->>0;
 IF TG_OP='UPDATE' AND nullif(btrim(NEW.data->>'code'),'') IS NOT NULL THEN
  IF (NEW.data->>'code') IS DISTINCT FROM (OLD.data->>'code') THEN
   NEW.wbs_code_auto=false;
   RETURN NEW;
  END IF;
  IF parent_key IS NOT DISTINCT FROM (OLD.data->'parent'->>0) THEN RETURN NEW; END IF;
 ELSIF TG_OP='INSERT' AND nullif(btrim(NEW.data->>'code'),'') IS NOT NULL THEN
  RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.table_id::text||':code',0));
 IF parent_key IS NOT NULL THEN
  SELECT (r.data->>'code')||'.' INTO prefix FROM records r WHERE r.id=parent_key::uuid AND r.table_id=NEW.table_id AND r.lifecycle='active' AND r.status<>'obsolete';
  IF prefix IS NULL THEN RAISE EXCEPTION 'AUTOCODE:上级WBS不可用'; END IF;
 ELSE
  SELECT f INTO rule FROM data_tables t CROSS JOIN LATERAL jsonb_array_elements(t.columns) f WHERE t.id=NEW.table_id AND f->>'id'='code';
  prefix=COALESCE(rule->>'code_prefix',''); first_number=COALESCE((rule->>'code_start')::bigint,1);
  step_number=COALESCE((rule->>'code_step')::bigint,1); pad_width=COALESCE((rule->>'code_width')::integer,1);
  fill_gaps=COALESCE((rule->>'code_fill_gaps')::boolean,false);
 END IF;
 SELECT max(CASE WHEN suffix ~ '^[0-9]{1,12}$' THEN suffix::bigint END) INTO highest
 FROM (
  SELECT substring(r.data->>'code' from length(prefix)+1) suffix FROM records r
   WHERE r.table_id=NEW.table_id AND r.lifecycle<>'deleted'
   AND (r.data->'parent'->>0) IS NOT DISTINCT FROM parent_key
   AND left(r.data->>'code',length(prefix))=prefix
 ) siblings;
 next_number=CASE WHEN fill_gaps THEN first_number ELSE greatest(first_number,coalesce(highest+step_number,first_number)) END;
 LOOP
  IF next_number>999999999999 THEN RAISE EXCEPTION 'AUTOCODE:WBS同级编码已达到数字上限'; END IF;
  candidate=prefix||lpad(next_number::text,greatest(pad_width,length(next_number::text)),'0');
  IF length(candidate)>10000 THEN RAISE EXCEPTION 'AUTOCODE:WBS编码超过文本长度上限'; END IF;
  EXIT WHEN NOT EXISTS(SELECT 1 FROM records r WHERE r.table_id=NEW.table_id AND r.lifecycle<>'deleted' AND r.id<>NEW.id AND r.data->>'code'=candidate);
  next_number=next_number+step_number;
 END LOOP;
 NEW.data=jsonb_set(NEW.data,'{code}',to_jsonb(candidate));
 NEW.wbs_code_auto=true;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_record_0_wbs_code ON records;
CREATE TRIGGER a_record_0_wbs_code BEFORE INSERT OR UPDATE OF data ON records
 FOR EACH ROW EXECUTE FUNCTION assign_wbs_hierarchy_code();
