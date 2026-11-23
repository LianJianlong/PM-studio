import pg from 'pg';
import mysql from 'mysql2/promise';
import {connect as connectSocket} from 'node:net';
import {validateEndpoint,resolveTarget} from './outbound.ts';
import {requireRemoteDatabase} from '../shared/database-target.ts';
import {requireThat,HttpError} from './auth.ts';
import type {z} from 'zod';
import {storageTargetBody} from '../shared/storage-target.ts';
type Config=z.infer<typeof storageTargetBody>;
type Dependencies={resolve?:typeof resolveTarget;postgres?:(options:any)=>any;mysql?:(options:any)=>Promise<any>};
export async function probeDatabase(config:Config,scope:'storage'|'query',dependencies:Dependencies={}){
 const target=validateEndpoint(config.host,'database',config.tls);
 const resolved=await (dependencies.resolve||resolveTarget)(target.host,target.local);
 if(scope==='query')requireRemoteDatabase(resolved.address,config.user);
 else requireThat(!['postgres','root','mac'].includes(config.user.toLowerCase()),403,'\u8bf7\u4f7f\u7528\u975e\u7cfb\u7edf\u7279\u6743\u7684\u6570\u636e\u5e93\u8d26\u53f7\u6d4b\u8bd5');
 const start=performance.now();
 try{
  let databases:string[]=[],schemas:string[]=[],database=config.database,selectedSchema=config.engine==='mysql'?config.database:config.schema||'public';
  if(config.engine==='postgres'){
   const options={host:resolved.address,port:config.port,database:config.database,user:config.user,password:config.password||'',ssl:config.tls?{rejectUnauthorized:true,servername:target.host}:false,connectionTimeoutMillis:7000,statement_timeout:4000,query_timeout:5000,options:'-c default_transaction_read_only=on',application_name:'project_studio_connection_test'};
   const client=dependencies.postgres?dependencies.postgres(options):new pg.Client(options);
   try{await client.connect();await client.query('BEGIN READ ONLY');
    const identity=(await client.query("SELECT current_database() AS database,EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) AS privileged")).rows[0];
    requireThat(!identity.privileged,403,'\u8bf7\u4f7f\u7528\u975e\u7cfb\u7edf\u7279\u6743\u7684\u6570\u636e\u5e93\u8d26\u53f7\u6d4b\u8bd5');database=identity.database;
    databases=(await client.query("SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(current_user,oid,'CONNECT') ORDER BY datname LIMIT 100")).rows.map((r:any)=>r.name);
    schemas=(await client.query("SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name<>'information_schema' ORDER BY schema_name LIMIT 200")).rows.map((r:any)=>r.name);
    await client.query('ROLLBACK');
   }finally{await client.end().catch(()=>{})}
  }else{
   const options={host:target.host,port:config.port,database:config.database,user:config.user,password:config.password||'',stream:()=>connectSocket({host:resolved.address,port:config.port}),ssl:config.tls?{rejectUnauthorized:true,verifyIdentity:true}:undefined,connectTimeout:7000,multipleStatements:false};
   const client=await (dependencies.mysql||mysql.createConnection)(options);
   try{await client.query({sql:'START TRANSACTION READ ONLY',timeout:5000});
    const [rows]=await client.query({sql:'SHOW DATABASES',timeout:5000});databases=rows.slice(0,100).map((r:any)=>String(Object.values(r)[0]));schemas=[config.database];await client.rollback();
   }finally{await client.end()}
  }
  return {connected:true,read_only:true,activated:false,database,schema:selectedSchema,schema_exists:schemas.includes(selectedSchema),databases,schemas,duration_ms:Math.round(performance.now()-start)};
 }catch(e){if(e instanceof HttpError)throw e;const code=String((e as any)?.code||'');
  const message=['28P01','28000','ER_ACCESS_DENIED_ERROR'].includes(code)?'\u8ba4\u8bc1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7528\u6237\u540d\u3001\u5bc6\u7801\u53ca\u8d26\u53f7\u767b\u5f55\u6743\u9650':code==='3D000'||code==='ER_BAD_DB_ERROR'?'\u6570\u636e\u5e93\u4e0d\u5b58\u5728\u6216\u65e0\u6743\u8bbf\u95ee\uff0c\u8bf7\u68c0\u67e5\u5e93\u540d':code==='ECONNREFUSED'?'\u8fde\u63a5\u88ab\u62d2\u7edd\uff0c\u8bf7\u68c0\u67e5\u5730\u5740\u3001\u7aef\u53e3\u53ca\u6570\u636e\u5e93\u670d\u52a1':code==='42501'?'\u6570\u636e\u5e93\u8d26\u53f7\u6743\u9650\u4e0d\u8db3':'\u6d4b\u8bd5\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u3001TLS\u8bc1\u4e66\u53ca\u8d85\u65f6\u8bbe\u7f6e';
  throw new HttpError(400,message);
 }
}
