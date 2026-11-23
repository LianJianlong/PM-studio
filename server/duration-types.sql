-- Preserve the analytics view and its grants while widening whole-day storage.
DO $$ DECLARE def text; own text; g record; trig text; BEGIN
 IF (SELECT data_type='integer' FROM information_schema.columns WHERE table_schema='public' AND table_name='activities' AND column_name='duration') THEN
  SELECT pg_get_viewdef(c.oid,true),pg_get_userbyid(c.relowner) INTO def,own FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='analytics' AND c.relname='activity_progress';
  CREATE TEMP TABLE duration_view_grants ON COMMIT DROP AS SELECT x.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) x WHERE n.nspname='analytics' AND c.relname='activity_progress';
  DROP VIEW IF EXISTS analytics.activity_progress;
  SELECT pg_get_triggerdef(oid) INTO trig FROM pg_trigger WHERE tgrelid='activities'::regclass AND tgname='activity_duration_cost';
  DROP TRIGGER IF EXISTS activity_duration_cost ON activities;
  ALTER TABLE activities ALTER COLUMN duration TYPE numeric(18,8) USING duration::numeric;
  IF trig IS NOT NULL THEN EXECUTE trig; END IF;
  IF def IS NOT NULL THEN
   EXECUTE 'CREATE VIEW analytics.activity_progress AS '||def;
   EXECUTE format('ALTER VIEW analytics.activity_progress OWNER TO %I',own);
   FOR g IN SELECT * FROM duration_view_grants LOOP
    EXECUTE format('GRANT %s ON analytics.activity_progress TO %s%s',g.privilege_type,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END,CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
   END LOOP;
  END IF;
 END IF;
END $$;
UPDATE data_tables t SET columns=t.columns||'[{"id":"duration_type","name":"工期类型","type":"single_select","options":["固定工期和投入率","固定工期和工作量","固定投入率","固定工作量"]}]'::jsonb
WHERE EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.table_id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='duration_type');
