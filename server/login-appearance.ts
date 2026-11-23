import {Router} from 'express';import {z} from 'zod';
import {pool,tx} from './db.ts';import {requireThat,isSystemAdmin} from './auth.ts';
export const publicLoginAppearance=Router(),loginAppearance=Router();
export function validateLoginImage(base64:string,mime:string){
 requireThat(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64),400,'图片编码无效');
 const bytes=Buffer.from(base64,'base64');requireThat(bytes.length>0&&bytes.length<=1048576,400,'登录图片不能超过1MB');let width=0,height=0;
 if(mime==='image/png'){requireThat(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR',400,'图片格式与内容不一致');width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20)}
 else if(mime==='image/jpeg'){requireThat(bytes.length>=4&&bytes[0]===255&&bytes[1]===216,400,'图片格式与内容不一致');let i=2;while(i+4<=bytes.length){if(bytes[i++]!==255)continue;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===218||marker===217)break;if(marker===216||marker>=208&&marker<=215)continue;if(i+2>bytes.length)break;const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)break;if(marker>=192&&marker<=207&&![196,200,204].includes(marker)&&size>=8){height=bytes.readUInt16BE(i+3);width=bytes.readUInt16BE(i+5);break}i+=size;}}
 else requireThat(false,400,'仅支持PNG或JPEG登录图片');
 requireThat(width>0&&height>0&&width<=8000&&height<=8000&&width*height<=16000000,400,'图片尺寸无效或过大');return bytes;
}
const metadata=(r:any)=>({version:r.version,has_image:!!r.has_image,image_url:r.has_image?`/api/login-appearance/image?v=${r.version}`:null});
publicLoginAppearance.get('/login-appearance',async(_req,res)=>{const r=(await pool.query('SELECT version,image_data IS NOT NULL AS has_image FROM app_login_appearance WHERE singleton')).rows[0];res.json(metadata(r));});
publicLoginAppearance.get('/login-appearance/image',async(req,res)=>{const version=z.coerce.number().int().positive().parse(req.query.v);const r=(await pool.query('SELECT image_data,image_mime,version FROM app_login_appearance WHERE singleton')).rows[0];requireThat(r?.image_data&&r.version===version,404,'登录图片已更新或未设置');res.set({'Content-Type':r.image_mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400, immutable','Content-Security-Policy':"default-src 'none'"});res.send(r.image_data);});
loginAppearance.put('/system/login-appearance',async(req,res)=>{requireThat(await isSystemAdmin(req.user.id));const b=z.object({version:z.number().int().positive(),image:z.object({mime:z.enum(['image/png','image/jpeg']),base64:z.string().min(1).max(1398104)}).strict().nullable()}).strict().parse(req.body);const bytes=b.image?validateLoginImage(b.image.base64,b.image.mime):null;
 const result=await tx(async c=>{const r=(await c.query('UPDATE app_login_appearance SET image_data=$1,image_mime=$2,version=version+1,updated_at=now(),updated_by=$3 WHERE singleton AND version=$4 RETURNING version,image_data IS NOT NULL AS has_image',[bytes,b.image?.mime||null,req.user.id,b.version])).rows[0];requireThat(r,409,'登录图片已被其他管理员修改，请刷新后重试');await c.query("INSERT INTO security_events(event,actor_id,outcome) VALUES('login_appearance.update',$1,'success')",[req.user.id]);return metadata(r)});res.json(result);
});
