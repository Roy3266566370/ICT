# 账号与首页补齐任务独立复查

复查及修复复验日期：2026-11-07。最初复查范围为 A01、A03–A06 及运行进程清理；本轮按用户要求仅修复 A06 草稿隔离遗漏和 A01 无效 OpenAPI 放行问题。

## 结论

**本轮指定的两项修复已完成，复验结论为 `PASS`。**

此前 `NEEDS_FIX` 对应的 R01/A06、R02/A01 均已关闭：准备页的活动草稿入口已接入账号范围与来源签名校验；启动脚本在无法读取、解析或确认文档结构时会报错退出。后端最终全量 **436 passed、8 skipped**，前端 **181 passed、0 failed**，类型检查和构建均通过。该结论限于本轮修复范围，不代表所有生产准备工作已经完成。

按用户裁决，A02、A07–A17 不作为本次补齐遗漏；本报告也不把这些功能纳入新的验收要求。

## 本轮修复内容

| 问题 | 当前状态 | 关键改动 |
| --- | --- | --- |
| R01 / A06 / P1 | 已修复并复验 | 区域草稿的读、写、清理显式接收 scope；键使用统一格式，内容核对 scope 与来源签名；hook 按账号、材料、来源签名管理归属，切换首帧隐藏旧值，并拒绝旧归属的事件回调 |
| R02 / A01 / P2 | 已修复并复验 | HTTP/JSON/结构错误直接抛错；有效但缺路由的文档仍明确报告缺路由；拒绝顶层数组，并按大小写精确检查 `paths` 属性及必需路径 |

当前代码位置：

- `frontend/src/components/regions/regionDrafts.ts:340`：统一 `xiangsheng.region.v1.<scope>.<materialId>.<regionId>` 键；保存 scope，读取时同时核对 scope 与 `sourceSignature`。无 scope 的旧键不迁移、不恢复。
- `frontend/src/components/regions/useRegionDrafts.ts:48`：订阅唯一账号状态源，账号、材料或来源变化时重建状态；第 61 行在首次渲染就隐藏不属于当前数据的值；第 76 行起防止旧事件回调在退出后重新落盘。
- `start-dev.ps1:72`：读取/解析失败及不合要求的文档结构统一抛出“无法验证账号路由”；第 104 行起保留明确的缺路由检查，不再跳过校验。
- 新增回归：`frontend/src/components/regions/regionDrafts.test.ts`、`backend/tests/test_dev_route_probe.py`。

最终独立代码复核未发现实际缺陷。复核曾发现 PowerShell 自动展开单元素 JSON 数组的问题；已加入先失败、后通过的回归并关闭。没有使用仅新版 PowerShell 支持的 `-NoEnumerate`。

## 本轮重新验证的证据

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| 后端全量 `py -3.11 -m pytest -q` | **436 passed、8 skipped**，退出码 0 | [backend-tests.log](../../../verify/account-fixes-2026-11-07/backend-tests.log)、[退出码](../../../verify/account-fixes-2026-11-07/backend-tests.exit) |
| 启动脚本专项 | **12 passed**：HTML 200、缺少/null/数组/字符串 paths、顶层单元素数组、属性及路径大小写、空 paths、缺 me、HTTP 503、带前导空白的完整文档 | [route-green.log](../../../verify/account-fixes-2026-11-07/route-green.log) |
| 前端 `npm test` | **181 passed、0 failed**，包含新增的 9 项真实区域草稿模块测试 | [frontend-tests.log](../../../verify/account-fixes-2026-11-07/frontend-tests.log)、[退出码](../../../verify/account-fixes-2026-11-07/frontend-tests.exit) |
| 真实 hook 浏览器回归 | **11/11**，在 React StrictMode 下验证首帧隔离、清理、旧回调、来源变化与同账号重新挂载恢复 | [hook-green.json](../../../verify/account-fixes-2026-11-07/hook-green.json)、[可重跑脚本](../../../verify/account-fixes-2026-11-07/region-hook-probe.js) |
| 前端 `npm run typecheck` | 通过，退出码 0 | [typecheck.log](../../../verify/account-fixes-2026-11-07/typecheck.log) |
| 前端 `npm run build` | 主站及 offline 构建通过，退出码 0；仍有原有体积提示 | [build.log](../../../verify/account-fixes-2026-11-07/build.log)、[退出码](../../../verify/account-fixes-2026-11-07/build.exit) |
| 正常开发启动 `./start-dev.ps1` | 退出码 0，复用现有服务并确认全部 4 条账号路由 | [start-dev.log](../../../verify/account-fixes-2026-11-07/start-dev.log) |
| 服务及清理复核 | 8000/5173 正常；此前列出的临时端口无监听；本轮探测存储已清除、专用浏览器已关闭 | [final-runtime-check.json](../../../verify/account-fixes-2026-11-07/final-runtime-check.json)、[browser-cleanup.json](../../../verify/account-fixes-2026-11-07/browser-cleanup.json) |

专项数量已包含在各自全量测试中，不额外累加。

修复前失败证据也保留：草稿模块原先 8 failed、1 passed；启动检查原先 7 failed、2 passed。最终复核新增的数组根及大小写三例，修正前 3 failed、9 passed，修正后 12 passed。证据：[region-red.log](../../../verify/account-fixes-2026-11-07/region-red.log)、[route-red.log](../../../verify/account-fixes-2026-11-07/route-red.log)、[route-edge-red.log](../../../verify/account-fixes-2026-11-07/route-edge-red.log)。

验证边界：浏览器回归挂载正式的 `useRegionDrafts`，通过唯一账号状态源的临时内存状态驱动 A → B → guest，接入正式账号范围清理订阅；本轮没有新建数据库账号或材料。它覆盖真实 hook、存储、清理与渲染行为，仍不等同于上传真实 PPT 后的完整作品跨账号流程。8 项专用 MySQL 集成测试未配置开关，保持明确跳过。Windows PowerShell 5.1、冷启动新进程分支、真机/其他浏览器和生产配置未在本轮重新执行。

## 修复前的问题及复现记录（历史）

### R01 / P1：准备页区域草稿仍使用无账号范围的旧键（已修复）

以下为修复前位置及行为：

- `frontend/src/components/regions/regionDrafts.ts:339–349`：`draftStorageKey()` 仍返回 `xiangsheng:region-draft:<materialId>:<regionId>`，`saveDraft()` 将其写入 `sessionStorage`。
- `frontend/src/components/regions/regionDrafts.ts:361–387`：`loadDraft()` 仍读取这个旧键，仅核对来源签名，没有账号校验。
- `frontend/src/components/regions/useRegionDrafts.ts:36`：实际初始化会调用上述读取函数；初始化标识和保存回调也没有账号范围。
- `frontend/src/pages/PreparePage.tsx:231`：正式准备页调用 `useRegionDrafts(materialId, regions)`，因此该路径并非无用代码。

新 `state/draftScope.ts` 只识别 `xiangsheng.<kind>.v1.<scope>.<parts>`，主动忽略旧键。其他草稿已经迁移，并不能保证这个仍在使用的旧入口得到隔离。

本次实际复现：

1. 浏览器使用本次新注册的临时账号登录。
2. 导入应用实际的 `regionDrafts.ts` 模块，对专用探测材料/区域 ID 调用 `saveDraft()`，参数 `shear_k=9`，来源签名为 `review-fingerprint`。
3. 当前 scope 为 `user:<临时账号 ID>`；同一模块能读回 `9`，但新清理器的 `isDraftKey()` 对该键返回 `false`。
4. 通过页面账号菜单执行真实退出，状态变为 `guest`。
5. 再次调用同一模块的 `loadDraft()`：仍返回之前的 `shear_k=9`，旧键仍在 `sessionStorage` 中。
6. 复现后删除了这个专用探测键，没有创建真实材料记录。

影响：同一标签页在退出或切换账号后，只要再次访问同一材料/区域且来源签名未变，仍存在恢复上一个账号编辑值的路径。该问题属于前端本地草稿隔离 A06，不依赖尚未实施的后端资源归属 A02。

修正要求：让该活动入口统一使用带 scope 的键，读取时核对 scope 和来源指纹；账号范围变化时重建或清空 hook 内存状态；停止恢复旧无 scope 键。补充覆盖这个真实模块入口的回归验证，不能只验证新键工具函数。

验证边界：本次是“真实模块 + 真实登录/退出 + 实际浏览器存储”的复现，未上传真实 PPT，也未完成真实作品编辑器的跨账号全流程。因此原报告中的真实作品验证不足仍然存在。

### R02 / P2：启动脚本无法解析 OpenAPI 时跳过校验（已修复）

修复前位置：`start-dev.ps1:92–97`。

`Get-OpenApiPaths()` 在解析失败或文档没有 `paths` 时返回 `$null`；`Assert-RequiredRoutes()` 随后输出 `account route check skipped` 并直接返回，未抛错。

本次实际复现：用一个临时本地 HTTP 服务在 `/openapi.json` 返回 HTTP 200、正文为非 JSON 的 HTML；通过 PowerShell AST 提取并执行当前文件中的原始检查函数。结果：

```text
Cannot read http://127.0.0.1:57263/openapi.json; account route check skipped.
ASSERT_RETURNED_SUCCESS
exit_code: 0
```

证据：[malformed-openapi-check.json](../../../verify/account-closure-recheck-2026-11-07/malformed-openapi-check.json)。临时 HTTP 服务已关闭。

影响：错误服务、代理 HTML 或损坏响应返回 200 时，脚本仍可能把未完成路由验证的服务当作可用。它虽不影响本次已确认正常的新后端，但违反 A01“无法确认必需路由时应报错退出”的目的，不能仅列为无缺陷观察项。

修正要求：无法读取、解析或验证文档时明确报错并非零退出，区分“文档不可用”和“缺少路由”。覆盖非 JSON 200、缺少 `paths`、有效文档但缺少账号路由三个场景。

## 非阻塞观察

注册页有两个返回首页入口：页头已有一个，右下角仍出现全局快捷入口。`frontend/src/App.tsx:83–91` 排除了 `/login`，没有排除 `/register`。这是可顺手修正的重复入口，不作为本轮功能失败的主要依据。

截图：[注册页](../../../verify/account-closure-recheck-2026-11-07/02-register.png)。

## 上轮验证记录（修复前，保留供追溯）

| 检查 | 本次结果 | 证据 |
| --- | --- | --- |
| 后端全量 `py -3.11 -m pytest -q` | 424 passed、8 skipped，0 failed | [backend-tests.log](../../../verify/account-closure-recheck-2026-11-07/backend-tests.log) |
| 前端 `npm test` | 172 passed，0 failed | [frontend-tests.log](../../../verify/account-closure-recheck-2026-11-07/frontend-tests.log) |
| 前端 `npm run typecheck` | 通过 | [typecheck.log](../../../verify/account-closure-recheck-2026-11-07/typecheck.log) |
| 前端 `npm run build` | 主站及 offline 构建完成；存在构建体积提示 | [build.log](../../../verify/account-closure-recheck-2026-11-07/build.log) |
| 浏览器实际账号流程 | 首页注册入口 → 注册 → 自动登录 → `/space` → 刷新保持 → 菜单退出，通过 | [登录后空间](../../../verify/account-closure-recheck-2026-11-07/03-auto-login-space.png)、[刷新后空间](../../../verify/account-closure-recheck-2026-11-07/04-refreshed-space.png)、[退出后](../../../verify/account-closure-recheck-2026-11-07/05-logout.png) |
| 页面启动 `/me` 请求 | 本次刷新记录中 `/api/v1/me` 恰好 1 次 | 浏览器 performance resource 记录及刷新后账号状态 |
| 当前运行的账号路由 | POST register/login/logout、GET me，4 条均存在 | [final-runtime-check.json](../../../verify/account-closure-recheck-2026-11-07/final-runtime-check.json) |

本次后端测试没有设置 `XIANGSHENG_MYSQL_TEST_URL`，8 项专用 MySQL 集成测试明确跳过。不能把原报告中的“8 passed”算成本次独立复跑结果。本次浏览器注册和登录使用当前配置的真实开发 MySQL，但它也不等同于那 8 项专用集成测试。

没有重新执行原报告全部 T7/Phase F 脚本，因此不对它们的每个计数追加独立背书。测试通过也不能抵消上面已经复现的范围遗漏。

## 上轮运行阻塞及残留清理记录

已执行用户报告要求的 `./start-dev.ps1 -Restart`，脚本退出码为 0。日志：[restart.log](../../../verify/account-closure-recheck-2026-11-07/restart.log)。

- 旧 8000 后端已替换；新 OpenAPI 为 47 条路径，4 条必需账号端点均带正确方法。
- 最终 8000 后端 PID 为 `23392`，5173 前端 PID 为 `7900`；首页 HTTP 200。
- 已关闭 Vite 5207、5208。
- 实际复查发现 8127 仍有探测后端，并未如原报告所述退出；确认进程用途后已关闭。
- 最终复核 8123–8127、5199–5202、5207、5208 均无监听。正常开发端口 8000、5173 保留运行。
- 浏览器验证新建的临时账号已按精确账号 ID、邮箱、称呼三重核对后清理：删除其 1 条认证会话、1 条登录身份、1 条账号记录，没有删除其他用户；本次专用浏览器会话已关闭。

证据：[final-runtime-check.json](../../../verify/account-closure-recheck-2026-11-07/final-runtime-check.json)、[review-account-cleanup.json](../../../verify/account-closure-recheck-2026-11-07/review-account-cleanup.json)。

## 收尾状态

R01 和 R02 已修复并完成上述复验。本轮没有修改重复首页入口，以及 A02、A07–A17 的暂缓功能。真实作品跨账号、真机和跨浏览器、生产 HTTPS、安全 Cookie、备份恢复等未经验证项目继续如实保留。
