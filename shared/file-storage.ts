export const MAX_FILE_BYTES=5*1024*1024;
export function normalizeStorageLink(input:string){
 let value=input.trim();if(!value||value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw Error('请填写有效的HTTP、HTTPS或SMB存储链接');
 if(value.startsWith('\\\\'))value='smb://'+value.slice(2).split('\\').map(encodeURIComponent).join('/');
 let url:URL;try{url=new URL(value)}catch{throw Error('存储链接格式无效')}
 if(!['https:','http:','smb:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw Error('仅支持HTTP、HTTPS、SMB链接或UNC共享路径，地址不能包含账号密码');
 return url.href;
}
