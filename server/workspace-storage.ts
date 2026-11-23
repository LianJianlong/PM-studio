import {Router} from 'express';
import {pool,tx,uid} from './db.ts';
import {isSystemAdmin,requireThat} from './auth.ts';
import {encrypt,decrypt} from './security.ts';
import {id} from './validation.ts';
import {storageTargetBody,storageTargetEdit,databaseProbeBody} from '../shared/storage-target.ts';
import {probeDatabase} from './database-probe.ts';
import {rateLimit} from 'express-rate-limit';
import {requestBudget} from './request-budget.ts';
export const workspaceStorage=Router();
const primary={id:null,name:'\u5f53\u524d\u672c\u673a PostgreSQL',engine:'postgres',state:'active'};
workspaceStorage.post('/storage-targets/test',rateLimit({windowMs:60000,limit:8,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'\u6d4b\u8bd5\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'}}),requestBudget(4,1),async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const body=databaseProbeBody.parse(req.body);let password=body.password;
 if(body.target_id){const old=(await pool.query('SELECT * FROM storage_targets WHERE id=$1',[body.target_id])).rows[0];requireThat(old,404,'Storage target not found');requireThat(old.version===body.version,409,'Configuration changed; reopen it before testing');
  if(password===undefined){const saved=decrypt(old.config_cipher);requireThat(['host','port','engine','user','tls'].every(key=>saved[key]===body[key as keyof typeof body]),400,'\u8fde\u63a5\u5730\u5740\u6216\u8d26\u53f7\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\u5bc6\u7801\u540e\u6d4b\u8bd5');password=saved.password;}
 }
 res.json(await probeDatabase({...body,password},'storage'));
});
workspaceStorage.get('/storage-targets',async(req,res)=>{
 const admin=await isSystemAdmin(req.user.id);
 const targets=admin?(await pool.query("SELECT id,name,engine,version,'reserved' AS state,(SELECT count(*)::int FROM workspaces w WHERE w.storage_target_id=t.id) AS workspace_count FROM storage_targets t ORDER BY created_at,id")).rows:[];
 res.json({targets:[primary,...targets],can_manage:admin,remote_activation_supported:false});
});
workspaceStorage.get('/storage-targets/:target',async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));
 const row=(await pool.query('SELECT * FROM storage_targets WHERE id=$1',[id.parse(req.params.target)])).rows[0];requireThat(row,404,'Storage target not found');
 const {password,...config}=decrypt(row.config_cipher);
 res.json({...config,id:row.id,name:row.name,engine:row.engine,version:row.version,state:'reserved',has_password:!!password});
});
async function event(c:any,actor:string,action:string,target:string){await c.query("INSERT INTO security_events(event,actor_id,outcome) VALUES($1,$2,'success')",[action+':'+target,actor]);}
workspaceStorage.post('/storage-targets',async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const body=storageTargetBody.parse(req.body),target=uid();
 await tx(async c=>{await c.query('INSERT INTO storage_targets(id,name,engine,config_cipher,created_by) VALUES($1,$2,$3,$4,$5)',[target,body.name,body.engine,encrypt(body),req.user.id]);await event(c,req.user.id,'storage_target.create',target)});
 res.status(201).json({id:target,version:1,state:'reserved',connected:false});
});
workspaceStorage.put('/storage-targets/:target',async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const target=id.parse(req.params.target),body=storageTargetEdit.parse(req.body);
 const result=await tx(async c=>{const old=(await c.query('SELECT * FROM storage_targets WHERE id=$1 FOR UPDATE',[target])).rows[0];requireThat(old,404,'Storage target not found');requireThat(old.version===body.version,409,'Configuration changed; reopen it before editing');const {version,...config}=body;
 const saved=decrypt(old.config_cipher);if(body.password===undefined&&saved.password)requireThat(['host','port','engine','user','tls'].every(key=>saved[key]===body[key as keyof typeof body]),400,'\u8fde\u63a5\u5730\u5740\u6216\u8d26\u53f7\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u8f93\u5165\u5bc6\u7801');
 const password=body.password===undefined?saved.password:body.password;
 const row=(await c.query('UPDATE storage_targets SET name=$1,config_cipher=$2,engine=$4,version=version+1,updated_at=now() WHERE id=$3 RETURNING version',[body.name,encrypt({...config,password}),target,body.engine])).rows[0];await event(c,req.user.id,'storage_target.update',target);return row});
 res.json({id:target,...result,state:'reserved',connected:false});
});
workspaceStorage.delete('/storage-targets/:target',async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const target=id.parse(req.params.target),version=idVersion(req.body);
 await tx(async c=>{const row=(await c.query('SELECT id,version FROM storage_targets WHERE id=$1 FOR UPDATE',[target])).rows[0];requireThat(row,404,'Storage target not found');requireThat(row.version===version,409,'Configuration changed; refresh first');requireThat(!(await c.query('SELECT 1 FROM workspaces WHERE storage_target_id=$1 LIMIT 1',[target])).rowCount,409,'This storage target is assigned to a workspace');await c.query('DELETE FROM storage_targets WHERE id=$1',[target]);await event(c,req.user.id,'storage_target.delete',target)});res.json({ok:true});
});
import {z} from 'zod';
function idVersion(body:unknown){return z.object({version:z.number().int().positive()}).strict().parse(body).version}
