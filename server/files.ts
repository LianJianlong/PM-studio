import {documentStatuses} from "../shared/file-document.ts";
import {MAX_FILE_BYTES,normalizeStorageLink} from "../shared/file-storage.ts";
import { createHash } from "node:crypto";
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { access, canWrite, operationAllowed, type CrudAction, HttpError, requireThat } from "./auth.ts";
import { audit, pool, tx, uid } from "./db.ts";
import { id } from "./validation.ts";

export const files = Router();
const maxBytes = MAX_FILE_BYTES;
const fileName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (v) => !/[\\/\u0000-\u001f\u007f]/.test(v),
    "名称不能包含路径分隔符或控制字符",
  )
  .refine(
    (v) => !/[. ]$/.test(v) && v !== "." && v !== "..",
    "名称结尾不能是点或空格",
  )
  .refine(
    (v) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v),
    "名称是系统保留名称",
  );
const mime = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i,
    "MIME 类型无效",
  )
  .refine(
    (v) =>
      !/^(?:text\/html|application\/(?:xhtml\+xml|javascript)|image\/svg\+xml)$/i.test(
        v,
      ),
    "不支持可执行的网页内容类型",
  );
const storageLink=z.string().max(2000).transform((v,ctx)=>{try{return normalizeStorageLink(v)}catch(e){ctx.addIssue({code:'custom',message:(e as Error).message});return z.NEVER}});
const documentMetadata={summary:z.string().max(2000).optional(),document_revision:z.string().trim().max(40).optional(),document_status:z.enum(documentStatuses).optional()};
const encodedContent = z.string().max(Math.ceil((MAX_FILE_BYTES-1)/3)*4);
const knownTypes: Record<string, string[]> = {
  txt: ["text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  json: ["application/json", "text/plain"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  zip: [
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
  doc: ["application/msword", "application/octet-stream"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  ppt: ["application/vnd.ms-powerpoint", "application/octet-stream"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
  ],
};

function content(value: string) {
  if (
    value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new HttpError(400, "文件内容不是有效的 Base64");
  const valueBuffer = Buffer.from(value, "base64");
  requireThat(valueBuffer.length < maxBytes, 413, "单个文件必须小于5MB");
  return valueBuffer;
}
function validateMime(name: string, value: string) {
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (knownTypes[ext])
    requireThat(
      knownTypes[ext].includes(value.toLowerCase()),
      400,
      "文件扩展名与 MIME 类型不匹配",
    );
}
async function writable(user: string, project: string, c: pg.PoolClient, action:CrudAction) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,705))", [
    project,
  ]);
  const permission = await access(user, project, c);
  requireThat(operationAllowed(permission,"$files",action));
  requireThat(
    permission.lifecycle === "active" &&
      permission.workspace_lifecycle === "active",
    409,
    "项目或工作空间非活动状态，不允许修改文件",
  );
  return permission;
}
async function folder(
  c: pg.Pool | pg.PoolClient,
  project: string,
  parent: string | null,
) {
  if (!parent) return;
  const row = (
    await c.query(
      "SELECT id FROM project_files WHERE id=$1 AND project_id=$2 AND kind='folder' AND lifecycle='active'",
      [parent, project],
    )
  ).rows[0];
  requireThat(row, 400, "目标文件夹不存在或已删除");
}
async function locked(c: pg.PoolClient, key: string) {
  const meta = (
    await c.query("SELECT project_id FROM project_files WHERE id=$1", [key])
  ).rows[0];
  requireThat(meta, 404, "文件或文件夹不存在");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,705))", [
    meta.project_id,
  ]);
  const row = (
    await c.query("SELECT * FROM project_files WHERE id=$1 FOR UPDATE", [key])
  ).rows[0];
  requireThat(row, 404, "文件或文件夹不存在");
  return row;
}
function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii || "download"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

files.get("/projects/:project/files", async (req, res) => {
  const project = id.parse(req.params.project);
  const permission = await access(req.user.id, project);
  requireThat(operationAllowed(permission,"$files","read"));
  const query = z
    .object({
      parent: id.nullable().optional().default(null),
      page:z.coerce.number().int().min(1).max(100000).default(1),
      page_size:z.coerce.number().int().min(1).max(500).default(50),
      search: z.string().trim().max(120).optional().default(""),
      deleted: z
        .enum(["true", "false"])
        .optional()
        .default("false")
        .transform((v) => v === "true"),
      folders: z
        .enum(["true", "false"])
        .optional()
        .default("false")
        .transform((v) => v === "true"),
    })
    .parse(req.query);
  if (query.deleted) requireThat(operationAllowed(permission,"$files","delete"));
  if (!query.search && !query.deleted && !query.folders)
    await folder(pool, project, query.parent);
  const listingSql=`WITH RECURSIVE directory_paths AS (
 SELECT id,name::text AS path FROM project_files WHERE project_id=$1 AND parent_id IS NULL AND kind='folder'
 UNION ALL SELECT f.id,p.path||' / '||f.name FROM project_files f JOIN directory_paths p ON f.parent_id=p.id WHERE f.project_id=$1 AND f.kind='folder'
 ) SELECT count(*) OVER()::int AS listing_total,f.id,f.project_id,f.parent_id,f.kind,f.name,f.mime_type,f.current_version,
            f.summary,f.document_revision,f.document_status,coalesce(dp.path,'') AS folder_path,f.external_url,f.object_version,f.lifecycle,f.created_at,f.updated_at,f.deleted_at,
            coalesce(v.size_bytes,0) AS size_bytes,v.sha256,u.name AS updated_by_name
       FROM project_files f
       LEFT JOIN project_file_versions v ON v.file_id=f.id AND v.version=f.current_version
       LEFT JOIN directory_paths dp ON dp.id=f.parent_id
       JOIN users u ON u.id=f.updated_by
      WHERE f.project_id=$1
        AND (($5 AND f.kind='folder' AND f.lifecycle='active')
          OR (NOT $5 AND $4 AND f.lifecycle='deleted'
            AND NOT EXISTS(SELECT 1 FROM project_files parent WHERE parent.id=f.parent_id AND parent.lifecycle='deleted')
            AND ($2='' OR strpos(lower(f.name),lower($2))>0))
          OR (NOT $5 AND NOT $4 AND f.lifecycle='active'
            AND (($2<>'' AND strpos(lower(f.name),lower($2))>0) OR ($2='' AND f.parent_id IS NOT DISTINCT FROM $3::uuid))))
        AND (($4 AND f.lifecycle='deleted') OR (NOT $4 AND f.lifecycle='active'))
      ORDER BY CASE f.kind WHEN 'folder' THEN 0 WHEN 'link' THEN 1 ELSE 2 END,lower(f.name),f.id`;
  const params=[project,query.search,query.parent,query.deleted,query.folders];
  const result=await pool.query(listingSql+` LIMIT $6 OFFSET $7`,[...params,query.folders?10001:query.page_size,query.folders?0:(query.page-1)*query.page_size]);
  requireThat(!query.folders||result.rows.length<=10000,400,'目录超过10000项，请使用目录层级整理');
  const total=result.rows[0]?.listing_total??(query.page>1?(await pool.query(listingSql+' LIMIT 1',params)).rows[0]?.listing_total??0:0);
  res.json({
    permissions: Object.fromEntries(["read","create","update","delete"].map(action=>[action,operationAllowed(permission,"$files",action as CrudAction)&& (action==="read"||permission.lifecycle==="active"&&permission.workspace_lifecycle==="active")])),
    rows: result.rows,
    parent: query.parent,
    search: query.search,
    deleted: query.deleted,
    folders: query.folders,
    total,page:query.page,pageSize:query.page_size,
  });
});

files.post("/projects/:project/folders", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = z
    .object({
      ...documentMetadata,
      name: fileName,
      parent_id: id.nullable().optional().default(null),
    })
    .parse(req.body);
  const created = await tx(async (c) => {
    const permission = await writable(req.user.id, project, c,"create");
    await folder(c, project, body.parent_id);
    const key = uid();
    const row = (
      await c.query(
        `INSERT INTO project_files(id,project_id,parent_id,kind,name,created_by,updated_by,summary,document_revision,document_status)
       VALUES($1,$2,$3,'folder',$4,$5,$5,$6,$7,$8) RETURNING *`,
        [key, project, body.parent_id, body.name, req.user.id,body.summary||'',body.document_revision||'',body.document_status||'draft'],
      )
    ).rows[0];
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "新建项目文件夹",
      key,
      { project, parent_id: body.parent_id, name: body.name },
    );
    return row;
  });
  res.status(201).json(created);
});

files.post('/projects/:project/file-links',async(req,res)=>{
 const project=id.parse(req.params.project),body=z.object({...documentMetadata,name:fileName,parent_id:id.nullable().default(null),external_url:storageLink}).strict().parse(req.body);
 const result=await tx(async c=>{const permission=await writable(req.user.id,project,c,'create');await folder(c,project,body.parent_id);const key=uid();const row=(await c.query("INSERT INTO project_files(id,project_id,parent_id,kind,name,external_url,created_by,updated_by,summary,document_revision,document_status) VALUES($1,$2,$3,'link',$4,$5,$6,$6,$7,$8,$9) RETURNING *",[key,project,body.parent_id,body.name,body.external_url,req.user.id,body.summary||'',body.document_revision||'',body.document_status||'draft'])).rows[0];await audit(c,permission.workspace_id,req.user.id,'添加项目存储链接',key,{project,name:body.name});return row;});res.status(201).json(result);
});

files.post("/projects/:project/files", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = z
    .object({
      ...documentMetadata,
      name: fileName,
      parent_id: id.nullable().optional().default(null),
      mime_type: mime,
      content_base64: encodedContent,
    })
    .parse(req.body);
  validateMime(body.name, body.mime_type);
  const bytes = content(body.content_base64);
  const created = await tx(async (c) => {
    const permission = await writable(req.user.id, project, c,"create");
    await folder(c, project, body.parent_id);
    const key = uid();
    const row = (
      await c.query(
        `INSERT INTO project_files(id,project_id,parent_id,kind,name,mime_type,current_version,created_by,updated_by,summary,document_revision,document_status)
       VALUES($1,$2,$3,'file',$4,$5,1,$6,$6,$7,$8,$9) RETURNING *`,
        [key, project, body.parent_id, body.name, body.mime_type, req.user.id,body.summary||'',body.document_revision||'',body.document_status||'draft'],
      )
    ).rows[0];
    await c.query(
      `INSERT INTO project_file_versions(id,file_id,version,mime_type,size_bytes,sha256,content,created_by)
       VALUES($1,$2,1,$3,$4,$5,$6,$7)`,
      [
        uid(),
        key,
        body.mime_type,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
        bytes,
        req.user.id,
      ],
    );
    await audit(c, permission.workspace_id, req.user.id, "上传项目文件", key, {
      project,
      parent_id: body.parent_id,
      name: body.name,
      size_bytes: bytes.length,
    });
    return { ...row, size_bytes: bytes.length };
  });
  res.status(201).json(created);
});

files.post("/files/:file/versions", async (req, res) => {
  const key = id.parse(req.params.file);
  const body = z
    .object({
      ...documentMetadata,
      version: z.number().int().positive(),
      mime_type: mime,
      content_base64: encodedContent,
    })
    .parse(req.body);
  const bytes = content(body.content_base64);
  const result = await tx(async (c) => {
    const row = await locked(c, key);
    requireThat(
      row.kind === "file" && row.lifecycle === "active",
      409,
      "只能为活动文件上传新版本",
    );
    validateMime(row.name, body.mime_type);
    const permission = await writable(req.user.id, row.project_id, c,"update");
    requireThat(
      row.object_version === body.version,
      409,
      "文件已更新，请刷新后重试",
    );
    const next = row.current_version + 1;
    await c.query(
      `INSERT INTO project_file_versions(id,file_id,version,mime_type,size_bytes,sha256,content,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        uid(),
        key,
        next,
        body.mime_type,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
        bytes,
        req.user.id,
      ],
    );
    const updated = (
      await c.query(
        `UPDATE project_files SET current_version=$2,mime_type=$3,summary=COALESCE($6,summary),document_revision=$7,document_status=$8,object_version=object_version+1,
       updated_by=$4,updated_at=now() WHERE id=$1 AND object_version=$5 RETURNING *`,
        [key, next, body.mime_type, req.user.id, body.version,body.summary??null,body.document_revision||'',body.document_status||'draft'],
      )
    ).rows[0];
    requireThat(updated, 409, "文件已更新，请刷新后重试");
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "上传项目文件新版本",
      key,
      { project: row.project_id, file_version: next, size_bytes: bytes.length },
    );
    return { ...updated, size_bytes: bytes.length };
  });
  res.status(201).json(result);
});

files.get("/files/:file/versions", async (req, res) => {
  const key = id.parse(req.params.file);
  const paging=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),page_size:z.coerce.number().int().min(1).max(100).default(50)}).parse(req.query);
  const meta = (
    await pool.query("SELECT * FROM project_files WHERE id=$1", [key])
  ).rows[0];
  requireThat(meta, 404, "文件不存在");
  requireThat(operationAllowed(await access(req.user.id, meta.project_id),"$files","read"));
  requireThat(
    meta.kind === "file" && meta.lifecycle === "active",
    404,
    "文件不存在或已删除",
  );
  const total=Number((await pool.query('SELECT count(*) AS total FROM project_file_versions WHERE file_id=$1',[key])).rows[0].total);
  const paginated=req.query.page!==undefined;
  const rows=(await pool.query('SELECT v.version,v.size_bytes,v.sha256,v.created_at,u.name AS created_by_name FROM project_file_versions v JOIN users u ON u.id=v.created_by WHERE v.file_id=$1 ORDER BY v.version DESC LIMIT $2 OFFSET $3',[key,paginated?paging.page_size:100,paginated?(paging.page-1)*paging.page_size:0])).rows;
  res.set('X-Total-Count',String(total));res.json(paginated?{rows,total,page:paging.page,pageSize:paging.page_size}:rows);
});
files.get('/files/:file/open',async(req,res)=>{
 const row=(await pool.query('SELECT * FROM project_files WHERE id=$1',[id.parse(req.params.file)])).rows[0];requireThat(row&&row.kind==='link'&&row.lifecycle==='active',404,'存储链接不存在或已删除');const permission=await access(req.user.id,row.project_id);requireThat(operationAllowed(permission,'$files','read'));const url=normalizeStorageLink(row.external_url);await audit(pool,permission.workspace_id,req.user.id,'打开项目存储链接',row.id,{project:row.project_id});res.redirect(302,url);
});

files.get("/files/:file/download", async (req, res) => {
  const key = id.parse(req.params.file);
  const requested = z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .parse(req.query.version);
  const meta = (
    await pool.query("SELECT * FROM project_files WHERE id=$1", [key])
  ).rows[0];
  requireThat(meta, 404, "文件不存在");
  requireThat(operationAllowed(await access(req.user.id, meta.project_id),"$files","read"));
  requireThat(
    meta.kind === "file" && meta.lifecycle === "active",
    404,
    "文件不存在或已删除",
  );
  const fileVersion = requested ?? meta.current_version;
  const value = (
    await pool.query(
      "SELECT mime_type,size_bytes,content FROM project_file_versions WHERE file_id=$1 AND version=$2",
      [key, fileVersion],
    )
  ).rows[0];
  requireThat(value, 404, "文件版本不存在");
  res.set({
    "Content-Type": value.mime_type,
    "Content-Length": String(value.size_bytes),
    "Content-Disposition": attachment(meta.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  res.send(value.content);
});

files.patch("/files/:file", async (req, res) => {
  const key = id.parse(req.params.file);
  const body = z
    .object({
      ...documentMetadata,
      version: z.number().int().positive(),
      name: fileName.optional(),
      external_url: storageLink.optional(),
      parent_id: id.nullable().optional(),
    })
    .refine(
      (v) => v.name !== undefined || v.parent_id !== undefined || v.external_url !== undefined || v.summary !== undefined || v.document_revision !== undefined || v.document_status !== undefined,
      "请选择修改内容",
    )
    .parse(req.body);
  const result = await tx(async (c) => {
    const row = await locked(c, key);
    requireThat(row.lifecycle === "active", 409, "已删除对象请先恢复");
    const permission = await writable(req.user.id, row.project_id, c,"update");
    requireThat(
      row.object_version === body.version,
      409,
      "文件已更新，请刷新后重试",
    );
    const parent =
      body.parent_id === undefined ? row.parent_id : body.parent_id;
    await folder(c, row.project_id, parent);
    if (row.kind === "folder" && parent) {
      const inside = await c.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM project_files WHERE id=$1
           UNION ALL SELECT f.id FROM project_files f JOIN descendants d ON f.parent_id=d.id
         ) SELECT 1 FROM descendants WHERE id=$2`,
        [key, parent],
      );
      requireThat(!inside.rowCount, 400, "不能把文件夹移动到自身或其下级目录");
    }
    requireThat(body.external_url===undefined||row.kind==="link",400,"仅存储链接可修改地址");
    const name = body.name ?? row.name;
    if (row.kind === "file") validateMime(name, row.mime_type);
    const updated = (
      await c.query(
        `UPDATE project_files SET summary=COALESCE($7,summary),document_revision=COALESCE($8,document_revision),document_status=COALESCE($9,document_status),name=$2,parent_id=$3,external_url=COALESCE($6,external_url),object_version=object_version+1,updated_by=$4,updated_at=now()
       WHERE id=$1 AND object_version=$5 RETURNING *`,
        [key, name, parent, req.user.id, body.version,body.external_url??null,body.summary??null,body.document_revision??null,body.document_status??null],
      )
    ).rows[0];
    requireThat(updated, 409, "文件已更新，请刷新后重试");
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "更新项目文件登记信息",
      key,
      {
        project: row.project_id,
        before: { name: row.name, parent_id: row.parent_id,summary:row.summary,document_revision:row.document_revision,document_status:row.document_status },
        after: { name, parent_id: parent,summary:updated.summary,document_revision:updated.document_revision,document_status:updated.document_status },
      },
    );
    return updated;
  });
  res.json(result);
});

files.post("/files/:file/copy", async (req, res) => {
  const key = id.parse(req.params.file);
  const body = z
    .object({
      version: z.number().int().positive(),
      name: fileName.optional(),
      parent_id: id.nullable().optional(),
    })
    .parse(req.body);
  const result = await tx(async (c) => {
    const root = await locked(c, key);
    requireThat(root.lifecycle === "active", 409, "不能复制已删除对象");
    const permission = await writable(req.user.id, root.project_id, c,"create");
    requireThat(
      root.object_version === body.version,
      409,
      "文件已更新，请刷新后重试",
    );
    const targetParent =
      body.parent_id === undefined ? root.parent_id : body.parent_id;
    await folder(c, root.project_id, targetParent);
    const rows = (
      await c.query(
        `WITH RECURSIVE tree AS (
         SELECT f.*,0 AS depth FROM project_files f WHERE id=$1 AND lifecycle='active'
         UNION ALL SELECT f.*,t.depth+1 FROM project_files f JOIN tree t ON f.parent_id=t.id WHERE f.lifecycle='active'
       ) SELECT * FROM tree ORDER BY depth,id LIMIT 501`,
        [key],
      )
    ).rows;
    requireThat(rows.length <= 500, 409, "文件夹内容超过 500 项，请拆分后复制");
    const mapped = new Map<string, string>();
    for (const source of rows) {
      const copyId = uid();
      mapped.set(source.id, copyId);
      const parent =
        source.id === key ? targetParent : mapped.get(source.parent_id)!;
      const dot = source.kind === "file" ? source.name.lastIndexOf(".") : -1;
      const copyName =
        dot > 0
          ? `${source.name.slice(0, dot)} - 副本${source.name.slice(dot)}`
          : `${source.name} - 副本`;
      const name = fileName.parse(
        source.id === key ? (body.name ?? copyName) : source.name,
      );
      if (source.kind === "file") validateMime(name, source.mime_type);
      await c.query(
        `INSERT INTO project_files(id,project_id,parent_id,kind,name,mime_type,current_version,created_by,updated_by,external_url,summary,document_revision,document_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12)`,
        [
          copyId,
          source.project_id,
          parent,
          source.kind,
          name,
          source.mime_type,
          source.current_version,
          req.user.id,
          source.external_url,
          source.summary,
          source.document_revision,
          source.document_status,
        ],
      );
      if (source.kind === "file")
        await c.query(
          `INSERT INTO project_file_versions(id,file_id,version,mime_type,size_bytes,sha256,content,created_by)
           SELECT gen_random_uuid(),$2,version,mime_type,size_bytes,sha256,content,$3
           FROM project_file_versions WHERE file_id=$1 ORDER BY version`,
          [source.id, copyId, req.user.id],
        );
    }
    const copy = (
      await c.query("SELECT * FROM project_files WHERE id=$1", [
        mapped.get(key),
      ])
    ).rows[0];
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "复制项目文件",
      copy.id,
      {
        project: root.project_id,
        source_id: key,
        copied_items: rows.length,
        parent_id: targetParent,
      },
    );
    return copy;
  });
  res.status(201).json(result);
});

files.delete("/files/:file", async (req, res) => {
  const key = id.parse(req.params.file);
  const body = z
    .object({ version: z.number().int().positive() })
    .parse(req.body);
  await tx(async (c) => {
    const root = await locked(c, key);
    requireThat(root.lifecycle === "active", 409, "对象已删除");
    const permission = await writable(req.user.id, root.project_id, c,"delete");
    requireThat(
      root.object_version === body.version,
      409,
      "文件已更新，请刷新后重试",
    );
    const changed = await c.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM project_files WHERE id=$1
         UNION ALL SELECT f.id FROM project_files f JOIN tree t ON f.parent_id=t.id WHERE f.lifecycle='active'
       ) UPDATE project_files SET lifecycle='deleted',deleted_by=$2,deleted_at=now(),deletion_batch=$3,
          object_version=object_version+1,updated_by=$2,updated_at=now()
          WHERE id IN(SELECT id FROM tree) AND lifecycle='active' RETURNING id`,
      [key, req.user.id, uid()],
    );
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "软删除项目文件",
      key,
      { project: root.project_id, deleted_items: changed.rowCount },
    );
  });
  res.json({ ok: true });
});

files.post("/files/:file/restore", async (req, res) => {
  const key = id.parse(req.params.file);
  const body = z
    .object({
      version: z.number().int().positive(),
      name: fileName.optional(),
      parent_id: id.nullable().optional(),
    })
    .parse(req.body);
  const result = await tx(async (c) => {
    const root = await locked(c, key);
    requireThat(root.lifecycle === "deleted", 409, "对象并未删除");
    const permission = await writable(req.user.id, root.project_id, c,"create");
    requireThat(
      root.object_version === body.version,
      409,
      "文件已更新，请刷新后重试",
    );
    const targetParent =
      body.parent_id === undefined ? root.parent_id : body.parent_id;
    const targetName = body.name ?? root.name;
    await folder(c, root.project_id, targetParent);
    if (root.kind === "file") validateMime(targetName, root.mime_type);
    const conflict = await c.query(
      `WITH RECURSIVE tree AS (
         SELECT f.id,f.parent_id,f.name FROM project_files f WHERE id=$1
         UNION ALL SELECT f.id,f.parent_id,f.name FROM project_files f JOIN tree t ON f.parent_id=t.id WHERE f.lifecycle='deleted' AND f.deletion_batch IS NOT DISTINCT FROM $5::uuid
       ), candidates AS (
         SELECT id,CASE WHEN id=$1 THEN $2::uuid ELSE parent_id END AS parent_id,
                CASE WHEN id=$1 THEN $3 ELSE name END AS name FROM tree
       ) SELECT 1 FROM candidates c JOIN project_files f
         ON f.project_id=$4 AND f.lifecycle='active' AND f.id NOT IN(SELECT id FROM tree)
        AND f.parent_id IS NOT DISTINCT FROM c.parent_id AND lower(f.name)=lower(c.name) LIMIT 1`,
      [key, targetParent, targetName, root.project_id, root.deletion_batch],
    );
    requireThat(!conflict.rowCount, 409, "恢复位置存在同名文件或文件夹");
    await c.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM project_files WHERE id=$1
         UNION ALL SELECT f.id FROM project_files f JOIN tree t ON f.parent_id=t.id WHERE f.lifecycle='deleted' AND f.deletion_batch IS NOT DISTINCT FROM $3::uuid
       ) UPDATE project_files SET lifecycle='active',deleted_by=NULL,deleted_at=NULL,deletion_batch=NULL,
          name=CASE WHEN id=$1 THEN $4 ELSE name END,
          parent_id=CASE WHEN id=$1 THEN $5::uuid ELSE parent_id END,
          object_version=object_version+1,updated_by=$2,updated_at=now()
          WHERE id IN(SELECT id FROM tree) AND lifecycle='deleted'`,
      [key, req.user.id, root.deletion_batch, targetName, targetParent],
    );
    const restored = (
      await c.query(`SELECT * FROM project_files WHERE id=$1`, [key])
    ).rows[0];
    await audit(c, permission.workspace_id, req.user.id, "恢复项目文件", key, {
      project: root.project_id,
      name: targetName,
      parent_id: targetParent,
    });
    return restored;
  });
  res.json(result);
});
