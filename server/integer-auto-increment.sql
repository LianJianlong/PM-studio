CREATE TABLE IF NOT EXISTS integer_field_counters (
 table_id uuid NOT NULL REFERENCES data_tables(id) ON DELETE CASCADE,
 field_id text NOT NULL,
 last_value numeric NOT NULL,
 PRIMARY KEY(table_id,field_id)
);
REVOKE ALL ON integer_field_counters FROM PUBLIC;
CREATE OR REPLACE FUNCTION assign_integer_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f jsonb; col text; typ text; step numeric; start_value numeric; current_value numeric; next_value numeric; upper_bound numeric; enabled boolean;
BEGIN
 FOR f IN SELECT value FROM jsonb_array_elements((SELECT columns FROM public.data_tables WHERE id=NEW.table_id)) LOOP
  typ=f->>'type';col=f->>'id';
  IF typ NOT IN ('int8','int16','int24','int32','int64','uint64') OR coalesce(f->>'lifecycle','active')='deleted' THEN CONTINUE; END IF;
  enabled=coalesce((f->>'auto_increment')::boolean,false);
  IF TG_OP='UPDATE' AND enabled THEN
   IF (NEW.data->>col) IS DISTINCT FROM (OLD.data->>col) AND NOT(coalesce(NEW.data->>col,'') ~ '^-?[0-9]+$' AND coalesce(OLD.data->>col,'') ~ '^-?[0-9]+$' AND (NEW.data->>col)::numeric=(OLD.data->>col)::numeric) THEN RAISE EXCEPTION 'AUTOINCREMENT:自增列 % 由系统维护，不能手动修改',f->>'name'; END IF;
   CONTINUE;
  END IF;
  IF TG_OP='INSERT' AND enabled THEN
   step=coalesce((f->>'auto_increment_step')::numeric,1);
   start_value=coalesce((f->>'auto_increment_start')::numeric,1);
   upper_bound=CASE typ WHEN 'uint64' THEN 18446744073709551615 WHEN 'int64' THEN 9223372036854775807 WHEN 'int32' THEN 2147483647 WHEN 'int24' THEN 8388607 WHEN 'int16' THEN 32767 ELSE 127 END;
   IF step<1 OR step<>trunc(step) OR step>upper_bound THEN RAISE EXCEPTION 'AUTOINCREMENT:自增间隔无效或超出整数范围'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.integer_field_counters WHERE table_id=NEW.table_id AND field_id=col) THEN
    SELECT max((data->>col)::numeric) INTO current_value FROM public.records WHERE table_id=NEW.table_id AND data->>col ~ '^-?[0-9]+$';
    INSERT INTO public.integer_field_counters(table_id,field_id,last_value) VALUES(NEW.table_id,col,greatest(coalesce(current_value,start_value-step),start_value-step)) ON CONFLICT DO NOTHING;
   END IF;
   SELECT last_value INTO current_value FROM public.integer_field_counters WHERE table_id=NEW.table_id AND field_id=col FOR UPDATE;
   next_value=greatest(current_value+step,start_value);
   IF next_value>upper_bound OR next_value<(CASE WHEN typ='uint64' THEN 0 ELSE -upper_bound-1 END) THEN RAISE EXCEPTION 'AUTOINCREMENT:自增列 % 已达到类型上限，请扩大整数类型或调整配置',f->>'name'; END IF;
   UPDATE public.integer_field_counters SET last_value=next_value WHERE table_id=NEW.table_id AND field_id=col;
   NEW.data=jsonb_set(NEW.data,ARRAY[col],CASE WHEN typ IN ('int64','uint64') THEN to_jsonb(next_value::text) ELSE to_jsonb(next_value) END,true);
  ELSIF NEW.data->>col ~ '^-?[0-9]+$' THEN
   UPDATE public.integer_field_counters SET last_value=greatest(last_value,(NEW.data->>col)::numeric) WHERE table_id=NEW.table_id AND field_id=col;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION assign_integer_fields() FROM PUBLIC;
DROP TRIGGER IF EXISTS a_record_integer_auto ON records;
CREATE TRIGGER a_record_integer_auto BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION assign_integer_fields();
