-- A reusable text-code rule. Values and counters are scoped to the physical table.
CREATE OR REPLACE FUNCTION assign_text_codes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f jsonb; col text; prefix text; value_text text; suffix text; candidate bigint; start_value bigint; step_value bigint; width_value integer; fill_gaps boolean; highest bigint;
BEGIN
 FOR f IN SELECT value FROM jsonb_array_elements((SELECT columns FROM public.data_tables WHERE id=NEW.table_id)) LOOP
  IF f->>'type'<>'text' OR coalesce((f->>'auto_code')::boolean,false)=false OR coalesce(f->>'lifecycle','active')='deleted' THEN CONTINUE; END IF;
  col=f->>'id'; prefix=coalesce(f->>'code_prefix',''); start_value=coalesce((f->>'code_start')::bigint,1); step_value=coalesce((f->>'code_step')::bigint,1); width_value=coalesce((f->>'code_width')::integer,3); fill_gaps=coalesce((f->>'code_fill_gaps')::boolean,false);
  IF start_value<1 OR start_value>999999999999 OR step_value<1 OR step_value>9999999 OR width_value<1 OR width_value>12 OR length(prefix)>20 THEN RAISE EXCEPTION 'AUTOCODE:组合编码规则无效'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.table_id::text||':'||col,0));
  value_text=nullif(btrim(NEW.data->>col),'');
  IF TG_OP='UPDATE' AND value_text IS NULL AND nullif(btrim(OLD.data->>col),'') IS NULL AND f ? 'existing_records_before' AND date_trunc('milliseconds',OLD.created_at)<=(f->>'existing_records_before')::timestamptz THEN CONTINUE; END IF;
  IF TG_OP='UPDATE' AND value_text IS NULL AND nullif(btrim(OLD.data->>col),'') IS NOT NULL THEN RAISE EXCEPTION 'AUTOCODE:编码不能清空，请填写自定义编码'; END IF;
  IF value_text IS NULL THEN
   IF fill_gaps THEN
    candidate=start_value;
    LOOP
     IF candidate>999999999999 THEN RAISE EXCEPTION 'AUTOCODE:组合编码已达到数字上限'; END IF;
     value_text=prefix||lpad(candidate::text,greatest(width_value,length(candidate::text)),'0');
     EXIT WHEN NOT EXISTS(SELECT 1 FROM public.records r WHERE r.table_id=NEW.table_id AND r.lifecycle<>'deleted' AND r.data->>col=value_text);
     candidate=candidate+step_value;
    END LOOP;
   ELSE
    SELECT max((substring(r.data->>col from length(prefix)+1))::bigint) INTO highest FROM public.records r
    WHERE r.table_id=NEW.table_id AND r.lifecycle<>'deleted' AND left(r.data->>col,length(prefix))=prefix
      AND substring(r.data->>col from length(prefix)+1) ~ '^[0-9]+$'
      AND length(substring(r.data->>col from length(prefix)+1))<=12;
    candidate=greatest(start_value,coalesce(highest+step_value,start_value));
    IF candidate>999999999999 THEN RAISE EXCEPTION 'AUTOCODE:组合编码已达到数字上限'; END IF;
    value_text=prefix||lpad(candidate::text,greatest(width_value,length(candidate::text)),'0');
    WHILE EXISTS(SELECT 1 FROM public.records r WHERE r.table_id=NEW.table_id AND r.lifecycle<>'deleted' AND r.data->>col=value_text) LOOP
     candidate=candidate+step_value;
     IF candidate>999999999999 THEN RAISE EXCEPTION 'AUTOCODE:组合编码已达到数字上限'; END IF;
     value_text=prefix||lpad(candidate::text,greatest(width_value,length(candidate::text)),'0');
    END LOOP;
   END IF;
   NEW.data=jsonb_set(NEW.data,ARRAY[col],to_jsonb(value_text),true);
  END IF;
  IF TG_OP='INSERT' OR (NEW.data->>col) IS DISTINCT FROM (OLD.data->>col) THEN
   IF EXISTS(SELECT 1 FROM public.records r WHERE r.table_id=NEW.table_id AND r.id<>NEW.id AND r.id<>coalesce(NEW.supersedes,NEW.id) AND r.supersedes IS DISTINCT FROM NEW.id AND r.lifecycle='active' AND r.status<>'obsolete' AND r.data->>col=value_text) THEN RAISE EXCEPTION 'AUTOCODE:编码 % 已存在于当前表',value_text; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION assign_text_codes() FROM PUBLIC;
DROP TRIGGER IF EXISTS a_record_text_auto ON records;
CREATE TRIGGER a_record_text_auto BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION assign_text_codes();

-- Enable the rule on existing planning tables in every workspace/project without changing values.
UPDATE data_tables t SET columns=(SELECT jsonb_agg(CASE WHEN f->>'id'='code' AND f->>'type'='text' AND NOT (f ? 'auto_code') THEN f||jsonb_build_object('auto_code',true,'code_prefix',CASE WHEN w.kind='wbs' THEN 'WBS-' ELSE 'ACT-' END,'code_start','1','code_step','1','code_width',3,'code_fill_gaps',false) ELSE f END ORDER BY ordinal) FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS x(f,ordinal))
FROM (SELECT table_id,'wbs' kind FROM planning_tables WHERE kind='wbs' UNION ALL SELECT table_id,'activity' kind FROM plan_data_tables) w
WHERE t.id=w.table_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='code' AND f->>'type'='text' AND NOT (f ? 'auto_code'));
