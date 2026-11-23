import type pg from 'pg';import {pool} from './db.ts';import {canManage,canWrite,operationAllowed} from './auth.ts';import {canReadFullPlan} from './planning-read-access.ts';
export async function projectCapabilities(a:any,c:pg.Pool|pg.PoolClient=pool){
 const active=a.lifecycle==='active'&&a.workspace_lifecycle==='active',full=await canReadFullPlan(a,c);
 const actions=(key:string)=>Object.fromEntries(['read','create','update','delete'].map(action=>[action,operationAllowed(a,key,action as any)&&(action==='read'||active)]));
 const data=actions('$data'),files=actions('$files');
 return {project_id:a.id,active,role:a.role,modules:[
 {key:'data',name:'数据录入',...data,reason:!data.read?'没有数据读取权限':!active?'项目或工作空间非活动，禁止写入':'逐表、逐列和本人行授权继续生效'},
 {key:'planning',name:'完整计划与资源费用',read:full,create:full&&active&&operationAllowed(a,'$data','create'),update:full&&active&&operationAllowed(a,'$data','update'),delete:full&&active&&operationAllowed(a,'$data','delete'),reason:full?'具备完整作业源读取权':'完整派生图需要作业表全部行列读取权；已授权网格仍可使用'},
 {key:'files',name:'项目文件',...files,reason:files.read?'文件操作遵循文件库独立授权':'没有文件库读取权限'},
 {key:'toolbox',name:'工具箱',...data,reason:'图纸和笔记按对应增删改查能力检查，离线计算工具不写业务数据'},
 {key:'reports',name:'报表中心',read:true,create:active&&(canManage(a)||a.can_export),update:active&&(canManage(a)||a.can_export),delete:active&&canManage(a),reason:'报表数据继承源表权限；编辑还需检查报表所有者'},
 {key:'ai',name:'AI助手',read:true,create:active&&canWrite(a),update:active&&canWrite(a),delete:active&&canWrite(a),reason:'这里只表示可请求拟定方案；实际操作逐项复用源对象权限并最终预览确认'},
 {key:'management',name:'项目管理设置',read:canManage(a),create:active&&canManage(a),update:active&&canManage(a),delete:active&&canManage(a),reason:canManage(a)?'项目管理角色':'需要项目管理员权限'}]};
}
