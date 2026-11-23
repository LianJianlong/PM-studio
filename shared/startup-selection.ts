type Workspace={id:string;lifecycle?:string};
type Project={id:string;workspace_id:string;lifecycle?:string};
export function startupSelection(workspaces:Workspace[],projects:Project[],defaults:{workspace_id?:string|null;project_id?:string|null}={},current?:{workspaceId:string;projectId:string}){
 const activeWorkspaces=workspaces.filter(w=>!w.lifecycle||w.lifecycle==='active'),activeProjects=projects.filter(p=>(!p.lifecycle||p.lifecycle==='active')&&activeWorkspaces.some(w=>w.id===p.workspace_id));
 if(current&&workspaces.some(w=>w.id===current.workspaceId&&w.lifecycle!=='deleted')){const p=projects.find(p=>p.id===current.projectId&&p.workspace_id===current.workspaceId&&p.lifecycle!=='deleted');if(p)return {workspaceId:current.workspaceId,projectId:p.id};if(current.projectId==='')return {workspaceId:current.workspaceId,projectId:activeProjects.find(p=>p.workspace_id===current.workspaceId)?.id||''};}
 const preferredProject=activeProjects.find(p=>p.id===defaults.project_id&&p.workspace_id===defaults.workspace_id);if(preferredProject)return {workspaceId:preferredProject.workspace_id,projectId:preferredProject.id};
 const workspace=activeWorkspaces.find(w=>w.id===defaults.workspace_id&&(!defaults.project_id||activeProjects.some(p=>p.workspace_id===w.id)))||activeWorkspaces.find(w=>activeProjects.some(p=>p.workspace_id===w.id))||activeWorkspaces[0];return {workspaceId:workspace?.id||'',projectId:activeProjects.find(p=>p.workspace_id===workspace?.id)?.id||''};
}
