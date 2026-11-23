# PM studio

工程建设项目管理平台，源码基于 Project Studio V0.62.29 整理。包含中英文界面、Excel 风格数据录入、计划排程、资源和费用、报表、审批、项目文件、工具箱、安全审计与 AI。

此目录是一份独立的可发布源码副本。没有复制原部署的数据库记录、个人账号、项目数据、上传附件、AI聊天记录、API Key、环境文件、备份或 Git 历史。**保留数据库结构和迁移、通用表格/报表模板、业务关系、计算和权限逻辑。** 新安装使用空白业务数据；通用模板由程序生成。

## 功能

- 空间和项目隔离、部门及角色权限、记录状态确认、public 视图。
- WBS 层级、作业关系、项目日历、CPM、基线、浮时、资源分配和费用/挣值计算。
- 双代号时标网络图、横道图、组织架构、资源负荷。
- 九类报表模板、周期任务、统计快照、打印表单。
- 文档、Markdown、离线 draw.io、数学手册和单位换算。
- AI助手与AI写作：授权数据查询、关联分析、预览确认写入；写作仅修改文档。
- 审计、备份策略、业务对象/关系/动作条件和只读闭环分析。

## 技术与目录

Node.js 22、TypeScript、React、Vite、Express、PostgreSQL 16。AI模型服务为可选配置，源码不附带任何密钥。

| 目录 | 内容 |
| --- | --- |
| `src/` | 前端界面、中英文、编辑器和可视化 |
| `server/` | API、权限、业务服务、SQL结构及增量迁移 |
| `shared/` | 共享类型、通用模板目录、排程与计算规则 |
| `scripts/` | 初始化配置、指南构建、模板维护等通用脚本 |
| `tests/` | 单元测试及需要独立测试环境的集成/界面脚本 |
| `vendor/` | 离线 draw.io 资源及其原始许可证 |
| `docs/` | 离线使用指南、源码脱敏说明及依赖声明 |

## 快速开始：Docker

需要 Node.js 22、Docker Engine / Docker Desktop 和 Compose v2。

```sh
npm ci
node scripts/setup-env.mjs
docker compose up -d --build
```

打开 `http://localhost:9090`。新安装的独立随机初始密码保存在 `secrets/initial-accounts.txt`，分别对应 `admin` 和 `superadmin`，首次使用后修改。程序不会把密码打印到终端；这些文件必须只留在自己的机器上。

初始化自动执行 `server/migrate.ts`，创建表、索引、约束、权限和初始管理账号。默认 `SEED_DEMO=false`，不导入任何原项目或演示业务记录。数据库保存在 Docker 命名卷，停止容器不会删除它。请勿随意执行删除卷操作。

查看启动情况：

```sh
docker compose ps
docker compose logs --tail=100 migrate app
```

Docker 的全新构建和启动需要在目标机器上实际验收；本次源码整理的验证范围见 `docs/SOURCE_EXPORT.md`。

## 本机 PostgreSQL 部署

1. 安装 Node.js 22 和 PostgreSQL 16，执行 `npm ci`。
2. 执行 `node scripts/setup-env.mjs` 生成配置。也可以参照两个 `.env.*.example` 手动配置全新凭据。
3. 在 PostgreSQL 中创建专用数据库 `project_studio` 与迁移账号 `studio`，把 `.env.migrate` 的连接串指向它。迁移账号须具备建表、建角色及授予权限的能力；只用于可信的独立初始化。
4. 执行迁移、构建和启动：

```sh
node --env-file=.env.migrate --import tsx server/migrate.ts
npm run build
node --env-file=.env --import tsx server/index.ts
```

迁移会创建受限运行角色 `studio_app`。`.env` 必须使用该角色，不能使用数据库超级用户。`APP_DB_PASSWORD` 为48位十六进制字符串，`ENCRYPTION_KEY` 为64位十六进制字符串；迁移和运行使用相同加密密钥。已有数据库的角色密码不会因重复迁移自动轮换。

数据库备份需要 PostgreSQL 客户端 `pg_dump` 与 `pg_restore` 位于 PATH，或设置 `PG_DUMP_BIN`、`PG_RESTORE_BIN` 为目标机器的可执行文件路径；恢复脚本可通过 `STUDIO_PG_BIN` 指定工具目录。

本机默认仅监听 `127.0.0.1:9090`。开发时后端保持运行，另开终端 `npm run dev`，使用 Vite 输出的本机地址。

## 模板与数据

表格、部门、流程、报表、专业分类等通用定义在 `shared/business-catalog.ts`、`shared/report-template-catalog.ts` 及相应服务中。新建项目后按界面选择并应用模板。模板字段、引用和计算逻辑保留；原使用者实际录入的数字、人员、采购单据、私有文档及自定义运行配置没有打包。

`server/schema.sql` 与其他 `.sql` 文件属于系统结构/迁移代码，不是原数据库备份。不要只执行单个 schema 文件代替完整迁移。

## AI配置

登录后由有权限的管理员在软件内设置服务地址、模型和自己的密钥。可以配置 Ollama 或兼容的云端服务。Docker 内访问宿主机 Ollama 通常使用 `host.docker.internal`；Linux 需要自行配置宿主机映射和允许访问地址。联网检索取决于配置的服务及网络能力，并非所有模型都原生支持。

AI查询受用户权限与项目范围约束；增删改需开启本轮修改、审阅结果并确认。AI写作只保存文档，业务变更由AI助手处理。

## 测试与使用指南

```sh
npm test
npm run typecheck
npm run build
node scripts/build-manual.mjs
```

浏览器测试可另执行 `npx playwright install chromium`。集成测试需要独立测试库和专用账号，部分脚本会执行写入或初始化，**不要对正式数据库批量运行集成测试**。

- `docs/MANUAL_GUIDE.html`：离线HTML使用指南，可直接打开。
- `docs/USER_GUIDE.md`：操作、权限、数学公式与数据逻辑。
- `docs/MANUAL_GUIDE.md`：版本和详细功能说明。

## 远程使用

默认配置用于本机。向外网开放前需配置 HTTPS、真实反向代理、`PUBLIC_ORIGIN`、`TRUSTED_PROXY_CIDRS`、`COOKIE_SECURE=true`，按程序发布检查启用 `RELEASE_MODE=true`，并为目标环境建立备份和恢复方案。源码不包含原使用者的 Tailscale 地址和部署配置。

## 许可与商业服务

主项目采用 Apache License 2.0，参见根目录 LICENSE 和 NOTICE。第三方组件遵循各自许可。接受赞助，也可以提供收费部署、培训和维护服务。运行产生的环境配置、密码、备份及真实业务数据不要提交到仓库。
