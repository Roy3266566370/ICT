# M4 万象活页关系引擎、动态化面板与离线同步验收报告

2026-11-23 · Windows · Chromium · 独立 SQLite 与断网 `file://` 离线环境

M4 交付页面级声明式关系引擎（`relations.ts`）、内置几何宏（`basis_decompose` / `linear_combo` / `guide_bind`）与白名单表达式绑定（`expr`）、细粒度观众权限（`viewer_parameters`）、「页面动态关系」编辑面板、以及公开分享快照与离线单文件 HTML（`runtime.js`）的四端同步。 [M4 实施计划](../../docs/superpowers/plans/2026-11-23-m4-relations-and-offline-runtime.md) · [M3 验收报告](../m3-2026-11-23/report.md)

## 核心实现与架构验证

1. **纯函数关系求值引擎（`frontend/src/document/relations.ts`）**
   - 复用 `ispec/expr.ts` 的无 `eval` 递归下降解析器与白名单数学函数；支持在表达式中直写 `b2.length`、`b2.dx`（等长点号预处理保持 1-based 报错列号精确不变）。
   - 采用 `cache + visiting` 防环拓扑求值，不受关系数组声明顺序影响；单条关系出错、退化共线或成环时仅记录 `diagnostics[relationId]`，不中断同页其余关系；单页百次平均求值耗时 `< 1ms`，保障 60fps 实时拖拽。
   - 自动将历史文档的 `node.basis` 归一化为虚拟 `basis_decompose` 关系，保持旧快照 100% 兼容。
2. **M3 → M4 自动关系物化与细粒度 `viewer_parameters`**
   - 后端 `figure_scene.py` 与 `figure_service.py` 在双子图对照（左标准正交基 + 右斜基）或斜基子图中自动识别共点三向量线性组合，绑定同子图虚线（`guideIds`）与坐标文字（`labelId`），保持左图标准基 `(2, 1)` 静态不干扰。
   - 扩展 `viewer_parameters` 支持 `['start', 'end', 'length', 'angle', 'color', 'line_style', 'stroke_width', 'flow']`（兼容旧 `'geometry' | 'style' | 'flow'`）。换基图物化时默认将右图 $b_2$ 设为 `viewer_editable: true, viewer_parameters: ['end', 'color', 'line_style', 'stroke_width']`（仅开放终点拖拽与样式调节，锁住起点），其余固定向量默认 `viewer_editable: false`。
3. **四端统一驱动与离线运行时同步**
   - `ScenePageView.tsx` 接入 `liveDrafts` 与 `evaluatePageRelations()`，编辑态、放映态、公开分享页与离线单文件 HTML 四端共用同一求值链路。
   - 重新构建 `backend/app/static/offline/runtime.js` 与 `runtime.css`，`presentation.py` 与 `project_package.py` 完整透传 `page.relations` 及细粒度 `viewer_parameters`。

## 浏览器端到端验收（`frontend/e2e/m4-relations-offline.spec.ts`）

在真实 Chromium 浏览器中顺序执行完整闭环（`LLM_PROVIDER=none`、`LIVING_FIGURE_VISION_PROVIDER=none`）：

| 验收阶段 | 实测验证内容 | 结果与证据 |
| --- | --- | --- |
| 编辑器关系面板与白名单拦截 | 上传 `basis-alternate.png` 并应用矢量化，自动生成 1 条 `联动正常` 的 `换基分解` 关系；在面板输入 `alert(1)` 触发 `第 1 列：未知函数 alert` 拦截 | 通过 · [关系面板与拦截截图](m4-01-editor-relations-panel.png) |
| 在线放映态细粒度手柄与拖动联动 | 整页仅右图斜基 $b_2$ 暴露 1 个「拖动终点」手柄（0 个「拖动起点」手柄）；拖动 $b_2$ 终点后右图坐标从 `(1, 1)` 实时更新为 `(1.39, 0.87)`、虚线平行四边形跟随，左图 `(2, 1)` 不变；点「一键重置」恢复 `(1, 1)` | 通过 · [拖动前](m4-02-online-before-drag.png) · [拖动后](m4-03-online-after-drag.png) |
| 公开分享页无痕会话权限隔离 | 点击「生成分享网页」，在全新无痕会话打开分享链接，验证仅 $b_2$ 终点可拖且坐标与虚线实时联动、左图 `(2, 1)` 不变 | 通过 · [分享页拖动后](m4-04-share-after-drag.png) |
| 离线单文件 HTML 断网 `file://` 验收 | 点击「下载交互网页」保存 `.html`，在拦截一切 `http/https` 请求的断网会话中以 `file://` 打开：清底图内联无裂图，仅 $b_2$ 终点可拖，拖动后右图坐标实时变为 `(1.39, 0.87)`、虚线跟随、左图 `(2, 1)` 不变，「一键重置」恢复 `(1, 1)` | 通过 · [离线断网拖动后](m4-05-offline-after-drag.png) |

## 定向回归结果

- **前端**：`relations.test.ts`（6/6 通过）、`test:core`（3 组核心持久化与关系撤销/冲突脚本全部 PASS）、`npm run typecheck`（零错误）、`npm run build` 含 `build:offline`（通过）。
- **后端**：`test_m4_relations.py`、`test_offline_deck.py`、`test_m3_native.py`、`test_m3_pixel.py`、`test_m3_figure_service.py`、`test_project_package.py`、`test_spatial_specs.py` 全部通过。
- **Playwright E2E**：`m4-relations-offline.spec.ts` 全流程通过（耗时约 25 秒）。
