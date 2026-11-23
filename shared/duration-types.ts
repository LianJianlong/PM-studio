import {durationTypes} from './p6-planning.ts';
import {resourceTicks,resourceText,resourceValue,resourceUnits,resourceCost} from './resource-values.ts';
export type DurationType=typeof durationTypes[number];
export const durationInputs:Record<DurationType,readonly string[]>={
 '固定工期和投入率':['duration','rate'], '固定工期和工作量':['duration','units'],
 '固定投入率':['duration','units'], '固定工作量':['duration','rate'],
};
const scale=100000000n;
const round=(a:bigint,b:bigint)=>(a+b/2n)/b;
// U = q × D. Resource quantities and monetary amounts remain exact decimals.
export function durationLink(input:{type:DurationType;driver:string;value:string;duration:number;hoursPerDay:number;target:string;allocations:{id:string;quantity:string;rate:string}[]}){
 const {type,driver,hoursPerDay}=input;
 if(!durationInputs[type]?.includes(driver))throw Error('此工期类型不支持所选调整项');
 if(!Number.isInteger(hoursPerDay)||hoursPerDay<1||hoursPerDay>24||!Number.isFinite(input.duration)||input.duration<=0)throw Error('联动需要正数工期和整数项目日工时');
 const selected=input.allocations.find(a=>a.id===input.target);if(!selected)throw Error('请选择已分配的资源');
 const val=resourceTicks(resourceValue(input.value,'1000000000000'));if(val<=0n)throw Error('联动输入须大于0');
 const oldD=BigInt(Math.round(input.duration*1e8));let hours=Math.ceil(input.duration*hoursPerDay-1e-7),newD=oldD,rounded=false;
 const selectedQ=resourceTicks(selected.quantity);
 if(driver==='duration'){if(val%10000n)throw Error('工期输入须为整数工作小时');hours=Number(val/10000n);newD=BigInt(Math.round(hours/hoursPerDay*1e8));}
 else if(type==='固定工作量'||driver==='units'&&type==='固定投入率'){
  const numerator=driver==='rate'?selectedQ*oldD*BigInt(hoursPerDay):val*scale*BigInt(hoursPerDay);
  const denominator=driver==='rate'?val*scale:selectedQ*scale;
  if(denominator<=0n)throw Error('原投入率为0，不能按固定投入率计算工期');
  rounded=numerator%denominator!==0n;hours=Number((numerator+denominator-1n)/denominator);newD=BigInt(Math.round(hours/hoursPerDay*1e8));
 }
 if(!Number.isSafeInteger(hours)||hours<1||newD>3650n*scale)throw Error('联动工期须为1小时至3650工作日');
 const duration=Number(newD)/1e8,fixedUnits=type==='固定工作量'||type==='固定工期和工作量';
 const rows=input.allocations.map(a=>{
  const beforeQ=resourceTicks(a.quantity);let q=fixedUnits?round(beforeQ*oldD,newD):beforeQ;
  if(a.id===input.target){if(driver==='units')q=type==='固定投入率'?beforeQ:round(val*scale,newD);else if(driver==='rate')q=type==='固定工作量'?round(beforeQ*oldD,newD):val;}
  const quantity=resourceValue(resourceText(q),'1000000000000');
  return {...a,before_quantity:a.quantity,quantity,before_units:resourceUnits(a.quantity,String(input.duration)),units:resourceUnits(quantity,String(duration)),planned_cost:resourceCost(quantity,a.rate,String(duration))};
 });
 return {type,driver,working_hours:hours,duration,rows,rounded};
}
