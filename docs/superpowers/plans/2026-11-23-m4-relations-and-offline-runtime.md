# M4 万象活页关系引擎、动态化面板与离线同步实施计划

> 分阶段实施，每个任务独立验收。工期按一人 10 个工作日估算，第 5 个工作日做里程碑评审。  
> 前置依赖：M3 已完成（提交 `6dd049b`），当前已具备 `FigureScene v1`、按需位图矢量化、PPTX 原生仿射提取、独立清底 PNG 资产与双底图编辑。

## 现状核查与 M4 核心决策

对照当前代码（[types.ts](../../../frontend/src/document/types.ts)、[ScenePageView.tsx](../../../frontend/src/components/editor/ScenePageView.tsx)、[store.py](../../../backend/app/documents/store.py)、[presentation.py](../../../backend/app/documents/presentation.py)、[offline.py](../../../backend/app/offline.py)），M4 落地前有四项代码事实决定实现路径：

1. **运行时的统一入口已经具备**：编辑态（`FreeDeckEditor`）、放映态/公开分享页（`DeckPlayer`）与离线单文件 HTML（[offline/main.tsx](../../../frontend/src/offline/main.tsx)）全部共用 `ScenePageView` 渲染 `SceneDocument`。因此只要关系引擎接入 `ScenePageView`，四端自动一致。
2. **硬编码特例亟待抽离**：[BasisComposition.tsx](../../../frontend/src/components/editor/BasisComposition.tsx) 与 `ScenePageView.tsx`（第 118–126、199–217 行）把 `firstId / secondId / resultId`、锁定逻辑 `fixed()`、`onPreview` 草稿状态和 `'斜基：坐标'` 文案全部写死在单组换基上，无法支撑多组对象或自定义表达式。
3. **快照与持久化缺口**：`ScenePage` 尚无页面级 `relations` 字段，[store.py](../../../backend/app/documents/store.py) 的 `validate_patch` 仅接受节点级改动且 `viewer_parameters` 写死为 `['geometry', 'style', 'flow']`；[presentation.py](../../../backend/app/documents/presentation.py) 的冻结快照虽已内联独立清底 PNG，但未透传 `relations` 与扩展的细粒度参数。
4. **安全表达式解析器已有现成轮子**：[frontend/src/ispec/expr.ts](../../../frontend/src/ispec/expr.ts) 已提供无 `eval` 的词法/AST 递归下降解析、白名单数学函数、1-based 列号报错与 `identifiers` 依赖列表，可直接复用为关系表达式求值底座；后端可配套 [backend/app/labs/expr.py](../../../backend/app/labs/expr.py)（或独立轻量子集校验器）做入库前白名单校验。

**M4 核心架构决策**：
- **真理源落在 `ScenePage.relations`**（引用真实 `SceneNode.id`），M3 的 `FigureScene` 应用到页面时自动物化为页面关系；旧文档的 `node.basis: BasisOverlay` 由求值器自动兼容为一条等价的 `basis_decompose` 宏，不破坏老快照。
- **不复用 `canvas/engine.ts`**（学科积木数据流图），新建纯函数模块 `frontend/src/document/relations.ts`，仅借鉴其 `cache + visiting` 防环拓扑求值思路。
- **零强依赖视觉模型**：鉴于 M0/M3 实测远端 Qwen 服务存在偶发传输失败，换基等几何关系的自动发现优先基于原生/像素几何条件（共点 + 线性组合匹配），视觉标签仅用于补充文字绑定。

---

## 任务 1 · 关系数据契约与纯函数求值引擎（第 1–3 天）

- [x] **定义 `SceneRelation` 契约**（前端 `frontend/src/document/types.ts`、后端 `backend/app/documents/relations.py`），挂在 `ScenePage.relations?: SceneRelation[]`，每条关系带唯一 `id`、`enabled`、`provenance`（`'auto' | 'user' | 'legacy'`），支持两类节点：
  - **内置几何宏（`macro`）**：
    - `basis_decompose`：迁移 [basisComposition.ts](../../../frontend/src/document/basisComposition.ts)，参数为 `firstId`（$b_1$）、`secondId`（$b_2$）、`resultId`（$v$）、可选 `guideIds`（虚线辅助线段节点列表）、可选 `labelId`（目标文字节点，缺省回退悬浮标签）与 `labelTemplate`（如 `'斜基：坐标 ({a}, {b})'`）、可选 `degenerateText`；支持 `step` 播放进度与退化共线兜底。
    - `linear_combo`：以 `firstId`、`secondId` 与两个标量系数（常量或表达式）驱动目标向量 `targetId` 的终点。
    - `guide_bind`：将虚线/辅助线段起终点吸附到其他向量的 `start`/`end` 或派生角点。
  - **白名单表达式绑定（`expr`）**：
    - 复用 [frontend/src/ispec/expr.ts](../../../frontend/src/ispec/expr.ts) 的 `parseExpression` / `evaluateAst`（严禁 `eval` / `Function`）。
    - 支持读取任意源节点的只读几何属性（如 `n.x1 / n.y1 / n.x2 / n.y2 / n.dx / n.dy / n.length / n.angle`），写回目标节点的数值属性（`length / angle / x / y / opacity`）或格式化文本（`text`）。
- [x] **新建 `frontend/src/document/relations.ts`**：
  - 实现 `evaluatePageRelations(nodes, relations, liveDrafts)` 纯函数：自动将历史 `node.basis` 归一化为只读虚拟 `basis_decompose` 关系；提取依赖边进行 `cache + visiting` 拓扑求值。
  - **严格容错**：检测自环/互环、缺失节点、非法表达式、除以零或 `NaN`/`Infinity`、基向量退化共线；单条关系异常时只记录 `diagnostics[relationId]` 并保留目标节点原值，绝不中断同页其他关系。
  - 保证隔离性：拖动右图 $b_2$ 时，仅更新依赖右图 $b_2$ 的关系目标（右图虚线与坐标文字），左图标准基与坐标 `(2, 1)` 完全不重算、不漂移。
- [x] **编写单元测试 `frontend/src/document/relations.test.ts`**：覆盖换基坐标更新、退化共线、左右双子图隔离、链式依赖、成环检测、非法表达式拒绝、以及历史 `node.basis` 兼容。

**通过条件**：纯函数引擎单页求值耗时 `< 1ms`（保证 60fps 拖拽），`node --experimental-strip-types --test src/document/relations.test.ts` 全部通过。

---

## 任务 2 · 后端持久化、细粒度 `viewer_parameters` 与自动关系物化（第 3–5 天）

- [x] **扩展细粒度 `viewer_parameters`**（前端 `types.ts` + 后端 [store.py](../../../backend/app/documents/store.py)）：
  - 保持历史值 `'geometry' | 'style' | 'flow'` 100% 向后兼容；
  - 新增细粒度矢量可调项：`'start'`（拖起点）、`'end'`（拖终点）、`'length'`、`'angle'`、`'color'`、`'line_style'`、`'stroke_width'`；当存在细粒度键时，按细粒度精确控制手柄和控件可见性（例如换基图中 $b_2$ 仅开启 `['end']` 即可锁住起点、仅允许拖箭头尖端，替代 `ScenePageView.tsx` 里写死的 `endOnly` 与 `fixed()`）。
- [x] **支持页面级 `relations` 的校验、PATCH 与撤销**：
  - 在 `backend/app/documents/relations.py` 实现与前端同构的白名单校验（包括表达式词法/函数白名单检查，防止恶意或畸形关系写入 `document.json`）；
  - 在 [store.py](../../../backend/app/documents/store.py) 扩展 `apply_operations` 支持 `page_relations` 变更（或允许在页面级 PATCH 中更新 `relations`），严格遵守 `expected_revision` 与 `operation_id` 幂等落盘，并在 `frontend/src/document/model.ts` 纳入 `DocumentController` 原子撤销/重做历史。
- [x] **打通 M3 → M4 的关系自动物化**：
  - 在 [figure_service.py](../../../backend/app/documents/figure_service.py) 中，当 M3 识别出的 `FigureScene` 包含共点三向量线性组合（或左右双子图中的斜基子图）时，结合同子图内的虚线（`dashed`）与坐标文字（`text`）节点，在预览与应用阶段自动生成 `basis_decompose` 关系并给出合理的默认 `viewer_parameters`（例如 $b_2$ 默认可拖 `['end']`，$b_1$、$v$ 与左图向量默认只读）。
- [x] **打通分享快照与工程归档**：
  - 更新 [presentation.py](../../../backend/app/documents/presentation.py) 的冻结构建逻辑，完整透传 `page.relations`、扩展后的 `viewer_parameters` 与节点关联字段，并保证独立清底 PNG 在公开分享和离线包中均正常内联；
  - 补充 `backend/tests/test_m4_relations.py`（校验合法/非法关系、循环拦截、PATCH 并发与版本冲突、分享快照透传、工程备份导入导出往返）。

**第 5 天里程碑评审**：前后端契约与单测全部跑通，换基图经 M3 矢量化应用后能自动生成可校验的 `basis_decompose` 关系并持久化落盘。

---

## 任务 3 · 编辑器实时联动与「动态化」面板（第 6–8 天）

- [x] **改造 `ScenePageView.tsx` 为通用实时关系驱动**：
  - 将写死的 `basisDraft` 升级为通用的 `liveDrafts: Record<string, NodePatch>`；任意参与关系的 `VectorLine` 在拖动过程中通过 `onPreview` 写入 `liveDrafts`，每帧调用 `evaluatePageRelations()` 实时驱动受影响的虚线（`VectorLine`）、派生向量与坐标文字（`NodeView`）同步刷新；
  - 松手 `onCommit` 时仅提交用户实际拖动的源节点（派生节点保持实时计算态，撤销一次即可恢复拖动前状态）；
  - 保留分步播放控件（第 1 步沿 $b_1$、第 2 步沿 $b_2$）并由 `basis_decompose` 宏统一驱动，移除 `ScenePageView.tsx` 中硬编码的 `fixed()` 判断，改由 `viewer_editable` 与细粒度 `viewer_parameters` 统一裁决。
- [x] **改造 `VectorLine.tsx` 与 `DynamicStyleControls.tsx`**：
  - [VectorLine.tsx](../../../frontend/src/components/editor/VectorLine.tsx) 依据细粒度 `viewer_parameters` 精确决定显示“起点手柄 / 终点手柄 / 双手柄 / 只读”，以及 `VectorControls` 中各输入框（线长、角度、线宽、线型、颜色）的显隐；
  - 在 [NodeProperties.tsx](../../../frontend/src/components/editor/NodeProperties.tsx) 中升级「动态化」面板：
    - **观众可调属性区**：按对象勾选 `允许观众操作` 及细粒度参数（起点 / 终点 / 线长 / 角度 / 颜色 / 线型 / 线宽 / 流动）；
    - **页面关系列表区**：列出当前页全部 `relations`（显示来源标签、启用开关、目标与依赖摘要、错误提示），支持**可视化新增/编辑/删除** `basis_decompose`、`linear_combo`、`guide_bind` 和 `expr` 关系，表单提交前实时运行白名单与防环检查并显示列号错误提示；
    - 关系变更作为独立一次操作进入 `DocumentController` 撤销栈。
- [x] **补充前端组件与持久化测试**：扩展 `frontend/scripts/test-document.mjs`，验证关系编辑的撤销/重做、刷新恢复与 409 版本冲突保护。

**通过条件**：在编辑器与放映态中拖动换基图右图 $b_2$，右图坐标文字从 `(1, 1)` 实时更新，虚线平行四边形跟随，左图 `(2, 1)` 纹丝不动；在「动态化」面板里关闭某向量的 `viewer_editable` 后，放映态立即变为只读。

---

## 任务 4 · 离线运行时重编与端到端验收（第 8–10 天）

- [x] **重编并核验离线单文件运行时**：
  - 执行 `cd frontend && npm run build:offline`，更新 [backend/app/static/offline/runtime.js](../../../backend/app/static/offline/runtime.js) 与 `runtime.css`；
  - 确认 [backend/app/offline.py](../../../backend/app/offline.py) 生成的单文件 HTML 中，冻结文档完整携带 `page.relations`、细粒度 `viewer_parameters` 与内联的清底 PNG，且无需任何网络请求即可运行 `relations.ts` 求值。
- [x] **新增端到端 Playwright 浏览器验收（`verify/m4-2026-11-23/`）**：
  1. **换基图在线闭环**：上传换基图 → M3 矢量化并应用（自动生成 `basis_decompose` 关系）→ 切放映态拖动右图 $b_2$ → 断言右图坐标文字随拖动实时变化、虚线平行四边形角点同步更新、左图 `(2, 1)` 坐标与箭头位置完全不变 → 点「一键重置」恢复 `(1, 1)`；
  2. **关系面板与错误处理**：在编辑器「动态化」面板手工新建一条 `expr` 关系（如文本显示向量长度）验证实时联动；输入含非法语法或成环的关系时，界面拒绝保存并显示明确原因；验证撤销/重做与刷新恢复；
  3. **公开分享页权限隔离**：发布分享链接并在新无痕会话打开 → 验证标记为 `viewer_parameters: ['end']` 的 $b_2$ 仅能拖终点并触发联动，未开放的 $b_1$、$v$ 及左图节点只读不可拖；
  4. **离线 HTML 单文件实机验收**：调用离线导出接口保存 `.html` 文件，在浏览器断网/`file://` 模式下直接打开 → 重复上述 $b_2$ 拖动联动、左图不变、只读隔离与「一键重置」断言，保存全套对照截图与 `report.md`。
- [x] **全量定向回归**：运行后端 `test_m4_relations.py`、`test_offline_deck.py`、`test_project_package.py`、`test_m3_*.py`，前端 `npm run typecheck`、`npm test`、`npm run build`（含 `build:offline`）全部通过。

---

## 验收口径与边界

| 验收项 | 通过标准 | 对应 v3 验收 |
|---|---|---|
| 拖动 $b_2$ 实时联动 | 右图坐标文字与虚线平行四边形 60fps 跟随，退化共线有友好提示；左图 `(2, 1)` 不变 | v3 §4.5 第 3 条 |
| 「动态化」与只读隔离 | 公开分享页与离线 HTML 中，仅勾选 `viewer_parameters` 的对象及具体手柄可调，其余严格只读 | v3 §4.5 第 5 条 |
| 离线导出一致性 | `runtime.js` 已重编，离线 `.html` 断网打开后清底图无裂图、拖动与关系联动与在线完全一致 | v3 §4.3 / §6 |
| 安全与兼容性 | 表达式全走 `ispec/expr.ts` 白名单、无 `eval`；历史 `node.basis` 与旧 `'geometry'/'style'/'flow'` 文档零回归 | v3 §6 |

**边界说明**：本阶段交付声明式关系引擎、`basis_decompose` 等内置宏、可视化「动态化」面板与离线运行时同步；**自然语言生成关系**（选中对象说一句话让模型写关系 JSON）归入 **M5**，**`page_lab.py` 看图生成整页演示与 `ViewAST` 手柄**归入 **M6**。 [v3 原方案](../../../万象改进实施方案-v3.md)
