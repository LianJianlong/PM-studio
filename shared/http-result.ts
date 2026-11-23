/** Never render raw proxy HTML or treat an unparseable write response as a confirmed failure. */
export async function apiResult<T=unknown>(response:Response,method='GET'):Promise<T>{
 if(response.status===204&&response.ok)return null as T;
 let result:any;
 try{result=await response.json()}catch{
  if(response.status===401)throw Error('登录已失效，请重新登录');
  if(response.status===403)throw Error('没有执行此操作的权限');
  if(response.status===429)throw Error('操作频率或并发过高，请稍后重试');
  if(!['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))throw Error('响应异常，操作结果待核实。请刷新检查数据，勿重复提交');
  throw Error(response.status>=500?'服务暂时不可用，请稍后重试':'服务器响应格式异常，请刷新重试');
 }
 if(!response.ok)throw Error(typeof result?.error==='string'?result.error:'请求失败');
 return result as T;
}
