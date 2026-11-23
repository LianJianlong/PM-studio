type Position={workspaceId:string;projectId:string;page:string};
const storageKey=(user:string)=>`project-studio:navigation:v1:${user}`;
export function readNavigation(user:string):Position|undefined{
 try{
  const raw=sessionStorage.getItem(storageKey(user));
  if(!raw||raw.length>1000)return;
  const value=JSON.parse(raw);
  if(typeof value?.workspaceId==='string'&&typeof value.projectId==='string'&&typeof value.page==='string')return value;
 }catch{}
}
export function rememberNavigation(user:string,value:Position){
 try{sessionStorage.setItem(storageKey(user),JSON.stringify(value));}catch{}
}
