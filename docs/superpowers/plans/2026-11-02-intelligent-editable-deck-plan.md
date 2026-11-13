# 智能可编辑网页PPT实施顺序（待方案确认）

> **For agentic workers:** Use superpowers:executing-plans after the user confirms the design and implementation scope. This file is a proposal, not an instruction to start implementation in the planning turn.

**Goal:** 将现有图片热区演示升级为可自由编辑、即时预览、快速保存并支持智能识别及二维/三维交互的网页文档。

**Architecture:** SceneDocument管理页面内容与布局，语义模型管理关系，iSpec管理运行。前端即时编辑，后端增量持久化，PPT重建和模型识别按需后台执行。

**Tech Stack:** 现有React/TypeScript/FastAPI/python-pptx；DOM/SVG编辑与二维运行时；拟引入Three.js三维运行时及经兼容性验证的元素操作组件。

**Spec:** [完整设计方案](../specs/2026-11-02-intelligent-editable-deck-design.md)。用户已确认三维首批为立体几何、空间向量及函数曲面；本次回复只确定该范围，整体方案仍待审阅。

## 全局要求

- 不覆盖上传原件，不改变旧分享快照，不清除无关对象已保存的参数。
- 不新增样本文件名、固定页码、样本区域坐标或专用默认数值。
- 原生数据优先；推断必须带出处和待确认状态。
- 先证明旧文字不会残留、文字位置可实时改，再扩展整个编辑器。
- 图形和公式计算使用受限执行器，模型仅提出结构化候选。
- 普通内容/布局保存不得启动全份PPT渲染或全份OCR。
- 所有性能值是待验证目标；记录实际环境与结果。

## 审查重点

- 深色、渐变、半透明、重叠元素和组合内移动后是否出现旧内容。
- 输入法组合输入、文本光标、拖动/缩放与画布缩放是否冲突。
- 断网、连续保存、旧响应、双窗口冲突和内容迁移是否丢改动。
- 图表截图、照片、无明确三维尺寸等内容是否被编成错误模型。
- 二维/三维结果、保存、恢复及离线导出是否使用同一修订。

## 任务1：对象模型与分层还原验证

涉及：新增 `contracts/schemas/scene-document.schema.json`、`backend/app/documents/`、`frontend/src/document/`；扩展 `backend/app/parsers/pptx_parser.py`、`backend/app/render/`。

接口建议：`SceneDocument`包含稳定page/object ID、旧来源映射、资源、对象顺序、布局修订和内容修订；`ElementNode`包含类型、transform、style、content、capabilities。

- [ ] 先写原生文字/图片/分组的源数据、样式与变换测试，以及旧ID迁移测试。
- [ ] 解析主题/母版继承与段落/文本片段样式，保留旋转与分组坐标。
- [ ] 试验独立背景和对象资源，保留原稿对照；支持对象不重复留在背景。
- [ ] 深色、渐变、遮挡和透明组合页逐个移动对象并截图核对。
- [ ] 对不可可靠拆分的内容保留整体对象和说明，不将整体位图冒充内部元素可编辑。

完成门槛：移动原生文字后，无旧字、无白色补丁、坐标与层级正确。未达到前不全面替换现有演示主链路。

## 任务2：即时编辑、增量保存与撤销

涉及：新增 `frontend/src/components/editor/`、`frontend/src/document/{store,commands,saveQueue}.ts`、`backend/app/api/routes_documents.py`、文档持久化模块；调整 `DeckPlayer.tsx`、`ElementEditor.tsx`、`routes_editor.py`。

接口建议：`GET /materials/:id/document`；`PATCH /materials/:id/document`接收 `expected_revision`、`operation_id`、`operations`，返回新修订。命令包括文本、变换、样式、数据、图层和绑定操作。

- [ ] 先写连续输入、中文输入法、一次拖动撤销、异步保存次序和刷新恢复的失败用例。
- [ ] 双击改字、拖动、缩放、旋转，先接通本地状态与真实画布。
- [ ] 补字体、颜色、对齐、图层和基础多选操作；统一命令历史。
- [ ] 本机草稿、自动保存队列、修订冲突恢复及明确同步状态。
- [ ] 拆分网页保存与PPT工作副本重建；加入测试断言普通PATCH不调用渲染/识别任务。
- [ ] 原稿/编辑/演示切换不丢状态；保存后重新打开恢复一致。

完成门槛：修改和拖动无需等待后台任务即可看到；本机常规操作性能达到设计目标或提交实测瓶颈记录。

## 任务3：多类别识别与真实模型接入

涉及：扩展 `backend/app/ispec/llm/`、`settings.py`，新增 `backend/app/recognition/`，调整 `routes_jobs.py` 与候选核对界面。

接口建议：每个区域记录 `category`、`source`、`recognition_status`、`structure`、`issues`；提供只重试某区域的识别任务。provider声明支持图像/公式/结构化输出等实际能力。

- [ ] 建立公式、图表、示意图、混合图、照片和未知区域的标注测试；原生数值与图像估读单独统计。
- [ ] 实现按区域的分类、局部提取、缓存和增量任务；不因已有图表结果而跳过其他图像。
- [ ] 先核对已有模型配置和可用视觉能力，固定模型与接口；接入真实请求、超时和部分失败恢复。
- [ ] 用原图、原文、来源与Schema验证模型候选；错误对象可以纠正、拒绝和重新识别。
- [ ] 试跑专用公式/图表识别组件的环境和耗时，依据结果选择部署方式；模拟响应只用于测试。

完成门槛：混合页所有类别都有明确状态，真实调用有记录；没有配置模型时不宣称完成多模态理解。

## 任务4：通用二维交互与语义绑定

涉及：扩展 `contracts/spec/ispec.schema.json` 与 `frontend/src/ispec/`；新增 scene2d 编译/渲染与能力注册表；调整已有FigureSpecView的参数绑定方式。

- [ ] 用非矩阵函数、几何、节点连线/步骤材料建立失败用例。
- [ ] 参数通过显式绑定驱动节点属性，不再要求特定矩阵参数名称。
- [ ] 原文公式/图片公式共用标准化表达式、变量范围、单位与定义域检查。
- [ ] 新增几何图元及节点关系的声明式规格，按用户确认的关系生成交互。
- [ ] 跨页关联候选可确认、可解绑；相同字母或相似图形不自动合并。

完成门槛：至少一个未参与开发的非矩阵主题通过原文→候选→交互→保存全过程，新增内容不改宿主页面。

## 任务5：三维交互运行时

涉及：新增 `frontend/src/components/ispec/views/Scene3DView.tsx`、`frontend/src/ispec/scene3d/`；扩展iSpec类型、Schema、注册表及离线构建入口。

接口建议：`scene3d`包含相机初值、坐标系、对象列表、受限表达式绑定及交互约束；相机状态与数学参数分离。

- [ ] 先验证空间点、线、平面和基础体的数值与绑定，再实现画面。
- [ ] 接入Three.js空间视角；实现 `z=f(x,y)` 曲面和三维参数曲线采样，跳过无定义区域。
- [ ] 参数变化更新图元与网格；点选检查数值、重置镜头、保存恢复。
- [ ] 缺少可靠空间信息的图片进入待确认，不能自动补出确定尺寸。
- [ ] 验证全屏、离线与WebGL不支持时的数值/静态回退，控制采样点和网格预算。

完成门槛：空间几何与函数曲面均有非矩阵实例，能够改变条件并看到正确结果；不能仅展示旋转的平面图片。

## 任务6：发布、陌生材料与性能回归

涉及：`backend/app/offline.py`、`routes_publish.py`、`frontend/src/offline/main.tsx`，文档迁移与新增验收报告。

- [ ] 原页、网页对象模型与新版iSpec一起冻结；保留旧版读取。
- [ ] 导出内嵌资源与二维/三维运行时，离线重开后仍能编辑允许的状态和交互参数。
- [ ] 按授权真实材料构建留出集，生成语料另外统计；逐类型报告失败原因。
- [ ] 测试改名、调页序、复杂背景、混合类别、保存冲突和离线运行。
- [ ] 测量输入/拖动/保存/识别耗时，按阶段和硬件记录，公开未覆盖项。
- [ ] 进行一次独立审查与真实浏览器操作验证，完成后更新使用说明。

实施节奏：每个阶段交付可运行版本及证据。阶段A+B优先落地，随后接入C/D所需的智能识别、非矩阵和三维能力；不以单一样本的成功演示替代阶段验收。

## 进展记录

2026-11-04：
- 任务4（通用二维交互）部分落地：新增 `eigen_probe`、`basis_change`、`singular_compare`、`rank_map`、`inverse_map` 五类模板；`det_area` 接入自动识别。页面文字中的特征向量定义、换基坐标、奇异值/条件数、行×列维度、剪切逆、单位方格面积会分别选择不同交互形态。
- 识别规则用“短标题命中 + 明确数值”限定触发，避免把总结页/其他章节误判为条件数或奇异值页；矩阵、坐标、维度、奇异值等证据仍保留在参数来源中。
- 交互锚点支持多图并集，并在页面未移动/缩放时保留原区域；自由编辑后只在元素真的移动时跟随。
- 陌生材料回归：20 份合成语料无概念误触发；非矩阵课件 `Light page - editable content` 完整上传、图表交互、自由编辑通过；参数名恰为 a/b/c/d 的非矩阵页不会误显示矩阵实验台。
- 未完成：显式 `bindings` 能力注册表、三维运行时、更大规模真实授权材料的留出集验证。

## 2026-11-04 样本展示与交互改造（第一批）

依据 `docs/superpowers/specs/2026-11-04-sample-ppt-display-interaction-requirements.md`。

- 新增 `backend/app/ispec/scene_definitions.py`：从参数语义生成持久 `scene` 定义；`dual_path_order` 追加执行顺序/起始对象参数；其他 iSpec 获得通用 `figure_lab`/`chart_lab`/`calculation_lab`，不使用 material_id 或页码硬编码。
- schema 新增 `scene` 与参数 `source_default`；`apply_document_specs` 在保留原稿基准的同时应用保存值，重置回原稿而非上次保存。
- 新增 `frontend/src/components/experiments/`：`ExperimentStage`、`DualPathExperiment`、`ExperimentTimeline`、`OriginalComparison`、`KeyControls`，并新增 `ispec/sceneMath.ts` 纯几何与 4 条测试。
- DeckPlayer 改为阅读/实验/演示三态：阅读不叠加大面积交互层；实验隐藏作者操作，主画布+关键控制+过程+结论同屏，完整参数/原稿对照独立；演示隐藏编辑、保存、分享、下载。
- 第5/10页双路径：矩形/基向量、顺序切换、原稿/中间态/最终态、时间轴、叠加偏差；90°/2倍验收得到 (0,1)/(0,2)。
- 离线复用同一组件与计算；证据见 `verify/experiment-*.png`。
- UI04–UI09 的逐页专门场景已在下一节完成并验收；本节记录第一批交付时的状态。

## 2026-11-04 样本展示与交互改造（第二批：UI04–UI09）

- `advanced_scenes.py` 按页面文字与参数语义选择场景，不使用 material_id/文件名/固定页码：第6页 `vector_family`、第7页 `eigen_probe_lab`、第8页 `basis_change_lab`、第9页 `column_combination`、第14页 `svd_process`、第15页 `shear_compare`、第17页 `rank_space`、第18页 `det_area_lab`、第20页 `inverse_lab`、第21页 `perturbation`、第22页 `change_of_basis`；第11/13/23页由页面文字生成 `matrix_addition`、`eigen_decomposition`、`relation_types` 静态来源。
- `frontend/src/components/experiments/` 新增 `BasicScenes`、`DecompositionScenes`、`SpatialScenes`、`GuidedScenes` 与 `SceneRouter`；`ExperimentStage` 按场景类型路由，只有双路径与 SVD 显示过程时间轴。
- `sceneMath.ts` 补充 SVD、实特征对、秩、逆、转置、插值与面积/偏差；验收：剪切 k=1 σ=1.618/0.618、k=2 σ=2.414/0.414；SVD 重建 A=UΣVᵀ；第21页扰动误差与 κ 上界一致。
- 第13页旋转90°无实特征方向时明确提示并转 SVD；第20页改为输入/输出两空间，显示唯一原像、整条原像线、无解；第22页 A/x 固定、P 可变，B=P⁻¹AP 与不变量同步；第17页三种维度案例均由参数计算秩。
- 自动检查：后端 249 passed，前端 36 passed；`tsc --noEmit`、在线/离线构建通过；14 页浏览器逐页截图无控制台异常，证据见 `verify/scene-p*.png`；重新导出的离线 HTML 第22页场景可用。
- 已知边界：第13页完整特征基缺三步图形；第17页 2×2 线案例不能拖列；第14页对角默认第一步无旋转动画；第20页无多点收敛动画；第23页为计算对照卡，不可直接拖 P/Q。

## 2026-11-04 自由缩放

- 新增 `frontend/src/components/ui/ZoomControl.tsx` 与 `zoom.ts`：统一 100% = 场景页 960px，支持滑杆、±、适应、Ctrl/⌘+滚轮；编辑器范围 15%–400%，展示页 25%–400%。
- 自由编辑器替换原固定档位下拉，画布放大后可滚动；展示页新增页标题行缩放条，演示态放入顶栏；放大后实验往返保持缩放。
- 修复展示页使用 PPT 点值导致缩放基准错误的问题，统一用场景页像素尺寸计算适应比例。
- 验证：前端 40 passed、`tsc --noEmit`、在线/离线构建通过；桌面与 390px 移动端、在线与离线均浏览器实测，证据见 `verify/zoom-*.png`。

## 2026-11-04 三项回归修复

- 首次生成：`apply_document_specs` 不再因缺少场景文档提前返回，新上传首次即为 16 个交互对象，第11/13/23页静态场景入口稳定出现；新增后端回归测试。
- 第11页：矩阵单元格改用真实参数 ID（a–d/e–h），修正标签与 2×2 网格；改为 5 后计算、刷新、分享和离线均保留。
- 第21页：面板改为与计算一致的 A=diag(1,0.01) 与 B=0.01·I，误差/放大数字保持 10%/100×、0.1%/1×。
- 验证：全新上传→改参→保存刷新→分享→离线完整流程通过；后端 250 passed、前端 40 passed、类型检查与双构建通过；证据见 `verify/fresh-*.png`、`verify/fix-p11-matrix.png`、`verify/fix-p21-label.png`。

## 2026-11-04 实验画布比例

- 修复实验内 `FigureSpecView` 根元素为 `figure`、未被拉伸的问题：图形视图现在横向铺满并分配剩余高度，SVG 填满图形行；工具栏预设按钮恢复横排。
- 第7页实测图卡 1058×618、SVG 1032×554；第8页同尺寸铺满；其余场景主 SVG 约 1058px 宽，第15页保留刻意的双栏对比；离线导出一致。
- 证据见 `verify/stage-layout-p7.png`、`stage-layout-p8.png`、`stage-layout-p7-offline.png`；在线/离线构建通过。

## 2026-11-04 主页重构

- `HomePage` 改为四段式：居中首屏、原稿/交互 1:2 对照、右侧可拖动剪切实验、底部三项价值；旧 `BrandStage`/`HeroCopy` 已移除。
- 新增 `TransformShowcase`：原稿静态页与深色交互画布共用 k=1 的剪切场景，滑杆联动平行四边形、A·x、面积比和“查看计算依据”抽屉。
- `SiteNav` 增加可选上传按钮，三项导航改为交互示例 / 使用指南 / 个人空间；上传面板移入弹窗，保留任务进度、Escape/遮罩关闭与焦点管理。
- 验证：1600×1000、390×844、上传弹窗、移动菜单均浏览器实测；前端 40 passed，类型检查与双构建通过；证据见 `verify/home-redesign*.png`。

## 2026-11-05 网上下载 17 页模板回归

- 用 Showeet 公开 17 页商务模板做导入：17/17 页翻页正常、0 iSpec（纯文本版式符合预期）、无矩阵误触发。
- 发现占位符/组合对象探针导出失败导致整页 unprepared；新增直接导出自然尺寸回退，exporter 升至 v5，并允许当前版本页面带 frozen 对象继续编辑其余内容。
- 修复后第1/4/17页自由编辑 ready（10/5/6 个对象），标题修改持久化；分享与离线第4页保留新标题。
- 后端 253 passed（新增 3 条 manifest 测试）、前端 40 passed；证据见 `verify/online-*.png`。

## 2026-11-05 健壮性修复

- `should_upgrade_conversion` 阻止失败/处理中/活跃任务被详情 GET 反复重跑；升级只对旧且已完成的材料自动触发。
- `useDeckValues` 拆分 `persistDirty` 并新增 `reloadBaseline`，读取失败可保留草稿恢复基线后自动保存；DeckPlayer 增加对应入口。
- 重新提取交互期间 `canEdit=false`，画布与文本编辑冻结，避免旧 revision + `loadServer` 覆盖请求期间修改。
- 图层导出使用配置超时、watchdog 主动退出、按页锁和 COM 信号量；发布/下载移除同步 PowerPoint 准备，前端先准备改动页并轮询后发布。
- 验证：后端 255 passed、前端 40 passed、类型检查与双构建通过；基线恢复截图见 `verify/fix-baseline-recovery.png`。

## 2026-11-05 缩放平移与鼠标演示

- 展示页放大后支持鼠标拖拽平移；指针移动超过阈值会抑制同一次操作的翻页点击。
- 编辑器加入“平移”按钮、空格拖动和中键拖动；平移时冻结对象移动/选择/双击编辑，并更新底部快捷键提示。
- 演示态支持单击页面翻页、滚轮上下翻页（420ms 节流），Ctrl/⌘+滚轮仍缩放；热点点击与实验态不翻页，页面切换后滚动位置复位。
- 验证：2 页样本上单击 1→2、滚轮回到 1；展示页拖拽 scrollLeft 0→81；编辑器拖拽 0→120；前端 40 passed、类型检查与双构建通过；证据见 `verify/pan-deck.png`、`verify/pan-editor.png`。
