import type pg from 'pg';import {fields} from './validation.ts';
/** Add optional schema only; never change rows, ACLs, workflows or existing fields. */
export async function installProcurementFields(c:pg.PoolClient,project:string){
 const plan=(await c.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[project])).rows[0]?.table_id;if(!plan)return 0;
 const tables=(await c.query("SELECT t.* FROM data_tables t JOIN project_business_templates b ON b.object_id=t.id AND b.project_id=t.project_id WHERE t.project_id=$1 AND b.kind='table' AND b.template_key=ANY($2::text[]) AND t.lifecycle='active' FOR UPDATE OF t",[project,['procurement','purchase_orders','arrivals']])).rows;let added=0;
 for(const t of tables){const cols=[...t.columns],wanted=[{id:'activity_ref',name:'关联安装作业',type:'reference',target_table:plan,display_column:'name'},{id:'installation_ready_date',name:'确认安装就绪日期',type:'date'},{id:'readiness_basis',name:'安装就绪确认依据',type:'text'}];for(const f of wanted)if(!cols.some(x=>x.id===f.id)){cols.push({...f,required:false});added++;}fields.parse(cols);if(cols.length!==t.columns.length)await c.query('UPDATE data_tables SET columns=$1,object_version=object_version+1 WHERE id=$2',[JSON.stringify(cols),t.id]);}
 return added;
}
