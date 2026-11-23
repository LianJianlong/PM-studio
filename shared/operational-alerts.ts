export function operationalAlerts(runtime:any,disk:{free_bytes:number;total_bytes:number},jobs:any[],ai:any[]){const out:string[]=[];
 if(disk.total_bytes>0&&disk.free_bytes/disk.total_bytes<.1)out.push('磁盘可用空间低于10%，请检查容量');
 if(runtime.window>=100&&runtime.server_errors/runtime.window>.01)out.push('近期请求的服务器错误超过1%，请排查');
 if(runtime.queries?.slow>0)out.push('检测到慢查询，请结合连接池和负载趋势排查');
 if(jobs.some(j=>j.status==='failed'||Number(j.failed_recent)>0))out.push('存在报表生成失败，请查看任务运行历史');
 if(ai.some(j=>Number(j.count)>0))out.push('存在待核实AI结果，请到AI助手核实，勿重复提交');
 if(runtime.models?.timeouts>0)out.push('近期有模型超时，请检查模型服务和网络');
 return out;
}
