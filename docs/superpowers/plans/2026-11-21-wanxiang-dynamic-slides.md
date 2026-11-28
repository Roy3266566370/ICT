# 通文册动态幻灯片实施计划

> 执行时使用 superpowers:executing-plans，按任务逐项完成并验证。

**目标**：上传 PPTX 后在原页中将静态图变成可拖动、可播放、可编辑、可发布的演示。首个验收案例为「标准基 vs 斜基」。

**架构**：幻灯片是材料的唯一工作视图。连续阅读视图及切换入口暂时下线。主舞台复用现有演示组件的导航与布局，使用活页的保存、发布及区域数据。结构化动态图使用可信 SVG 运行时。现有沙箱实验继续承担根据内容生成独立演示系统的任务。

**技术栈**：React、TypeScript、SVG、现有 Python API、pytest、Playwright。无需新增运行时依赖。

**需求依据**：当前对话已选方案；[现有图示交互基线](../../2026-11-21-通文册-图示交互任务清单.md)。

## 范围、发布边界与依赖

当前状态：新版动态舞台已下线。下文为历史计划和验收记录，不再实施。当前方案见[经典 PPT 原图直接交互实施计划](2026-11-21-classic-ppt-auto-interaction.md)。

- 首版闭环为任务 1–5。任务 6 交付自动识别，任务 7 交付演示系统插入及第二类图形。任务 1.1 确立主入口，任务 8 做发布回归。
- PPTX 使用原始比例，新建空白页默认 16:9。PDF 和图片可做区域交互，原生文字和图层编辑按实际可提取能力开放。
- 原稿资产只读。原位替换是可撤销的显示操作。整页位图只有在确认替换区域且背景适合遮盖时才原位替换，其余采用对照或展开。
- 作者编辑和放映共享舞台渲染。学习者调参只改变会话状态，发布内容为版本快照，离线运行不依赖模型服务。
- 文档新增字段可选，预先验证存量文件。现有路由和分享地址保持可访问。暂不承诺复刻 PowerPoint 动画、母版和复杂对象内部结构。
- 换基验收采用同一逻辑坐标系，两个视图同尺度。保持终点与保持系数是明确切换的两种模式。

## 任务 1 · 接通幻灯片工作台 —— 完成

文件：`frontend/src/pages/LivingPagesPage.tsx`、`LivingPageEditor.tsx`、`frontend/src/routes.tsx`、`frontend/src/components/presentation/DeckPlayer.tsx`。新增 `frontend/src/components/living/LivingSlideStage.tsx`（+ `.module.css`）与 `frontend/src/living/slides.ts`（+ `slides.test.ts`）、`frontend/e2e/living-slides.spec.ts`、`frontend/e2e/fixtures/two-slides.pptx`。

- [x] 实现 `slidesOf(doc: LivingPageDoc): LivingSlide[]`，按 page 块顺序保留页 ID、图像、原始尺寸和区域。同页文字按 `source.file_id + source.page` 双因子关联（`slideKey`），多文件页号重复不串页；无 file_id 的旧块只与同样无 file_id 的页匹配。无 page 块时返回空数组 → 编辑器回落阅读视图。
- [x] 在 `/living/:pageId?view=slides` 接入舞台：复用 `ThumbnailRail` 缩略图（懒加载+aria-current）、页码 `?page=` 同步、←/→/PgUp/PgDn/Home/End 翻页、`fitZoom` 适应窗口（fit 下限放宽至 5%）、原生全屏 API、阅读切换。区域热区点击复用 `PageBlocks` 导出的 `RegionPanel`（原图⇄交互图/识别/插入/AI 交互全保留）；「本页文字」折叠区显示同页文本。退出全屏归还进入前焦点，页码由组件状态+URL 双保留。
- [x] 验证：单测覆盖混合比例（1280×720 / 960×720）、多文件同页号隔离、无 source/无 page 块、缺图 page 块、scene 注入；E2E 两例——真实 PPTX 上传→工具栏进舞台→缩略图/翻页/fit/热区→React Flow 面板→pane 拖拽手势不翻页→全屏进出保留页码→阅读切换；纯文字活页 `?view=slides` 自动回落阅读视图。上传成功可经工具栏「幻灯片」进入舞台。
- [x] 图层映射检查结论：活页 `file_id` 为单次上传内的位置编号（`f1`/`f2`…），不存在 → materials `SceneDocument` 的稳定映射，因此无页可取得可信原生场景数据。`LivingSlide.scene` 作为预留注入位（`slidesOf` 第二参数 `scenes: Map<slideKey, ScenePage>`），当前一律为 `null`；舞台按回退路径提供区域操作 + 原稿视图，原生文字编辑不产生第二份真源（现有 PATCH 修订保存为唯一通道）。将来若建立映射，舞台已内建 `ScenePageView` 渲染分支。

**验收记录**：`slides.test.ts` 6 条通过；`living-slides.spec.ts` 2 条通过（13.3s）；`living-phase0` 回归通过；`tsc --noEmit` 干净。已知边界：`LivingPageEditor` 的 `?view=slides` 仅编辑器入口，分享页舞台接线属任务 5；缩略图轨 ≤720px 视口未做折叠优化。

## 任务 1.1 · 幻灯片成为唯一工作视图

文件：`frontend/src/pages/LivingPagesPage.tsx`、`frontend/src/pages/LivingPageEditor.tsx`、`frontend/src/living/slides.ts`、`frontend/src/components/living/LivingSlideStage.tsx`、`frontend/e2e/living-slides.spec.ts`。

任务 1 的完成项记录原实现。本任务紧接任务 1 执行，并替代其中的双视图入口和回退规则。

- [ ] 上传成功、列表打开和材料直链统一进入幻灯片。标准地址为 `/living/:pageId`，兼容旧 `view=slides` 和 `view=reading` 链接并保留 `page` 参数。移除连续阅读渲染分支及切换按钮。
- [ ] 对纯文字和无页块旧材料，按现有块顺序提供可分页的兼容幻灯片，保留内容及已有交互。缺图页显示可用内容与缺图状态，空材料显示空舞台。兼容分页仅用于展示，不改写原文档。
- [ ] 更新入口回归用例，覆盖上传后直达、列表打开、旧链接、纯文字、缺图、空材料、刷新保留页码和无阅读切换按钮。

- [x] 在舞台双击真实 PPTX 的原生文本框就地编辑。以活页修订号保存，原稿预览更新；验收真实文件上传、改字保存、刷新及全屏放映。复杂组和旋转文本按原稿保留。验收：Chrome 从上传入口导入双页 PPTX，使用 PowerPoint 重渲染，刷新后再次读取更新文本，全屏截图确认新版标题可见。

## 任务 2 · 持久化页内动态对象

文件：`backend/app/living/model.py`、`store.py`、`backend/app/api/routes_living.py`、`frontend/src/api/living.ts`、`frontend/src/living/types.ts`。新增双端动态图契约模块。

- [x] 在 page 块添加可选 `dynamic_objects`。每项保存 `id`、`version: 1`、`region_id` 或归一化 `bbox`、`placement: inline | compare`、`content`、`style_overrides`、可选识别来源及版本。区域锚定读取区域现有框，自建对象保存独立框。
- [x] 首个 content 分支为 `basis_change`，保存 `point`、`b2`、`coefficients`、`mode: fixed_point | fixed_coefficients`。固定 b₁=(1,0)。样式覆盖以稳定图元 ID 为键。
- [x] 后端验证归属、唯一 ID、有限数值、合法尺寸与样式枚举，限制对象数量。不可信或不存在的图元引用拒绝写入。使用现有 revision PATCH 保存。任务 3 的拖拽只更新本地，结束时走本任务保存队列；保存队列只接受最新确认版本，冲突保留未保存草稿。
- [x] 用旧文档往返、非法框、无效引用和并发修订测试验证。删除区域必须先解除或同步删除关联对象，避免保存后出现孤儿。

验收记录：后端对象契约与既有区域测试 20 项通过。真实 PATCH、重新读取及旧修订返回 409 已验证。前端队列两项测试通过。独立框采用与现有区域一致的 x0,y0,x1,y1 顺序。

## 任务 3 · 打通换基演示及原稿切换

文件：复用 `frontend/src/components/experiments/GuidedScenes.tsx`、`sceneChart.tsx` 和 `frontend/src/ispec/sceneMath.ts`。新增 `frontend/src/living/dynamicBasis.ts`、`frontend/src/components/living/BasisSlideObject.tsx`。

- [x] 实现 `evaluateBasis(params: BasisParams): BasisResult`。固定点时计算 c₂=pᵧ/b₂ᵧ、c₁=pₓ−c₂b₂ₓ。固定系数时计算 p=c₁b₁+c₂b₂。共线或近共线时报告基退化，固定点模式隐藏无效坐标和分解线。
- [x] 从区域菜单手动创建实验，默认 p=(2,1)、b₂=(1,1)、系数=(1,1)。支持独立新增在空白框中。切换模式用当前有效结果初始化另一模式，避免跳变。
- [x] 统一鼠标、触摸和数值输入到同一参数更新。通过 SVG 坐标转换处理舞台缩放。增加播放、暂停、重播、进度及两步前进，运行时进度不写文档。先画第一段，再从第一段终点画第二段。缩放与拖动时，两边公式、终点和路径从同一次计算读取。
- [x] 验证默认值、负系数、缩放、退化和播放末帧。将 b₂ 改为 (2,1) 时，固定点保持 (2,1)、系数变 (0,1)，固定系数 (1,1) 的终点变 (3,1)。
- [x] 编辑和放映均能切换原图／动态图。位图替换先预览，重叠或复杂背景采用对照模式。验收截图检查无重影、无邻区遮挡。

验收记录：将用户提供的原图嵌入真实 PPTX，从上传入口进入舞台。浏览器验证选区、并排预览、确认原位替换、拖动 b₂、两步合成、重播、刷新持久化和全屏切回原图。核对全屏截图，幻灯片标题与图外区域正常显示。换基计算单测及类型检查通过。

## 任务 4 · 编辑图元与参数绑定

文件：`BasisSlideObject.tsx`，新增 `frontend/src/components/living/DynamicObjectInspector.tsx` 与 `frontend/src/living/dynamicGeometry.ts`。

- [ ] 定义稳定的轴、基向量、合成线、辅助线和标签 ID。支持点选或键盘选中。实现实线、虚线、点线、颜色、线宽和箭头端点设置。标记 ID 按实例隔离。
- [ ] 增加 `line` content 分支，支持手工添加独立线或箭头、修改长度和角度、拖动端点。作者可将长度或角度绑定到现有数值页面变量。绑定值优先，解除绑定时保留当前显示值。
- [ ] 有数学约束的图元通过驱动参数编辑，计算产生的辅助线端点显示为派生值。保存时独立存储样式，重算只覆盖几何。拖动一次形成一条撤销记录，重做及恢复默认值可验证。
- [ ] 测试换色后调参、播放和刷新保持样式。检查直接拖动、绑定解除、同页多个对象、撤销重做以及零长度线的表现。

## 任务 5 · 发布、分享与离线闭环

文件：`frontend/src/pages/LivingPageShare.tsx`、`backend/app/living/store.py`、`backend/app/offline.py`、`frontend/src/offline/` 相应活页入口。

- [ ] 发布时固化对象、样式、变量默认值与原稿资产。分享及离线共用舞台与动态图运行时。观看者可重置个人参数，不能覆盖作者文档。现有分享地址继续可用，旧快照通过同一幻灯片兼容逻辑呈现。已经下载的 HTML 是独立文件。
- [ ] 离线产物内嵌原稿、区域裁剪及运行所需文件。资源缺失或超过现有导出限制时返回明确错误。
- [ ] 新增 `frontend/e2e/living-dynamic-slides.spec.ts`。上传含换基图的 PPTX，打开舞台，创建、拖动、播放、改样式、刷新、发布，再断网打开 HTML。用网络拦截检查放映不访问模型服务。原稿与动态图切换在三端均可用。

## 任务 6 · 看图生成可编辑草案

文件：`backend/app/living/vision.py`、新增 `backend/app/living/dynamic_recognition.py`、`routes_living.py`、`frontend/src/api/living.ts`、`LivingPageEditor.tsx`。

- [ ] 新增 `POST /pages/{id}/regions/{rid}/dynamic-preview`，沿用活页 API 前缀和权限。服务端定位裁剪图，组合本页标题、文字与可提取的原生图元。优先读取原生形状，视觉模型补充对象与含义。输入内容只作资料。
- [ ] 输出 `draft | unsupported`、识别依据、待确认字段、资料版本和警告。首批仅输出运行时支持的换基或独立线对象。坐标与关系校验由代码完成，模型不能直接写文档。
- [ ] UI 支持原稿对照、校正参数和确认应用。应用沿用 revision PATCH，原区域已改变时要求重新预览。加入重复请求合并、模型超时提示，以及继续手工创建的入口。
- [ ] 固定响应测试正常识别、错误标签、不可用模型、过期草案和不支持的图。真实验收使用至少三张未编写专门场景的换基图，覆盖矢量 PPTX、位图 PPTX 和 PDF。每张记录默认关系、待确认项和人工修正，数学错误不得被静默应用。

## 任务 7 · 生成并插入独立演示系统，验证第二类图形

文件：`backend/app/living/ai.py`、`backend/app/ppt_ai/page_lab.py`、`frontend/src/components/ppt-ai/PageLabPanel.tsx`、`LivingSlideStage.tsx`。

- [ ] 提供「根据本页生成演示系统」，复用现有建议确认、沙箱与参数绑定。结构化新增实验引用，保存被引用实验与舞台位置。支持页内和展开，区分原稿数值与教学示例值。
- [ ] 按需接入现有公式区域和函数图能力，验收为第二类图形。使用参数联动、样式保存和分享来验证同一舞台协议确实可复用。
- [ ] 沙箱实验开放其声明的参数及位置编辑。逐根图元编辑适用于结构化动态图。验证沙箱运行失败时可恢复原稿，发布快照引用完整，离线无需重新生成。

## 任务 8 · 发布回归

- [ ] 在执行前记录基线。前端运行 `npm run typecheck`、`npm test`、`npm run build`。使用现有 Playwright 配置运行新增用例及 `living-phase0`、`living-region-interactive`、`living-diagram` 回归。
- [ ] 后端在 `backend/` 运行 `python -m pytest tests/test_living_regions.py -q`，补跑新增契约、识别和发布测试。Mock 模型通过不替代真实识别验收。
- [ ] 用桌面和触摸设备验证选页、连续操作及键盘放映。检查处理缩放、共线、旧文档、资产缺失、并发更新与不支持图形的结果。
- [ ] 核对上传、列表、历史链接、分享及新导出的 HTML 均以幻灯片呈现。回归重点是存量内容和交互完整性，以及所有入口均无连续阅读切换。
- [ ] 每项提交单独验收记录。交付记录附原稿／动态图截图、在线与离线结果、真实识别样本结果及尚不支持的图形类型。
