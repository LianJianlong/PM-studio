import {performanceMetrics} from './performance.ts';import {resourceTicks} from './resource-values.ts';import {workingDateMinutes} from './project-calendar.ts';
export type EvmIssue={severity:'error'|'warning'|'info';message:string;activity_code?:string;activity_name?:string};
export function validateEarnedValueSource(reference:any[],budgets:any,current:any[],calendar:any,start:string,pvAvailable=true){
 const issues:EvmIssue[]=[],ids=new Set<string>(),byId=new Map(current.map(a=>[a.id,a]));
 for(const a of reference){const at={activity_code:a.code,activity_name:a.name};if(ids.has(a.id))issues.push({severity:'error',message:'预算快照存在重复作业，不能重复计算',...at});ids.add(a.id);
  const value=budgets?.[a.id];if(value==null||!Object.hasOwn(budgets||{},a.id))issues.push({severity:'error',message:'基线缺少此作业预算，不能默认为零',...at});
  else if(!/^\d+(\.\d{1,4})?$/.test(String(value)))issues.push({severity:'error',message:'预算金额无效，须为非负精确数值',...at});
  if(a.es==null||a.ef==null||!Number.isFinite(Number(a.es))||!Number.isFinite(Number(a.ef))||Number(a.ef)<Number(a.es)||Number(a.ef)-Number(a.es)>30000)issues.push({severity:'error',message:'预算快照起止时标无效',...at});
  const now=byId.get(a.id);if(!now)issues.push({severity:'error',message:'基线作业不在当前有效范围，需核对预算范围',...at});else if(!Number.isFinite(Number(now.progress))||Number(now.progress)<0||Number(now.progress)>100)issues.push({severity:'error',message:'当前完成率不在0至100范围',...at});
  if(pvAvailable&&value!=null&&/^\d+(\.\d{1,4})?$/.test(String(value))&&resourceTicks(String(value))>0n&&a.es!=null&&a.ef!=null&&Number.isFinite(Number(a.es))&&Number.isFinite(Number(a.ef))&&Number(a.ef)>=Number(a.es)&&Number(a.ef)-Number(a.es)<=30000){
   const minutes=workingDateMinutes(calendar,start,Number(a.es),Number(a.ef));if(!minutes.length&&!(Number(a.duration)===0&&Number(a.es)===Number(a.ef)))issues.push({severity:'error',message:'有预算但没有可分摊的工作时段',...at});
  }
 }
 for(const key of Object.keys(budgets||{}))if(!ids.has(key))issues.push({severity:'error',message:'预算包含不在快照作业范围内的条目'});
 for(const a of current)if(!ids.has(a.id))issues.push({severity:'warning',message:'新增作业未纳入所选预算，当前成本与基线挣值范围需核对',activity_code:a.code,activity_name:a.name});
 return issues;
}
export const eacFormulas:Record<string,string>={cpi:'BAC / CPI',remaining_budget:'AC + (BAC − EV)',cpi_spi:'AC + (BAC − EV) / (CPI × SPI)'};
export function earnedValueMetricChecks(f:any){
 const B=f.bac==null?null:resourceTicks(f.bac),E=f.ev==null?null:resourceTicks(f.ev),A=resourceTicks(f.ac),P=f.pv==null?null:resourceTicks(f.pv),W=B===null||E===null?null:B-E,finished=B!==null&&B>0n&&W===0n;
 const formulas:Record<string,string>={bac:'Σ budget',pv:'Σ time-phased budget ≤ data date',ev:'Σ budget × confirmed progress',ac:'Σ confirmed actual cost',cv:'EV − AC',sv:'EV − PV',cpi:'EV / AC',spi:'EV / PV',eac:finished?'AC':eacFormulas[f.eac_method]||eacFormulas.cpi,etc:'EAC − AC',vac:'BAC − EAC',tcpi:'(BAC − EV) / (BAC − AC)',tcpi_eac:'(BAC − EV) / (EAC − AC)'};
 return Object.entries(formulas).map(([key,formula])=>{const value=f[key]??null;let reason='按当前声明口径计算';if(value===null){reason=f.inputs_valid===false?'基础金额不可用或超出有效范围':'预算或计划价值数据不足';if(key==='cpi'&&A===0n)reason='实际费用为零，成本指数不可计算';if(key==='spi'&&(P===null||P===0n))reason='计划价值缺失或为零，进度指数不可计算';if(['eac','etc','vac','tcpi_eac'].includes(key)&&B!==null&&E!==null&&E===0n&&f.eac_method!=='remaining_budget')reason='没有可用挣值，绩效型预测不可计算';if(['eac','etc','vac','tcpi_eac'].includes(key)&&A===0n&&f.eac_method!=='remaining_budget')reason='实际费用为零，绩效型完工预测缺少成本指数';if(['eac','etc','vac','tcpi_eac'].includes(key)&&f.eac_method==='cpi_spi'&&(P===null||P===0n))reason='计划价值不可用，联合绩效预测缺少SPI';if(['tcpi','tcpi_eac'].includes(key)&&W===0n)reason='没有尚未挣得的预算工作，TCPI不适用';else if(key==='tcpi'&&B!==null&&B<=A)reason='预算余额非正，不能计算达到BAC的尚需绩效';else if(key==='tcpi_eac'&&f.eac!==null&&f.eac!==undefined&&resourceTicks(f.eac)<=A)reason='预测剩余费用非正，不能计算达到EAC的尚需绩效';}else if(finished&&['eac','etc'].includes(key))reason='预算工作已全部挣得，EAC取实际费用且ETC为零';return {key,formula,value,status:value!==null&&f.inputs_valid===false?'invalid':value===null?(W===0n&&key.startsWith('tcpi')?'not_applicable':'unavailable'):'available',reason};});
}
export function earnedValueMethods(f:any){return ['cpi','remaining_budget','cpi_spi'].map(method=>{const value=f.bac!=null&&f.ev!=null?performanceMetrics(f.bac,f.pv,f.ev,f.ac,method):{eac:null,etc:null,vac:null,tcpi_eac:null};return {method,formula:eacFormulas[method],eac:value.eac,etc:value.etc,vac:value.vac,tcpi_eac:value.tcpi_eac,selected:method===f.eac_method};});}
