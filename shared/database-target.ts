// User-configured SQL connections must never reach host services or privileged accounts.
export function requireRemoteDatabase(address:string,user:string){
 const ip=address.toLowerCase();
 if(ip==='::1'||ip.startsWith('127.')||ip.startsWith('::ffff:127.')||['mac','postgres','root','studio_app','studio_analytics'].includes(user.toLowerCase())){
 const error=Object.assign(new Error('禁止通过外部数据库连接访问本机服务或使用系统特权账号'),{status:403});throw error;
 }
}
