import {dashboardSpecifications} from '../shared/dashboard-defaults.ts';
import {writeFile} from 'node:fs/promises';
import {constructionProfiles,constructionSystems,constructionSpecs,constructionSources,type ConstructionProfile} from '../shared/construction-catalog.ts';
import {tableSpecs,reportSpecs} from '../shared/business-catalog.ts';
export async function exportConstructionBlueprints(base:any,path:string){
 const ids=Object.fromEntries([...base.tables.map((t:any)=>t.key),'wbs','organization','activities','stock_balance',...base.sharedViews.map((v:any)=>v.key)].map(key=>[key,key]));
 let md='\n## 工程建设行业模板（二版）\n\n新建项目可选择通用公共建筑、医院、体育场。行业目录仅预置专业、子系统、材料设备名称、建议单位、工序及检验提示，不代表已施工、已采购或已验收；不填写工程量、价格、人数、设备型号或实际检测数值。业务台账从空表开始。\n\n日报采用主表＋施工、人工、机械、材料明细；周报、双周报、月报读取对应周期主表和日报发生量，另附滚动计划与开工条件。工程量按专业／子系统／楼栋分区／楼层／工序／单位分组，禁止跨单位相加、禁止重复累计。人工只汇总人工投入明细，人数标为人次。\n\n报表支持原始明细表，最多12列、100条，按创建时间倒序；页面、PDF和Excel显示相同范围，缩小日期范围可查看其余记录。修改共享模板前建议复制；自动升级保留已修改的原模板。\n\n';
 for(const profile of Object.keys(constructionProfiles) as ConstructionProfile[]){const variant={...base,overview:dashboardSpecifications(ids),version:2,profile,profileName:constructionProfiles[profile],nativeTables:base.nativeTables.map((t:any)=>['wbs','activities'].includes(t.key)?{...t,fields:[...t.fields,...constructionSpecs(tableSpecs,profile).find(s=>s.key==='daily')!.fields.filter(f=>['discipline','subsystem','system_ref'].includes(f.id))]}:t),tables:constructionSpecs(tableSpecs,profile),dictionary:constructionSystems(profile),reports:reportSpecs(ids,'{{项目名称}}','{{项目本币}}',profile),sources:constructionSources};await writeFile(path.replace(/\.json$/,'-'+profile+'.json'),JSON.stringify(variant,null,2),{mode:0o600});if(profile==='generic')await writeFile(path,JSON.stringify(variant,null,2),{mode:0o600});
  md+='### '+constructionProfiles[profile]+'\n\n';
  for(const s of constructionSystems(profile))md+='- **'+s.discipline+'／'+s.name+'**：'+s.work+'。材料设备：'+s.materials.map(m=>m[0]+'（'+m[1]+'）').join('、')+'。检验提示：'+s.checks+'。\n';md+='\n';
 }
 return md+'行业分类参考：'+constructionSources.map(s=>s.title+' '+s.url).join('；')+'。具体技术参数和验收准则按项目批准设计、合同及适用标准填写。\n';
}
