import {Router} from 'express';
import {z} from 'zod';
import type pg from 'pg';
import {pool,uid,audit,tx} from './db.ts';
import {access,operationAllowed,requireThat,type CrudAction} from './auth.ts';
export const drawingBoards=Router();
const uuid=z.string().uuid();
const drawingBody=z.object({name:z.string().trim().min(1).max(120),xml:z.string().max(5*1024*1024).refine(v=>/^\s*<(?:\?xml|mxfile|mxGraphModel)/.test(v)&&!/<!(?:DOCTYPE|ENTITY)/i.test(v),'无效draw.io文件'),version:z.number().int().positive().optional()});
const noteBody=z.object({name:z.string().trim().min(1).max(120),content:z.string().max(200000),version:z.number().int().positive().optional()});
async function permission(user:string,project:string,action:CrudAction='read',c:pg.Pool|pg.PoolClient=pool){
 const a=await access(user,project,c);
 requireThat(operationAllowed(a,'$data','read')&&operationAllowed(a,'$data',action));
 if(action!=='read')requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目不可编辑');
 return a;
}
drawingBoards.get('/projects/:project/toolbox-permissions',async(req,res)=>{
 const a=await permission(req.user.id,uuid.parse(req.params.project));
 const writable=a.lifecycle==='active'&&a.workspace_lifecycle==='active';
 res.json({read:true,create:writable&&operationAllowed(a,'$data','create'),update:writable&&operationAllowed(a,'$data','update'),delete:writable&&operationAllowed(a,'$data','delete')});
});
drawingBoards.get('/projects/:project/drawing-boards',async(req,res)=>{await permission(req.user.id,uuid.parse(req.params.project));res.json((await pool.query('SELECT id,name,version,updated_at FROM drawing_boards WHERE project_id=$1 ORDER BY updated_at DESC',[req.params.project])).rows)});
drawingBoards.get('/projects/:project/drawing-boards/:id',async(req,res)=>{await permission(req.user.id,uuid.parse(req.params.project));const row=(await pool.query('SELECT * FROM drawing_boards WHERE id=$1 AND project_id=$2',[uuid.parse(req.params.id),req.params.project])).rows[0];requireThat(row,404,'画板不存在');res.json(row)});
drawingBoards.post('/projects/:project/drawing-boards',async(req,res)=>{
 const project=uuid.parse(req.params.project),b=drawingBody.parse(req.body);
 const result=await tx(async c=>{const a=await permission(req.user.id,project,'create',c),id=uid();await c.query('INSERT INTO drawing_boards(id,project_id,name,xml,created_by) VALUES($1,$2,$3,$4,$5)',[id,a.id,b.name,b.xml,req.user.id]);await audit(c,a.workspace_id,req.user.id,'drawing.create',id,{name:b.name});return {id,version:1}});res.json(result);
});
drawingBoards.put('/projects/:project/drawing-boards/:id',async(req,res)=>{
 const project=uuid.parse(req.params.project),id=uuid.parse(req.params.id),b=drawingBody.parse(req.body);requireThat(b.version,400,'缺少版本');
 const result=await tx(async c=>{const a=await permission(req.user.id,project,'update',c);const row=(await c.query('UPDATE drawing_boards SET name=$3,xml=$4,version=version+1,updated_at=now() WHERE id=$1 AND project_id=$2 AND version=$5 RETURNING id,version',[id,a.id,b.name,b.xml,b.version])).rows[0];requireThat(row,409,'画板已被更新，请重新打开');await audit(c,a.workspace_id,req.user.id,'drawing.update',row.id,{name:b.name,version:row.version});return row});res.json(result);
});
drawingBoards.get('/projects/:project/toolbox-notes',async(req,res)=>{await permission(req.user.id,uuid.parse(req.params.project));res.json((await pool.query('SELECT id,name,version,updated_at FROM toolbox_notes WHERE project_id=$1 ORDER BY updated_at DESC',[req.params.project])).rows)});
drawingBoards.get('/projects/:project/toolbox-notes/:id',async(req,res)=>{await permission(req.user.id,uuid.parse(req.params.project));const row=(await pool.query('SELECT * FROM toolbox_notes WHERE id=$1 AND project_id=$2',[uuid.parse(req.params.id),req.params.project])).rows[0];requireThat(row,404,'笔记不存在');res.json(row)});
drawingBoards.post('/projects/:project/toolbox-notes',async(req,res)=>{
 const project=uuid.parse(req.params.project),b=noteBody.parse(req.body);
 const result=await tx(async c=>{const a=await permission(req.user.id,project,'create',c),id=uid();await c.query('INSERT INTO toolbox_notes(id,project_id,name,content,created_by) VALUES($1,$2,$3,$4,$5)',[id,a.id,b.name,b.content,req.user.id]);await audit(c,a.workspace_id,req.user.id,'note.create',id,{name:b.name});return {id,version:1}});res.json(result);
});
drawingBoards.put('/projects/:project/toolbox-notes/:id',async(req,res)=>{
 const project=uuid.parse(req.params.project),id=uuid.parse(req.params.id),b=noteBody.parse(req.body);requireThat(b.version,400,'缺少版本');
 const result=await tx(async c=>{const a=await permission(req.user.id,project,'update',c);const row=(await c.query('UPDATE toolbox_notes SET name=$3,content=$4,version=version+1,updated_at=now() WHERE id=$1 AND project_id=$2 AND version=$5 RETURNING id,version',[id,a.id,b.name,b.content,b.version])).rows[0];requireThat(row,409,'笔记已被更新，请重新打开');await audit(c,a.workspace_id,req.user.id,'note.update',row.id,{name:b.name,version:row.version});return row});res.json(result);
});
drawingBoards.delete('/projects/:project/toolbox-notes/:id',async(req,res)=>{
 const project=uuid.parse(req.params.project),id=uuid.parse(req.params.id),version=z.number().int().positive().parse(req.body.version);
 await tx(async c=>{const a=await permission(req.user.id,project,'delete',c);const row=(await c.query('DELETE FROM toolbox_notes WHERE id=$1 AND project_id=$2 AND version=$3 RETURNING id,name',[id,a.id,version])).rows[0];requireThat(row,409,'笔记已被更新，请重新打开');await audit(c,a.workspace_id,req.user.id,'note.delete',row.id,{name:row.name})});res.json({ok:true});
});
