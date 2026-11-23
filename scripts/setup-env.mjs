import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
const hex=n=>randomBytes(n).toString('hex');
for(const file of ['.env','.env.migrate','secrets/initial-accounts.txt']) {
  try {await fs.access(file);throw new Error('Existing configuration preserved; move it explicitly before generating a fresh installation.');}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
const db=hex(24),app=hex(24),admin=hex(24),system=hex(24),key=hex(32);
const common=`ENCRYPTION_KEY=${key}\nSEED_DEMO=false\n`;
await fs.mkdir('secrets',{recursive:true,mode:0o700});
await fs.writeFile('.env',`DB_PASSWORD=${db}\nAPP_DB_PASSWORD=${app}\nADMIN_PASSWORD=${admin}\nSYSTEM_ADMIN_PASSWORD=${system}\nDATABASE_URL=postgresql://studio_app:${app}@127.0.0.1:5432/project_studio\nPORT=9090\nHOST=127.0.0.1\nCOOKIE_SECURE=false\n${common}`,{mode:0o600,flag:'wx'});
await fs.writeFile('.env.migrate',`RUN_MIGRATIONS=true\nDATABASE_URL=postgresql://studio:${db}@127.0.0.1:5432/project_studio\nAPP_DB_PASSWORD=${app}\nADMIN_PASSWORD=${admin}\nSYSTEM_ADMIN_PASSWORD=${system}\n${common}`,{mode:0o600,flag:'wx'});
await fs.writeFile('secrets/initial-accounts.txt',`New installation only\nadmin: ${admin}\nsuperadmin: ${system}\nChange passwords after first login. Never publish this file or .env files.\n`,{mode:0o600,flag:'wx'});
console.log('Generated private configuration and secrets/initial-accounts.txt. No secrets printed.');

