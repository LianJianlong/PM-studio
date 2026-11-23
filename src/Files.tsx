import {documentStatusLabels,documentStatuses} from "../shared/file-document";
import {MAX_FILE_BYTES} from "../shared/file-storage";
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { Link2, ExternalLink, Copy, Download, File as FileIcon, Folder, FolderOpen, FolderPlus, HardDrive, History, Move, Pencil, RotateCcw, Trash2, Upload, } from "lucide-react";
import { api, Confirm, Empty, ErrorBox, Field, Form, Loading, Modal, PageTitle, SearchBox, timestamp, useApi, useApp, useRememberedState, } from "./lib";
type FileRow = {
    id: string;
    parent_id: string | null;
    kind: "file" | "folder" | "link";
    external_url: string | null;
    summary: string;
    document_revision: string;
    document_status: string;
    folder_path: string;
    name: string;
    mime_type: string | null;
    current_version: number;
    object_version: number;
    lifecycle: "active" | "deleted";
    size_bytes: number;
    updated_at: string;
    deleted_at: string | null;
    updated_by_name: string;
};
type Listing = {
    rows: FileRow[];
    total: number;
    page: number;
    pageSize: number;
};
type Dialog = {
    type: "folder";
} | {
    type: "link";
    row?: FileRow;
} | {
    type: "upload";
} | {
    type: "version";
    row: FileRow;
} | {
    type: "history";
    row: FileRow;
} | {
    type: "metadata";
    row: FileRow;

} | {
    type: "move";
    row: FileRow;
} | {
    type: "copy";
    row: FileRow;
} | {
    type: "delete";
    row: FileRow;
} | {
    type: "restore";
    row: FileRow;
} | null;
const maxBytes = MAX_FILE_BYTES;
const size = (value: number) => value < 1024
    ? `${value} B`
    : value < 1024 * 1024
        ? `${(value / 1024).toFixed(1)} KB`
        : `${(value / 1024 / 1024).toFixed(2)} MB`;
function encodeFile(file: File) {
    if (file.size >= maxBytes)
        return Promise.reject(new Error("单个文件必须小于5MB"));
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取所选文件"));
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
        reader.readAsDataURL(file);
    });
}
function metadata(form:FormData){return {summary:String(form.get('summary')||''),document_revision:String(form.get('document_revision')||''),document_status:String(form.get('document_status')||'draft')};}
function FileMetadataFields({row,nextVersion=false}:{row?:FileRow,nextVersion?:boolean}){return <><Field label={__ui('文件摘要')}><textarea name="summary" maxLength={2000} rows={3} defaultValue={row?.summary||''}/></Field><Field label={__ui('版本')} hint={__ui('可填写发行版号；留空时上传文件使用系统版本号，存储链接默认v1')}><input name="document_revision" maxLength={40} defaultValue={nextVersion&&row?`v${row.current_version+1}`:row?.document_revision||''}/></Field><Field label={__ui('状态')}><select name="document_status" defaultValue={nextVersion?'draft':row?.document_status||'draft'}>{documentStatuses.map(value=><option key={value} value={value}>{__ui(documentStatusLabels[value])}</option>)}</select></Field></>;}
function ActionButton({ label, children, onClick, disabled = false, }: {
    label: string;
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (<button className="icon-button" aria-label={__ui(label)} title={__ui(label)} disabled={disabled} onClick={onClick}>
      {__ui(children)}
    </button>);
}
export default function Files() {
    const { project, context, boot, tick, reload, notify } = useApp();
    const filePermissions = context.permission.files || { read: true, create: context.permission.write, update: context.permission.write, delete: context.permission.write };
    const canWrite = filePermissions.create || filePermissions.update || filePermissions.delete;
    const [trail, setTrail] = useRememberedState<{
        id: string;
        name: string;
    }[]>(`file-trail:${boot.user.id}:${project.id}`,[]);
    const parent=trail.at(-1)?.id||null;
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search.trim());
    const [trash, setTrash] = useState(false);
    const [page, setPage] = useState(1);
    useEffect(() => setPage(1), [parent, deferredSearch, trash, project.id]);
    const [revision, setRevision] = useState(0);
    const [dialog, setDialog] = useState<Dialog>(null);
    const query = new URLSearchParams();
    query.set('page', String(page));
    if (parent && !trash)
        query.set("parent", parent);
    if (deferredSearch)
        query.set("search", deferredSearch);
    if (trash)
        query.set("deleted", "true");
    const { data, error, loading } = useApi<Listing>(`/projects/${project.id}/files?${query}`, tick + revision);
    useEffect(()=>{
        if(parent&&error==="目标文件夹不存在或已删除")setTrail([]);
    },[parent,error]);
    const { data: folderData } = useApi<Listing>(canWrite ? `/projects/${project.id}/files?folders=true` : null, tick + revision);
    const folders = folderData?.rows || [];
    function refresh(message: string) {
        setRevision((value) => value + 1);
        reload();
        notify(message);
        setDialog(null);
    }
    function openFolder(row: FileRow) {
        setTrail((value) => [...value, { id: row.id, name: row.name }]);
        setSearch("");
    }
    function goTo(index: number) {
        const next = trail.slice(0, index + 1);
        setTrail(next);
        setSearch("");
    }
    function destinations(row?: FileRow) {
        return folders.filter((folder) => folder.id !== row?.id);
    }
    async function upload(form: FormData, row?: FileRow) {
        const selected = form.get("file");
        if (!(selected instanceof File) || !selected.name)
            throw new Error("请选择文件");
        const content_base64 = await encodeFile(selected);
        const mime_type = selected.type || "application/octet-stream";
        if (row) {
            await api(`/files/${row.id}/versions`, "POST", {
                version: row.object_version,
                ...metadata(form),
                mime_type,
                content_base64,
            });
            refresh(`已上传 ${row.name} 的新版本`);
        }
        else {
            await api(`/projects/${project.id}/files`, "POST", {
                ...metadata(form),
                name: String(form.get("name") || selected.name),
                parent_id: parent,
                mime_type,
                content_base64,
            });
            refresh("文件已上传");
        }
    }
    return (<div className="data-inner spreadsheet-layout native-sheet files-sheet">
      <PageTitle icon={HardDrive} title={__ui("项目文件")} subtitle={__ui("带版本记录的项目资料库")}>
        {__ui(filePermissions.create ? (<>
            <button className="primary" onClick={() => setDialog({type:"link"})}><Link2 size={16}/>{__ui("添加存储链接")}</button>
            <button onClick={() => setDialog({ type: "folder" })}>
              <FolderPlus size={16}/>{__ui("新建文件夹")}</button>
            <button onClick={() => setDialog({ type: "upload" })}>
              <Upload size={16}/>{__ui("上传文件")}</button>
          </>) : null)}
      </PageTitle>

      <p className="help">{__ui("推荐添加服务器存储链接，软件只保存地址，不下载、预览或缓存链接内容。上传单个文件必须小于5MB（5×1024×1024字节），上传版本会保存在数据库中。列表每页50项。")}</p>
      <div className="section-heading">
        <div>
          <button className="icon-button" title={__ui("根目录")} aria-label={__ui("根目录")} onClick={() => goTo(-1)}>
            <FolderOpen size={17}/>
          </button>
          {__ui(trail.map((part, index) => (<span key={part.id}>
              {__ui(" / ")}
              <button onClick={() => goTo(index)}>{part.name}</button>
            </span>)))}
        </div>
        <div className="heading-actions">
          <SearchBox value={search} onChange={setSearch} placeholder={__ui("搜索项目文件")}/>
          {__ui(filePermissions.delete ? (<button className={trash ? "active" : ""} onClick={() => {
                setTrash((value) => !value);
                setSearch("");
            }}>
              <Trash2 size={15}/> {__ui(trash ? "返回文件" : "回收站")}
            </button>) : null)}
        </div>
      </div>

      {__ui(error ? <ErrorBox message={__ui(error)}/> : null)}
      {__ui(loading && !data ? <Loading /> : null)}
      {__ui(data && <div className="section-heading"><small>{__ui("共 ")}{__ui(data.total)}{__ui(" 项 · 第 ")}{__ui(page)}{__ui(" 页")}</small><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>{__ui("上一页")}</button><button disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage(page + 1)}>{__ui("下一页")}</button></div>)}
      {__ui(data ? (<div className="grid-scroll">
          <table className="data-grid file-register-grid">
            <thead>
              <tr>
                <th>{__ui("序号")}</th><th>{__ui("文件名")}</th><th>{__ui("文件位置")}</th><th>{__ui("文件摘要")}</th><th>{__ui("版本")}</th><th>{__ui("更新时间")}</th><th>{__ui("更新人")}</th><th>{__ui("状态")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {!data.rows.length&&<tr><td colSpan={9}><Empty text={__ui(trash?'回收站为空':deferredSearch?'没有匹配的文件':'此文件夹为空')}/></td></tr>}
              {__ui(data.rows.map((row,index) => (<tr key={row.id}>
                  <td>{(data.page-1)*data.pageSize+index+1}</td>
                  <td>
                    {row.kind==='link'&&!trash?<a className="project-file-name" href={`/api/files/${row.id}/open`} target="_blank" rel="noopener noreferrer"><Link2 size={17}/>{row.name}<ExternalLink size={13}/></a>:<button className="project-file-name" disabled={row.kind !== "folder" || trash} onClick={() => openFolder(row)}>
                      {__ui(row.kind === "folder" ? (<Folder size={17}/>) : (<FileIcon size={17}/>))}
                      {row.name}
                    </button>}

                  </td>
                  <td className="file-location-cell">{row.kind==='link'&&!trash?<a href={`/api/files/${row.id}/open`} target="_blank" rel="noopener noreferrer">{row.external_url}</a>:row.external_url||['项目文件',row.folder_path,row.kind==='folder'?row.name:''].filter(Boolean).map(__ui).join(' / ')}</td>
                  <td className="file-summary-cell">{row.summary||'—'}</td>
                  <td>{row.kind==='file'&&!trash?<button className="project-file-name" title={__ui('版本历史')} onClick={()=>setDialog({type:'history',row})}>{row.document_revision||`v${row.current_version}`}</button>:row.document_revision||(row.kind==='file'?`v${row.current_version}`:row.kind==='link'?'v1':'—')}</td>
                  <td>{timestamp(row.updated_at)}</td><td>{row.updated_by_name}</td>
                  <td><span className={'status '+({draft:'pending',issued:'approved',invalid:'rejected',abolished:'rejected'} as Record<string,string>)[row.document_status||'draft']}>{__ui(documentStatusLabels[row.document_status||'draft'])}</span></td>
                  <td>
                    <div className="heading-actions">
                      {__ui(trash ? (<ActionButton label={__ui("恢复")} disabled={!filePermissions.create} onClick={() => setDialog({ type: "restore", row })}>
                          <RotateCcw size={15}/>
                        </ActionButton>) : (<>
                          <ActionButton label={__ui("下载")} disabled={row.kind!=='file'} onClick={()=>window.location.assign(`/api/files/${row.id}/download`)}><Download size={15}/></ActionButton>
                          <ActionButton label={__ui("编辑")} disabled={!filePermissions.update} onClick={()=>setDialog({type:'metadata',row})}><Pencil size={15}/></ActionButton>
                          <ActionButton label={__ui("移动")} disabled={!filePermissions.update} onClick={()=>setDialog({type:'move',row})}><Move size={15}/></ActionButton>
                          <ActionButton label={__ui("复制")} disabled={!filePermissions.create} onClick={()=>setDialog({type:'copy',row})}><Copy size={15}/></ActionButton>
                          <ActionButton label={__ui("删除")} disabled={!filePermissions.delete} onClick={()=>setDialog({type:'delete',row})}><Trash2 size={15}/></ActionButton>
                        </>))}
                    </div>
                  </td>
                </tr>)))}
            </tbody>
          </table>
        </div>) : null)}

      {dialog?.type==='metadata'&&<Modal title={__ui('编辑文件信息')} onClose={()=>setDialog(null)}><Form onClose={()=>setDialog(null)} onSubmit={async form=>{await api(`/files/${dialog.row.id}`,'PATCH',{version:dialog.row.object_version,name:form.get('name'),...metadata(form),...(dialog.row.kind==='link'?{external_url:form.get('external_url')}:{})});refresh('文件信息已更新')}}><Field label={__ui('文件名')}><input name="name" required maxLength={180} defaultValue={dialog.row.name}/></Field><Field label={__ui('文件位置')}>{dialog.row.kind==='link'?<input name="external_url" required maxLength={2000} defaultValue={dialog.row.external_url||''}/>:<input readOnly value={['项目文件',dialog.row.folder_path].filter(Boolean).join(' / ')}/>}</Field><FileMetadataFields row={dialog.row}/></Form>{dialog.row.kind==='file'&&<div className="heading-actions"><button onClick={()=>setDialog({type:'history',row:dialog.row})}>{__ui('版本历史')}</button><button onClick={()=>setDialog({type:'version',row:dialog.row})}>{__ui('上传新版本')}</button></div>}{dialog.row.kind==='link'&&<button onClick={async()=>{try{await navigator.clipboard.writeText(dialog.row.external_url!);notify('地址已复制')}catch{window.prompt(__ui('请复制存储地址'),dialog.row.external_url!)}}}>{__ui('复制存储地址')}</button>}</Modal>}
      {dialog?.type==='link'&&<Modal title={__ui(dialog.row?'编辑存储链接':'添加存储链接')} onClose={()=>setDialog(null)}><Form onClose={()=>setDialog(null)} onSubmit={async form=>{if(dialog.row)await api(`/files/${dialog.row.id}`,'PATCH',{version:dialog.row.object_version,name:form.get('name'),...metadata(form),external_url:form.get('external_url')});else await api(`/projects/${project.id}/file-links`,'POST',{name:form.get('name'),parent_id:parent,...metadata(form),external_url:form.get('external_url')});refresh("存储链接已保存");}}><Field label={__ui("名称")}><input name="name" required maxLength={180} defaultValue={dialog.row?.name}/></Field><Field label={__ui("存储地址")}><input name="external_url" required maxLength={2000} defaultValue={dialog.row?.external_url||''} placeholder="https://files.example.com/project/ 或 smb://server/share/"/></Field><FileMetadataFields row={dialog.row}/><p className="help">{__ui("推荐HTTPS文件库地址，可直接打开。SMB或UNC共享路径需当前电脑能访问服务器，并支持系统文件管理器；浏览器可能要求确认或阻止打开，可复制地址到Finder或资源管理器。服务器权限独立管理，不要在地址中填写账号密码。")}</p></Form></Modal>}
      {__ui(dialog?.type === "folder" ? (<Modal title={__ui("新建文件夹")} onClose={() => setDialog(null)}>
          <Form onClose={() => setDialog(null)} onSubmit={async (form) => {
                await api(`/projects/${project.id}/folders`, "POST", {
                    name: form.get("name"),
                    ...metadata(form),
                    parent_id: parent,
                });
                refresh("文件夹已创建");
            }}>
            <Field label={__ui("文件夹名称")}>
              <input name="name" required maxLength={180} autoFocus/>
            </Field>
            <FileMetadataFields/>
          </Form>
        </Modal>) : null)}
      {__ui(dialog?.type === "upload" ? (<Modal title={__ui("上传文件")} onClose={() => setDialog(null)}>
          <Form submit="上传" onClose={() => setDialog(null)} onSubmit={(form) => upload(form)}>
            <Field label={__ui("选择文件")} hint={__ui("单个文件必须小于5MB")}>
              <input name="file" type="file" required/>
            </Field>
            <Field label={__ui("保存名称")} hint={__ui("留空时使用原文件名")}>
              <input name="name" maxLength={180}/>
            </Field>
            <FileMetadataFields/>
          </Form>
        </Modal>) : null)}
      {__ui(dialog?.type === "version" ? (<Modal title={__uiFormat("上传新版本：{0}", [dialog.row.name])} onClose={() => setDialog(null)}>
          <Form submit="上传新版本" onClose={() => setDialog(null)} onSubmit={(form) => upload(form, dialog.row)}>
            <Field label={__ui("选择文件")} hint={__ui("文件ID和历史版本会保留，单个版本必须小于5MB")}>
              <input name="file" type="file" required/>
            </Field>
            <FileMetadataFields row={dialog.row} nextVersion/>
          </Form>
        </Modal>) : null)}
      {__ui(dialog?.type === "move" ? (<Modal title={__uiFormat("移动：{0}", [dialog.row.name])} onClose={() => setDialog(null)}>
          <Form onClose={() => setDialog(null)} onSubmit={async (form) => {
                await api(`/files/${dialog.row.id}`, "PATCH", {
                    version: dialog.row.object_version,
                    parent_id: form.get("parent") || null,
                });
                refresh("文件位置已更新");
            }}>
            <FolderSelect folders={destinations(dialog.row)} defaultValue={dialog.row.parent_id}/>
          </Form>
        </Modal>) : null)}
      {__ui(dialog?.type === "copy" ? (<Modal title={__uiFormat("复制：{0}", [dialog.row.name])} onClose={() => setDialog(null)}>
          <Form submit="复制" onClose={() => setDialog(null)} onSubmit={async (form) => {
                await api(`/files/${dialog.row.id}/copy`, "POST", {
                    version: dialog.row.object_version,
                    name: form.get("name"),
                    parent_id: form.get("parent") || null,
                });
                refresh("副本已创建");
            }}>
            <Field label={__ui("副本名称")}>
              <input name="name" required maxLength={180} defaultValue={dialog.row.kind === "file" && dialog.row.name.lastIndexOf(".") > 0 ? dialog.row.name.replace(/(\.[^.]+)$/, " - 副本$1") : `${dialog.row.name} - 副本`}/>
            </Field>
            <FolderSelect folders={destinations(dialog.row)} defaultValue={dialog.row.parent_id}/>
          </Form>
        </Modal>) : null)}
      {__ui(dialog?.type === "history" && (<FileHistory row={dialog.row} onClose={() => setDialog(null)}/>))}
      {__ui(dialog?.type === "delete" ? (<Confirm title={__uiFormat("删除{0}", [dialog.row.kind === "folder" ? __ui("文件夹") : __ui("文件")])} detail={__ui(dialog.row.kind === "folder"
                ? "文件夹及其中内容会移入回收站，可稍后恢复。"
                : "文件会移入回收站，历史版本会保留。")} onClose={() => setDialog(null)} onConfirm={async () => {
                await api(`/files/${dialog.row.id}`, "DELETE", {
                    version: dialog.row.object_version,
                });
                refresh("已移入回收站");
            }}/>) : null)}
      {__ui(dialog?.type === "restore" ? (<Modal title={__uiFormat("恢复：{0}", [dialog.row.name])} onClose={() => setDialog(null)}>
          <Form submit="恢复" onClose={() => setDialog(null)} onSubmit={async (form) => {
                await api(`/files/${dialog.row.id}/restore`, "POST", {
                    version: dialog.row.object_version,
                    name: form.get("name"),
                    parent_id: form.get("parent") || null,
                });
                refresh("文件已恢复");
            }}>
            <Field label={__ui("恢复后的名称")}>
              <input name="name" required maxLength={180} defaultValue={dialog.row.name}/>
            </Field>
            <FolderSelect folders={destinations(dialog.row)} defaultValue={null}/>
          </Form>
        </Modal>) : null)}
    </div>);
}
function FileHistory({ row, onClose }: {
    row: FileRow;
    onClose: () => void;
}) {
    const [page, setPage] = useState(1);
    const { data, error } = useApi<any>(`/files/${row.id}/versions?page=${page}`);
    return (<Modal title={__uiFormat("版本历史：{0}", [row.name])} onClose={onClose}>
      {__ui(error ? (<ErrorBox message={__ui(error)}/>) : !data ? (<Loading />) : (<div className="grid-scroll">
          <table className="data-grid">
            <thead>
              <tr>
                <th>{__ui("版本")}</th>
                <th>{__ui("上传人")}</th>
                <th>{__ui("时间")}</th>
                <th>{__ui("大小")}</th>
                <th>{__ui("下载")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(data.rows.map((v: any) => (<tr key={v.version}>
                  <td>v{__ui(v.version)}</td>
                  <td>{v.created_by_name}</td>
                  <td>{__ui(timestamp(v.created_at))}</td>
                  <td>{__ui(size(v.size_bytes))}</td>
                  <td>
                    <a href={`/api/files/${row.id}/download?version=${v.version}`} download>{__ui("下载")}</a>
                  </td>
                </tr>)))}
            </tbody>
          </table>
          <div className="section-heading"><small>{__ui("共 ")}{__ui(data.total)}{__ui(" 个版本 · 第 ")}{__ui(page)}{__ui(" 页")}</small><button disabled={page === 1} onClick={() => setPage(page - 1)}>{__ui("上一页")}</button><button disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>{__ui("下一页")}</button></div>
        </div>))}
    </Modal>);
}
function FolderSelect({ folders, defaultValue, }: {
    folders: FileRow[];
    defaultValue: string | null;
}) {
    return (<Field label={__ui("目标文件夹")}>
      <select name="parent" defaultValue={defaultValue || ""}>
        <option value="">{__ui("项目文件根目录")}</option>
        {__ui(folders.map((folder) => (<option key={folder.id} value={folder.id}>
            {folder.name}
          </option>)))}
      </select>
    </Field>);
}
