import {initialize,pool} from './db.ts';
if(process.env.RUN_MIGRATIONS!=='true')throw Error('迁移必须由独立初始化任务运行');
await initialize();await pool.end();
