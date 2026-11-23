import PrintForms from './PrintForms';
import {planFilterColumns} from '../shared/plan-filter-values';
import ColumnFilterButton from './ColumnFilterButton';
import {emptyColumnFilters,statusFilterColumn,type ColumnFilters} from '../shared/column-filters';
import {LOE} from '../shared/loe';
import ActivityCodeTools from './ActivityCodeTools';
import {PhotoValue} from "./PhotoEditor";
import SheetScrollSpace from "./SheetScrollSpace";
import {copyTableSource,useTableSource} from "./table-transfer-clipboard";
import TransferTable from "./TransferTable";
import GridColumnMenu from "./GridColumnMenu";
import {useDismissColumnMenu} from "./useDismissColumnMenu";
import PaneResize, {usePaneWidth, paneStyle} from './PaneResize';
import {reviewMode,editableRecord} from '../shared/record-policy';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { Fragment, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import "./table-overrides.css";
import TableTools from "./TableTools";
import RecordLinks from "./RecordLinks";
import InlineRecordRow from "./InlineRecordRow";
import SheetNavigation from "./SheetNavigation";
import RowInsertHandle from "./RowInsertHandle";
import { PlanRelationCells } from './PlanRelationCells';
import { planTableColumns as relationColumns } from '../shared/plan-relations';
import PermissionExplanation from "./PermissionExplanation";
import { Database, Table2, Plus, Folder, ChevronDown, Columns3, Download, Upload, Send, PenLine, Trash2, Save, SlidersHorizontal, BarChart3, Eye, FileOutput, Star, } from "lucide-react";
import { api, today, useApi, useApp, useRememberedState, PageTitle, Modal, Form, Field, SearchBox, Status, Loading, ErrorBox, Empty, ApproveDialog, Confirm, } from "./lib";

import PublicViews from './PublicViews';
import { tableGroupKey } from '../shared/table-statistics';
import {wbsLevelColor,wbsMoveTarget,wbsDefaultDemoteParent} from '../shared/wbs-hierarchy';
import ImportWizard from "./ImportWizard";
import CreateTable from "./CreateTable";
import CatalogActions from "./CatalogActions";
import { filterCatalog } from "../shared/catalog";
import PanelToggle, { usePanelCollapsed,useResponsiveCatalog } from "./PanelToggle";
import { FieldTypeOptions, ValueEditor, fieldOptions } from "./FieldControls";
import { typeLabels, numericTypes, inputValue, displayValue, isSystemField, isReference, } from "../shared/fields";
const types: Record<string, string> = typeLabels;
export default function DataCenter() {
    const [catalogWidth,setCatalogWidth]=usePaneWidth("catalog",222);
    const [catalogCollapsed, toggleCatalog] = useResponsiveCatalog();
    const { boot, project, workspace, context, tick, notify, reload } = useApp(), { data: sourceTables, error } = useApi<any[]>(`/projects/${project.id}/tables`, tick);
    const { data: publicFolder } = useApi<any>(`/projects/${project.id}/public`, tick);
    const tableClipboard=useTableSource(boot.user.id),[pasteTable,setPasteTable]=useState(false);
    const tables = sourceTables ? [...sourceTables, ...(publicFolder?.tables || [])] : undefined;
    const [selected, setSelected] = useRememberedState(`catalog:${boot.user.id}:${project.id}:table`, ""), [catalogSearch, setCatalogSearch] = useRememberedState(`catalog:${boot.user.id}:${project.id}:search`, ""), [starRevision, setStarRevision] = useState(0), [newDepartment, setNewDepartment] = useState<string | undefined>(), [mode, setMode] = useRememberedState(`catalog:${boot.user.id}:${project.id}:mode`, "entry"), [dialog, setDialog] = useState("");
    const table = tables?.find((t) => t.id === selected && t.lifecycle !== "deleted") ||
        tables?.find((t) => t.name === "施工日报" && t.lifecycle !== "deleted") ||
        tables?.find((t) => t.lifecycle !== "deleted");
    useEffect(() => {
        if (tables &&
            mode !== 'views' &&
            selected &&
            !tables.some((item) => item.id === selected && item.lifecycle !== "deleted")) {
            setSelected("");
            notify("上次选择的数据表已删除或不再可访问，已返回可用数据表。");
        }
    }, [tables, selected, mode]);
    const catalogGroups = filterCatalog(context.departments, (tables ?? []).filter(t => !t.is_mapping), catalogSearch);
    const searchingCatalog = !!catalogSearch.trim();
    useEffect(() => {
        if (!['entry', 'views'].includes(mode))
            setMode('entry');
    }, [mode]);
    useEffect(() => {
        const update = () => setStarRevision((value) => value + 1);
        window.addEventListener("project-studio:stars", update);
        return () => window.removeEventListener("project-studio:stars", update);
    }, []);
    const [favoritesOpen,setFavoritesOpen]=useRememberedState(`catalog:${boot.user.id}:${project.id}:favorites-open`,true,true);
    const starPrefix = `project-studio:star:v1:${boot.user.id}:`;
    const starred = (tables ?? []).filter(t=>t.lifecycle!=='deleted').map(object=>({kind:'table',object})).filter(({ kind, object }) => {
        void starRevision;
        try {
            return localStorage.getItem(`${starPrefix}${kind}:${object.id}`) === "1";
        }
        catch {
            return false;
        }
    });
    const modeTabs=(<div className="program-tabs">
          {__ui([
            ["entry", "数据录入", Table2],
            ["views", "数据视图", Eye],
        ].map(([id, label, Icon]: any) => (<button key={id} className={mode === id ? "active" : ""} onClick={() => {
                setMode(id);
                if (id === 'entry' && table?.is_view) {
                    setSelected(sourceTables?.find(t => t.lifecycle === 'active')?.id || '');
                }
            }}>
              <Icon size={17}/>
              {__ui(label)}
            </button>)))}
        </div>);
    return (<div style={paneStyle("--catalog-width",catalogWidth)} className={"data-layout" + (catalogCollapsed ? " catalog-collapsed" : "")}>
      <aside className="catalog" aria-label={__ui("数据目录侧栏")}>
        {!catalogCollapsed&&<PaneResize name="调整数据目录宽度" width={catalogWidth} onChange={setCatalogWidth} minimum={180} maximum={440}/>}
        <div className="catalog-heading">
          <strong hidden={catalogCollapsed}>{__ui("数据目录")}</strong><span className="touch-catalog-label">{__ui("数据目录")}</span>
          {__ui(!catalogCollapsed && context.permission.manage && (<button className="icon-button primary" aria-label={__ui("创建数据表")} onClick={() => setDialog("table")}>
              <Plus size={17}/>
            </button>))}
          <PanelToggle name="数据目录" controls="data-catalog-content" collapsed={catalogCollapsed} onToggle={toggleCatalog}/>
        </div>
        <div id="data-catalog-content" hidden={catalogCollapsed}>
          <details className="catalog-favorites" open={favoritesOpen} onToggle={e=>setFavoritesOpen(e.currentTarget.open)}>
            <summary><Star size={13}/> {__ui("常用")}</summary>
            {starred.map(({object})=><button key={object.id} onClick={()=>{setSelected(object.id);setMode(object.is_view?"views":"entry");setCatalogSearch("")}}>{object.name}</button>)}
          </details>
          {tableClipboard&&context.permission.manage&&<button className="catalog-paste" onClick={()=>setPasteTable(true)}>{__ui("粘贴数据表")} · {tableClipboard.name}</button>}
          {pasteTable&&tableClipboard&&<TransferTable table={tableClipboard} onClose={()=>setPasteTable(false)}/>}
          <div className="catalog-search">
            <input type="search" aria-label={__ui("搜索部门、表或字段")} placeholder={__ui("搜索部门、表或字段")} value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)}/>
            {__ui(searchingCatalog && (<button className="link" onClick={() => setCatalogSearch("")}>{__ui("清除目录搜索")}</button>))}
            {__ui(searchingCatalog && (<small role="status">
                {__ui(catalogGroups.length)}{__ui(" 个部门 ·")}{__ui(" ")}
                {__ui(catalogGroups.reduce((total, group) => total + group.tables.length, 0))}{__ui(" ")}{__ui("张表")}</small>))}
          </div>
          <div className="tree-root">
            <ChevronDown size={14}/>
            <Database size={17}/>
            <span className="catalog-object-name" title={workspace.name}>
              {workspace.name}
            </span>
            <small>{__ui("工作空间")}</small>
            <CatalogActions key={workspace.id} kind="workspace" object={workspace}/>
          </div>
          <div className="tree-project">
            <ChevronDown size={14}/>
            <Folder size={16}/>
            <span className="catalog-object-name" title={project.name}>
              {project.name}
            </span>
            <CatalogActions key={project.id} kind="project" object={project}/>
          </div>
          <div className="tree-departments">
            <details open={!!table?.is_mapping} className="public-folder">
              <summary><Folder size={16}/>public <small>{__ui("实时视图")}</small></summary>
              <p className="help">{__ui("实时查询源数据，继承源表权限。")}</p>
              {__ui((boot.user.username === 'admin' || boot.user.system_admin) && <button onClick={() => setMode('views')}><Plus size={14}/>{__ui("新建 / 设计视图")}</button>)}
              {__ui((publicFolder?.tables || []).filter((t: any) => !catalogSearch.trim() || t.name.includes(catalogSearch.trim())).map((t: any) => <button key={t.id} className={'tree-table ' + (table?.id === t.id ? 'active' : '')} onClick={() => { setSelected(t.id); setMode(t.is_view ? 'views' : 'entry'); }}><Table2 size={16}/>{t.name}</button>))}
            </details>
            {__ui(catalogGroups.map(({ department: d, tables: departmentTables }) => (<details key={`${d.id}:${searchingCatalog}`} open={searchingCatalog || d.id === table?.department_id}>
                  <summary>
                    <Folder size={16}/>
                    {d.name}
                    <small>{__ui("部门")}</small>
                    <CatalogActions kind="department" object={d} onCreateTable={() => {
                setNewDepartment(d.id);
                setDialog("table");
            }}/>
                  </summary>
                  {__ui(departmentTables.map((t) => (<div key={t.id}>
                      <div className="catalog-table-row">
                        <button className={"tree-table " + (table?.id === t.id ? "active" : "")} onClick={() => {
                    setSelected(t.id);
                    setMode("entry");
                }}>
                          <Table2 size={16}/>
                          {t.name}
                        </button>
                        <CatalogActions kind="table" object={t}/>
                      </div>
                      {__ui(searchingCatalog &&
                    t.columns.map((f: any) => (<div className="tree-field" key={f.id}>
                            <Columns3 size={13}/>
                            {f.name}
                            <small>{__ui("列")}</small>
                          </div>)))}
                    </div>)))}
                </details>)))}
            {__ui(searchingCatalog && catalogGroups.length === 0 && (<p className="help">{__ui("没有匹配的授权目录。可清除搜索查看全部。")}</p>))}
          </div>

        </div>
      </aside>
      <div className="data-content">
        {!table&&mode!=='views'&&modeTabs}
        {__ui(error ? (<ErrorBox message={__ui(error)}/>) : mode === "views" || table?.is_view ? (<PublicViews headingTools={modeTabs} tables={sourceTables || []} selected={selected} onSelect={setSelected}/>) : !tables ? (<Loading />) : !table ? (<Empty text={__ui("当前部门还没有数据表")}>
            <button onClick={() => setDialog("table")}>{__ui("创建第一张表")}</button>
          </Empty>) : (<RecordGrid key={table.id + mode} table={table} mode={mode} headingTools={modeTabs}/>))}
      </div>
      {__ui(dialog === "table" && (<CreateTable tables={tables || []} defaultDepartment={newDepartment || table?.department_id} onClose={() => {
                setDialog("");
                setNewDepartment(undefined);
            }} onCreated={(id) => {
                setSelected(id);
                setMode("entry");
                setDialog("");
                setNewDepartment(undefined);
                reload();
                notify("数据表和字段结构已创建");
            }}/>))}
    </div>);
}
export function RecordGrid({ table, mode, headingTools, createRequest, openRecord, planningHierarchy: explicitPlanningHierarchy }: {
    table: any;
    mode: string;
    headingTools?:ReactNode;
    createRequest?:{key:number;data:any};openRecord?:any;
    planningHierarchy?:'wbs'|'activity';
}) {
    const planningHierarchy:'wbs'|'activity'|undefined = explicitPlanningHierarchy || (table.planning_kind==='wbs'||table.planning_kind==='activity'?table.planning_kind:undefined);
    const [loeView,setLoeView]=useState(false);
    const relationTick = useApp().tick;
    const { data: relationContext,refresh:refreshRelations } = useApi<any>(`/tables/${table.id}/plan-relations`, relationTick);
    const relationCount = relationContext && !loeView ? relationColumns.length : 0;
    const nearCriticalRecords=new Set<string>((relationContext?.activities||[]).filter((a:any)=>a.metrics?.near_critical).map((a:any)=>a.record_id));
    const criticalRecords=new Set<string>((relationContext?.activities||[]).filter((a:any)=>a.metrics?.critical).map((a:any)=>a.record_id));

    const [printForms,setPrintForms]=useState(false),[printMounted,setPrintMounted]=useState(false);
    const { tick, notify, reload, boot, project } = useApp(), scope = `records:${boot.user.id}:${project.id}:${table.id}`, [page, setPage] = useRememberedState(`${scope}:page`, 1), [search, setSearch] = useRememberedState(`${scope}:search`, ""), [query, setQuery] = useState(search), [status, setStatus] = useRememberedState(`${scope}:status`, "all"), [selected, setSelected] = useState<string[]>([]), [field, setField] = useState<any>(table.columns[0]), [dialog, setDialog] = useState(""), [editing, setEditing] = useState<any>(null), [inlineCreate, setInlineCreate] = useState(false), [inlineEditing, setInlineEditing] = useState<any>(null), [approve, setApprove] = useState<any>(null), [deleteRecords, setDeleteRecords] = useState<{
        id: string;
        version: number;
    }[]>([]), [columnOrder, setColumnOrder] = useRememberedState<string[]>(scope+":column-order",[],true), [menu, setMenu] = useState<string | null>(null), [rememberedSort, setSort] = useRememberedState<{
        id: string;
        direction: 1 | -1;
    } | null>(scope+":sort",null), [rememberedGroups, setGroupBy] = useRememberedState<string[]>(scope+":groups",[]), [dragColumn, setDragColumn] = useState<string | null>(null);
    const [rememberedFilters,setColumnFilters]=useRememberedState<ColumnFilters>(scope+':filters',emptyColumnFilters);
    const filterColumns=[...(planningHierarchy==='wbs'?[{id:'__wbs_level',name:'层级',type:'int32'}]:[]),...table.columns,...(relationContext?planFilterColumns:[]),statusFilterColumn];
    const columnFilters:ColumnFilters={mode:rememberedFilters?.mode==='any'?'any':'all',conditions:Array.isArray(rememberedFilters?.conditions)?rememberedFilters.conditions.filter(f=>filterColumns.some(c=>c.id===f.field)):[]};
    const sort=rememberedSort&&table.columns.some((f:any)=>f.id===rememberedSort.id)?rememberedSort:null;
    const groupBy=Array.isArray(rememberedGroups)?rememberedGroups.filter(id=>table.columns.some((f:any)=>f.id===id)):[];
    const viewOrder=JSON.stringify([sort?.id,sort?.direction,groupBy,columnFilters]);
    const previousViewOrder=useRef(viewOrder);
    const openColumnHeader=useDismissColumnMenu(!!menu,()=>setMenu(null));
    const [wbsSort,setWbsSort] = useRememberedState<{id:string;direction:1|-1}>(`plan-wbs-sort:${boot.user.id}:${project.id}`,{id:'code',direction:1});
    const [levelSaving,setLevelSaving]=useState(false);
    const [newWbsLevel,setNewWbsLevel]=useState('');
    const wbsGrid=planningHierarchy==='wbs';
    const levelOptions=Array.from({length:50},(_,i)=>i+1);
    const bandStyle=(depth:number)=>({"--wbs-accent":wbsLevelColor(depth)} as CSSProperties);
    const [collapsedWbs,setCollapsedWbs]=useRememberedState<string[]>(scope+":collapsed-wbs",[]);
    const [inlineGroup,setInlineGroup]=useState("");
    const [insertBefore,setInsertBefore]=useState('');
    const [insertAfter,setInsertAfter]=useState('');
    const [columnInsert,setColumnInsert]=useState<{anchor:string;side:'left'|'right'}|null>(null);
    function openField(position:typeof columnInsert=null){setColumnInsert(position);setMenu(null);setDialog('field');}
    useEffect(() => {
        setColumnOrder((previous) => [
            ...previous.filter((id) => table.columns.some((f: any) => f.id === id)),
            ...table.columns
                .filter((f: any) => !previous.includes(f.id))
                .map((f: any) => f.id),
        ]);
        setField((previous: any) => table.columns.find((f: any) => f.id === previous?.id) ||
            table.columns[0]);
    }, [table.columns]);
    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search);
            if (query !== search) {
                setPage(1);
                setSelected([]);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);
    useEffect(()=>{if(createRequest){setInsertBefore("");setInlineGroup("");setInlineCreate(true);setInlineEditing(null)}},[createRequest?.key]);
    useEffect(()=>{if(openRecord){setEditing(openRecord);setDialog('record')}},[openRecord]);
    const hierarchyActive = !!planningHierarchy && !groupBy.length && !sort;
    const { data, error, loading, refresh:refreshRows } = useApi(`/tables/${table.id}/records?page=${page}&search=${encodeURIComponent(query)}&status=${status}&group=${encodeURIComponent(groupBy.join(','))}&filters=${encodeURIComponent(JSON.stringify(columnFilters))}${sort ? `&sort=${encodeURIComponent(sort.id)}&direction=${sort.direction === 1 ? 'asc' : 'desc'}` : ''}${hierarchyActive ? `&planning_hierarchy=${planningHierarchy}&wbs_sort=${encodeURIComponent(wbsSort.id)}&wbs_direction=${wbsSort.direction===1?'asc':'desc'}` : ''}`, tick), { data: views } = useApi<any[]>(`/tables/${table.source_table_id || table.id}/views`, tick);
    const records = data?.rows || [], allOrderedColumns = [
        ...columnOrder
            .map((id) => table.columns.find((f: any) => f.id === id))
            .filter(Boolean),
        ...table.columns.filter((f: any) => !columnOrder.includes(f.id)),
    ], orderedColumns = loeView&&planningHierarchy==='activity'?allOrderedColumns.filter((f:any)=>['code','name','activity_type','loe_scope','duration','remaining_duration','percent_complete_type','progress','wbs'].includes(f.id)||f.plan_date||f.required).sort((a:any,b:any)=>{const rank=(f:any)=>{const ids=['code','name','activity_type','loe_scope','duration','remaining_duration','percent_complete_type','progress','wbs'];const i=ids.indexOf(f.id);return i<0?8:i};return rank(a)-rank(b)}):allOrderedColumns, sortedRecords = records, chosen = data?.rows.find((r: any) => r.id === selected[0]);
    const wbsNodes: Array<{id:string;code:string;name:string;depth:number;parent_id:string|null;lifecycle:string;status:string}> = data?.wbsHierarchy || [];
    const wbsById = new Map(wbsNodes.map(node=>[node.id,node]));
    const [createWbs,setCreateWbs] = useState('');
    const [createActivityType,setCreateActivityType]=useState('任务');
    const createDefaults:Record<string,unknown>|undefined = planningHierarchy === 'activity' && createWbs ? {wbs:[createWbs]} : undefined;
    const childrenOf = new Set(wbsNodes.map(node=>node.parent_id).filter(Boolean));
    const wbsWithActivities = new Set<string>(data?.wbsWithActivities||[]);
    const collapsed = new Set(collapsedWbs);
    function ancestors(id:string) {
      const result = new Set<string>();
      let parent=wbsById.get(id)?.parent_id;
      while(parent&&parent!==id&&!result.has(parent)&&wbsById.has(parent)){
        result.add(parent);parent=wbsById.get(parent)?.parent_id;
      }
      return result;
    }
    const hiddenByAncestor=(id:string)=>[...ancestors(id)].some(parent=>collapsed.has(parent));
    const editOpen=inlineCreate||!!inlineEditing;
    function branchToggle(id:string,label:string,hasContent:boolean){
      if(!hasContent)return <span className="wbs-toggle-spacer" aria-hidden="true"/>;
      const open=!collapsed.has(id);
      return <button type="button" className="wbs-branch-toggle" aria-expanded={open} aria-label={__uiFormat(open?'折叠 WBS {0}':'展开 WBS {0}',[label])} disabled={editOpen}
        onClick={()=>{setSelected([]);setCollapsedWbs(previous=>open?[...previous,id]:previous.filter(v=>v!==id))}}>{open?'−':'+'}</button>;
    }
    function startActivityRow(id:string,before="",after="",type="任务"){
      if(editOpen)return;
      const open=ancestors(id);open.add(id);
      setCollapsedWbs(previous=>previous.filter(key=>!open.has(key)));
      setCreateActivityType(type);setInsertAfter(after);setInsertBefore(before);setCreateWbs(id);setInlineGroup(id);setInlineCreate(true);
    }
    const displayItems:Array<{group?:{id:string;code:string;name:string;depth:number;parent_id:string|null};r?:any;rowIndex?:number;canFold?:boolean}> = [];
    if(hierarchyActive&&planningHierarchy==='activity'&&wbsNodes.length){
      const byWbs=new Map<string,Array<{r:any;rowIndex:number}>>();
      sortedRecords.forEach((r:any,rowIndex:number)=>{const id=r.data.wbs?.[0];const key=id&&wbsById.has(id)?id:'';let group=byWbs.get(key);if(!group){group=[];byWbs.set(key,group)}group.push({r,rowIndex});});
      const showAll=page===1&&!query&&status==='all'&&!columnFilters.conditions.length;
      const contextNodes=new Set<string>();
      if(!showAll)for(const id of [...byWbs.keys(),inlineGroup])if(id){contextNodes.add(id);for(const parent of ancestors(id))contextNodes.add(parent);}
      for(const node of wbsNodes){
        if((!showAll&&!contextNodes.has(node.id))||hiddenByAncestor(node.id))continue;
        const members=byWbs.get(node.id)||[];
        displayItems.push({group:node,canFold:childrenOf.has(node.id)||wbsWithActivities.has(node.id)||members.length>0});
        if(!collapsed.has(node.id))for(const item of members)displayItems.push(item);
      }
      const unassigned=byWbs.get('')||[];
      if(unassigned.length){displayItems.push({group:{id:'',code:'',name:'未归类作业',depth:0,parent_id:null}});for(const item of unassigned)displayItems.push(item);}
    }else sortedRecords.forEach((r:any,rowIndex:number)=>{if(!hierarchyActive||planningHierarchy!=='wbs'||!hiddenByAncestor(r.id))displayItems.push({r,rowIndex});});
    const shownRecords=displayItems.flatMap(item=>item.r?[item.r]:[]);
    const canChangeLevel=(r:any)=>!editOpen&&data?.permissions.write&&table.columns.some((f:any)=>f.id==='parent'&&(!f.lifecycle||f.lifecycle==='active'))&&r&&(!r.lifecycle||r.lifecycle==='active')&&editableRecord(table,r.status);
    const canMoveWbs=selected.length===1&&canChangeLevel(chosen);
    const selectedWbsIndex=selected.length===1?wbsNodes.findIndex(node=>node.id===selected[0]):-1;
    const previousParent=(nodes:typeof wbsNodes,level:number,allowed:(node:typeof wbsNodes[number])=>boolean)=>
      [...nodes].reverse().find(node=>node.depth===level-2&&node.lifecycle==='active'&&node.status!=='obsolete'&&allowed(node));
    const beforeWbsIndex=insertBefore?wbsNodes.findIndex(node=>node.id===insertBefore):-1;
    const newWbsParent=previousParent(wbsNodes.slice(0,beforeWbsIndex>=0?beforeWbsIndex:selectedWbsIndex<0?wbsNodes.length:selectedWbsIndex+1),Number(newWbsLevel),()=>true);
    const promoteTarget = canMoveWbs&&planningHierarchy==='wbs'&&hierarchyActive?wbsMoveTarget(wbsNodes,chosen.id):undefined;
    const defaultDemoteParent = canMoveWbs&&planningHierarchy==='wbs'&&hierarchyActive?wbsDefaultDemoteParent(wbsNodes,chosen.id):undefined;
    async function moveWbs(target:string|null|undefined){
      if(target===undefined||!chosen||!data?.permissions.write||!editableRecord(table,chosen.status))return false;
      try{await api(`/records/${chosen.id}`,'PUT',{data:{parent:target?[target]:[]},version:chosen.version});setSelected([]);reload();notify(__ui('WBS层级已更新，状态为草稿'));return true;}
      catch(error){notify((error as Error).message);return false}
    }
    function startInlineWbs(before=""){if(editOpen)return;setInsertBefore(before);setNewWbsLevel(String((wbsById.get(before)?.depth??0)+1));setInlineCreate(true);}
    function insertRow(r:any){
      if(editOpen||!data?.permissions.create)return;
      if(wbsGrid){startInlineWbs(r.id);return;}
      if(planningHierarchy==='activity'){startActivityRow(r.data.wbs?.[0]||'',r.id);return;}
      setInsertBefore(r.id);setInlineCreate(true);
    }
    async function changeWbsLevel(r:any,level:number){
      const node=wbsById.get(r.id);
      if(levelSaving||!node||!canChangeLevel(r)||level===node.depth+1||!levelOptions.includes(level))return;
      let branchHeight=0;
      for(const other of wbsNodes)if(ancestors(other.id).has(node.id))branchHeight=Math.max(branchHeight,other.depth-node.depth);
      if(level+branchHeight>50){notify(__ui('移动后WBS不能超过50层'));return;}
      const before=wbsNodes.slice(0,wbsNodes.findIndex(other=>other.id===node.id));
      const parent=level===1?null:previousParent(before,level,other=>!ancestors(other.id).has(node.id));
      if(parent===undefined){notify(__ui('上方没有可用的上一级WBS'));return;}
      setLevelSaving(true);
      try{
        await api(`/records/${r.id}`,'PUT',{data:{parent:parent?[parent.id]:[]},version:r.version});
        setSelected([]);reload();notify(__ui('WBS层级已更新，状态为草稿'));
      }catch(error){notify((error as Error).message);}
      finally{setLevelSaving(false);}
    }
    function wbsLevelSelect(r:any,depth:number){
      return <select className="wbs-level-action" required title={__ui('调整WBS层级')}
        aria-label={__uiFormat('调整 {0} 的层级',[r.data.code||r.data.name])} disabled={levelSaving||!canChangeLevel(r)}
        value={depth+1} onDoubleClick={e=>e.stopPropagation()} onChange={e=>void changeWbsLevel(r,Number(e.target.value))}>
        {levelOptions.map(level=><option key={level} value={level}>{__uiFormat('第{0}层',[level])}</option>)}
      </select>;
    }
    const aggregateSummary = data?.summary?.columns || [];
    const [statusBusy,setStatusBusy]=useState(false);
    async function changeStatus(rows:any[],next:string){
      if(statusBusy||!rows.length)return;
      setStatusBusy(true);
      try{await api(`/tables/${table.id}/confirm-status`,'POST',{status:next,records:rows.map(r=>({id:r.id,version:r.version}))});
        if(status!=='all'&&status!==next){setStatus('all');setPage(1);}
        setSelected([]);reload();notify(__uiFormat('已修改{0}条记录的状态',[rows.length]));
      }catch(e){notify((e as Error).message);}finally{setStatusBusy(false);}
    }
    useEffect(()=>{
        if(previousViewOrder.current===viewOrder)return;
        previousViewOrder.current=viewOrder;
        setPage(1);setSelected([]);
    },[viewOrder]);
    async function action(fn: () => Promise<unknown>, message: string) {
        try {
            await fn();
            reload();
            setSelected([]);
            notify(message);
        }
        catch (e) {
            notify((e as Error).message);
        }
    }
    const inlineNode=wbsById.get(inlineGroup);
    const appendRow=()=>wbsGrid?startInlineWbs():planningHierarchy==="activity"?startActivityRow(""):(setInsertBefore(""),setInlineCreate(true));
    async function finishInline(created:boolean){
      const result=await refreshRows(()=>{
        if(created){setInsertAfter('');setInsertBefore('');setInlineGroup('');setInlineCreate(false);}
        else setInlineEditing(null);
        notify(__ui(created?'新行已保存为草稿':'该行已保存'));
      });
      if(result&&relationContext)void refreshRelations().catch(()=>{});
    }
    const inlineRow=inlineCreate&&data?.permissions.create?<InlineRecordRow table={table} columns={orderedColumns}
      leadingCells={wbsGrid?<td className="wbs-level-column"><select name="wbs_level" aria-label={__ui('层级 *')} required value={newWbsLevel} onChange={e=>setNewWbsLevel(e.target.value)}><option value="">{__ui('请选择WBS层级')}</option>{levelOptions.map(level=><option key={level} value={level}>{__uiFormat('第{0}层',[level])}</option>)}</select></td>:null}
      renderCell={wbsGrid?(field:any)=>field.id==='parent'?<span>{newWbsParent?[newWbsParent.code,newWbsParent.name].filter(Boolean).join(' · '):'—'}</span>:null:undefined}
      prepareData={wbsGrid?(value:Record<string,unknown>,form:FormData)=>{
        const level=Number(form.get('wbs_level'));
        if(!levelOptions.includes(level))throw Error(__ui('请选择WBS层级'));
        if(level>1&&!newWbsParent)throw Error(__ui('上方没有可用的上一级WBS'));
        value.parent=level===1?[]:[newWbsParent!.id];
      }:undefined}
      focusField={wbsGrid?'wbs_level':planningHierarchy==='activity'?'name':undefined} allowCancel insertBefore={insertBefore} insertAfter={insertAfter}
      defaults={{...(table.is_agenda?{owner:boot.user.username,due_date:today(),priority:'普通',recurrence:'不重复',done:false,...createRequest?.data}:{}),...(planningHierarchy==='activity'?{progress:0,activity_type:createActivityType,...(createActivityType===LOE?{duration:0}:{}),...createRequest?.data}:{}),...createDefaults}}
      defaultReferences={inlineNode?{wbs:{items:[{id:inlineNode.id,label:[inlineNode.code,inlineNode.name].filter(Boolean).join(' · ')}],restricted:false}}:undefined}
      extraCells={relationContext&&!loeView?relationColumns.map(column=><td key={column.id}><span className="muted">{__ui(column.id==='free_float'||column.id==='total_float'?'确认有效后计算':'保存作业后设置')}</span></td>):null}
      onCancel={()=>{setInsertAfter('');setInsertBefore('');setInlineGroup('');setInlineCreate(false)}}
      onSaved={()=>finishInline(true)}/>:null;
    return (<>{printMounted&&<div className="pf-designer-view" data-active={printForms} style={{display:printForms?undefined:"none"}}><PrintForms activeView={printForms} table={table} rows={data?.rows||[]} selected={selected} onClose={()=>setPrintForms(false)}/></div>}<div style={{display:printForms?"none":undefined}} className={"record-layout spreadsheet-layout" + (data?.permissions.confirm||planningHierarchy==='wbs'?" status-confirmable":"") + " inspector-removed"}>
      <section className="record-main">
        <div className="sheet-heading" title={reviewMode(table)==='supervisor'?__ui('草稿仅录入相关人员、部门主管及管理员可见；主管确认有效后共享和计算。'):table.description}>
          <PageTitle icon={Table2} title={table.name}/>{headingTools}<button style={{marginLeft:"auto"}} disabled={!data?.permissions.export||editOpen} onClick={()=>{setPrintMounted(true);setPrintForms(true)}}>{__ui("打印表单")}</button>
        </div>
        <div className="data-toolbar">
          {planningHierarchy==='activity'&&(data?.permissions.write||data?.permissions.manage)&&<ActivityCodeTools rows={displayItems.filter(item=>item.r).map(item=>item.r)} selected={selected} disabled={editOpen} onSaved={()=>{void refreshRows();void refreshRelations()}}/>}
          {__ui((data?.permissions.write || data?.permissions.create) && (<>
              <button className="primary" disabled={!data?.permissions.create||editOpen} onClick={() => {
                if(planningHierarchy==='activity'){startActivityRow(hierarchyActive&&displayItems.some(item=>item.group?.id===createWbs)?createWbs:"");return;}
                if(wbsGrid){startInlineWbs();return;}
                setInsertBefore("");setInlineCreate(true);
              }}><Plus size={16}/>{__ui("新增记录")}</button>
              {planningHierarchy==='activity'&&table.columns.some((f:any)=>f.id==='loe_scope')&&<button disabled={!data?.permissions.create||editOpen} onClick={()=>{setLoeView(true);startActivityRow(createWbs,'','',LOE)}}>{__ui('新增LOE')}</button>}
              {planningHierarchy==='activity'&&table.columns.some((f:any)=>f.id==='loe_scope')&&<button disabled={editOpen} onClick={()=>setLoeView(v=>!v)}>{__ui(loeView?'显示全部作业列':'LOE列布局')}</button>}
              <button disabled={editOpen||!data?.permissions.write||selected.length!==1||!editableRecord(table,chosen?.status)||(chosen?.lifecycle&&chosen.lifecycle!=='active')} onClick={()=>setInlineEditing(chosen)}>
                <PenLine size={16}/>{__ui("编辑")}</button>
              {reviewMode(table)==='approval'&&<button disabled={!data?.permissions.write||selected.length!==1||!['draft','rejected'].includes(chosen?.status)} onClick={()=>setApprove(chosen)}><Send size={16}/>{__ui('提交重大事项审批')}</button>}
            </>))}
          {data?.permissions.delete&&selected.length>0&&<button className="danger"
            title={__ui('只能删除活动的草稿或已退回记录')}
            disabled={editOpen||selected.some(id=>{const r=records.find((row:any)=>row.id===id);return !r||r.lifecycle!=='active'||!['draft','rejected'].includes(r.status)})}
            onClick={()=>{setDeleteRecords(records.filter((r:any)=>selected.includes(r.id)).map((r:any)=>({id:r.id,version:r.version})));setDialog('delete')}}>
            <Trash2 size={16}/>{__uiFormat('删除行（{0}）',[selected.length])}
          </button>}
          {data?.permissions.confirm&&<select title={__ui('点击状态列即可修改；勾选左侧记录后可批量修改。')} aria-label={__ui('批量修改状态')} value="" disabled={statusBusy||!selected.length||selected.some(id=>{const r=records.find((r:any)=>r.id===id);return !r||r.status==='pending'||r.lifecycle&&r.lifecycle!=='active';})} onChange={e=>{if(e.target.value)void changeStatus(records.filter((r:any)=>selected.includes(r.id)),e.target.value);}}><option value="">{selected.length?__uiFormat('批量修改状态（已选{0}条）',[selected.length]):__ui('批量修改状态')}</option><option value="approved">{__ui('有效')}</option><option value="draft">{__ui('草稿')}</option><option value="obsolete">{__ui('作废')}</option></select>}
          {planningHierarchy==='wbs'&&<><button title={__ui('将选中WBS移到父节点的上一级；先选择可编辑的草稿行')} disabled={!data?.permissions.write||promoteTarget===undefined||!editableRecord(table,chosen?.status)} onClick={()=>void moveWbs(promoteTarget)}>{__ui('升级')}</button><button title={__ui('直接归入前一个编码WBS的下一层；先选择可编辑的草稿行')} disabled={!data?.permissions.write||defaultDemoteParent===undefined||!editableRecord(table,chosen?.status)} onClick={()=>void moveWbs(defaultDemoteParent)}>{__ui('降级')}</button></>}
          {planningHierarchy&&!hierarchyActive&&<button onClick={()=>{setGroupBy([]);setSort(null);setPage(1)}}>{__ui('恢复WBS层级')}</button>}
          {!wbsGrid&&<button onClick={() => setGroupBy(groupBy.length
            ? []
            : ([table.columns[0]?.id].filter(Boolean) as string[]))}>{__ui("归类")}</button>}<ColumnFilterButton columns={filterColumns} value={columnFilters} disabled={editOpen} onChange={v=>{setSelected([]);setPage(1);setCollapsedWbs([]);setColumnFilters(v)}}/>
          {__ui(groupBy.length > 0 && (<div className="sort-by-strip sheet-group-controls">
              {__ui([0, 1, 2].map((i) => (<label key={i}>
                  Sort by {i + 1}
                  <select value={groupBy[i] || ""} onChange={(e) => setGroupBy((v) => {
                    const n = [...v];
                    if (e.target.value)
                        n[i] = e.target.value;
                    else
                        n.splice(i, 1);
                    return n.slice(0, 3);
                })}>
                    <option value="">{__ui("未选择")}</option>
                    {__ui(table.columns.map((f: any) => (<option key={f.id} value={f.id}>
                        {f.name}
                      </option>)))}
                  </select>
                </label>)))}
              <button onClick={() => setGroupBy([])}>{__ui("取消归类")}</button>
            </div>))}
          {__ui(planningHierarchy==='activity' && wbsNodes.length>0 && <select aria-label={__ui('新增作业所属WBS')} disabled={editOpen} value={createWbs} onChange={e=>setCreateWbs(e.target.value)}><option value="">{__ui('新增作业：未归类')}</option>{wbsNodes.map(node=><option key={node.id} value={node.id}>{'　'.repeat(node.depth)}{node.code} · {node.name}</option>)}</select>)}
          {__ui(planningHierarchy && hierarchyActive && (planningHierarchy==='wbs'||wbsNodes.length>0) && <span className="table-view-chip">{__ui('WBS排序：')}{data?.wbsSortName||__ui('编码')} {wbsSort.direction===1?'↑':'↓'}</span>)}
          <div className="sheet-toolbar-filters">
          <SearchBox value={search} onChange={setSearch} placeholder={__ui("搜索全部授权数据…")}/>
          <select aria-label={__ui("审核状态筛选")} value={status} onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setSelected([]);
        }}>
            <option value="all">{__ui("全部状态")}</option>
            {__ui(["draft", "pending", "approved", "rejected", "obsolete"].map((s) => (<option value={s} key={s}>
                  {__ui(({
                draft: "草稿",
                pending: "待审核",
                approved: "有效",
                rejected: "已退回",
                obsolete: "作废",
            } as any)[s])}
                </option>)))}
          </select>
          {groupBy.length>0&&<span className="table-view-chip">
            {__ui(groupBy.length
            ? `归类：${groupBy.map((id) => table.columns.find((f: any) => f.id === id)?.name).join(" → ")}`
            : "未归类")}
          </span>}
          {__ui(groupBy.length > 0 &&
            aggregateSummary.map((x: any) => (<span key={x.name} className="table-view-chip">
                {x.name}：{__ui(x.invalidCount ? `计算错误/非数值 ${x.invalidCount} 条` : `和 ${x.sum} · 最大 ${x.max ?? '—'} · 最小 ${x.min ?? '—'}`)}
              </span>)))}
          {__ui(groupBy.length > 0 && data?.summary && <span className="help">{__ui("统计全部匹配的 ")}{__ui(data.summary.count)}{__ui(" 条记录（空值不参与）")}</span>)}
          <TableTools>
            <div className="sheet-tools-section">          <button onClick={()=>setDialog("properties")}>
            {__ui("字段属性与权限")}
          </button>
          {data?.permissions.manage&&!table.is_agenda&&<select aria-label={__ui('数据确认方式')} value={reviewMode(data.table||table)} onChange={e=>void action(()=>api(`/tables/${table.id}/review-policy`,'PUT',{review_mode:e.target.value}),'数据确认方式已更新')}><option value="supervisor">{__ui('普通数据：主管确认')}</option><option value="approval">{__ui('重大事项：申请审批')}</option></select>}
          {__ui(data?.permissions.manage && (<button onClick={() => openField()}>
              <Columns3 size={16}/>{__ui("新增字段")}</button>))}
</div>
            <div className="sheet-tools-section">          {__ui(data?.permissions.create && (<button onClick={() => setDialog("file-import")}>
              <Upload size={15}/>{__ui("导入 Excel / CSV")}</button>))}
          {__ui(data?.permissions.export && (<button onClick={() => void action(async () => {
                const r = await fetch(`/api/tables/${table.id}/export`);
                if (!r.ok)
                    throw Error((await r.json()).error);
                const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
                a.href = url;
                a.download = table.name + ".xlsx";
                a.click();
                URL.revokeObjectURL(url);
            }, "Excel 导出完成")}>
              <Download size={15}/>{__ui("导出")}</button>))}
          {data?.permissions.manage&&!table.is_mapping&&!table.is_view&&<><button onClick={()=>{copyTableSource(boot.user.id,table);notify(__ui("已复制表，可切换项目后在数据目录粘贴"))}}>{__ui("复制数据表")}</button><button onClick={()=>setDialog("transfer")}>{__ui("跨项目复制或移动数据表")}</button></>}
          <button title={__ui("保存当前筛选视图")} onClick={() => setDialog("view")}>
            <Save size={15}/>
            <span className="hide-small">{__ui("保存视图")}</span>
          </button></div>
          </TableTools>
          </div>
        </div>
        {__ui(!!views?.length && (<div className="view-strip">
            {__ui(mode === "usage" ? (<span>{__ui("导出当前授权范围内的数据；正式统计仅使用有效记录。")}</span>) : (<>
                <span>{__ui("个人视图")}</span>
                {__ui(views?.map((v) => (<button key={v.id} onClick={() => {
                        setSearch(v.config.search);
                        setStatus(v.config.status);
                        setPage(1);
                    }}>
                    {v.name}
                  </button>)))}
                {__ui(!views?.length && <small>{__ui("设置筛选条件后点击“保存视图”")}</small>)}
              </>))}
          </div>))}
        {__ui(error ? (<ErrorBox message={__ui(error)}/>) : !data ? (<Loading />) : (<div className="grid-scroll" aria-busy={loading} onClick={e=>{if(e.target===e.currentTarget&&data.permissions.create&&!editOpen)appendRow()}}>
            <table className="data-grid" data-stable-grid="" data-style-key={table.source_table_id||table.id}>
              <thead>
                <tr>
                  <th className="check-cell" data-style-column="__row">
                    <input type="checkbox" aria-label={__ui("选择本页")} checked={shownRecords.length > 0 &&
                shownRecords.every((r: any) => selected.includes(r.id))} onChange={(e) => setSelected(e.target.checked ? shownRecords.map((r: any) => r.id) : [])}/>
                  </th>
                  {wbsGrid&&<th className="wbs-level-column" data-style-column="__level">{__ui('层级 *')}</th>}
                  {__ui(orderedColumns.map((f: any) => (<th data-style-column={f.id} key={f.id} ref={menu===f.id?openColumnHeader:undefined} draggable onDragStart={e => {e.dataTransfer.setData("text/plain",f.id);e.dataTransfer.effectAllowed="move";setDragColumn(f.id)}} onDragEnd={()=>setDragColumn(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => {
                    if (!dragColumn || dragColumn === f.id)
                        return;
                    setColumnOrder((v) => {
                        const n = [...v], from = n.indexOf(dragColumn), to = n.indexOf(f.id);
                        if(from<0||to<0)return v;
                        n.splice(from, 1);
                        n.splice(to, 0, dragColumn);
                        return n;
                    });
                    setDragColumn(null);
                }}>
                      <button className={field?.id === f.id ? "column-selected" : ""} onClick={() => {
                    setField(f);
                    setMenu(menu === f.id ? null : f.id);
                }}>
                        {__ui(f.name)}{f.required&&!f.auto_increment&&!f.auto_code&&!isSystemField(f)&&f.type!=="formula"&&<span className="required-column-star" title={__ui("必填")} aria-label={__ui("必填")}> *</span>}
                        {__ui(f.unit && <small> ({__ui(f.unit)})</small>)}
                        <span className="column-menu-arrow" aria-hidden="true"/>
                      </button>
                      {menu===f.id&&<GridColumnMenu
                        onSort={direction=>{if(wbsGrid)setWbsSort({id:f.id,direction});else setSort({id:f.id,direction});setMenu(null)}}
                        onGroup={!wbsGrid?()=>{setGroupBy(v=>v.includes(f.id)?v:[...v,f.id].slice(0,3));setMenu(null)}:undefined}
                        onInsert={data?.permissions.manage?side=>openField({anchor:f.id,side}):undefined}
                        onEdit={data?.permissions.manage?()=>{setField(f);setMenu(null);setDialog('edit-column')}:undefined}
                        onDelete={data?.permissions.manage?()=>{setField(f);setMenu(null);setDialog('delete-column')}:undefined}/>}
                    </th>)))}
                  {__ui(relationContext && !loeView && relationColumns.map(column => <th data-style-column={column.id} key={`relation-${column.id}`}>{column.name}</th>))}
                  <th data-style-column="__status">{__ui("状态")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(displayItems.map((item,itemIndex)=>item.group ? <Fragment key={`wbs-${item.group.id||'none'}`}>
                  <tr className={`group-row wbs-group-row${item.group.id?' wbs-band':''}`} style={bandStyle(item.group.depth)}><td colSpan={orderedColumns.length+relationCount+2} style={{paddingLeft:12+item.group.depth*18}}>
                    {item.group.id&&branchToggle(item.group.id,item.group.code||item.group.name,!!item.canFold)}
                    {item.group.id&&<span className="wbs-level-badge">{__uiFormat('第{0}层',[item.group.depth+1])}</span>}
                    {item.group.id?[item.group.code,item.group.name].filter(Boolean).join(' · '):__ui(item.group.name)}
                    {data?.permissions.create&&item.group.id&&<button type="button" className="wbs-add-activity" disabled={editOpen} onClick={()=>startActivityRow(item.group!.id)}>{__ui('＋ 新增作业')}</button>}
                  </td></tr>
                  {!insertAfter&&!insertBefore&&inlineGroup&&item.group.id===inlineGroup?inlineRow:null}
                </Fragment> : ((r:any,rowIndex:number)=>(<Fragment key={r.id}>
                    {__ui(groupBy.length > 0 &&
                    (rowIndex === 0 ||
                        groupBy.some((id) => String(sortedRecords[rowIndex - 1].data[id] ?? "未填写") !== String(r.data[id] ?? "未填写"))) && (<tr className="group-row">
                          <td colSpan={orderedColumns.length + relationCount + 2 + Number(wbsGrid)}>{__ui("归类：")}{__ui(groupBy
                        .map((id) => String(r.data[id] ?? "未填写"))
                        .join(" / "))}
                            <div className="help">{__ui(data?.groupSummaries?.find((g: any) => g.key === tableGroupKey(r, groupBy))?.columns.map((x: any) => `${x.name}：${x.invalidCount ? '存在计算错误' : `和 ${x.sum} · 最大 ${x.max ?? '—'} · 最小 ${x.min ?? '—'}`}`).join('；'))}</div>
                          </td>
                        </tr>))}
                    {!insertAfter&&insertBefore===r.id&&inlineRow}
                    {__ui(inlineEditing?.id === r.id ? (<InlineRecordRow key={r.id} table={table} columns={orderedColumns} record={inlineEditing} rowNumber={(page-1)*50+rowIndex+1} rowClass={(selected.includes(r.id)?"selected ":"")+(planningHierarchy==='wbs'&&hierarchyActive&&wbsById.has(r.id)?"wbs-band":"")} rowStyle={planningHierarchy==='wbs'&&hierarchyActive&&wbsById.has(r.id)?bandStyle(wbsById.get(r.id)!.depth):undefined} allowCancel leadingCells={wbsGrid?<td className="wbs-level-column">{wbsById.has(r.id)?__uiFormat('第{0}层',[wbsById.get(r.id)!.depth+1]):'—'}</td>:null} cellInset={(f:any)=>planningHierarchy==='wbs'&&hierarchyActive&&f.id==='name'&&wbsById.has(r.id)?8+wbsById.get(r.id)!.depth*18+26:undefined} fieldClass={(f:any)=>f.id==='name'&&r.status==='approved'&&criticalRecords.has(r.id)?'plan-critical-name':f.id==='name'&&r.status==='approved'&&nearCriticalRecords.has(r.id)?'plan-near-critical-name':''} focusField={inlineEditing._focusField} extraCells={relationContext&&!loeView ? <PlanRelationCells record={r} context={relationContext} onResourceChange={refreshRelations}/> : null} onCancel={() => setInlineEditing(null)} onSaved={()=>finishInline(false)}/>) : (<tr key={r.id} data-sheet-record={r.id} className={(selected.includes(r.id)?"selected ":"")+(planningHierarchy==='wbs'&&hierarchyActive&&wbsById.has(r.id)?"wbs-band":"")} style={planningHierarchy==='wbs'&&hierarchyActive&&wbsById.has(r.id)?bandStyle(wbsById.get(r.id)!.depth):undefined}>
                        <td className="check-cell sheet-row-header">
                          {data.permissions.create&&!editOpen&&<RowInsertHandle onInsert={()=>insertRow(r)}/>}
                          {data.permissions.create&&!editOpen&&planningHierarchy==='activity'&&hierarchyActive&&(!displayItems[itemIndex+1]||displayItems[itemIndex+1].group)&&
                            <RowInsertHandle position="after" label={__ui('在当前WBS末尾新增作业')} onInsert={()=>{
                              const next=displayItems.slice(itemIndex+1).find(item=>item.r)?.r;
                              startActivityRow(r.data.wbs?.[0]||'',next?.id||'',r.id);
                            }}/>}
                          <span className="sheet-row-number" aria-hidden="true">{(page-1)*50+rowIndex+1}</span>
                          <input aria-label={__uiFormat("选择记录 {0}", [r.id])} type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => e.target.checked
                        ? [...s, r.id]
                        : s.filter((id) => id !== r.id))}/>
                        </td>
                        {wbsGrid&&<td className="wbs-level-column">{wbsById.has(r.id)?wbsLevelSelect(r,wbsById.get(r.id)!.depth):'—'}</td>}
                        {__ui(orderedColumns.map((f: any) => (<td key={f.id} data-sheet-field={f.id} tabIndex={0} style={planningHierarchy==='wbs'&&hierarchyActive&&f.id==='name'?{minWidth:Math.max(160,160+(wbsById.get(r.id)?.depth??0)*18)}:undefined} title={f.image_upload?f.name:r.references?.[f.id]?r.references[f.id].items.map((v:any)=>v.label).join("；"):displayValue(r.data[f.id])} className={[numericTypes.includes(f.type)?"numeric":"",f.id==='name'&&r.status==='approved'&&criticalRecords.has(r.id)?"plan-critical-name":f.id==='name'&&r.status==='approved'&&nearCriticalRecords.has(r.id)?"plan-near-critical-name":""].filter(Boolean).join(" ")} onDoubleClick={()=>{
 if(!editOpen&&!f.derived_reference&&f.type!=='formula'&&!isSystemField(f)&&!f.auto_increment&&(!f.lifecycle||f.lifecycle==='active')&&data.permissions.write&&editableRecord(table,r.status)&&(!r.lifecycle||r.lifecycle==='active')&&!r.references?.[f.id]?.restricted){setInlineCreate(false);setInlineEditing({...r,_focusField:f.id});}
 }} onClick={()=>{
 if(!editOpen&&(isReference(f)||f.image_upload)&&data.permissions.write&&editableRecord(table,r.status)&&(!r.lifecycle||r.lifecycle==="active")&&!r.references?.[f.id]?.restricted){setInlineCreate(false);setInlineEditing({...r,_focusField:f.id});}
 }}>
                            {__ui(f.image_upload?<PhotoValue value={r.data[f.id]} name={f.name}/>:planningHierarchy==='wbs' && hierarchyActive && f.id==='name' && wbsById.has(r.id) ? <span className="wbs-name" style={{paddingLeft:wbsById.get(r.id)!.depth*18}}>{branchToggle(r.id,r.data.code||r.data.name,childrenOf.has(r.id))}{displayValue(r.data[f.id])}</span> : planningHierarchy==='activity' && f.id==='wbs' && !r.references?.wbs?.restricted && wbsById.has(r.data.wbs?.[0]) ? <span className="wbs-linked-name">{[wbsById.get(r.data.wbs[0])!.code,wbsById.get(r.data.wbs[0])!.name].filter(Boolean).join(' · ')}</span> : r.data[f.id] === null ||
                            r.data[f.id] === undefined ? (<span className="muted">—</span>) : typeof r.data[f.id] === "boolean" ? (r.data[f.id] ? ("是") : ("否")) : r.references?.[f.id] ? (r.references[f.id].items
                            .map((v: any) => v.label)
                            .join("；") +
                            (r.references[f.id].restricted
                                ? "（部分关联不可见）"
                                : "")) : (displayValue(r.data[f.id])))}
                          </td>)))}
                        {__ui(relationContext && !loeView && <PlanRelationCells record={r} context={relationContext} onResourceChange={refreshRelations}/>)}
                        <td>
                          {data.permissions.confirm&&r.status!=='pending'&&(!r.lifecycle||r.lifecycle==='active')?<select className={'record-status-select '+r.status} aria-label={__uiFormat('第{0}行数据状态',[(page-1)*50+rowIndex+1])} value={r.status} disabled={statusBusy} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} onChange={e=>void changeStatus([r],e.target.value)}>
                            {r.status==='rejected'&&<option value="rejected" disabled>{__ui('退回')}</option>}
                            <option value="draft">{__ui('草稿')}</option><option value="approved">{__ui('有效')}</option><option value="obsolete">{__ui('作废')}</option>
                          </select>:<span className={"status "+r.status}>{__ui(({draft:"草稿",pending:"待审批",approved:"有效",rejected:"退回",obsolete:"作废"} as any)[r.status]||r.status)}</span>}
                        </td>
                      </tr>))}
                    {insertAfter===r.id&&inlineRow}
                  </Fragment>))(item.r,item.rowIndex!)))}
                {!insertAfter&&inlineRow && (!insertBefore||!shownRecords.some(r=>r.id===insertBefore)) && (!inlineGroup||!hierarchyActive) && inlineRow}
                {__ui(data?.permissions.create && !inlineCreate && (<tr className="record-add-space" onClick={()=>{if(!editOpen)appendRow()}}>
                    <td colSpan={orderedColumns.length + relationCount + 2 + Number(wbsGrid)}>
                      <button type="button" >{__ui("点击此处新增...")}</button>
                    </td>
                  </tr>))}
              </tbody>
            </table>
            <SheetScrollSpace/><SheetNavigation/>
            {__ui(!displayItems.length && <Empty text={__ui("没有符合条件的记录")}/>)}
          </div>))}
        {dialog==="transfer"&&<TransferTable table={table} onClose={()=>setDialog("")}/>}
        <div className="table-footer">
          <span>{__ui("已选择 ")}{__ui(selected.length)}{__ui(" 条记录")}</span>
          <span>{__ui("每页 50 条 · 共 ")}{__ui(data?.total || 0)}{__ui(" 条")}</span>
          <button disabled={page <= 1} onClick={() => {
            setPage((p) => p - 1);
            setSelected([]);
        }}>{__ui("上一页")}</button>
          <span className="page-number">{__ui(page)}</span>
          <button disabled={page * 50 >= (data?.total || 0)} onClick={() => {
            setPage((p) => p + 1);
            setSelected([]);
        }}>{__ui("下一页")}</button>
        </div>
        {__ui(chosen && (<div className="record-actions">
            <button disabled={selected.length !== 1} onClick={() => {
                setEditing(chosen);
                setDialog("links");
            }}>{__ui("附件与作业关联")}</button>
            <span>{__ui("录入人：")}{__ui(chosen.creator)}{__ui(" · 版本 ")}{__ui(chosen.version)}
            </span>
            {__ui(data?.permissions.create && reviewMode(table)==='approval' && chosen.status === "approved" && (<button onClick={() => void action(() => api(`/records/${chosen.id}/change`, "POST", {}), "变更草稿已创建，原审核版本保持有效")}>{__ui("发起变更")}</button>))}
          </div>))}
      </section>
      {dialog === "properties" && <Modal title={__ui("字段属性与权限")} onClose={()=>setDialog("")}>
          {__ui(table.is_mapping && <p className="help">{__ui("当前为public只读映射。下方说明源表权限；修改数据请打开部门源表。")}</p>)}
          <PermissionExplanation tableId={table.source_table_id || table.id} recordId={chosen?.id}/>
          <div className="panel">
            <h3>{__ui("字段属性")}<SlidersHorizontal size={16}/>
            </h3>
            {__ui(field && (<>
                <div className="field-identity">
                  <Database size={24}/>
                  <div>
                    <strong>{field.name}</strong>
                    <small>{__ui(types[field.type])}{__ui("类型字段")}</small>
                  </div>
                </div>
                <dl>
                  <dt>{__ui("字段标识")}</dt>
                  <dd>{__ui(field.id)}</dd>
                  <dt>{__ui("类型")}</dt>
                  <dd>{__ui(types[field.type])}</dd>
                  <dt>{__ui("单位")}</dt>
                  <dd>{__ui(field.unit || "—")}</dd>
                  <dt>{__ui("必填")}</dt>
                  <dd>{__ui(field.required ? "是" : "否")}</dd>
                  <dt>{__ui("权限")}</dt>
                  <dd>
                    {__ui(isSystemField(field) || field.type === "formula"
                ? field.type === "formula"
                    ? "公式计算 · 只读"
                    : "系统维护 · 只读"
                : data?.permissions.write &&
                    (!field.lifecycle || field.lifecycle === "active")
                    ? "可编辑草稿"
                    : "只读")}
                  </dd>
                  {__ui(field.type === "decimal" && (<>
                      <dt>{__ui("精度 / 小数位")}</dt>
                      <dd>
                        {__ui(field.precision ?? 38)} / {__ui(field.scale ?? 2)}
                      </dd>
                    </>))}
                  {__ui(field.options && (<>
                      <dt>{__ui("允许选项")}</dt>
                      <dd>{__ui(field.options.join("、"))}</dd>
                    </>))}
                </dl>
              </>))}
          </div>
      </Modal>}

      {__ui(dialog === "links" && editing && (<RecordLinks readOnly={!!table.is_mapping} recordId={editing.id} onClose={() => setDialog("")} onUpdate={reload}/>))}
      {__ui(dialog === "file-import" && (<ImportWizard table={table} onClose={() => setDialog("")}/>))}
      {__ui(dialog === "record" && (<Modal title={__ui(editing ? "编辑记录" : "新增记录")} onClose={() => setDialog("")}>
          <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                const value = Object.fromEntries(table.columns
                    .filter((f: any) => !(wbsGrid&&f.id==='parent') && !f.auto_increment && !isSystemField(f) &&
                    f.type !== "formula" &&
                    !(isReference(f) &&
                        editing?.references?.[f.id]?.restricted))
                    .map((f: any) => {
                    if (f.lifecycle && f.lifecycle !== "active")
                        return [f.id, editing?.data[f.id] ?? null];
                    try {
                        if (f.type === "multi_select")
                            return [f.id, d.getAll(f.id).map(String)];
                        return [f.id, inputValue(f, String(d.get(f.id) ?? ""))];
                    }
                    catch (error) {
                        throw Error(`${f.name}：${(error as Error).message}`);
                    }
                }));
                if(wbsGrid&&!editing){
                    const level=Number(newWbsLevel);
                    if(!Number.isInteger(level)||level<1||level>50)throw Error(__ui('请选择WBS层级'));
                    if(level>1&&!newWbsParent)throw Error(__ui('上方没有可用的上一级WBS'));
                    value.parent=level===1?[]:[newWbsParent!.id];
                }
                if (editing)
                    await api(`/records/${editing.id}`, "PUT", {
                        data: value,
                        version: editing.version,
                        reference_expected: Object.fromEntries(table.columns
                            .filter((f: any) => f.type === "backlink")
                            .map((f: any) => [f.id, editing.data[f.id] ?? []])),
                    });
                else
                    await api(`/tables/${table.id}/records`, "POST", {
                        data: value,insert_before:insertBefore||undefined,
                    });
                setDialog("");
                setInsertBefore("");
                if (!editing &&
                    !insertBefore &&
                    !query &&
                    status === "all" &&
                    !sort &&
                    !groupBy.length)
                    setPage(Math.max(1, Math.ceil(((data?.total || 0) + 1) / 50)));
                reload();
                notify("记录已保存为草稿");
            }}>
            {wbsGrid&&!editing&&<>
              <Field label={__ui('层级 *')}><select required value={newWbsLevel} onChange={e=>setNewWbsLevel(e.target.value)}><option value="">{__ui('请选择WBS层级')}</option>{levelOptions.map(level=><option key={level} value={level}>{__uiFormat('第{0}层',[level])}</option>)}</select></Field>
              {Number(newWbsLevel)>1&&<p className="help">{newWbsParent?[__ui('自动归入'),newWbsParent.code,newWbsParent.name].filter(Boolean).join(' · '):__ui('上方没有可用的上一级WBS')}</p>}
            </>}
            {__ui(table.columns
                .filter((f: any) => f.type !== "formula"&&!(wbsGrid&&f.id==='parent'))
                .map((f: any) => (<Field key={f.id} group={f.type === "multi_select" || isReference(f)} label={f.name +
                    (f.required&&!f.auto_increment&&!f.auto_code ? " *" : "") +
                    (f.lifecycle && f.lifecycle !== "active"
                        ? "（只读）"
                        : "") +
                    (f.unit ? `（${f.unit}）` : "")}>
                  <ValueEditor field={editing?.exempt_fields?.includes(f.id)?{...f,required:false}:f} value={editing?(editing.plan_date_inputs&&Object.hasOwn(editing.plan_date_inputs,f.id)?editing.plan_date_inputs[f.id]:editing.data[f.id]):createDefaults?.[f.id]} tableId={table.id} reference={editing?.references?.[f.id]??(!editing&&f.id==='wbs'&&createWbs&&wbsById.has(createWbs)?{items:[{id:createWbs,label:`${wbsById.get(createWbs)?.code} · ${wbsById.get(createWbs)?.name}`}],restricted:false}:undefined)}/>
                </Field>)))}
          </Form>
        </Modal>))}
      {__ui(dialog === "field" && (<Modal title={__ui(columnInsert?(columnInsert.side==='left'?'左侧插入列':'右侧插入列'):"新增字段")} onClose={() => setDialog("")} wide>
          <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                await api(`/tables/${table.id}/columns`, "POST", {
                    id: d.get("id"),
                    position:columnInsert||undefined,
                    name: d.get("name"),
                    type: d.get("type"),
                    unit: d.get("unit"),
                    required: d.get("required") === "on",
                    preserve_existing:d.get("preserve_existing")==="on",
                    ...fieldOptions(d),
                });
                if(columnInsert)setColumnOrder(order=>{
                    const next=[...order], index=next.indexOf(columnInsert.anchor);
                    next.splice(index<0?next.length:index+Number(columnInsert.side==='right'),0,String(d.get('id')));
                    return next;
                });
                setColumnInsert(null);setDialog("");
                reload();
                notify("字段已添加");
            }}>
            <Field label={__ui("字段名称")}>
              <input name="name" required/>
            </Field>
            <Field label={__ui("字段标识")} hint={__ui("英文字母开头，允许数字和下划线；标识不随显示名称变化。")}>
              <input name="id" required pattern="[a-zA-Z][a-zA-Z0-9_]{0,39}"/>
            </Field>
            <FieldTypeOptions fields={table.columns}/>
            <Field label={__ui("单位")}>
              <input name="unit" maxLength={20}/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(dialog === "edit-column" && field && (<Modal title={__uiFormat("修改列 · {0}", [field.name])} onClose={() => setDialog("")} wide>
          <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                await api(`/objects/tables/${table.id}/columns/${field.id}`, "PATCH", {
                    version: table.object_version || 1,
                    preserve_existing:d.get("preserve_existing")==="on",
                    name: String(d.get("name")),
                    unit: String(d.get("unit") || ""),
                    ...(!isReference(field) && !(wbsGrid&&field.id==='code') ? { definition: { id: field.id, name: String(d.get("name")), unit: String(d.get("unit") || ""), type: d.get("type"), required: d.get("required") === "on", ...fieldOptions(d) } } : {}),
                });
                setDialog("");
                reload();
                notify("列已修改");
            }}>
            <Field label={__ui("列名称")}>
              <input name="name" defaultValue={field.name} required maxLength={120}/>
            </Field>
            <Field label={__ui("单位")}>
              <input name="unit" defaultValue={field.unit || ""} maxLength={20}/>
            </Field>
            <p className="help">{__ui("字段标识：")}{__ui(field.id)}{__ui("。标识保持不变，保存前校验已有数据；不兼容的类型变更不会写入。")}</p>
            {__ui(wbsGrid&&field.id==='code'?<p className="help">{__ui('WBS留空时按层级生成编码，例如1、1.1、1.1.1。')}</p>:!isReference(field) ? <FieldTypeOptions key={field.id} initial={field} fields={table.columns.filter((f: any) => f.id !== field.id && f.lifecycle !== "deleted")}/> : <p className="help">{__ui("引用关系列可修改名称和单位；关联结构由引用管理维护。")}</p>)}
          </Form>
        </Modal>))}
      {__ui(dialog === "delete-column" && field && (<Confirm title={__ui("删除列")} detail={__uiFormat("确认删除「{0}」？已有数据、公式依赖或计划核心字段等保护条件会阻止删除。成功后可在对象管理中恢复。", [field.name])} onClose={() => setDialog("")} onConfirm={async () => {
                await api(`/objects/tables/${table.id}/columns/${field.id}`, "PATCH", { version: table.object_version || 1, lifecycle: "deleted" });
                setDialog("");
                reload();
                notify("列已删除");
            }}/>))}
      {__ui(dialog === "import" && (<Modal title={__ui("批量导入 JSON")} onClose={() => setDialog("")} wide>
          <Form submit="校验并导入" onClose={() => setDialog("")} onSubmit={async (d) => {
                let rows;
                try {
                    rows = JSON.parse(String(d.get("rows")));
                }
                catch {
                    throw Error("JSON格式无效，请输入对象数组");
                }
                const r = await api(`/tables/${table.id}/import`, "POST", {
                    rows,
                });
                notify(`已导入 ${r.count} 条草稿`);
                setDialog("");
                reload();
            }}>
            <p className="help">{__ui("首版支持粘贴 JSON 数组，每批最多1000行。使用字段标识作为键；整批校验通过后才写入。")}</p>
            <Field label={__ui("记录数组")}>
              <textarea className="code-input" name="rows" rows={10} required defaultValue={JSON.stringify([
                Object.fromEntries(table.columns.map((f: any) => [
                    f.id,
                    f.type === "number"
                        ? 0
                        : f.type === "boolean"
                            ? false
                            : "",
                ])),
            ], null, 2)}/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(dialog === "view" && (<Modal title={__ui("保存个人数据视图")} onClose={() => setDialog("")}>
          <Form onClose={() => setDialog("")} onSubmit={async (d) => {
                await api(`/tables/${table.source_table_id || table.id}/views`, "POST", {
                    name: d.get("name"),
                    config: { search, status },
                });
                setDialog("");
                reload();
                notify("视图已保存");
            }}>
            <Field label={__ui("视图名称")}>
              <input name="name" required/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(dialog === "delete" && (<Confirm title={__ui(deleteRecords.length > 1 ? "批量删除草稿" : "删除草稿")} detail={__uiFormat("确认删除所选 {0} 条记录？整批删除会一起完成；任一记录已更新、有审批历史或被未选作业依赖时，整批不删除。记录移入可恢复状态，可由管理者在对象管理中恢复。", [deleteRecords.length])} onClose={() => setDialog("")} onConfirm={async () => {
                const result = await api(`/tables/${table.id}/records/batch-delete`, "POST", { records: deleteRecords });
                setDialog("");
                setSelected([]);
                reload();
                setDeleteRecords([]);
                notify(`已删除 ${result.deleted} 条草稿`);
            }}/>))}
      {__ui(approve && (<ApproveDialog kind="record" title={table.name + __ui("记录审核")} recordId={approve.id} tableId={table.id} onClose={() => setApprove(null)}/>))}
    </div></>);
}
