import {dashboardSpecifications} from '../shared/dashboard-defaults.ts';
import type pg from 'pg';
export async function configureStandardDashboard(c:pg.PoolClient,project:string,ids:Record<string,string>,force=false){
 const standard=dashboardSpecifications(ids);
 for(const w of standard){if(!w.config.mappingId)continue;const config={metric:'__count__',aggregation:'count',status:'approved',displayMode:'default',templateKey:'overview-v1',...w.config};await c.query("INSERT INTO project_dashboard_widgets(project_id,kind,name,config,position) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,kind) WHERE kind<>'custom' DO UPDATE SET name=EXCLUDED.name,config=EXCLUDED.config,position=EXCLUDED.position,version=project_dashboard_widgets.version+1 WHERE $6 OR project_dashboard_widgets.config='{}'::jsonb",[project,w.kind,w.name,JSON.stringify(config),w.position,force]);}
 await c.query("DELETE FROM project_dashboard_widgets WHERE project_id=$1 AND kind='custom' AND config->>'templateKey' IN ('overview-safety-risk','overview-quality-issues','overview-material-arrivals')",[project]);
}
