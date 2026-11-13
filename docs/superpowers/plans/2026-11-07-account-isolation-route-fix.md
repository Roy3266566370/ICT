# A06 草稿隔离与 A01 启动检查修复计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 关闭独立复查报告中的 R01/A06 与 R02/A01，并更新原报告。

**Architecture:** 准备页区域草稿复用现有 `draftScope.ts` 的键和清理规则，显式传入账号 scope，存储内容核对 scope 与来源签名；hook 的状态归属包含账号与材料，切换时不展示或复用上一归属的值。启动检查读取失败、非 JSON、缺少或错误类型的 paths 时抛错，正常但缺路由的文档仍走缺路由提示。

**Tech Stack:** React 18、TypeScript、Node test runner、Vite/esbuild、PowerShell、pytest。

**Spec:** [独立复查报告](2026-11-07-account-closure-recheck.md)，以及本轮用户要求。

## Global Constraints

- 只修复 A06、A01；A02、A07–A17 和重复首页入口不修改。
- 不迁移或恢复无 scope 的旧区域草稿，不修改数据库结构或资源归属。
- 保留同账号、同材料、同来源签名的有效草稿；保留隐私模式下存储不可用的容错。
- 当前目录不是 Git 仓库，在原目录修改并保存涉及源文件的修复前快照，不创建分支或提交。

## Review Focus

- A → B → guest 的首次渲染不得携带 A 的内存草稿。
- A 的旧事件回调不得在退出清理后重写 A 的存储，也不得写入 B 的键。
- 来源签名变化时不得套用过期草稿；相同签名时保留有效编辑。
- 旧无 scope 键与放错键的其他 scope 内容均不可恢复。
- HTML 200、缺少 paths、paths 类型错误、缺路由和正常文档必须得到不同且正确的检查结果。

## Task 1：A06 活动准备页草稿隔离

Files: 修改 `frontend/src/components/regions/regionDrafts.ts`、`useRegionDrafts.ts`；新增同目录 `regionDrafts.test.ts`；浏览器回归脚本保存在 `verify/account-fixes-2026-11-07/`。

Interfaces: `draftStorageKey(materialId, regionId, scope)`、`saveDraft(materialId, regionId, draft, scope)`、`loadDraft(materialId, regionId, expectedSignature, scope)`、`clearDraft(materialId, regionId, scope)`；scope 为现有 `DraftScope`，均显式必填。

- [x] 新增真实模块回归：A/B/guest 隔离，scope 清理，旧键不恢复，scope/签名校验，存储不可用。
- [x] 运行并记录修复前的失败；浏览器挂载真实 hook，观察账号切换时旧值残留。
- [x] 迁移活动读写入口；hook 从唯一账号状态源订阅 scope，加入归属和过期事件守卫。
- [x] 重跑模块和浏览器回归，确认同账号重新挂载恢复、切换首帧隔离、旧回调不落盘。

## Task 2：A01 无法验证时必须失败

Files: 修改 `start-dev.ps1`；新增 `backend/tests/test_dev_route_probe.py`。

Interfaces: 保留 `Get-OpenApiPaths(BaseUrl)` 和 `Assert-RequiredRoutes(BaseUrl)`；前者读取或结构校验失败时抛出错误，后者无法验证时不得正常返回。

- [x] 新增临时 HTTP 服务测试，通过 PowerShell AST 执行当前源文件的检查函数。
- [x] 记录非 JSON 和缺少 paths 在修复前被放行的失败断言。
- [x] 实现失败时抛错，保留有效空 paths/缺路由的专门错误。
- [x] 重跑专项测试、完整后端和前端测试、类型检查、构建，并运行开发启动脚本正常复用路径。
- [x] 更新原复查报告，写明证据、适用范围与保留的未验证项，检查新增进程和测试数据清理。

## 执行记录

- A06：修复前模块 8 失败、1 通过；修复后 9/9。真实 hook 浏览器 StrictMode 回归 11/11。
- A01：修复前 7 失败、2 通过；首次修复后 9/9。独立复核发现顶层数组自动展开，增加数组根/属性大小写/路径大小写三例，先 3 失败、9 通过，再 12/12。
- 最终完整检查：后端 436 通过、8 跳过；前端 181 通过；类型检查、构建、正常开发启动均通过。
- 最终独立复核未发现实际缺陷，原复查报告已更新。原目录没有 Git 元数据，因此不创建工作树或提交；修复前三个源文件已留存于 `verify/account-fixes-2026-11-07/before/`。
