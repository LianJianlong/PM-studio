import {workspaceStorage} from './workspace-storage.ts';
import {printForms} from './print-forms.ts';
import {publicLoginAppearance,loginAppearance} from './login-appearance.ts';
import {costManagement} from './cost-management.ts';
import {resourceTimeCurves} from './resource-time-series.ts';
import {actualRemaining} from './actual-remaining.ts';
import {constraintPreview} from './constraint-preview.ts';
import {LoeError} from '../shared/loe.ts';
import {activityCodes} from './activity-codes.ts';
import {durationLinks} from './duration-link.ts';
import {delayAnalysis} from './delay-analysis.ts';
import {progressControl} from './progress-control.ts';
import {scheduleControls} from './schedule-controls.ts';
import {viewPreferences} from './view-preferences.ts';
import {operationsHealth} from './operations-health.ts';import {runtimeMetrics} from './runtime-metrics.ts';
import {dataReadiness} from './data-readiness.ts';
import {agendaTables} from "./agenda-table.ts";
import {toolboxDocuments} from './toolbox-documents.ts';
import {drawingBoards} from "./drawing-boards.ts";
import {reportSchedules,startReportScheduler} from "./report-schedules.ts";
import {registerAgentRoutes} from './ai-agent-runtime.ts';
import {operationRecorder,securityConsole,startBackupScheduler} from "./security-console.ts";
import {diagramImport} from './diagram-import.ts';
import {projectRoles} from './project-roles.ts';
import {planningWorkbench} from "./planning-workbench.ts";
import {networkPlans} from './network-plans.ts';
import {projectDashboard} from './project-dashboard.ts';
import {publicViews} from './public-views.ts';
import {StatisticsError} from '../shared/report-aggregate.ts';
import {releaseRoutes,releaseReadiness} from './release-readiness.ts';
import {ai} from "./ai.ts";
import {planTable} from "./plan-table.ts";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pool, initialize, requestActor } from "./db.ts";
import { HttpError, authenticate } from "./auth.ts";
import { verifyPasswordAsync, tokenHash, dummyHash } from "./security.ts";
import {securityEvent,securityRoutes} from './security-events.ts';
import {requestBudget} from './request-budget.ts';
import {installWorkTracking} from './work-tracking.ts';import {atomicAI} from './ai-atomic.ts';
import { governance } from "./governance.ts";
import { approvals } from "./approvals.ts";
import { data } from "./data.ts";
import { planning } from "./planning.ts";
import { todoActions } from "./todo-actions.ts";
import { connections } from "./connections.ts";
import { imports } from "./imports.ts";
import { notifications } from "./notifications.ts";
import { resources } from "./resources.ts";
import { version } from "./version.ts";
import { objects } from "./objects.ts";
import { tableMoves } from "./table-moves.ts";
import { departmentRoutes } from "./departments.ts";
import { files } from "./files.ts";
import { ownerItems } from "./owner-items.ts";
import { references } from "./references.ts";
import { reportDocuments } from "./report-documents.ts";
import { recordLinks } from "./record-links.ts";
import { workItems } from "./work-items.ts";
import { permissionExplanation } from "./permission-explanation.ts";
await initialize();
if(process.env.RELEASE_MODE==='true'){const check=await releaseReadiness();if(!check.ready)throw Error('正式发布检查失败：'+check.checks.filter(c=>!c.passed).map(c=>c.title).join('、'));}
const app = express();
function localUi(req:express.Request){return ['localhost','127.0.0.1','[::1]'].includes(req.hostname)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'');}

app.disable("x-powered-by");
app.use((req,res,next)=>{if(process.env.RELEASE_MODE!=='true'){let host='';try{host=new URL('http://'+req.headers.host).hostname;}catch{}if(!['localhost','127.0.0.1','[::1]'].includes(host)||req.headers['cf-ray']||req.headers['cf-connecting-ip']){res.status(503).json({error:'当前为本机开发模式。外网访问须完成发布检查并启用正式发布配置。'});return;}}next();});
// Opt in only to known proxy addresses; never trust arbitrary forwarding headers.
const trustedProxies = (process.env.TRUSTED_PROXY_CIDRS || "").split(",").map((item) => item.trim()).filter(Boolean);
if (trustedProxies.some((item) => ["0.0.0.0/0", "::/0", "true", "*"].includes(item))) throw Error("TRUSTED_PROXY_CIDRS必须指定可信代理地址，不能信任全部来源");
if (trustedProxies.length) app.set("trust proxy", trustedProxies);
app.use(
  helmet({
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "frame-src": ["'self'"],
        "upgrade-insecure-requests": null,
      },
    },
    strictTransportSecurity:
      process.env.COOKIE_SECURE === "true" ? undefined : false,
  }),
);
app.use(cookieParser());
app.use('/api',runtimeMetrics);
app.use('/api',requestBudget(128,128));
const normalJson=express.json({limit:'2mb'}),uploadJson=express.json({limit:'7mb'}),uploadBudget=requestBudget(8,2);
app.use(async(req,res,next)=>{
 const upload=req.method==='POST'&&/^\/api\/(?:projects\/[a-f0-9-]{36}\/files|files\/[a-f0-9-]{36}\/versions)$/.test(req.path);
 if(upload||(['POST','PUT'].includes(req.method)&&/^\/api\/projects\/[a-f0-9-]{36}\/drawing-boards(?:\/[a-f0-9-]{36})?$/.test(req.path)))await authenticate(req,res,()=>uploadBudget(req,res,()=>uploadJson(req,res,next)));
 else normalJson(req,res,next);
});
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, _res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new HttpError(403, "拒绝跨站请求");
    const origin = req.headers.origin;
    if (origin) {
      let host = "";
      try {
        host = new URL(origin).host;
      } catch {}
      const expected=process.env.RELEASE_MODE==='true'&&!localUi(req)?new URL(process.env.PUBLIC_ORIGIN!).host:req.headers.host;
      if (host !== expected) throw new HttpError(403, "请求来源不匹配");
    }
    if (!req.is("application/json")) throw new HttpError(415, "请使用JSON请求");
  }
  next();
});
app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", version });
});
app.use('/api',publicLoginAppearance);
app.post(
  "/api/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "登录尝试过多，请15分钟后重试" },
  }),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    keyGenerator: (req) => String(req.body?.username || "").trim().toLowerCase().slice(0, 40),
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "该账号登录失败次数过多，请15分钟后重试" },
  }),
  async (req, res) => {
    const body = z
      .object({
        username: z.string().min(1).max(40),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const user = (
      await pool.query("SELECT * FROM users WHERE username=$1", [body.username])
    ).rows[0];
    if (
      !await verifyPasswordAsync(body.password, user?.password_hash || dummyHash) ||
      !user?.active
    ){await securityEvent('login',user?.id||null,'failure',req.ip);throw new HttpError(401, "账号或密码错误，或账号已停用");}
    await securityEvent('login',user.id,'success',req.ip);
    const token = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM sessions WHERE expires_at<now()");
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,now()+interval '12 hours')",
      [tokenHash(token), user.id],
    );
    res
      .cookie("studio_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "true" && !localUi(req),
        maxAge: 12 * 60 * 60 * 1000,
        path: "/",
      })
      .json({ id: user.id, name: user.name });
  },
);
app.use("/api", operationRecorder);
app.use("/api", authenticate);
app.use('/api',requestBudget());
app.use('/api',rateLimit({windowMs:60_000,limit:600,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'操作频率过高，请稍后重试'}}));
app.use('/api',securityRoutes);
app.use('/api',securityConsole);
app.use("/api", (req, _res, next) => requestActor.run(req.user.id, next));
app.use('/api',loginAppearance);
app.use('/api',atomicAI);
app.get("/api/manual", (_req, res) => {
  res.download(
    path.resolve("docs/MANUAL_GUIDE.html"),
    "Project-Studio-Manual-Guide.html",
  );
});
app.post("/api/logout", async (req, res) => {
  await securityEvent('logout',req.user.id,'success',req.ip);
  await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
    tokenHash(req.cookies.studio_session),
  ]);
  res.clearCookie("studio_session", { path: "/" }).json({ ok: true });
});
app.use(
  "/api",
  workspaceStorage, costManagement, resourceTimeCurves, actualRemaining, constraintPreview, activityCodes, durationLinks, delayAnalysis, progressControl, scheduleControls, viewPreferences, operationsHealth, dataReadiness, releaseRoutes, publicViews, projectDashboard, planningWorkbench, networkPlans, ai, planTable, recordLinks,
  workItems,
  permissionExplanation,
  diagramImport, projectRoles, governance,
  objects,
  tableMoves,
  departmentRoutes,
  files,
  ownerItems,
  references,
  approvals,
  data,
  planning,
  todoActions,
  connections,
  imports,
  notifications,
  resources,
  printForms, reportDocuments, reportSchedules, drawingBoards, toolboxDocuments, agendaTables,
);
app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
app.use('/drawio',(_req,res,next)=>{res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'self'");next()},express.static(path.resolve('vendor/drawio'),{index:'index.html',maxAge:'1d'}));
app.use(express.static(path.resolve(process.env.STUDIO_STATIC_DIR||"dist"), { maxAge: "1h", index: false }));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve(process.env.STUDIO_STATIC_DIR||"dist","index.html")),
);
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .slice(0, 4)
          .join("；"),
      });
    if (err instanceof LoeError)return res.status(400).json({error:err.message});
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message });
    if(typeof err.message==='string'&&err.message.startsWith('AGENDA:'))return res.status(400).json({error:err.message.slice(7)});
    if(err instanceof StatisticsError)return res.status(400).json({error:err.message});
    if (err.code === "P0001" && err.message?.startsWith("LIFECYCLE:"))
      return res.status(409).json({ error: err.message.slice(10) });
    if (err.code === "P0001" && err.message?.startsWith("REFERENCE:"))
      return res.status(409).json({ error: err.message.slice(10) });
    if(err.code==='P0001'&&err.message?.startsWith('AUTOINCREMENT:'))return res.status(400).json({error:err.message.slice(14)});
    if(err.code==='P0001'&&err.message?.startsWith('AUTOCODE:'))return res.status(400).json({error:err.message.slice(9)});
    if (err.code === "40P01" || err.code === "40001")
      return res
        .status(409)
        .json({ error: "关联数据同时发生修改，请刷新后重试" });
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "名称、账号或申请已存在，请刷新后重试" });
    if (err.code === "23503")
      return res
        .status(409)
        .json({ error: "该对象仍被其他记录引用，或关联对象已不存在" });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "JSON格式无效" });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "请求体过大；普通请求最多2MB，文件必须小于5MB" });
    if (/作业依赖|前置作业|工期无效|同一对作业的同类型逻辑关系重复|作业标识重复|完成率无效|逻辑关系或时距无效/.test(err.message))
      return res.status(400).json({ error: err.message });
    console.error("Request failed", {
      name: err.name,
      code: err.code,
      message: err.message,
    });
    res.status(500).json({ error: "服务器处理失败，请稍后重试" });
  },
);
registerAgentRoutes([costManagement,resourceTimeCurves,actualRemaining,constraintPreview,activityCodes,durationLinks,delayAnalysis,progressControl,scheduleControls,networkPlans,securityConsole,publicViews,projectDashboard,planningWorkbench,planTable,recordLinks,workItems,projectRoles,governance,objects,tableMoves,departmentRoutes,files,ownerItems,references,approvals,data,planning,todoActions,resources,reportDocuments,drawingBoards,agendaTables]);
installWorkTracking(app);
startBackupScheduler();
startReportScheduler();
const server = app.listen(Number(process.env.PORT || 9090), process.env.HOST || "127.0.0.1", () =>
  console.log(
    "Project Studio is listening on port " + (process.env.PORT || 9090),
  ),
);
process.on("SIGTERM", () =>
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  }),
);
