import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {backupDirectory} from '../server/security-console.ts';
test('backup targets reject shared writable directories and accept owner-controlled directories',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-backup-permissions-'));
 try{await fs.chmod(dir,0o777);if(process.platform!=='win32')await assert.rejects(backupDirectory(dir),/写权限/);await fs.chmod(dir,0o700);assert.equal(await backupDirectory(dir),await fs.realpath(dir));await assert.rejects(backupDirectory(process.cwd()),/软件文件夹之外/)}finally{await fs.rm(dir,{recursive:true,force:true})}
});
