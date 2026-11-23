import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),file=name=>new URL(name,root);
const pkg=JSON.parse(await readFile(file('package.json'),'utf8')),lock=JSON.parse(await readFile(file('package-lock.json'),'utf8'));let guide=await readFile(file('docs/MANUAL_GUIDE.md'),'utf8');
const args=process.argv.slice(2);
if(args.includes('--check')){
 if(lock.version!==pkg.version||lock.packages[''].version!==pkg.version||!guide.includes(`适用版本：V${pkg.version}。`)||!guide.includes(`## V${pkg.version} ·`))throw Error('版本与使用指南不同步。请先更新使用说明，再运行 npm run release -- --summary "本次更新及使用方法"');
 const html=await readFile(file("docs/MANUAL_GUIDE.html"),"utf8");if(!html.includes(`content="${pkg.version}"`))throw Error("HTML指南版本不一致，请运行node scripts/build-manual.mjs");
 console.log(`Release metadata checked: V${pkg.version}`);
}else{
 const index=args.indexOf('--summary'),summary=index>=0?args[index+1]?.trim():'';
 if(!summary)throw Error('请提供 --summary "本次功能变化、入口和使用方法"');
 const typeIndex=args.indexOf('--type'),type=typeIndex>=0?args[typeIndex+1]:'patch';if(!['patch','minor','major'].includes(type))throw Error('--type必须为patch、minor或major');
 const parts=pkg.version.split('.').map(Number);if(parts.length!==3||parts.some(n=>!Number.isSafeInteger(n)))throw Error('版本格式无效');
 if(type==='major'){parts[0]++;parts[1]=parts[2]=0}else if(type==='minor'){parts[1]++;parts[2]=0}else parts[2]++;
 const version=parts.join('.'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!guide.includes('<!-- release-metadata -->')||!guide.includes('<!-- release-history -->'))throw Error('使用指南缺少发布元数据标记');
 guide=guide.replace(/<!-- release-metadata -->[\s\S]*?<!-- \/release-metadata -->/,`<!-- release-metadata -->\n适用版本：V${version}。更新日期：${date}。\n<!-- /release-metadata -->`).replace('<!-- release-history -->',`<!-- release-history -->\n\n## V${version} · ${date}\n\n${summary}\n`);
 pkg.version=lock.version=lock.packages[''].version=version;
 await writeFile(file('package.json'),JSON.stringify(pkg,null,2)+'\n');await writeFile(file('package-lock.json'),JSON.stringify(lock,null,2)+'\n');await writeFile(file('docs/MANUAL_GUIDE.md'),guide);
 await import("./build-manual.mjs");
 console.log(`Prepared V${version}: package, lockfile and manual updated. Build and validate before deployment.`);
}
