// Explicit test-run credentials override only the known administrator login.
// Do not log credentials or alter credentials for temporary test accounts.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (process.env.QA_ADMIN_PASSWORD && String(url).endsWith('/api/login') && typeof options?.body === 'string') {
    const body = JSON.parse(options.body);
    if (body.username === 'admin') {const username=process.env.QA_ADMIN_USERNAME||'admin';options = { ...options, body: JSON.stringify({ ...body, username, password:username==='superadmin'?(process.env.QA_SYSTEM_PASSWORD||process.env.QA_ADMIN_PASSWORD):process.env.QA_ADMIN_PASSWORD }) };}
    if(body.username==='superadmin'&&process.env.QA_SYSTEM_PASSWORD)options={...options,body:JSON.stringify({...body,password:process.env.QA_SYSTEM_PASSWORD})};
  }
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetchOriginal(url,options);
    if(response.status!==429)return response;
    const data=await response.clone().json().catch(()=>null);
    if(data?.error!=='操作频率过高，请稍后重试'||attempt===2)return response;
    const seconds=Math.min(60,Math.max(1,Number(response.headers.get('retry-after'))||1));
    await new Promise(resolve=>setTimeout(resolve,seconds*1000));
  }
};
