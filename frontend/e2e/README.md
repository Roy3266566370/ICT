# PPT AI 浏览器验收说明

本目录是 T10/T11 的 Playwright 用例。默认单测不会访问真实模型：后端需设置
`LLM_PROVIDER=none`，或用控制响应替代；真实 MaaS 联调另列材料与调用次数。

## 准备

```powershell
# 1. 安装浏览器（一次）
Set-Location frontend
npx playwright install chromium

# 2. 启动后端（另一个终端，建议临时数据库）
Set-Location backend
$env:PPT_AI_ENABLED="true"
$env:PPT_AI_GENERATED_VIEWS_ENABLED="false"
$env:LLM_PROVIDER="none"
py -3.11 scripts/dev_run.py

# 3. 启动前端
Set-Location frontend
npm run dev

# 4. 准备一份已上传材料，取得 material_id
#    E2E_MATERIAL_ID 可通过 /api/v1/materials 列表或上传返回获得。
```

## 运行

```powershell
Set-Location frontend
$env:E2E_BASE_URL="http://127.0.0.1:5173"
$env:E2E_MATERIAL_ID="mat_xxx"
# 可选：直接复用已有访客会话 Cookie（材料属于该会话时）
$env:E2E_SESSION_COOKIE="ses_xxx"
# 专用视图材料属于另一会话时单独提供
$env:E2E_GENERATED_VIEW_COOKIE="ses_yyy"
npm run test:ppt-ai:e2e
```

- 专用视图：把 `PPT_AI_GENERATED_VIEWS_ENABLED=true` 后重启后端，并设置
  `E2E_GENERATED_VIEW_MATERIAL_ID`。
- 离线：先导出单文件 HTML，再设置 `E2E_OFFLINE_HTML` 指向该文件。

## 用例边界

- 浏览器截图只能证明页面可操作，不能证明数学结果正确；数值由后端内核、校验用例与
  独立报告检查。
- 如果缺少环境变量，相关用例会跳过并在报告中说明，不能把跳过记作通过。
- 沙箱用例检查 iframe 的 `sandbox` 属性与外发请求；静态扫描通过不等于隔离证明。
