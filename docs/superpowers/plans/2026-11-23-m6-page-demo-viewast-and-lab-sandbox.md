# M6 实施方案：L3 整页演示看图生成、ViewAST 能力升级与实验室长尾沙箱视图

> 分阶段实施，每个任务独立验收。工期按一人 10–12 个工作日估算，第 6 个工作日做里程碑评审。  
> 前置依赖：M0–M5（提交 `2552cc3`、`6dd049b`、`931424a`、`a86cb82`）已完成并通过全量回归，包括活页矢量化 `FigureScene`、关系引擎与自然语言生成关系、以及实验室多态 Walkthrough 架构。

## 现状核查与 M6 核心决策

对照当前代码库，M6 的三大目标均可直接建立在现有稳定底座之上，**不另起炉灶、不扩大安全攻击面**：

1. **`ViewAST` 契约与渲染器已有清晰扩展点**：
   - 后端校验：[contracts.py](../../../backend/app/ppt_ai/contracts.py) 与 `contracts/ppt-ai/view.schema.json` 已支持 `group / text / point / line / polyline / rect / circle / axes / curve / heatmap / scene3d / mermaid / chart` 等 13 种节点，并已有 `interactions` 顶层字段；
   - 前端渲染：[ViewAstRenderer.tsx](../../../frontend/src/ppt-ai/runtime/ViewAstRenderer.tsx)、[host.ts](../../../frontend/src/ppt-ai/sandbox/host.ts) 与 [protocol.ts](../../../frontend/src/ppt-ai/sandbox/protocol.ts) 已跑通 `opaque-origin iframe + Worker` 安全执行与回传；
   - **M6 升级重点**：向 `ViewAST` 增量新增 **`arrow`（带标签/起终点的箭头原语）**、**`polygon`（多边形/填充区域）**、**`formula`（KaTeX 数学公式节点）** 三类高价值数学图形节点，并打通 **`drag-handle` 直接画布拖动手柄**（将画布拖动坐标映射回参数 `paramId` / `[xParam, yParam]`，改变参数后触发 Worker 重算）。
2. **活页 L3 整页演示（[page_lab.py](../../../backend/app/ppt_ai/page_lab.py)）目前仅读文字，尚未融合 M3/M4 成果**：
   - 当前 `collect_page_context()` 仅拼装文本与一句粗略的“含 N 条矢量箭头”，看不到本页已矢量化的 `FigureScene` 对象坐标/角色/关系，也未结合页面截图；
   - **M6 升级重点**：让 `page_lab.py` 接入 `FigureScene` 结构化摘要、`relations` 摘要以及（当配置视觉模型且页面含图示时）压缩后的单页关键图多模态输入，使生成的整页交互演示忠实还原原页图示结构并默认善用新增的 `arrow / polygon / formula / drag-handle`。
3. **实验室长尾题型 `program` 沙箱视图**：
   - M5 已将高频微积分题型（曲面积分、旋转体体积、二重积分、极限/导数逼近）收口到多态 Walkthrough 专用原语；
   - 对于未命中专用原语但适合动态演示的长尾题型（如参数方程轨迹、傅里叶级数叠加、微分方程相图/方向场、特征向量与线性变换等），**复用 PPT AI 同一套 `ViewAST` 校验 + Node 试运行 + 前端 `opaque-origin sandbox iframe + Worker` 底座**，并在后端强制要求提供至少 2 个 SymPy 可独立核验的数值/符号检查点（`verification_probes`），确保“长尾可泛化、数学不胡说、安全不破防”。

---

## 任务 1 · ViewAST 契约与渲染器升级：`arrow / polygon / formula` 与 `drag-handle`（第 1–3 天）

- [x] **升级契约 Schema 与后端校验**：
  - 更新 `contracts/ppt-ai/view.schema.json` 与 [contracts.py](../../../backend/app/ppt_ai/contracts.py)：
    - `_VALID_NODE_TYPES` 新增 `arrow`、`polygon`、`formula`；
    - `arrow` 节点：`{ id, type: 'arrow', x1, y1, x2, y2, label?, style: { stroke, strokeWidth, dash?, opacity? } }`；
    - `polygon` 节点：`{ id, type: 'polygon', points: [[x,y], ...] (3~64 点), style: { fill, stroke, strokeWidth, opacity? } }`；
    - `formula` 节点：`{ id, type: 'formula', x, y, tex (1~240 字符，禁止 HTML/脚本), fontSize?, color?, align? }`；
    - `interactions` 数组支持 `drag-handle` 声明：`{ type: 'drag-handle', id, targetNodeId?, x, y, xParam?, yParam?, bounds: { xMin, xMax, yMin, yMax }, valueRange: { x?: [min, max], y?: [min, max] }, label? }`，后端校验所有坐标与范围均为有限实数且 `xParam / yParam` 属于合法参数名。
- [x] **升级前端渲染器与交互回传**：
  - 更新 [frontend/src/ppt-ai/types.ts](../../../frontend/src/ppt-ai/types.ts) 与 [ViewAstRenderer.tsx](../../../frontend/src/ppt-ai/runtime/ViewAstRenderer.tsx)：
    - 渲染 `arrow`（SVG 箭头 marker + 中点/终点可选标签）、`polygon`（闭合多边形填充与描边）、`formula`（使用 KaTeX 安全渲染 `throwOnError: false`，禁用 `trust` 防止注入）；
    - 实现 `drag-handle` 画布叠加手柄：拖动时按 `bounds -> valueRange` 线性映射回参数值，通过 `onParamChange(patch)` 节流驱动 [PageLabPlayer.tsx](../../../frontend/src/components/ppt-ai/PageLabPlayer.tsx) 重新向沙箱 Worker 求值，实现 60fps 级别“直接拖图改参”；同时支持键盘方向键微调手柄。
- [x] **离线运行时同步与专项测试**：
  - 新增后端测试 `backend/tests/test_m6_view_ast.py`（合法节点与手柄通过、非法 LaTeX/越界点数/非有限坐标/禁止字段 100% 拦截）；
  - 新增前端单元测试 `frontend/src/ppt-ai/runtime/viewAstM6.test.ts`（`drag-handle` 坐标到参数映射与越界钳制）；
  - 重编 `npm run build:offline`，确保离线导出的 HTML 中的 `SlideDemoNode` 同样支持新节点与拖动手柄。

**通过条件**：新节点与 `drag-handle` 在契约校验、前端渲染、单元测试及离线构建中全部通过，既有 `ViewAST` 用例零回归。

---

## 任务 2 · 活页 L3 整页演示升级：`page_lab.py` 融合 `FigureScene`、关系与视觉看图（第 4–6 天）

- [x] **升级 `collect_page_context()`（[page_lab.py](../../../backend/app/ppt_ai/page_lab.py)）**：
  - 从 `document.json` 提取当前页的 `figure_scenes` 摘要（对象列表、类型、坐标/端点、颜色、角色标签）与已建立的 `relations` 摘要（如 `basis_decompose`、`expr`、`linear_combo`），清洗所有 base64 字段；
  - 当页面包含图示节点（或用户开启“看图生成演示”）且视觉模型已配置时，将当前页缩略图/原图按最大边 `1024px` 压缩为安全数据 URI 随多模态消息发送给模型；未配置视觉模型时自动平滑回退到“文字 + FigureScene 结构化摘要”纯文本模式，不报错中断。
- [x] **升级提示词与 Node 试运行校验（[page_lab.py](../../../backend/app/ppt_ai/page_lab.py)）**：
  - 更新 `OUTPUT_CONTRACT` 与 `PAGE_LAB_VERSION`（升至 `ppt-ai.page-lab.3`），引导模型在几何/向量/微积分页面优先使用 `arrow`、`polygon`、`formula` 与 `drag-handle`（例如把一个关键参数直接绑定到画布手柄，而不仅仅是滑块）；
  - 扩展 `_NODE_RUNNER` 试运行检查：验证 `interactions` 中的 `drag-handle` 引用的 `xParam / yParam` 必须存在于 `params` 中，且模拟拖动边界值时程序无 NaN/Infinity 或越界异常。
- [x] **前端演示框接线与测试**：
  - 确认 [SlideDemoNode.tsx](../../../frontend/src/components/editor/SlideDemoNode.tsx) 与 [PageLabPlayer.tsx](../../../frontend/src/components/ppt-ai/PageLabPlayer.tsx) 在编辑态、演示态、分享页与离线导出中均能流畅拖动 `drag-handle` 并同步更新滑块数值；
  - 新增后端测试 `backend/tests/test_m6_page_lab_vision.py`（含 `FigureScene` 上下文注入、多模态与纯文本降级、含 `arrow/polygon/formula/drag-handle` 程序的 Node 试运行与错误修复闭环）。

**第 6 天里程碑评审**：活页 L3 整页演示完成看图 + `FigureScene` 融合升级，可在画布内直接拖动手柄操控演示并导出离线 HTML。

---

## 任务 3 · 实验室长尾 `program` 沙箱视图与 SymPy 探针验算（第 7–10 天）

- [x] **新建后端 `backend/app/labs/walkthrough/program_sandbox.py`**：
  - 定义 `ProgramWalkthroughSpec` 与 `ProgramProposal(StructuredOutput)`：`pattern: 'program_sandbox'`、`title`、`why`、`alternatives`、`params`（1~4 个可调参数）、`steps`（3~4 步教学引导，每步可指定推荐参数预设 `preset` 与聚焦高亮）、`program`（受限 `function render(input) -> ViewAST`）、以及 **`verification_probes`**（至少 2 个可由 SymPy 独立计算的数值/符号检查点，如“当 $t=1$ 时切线斜率应为 $2$”或“矩阵特征值为 $3, 1$”）。
  - 复用 `generated_views.validate_program_static`、`page_lab._run_node_check`（Node 隔离子进程试运行）与 `contracts.validate_view_ast` 三重安全闸门；
  - 用 SymPy 对 `verification_probes` 做独立验算，任一探针或程序试运行不通过即自动回传精确错误修复 1 次；仍不通过则返回降级提示并保留旧结果页。
- [x] **接入多态路由（[pattern_router.py](../../../backend/app/labs/walkthrough/pattern_router.py) & [service.py](../../../backend/app/labs/walkthrough/service.py)）**：
  - 在 `detect_mode(problem)` 中保持 `surface_slice` / `volume_slice` / `double_slice` / `limit_approach` 高优先级不变；
  - 对未命中固定原语但属于支持学科（高等数学/线性代数/大学物理）且具备明确动态机制关键词的题目（如参数方程轨迹、傅里叶级数、常微分方程相图/方向场、特征值/矩阵变换、简谐振动/阻尼振动），灰度路由到 `'program_sandbox'`。
- [x] **前端沙箱播放器集成**：
  - 扩展 [frontend/src/labs/walkthrough.ts](../../../frontend/src/labs/walkthrough.ts) 联合类型，新增 `ProgramSandboxWalkthrough`；
  - 新建独立组件 `frontend/src/components/labs/walkthrough/ProgramSandboxPlayer.tsx`：复用 `PageLabPlayer` / `GeneratedViewFrame` 的 `opaque-origin sandbox iframe + Worker` 安全执行引擎渲染 `program`（含新增的 `arrow / polygon / formula / drag-handle`），配合步骤切换自动应用步骤参数预设、展示 SymPy 探针验算徽章与预测检查点；
  - 在 [WalkthroughPlayer.tsx](../../../frontend/src/components/labs/walkthrough/WalkthroughPlayer.tsx) 顶层按 `walkthrough.pattern === 'program_sandbox'` 分发，绝不触碰 `LabWorkbenchPage.tsx` 或 `LabCanvas.tsx`。
- [x] **专项测试**：
  - 新增 `backend/tests/test_m6_walkthrough_program.py`，覆盖至少 3 类长尾题型（参数方程摆线/李萨如轨迹、线性代数 2×2 特征向量变换、二阶阻尼振动相图），验证静态安全黑名单拦截（`eval`/`window`/`fetch`）、Node 试运行 NaN 拦截、SymPy 探针篡改拦截与多态路由兜底。

---

## 任务 4 · M6 全量端到端验收、离线回归与收官报告（第 10–12 天）

- [x] **新增 Playwright E2E 验收（`frontend/e2e/m6-viewast-and-sandbox.spec.ts`）**：
  - 验证活页 `SlideDemoNode` 渲染包含 `arrow + polygon + formula + drag-handle` 的整页演示，拖动 `drag-handle` 手柄实时联动滑块与画布图形；
  - 验证导出离线单文件 HTML 后在严格断网（`file://`）上下文中，`drag-handle` 与 `formula` 渲染均正常可用；
  - 验证实验室 `ProgramSandboxPlayer` 在安全沙箱 iframe 中渲染长尾题型过程，步骤切换、滑块/手柄交互与 SymPy 验算徽章均正常显示。
- [x] **全量定向回归与验收报告（`verify/m6-2026-11-23/report.md`）**：
  - 后端 M0–M6 全部 `pytest` 套件全绿；
  - 前端 `npm run typecheck`、`walkthrough.test.ts`、`viewAstM6.test.ts`、`npm run test:core`、`npm run build`（含 `npm run build:offline`）全绿；
  - 产出 [verify/m6-2026-11-23/report.md](../../../verify/m6-2026-11-23/report.md) 总结整个 v3 方案（M0–M6）的闭环交付指标与剩余优化建议。

---

## 验收口径与红线约束

| 验收项 | 通过标准 |
| --- | --- |
| ViewAST 升级 | `arrow / polygon / formula / drag-handle` 通过前后端契约校验、沙箱渲染与离线导出回归；禁止 HTML/脚本注入 |
| 活页 L3 整页演示 | `page_lab.py` 成功注入 `FigureScene` 与 `relations`（及可选视觉图）；无视觉模型时平滑降级不报错 |
| 实验室长尾沙箱视图 | 至少 3 类长尾题型跑通“生成 → 静态黑名单 → Node 试运行 → SymPy 探针验算 → 沙箱 iframe 交互”闭环 |
| 安全与代码纪律 | 沙箱严格维持 `opaque-origin iframe + Worker + 白名单 AST`；所有新代码落在独立子模块，不向旧大文件追加逻辑 |
