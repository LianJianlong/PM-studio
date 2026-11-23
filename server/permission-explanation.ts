import {projectCapabilities} from './project-capabilities.ts';
import {editableRecord} from '../shared/record-policy.ts';
import { isSystemField } from "../shared/fields.ts";
import { Router } from 'express';
import { access, canManage, canWrite, canRecordAction, rowAllowed, visibleColumns, tableAllowed, requireThat } from './auth.ts';
import { pool } from './db.ts';
import { id } from './validation.ts';
export const permissionExplanation=Router();
permissionExplanation.get('/projects/:project/permission-explanation',async(req,res)=>{
 const project=id.parse(req.params.project),viewer=await access(req.user.id,project),user=req.query.user_id?id.parse(req.query.user_id):req.user.id;requireThat(user===req.user.id||canManage(viewer));const a=user===req.user.id?viewer:await access(user,project);
 const managed=canManage(a),active=a.lifecycle==='active'&&a.workspace_lifecycle==='active';
 const department=a.department_id?(await pool.query('SELECT name FROM departments WHERE id=$1 AND project_id=$2',[a.department_id,project])).rows[0]?.name:null;
 const scopes=(await pool.query('SELECT id,name,department_id,lifecycle FROM data_tables WHERE project_id=$1 ORDER BY name',[project])).rows;
 const source={type:a.role==='owner'?'workspace_owner':'project_membership',role:a.role,revision:a.revision||null,expires_at:a.expires_at||null};
 const reasons=[a.role==='owner'?'工作空间所有者身份继承本空间项目的管理访问。':a.role==='manager'?'项目经理角色具有项目内管理访问；部门、表、列和本人行限制不限制经理。':'当前访问来自有效项目成员授权，角色与数据范围共同决定权限。',managed?'当前管理角色不受普通成员的部门、表、列和本人行范围限制。':'部门范围与指定数据表范围取交集；隐藏列及本人行限制在该范围内继续生效。',active?'工作空间与项目均为活动状态。':'工作空间或项目非活动状态，业务写入被生命周期规则阻止。'];
 const result:any={source,capabilities:{read:true,write:canWrite(a)&&active,manage:managed,export:managed||a.can_export},scope:{department:managed?'项目内全部部门':a.department_id?(department||'部门范围已失效'):'全部部门',tables:scopes.filter(t=>tableAllowed(a,t)).map(t=>({id:t.id,name:t.name})),hidden_column_count:managed?0:a.hidden_columns.length,rows:managed||a.row_scope!=='own'?'全部授权记录':'仅本人创建记录'},reasons,module_capabilities:(await projectCapabilities(a)).modules,shared_modules:['完整派生计划继承作业源表全部行列读取要求，局部授权仍可使用自己的网格。','项目文件库支持独立增删改查授权；文件夹和文件继承文件库权限，记录附件证据按记录权限读取。','权限来源当前为所有者继承或单条项目授权；尚无多来源授权叠加或显式拒绝。']};
 if(req.query.table_id){const tableId=id.parse(req.query.table_id),t=(await pool.query('SELECT * FROM data_tables WHERE id=$1 AND project_id=$2',[tableId,project])).rows[0];const allowed=!!t&&tableAllowed(a,t);result.table={allowed,write:allowed&&canRecordAction(a,t,"update")&&active&&t.lifecycle==='active',export:allowed&&(managed||a.can_export),visible_columns:allowed?visibleColumns(a,t).map((f:any)=>({id:f.id,name:f.name,readonly:f.lifecycle&&f.lifecycle!=='active'||f.type==='formula'||isSystemField(f)})):[],reason:allowed?'数据表位于当前有效授权范围内。':'当前范围不包含此表，或该表已删除/不属于此项目。'};
 if(req.query.record_id){const r=(await pool.query('SELECT id,table_id,created_by,updated_by,status,lifecycle FROM records WHERE id=$1',[id.parse(req.query.record_id)])).rows[0];const readable=allowed&&!!r&&r.table_id===t.id&&rowAllowed(a,r,user)&&r.lifecycle!=='deleted';result.record={read:readable,write:readable&&result.table.write&&r.lifecycle==='active'&&editableRecord(t,r.status),reason:!readable?'记录不在当前可读范围内。':!editableRecord(t,r.status)?'待审或正式记录不能直接修改，应撤回或发起变更。':r.lifecycle!=='active'?'记录冻结或停用，不能修改。':'记录位于当前范围；写入还受角色及父级生命周期约束。'};}
 }
 res.json(result);
});
