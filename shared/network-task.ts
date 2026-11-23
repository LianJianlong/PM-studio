export const networkTaskTypes=['任务','开始里程碑','完成里程碑','虚工作'] as const;
export const networkTaskStates=['未开始','进行中','已完成'] as const;
export function networkTaskValue(value:any,hoursPerDay:number){
 const type=value.activity_type||'任务',status=value.network_status||(Number(value.progress)>=100?'已完成':Number(value.progress)>0?'进行中':'未开始');
 if(!(networkTaskTypes as readonly string[]).includes(type))throw Error('请选择有效网络作业类型');
 if(!(networkTaskStates as readonly string[]).includes(status))throw Error('请选择有效作业状态');
 const event=type!=='任务',duration=event?0:Number(value.duration),progress=status==='已完成'?100:status==='未开始'?0:Number(value.progress||0);
 if(!Number.isFinite(duration)||duration<0||duration>3650||hoursPerDay>0&&Math.abs(duration*hoursPerDay-Math.round(duration*hoursPerDay))>1e-6)throw Error('工期最小单位为整数工作小时');
 if(event&&status==='进行中')throw Error('里程碑和虚工作不能设置为进行中');
 if(!Number.isFinite(progress)||progress<0||progress>100||status==='进行中'&&progress>=100)throw Error('进行中作业的完成率须小于100%');
 return {...value,activity_type:type==='虚工作'?'任务':type,is_dummy:type==='虚工作',network_status:status,duration,progress};
}
