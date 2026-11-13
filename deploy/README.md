# 部署说明（deploy/）

本目录只提供**可审查的部署配置**，不执行任何部署命令，也不包含真实的云资源、密钥或域名凭据。

| 文件 | 作用 |
| --- | --- |
| `Dockerfile.frontend` | 多阶段：`node:22-alpine` 构建 → `nginx:1.27-alpine` 托管 `dist` |
| `Dockerfile.backend` | `python:3.11-slim`，非 root 用户 `app`，内置 healthcheck |
| `docker-compose.yml` | `frontend` + `backend` 两个服务；`backend` 挂载 `./backend/data` |
| `nginx.conf` | SPA fallback、`/api/` 反代、`/fixtures/` 静态、gzip、安全响应头 |
| `Dockerfile.*.dockerignore` | BuildKit 专属忽略规则，避免把 `node_modules`、`.env` 等带进构建上下文 |

## 1. 前置条件

- Docker Desktop（Windows / macOS）或 Docker Engine + Compose v2
- 至少 2 GB 可用内存（前端构建阶段需要 Node）
- 仓库根路径尽量使用**纯 ASCII 路径**（见"常见问题"第 1 条）

## 2. 准备环境变量

```bash
cd <仓库根>
cp .env.example .env        # Windows: copy .env.example .env
```

至少填写：

```dotenv
SESSION_SECRET=<由部署环境生成的随机串>
```

生成方式示例（不要把结果提交到仓库）：

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

`SESSION_SECRET` 留空时后端会随机生成一次性密钥并写告警日志：容器重启后旧会话 Cookie 全部失效，仅适合本地演示。
**禁止**把真实 `.env` 提交到版本库；`.env.example` 只放占位值。

## 3. 校验配置

```bash
docker compose --env-file .env -f deploy/docker-compose.yml config
```

该命令只做 YAML / 变量插值校验，不构建、不启动。
注意：`--env-file` 路径相对于当前工作目录；`build.context: ..` 相对于 compose 文件所在目录（即仓库根）。

## 4. 构建与启动

```bash
# 构建并后台启动
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build

# 查看状态（backend 需为 healthy，frontend 才会启动）
docker compose --env-file .env -f deploy/docker-compose.yml ps

# 跟踪日志
docker compose --env-file .env -f deploy/docker-compose.yml logs -f backend
```

打开 `http://localhost:8080`。

停止与清理：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml down
# 注意：down 不会删除 ./backend/data 里的 SQLite 与上传件（宿主机目录挂载）
```

## 5. 端口

| 端口 | 归属 | 说明 |
| --- | --- | --- |
| `8080`（宿主） | frontend | 可通过 `FRONTEND_PORT` 修改；容器内 nginx 固定 80 |
| `8000` | backend | **只暴露在 compose 内部网络**，由 nginx 的 `/api/` 反代访问；宿主机不映射 |
| `5173` | 本地 `npm run dev` | 与容器无关；仅在本地开发时使用 |

需要直接用 curl 调后端时，可临时执行：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec backend \
  python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/templates').read()[:200])"
```

## 6. 目录挂载

| 宿主机 | 容器 | 用途 |
| --- | --- | --- |
| `./backend/data` | `/app/data` | SQLite 文件 `xiangsheng.db`、上传原件 `uploads/{material_id}/` |

- 容器内 `WORKDIR=/app`，后端默认 `DATABASE_URL=sqlite:///./data/xiangsheng.db` 即 `/app/data/xiangsheng.db`。
- 首次启动时 `init_db()` 幂等建 9 张表；目录不存在会自动创建（镜像内已 `chown app:app`）。
- 宿主机目录若被其他进程（例如本地直接跑的 uvicorn）同时写入 SQLite，可能出现锁等待；同一时间只让一个进程写同一个库。
- **Linux / macOS 宿主机**：容器内以非 root 用户 `app`（uid 由镜像内 `useradd --system` 分配）运行，若宿主目录属主不匹配会写库失败。
  可执行 `sudo chown -R 1000:1000 backend/data`，或改用 compose 命名卷（在 `volumes` 中用 `xiangsheng_data:/app/data` 并声明顶层 `volumes:`）。
  Windows / Docker Desktop 的绑定挂载通常不需要额外处理。

## 7. 镜像内部结构

### frontend

1. 构建阶段：`WORKDIR /app`，`npm ci`（依赖 `frontend/package-lock.json`，lockfileVersion 3），
   把 `fixtures/examples`、`fixtures/golden`、`fixtures/materials` 复制到 `/fixtures`，
   再 `npm run build`。`vite.config.ts` 的 fixtures 插件会把 JSON emit 到 `dist/fixtures/**`。
2. 运行阶段：只保留 nginx 与 `dist`，**不含 Node、源码、`.env`**。
3. healthcheck：busybox `wget` 访问 `/`。

`VITE_API_BASE` 是**构建期**参数：改动后必须重新 `--build`，否则静态产物不会更新。

compose 对 `${VITE_API_BASE:-...}` 使用默认值：`.env` 里留空（`.env.example` 的默认）时，
容器内会构建成 `http://localhost:8080`（真实 API）。只有在 compose 文件中显式改成空字符串，
才会构建出 mock 版本；这一点与本地 dev 的"空 = mock"行为相反，特此说明。

### backend

1. `WORKDIR /app`，先装依赖再复制代码，利用层缓存。
2. 非 root 用户 `app` 运行；`/app/data` 归属 `app`。
3. 复制仓库 `fixtures/` 到 `/fixtures`（`settings.py` 以 `REPO_ROOT=/` 推导路径）。
4. `CMD` 直接 `uvicorn app.main:app`：容器内 `WORKDIR=/app` 等价于本地的 `--app-dir backend`。
5. healthcheck：标准库 `urllib` 请求 `/openapi.json`，不额外装 curl。

## 8. nginx 行为

- `location /`：`try_files $uri /index.html`，前端 BrowserRouter 深链接可直达（如 `/materials/.../work?view=interactive`）。
- `location /api/`：`proxy_pass http://backend:8000;`（**末尾无斜杠**，保留 `/api/v1` 前缀）。
- `location /fixtures/`：`try_files $uri =404`，只返回构建产物中的 JSON，不回退到 HTML，不列目录。
- `client_max_body_size 75m`：与后端 70 MB 上限对齐，留 multipart 开销。
- 安全响应头（server 级，避免 location 内 `add_header` 覆盖）：
  `X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: SAMEORIGIN`。
- `autoindex off`；`location ~ /\.` 返回 404，不暴露 `.env` / `.git`。
- gzip 仅文本类资源。

## 9. 常见问题

### 9.1 Windows 路径与文件共享

- 仓库路径含中文（例如 `E:\代码\ICT`）时，部分 Docker Desktop / BuildKit 版本在 `COPY` 阶段会报路径错误。
  建议把仓库放到纯 ASCII 路径，或在 WSL2 文件系统（`/home/<user>/ict`）中构建。
- 必须在 Docker Desktop 设置中共享仓库所在磁盘。
- `build.context: ..` 是相对 **compose 文件**的位置，不是相对 shell 的当前目录；因此从仓库根执行时，
  `-f deploy/docker-compose.yml` 能正确找到上下文。
- 换行符：仓库文件为 LF；若在 Windows 上被改成 CRLF，`Dockerfile` 的 `RUN` 可能出现 `\r` 报错，
  建议 `git config core.autocrlf false` 或使用 `.gitattributes` 统一 LF。

### 9.2 端口占用

Windows：

```bash
netstat -ano | findstr :8080
taskkill /PID <PID> /F
```

改为其他宿主端口：

```bash
# .env 中设置 FRONTEND_PORT=8081，然后重新 up
docker compose --env-file .env -f deploy/docker-compose.yml up -d
```

注意改端口后，浏览器 Origin 变为 `http://localhost:8081`，需要同步把 `CORS_ORIGINS` / `ALLOWED_ORIGINS`
加入该地址，并重新构建前端（`VITE_API_BASE` 也指向新端口），否则写请求会被 Origin 校验拒绝。

### 9.3 页面打开但接口全部失败

- 确认 `VITE_API_BASE` 不是空字符串：为空时前端走 mock，不会访问后端。
- 确认访问的是 nginx 端口（默认 8080），且 `/api/v1/templates` 能在浏览器直接打开返回 JSON。
- 查看 `backend` 日志与 `docker compose ps` 的 health 状态。

### 9.4 上传返回 413

同时检查两处：

- nginx：`client_max_body_size 75m`
- 后端：`MAX_UPLOAD_BYTES`（默认 70 MB）

### 9.5 `npm ci` 报 lockfile 错误

前端镜像依赖 `frontend/package-lock.json`（lockfileVersion 3）。若该文件被删除或与 `package.json` 不一致，
请先在本地执行 `cd frontend && npm install` 更新 lockfile 并提交，再重新构建。
（本仓库当前**有** lockfile，因此 Dockerfile 使用 `npm ci`。）

### 9.6 本机没有 Docker

`docker compose config` 无法执行时，可用 YAML 解析器做静态校验：

```bash
python -c "import yaml;yaml.safe_load(open('deploy/docker-compose.yml',encoding='utf-8'));print('compose ok')"
```

并检查 nginx 配置括号：

```bash
python -c "s=open('deploy/nginx.conf',encoding='utf-8').read();print(s.count('{'),s.count('}'))"
```

这只能证明语法结构，**不能**替代真实镜像构建与启动验证。
