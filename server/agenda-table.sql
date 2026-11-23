ALTER TABLE data_tables ADD COLUMN IF NOT EXISTS is_agenda boolean NOT NULL DEFAULT false;
ALTER TABLE records ADD COLUMN IF NOT EXISTS agenda_owner_id uuid REFERENCES users(id);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS project_agenda_tables(project_id uuid PRIMARY KEY REFERENCES projects(id),table_id uuid NOT NULL UNIQUE REFERENCES data_tables(id));
CREATE INDEX IF NOT EXISTS records_agenda_owner ON records(table_id,agenda_owner_id) WHERE agenda_owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION agenda_manager(p uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=u AND active AND system_admin)
 OR EXISTS(SELECT 1 FROM projects pr JOIN workspace_members wm ON wm.workspace_id=pr.workspace_id WHERE pr.id=p AND wm.user_id=u AND wm.role='owner')
 OR EXISTS(SELECT 1 FROM memberships WHERE project_id=p AND user_id=u AND role='manager' AND (expires_at IS NULL OR expires_at>now()))
$$;
CREATE OR REPLACE FUNCTION agenda_owner_allowed(p uuid,u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=u AND active) AND (agenda_manager(p,u) OR EXISTS(SELECT 1 FROM memberships WHERE project_id=p AND user_id=u AND (expires_at IS NULL OR expires_at>now())))
$$;
CREATE OR REPLACE FUNCTION agenda_record_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE t data_tables; owner_key uuid; actor uuid;
BEGIN
 SELECT * INTO t FROM data_tables WHERE id=NEW.table_id;
 IF NOT t.is_agenda THEN NEW.agenda_owner_id=NULL;RETURN NEW;END IF;
 SELECT id INTO owner_key FROM users WHERE username=NEW.data->>'owner';
 IF owner_key IS NULL THEN RAISE EXCEPTION 'AGENDA:请选择有效负责人';END IF;
 NEW.agenda_owner_id=owner_key;
 NEW.data=NEW.data||jsonb_build_object('done',coalesce((NEW.data->>'done')::boolean,false),'priority',coalesce(NEW.data->>'priority','普通'),'recurrence',coalesce(NEW.data->>'recurrence','不重复'),'content',coalesce(NEW.data->>'content','')); 
 IF length(coalesce(NEW.data->>'title','')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'AGENDA:事项名称须为1至120字符';END IF;
 IF nullif(NEW.data->>'recurrence_until','')::date<(NEW.data->>'due_date')::date THEN RAISE EXCEPTION 'AGENDA:重复截止日期不能早于待办日期';END IF;
 IF current_user<>'studio_app' OR pg_trigger_depth()>1 THEN RETURN NEW;END IF;
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 IF actor IS NULL THEN RAISE EXCEPTION 'AGENDA:缺少操作用户';END IF;
 IF NOT agenda_manager(t.project_id,actor) AND (owner_key<>actor OR (TG_OP='UPDATE' AND OLD.agenda_owner_id<>actor)) THEN RAISE EXCEPTION 'AGENDA:只能操作本人待办，管理员才可更换负责人';END IF;
 IF (TG_OP='INSERT' OR OLD.agenda_owner_id IS DISTINCT FROM owner_key) AND NOT agenda_owner_allowed(t.project_id,owner_key) THEN RAISE EXCEPTION 'AGENDA:负责人无项目权限或账号已停用';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agenda_record_guard ON records;
CREATE TRIGGER agenda_record_guard BEFORE INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION agenda_record_guard();

CREATE OR REPLACE FUNCTION agenda_record_shell() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p uuid;
BEGIN
 IF pg_trigger_depth()>1 OR NEW.agenda_owner_id IS NULL THEN RETURN NEW;END IF;
 SELECT project_id INTO p FROM project_agenda_tables WHERE table_id=NEW.table_id;IF p IS NULL THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM todos WHERE id=NEW.id) THEN
  INSERT INTO todos(id,project_id,title,due_date,owner_id,done,priority,recurrence,recurrence_until,recurrence_day,version,content)
  VALUES(NEW.id,p,NEW.data->>'title',(NEW.data->>'due_date')::date,NEW.agenda_owner_id,coalesce((NEW.data->>'done')::boolean,false),
   CASE NEW.data->>'priority' WHEN '低' THEN 'low' WHEN '高' THEN 'high' WHEN '紧急' THEN 'urgent' ELSE 'normal' END,
   CASE NEW.data->>'recurrence' WHEN '每天' THEN 'daily' WHEN '每周' THEN 'weekly' WHEN '每月' THEN 'monthly' ELSE 'none' END,
   nullif(NEW.data->>'recurrence_until','')::date,extract(day FROM (NEW.data->>'due_date')::date),NEW.version,coalesce(NEW.data->>'content',''));
  INSERT INTO notifications(id,user_id,project_id,kind,resource_id,title) VALUES(gen_random_uuid(),NEW.agenda_owner_id,p,'todo',NEW.id,'你有一项新的日历待办');
 ELSIF TG_OP='UPDATE' THEN
  UPDATE todos SET version=NEW.version,archived=(NEW.lifecycle='deleted' OR NEW.status='obsolete') WHERE id=NEW.id AND (version<>NEW.version OR archived IS DISTINCT FROM (NEW.lifecycle='deleted' OR NEW.status='obsolete'));
 END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agenda_record_shell ON records;
CREATE TRIGGER agenda_record_shell AFTER INSERT OR UPDATE ON records FOR EACH ROW EXECUTE FUNCTION agenda_record_shell();

CREATE OR REPLACE FUNCTION agenda_sync_todo(todo_key uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE todo todos; tab uuid; username text; actor uuid; payload jsonb;
BEGIN
 SELECT * INTO todo FROM todos WHERE id=todo_key;IF NOT FOUND THEN RETURN;END IF;
 SELECT table_id INTO tab FROM project_agenda_tables WHERE project_id=todo.project_id;IF tab IS NULL THEN RETURN;END IF;
 SELECT u.username INTO username FROM users u WHERE id=todo.owner_id;
 actor=coalesce(nullif(current_setting('app.actor_id',true),'')::uuid,todo.owner_id);
 payload=jsonb_build_object('title',todo.title,'due_date',todo.due_date,'owner',username,'done',todo.done,'content',todo.content,
 'priority',CASE todo.priority WHEN 'low' THEN '低' WHEN 'high' THEN '高' WHEN 'urgent' THEN '紧急' ELSE '普通' END,
 'recurrence',CASE todo.recurrence WHEN 'daily' THEN '每天' WHEN 'weekly' THEN '每周' WHEN 'monthly' THEN '每月' ELSE '不重复' END,'recurrence_until',todo.recurrence_until);
 UPDATE records SET data=records.data||payload,updated_by=actor,version=todo.version,lifecycle=CASE WHEN todo.archived THEN 'deleted' ELSE 'active' END,updated_at=todo.updated_at,agenda_owner_id=todo.owner_id,
 status=CASE WHEN NOT todo.archived AND records.status='obsolete' THEN 'draft' WHEN records.data IS DISTINCT FROM records.data||payload THEN 'draft' ELSE records.status END WHERE id=todo.id;
 IF NOT FOUND THEN
  INSERT INTO records(id,table_id,data,created_by,updated_by,version,lifecycle,created_at,updated_at,agenda_owner_id)
  VALUES(todo.id,tab,payload,actor,actor,todo.version,CASE WHEN todo.archived THEN 'deleted' ELSE 'active' END,todo.created_at,todo.updated_at,todo.owner_id);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION agenda_todo_mirror() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN IF pg_trigger_depth()=1 THEN PERFORM agenda_sync_todo(NEW.id);END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS agenda_todo_mirror ON todos;
CREATE TRIGGER agenda_todo_mirror AFTER INSERT OR UPDATE ON todos FOR EACH ROW EXECUTE FUNCTION agenda_todo_mirror();

CREATE OR REPLACE FUNCTION agenda_schema_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE core jsonb; next jsonb;
BEGIN
 IF NOT OLD.is_agenda THEN RETURN NEW;END IF;
 IF NEW.review_mode<>'supervisor' THEN RAISE EXCEPTION 'AGENDA:事项采用主管确认，不使用严格审批流程';END IF;
 IF NOT NEW.is_agenda OR NEW.project_id<>OLD.project_id OR NEW.lifecycle='deleted' THEN RAISE EXCEPTION 'AGENDA:内置事项表不能删除或移出项目';END IF;
 FOR core IN SELECT value FROM jsonb_array_elements(OLD.columns) WHERE value->>'id' IN ('title','due_date','owner','done','priority','recurrence','recurrence_until','content') LOOP
  SELECT value INTO next FROM jsonb_array_elements(NEW.columns) WHERE value->>'id'=core->>'id';
  IF next IS NULL OR next->>'type' IS DISTINCT FROM core->>'type' OR coalesce((next->>'required')::boolean,false) IS DISTINCT FROM coalesce((core->>'required')::boolean,false) OR coalesce(next->>'lifecycle','active')<>'active' THEN RAISE EXCEPTION 'AGENDA:内置字段支持改名，但不能改变业务类型或停用；请新增自定义字段';END IF;
  IF core->>'id' IN ('priority','recurrence') AND next->'options' IS DISTINCT FROM core->'options' THEN RAISE EXCEPTION 'AGENDA:内置优先级和重复规则选项不能改变';END IF;
 END LOOP;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agenda_schema_guard ON data_tables;
CREATE TRIGGER agenda_schema_guard BEFORE UPDATE ON data_tables FOR EACH ROW EXECUTE FUNCTION agenda_schema_guard();
REVOKE ALL ON FUNCTION agenda_manager(uuid,uuid),agenda_owner_allowed(uuid,uuid),agenda_sync_todo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenda_manager(uuid,uuid),agenda_owner_allowed(uuid,uuid),agenda_sync_todo(uuid) TO studio_app;

CREATE OR REPLACE FUNCTION agenda_native_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE tab data_tables;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW;END IF;
 SELECT t.* INTO tab FROM project_agenda_tables a JOIN data_tables t ON t.id=a.table_id WHERE a.project_id=NEW.project_id;
 IF NOT FOUND THEN RETURN NEW;END IF;
 IF tab.lifecycle<>'active' THEN RAISE EXCEPTION 'AGENDA:事项表当前不可编辑';END IF;
 IF TG_OP='INSERT' AND NEW.generated_from_id IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(tab.columns) f WHERE coalesce((f->>'required')::boolean,false) AND coalesce(f->>'lifecycle','active')='active' AND NOT coalesce((f->>'auto_increment')::boolean,false) AND f->>'type' NOT IN ('formula','created_time','modified_time','created_user','modified_user') AND f->>'id' NOT IN ('title','due_date','owner','done','priority','recurrence','recurrence_until','content')) THEN RAISE EXCEPTION 'AGENDA:请在事项数据表中填写必填自定义字段';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agenda_native_guard ON todos;
CREATE TRIGGER agenda_native_guard BEFORE INSERT OR UPDATE ON todos FOR EACH ROW EXECUTE FUNCTION agenda_native_guard();
