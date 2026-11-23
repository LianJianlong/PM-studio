import {operationalAlerts} from '../shared/operational-alerts.ts';
import {Router} from 'express';import {statfs} from 'node:fs/promises';import {pool} from './db.ts';import {isSystemAdmin,requireThat} from './auth.ts';import {runtimeSnapshot} from './runtime-metrics.ts';
export const operationsHealth=Router();
operationsHealth.get('/system/operations-health',async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const [sizes,jobs,ai,disk]=await Promise.all([pool.query("SELECT relname,pg_total_relation_size(relid)::text bytes FROM pg_catalog.pg_statio_user_tables WHERE relname IN ('operation_events','audit_log','report_schedule_runs','records','project_files') ORDER BY relname"),pool.query("SELECT status,count(*)::int count,count(*) FILTER(WHERE error IS NOT NULL)::int failed_recent,min(run_at) next_run FROM report_schedules GROUP BY status"),pool.query("SELECT status,count(*)::int count FROM ai_changes WHERE status IN ('executing','unknown') GROUP BY status"),statfs(process.cwd())]);
 const backups=(await pool.query("SELECT status,started_at,finished_at FROM database_backup_runs ORDER BY id DESC LIMIT 1")).rows[0]||null;
 const snapshot=runtimeSnapshot(),diskInfo={total_bytes:disk.blocks*disk.bsize,free_bytes:disk.bavail*disk.bsize};
 res.json({alerts:operationalAlerts(snapshot,diskInfo,jobs.rows,ai.rows),runtime:snapshot,database:{bytes:(await pool.query('SELECT pg_database_size(current_database())::text bytes')).rows[0].bytes,pool:{total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount,max:12},tables:sizes.rows},disk:{total_bytes:disk.blocks*disk.bsize,free_bytes:disk.bavail*disk.bsize},jobs:jobs.rows,ai:ai.rows,last_backup:backups,notes:['这里只读展示备份历史，不改变备份开关、频率或策略。','报表历史和审计尚未自动清理，请依据容量趋势制定归档策略。']});
});
