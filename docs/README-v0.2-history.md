# 象生 XiangSheng v0.2

## 2026-11-02 基础链路修复

默认模式已改为真实 API。前端通过 Vite 的 `/api` 代理连接 8000 后端，不配置环境变量也可上传解析。只有显式设置 `VITE_USE_MOCK=true` 才使用演示数据。

Windows 在项目根目录执行 `powershell -ExecutionPolicy Bypass -File .\start-dev.ps1`，打开 http://localhost:5173/ 。启动脚本使用依赖完整的 Python 3.11；首次准备环境执行 `py -3.11 -m pip install -r backend/requirements.txt` 和前端目录下的 `npm install`。

上传完成点击“打开生成的网页”：左侧为本文件缩略图，中央按原始尺寸比例展示 PPT，底部翻页；“开始演示”进入全屏。可识别的图表、表格、受限标量公式和二维向量映射提供交互入口，图示、计算结果与控件共用参数状态。保存参数后可重新打开，生成分享网页后可在无需原会话的浏览器中操作。

当前边界：图片中的任意公式和图形尚无通用视觉识别；不明确内容保留原页，不替换成示例。文字公式仅支持受限标量算术和白名单函数，矩阵推导需要本页明确矩阵或足够且一致的向量映射。下文 v0.2 的 mock 默认说明与“后端端点尚未实现”是历史记录，以本节为准。

「象生」把 PPT 中分散在不同页的参数、图示、流程与数据，组织成可操作的网页：同一组参数同时驱动几何图、数值表、计算步骤与来源页码。你改哪个数，图、表、步骤一起回应。

> 这是赛题原型（v0.2）。页面里的数值全部来自仓库内的确定性内核，再由另一套独立实现逐项复核；界面不做推断，也不生成"看起来对"的答案。

## 核心能力

| 能力 | 在项目中的落点 |
| --- | --- |
| **统一参数模型** | 一页 PPT 收敛成 `KnowledgeObject`：`parameters` + `views` + `bindings` + `source_refs`（契约 `C-KO@1`，`contracts/schemas/`）。参数、视图、来源是一份数据，不是一个页面一段脚本。 |
| **多视图同步** | 几何图、数值表、计算步骤、来源页读同一个 `revision`；拖滑块只改参数，其余视图同步派生（`frontend/src/state/modelStore.ts`）。 |
| **确定性内核** | 四个无副作用纯函数内核：`matrix_2d`（矩阵作用 / 行列式 / 秩 / 复合顺序）、`force_2d`（共点力合成）、`bfs_flow`（BFS 访问顺序）、`budget_compare`（两方案报价交叉）。金额用十进制字符串，浮点比较容差 1e-9（`backend/app/engines/`）。 |
| **独立校验** | `backend/app/validators/` 与内核走不同的实现路径复算；校验报告绑定 `model_version` / `revision`，参数一改就标记过期，过期报告不作为通过依据。 |
| **来源可溯** | 每个参数带 `source_ref_ids`，来源记录页码、元素与坐标；课程材料 5 条页级来源指向第 6 / 9 / 10 / 14 / 18 页。示例对象标 `manual_demo`、页码为 `null`，不伪造"原文第几页"。 |

明确不做的事：**不生成"AI 生成的交互网页"**。页面结构、数值与来源由契约、解析产物和确定性内核给出，模型不参与计算，也不执行任何生成的 JavaScript。

## 快速开始（本地）

### 环境要求

- Node.js ≥ 18（本地实测 v24.13.0；Docker 镜像用 `node:22-alpine`）
- Python 3.11（`backend/requirements.txt` 固定版本，实测 Python 3.11.9）
- 可选：Docker Desktop + Compose v2（仅 `deploy/` 需要）

### 只跑前端（mock 数据，最快）

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

默认 `VITE_API_BASE` 为空，前端走 `src/api/mockClient.ts`，直接读仓库根 `fixtures/**`，**不需要后端**。
dev 阶段 `/fixtures/**` 由 `vite.config.ts` 的插件映射到仓库根；build 时把 JSON 产物 emit 到 `dist/fixtures/**`。

### 前端 + 真实后端

```bash
# 终端 1（仓库根）：安装并启动后端
python -m pip install -r backend/requirements.txt
python -m uvicorn app.main:app --app-dir backend --port 8000
```

```bash
# 终端 2：前端连真实 API
cd frontend
npm install
# 新建 .env.local，写入（只写 origin，不要带 /api/v1）：
# VITE_API_BASE=http://127.0.0.1:8000
npm run dev
```

改完 `.env.local` 需重启 dev server。跨端口请求时，后端 `ALLOWED_ORIGINS` 默认已包含 `http://localhost:5173`。

注意：当前真实 API 只注册到 **#11**（见下文"已实现"），知识对象 / 运行 / 校验等 #12–#19 仍在 T10 并行开发中。要完整体验工作台的调参、运行与校验，请先用默认 **mock 模式**；真实 API 模式适合验证上传、示例克隆、材料列表与任务状态。

### Mock 与真实 API 的切换

| 模式 | 配置 | 数据来源 | 需要后端 |
| --- | --- | --- | --- |
| Mock（默认） | `VITE_API_BASE` 留空 | `mockClient.ts` 读 `fixtures/**` | 否 |
| 真实 API | `VITE_API_BASE=<后端 origin>` | FastAPI + SQLite | 是 |

两套实现共用 `frontend/src/api/types.ts` 的同一份类型定义，页面与 hooks 不感知当前模式。

## 演示路径（默认 mock 模式，开箱可点）

### 路线 1：从首页「探索示例」进入（约 30 秒）

1. 打开 `http://localhost:5173/`。
2. 点首屏主按钮组里的 **「探索示例」** → `/examples`。
3. 在「空间与矩阵」卡片点 **「进入工作台」**。
4. 落地到 `/materials/mock-example-example_matrix_2d-<时间戳>/work?view=interactive`（`material_id` 每次克隆都不同，属正常）。
5. 在工作台里：
   - 矩阵控件区（画布右侧）「矩阵 A / 矩阵 B / 输入向量 x」拖滑块，或直接拖动画布上的向量端点；
   - 顶栏和模板头部的 **原始 / 变换后 / 叠加** 三态切换几何显示；
   - 中部「组合顺序对比」看 **A(Bx)** 与 **B(Ax)** 两条路径，以及 `AB`、`BA` 与是否可交换；
   - 右栏「来源」显示 `manual_demo`、`page=null`（示例不伪造页码）；
   - 模板底部「第 6 / 9 / 10 / 14 / 18 页」按钮切到 source 视图（mock 克隆副本自带这 5 页回退幻灯片）。

### 路线 2：完整来源（第 6 / 9 / 10 / 14 / 18 页）

1. 打开 `/space`（个人空间）。
2. 列表里「用空间视角理解矩阵运算」一行点 **「准备页」** → `/materials/matrix-courseware/prepare`。
3. 点 **「确认并编译」**（可先全选，把参数来源标为 `user_confirmed`）。
4. 落地到 `/materials/matrix-courseware/work?view=interactive&object=course_matrix_2d`。
5. 拖 `matrix_A` / `matrix_B` / `vector_x`；切换原始 / 变换后 / 叠加；对照 A(Bx) vs B(Ax)；点「第 6 页」等按钮，URL 变为 `?view=source&source=src_s6&page=6`，右栏来源高亮对应页。

### 关于 material_id（重要，避免点空）

- `fixtures/materials/matrix-courseware/` 是真实解析产物，其中 `material_id` 为 **`mat_matrix_courseware`**（目录名是 `matrix-courseware`）。
- mock 模式下内置的课程材料 id 是 **`matrix-courseware`**，上面路线 2 用的就是它。
- 后端当前**不会**在启动时把 `fixtures/materials/**` 导入 SQLite，因此真实 API 模式下 `GET /api/v1/materials` 初始为空。直接访问 `/materials/mat_matrix_courseware/prepare` 在两种模式下都会提示「材料不可用」；让真实链路加载该材料需要上传原件，或等集成任务（T13）补齐导入步骤。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `frontend/` | React 18 + TypeScript + Vite 单页应用。`src/pages/` 页面、`src/components/` 组件、`src/templates/` 四模板交互视图、`src/domain/` 前端纯函数、`src/api/` 契约客户端与 mock |
| `backend/` | FastAPI + SQLAlchemy + SQLite。`app/api/` 路由、`app/engines/` 确定性内核、`app/validators/` 独立校验、`app/parsers/` PPT 解析、`app/db/` 9 张表、`scripts/selftest.py` 自检 |
| `contracts/` | `openapi.yaml` 与 JSON Schema（`C-KO@1`、`C-RUN@1`、`C-API@1`、`C-ERR@1` 等） |
| `fixtures/` | `examples/`（四张手工示例）、`golden/`（黄金用例）、`materials/matrix-courseware/`（真实解析产物）、`ppt/`（导出图） |
| `design/` | 设计令牌（`design-tokens.json`）与 logo |
| `deploy/` | 前后端 Dockerfile、docker compose、nginx 反代配置与部署说明 |
| `.codeartsdoer/plans/xiangsheng-v0.2/` | 设计源 `plan.md`（需求条目、契约与任务边界） |
| 根目录 `.pptx` / `.docx` | 赛题材料与设计文档原件（只读输入，不参与构建） |

## 已实现 / 未实现（Non-goals）

### 已实现

- **前端**：首页、示例大厅、个人空间、准备页、工作台、使用指南；四模板交互视图（矩阵、力、BFS、预算）；来源定位、运行快照只读回放、校验报告过期标记、版本冲突对话框；`prefers-reduced-motion` 与 `[data-reduced-motion]` 降级动效。
- **后端**：#1–#11（会话、模板、示例克隆、材料上传 / 列表 / 详情 / 删除 / 资源代理、任务轮询 / 重试）；9 张表 SQLite；统一错误体与 `X-Request-Id`；CORS 与 CSRF。
- **内核与校验**：四模板纯函数内核 + 独立复核实现，黄金用例本地 17/17 PASS。
- **契约与夹具**：`contracts/**`、`fixtures/examples/**`、`fixtures/golden/**`、`fixtures/materials/matrix-courseware/**`（24 页真实解析产物）。
- **交付件**：`deploy/` 两个 Dockerfile、compose、nginx 配置、根 `.env.example`。

### 未实现（Non-goals）

- 后端 **#12–#19**（知识对象读写、编译、运行、校验、检查列表）由 T10 并行开发中；当前 mock 模式这些能力可用，真实 API 模式工作台会缺这些端点。
- 不接入真实华为云 ECS / RDS / DCS / OBS / MaaS；本轮只交付配置与占位环境变量，**未执行任何部署命令**。
- 不运行 PPT 宏，不 `eval` 用户公式，不执行任何模型生成的 JavaScript。
- 不做教师端、班级、协作编辑、公开分享、审批流。
- 不做通用三维物理仿真、任意程序执行、SmartArt / 3D / 位图内数据自动识别。
- 不声明"自动转换率 / 准确率 / 用户数 / 成功率"等未实测指标。

## 验证

```bash
# 1) 四模板黄金用例 + 独立校验（仓库根，无需启动服务）
python backend/scripts/selftest.py

# 2) 前端类型检查与生产构建
cd frontend
npx tsc --noEmit
npm run build        # tsc -b && vite build，产物在 frontend/dist
```

最近一次本地运行（2026-11-01，Windows 11 / Python 3.11.9 / Node 24.13.0）：

```text
总结：17/17 PASS
SUMMARY pass=133 fail=0 not_covered=27
```

前端 `npm run build` 通过，产物为 `frontend/dist`。这只能说明"能构建"，不等于浏览器端到端验收（由 T13 负责）。

## 部署

见 [`deploy/README.md`](deploy/README.md)。最小命令：

```bash
cp .env.example .env          # Windows: copy .env.example .env
# 编辑 .env，至少填写 SESSION_SECRET
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
# 打开 http://localhost:8080
```

当前开发机未安装 Docker，**未实际构建或启动镜像**；`deploy/docker-compose.yml` 只做了 YAML 静态校验，`deploy/nginx.conf` 只做了括号配对检查。真实构建属于 T13 / 部署环境。

## 环境变量

完整清单见根目录 [`.env.example`](.env.example)（全部为占位值，禁止填入真实密钥）。最常用的几项：

| 变量 | 默认 / 示例 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 空（必须注入） | 会话签名密钥；为空时后端随机生成并告警，进程重启后旧会话失效 |
| `SESSION_COOKIE_SECURE` | `false` | 本地 HTTP 必须为 false；生产 HTTPS 改为 true |
| `DATABASE_URL` | `sqlite:///./data/xiangsheng.db` | SQLite 单文件地址 |
| `CORS_ORIGINS` / `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:8080` | 写请求 Origin 白名单（后端实际读取 `ALLOWED_ORIGINS`，`CORS_ORIGINS` 供 compose 插值） |
| `UPLOAD_MAX_MB` / `MAX_UPLOAD_BYTES` | `20` / `20971520` | 单文件上传上限（后端实际读取字节数） |
| `UPLOAD_MAX_PAGES` / `MAX_SLIDE_PAGES` | `60` / `60` | 单材料页数上限（后端实际读取 `MAX_SLIDE_PAGES`） |
| `VITE_API_BASE` | 空 | 空 = mock；真实 API 填后端 origin（Docker 下 compose 对空值回退 `http://localhost:8080`） |

## 数据与隐私

- 访客会话，无账号体系；材料默认保留 24 小时。
- SQLite 单文件 `backend/data/xiangsheng.db`；上传原件落 `backend/data/uploads/{material_id}/`，通过受鉴权的资源端点代理读取，不发直链。
- 单文件 ≤ 20 MB、≤ 60 页；拒绝含宏的 `.pptm` / 带 `vbaProject.bin` 的文件。
- 日志只记录业务标识，不打印 Cookie / CSRF / 密钥。

## 许可

赛题原型，未附带开源许可证；使用前请与作者确认。
