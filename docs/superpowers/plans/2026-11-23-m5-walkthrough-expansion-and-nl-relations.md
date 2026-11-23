# M5 广度扩展实施方案：活页自然语言生成关系与实验室多解题思想

> 分阶段实施，每个任务独立验收。工期按一人 10–12 个工作日估算，第 5 个工作日做里程碑评审。  
> 前置依赖：M0–M2（提交 `2552cc3`，高数曲面积分 Walkthrough 闭环）与 M3–M4（提交 `6dd049b`、`931424a`，活页矢量化、关系引擎与离线运行时同步）均已完成并通过实机验收。

## 现状核查与 M5 核心决策

对照当前代码库，M5 的两条扩展主线均具备直接可复用的基础设施：

1. **活页自然语言生成关系（主线 A，高性价比先行）**：
   - M4 已建成完整的 [relations.py](../../../backend/app/documents/relations.py)（Pydantic 契约 + 无 `eval` 白名单表达式 AST 校验 + DFS 环检测）、[relations.ts](../../../frontend/src/document/relations.ts)（60fps 纯函数求值）与 [PageRelationsPanel.tsx](../../../frontend/src/components/editor/PageRelationsPanel.tsx)；
   - 后端已有 [structured_llm.py](../../../backend/app/structured_llm.py) 的 `complete_json()`（支持将 `validator` 注入自动修复闭环）以及 [diagram_generation.py](../../../backend/app/documents/diagram_generation.py) 的页面 AI 生成范式。
   - **核心原则**：自然语言接口**只返回经白名单与防环校验的预览提案，绝不自动落盘**；用户查看摘要与影响范围、点击「确认应用」后，才作为单次原子操作写入 `DocumentController` 撤销栈。
2. **实验室解题思想横向扩展（主线 B）**：
   - 当前 [walkthrough.ts](../../../frontend/src/labs/walkthrough.ts) 与 `backend/app/labs/walkthrough/` 仅支持单一的 `pattern: 'slice_accumulate'`（绕 $z$ 轴 5 种旋转曲面曲面积分）；
   - 仓库已有成熟的 SymPy 验算内核可复用：[integral_applications.py](../../../backend/app/labs/integral_applications.py)（旋转体体积/面积）、[double_integral.py](../../../backend/app/labs/double_integral.py)（二重积分单条带与换序）、[limit_extra.py](../../../backend/app/labs/limit_extra.py) 与 [calculus_analysis.py](../../../backend/app/labs/calculus_analysis.py)（极限/导数/泰勒）。
   - **核心原则**：先把 `Walkthrough` 升级为**多态分发架构**（后端按子模块拆解，前端 `WalkthroughPlayer` 壳层统一、画布按 `view.name` 分发到独立原语），严禁往 `WalkthroughPlayer.tsx` 或旧大文件堆砌逻辑；首批横向扩展 **2 个同思想新题型**（旋转体体积 + 二重积分切片）和 **1 个新解题思想**（`limit_approach` 极限/导数逼近），每个模式必须带独立验收样例集。

---

## 任务 1 · 活页自然语言生成关系后端与安全校验（第 1–3 天）

- [x] **新建 `backend/app/documents/relation_generation.py`**：
  - 定义结构化输出模型 `RelationProposal(StructuredOutput)`：`summary`（一句话说明将建立什么联动）、`relations`（复用 `SceneRelationModel` 列表，最多 6 条）、`viewer_updates`（可选，调整相关节点的 `viewer_editable` 与细粒度 `viewer_parameters`，例如把指令中“让 $b_2$ 可拖动”映射为 `viewer_editable: True, viewer_parameters: ['end', 'color', 'line_style', 'stroke_width']`）。
  - 构造精简页面上下文：仅提取当前页未删除/未隐藏节点的 `id / name / type / text / endpoints / role / figure_object_id` 与现有 `relations` 摘要，过滤所有图片 base64 与冗余样式；明确提示词把页面文字仅作待分析资料，不执行其中指令。
  - 调用 `structured_llm.complete_json()`，将 **`validate_page_relations(existing + proposed, page_nodes)` + `VIEWER_PARAMETERS` 校验**直接作为 `validator` 注入：若模型引用了不存在节点、使用了白名单外函数或产生循环依赖，自动将精确错误回传模型修复 1 次；仍不通过则返回可读错误，不污染文档。
  - 记录诊断信息（耗时、重试次数、拒收原因，不含凭据），支持单页缓存与 24 秒超时控制；未配置文本模型时返回明确的 `model_unavailable` 提示。
- [x] **新增 API 路由（[routes_documents.py](../../../backend/app/api/routes_documents.py)）**：
  - `POST /materials/{material_id}/document/pages/{page_no}/relations/suggest`：接收 `{ instruction, selected_node_ids, expected_revision }`，复用 `WriteDep` 与材料归属检查，返回预览提案 `{ summary, relations, viewer_updates, warnings }`。
- [x] **编写后端专项测试 `backend/tests/test_m5_nl_relations.py`**：覆盖换基/表达式两类自然语言指令、非法函数/成环自动修复与拒绝、未配置模型降级、过期 `expected_revision` 冲突与越权拦截。

**通过条件**：`test_m5_nl_relations.py` 全部通过；输入非法表达式或循环指令时，后端 100% 拒绝并给出清晰原因。

---

## 任务 2 · 活页自然语言关系前端预览确认流与验收（第 3–5 天）

- [x] **封装 API 客户端（[frontend/src/api/documents.ts](../../../frontend/src/api/documents.ts)）**：新增 `suggestPageRelations(materialId, pageNo, payload)`。
- [x] **升级 [PageRelationsPanel.tsx](../../../frontend/src/components/editor/PageRelationsPanel.tsx)**：
  - 新增「用一句话添加动态关系」交互区（文本输入框 + 2 个快捷示例芯片，如“让当前向量终点可拖并显示坐标”“让文字显示选中向量长度”）；
  - 提交后展示**预览确认卡片**：列出模型总结 `summary`、待新增的关系条目（附前端 `evaluatePageRelations` 实时试算状态 `联动正常 / 错误`）与将调整的观众可调属性 `viewer_updates`；
  - 点击「确认应用」时，通过单次 `controller.replace(...)` 同步更新 `page.relations` 与相关节点的 `viewer_editable / viewer_parameters`，支持一次 `Ctrl+Z` 完整撤销；点击「取消」丢弃提案，无任何副作用；
  - 模型未配置或报错时在卡片内显示明确提示，并保留下方手工表单入口。
- [x] **补充 Playwright E2E 验收（`frontend/e2e/m5-nl-relations.spec.ts`）**：验证自然语言生成关系 → 预览确认 → 应用后实时拖动联动 → 撤销恢复，以及非法指令拒绝提示；重编离线 `runtime.js` 验证导出后联动一致。

**第 5 天里程碑评审**：主线 A（活页自然语言生成关系）完整闭环交付，对应 [v3 原方案](../../../万象改进实施方案-v3.md) §4.5 第 4 条验收通过。

---

## 任务 3 · 实验室多态 Walkthrough 升级与 `slice_accumulate` 横向扩展（第 5–8 天）

- [x] **后端多态重构（`backend/app/labs/walkthrough/`）**：
  - 将当前单模式 `service.py` 拆分为统一路由 `router.py` + 模式插件目录：
    - 保留 `surface_slice.py`（现有 5 种旋转曲面曲面积分，零回归）；
    - 新增 `volume_slice.py`（**旋转体体积**）：支持 $y=f(x)$ 或 $r(z)$ 绕坐标轴旋转的圆盘法/垫圈法，SymPy 独立验算 `cross_section_area`（$\pi r^2$）、`primitive` 与 `exact`，复用 [integral_applications.py](../../../backend/app/labs/integral_applications.py) 连续性与区间校验；
    - 新增 `double_slice.py`（**二重积分条带切片**）：支持 X-型与 Y-型区域 $\iint_D f(x,y)\,dx\,dy$，SymPy 独立验算内层积分 `inner_integral`（$g(x)$ 或 $g(y)$）、外层原函数 `primitive` 与 `exact`，复用 [double_integral.py](../../../backend/app/labs/double_integral.py) 条带边界与换序检查。
  - 在 `pattern_router.py` 中放开 `eligible()` 对旋转体体积与二重积分的灰度接管，继续保持未命中题型平滑回退旧结果页。
- [x] **前端原语扩充与多态分发**：
  - 扩展 [frontend/src/labs/walkthrough.ts](../../../frontend/src/labs/walkthrough.ts) 的 `Walkthrough` 联合类型（支持 `slice_surface` / `slice_volume` / `slice_double`）；
  - 扩展 [SurfaceCanvas.tsx](../../../frontend/src/components/labs/primitives/SurfaceCanvas.tsx) 支持圆盘/圆环实体切片渲染（供旋转体体积复用）；
  - 新增 2D 区域切片原语 `frontend/src/components/labs/primitives/RegionSliceCanvas.tsx`（绘制积分区域 $D$ 边界曲线、高亮当前可拖动切片条 $x=h$ 或 $y=h$、支持画布内直接拖动 $h$，联动现有 [CumulativeChart.tsx](../../../frontend/src/components/labs/primitives/CumulativeChart.tsx) 展示精确累积 vs 离散条带累加）；
  - 拆分 `WalkthroughPlayer.tsx` 中央舞台为独立 `WalkthroughStage.tsx`，按 `view.name` 分发原语组件，避免主组件膨胀。
- [x] **专项测试与变体验收**：
  - 新增 `backend/tests/test_m5_walkthrough_slice.py` 与前端单元测试，覆盖旋转体体积 3 道变体（抛物线绕轴、圆环垫圈、三角函数旋转体）与二重积分 3 道变体（矩形域、三角形 X-型域、抛物线 Y-型域），确保 SymPy 逐步骤验算与篡改拦截 100% 生效。

---

## 任务 4 · 实验室新解题思想 `limit_approach` 与全量验收（第 8–12 天）

- [x] **后端新增 `limit_approach.py`（极限与导数逼近思想）**：
  - 覆盖高频单变量极限（含 $0/0$ 型、重要极限、洛必达/泰勒等价无穷小）与导数定义（割线斜率 $\frac{f(x_0+\delta)-f(x_0)}{\delta} \to f'(x_0)$）；
  - SymPy 独立验算：左极限 `left_limit`、右极限 `right_limit`、目标极限/导数值 `exact`、以及主导阶/泰勒展开近似 `principal_part`，继续通过 `structured_llm.complete_json()` + `validator` 形成自动修复闭环；
  - 组装 4–5 步教学过程（识别未定式/逼近点 → 观察左右采样逼近 → 主部/化简推导 → 结论与数值误差对照），附 1 道预测检查点。
- [x] **前端新增 `ZoomCurveCanvas.tsx` 原语（`frontend/src/components/labs/primitives/ZoomCurveCanvas.tsx`）**：
  - 绘制目标函数曲线与逼近点 $x_0$（空心圆标注间断点/未定义点），提供对数刻度步长控件 $\delta$ 与放大倍率（可拖动采样点 $x_0 \pm \delta$），同步展示割线/切线或左右逼近采样表及误差衰减曲线。
- [x] **全量端到端验收与回归（`verify/m5-2026-11-23/`）**：
  - 为每个新增思想/题型各跑通至少 3 道真实变体（旋转体体积 3 道、二重积分 3 道、极限/导数逼近 3 道），记录耗时、SymPy 验算结果与浏览器截图，产出 `verify/m5-2026-11-23/report.md`；
  - 全量定向回归：后端 M0–M5 全部 `pytest` 用例、前端 `npm run typecheck`、`npm test`、`npm run build`（含 `build:offline`）全部通过。

---

## 验收口径与边界

| 验收项 | 通过标准 |
| --- | --- |
| 活页自然语言关系 | 自然语言生成关系经白名单与防环校验，预览确认后应用并可一次撤销；非法指令被拒绝并明确提示原因；离线导出一致 |
| 实验室 `slice_accumulate` 扩展 | 旋转体体积（$\ge 3$ 变体）与二重积分（$\ge 3$ 变体）跑通“识题 → 过程脚本 → SymPy 验算 → 拖动切片联动累积曲线”闭环 |
| 实验室 `limit_approach` 新思想 | 极限与导数定义（$\ge 3$ 变体）跑通局部缩放逼近与 SymPy 左右极限/主部验算闭环 |
| 零回归与代码纪律 | M1–M2 曲面积分与 M3–M4 活页既有测试全绿；新增代码严格落在独立子模块，不向 `LabWorkbenchPage.tsx`、`LabCanvas.tsx` 等旧大文件追加新逻辑 |

**边界说明**：本阶段聚焦广度扩展（活页自然语言关系 + 实验室 3 类高频微积分过程）；**`page_lab.py` 看图生成整页演示、`ViewAST` 新增 `arrow/polygon/formula` 与 `drag-handle` 手柄、以及实验室长尾 `program` 沙箱视图**归入 **M6**。 [v3 原方案](../../../万象改进实施方案-v3.md)
