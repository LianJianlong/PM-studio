import type pg from 'pg';
import {requireThat} from './auth.ts';
import {constructionSystems,type ConstructionProfile} from '../shared/construction-catalog.ts';
// Called by the common record validation path, including imports and changes.
export async function validateConstructionValues(c:pg.PoolClient,table:any,value:any){
 if(!table.columns.some((f:any)=>['subsystem','period_from','actual_percent','pv'].includes(f.id)))return;
 const registration=(await c.query("SELECT template_key FROM project_business_templates WHERE project_id=$1 AND kind='table' AND object_id=$2",[table.project_id,table.id])).rows[0];
 if(!registration)return;
 if(registration.template_key==='progress_snapshots'&&value.actual_percent!==undefined)requireThat(Number(value.actual_percent)>=0&&Number(value.actual_percent)<=100,400,'累计完成率须介于0和100之间');
 if(registration.template_key==='earned_snapshots'){const currency=(await c.query('SELECT currency FROM projects WHERE id=$1',[table.project_id])).rows[0].currency;requireThat(String(value.currency||'').toUpperCase()===currency,400,'请按项目本币填报挣值快照');}
 if(registration.template_key==='earned_snapshots')for(const field of ['bac','pv','ev','ac'])if(value[field]!==undefined&&value[field]!==null)requireThat(Number(value[field])>=0,400,'挣值快照金额不能为负数');
 if(value.discipline&&value.subsystem){const profile=(await c.query('SELECT template_profile FROM projects WHERE id=$1',[table.project_id])).rows[0]?.template_profile as ConstructionProfile;const standard=constructionSystems(profile||'generic').find(s=>s.name===value.subsystem);if(standard)requireThat(standard.discipline===value.discipline,400,'施工专业与子系统不对应');}
 if(value.system_ref?.length){requireThat(value.system_ref.length===1,400,'每条明细只选择一个子系统');const r=(await c.query("SELECT r.data FROM records r JOIN data_tables t ON t.id=r.table_id JOIN project_business_templates b ON b.object_id=t.id AND b.kind='table' AND b.template_key='system_catalog' WHERE r.id=$1 AND t.project_id=$2 AND r.lifecycle='active'",[value.system_ref[0],table.project_id])).rows[0];requireThat(r,400,'子系统目录记录无效');requireThat((!value.discipline||value.discipline===r.data.discipline)&&(!value.subsystem||value.subsystem===r.data.name),400,'专业、子系统与关联目录不一致');}
 if(value.catalog_ref?.length){requireThat(value.catalog_ref.length===1,400,'每条材料明细只选择一个标准材料类别');const r=(await c.query("SELECT r.data FROM records r JOIN data_tables t ON t.id=r.table_id JOIN project_business_templates b ON b.object_id=t.id AND b.kind='table' AND b.template_key='material_catalog' WHERE r.id=$1 AND t.project_id=$2",[value.catalog_ref[0],table.project_id])).rows[0];requireThat(r,400,'标准材料目录记录无效');requireThat((!value.discipline||value.discipline===r.data.discipline)&&(!value.subsystem||value.subsystem===r.data.subsystem)&&(!value.material_family||value.material_family===r.data.name),400,'材料类别与所选专业子系统不一致');}
 if(value.material_ref?.length&&value.unit){requireThat(value.material_ref.length===1,400,'每条材料明细只选择一种材料');const r=(await c.query('SELECT r.data FROM records r JOIN data_tables t ON t.id=r.table_id WHERE r.id=$1 AND t.project_id=$2',[value.material_ref[0],table.project_id])).rows[0];if(r?.data.unit)requireThat(r.data.unit===value.unit,400,'材料单位与项目材料主数据不一致；请先明确换算口径');}
 if(value.period_from&&value.period_to)requireThat(value.period_from<=value.period_to,400,'统计结束日期不能早于开始日期');
}
