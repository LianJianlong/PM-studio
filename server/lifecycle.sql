ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','frozen','disabled','deleted'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','frozen','disabled','deleted'));
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','frozen','disabled','deleted'));
ALTER TABLE records ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','frozen','disabled','deleted'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS object_version integer NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS object_version integer NOT NULL DEFAULT 1;
ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS object_version integer NOT NULL DEFAULT 1;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS object_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION enforce_object_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v jsonb; oldv jsonb; w uuid; p uuid; t uuid; state text; fields jsonb; f jsonb; prior jsonb;
BEGIN
  -- Privileged offline restore/maintenance; application traffic uses studio_app.
  IF current_user <> 'studio_app' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN v=to_jsonb(OLD); ELSE v=to_jsonb(NEW); END IF;
  IF TG_OP<>'INSERT' THEN oldv=to_jsonb(OLD); END IF;
  IF TG_OP='UPDATE' AND oldv ? 'object_version' AND oldv->'object_version'=v->'object_version' THEN
    NEW=jsonb_populate_record(NEW,jsonb_build_object('object_version',(oldv->>'object_version')::int+1));
  END IF;
  IF TG_TABLE_NAME IN ('projects','connections','workspace_members') THEN w=(v->>'workspace_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('departments','memberships','data_tables','activities','baselines','todos','reports','approvals','workflow_definitions') THEN p=(v->>'project_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('records','saved_views','import_batches') THEN t=(v->>'table_id')::uuid;
  END IF;
  IF t IS NOT NULL THEN SELECT project_id INTO p FROM data_tables WHERE id=t; END IF;
  IF p IS NOT NULL THEN SELECT workspace_id INTO w FROM projects WHERE id=p; END IF;
  IF w IS NOT NULL THEN
    SELECT lifecycle INTO state FROM workspaces WHERE id=w FOR SHARE;
    IF state<>'active' THEN RAISE EXCEPTION 'LIFECYCLE:工作空间非活动状态，请先激活' USING ERRCODE='P0001'; END IF;
  END IF;
  IF p IS NOT NULL THEN
    SELECT lifecycle INTO state FROM projects WHERE id=p FOR SHARE;
    IF state<>'active' THEN RAISE EXCEPTION 'LIFECYCLE:项目非活动状态，请先激活' USING ERRCODE='P0001'; END IF;
  END IF;
  IF t IS NOT NULL THEN
    SELECT lifecycle,columns INTO state,fields FROM data_tables WHERE id=t FOR SHARE;
    IF state<>'active' THEN RAISE EXCEPTION 'LIFECYCLE:数据表非活动状态，请先激活' USING ERRCODE='P0001'; END IF;
  END IF;
  IF oldv ? 'lifecycle' AND oldv->>'lifecycle'<>'active' THEN
    IF TG_OP='DELETE' OR (oldv - ARRAY['lifecycle','object_version','version','updated_at']) IS DISTINCT FROM (v - ARRAY['lifecycle','object_version','version','updated_at']) THEN
      RAISE EXCEPTION 'LIFECYCLE:对象非活动状态，不允许修改业务内容' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF TG_TABLE_NAME='records' AND TG_OP<>'DELETE' THEN
    FOR f IN SELECT * FROM jsonb_array_elements(fields) LOOP
      IF coalesce(f->>'lifecycle','active')<>'active' THEN
        prior=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE coalesce(oldv->'data'->(f->>'id'),'null'::jsonb) END;
        IF coalesce(v->'data'->(f->>'id'),'null'::jsonb) IS DISTINCT FROM prior THEN
          RAISE EXCEPTION 'LIFECYCLE:字段 % 非活动状态，不允许修改',f->>'name' USING ERRCODE='P0001';
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['workspaces','projects','workspace_members','connections','departments','memberships','data_tables','records','saved_views','import_batches','activities','baselines','todos','reports','approvals','workflow_definitions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS object_lifecycle_guard ON %I',relation);
    EXECUTE format('CREATE TRIGGER object_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_object_lifecycle()',relation);
  END LOOP;
END $$;
