import {translateUiValue as ui} from './i18n';
export function safePersonPhoto(value:unknown){
 if(typeof value!=='string')return undefined;
 if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)&&value.length<=10000)return value;
 if(/^\/api\/files\/[a-f0-9-]+\/(?:download|content)(?:\?[A-Za-z0-9=&%-]*)?$/.test(value))return value;
 return undefined;
}
export async function thumbnail(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>=5*1024*1024)throw Error(ui('请选择小于5MB的PNG、JPEG或WebP照片'));
 const bitmap=await createImageBitmap(file);
 try{
  for(const [size,quality] of [[160,.75],[128,.65],[96,.5],[64,.5]]){
   const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
   const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,size,size);
   const side=Math.min(bitmap.width,bitmap.height);
   context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);
   const value=canvas.toDataURL('image/jpeg',quality);
   if(value.length<=9500)return value;
  }
  throw Error(ui('照片压缩失败，请换一张较小的图片'));
 }finally{bitmap.close()}
}
