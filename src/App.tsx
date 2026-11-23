import {Fragment} from 'react';
import LoginAppearanceSettings from './LoginAppearanceSettings';
import PaneResize, {usePaneWidth, paneStyle} from './PaneResize';
import ViewPreferenceSync from './ViewPreferenceSync';
import TableColumnResize from "./TableColumnResize";
import TableFontColors from "./TableFontColors";
const DrawingBoard=lazy(()=>import("./Toolbox"));
const SecurityConsole=lazy(()=>import("./SecurityConsole"));
import StartupDefaults from './StartupDefaults';
import {readNavigation,rememberNavigation} from './navigation-session';
import {startupSelection} from '../shared/startup-selection';
import { translateUiValue as __ui } from "./i18n";
const AIAssistant=lazy(()=>import("./AIAssistant"));
import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { Database, PencilRuler, Home, Users, CalendarDays, ChartNoAxesCombined, FileText, Bot, ShieldCheck, ClipboardCheck, Menu, LogOut, Plus, ChevronRight, CheckCircle2, KeyRound, Layers, FolderKanban, RefreshCw, X, } from "lucide-react";
import { api, useApi, AppContext, Modal, Confirm, Form, Field, ErrorBox, Loading, Empty, roles, today, } from "./lib";
const Insights=lazy(()=>import("./Insights").then(m=>({default:m.Insights})));
const Reports=lazy(()=>import("./Insights").then(m=>({default:m.Reports})));
const ProjectDashboard=lazy(()=>import("./ProjectDashboard"));
const DataCenter=lazy(()=>import("./DataCenter"));
const Planning=lazy(()=>import("./Planning"));
const Governance=lazy(()=>import("./Governance"));
import Notifications from "./Notifications";
const ObjectManager=lazy(()=>import("./ObjectManager"));
import ProjectLogo from "./ProjectLogo";
const Files=lazy(()=>import("./Files"));
const OwnerItems=lazy(()=>import("./OwnerItems"));
const Agenda=lazy(()=>import("./Agenda"));
import PanelToggle, { usePanelCollapsed } from "./PanelToggle";
import { PreferencesContext, defaultPreferences, usePreferences, } from "./Preferences";
const nav = [
    ["overview", "项目总览", Home],
    ["owner-items", "事项与日历", CalendarDays],
    ["data", "数据录入", Database],
    ["planning", "计划管理", CalendarDays],
    ["drawing", "工具箱", PencilRuler],
    ["approvals", "申请与审批", ClipboardCheck],
    ["reports", "报表中心", FileText],
    ["files", "项目文件", FileText],
    ["ai", "AI助手", Bot],
    ["settings", "用户与权限", ShieldCheck],
    ["objects", "对象管理", Layers],
    ["departments", "部门工作台", Users],
    ["security", "安全与审计", ShieldCheck],
] as const;
function Login({ onLogin, language, onLanguage }: {
    language: "zh-CN" | "en";
    onLanguage: (language: "zh-CN" | "en") => void;
    onLogin: () => void;
}) {
    const {data:appearance}=useApi<any>('/login-appearance');
    return (<div className={"login-layout"+(appearance?.image_url?" login-with-image":"")}>
      <div className={"login-visual"+(appearance?.image_url?" has-custom-image":"")}>{appearance?.image_url&&<img className="login-custom-image" src={appearance.image_url} alt="" onError={e=>{e.currentTarget.hidden=true;e.currentTarget.parentElement?.classList.remove("has-custom-image")}}/>}
        <div className="login-brand">
          <ProjectLogo /> Project Studio
        </div>
        <h1>{__ui("让项目的每一步，")}<br />{__ui("都有据可循。")}</h1>
        <p>{__ui("计划、数据与协作，在同一个工作空间汇合。")}</p>
        <div className="login-network">{['计划','实施','调整','反馈','交付'].map((label,i)=><Fragment key={label}>{i>0&&<i/>}<span>{__ui(label)}</span></Fragment>)}</div>
        <small>{__ui("项目全周期管理平台")}</small>
      </div>
      <div className="login-form">
        <label className="login-language">{__ui("界面语言")}<select aria-label={__ui("界面语言")} value={language} onChange={e => onLanguage(e.target.value as "zh-CN" | "en")}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
        <ProjectLogo />
        <h2>{__ui("登录工作空间")}</h2>
        <p>{__ui("欢迎回来，开始今天的项目协作。")}</p>
        <Form submit="登录" onSubmit={async (d) => {
            await api("/login", "POST", {
                username: d.get("username"),
                password: d.get("password"),
            });
            onLogin();
        }}>
          <Field label={__ui("账号")}>
            <input name="username" placeholder={__ui("请输入账号")} autoComplete="username" required/>
          </Field>
          <Field label={__ui("密码")}>
            <input name="password" type="password" placeholder={__ui("请输入密码")} autoComplete="current-password" required/>
          </Field>
        </Form>
        <small>{__ui("账号由工作空间管理员创建与分配。")}</small>
      </div>
    </div>);
}
export default function App() {
    const [viewEpoch,setViewEpoch]=useState(0);
    useEffect(()=>{const sync=()=>setViewEpoch(n=>n+1);window.addEventListener("project-studio:preferences-synced",sync);return()=>window.removeEventListener("project-studio:preferences-synced",sync)},[]);
    const unsaved = useRef(new Set<string>());
    const leavePending = useRef<Promise<boolean> | null>(null);
    const [leaveRequest, setLeaveRequest] = useState<{
        resolve: (value: boolean) => void;
    } | null>(null);
    const registerUnsaved = useCallback((id: string, dirty: boolean) => {
        if (dirty)
            unsaved.current.add(id);
        else
            unsaved.current.delete(id);
    }, []);
    const canLeave = useCallback(() => {
        if (!unsaved.current.size)
            return Promise.resolve(true);
        if (!leavePending.current)
            leavePending.current = new Promise<boolean>((resolve) => setLeaveRequest({ resolve }));
        return leavePending.current;
    }, []);
    function finishLeave(answer: boolean) {
        leaveRequest?.resolve(answer);
        leavePending.current = null;
        setLeaveRequest(null);
    }
    useEffect(() => {
        const guard = (e: BeforeUnloadEvent) => {
            if (unsaved.current.size) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, []);
    const [navigationWidth,setNavigationWidth]=usePaneWidth("navigation",188);
    const [navCollapsed, toggleNav] = usePanelCollapsed("navigation", true);
    const [tick, setTick] = useState(0), [notificationTarget, setNotificationTarget] = useState<any>(null), [boot, setBoot] = useState<any>(null), [starting, setStarting] = useState(true), [loginError, setLoginError] = useState(""), [workspaceId, setWorkspace] = useState(""), [projectId, setProject] = useState(""), [page, setPage] = useState("overview"), [toast, setToast] = useState(""), [dialog, setDialog] = useState(""), [mobile, setMobile] = useState(false);
    const loadedUser=useRef<string|null>(null),lastSelection=useRef({workspaceId:"",projectId:""});

    const [reportFocus, setReportFocus] = useState(false);
    const { preferences, updatePreferences, storageError } = usePreferences(boot?.user.id);
    const text = (zh: string, en: string) => preferences.language === "en" ? en : zh;
    const navigationLabels: Record<string, string> = {
        overview: "Overview",
        departments: "Departments",
        data: "Data entry",
        files: "Project files",
        "owner-items": "Tasks & calendar",
        planning: "Planning", drawing:"Toolbox",
        insights: "Analytics",
        reports: "Reports",
        ai: "AI analyst",
        calendar: "Calendar",
        approvals: "Approvals",
        settings: "Users & permissions",
        security: "Security & audit",
        objects: "Object manager",
    };
    const refreshBoot = async (restoreTab=false) => {
        try {
            const b = await api("/bootstrap");
            setBoot(b);
            const sameUser=loadedUser.current===b.user.id;
            const stored=!sameUser&&restoreTab?readNavigation(b.user.id):undefined;
            const selection=startupSelection(b.workspaces,b.projects,b.startup,sameUser?lastSelection.current:stored);
            if(!sameUser){
                const valid=stored&&stored.workspaceId===selection.workspaceId&&stored.projectId===selection.projectId;
                setPage(valid&&nav.some(([key])=>key===stored.page)?stored.page:"overview");
            }
            loadedUser.current=b.user.id;lastSelection.current=selection;
            setWorkspace(selection.workspaceId);setProject(selection.projectId);
            setLoginError("");
        }
        catch (e) {
            loadedUser.current=null;
            setBoot(null);
            if ((e as Error).message !== "请先登录")
                setLoginError((e as Error).message);
        }
        finally {
            setStarting(false);
        }
    };
    useEffect(() => {
        void refreshBoot(true);
    }, []);
    useEffect(() => {
        if (!toast)
            return;
        const t = setTimeout(() => setToast(""), 4000);
        return () => clearTimeout(t);
    }, [toast]);
    const availableWorkspaces=boot?.workspaces.filter((w:any)=>w.lifecycle!=="deleted")||[];
    const workspace = availableWorkspaces.find((w: any) => w.id === workspaceId), projects = boot?.projects.filter((p: any) => p.lifecycle!=="deleted"&&p.workspace_id === workspaceId) || [], project = projects.find((p: any) => p.id === projectId) || projects[0];
    useEffect(()=>{
        if(!boot||boot.user.must_change_password)return;
        const position={workspaceId,projectId:project?.id||"",page};
        lastSelection.current=position;
        rememberNavigation(boot.user.id,position);
    },[boot?.user.id,boot?.user.must_change_password,workspaceId,project?.id,page]);
    const { data: context, error: contextError, loading, } = useApi(project && !boot?.user.must_change_password ? `/projects/${project.id}/context` : null, tick);
    const reload = () => {
        setTick((t) => t + 1);
        void refreshBoot();
    };
    async function navigate(p: string) {
        if (p === 'insights')
            p = 'overview';
        if (p !== page && !(await canLeave()))
            return;
        setPage(p);
        setMobile(false);
    }
    if (starting)
        return <Loading />;
    if (!boot)
        return (<PreferencesContext.Provider value={preferences}>
        {__ui(loginError && <div className="login-warning">{__ui(loginError)}</div>)}
        <Login language={preferences.language} onLanguage={language => updatePreferences({ language })} onLogin={() => void refreshBoot()}/>
      </PreferencesContext.Provider>);
    if(boot.user.must_change_password)return <PreferencesContext.Provider value={preferences}><div className="login-layout"><div className="login-form"><h2>{__ui("首次登录必须修改密码")}</h2><p>{__ui("修改前无法访问项目数据，新密码至少12位。")}</p><Form submit="保存新密码并重新登录" onSubmit={async d=>{if(d.get('password')!==d.get('confirm'))throw Error('两次密码不一致');await api('/me/password','POST',{old:d.get('old'),password:d.get('password')});loadedUser.current=null;setBoot(null);}}><Field label={__ui("原密码")}><input name="old" type="password" required autoComplete="current-password"/></Field><Field label={__ui("新密码")}><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></Field><Field label={__ui("确认新密码")}><input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></Field></Form></div></div></PreferencesContext.Provider>;
    const active = nav.find((n) => n[0] === page) || nav[0];
    return (<AppContext.Provider value={{
            boot,
            workspace,
            project,
            context: context || { users: [], departments: [], permission: {} },
            tick,
            reload,
            notify: setToast,
            navigate,
            registerUnsaved,
            canLeave,
            notificationTarget,
            consumeNotificationTarget: () => setNotificationTarget(null),
            setReportFocus,
            openWorkItem: async (kind, id) => {
                if (!(await canLeave()))
                    return;
                setNotificationTarget({
                    kind,
                    resource_id: id,
                    project_id: project?.id,
                });
                setPage(kind === "approval" ? "approvals" : "owner-items");
                setMobile(false);
            },
        }}>
      <PreferencesContext.Provider value={preferences}>
        <div style={paneStyle("--navigation-width",navigationWidth)} className={"app-shell" +
            (navCollapsed ? " nav-collapsed" : "") +
            (reportFocus && page === "reports" ? " report-focused" : "")}>
          <header className="topbar">
            <button className="icon-button mobile-menu" aria-label={__ui(mobile ? "收起导航" : "展开导航")} aria-expanded={mobile} aria-controls="main-navigation" onClick={() => setMobile(!mobile)}>
              <Menu />
            </button>
            <div className="brand">
              <ProjectLogo />
              <div>
                <strong>{__ui(text("项目管理平台", "Project management"))}</strong>
                <small>Project Studio</small>
              </div>
            </div>
            <div className="context-picker">
              <span>{__ui(text("工作空间", "Workspace"))}</span>
              <select aria-label={__ui("工作空间")} value={workspaceId} onChange={async (e) => {
            const next = e.target.value;
            if (!(await canLeave()))
                return;
            setWorkspace(next);
            setProject("");
        }}>
                {__ui(availableWorkspaces.map((w: any) => (<option key={w.id} value={w.id}>
                    {w.name}
                  </option>)))}
              </select>
            </div>
            <div className="context-picker">
              <span>{__ui("项目")}</span>
              <select aria-label={__ui("项目")} value={project?.id || ""} onChange={async (e) => {
            const next = e.target.value;
            if (await canLeave())
                setProject(next);
        }}>
                <option value="" disabled>{__ui("选择项目")}</option>
                {__ui(projects.map((p: any) => (<option key={p.id} value={p.id}>
                    {p.name}
                  </option>)))}
              </select>
            </div>
            <button className="icon-button create-menu" title={__ui("创建工作空间或项目")} aria-label={__ui("创建工作空间或项目")} onClick={() => setDialog("create")}>
              <Plus size={20}/>
            </button>
            <Notifications onNavigate={async (item) => {
            if (!(await canLeave()))
                return;
            reload();
            setNotificationTarget(item);
            setWorkspace(item.workspace_id);
            setProject(item.project_id);
            setPage(item.kind === "owner_item"
                ? "owner-items"
                : item.kind === "approval"
                    ? "approvals"
                    : "owner-items");
            setMobile(false);
        }}/>
            <div className="user-menu">
              <button className="avatar" onClick={() => setDialog("account")} title={__ui(text("个人设置", "Personal settings"))} aria-label={__ui(text("个人设置", "Personal settings"))}>
                {boot.user.name[0]}
              </button>
              <button className="text-button" onClick={() => setDialog("account")}>
                {boot.user.username}
              </button>
            </div>
          </header>
          <aside className={"sidebar " + (mobile ? "open" : "")} aria-label={__ui("主导航")}>
            {!navCollapsed&&<PaneResize name="调整功能导航宽度" width={navigationWidth} onChange={setNavigationWidth} minimum={160} maximum={340}/>}
            <div className="sidebar-heading">
              <strong>{__ui(text("功能导航", "Navigation"))}</strong>
              <div className="desktop-nav-toggle">
                <PanelToggle name="主导航" controls="main-navigation" collapsed={navCollapsed} onToggle={toggleNav}/>
              </div>
              <button className="icon-button mobile-nav-close" aria-label={__ui("关闭导航")} onClick={() => setMobile(false)}>
                <X size={18}/>
              </button>
            </div>
            <div className="mobile-context-switch">
              <label>{__ui("工作空间")}<select aria-label={__ui("手机工作空间")} value={workspaceId} onChange={async (event) => {
            const next = event.target.value;
            if (await canLeave()) {
                setWorkspace(next);
                setProject("");
            }
        }}>
                  {__ui(availableWorkspaces.map((w: any) => (<option key={w.id} value={w.id}>
                      {w.name}
                    </option>)))}
                </select>
              </label>
              <label>{__ui("项目")}<select aria-label={__ui("手机项目")} value={project?.id || ""} onChange={async (event) => {
            const next = event.target.value;
            if (await canLeave())
                setProject(next);
        }}>
                  <option value="" disabled>{__ui("选择项目")}</option>
                  {__ui(projects.map((p: any) => (<option key={p.id} value={p.id}>
                      {p.name}
                    </option>)))}
                </select>
              </label>
            </div>
            <nav id="main-navigation">
              {__ui(nav.filter(([key])=>key!=="security" || boot.user.system_admin || workspace?.role==="owner" || !!project).map(([key, label, Icon]) => (<button key={key} title={__ui(text(label, navigationLabels[key]))} aria-label={__ui(text(label, navigationLabels[key]))} aria-current={page === key ? "page" : undefined} className={page === key ? "active" : ""} onClick={() => navigate(key)}>
                  <Icon size={20}/>
                  <span>{__ui(text(label, navigationLabels[key]))}</span>
                </button>)))}
            </nav>
            <div className="sidebar-bottom">
              <span className="online-dot"/>{__ui("本地工作空间")}<div>v{__ui(boot.version)}{__ui(" · 开发预览")}</div>
              <a href="/api/manual" download>{__ui("下载使用指南")}</a>
            </div>
          </aside>
          <Suspense fallback={<main className="main"><Loading/></main>}><main className={"main"+(["drawing","data","planning","owner-items","calendar","files"].includes(page)?" sheet-module":"")}>
            <div className="breadcrumb">
              <span>{workspace?.name}</span>
              <ChevronRight size={13}/>
              <span>{project?.name || "选择项目"}</span>
              <ChevronRight size={13}/>
              <strong>{__ui(text(active[1], navigationLabels[page]))}</strong>
              <button className="icon-button" aria-label={__ui("刷新数据")} onClick={reload}>
                <RefreshCw size={15}/>
              </button>
            </div>
            {__ui(((workspace?.lifecycle && workspace.lifecycle !== "active") ||
            (project?.lifecycle && project.lifecycle !== "active")) && (<div className="note">{__ui("当前空间或项目处于非活动状态，业务写入已暂停。管理者可在“对象管理”中检查并激活。")}</div>))}
            {__ui(page === "security" ? (<SecurityConsole key={workspaceId}/>) : page === "objects" ? (<ObjectManager key={workspaceId + project?.id}/>) : page === "settings" ? (<Governance key={workspaceId + project?.id} section="settings"/>) : page === "approvals" ? (<Governance key={workspaceId + project?.id} section="approvals"/>) : !project ? (<div className="page">
                <Empty text={__ui("创建项目，开始管理全周期数据")}>
                  <button className="primary" onClick={() => setDialog("project")}>
                    <Plus size={16}/>{__ui("创建项目")}</button>
                  <button onClick={() => navigate("approvals")}>{__ui("申请加入已有项目")}</button>
                </Empty>
              </div>) : contextError ? (<ErrorBox message={__ui(contextError)}/>) : loading && !context ? (<Loading />) : (<div key={project.id + page} className={"page " + (page === "data" ? "data-page" : "")}>
                {__ui(page === "overview" ? (<ProjectDashboard />) : page === "departments" ? (<Insights departmentsOnly/>) : page === "data" ? (<DataCenter />) : page === "files" ? (<Files />) : page === "owner-items" ? (<Agenda key={project?.id}/>) : page === "drawing" ? (<DrawingBoard key={project?.id}/>) : page === "planning" ? (<Planning />) : page === "insights" ? (<ProjectDashboard />) : page === "reports" ? (<Reports />) : page === "ai" ? (<AIAssistant key={project?.id}/>) : page === "calendar" ? (<Agenda key={project?.id}/>) : null)}
              </div>))}
          </main></Suspense>
          <footer className="statusbar">
            <span>
              <CheckCircle2 size={16}/>{__ui("已连接工作空间")}</span>
            <span>{__ui("当前项目：")}{project?.name || "未选择"}</span>
            <span className="status-right">
              {context?.permission?.project_role_name || __ui(roles[context?.permission?.role] || "空间成员")}{__ui("· 数据持久化保存")}</span>
          </footer>
          <ViewPreferenceSync/>
          <TableColumnResize key={'widths:'+boot.user.id+workspaceId+(project?.id||'')+page+viewEpoch} page={page} scope={[boot.user.id,workspaceId,project?.id||''].join(':')}/>
          <TableFontColors key={boot.user.id+workspaceId+(project?.id||'')+page+viewEpoch} page={page} scope={[boot.user.id,workspaceId,project?.id||''].join(':')}/>
        </div>
        {__ui(leaveRequest && (<Confirm title={__ui("离开未保存的修改")} detail={__ui("存在未保存的修改。取消可继续编辑；确认离开后，这些修改会丢失。")} onClose={() => finishLeave(false)} onConfirm={async () => finishLeave(true)}/>))}
        {__ui(toast && (<div className="toast" role="status">
            <CheckCircle2 size={18}/>
            {__ui(toast)}
          </div>))}
        {__ui(dialog === "create" && (<Modal title={__ui("创建")} onClose={() => setDialog("")}>
            <div className="creation-options">
              <button onClick={() => setDialog("workspace")}>
                <Layers />{__ui("新工作空间")}<small>{__ui("独立的组织与项目集合")}</small>
              </button>
              <button onClick={() => setDialog("project")}>
                <FolderKanban />{__ui("新项目")}<small>{__ui("自动创建11个业务部门")}</small>
              </button>
            </div>
          </Modal>))}
        {__ui(dialog === "workspace" && (<Modal title={__ui("创建工作空间")} onClose={() => setDialog("")}>
            <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                const r = await api("/workspaces", "POST", {
                    name: d.get("name"),
                });
                await refreshBoot();
                setWorkspace(r.id);
                setProject("");
                setDialog("");
                setToast("工作空间已创建");
            }}>
              <Field label={__ui("工作空间名称")}>
                <input name="name" required maxLength={120}/>
              </Field>
            </Form>
          </Modal>))}
        {__ui(dialog === "project" && (<Modal title={__ui("创建项目")} onClose={() => setDialog("")}>
            <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                const r = await api(`/workspaces/${workspaceId}/projects`, "POST", {
                    name: d.get("name"),
                    start_date: d.get("date"),
                    description: d.get("description"),
                    use_standard_template: d.get("use_standard_template") === "on",
                    template_profile: d.get("template_profile"),
                });
                await refreshBoot();
                setProject(r.id);
                setDialog("");
                setToast(d.get("use_standard_template") === "on" ? "项目及标准业务模板已创建" : "项目及11个部门已创建");
            }}>
              <Field label={__ui("项目名称")}>
                <input name="name" required maxLength={120}/>
              </Field>
              <Field label={__ui("计划开始")}>
                <input type="date" name="date" required defaultValue={today()}/>
              </Field>
              <Field label={__ui("工程建设模板类型")}><select name="template_profile" defaultValue="generic"><option value="generic">{__ui("通用公共建筑")}</option><option value="hospital">{__ui("医院建设项目")}</option><option value="stadium">{__ui("体育场建设项目")}</option></select></Field>
              <label className="check"><input type="checkbox" name="use_standard_template" defaultChecked/>{__ui("使用标准项目模板（空台账、报表、岗位权限和审批流程）")}</label>
              <p className="help">{__ui("复用现有岗位账号，不复制业务记录或金额，也不重置密码。取消勾选可创建空白项目。")}</p>
              <Field label={__ui("项目说明")}>
                <textarea name="description" maxLength={500}/>
              </Field>
            </Form>
          </Modal>))}
        {__ui(dialog === "account" && (<Modal title={__ui(text("个人设置", "Personal settings"))} onClose={() => setDialog("")}>
            <div className="account-summary">
              <div className="avatar">{boot.user.name[0]}</div>
              <div>
                <strong>{boot.user.name}</strong>
                <p>{boot.user.username}</p>
              </div>
            </div>
            <section className="preferences-section">
              <h3>{__ui(text("界面偏好", "Appearance & language"))}</h3>
              <div className="preferences-grid">
                <Field label={__ui(text("界面语言", "Interface language"))}>
                  <select aria-label={__ui(text("界面语言", "Interface language"))} value={preferences.language} onChange={(e) => updatePreferences({
                language: e.target.value as "zh-CN" | "en",
            })}>
                    <option value="zh-CN">{__ui("简体中文")}</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <Field label={__ui(text("界面风格", "Theme"))}>
                  <select aria-label={__ui(text("界面风格", "Theme"))} value={preferences.theme} onChange={(e) => updatePreferences({
                theme: e.target.value as "light" | "dark" | "system",
            })}>
                    <option value="light">{__ui(text("浅色", "Light"))}</option>
                    <option value="dark">{__ui(text("深色", "Dark"))}</option>
                    <option value="system">{__ui(text("跟随系统", "System"))}</option>
                  </select>
                </Field>
                <Field label={__ui(text("主题色", "Accent color"))}>
                  <select aria-label={__ui(text("主题色", "Accent color"))} value={preferences.accent} onChange={(e) => updatePreferences({
                accent: e.target.value as "green" | "blue",
            })}>
                    <option value="green">{__ui(text("翡翠绿", "Emerald"))}</option>
                    <option value="blue">{__ui(text("湖泊蓝", "Ocean blue"))}</option>
                  </select>
                </Field>
                <Field label={__ui(text("显示密度", "Display density"))}>
                  <select aria-label={__ui(text("显示密度", "Display density"))} value={preferences.density} onChange={(e) => updatePreferences({
                density: e.target.value as "comfortable" | "compact",
            })}>
                    <option value="comfortable">
                      {__ui(text("舒适", "Comfortable"))}
                    </option>
                    <option value="compact">{__ui(text("紧凑", "Compact"))}</option>
                  </select>
                </Field>
                <Field label={__ui(text("文字大小", "Text size"))}>
                  <select aria-label={__ui(text("文字大小", "Text size"))} value={preferences.textSize} onChange={(e) => updatePreferences({
                textSize: e.target.value as "standard" | "large",
            })}>
                    <option value="standard">{__ui(text("标准", "Standard"))}</option>
                    <option value="large">{__ui(text("较大", "Large"))}</option>
                  </select>
                </Field>
              </div>
              <p className="help">
                {__ui(text("偏好即时生效，修改后按账号同步到服务器；网络不可用时保留本机设置。", "Changes apply immediately and sync per account after edits; local settings remain available offline."))}
              </p>
              <p className="help">
                {__ui(text("中英文切换适用于全部操作界面；用户录入的业务内容保留原文。", "Language changes apply throughout the interface. User-entered business content retains its original language."))}
              </p>
              {__ui(storageError && (<ErrorBox message={__ui(text("浏览器未允许保存偏好，本次设置仍生效。", "Browser storage is unavailable. Changes apply to this session only."))}/>))}
              <button onClick={() => updatePreferences(defaultPreferences)}>
                {__ui(text("恢复默认", "Reset preferences"))}
              </button>
            </section>
            {boot.user.system_admin&&<><StartupDefaults/><LoginAppearanceSettings/></>}
            <h3 className="account-security-title">
              {__ui(text("账号与安全", "Account & security"))}
            </h3>
            <button className="full-button" onClick={() => setDialog("password")}>
              <KeyRound size={17}/>
              {__ui(text("修改密码", "Change password"))}
            </button>
            <button className="full-button danger" onClick={async () => {
                if (!(await canLeave()))
                    return;
                await api("/logout", "POST", {});
                loadedUser.current=null;
            setBoot(null);
                setDialog("");
            }}>
              <LogOut size={17}/>
              {__ui(text("退出登录", "Sign out"))}
            </button>
          </Modal>))}
        {__ui(dialog === "password" && (<Modal title={__ui("修改密码")} onClose={() => setDialog("")}>
            <Form submit="修改并重新登录" onClose={() => setDialog("")} onSubmit={async (d) => {
                await api("/me/password", "POST", {
                    old: d.get("old"),
                    password: d.get("password"),
                });
                setDialog("");
                loadedUser.current=null;
            setBoot(null);
            }}>
              <Field label={__ui("原密码")}>
                <input type="password" name="old" required autoComplete="current-password"/>
              </Field>
              <Field label={__ui("新密码（至少12位）")}>
                <input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password"/>
              </Field>
            </Form>
          </Modal>))}
      </PreferencesContext.Provider>
    </AppContext.Provider>);
}
