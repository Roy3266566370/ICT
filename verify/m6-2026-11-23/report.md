# M6 收官验收报告（2026-11-23）

## 1. 验收范围与交付清单

本次验收覆盖 [M6 实施方案](../../docs/superpowers/plans/2026-11-23-m6-page-demo-viewast-and-lab-sandbox.md) 全部 4 项任务，标志着 [万象改进实施方案-v3.md](../../万象改进实施方案-v3.md)（M0–M6）全阶段闭环交付完成：

1. **ViewAST 契约与渲染器升级（任务 1）**
   - 契约与后端校验：[view.schema.json](../../contracts/ppt-ai/view.schema.json)、[contracts.py](../../backend/app/ppt_ai/contracts.py)
   - 前端白名单、映射与渲染：[protocol.ts](../../frontend/src/ppt-ai/sandbox/protocol.ts)、[viewAstDrag.ts](../../frontend/src/ppt-ai/runtime/viewAstDrag.ts)、[ViewAstRenderer.tsx](../../frontend/src/ppt-ai/runtime/ViewAstRenderer.tsx)、[PageLabPanel.tsx](../../frontend/src/components/ppt-ai/PageLabPanel.tsx)、[PageLabPlayer.tsx](../../frontend/src/components/ppt-ai/PageLabPlayer.tsx)
   - 交付能力：新增 `arrow`（带标签）、`polygon`（3~64 顶点）、`formula`（KaTeX `trust: false` 安全叠加层）三类数学原语，打通 `drag-handle` 画布直接拖动手柄（鼠标拖动与键盘方向键微调）实时驱动沙箱 Worker 重算，并同步至离线单文件 HTML 运行时。
2. **活页 L3 整页演示融合 `FigureScene` 与视觉看图（任务 2）**
   - 后端升级：[page_lab.py](../../backend/app/ppt_ai/page_lab.py)（升至 `ppt-ai.page-lab.3`，向后兼容旧缓存）
   - 交付能力：`collect_page_context()` 自动注入本页 M3 `FigureScene` 结构摘要与 M4/M5 `relations` 摘要（严格剥离 base64）；视觉模型可用时自动压缩页面原图（最大边 1024px）随 `image_urls` 多模态调用，未配置视觉模型时平滑降级到纯文本 + 结构化摘要模式；`dry_run()` 新增 `drag-handle` 参数绑定一致性校验。
3. **实验室长尾 `program_sandbox` 视图与 SymPy 探针验算（任务 3）**
   - 后端：[program_sandbox.py](../../backend/app/labs/walkthrough/program_sandbox.py)、[pattern_router.py](../../backend/app/labs/walkthrough/pattern_router.py)、[service.py](../../backend/app/labs/walkthrough/service.py)
   - 前端：[walkthrough.ts](../../frontend/src/labs/walkthrough.ts)、[ProgramSandboxPlayer.tsx](../../frontend/src/components/labs/walkthrough/ProgramSandboxPlayer.tsx)、[WalkthroughPlayer.tsx](../../frontend/src/components/labs/walkthrough/WalkthroughPlayer.tsx)
   - 交付能力：复用 `opaque-origin sandbox iframe + Worker + ViewAstRenderer` 安全底座，串联静态黑名单 + Node 隔离子进程试运行 + SymPy 探针独立验算（至少 2 个探针），覆盖参数方程轨迹、特征向量线性变换、阻尼振动相图等长尾题型。
4. **实机端到端与离线回归验收（任务 4）**
   - Playwright E2E：[m6-viewast-and-sandbox.spec.ts](../../frontend/e2e/m6-viewast-and-sandbox.spec.ts)
   - 实机截图证据：`verify/m6-2026-11-23/m6-01-online-drag-handle.png`、`verify/m6-2026-11-23/m6-02-offline-drag-handle.png`、`verify/m6-2026-11-23/m6-exported-offline.html`。

---

## 2. 自动化测试与构建结果

- **后端全量 M0–M6 定向回归**：
  - `test_m6_view_ast.py` + `test_m6_page_lab_vision.py` + `test_m6_walkthrough_program.py` + `test_m5_nl_relations.py` + `test_m5_walkthrough_slice.py` + `test_m5_walkthrough_limit.py` + `test_m4_relations.py` + 既有曲面积分 Walkthrough 套件 + 既有 `page_lab` 套件：**70 passed in 21.95s**
- **前端单元测试与类型检查**：
  - `src/labs/walkthrough.test.ts` + `src/ppt-ai/runtime/viewAstM6.test.ts` + `src/ppt-ai/sandbox/protocol.test.ts`：**全量 PASS**
  - `npm run typecheck`：**0 报错**
  - `npm run test:core`：**全部 PASS**
- **生产与离线构建**：
  - `npm run build` & `npm run build:offline`：**构建成功**（离线 `runtime.js` / `runtime.css` 已同步更新）
- **Playwright 实机端到端验收**：
  - `frontend/e2e/m6-viewast-and-sandbox.spec.ts`：**1 passed (26.1s)**（覆盖编辑态生成演示、`arrow/polygon/formula/drag-handle` 渲染、服务端真实 `dry_run` 保存、放映态画布直接拖动 `drag-handle` 实时联动公式、以及严格断网 `file://` 离线 HTML 中拖动手柄与公式联动）
