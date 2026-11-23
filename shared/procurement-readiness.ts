/** Arrival is evidence of supply progress, never proof of installation readiness. */
export function confirmedInstallationReadiness(evidence:{kind:string;date:string;basis?:string}[]){
 const confirmed=evidence.filter(x=>x.kind==='confirmed'&&x.basis?.trim());
 const dates=[...new Set(confirmed.map(x=>x.date))];
 if(dates.length===1)return {date:dates[0],basis:confirmed.map(x=>x.basis).join('；'),missing:[] as string[]};
 return {date:'',basis:'',missing:[dates.length>1?'关联记录给出多个不同就绪日期，需明确对应供货批次':'缺少带确认依据的安装就绪日期；预计或实际到货不能直接当作可安装日期']};
}
