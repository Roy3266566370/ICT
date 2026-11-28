# 通文册（Tongwence）原生 PPT / WPS 级设计能力升级实施方案

> **目标定位**：将通文册从「上传静态 PPT 后进行微调与嵌入交互」的改造工具，升级为**「原生 PPT / WPS 级可视化课件设计器 + 定象坊活态交互沙盘」一体化创作工作台**。用户既可以导入既有 PPTX/PDF，也可以在系统内**从零开始直接设计与制作专业级幻灯片**，并无缝导出标准 `.pptx`（PowerPoint / WPS 完全可编辑）与断网可播的离线交互 `.html`。

---

## 一、当前系统现状盘点（基于最新代码库）

### 1.1 已完成的精简清理（当前已生效）

你已完成一轮非常果断的减法，移除了多套与核心路径重叠、维护成本高的重型实验功能，编辑器主链路明显清爽：

- **已删除的前端重型实验组件**：
  - 图片矢量化弹窗：`FigureVectorizationDialog.tsx`
  - 动态关系表达式引擎面板：`PageRelationsPanel.tsx`
  - 原位 AI 演示框与独立演示弹窗：`SlideDemoNode.tsx`、`standaloneDemos.ts`、`slideRichNodes.test.ts`
  - 旧版 PPT-AI 互动实验室与联动面板：`components/ppt-ai/LinkagePanel.tsx`、`PageLabPanel.tsx`、`PageLabPlayer.tsx` 及对应旧 E2E 用例
- **已精简的编辑器交互**：
  - `frontend/src/components/editor/FreeDeckEditor.tsx` 顶部工具栏已移除「图示校对」「AI 圈选」「AI 演示框」「独立演示」，仅保留核心设计操作与「🎛️ 插入定象坊插件」。
  - `frontend/src/components/editor/NodeProperties.tsx` 已移除「动态关系」Tab、「换基与向量分解联动」以及「图片矢量化」配置区。

### 1.2 现有可复用的坚实底座（无需从零造轮子）

通文册已经具备接近 50% 的原生 PPT 编辑器底层能力，后续升级可以直接复用以下成熟基础设施：

| 能力域 | 现有实现 | 关键文件 |
| --- | --- | --- |
| 文档模型与增量同步 | `SceneDocument / ScenePage / SceneNode` 结构、乐观锁增量 `PATCH`、本地草稿恢复、60 步撤销/重做 | `frontend/src/document/types.ts`、`model.ts`、`controller.ts`；`backend/app/documents/store.py` |
| 页面结构管理 | 左侧缩略图栏拖拽排序、新建空白页、简易教学版式（`lesson`）、复制页、删除页、演讲者备注、单页纯色背景 | `FreeDeckEditor.tsx`、`controller.ts`、`store.py` |
| 基础对象体系 | 文字（行内富文本 + `$LaTeX$` 公式）、图片（含百分比裁剪）、23 种 SVG 图形（`SHAPE_CATALOG`）、线条/箭头（实/虚/点线 + 起止箭头）、表格、图表（Vega）、定象坊插件 | `ScenePageView.tsx`、`InlineRichText.tsx`、`shapeCatalog.ts`、`NodeProperties.tsx` |
| 画布交互引擎 | 8 点缩放、旋转（Shift 15° 吸附）、框选/Shift 多选、智能对齐线与等距间隙吸附、对齐/分布、图层显隐/锁定、滚轮缩放、Space 平移 | `FreeDeckEditor.tsx`、`canvasGestures.ts` |
| 演示与双向导出 | `DeckPlayer` 全屏放映、钢笔/荧光笔/激光笔板书、双屏演讲者视图、在线分享、单文件离线 HTML 导出，以及**支持无原稿从零生成 `.pptx` 的 `export_pptx`** | `DeckPlayer.tsx`、`backend/app/documents/pptx_export.py` |

### 1.3 发现的少量历史残余代码（建议在实施期间一并收尾）

- **前端残余**：
  - `SlideDiagramNode.tsx`：工具栏已无新增入口，但 `NodeProperties.tsx` 与 `ScenePageView.tsx` 仍挂载其编辑和渲染逻辑（建议仅保留兼容渲染或并入标准图形+连接线体系）。
  - `BasisComposition.tsx`、`frontend/src/document/relations.ts`、`basisComposition.ts`：虽已删除前端配置面板，但 `ScenePageView.tsx` 每次渲染仍执行 `normalizePageRelations` / `evaluatePageRelations` 与 `BasisRelationOverlay`。
  - `LivingPagesPage.tsx`：底部仍保留与顶部功能重复的三栏说明（`01 IMPORT / 02 LIVE STAGE / 03 OFFLINE`）。
- **后端残余**：
  - `backend/app/api/routes_documents.py` 仍挂载 `/vectorize`、`/relations/suggest` 端点；`store.py` 仍校验 `demo`、`basis`、`figure_scene`。如无历史兼容包需求，可逐步下线或冻结为只读兼容。

### 1.4 距离「在系统内直接做 PPT / WPS 设计」的 6 大核心差距

1. **没有「新建空白课件 / 从模板创建」入口（最大断点）**：`LivingPagesPage.tsx` 目前只有「上传 PPTX/PDF/图片」和「导入备份」，后端也没有创建空白课件的接口，用户无法零起点直接开画。
2. **缺少「主题母版（Theme & Master）」与教学版式库**：当前 `addPage` 仅有空白页与极简 `lesson`（两段文字），缺少封面/目录/双栏/左文右沙盘/总结等版式，也缺少全局配色、字体搭配、统一页眉页脚/页码和一键换肤。
3. **PPT/WPS 高频操作手感缺失**：缺少 `Ctrl+C / Ctrl+V / Ctrl+X`（含跨页粘贴与系统剪贴板直接贴图）、画布右键菜单、上移/下移一层、对象组合（`Ctrl+G`）、格式刷、精准字号选择（目前 `InlineRichText` 使用过时的 `execCommand('fontSize', 1..7)` 7 档字号）与有序列表。
4. **视觉表现力不足，难以做出「好看的 PPT」**：
   - **图形内部不能写文字（Shape-as-Card 缺失）**：当前 `shape` 节点只渲染 SVG 图形，无法像 PPT/WPS 一样双击图形直接输入文字，做信息卡片、流程框、徽章极其繁琐。
   - **样式偏单薄**：缺少圆角半径、投影阴影、线性/径向渐变编辑（当前 `fill_gradient` 只读）、图形虚线边框、页面渐变/图片背景。
   - **图片裁剪体验差**：当前只能手输 4 个百分比数字，不能画布原位拖拽裁剪，也不支持文件拖入画布。
   - **表格与图表偏简陋**：表格缺少表头配色/斑马纹/边框样式/对齐；图表仅支持柱状与折线，缺少饼图/面积图及主题色联动。
5. **放映节奏与课堂动画不足**：尚无页面切换动效（淡入/推入/滑动），且点击逐条显现（`anim_step`）目前仅限 `vector` 线条，文字/图形/图片/定象坊插件无法按讲课节奏分步出现。
6. **高保真导出同步升级**：新增的图形内嵌文字、渐变/阴影/圆角、主题母版、表格/图表样式与过渡动画，需同步写入 `pptx_export.py` 与离线单文件 HTML 运行时，避免「编辑好看、导出变形」。

---

## 二、总体产品架构与设计原则

### 2.1 差异化产品定位

不追求盲目复刻 PowerPoint 全部 1000+ 项重型办公菜单，而是精准聚焦 **「80/20 教学与汇报高频设计能力 + 100% 独有的定象坊活态交互能力」**：

- **零门槛成稿**：打开通文册即可选择主题模板或空白画布（16:9 / 4:3）开写，3 分钟排出一份专业水准的课件。
- **WPS/Keynote 级直觉手感**：双栏/图文/沙盘版式一键切换、图形双击直接打字、悬浮快捷条就近调样式、右键菜单与 `Ctrl+C/V/G` 符合肌肉记忆。
- **活态内容一等公民**：定象坊交互沙盘、LaTeX 公式、数据图表与普通 PPT 卡片同属标准画布对象，共享主题配色、对齐吸附与步序显现。
- **四端同源一致**：编辑器画布（`FreeDeckEditor`）↔ 在线放映（`DeckPlayer`）↔ 离线单文件 `.html` ↔ 导出 `.pptx` 共用同一份扩展后的 `SceneDocument` 语义。

### 2.2 工作台信息架构升级

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 顶栏：返回 | 课件标题(可原位重命名) | [设计/主题] [版式] [页面切换] | 预览/放映 | 保存 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 插入与快捷工具条：撤销/重做 | ＋文字 ＋公式 ＋图片 ＋图形▾ ＋线条/箭头▾ ＋表格 ＋图表 │
│                  | 🎛️ 定象坊插件 | [格式刷] [组合/取消] [层级▾] [对齐▾] [分布▾]   │
├──────────────┬──────────────────────────────────────────┬───────────────────┤
│ 左侧面板     │               中心画布工作区             │ 右侧属性检查器     │
│ [页面][图层] │  ┌────────────────────────────────────┐  │ (随选中态自动切换) │
│              │  │   [选中对象时的顶部悬浮快捷条]      │  │ - 未选中: 页面背景 │
│ 1. 封面页    │  │                                    │  │   版式/主题/切换/  │
│ 2. 目录页    │  │       16:9 幻灯片画布              │  │   页脚/备注        │
│ 3. 推导页    │  │   (支持右键菜单、拖拽图片、        │  │ - 选中文字/图形:   │
│ 4. 沙盘页    │  │    双击图形写字、原位裁剪)         │  │   排版/填充/边框/  │
│              │  └────────────────────────────────────┘  │   阴影/入场步序    │
│ [＋ 新建页▾] │         缩放 / 适应 / 网格参考线          │ - 选中表格/图表/图 │
└──────────────┴──────────────────────────────────────────┴───────────────────┘
```

---

## 三、统一数据模型扩展方案（向后兼容）

所有扩展字段均为**可选字段**，存量 `document.json` 无需迁移脚本即可直接加载；前后端同步扩展 `frontend/src/document/types.ts`、`model.ts` 与 `backend/app/documents/store.py`。

### 3.1 文档级主题与母版（`SceneDocument` 扩展）

```ts
export interface DeckTheme {
  id: string;                        // 如 'academic-paper' | 'slate-tech' | 'warm-chalk' | 'minimal-ink'
  name: string;
  aspect_ratio: '16:9' | '4:3';      // 默认 16:9 (960x540 或 720x405 pt)
  palette: {
    background: string;              // 默认页底色
    surface: string;                 // 卡片/表格底色
    primary: string;                 // 主强调色（标题/主图/按钮）
    secondary: string;               // 辅强调色
    accent: string;                  // 高亮色（重点/标注）
    text: string;                    // 正文主色
    muted: string;                   // 次要说明/页脚色
    border: string;                  // 边框分割线色
  };
  fonts: {
    heading: string;                 // 标题字体
    body: string;                    // 正文字体
  };
  master?: {
    show_page_number?: boolean;      // 自动页码（封面页自动隐藏）
    footer_text?: string;            // 统一页脚文字（课程名/作者）
    header_text?: string;            // 统一眉标
    accent_bar?: 'none' | 'top' | 'left' | 'bottom'; // 极简装饰条
  };
}

// SceneDocument 新增可选字段：
// theme?: DeckTheme;
```

### 3.2 页面级背景、版式与切换（`ScenePage` 扩展）

```ts
export interface PageBackground {
  kind: 'solid' | 'gradient' | 'image';
  color?: string;
  gradient?: { angle: number; stops: Array<{ position: number; color: string }> };
  image_data?: string;
  image_opacity?: number;
  overlay_color?: string;            // 图片背景半透明蒙层，保证文字可读
}

export interface PageTransition {
  kind: 'none' | 'fade' | 'slide' | 'push' | 'zoom';
  duration_ms?: number;              // 默认 320ms
}

// ScenePage 新增可选字段：
// layout_id?: string;               // 当前页使用的版式标识（如 'cover' | 'two-col' | 'text-plugin'）
// background?: PageBackground | null;
// transition?: PageTransition;
// hide_master?: boolean;            // 封面/过渡页隐藏页眉页脚页码
```

### 3.3 对象级样式、组合与步序显现（`SceneNode` & `TextStyle` 扩展）

```ts
// TextStyle 新增可选字段：
// border_radius?: number;           // 矩形/图片/文本框圆角（px）
// shadow?: { x: number; y: number; blur: number; color: string; opacity: number } | null;
// linear_gradient?: { angle: number; stops: Array<{ position: number; color: string; opacity?: number }> } | null;
// list_style?: 'none' | 'bullet' | 'ordered'; // 列表类型

// SceneParagraph 新增可选字段：
// list_type?: 'bullet' | 'ordered'; // 兼容旧 bullet: boolean

// SceneNode 新增可选字段：
// group_id?: string | null;         // 轻量化扁平组合：同 group_id 同步选中/拖拽/缩放，无需重构树形节点
// aspect_locked?: boolean;          // 等比缩放锁定（图片/插件默认开启）
// table_style?: {                   // 表格美化样式
//   header_row?: boolean;
//   banded_rows?: boolean;
//   header_fill?: string;
//   header_color?: string;
//   band_fill?: string;
//   border_color?: string;
// };
// style.anim_step?: number;         // 复用既有字段（0=随页显示，1~8=点击逐步显现），从 vector 推广至全部对象类型
```

> **设计亮点（扁平 `group_id` 组合机制）**：不把 `SceneNode` 改成嵌套树，而是用扁平 `group_id` 标识同组对象。这样 `diffDocuments`、`patchNodes`、图层列表、对齐吸附、撤销/重做和后端 `store.py` 增量补丁全部保持 O(N) 简单结构，改动面极小且零破坏性。

---

## 四、分阶段工程实施路线

建议按 **P0 → P1 → P2 → P3** 四个阶段推进，每阶段都可独立交付、独立验证。

---

### 阶段 P0：打通「从零创作」闭环与 PPT 核心操作手感（最高优先级）

> **阶段目标**：用户进入通文册后，无需上传任何外部文件即可新建一份精美课件，并拥有接近 WPS/Keynote 的基础编辑流畅度。

#### P0-1：新建空白课件与开箱模板库

- **后端改造**：
  - 在 `backend/app/api/routes_materials.py` 新增 `POST /api/v1/materials/blank`（支持请求体 `{ title, aspect_ratio: '16:9'|'4:3', theme_id, template_id }`）：
    - 在数据库创建 `MaterialRecord`（`status='ready'`，无需走耗时上传/渲染队列）和对应 `PageRecord`。
    - 直接生成初始 `document.json`（含 `theme` 配置与模板预置页，所有页 `preparation.status='ready'`、`source_page_no=null`），写入 `document_root(material_id)/document.json`。
    - 同步支持 `PATCH /api/v1/materials/{material_id}` 修改课件标题（用于编辑器顶栏原位改名）。
  - 在 `backend/app/documents/layers.py` 确保无 `source.pptx` 且已有 `document.json` 的纯原生课件在 `ensure_document` 时直接返回，不触发 `rendered_document` 回退报错。
- **前端改造**：
  - 在 `frontend/src/api/materials.ts`（或 `documents.ts`）新增 `createBlankMaterial`、`renameMaterial`。
  - 在 `frontend/src/pages/LivingPagesPage.tsx` 顶部主操作区升级为双主入口：
    - **「＋ 新建演示文稿」**（打开「新建课件弹窗」：可选空白画布 16:9/4:3 或 5 套开箱即用的学科/汇报模板，如「高校数理讲义」「商务汇报蓝图」「科技深色演讲」「论文答辩框架」「实验课交互沙盘册」），创建后直达 `/materials/{id}?mode=edit`。
    - **「上传 PPTX / PDF / 图片」**与**「导入离线课件」**保留为并列入口。
  - 在 `frontend/src/pages/MaterialDeckPage.tsx` 顶栏支持双击课件标题原位重命名。

#### P0-2：全局主题（Theme）与母版（Master）系统

- **内置 6 套高审美主题**（新建 `frontend/src/document/themes.ts`）：
  1. **象牙学术（Academic Paper）**：暖白纸底 + 墨蓝主色 + 赭石强调（契合万象整体审美）。
  2. **深海科技（Midnight Tech）**：深靛底 + 亮青/琥珀强调（适配黑底数据与物理/工科演示）。
  3. **清墨极简（Minimal Ink）**：纯白底 + 炭黑标题 + 钴蓝点缀（论文答辩/通用汇报）。
  4. **学院黑板（Warm Chalk）**：深墨绿底 + 粉笔米白 + 暖黄标注（数学推导/课堂板书感）。
  5. **商务青蓝（Executive Slate）**：浅灰蓝底 + 藏青主色 + 翡翠强调（产品/管理汇报）。
  6. **燕麦人文（Editorial Sand）**：米杏底 + 焦糖棕 + 黛绿点缀（通识/社科课件）。
- **主题引擎与一键换肤**：
  - 在编辑态右侧栏（或顶栏「主题」抽屉）可切换主题、修改自定义色板、配置主副字体与母版页眉/页脚/页码/装饰条。
  - 提供**「应用主题到全册」**：自动更新未单独锁定背景的页面底色，并按角色（标题/正文/图形填充）批量同步配色；支持一键撤销（`Ctrl+Z`）。
- **母版层渲染**：
  - `ScenePageView.tsx` 在背景层与节点层之间渲染 `MasterLayer`（页眉、页脚、装饰条与动态计算的 `页码 / 总页数`；封面页 `hide_master=true` 自动隐藏）。

#### P0-3：常用幻灯片版式库（Slide Layouts）

- 新建 `frontend/src/document/layouts.ts`，内置 **8 套高频 PPT 版式生成器**（均根据当前 `page.width/height` 与 `document.theme` 动态计算坐标与配色）：
  1. **空白页（Blank）**
  2. **封面页（Cover）**：主标题 + 副标题 + 讲者/日期栏 + 主题装饰图形
  3. **章节过渡页（Section）**：大号序号 + 章节标题 + 副说明
  4. **目录/大纲页（Agenda）**：3~4 条编号卡片列
  5. **标准正文页（Title + Body）**：页眉标题 + 带项目符号的正文区
  6. **双栏对比页（Two-Column）**：标题 + 左右两张带底色/边框的圆角卡片
  7. **左文右图页（Text + Image）**：左侧要点阐述 + 右侧图片占位框（点击即选图）
  8. **左文右定象坊沙盘页（Text + Workshop Plugin）**：左侧公式/结论要点 + 右侧定象坊互动插件占位框（点击即选沙盘，突出通文册核心特色）
- **交互入口**：
  - 左侧页面栏的 `＋` 按钮升级为「新建页」下拉面板，可视化展示 8 种缩略版式卡片，一点即插入。
  - 选中空白/单页时，右侧「页面属性」提供**「切换版式」**（保留当前页已有标题/正文文字并重排，或提示一键套用）。

#### P0-4：WPS / PPT 核心交互手感补齐

- **完整剪贴板体系（`FreeDeckEditor.tsx`）**：
  - `Ctrl+C` / `Ctrl+X` / `Ctrl+V`：支持单个/多个对象同页与**跨页**复制粘贴（序列化为带自定义标识的剪贴板载荷 + 内存回退），粘贴到原页自动偏移 `+18px`，粘贴到其他页保持原坐标。
  - **外部粘贴直通**：在画布直接按 `Ctrl+V` 粘贴系统截图/图片（`clipboardData.files`），或直接**拖拽本地图片文件到画布**，自动创建居中的 `image` 节点；粘贴外部纯文本自动创建文本框。
  - `Ctrl+A` 全选当前页未锁定对象。
- **画布右键上下文菜单（新建 `CanvasContextMenu.tsx`）**：
  - 选中对象右键：剪切、复制、粘贴、复制副本、置于顶层、**上移一层**、**下移一层**、置于底层、**组合 / 取消组合**、锁定/解锁、删除。
  - 空白处右键：粘贴、新建文本框、切换本页版式、修改背景色。
- **精准层级与对象组合（`model.ts` + `FreeDeckEditor.tsx`）**：
  - 除现有的「置顶 / 置底」外，补齐「上移一层 / 下移一层」（`Ctrl+]` / `Ctrl+[`）。
  - 实现 `Ctrl+G` 组合 / `Ctrl+Shift+G` 取消组合：点击同组任一成员自动全选整组同步移动、缩放、旋转；双击组内某成员可临时进入「组内单选」修改单个文字或颜色。
- **精准富文本编辑器升级（`InlineRichText.tsx`）**：
  - 替换 `execCommand('fontSize', 1..7)` 为精准 `span` 字号控制（支持 `10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 64, 72` pt 与 `A+ / A-` 步进）。
  - 补齐**有序编号列表（1. 2. 3.）**、文字高亮背景色与清除格式按钮。

---

### 阶段 P1：视觉表现力升级与专业对象设计（从「能排」到「好看」）

> **阶段目标**：解决当前「排出来的页面像简陋原型」的问题，让用户无需借助 WPS/Keynote 也能直接做出高质感信息卡片、配图、表格与数据图表。

#### P1-1：图形内嵌文字（Shape-as-Card）与形状高级样式

- **图形双击直接写字**：
  - 在 `ScenePageView.tsx` 中，让 `type === 'shape'` 同时渲染 `<ShapeContent>` 与内部的 `<TextContent>`（默认水平/垂直居中、内边距 `10px`）；在 `FreeDeckEditor.tsx` 中双击 `shape` 节点同样可进入 `<InlineRichText>` 原位编辑。
  - 由此，圆角矩形卡片、菱形判断框、标注气泡、箭头流程块全部原生支持内部文字，大幅减少「图形 + 文本框叠放」的痛点。
- **形状与卡片高级样式**：
  - **圆角半径**：为 `rect` / `roundRect` / `text` / `image` 开放 `border_radius` 滑块（`0~64px`）。
  - **虚线/点线边框**：将 `line_style`（实线 / 虚线 / 点线）开放给 `shape` 与 `text` 边框。
  - **柔和阴影预设**：提供「无阴影 / 轻微浮起 / 卡片阴影 / 强立体」4 档一键阴影预设及自定义微调。
  - **渐变填充编辑器**：新增 `linear_gradient`（支持方向角度 + 2~3 个色标 + 6 组精选渐变色卡），渲染于 SVG `<linearGradient>`。
  - **智能连接线吸附（轻量增强）**：拖动 `vector` 线条端点靠近任意 `shape` 的四边中点时，自动吸附到图形锚点，方便手绘结构图与流程图。

#### P1-2：页面背景升级

- 扩展 `NodeProperties.tsx` 的「页面背景」区：
  - 支持 **纯色**（内置当前主题色板快捷圆点 + 自定义取色器）、**线性渐变**（8 组精选背景渐变预设）、**背景图片**（上传或粘贴图片，支持铺满模式与半透明遮罩层滑块，保证前景文字清晰）。
  - 增加**「应用此背景到全部页面」**按钮。

#### P1-3：画布悬浮快捷工具条（Floating Format Bar）与格式刷

- **选中态悬浮快捷条（新建 `FloatingFormatBar.tsx`）**：
  - 选中单个 `text` / `shape` / `image` / `vector` 时，在对象正上方（靠近顶边时自动翻至下方）浮现紧凑的 1 行快捷条：
    - 文字/图形：字体、字号 `− / +`、B/I/U、文字色、填充色、对齐、复制、删除。
    - 图片：裁剪、圆角、替换图片、删除。
    - 多选对象：左/中/右对齐、顶/中/底对齐、等距分布、组合。
  - 拖拽或框选过程中自动隐藏，不遮挡画布视线。
- **格式刷（Format Painter）**：
  - 工具栏增加「🖌 格式刷」按钮（`Ctrl+Shift+C` / `Ctrl+Shift+V`）：选中源对象点击后，再点击目标对象一键复制其样式（文字样式/填充/边框/圆角/阴影）；双击格式刷可连续刷多个对象，按 `Esc` 退出。

#### P1-4：图片原位可视化裁剪与样式美化

- 在 `FreeDeckEditor.tsx` 增加图片「裁剪模式」：双击图片或点击悬浮条「裁剪」进入原位裁剪态，四周出现黑色 L 形裁剪手柄，直接拖拽框选可视区，画布外保留半透明原图预览，按 `Enter` 或点击空白确认（底层仍写入 `node.crop`，完全兼容现有导出）。
- 右侧面板增加「替换图片」（保留位置、大小与圆角阴影）和「图片圆角 / 边框 / 阴影」。

#### P1-5：表格与图表设计器升级

- **表格美化与快捷编辑**：
  - `ScenePageView.tsx` 渲染表格支持 `table_style`（首行主题强调色加粗、偶数行斑马纹、细边框、单元格内边距与对齐方式）。
  - 支持在画布上双击单元格直接输入（`Tab` 跳下一格、`Enter` 跳下一行），而不再强制在狭窄右侧栏里填表单。
- **图表多类型与主题配色联动**：
  - `ChartContent` 扩展 `chart_type` 切换：柱状图（`COLUMN_CLUSTERED`）、条形图（`BAR_CLUSTERED`）、折线图（`LINE`）、面积图（`AREA`）、饼图/环形图（`PIE`）。
  - 图表配色默认读取当前 `document.theme.palette`（主色、辅色、强调色序列），保持整份 PPT 视觉统一。

#### P1-6：LaTeX 公式快捷插板

- 在工具栏新增「∑ 插入公式」与 `InlineRichText` 中的「∑」联动：
  - 点击弹出轻量公式构建气泡，提供常用教学符号与模板按钮（分数 `\frac{a}{b}`、积分 `\int_a^b`、求和 `\sum`、极限 `\lim`、矩阵、希腊字母、上下标），下方实时 KaTeX 预览，确认后插入行内 `$...$` 或独立居中公式文本框。

---

### 阶段 P2：放映节奏、动画与全链路高保真导出

> **阶段目标**：补齐「讲课演示节奏」与「交付物一致性」，确保系统里做出来的 PPT 既能现场优雅放映，也能无损导出给传统 PowerPoint / WPS 或离线浏览器打开。

#### P2-1：页面切换动效与全对象点击逐条显现

- **页面切换动画（Slide Transition）**：
  - 在右侧页面属性提供切换选择：无 / 淡入淡出 / 水平滑动 / 推入 / 轻缩放，支持「应用到全部页面」。
  - `DeckPlayer.tsx` 翻页时按 `page.transition` 驱动 CSS 动画（遵循 `prefers-reduced-motion` 无障碍降级）。
- **全对象点击逐条显现（Build-in Animation）**：
  - 将现有的 `style.anim_step`（0 = 默认显示，1~8 = 第 N 次点击显现）从仅限 `vector` 开放到**全部对象类型**（文字、图形、图片、表格、图表、定象坊插件）。
  - 编辑态在对象左上角显示小步序角标（如 `①`、`②`），方便一目了然检查出场顺序。
  - 放映态（`DeckPlayer.tsx`）：按空格 / `→` / 点击屏幕时，若当前页还有未显示的 `anim_step`，先逐级显现下一批对象（带优雅的淡入上移过渡），全部显现后再翻到下一页；按 `←` 时先回退步序再翻上一页。

#### P2-2：高保真 `.pptx` 双向导出升级（`backend/app/documents/pptx_export.py`）

针对新增设计能力，逐项补齐 OpenXML / `python-pptx` 映射：

| 新增能力 | `pptx_export.py` 导出实现方案 |
| --- | --- |
| 原生空白课件导出 | 已具备 `Presentation()` 基础路径；补充默认 16:9 / 4:3 尺寸设置，确保无 `source.pptx` 时页宽高与 `page.width/height` 精确一致 |
| 主题背景与母版页脚 | 支持 `background.kind === 'gradient'`（写入 `a:gradFill` + `a:lin` 线性角度）、`image`（写入背景图或底层全幅图）以及母版页脚/页码文本框写入 |
| 图形内嵌文字 | 放宽 `_apply_node` 第 390 行 `kind=='text'` 的限制，当 `kind=='shape'` 且 `node.text` 非空时同样调用 `_write_text(shape.text_frame, ...)` |
| 线性渐变、阴影与圆角 | 扩展 `_write_gradient` 支持 `a:lin` 线性渐变；写入 `a:effectLst > a:outerShdw` 导出阴影；为圆角矩形写入 `adjustments[0]` 对应圆角比例 |
| 表格美化样式 | `_table` 写入表头填充色/加粗白字、斑马纹底色、自定义单元格边框与垂直居中 |
| 多类型图表 | `_chart` 映射 `COLUMN_CLUSTERED / BAR_CLUSTERED / LINE / AREA / PIE`，写入系列主题色 |
| 页面切换与定象坊插件 | 写入 `p:transition`（fade/push/wipe）；定象坊插件继续通过 `capturePptxFrames` 抓取高分辨率静态快照嵌入，并在演讲者备注附带互动版直达链接 |

#### P2-3：离线单文件 HTML 运行时同步

- 同步升级离线导出打包管线与 `backend/app/static/offline/runtime*.js`，使导出的离线 `.html` 完整支持：
  - 主题母版页眉/页脚/页码
  - 图形内嵌文字、圆角/阴影/线性渐变、图片/渐变背景
  - 表格美化样式与多类型图表
  - 页面切换动画与点击逐条显现步序控制

---

### 阶段 P3：AI 辅助排版成稿（可选增强）与历史残余清理

> **核心理念**：区别于已删除的黑盒 `PageLab` / `SlideDemoNode`，新一代 AI 辅助只产出**完全标准、100% 可二次手动编辑的 `SceneDocument` / `SceneNode`**。

#### P3-1：AI 大纲一键生稿 & 单页智能排版

- **从大纲生成多页课件**：用户在「新建课件」弹窗中切换到「AI 大纲生成」Tab，输入课程主题或粘贴讲义大纲 -> 后端调用 LLM 输出结构化 JSON（每页标题、要点、推荐版式 `layout_id`、是否建议配定象坊沙盘模板 `template_kind`）-> 前端确定性排版引擎（复用 P0-3 的 `layouts.ts`）将其渲染为标准可编辑多页 `SceneDocument`。
- **单页一键智能排版（Smart Relayout）**：编辑某页时若文字堆砌杂乱，点击「智能重排」，在当前主题下给出 3 种候选版式（如要点卡片、双栏对比、左文右图）供点击预览与一键应用。

#### P3-2：历史残余代码清理与首页精简

- 清理 `LivingPagesPage.tsx` 底部重复的三栏提示区，让首页更聚焦「新建课件 / 上传原稿 / 我的活页册」列表。
- 评估并清理无引用残余模块（`relations.ts`、`BasisComposition.tsx`、后端 `figure_service.py` / `relation_generation.py` 等），减少包体积与维护心智负担。

---

## 五、涉及的关键文件改动清单

| 阶段 | 前端主要文件 | 后端主要文件 |
| --- | --- | --- |
| **P0** | `pages/LivingPagesPage.tsx`、`pages/MaterialDeckPage.tsx`、`document/types.ts`、`document/model.ts`、`document/controller.ts`、新增 `document/themes.ts` & `document/layouts.ts`、`components/editor/FreeDeckEditor.tsx`、`InlineRichText.tsx`、`NodeProperties.tsx`、`ScenePageView.tsx`、新增 `CanvasContextMenu.tsx` & `NewDeckModal.tsx` | `api/routes_materials.py`（新增 `POST /materials/blank`、`PATCH /materials/{id}`）、`documents/store.py`（扩展文档级 `theme` 与节点 `group_id` 校验）、`documents/layers.py`（兼容无 `source.pptx` 原生文档） |
| **P1** | `components/editor/ScenePageView.tsx`、`NodeProperties.tsx`、`FreeDeckEditor.tsx`、新增 `FloatingFormatBar.tsx`、`ImageCropOverlay.tsx`、`FormulaPopover.tsx`、`GradientPicker.tsx`、`components/ispec/views/VegaSpecView.tsx`（饼图/面积图） | `documents/store.py`（校验 `border_radius`、`shadow`、`linear_gradient`、`table_style`、`PageBackground`） |
| **P2** | `components/presentation/DeckPlayer.tsx`、`ScenePageView.tsx`、`FreeDeckEditor.tsx`（步序角标与动画配置） | `documents/pptx_export.py`（全要素高保真导出）、离线单文件导出与 `static/offline/runtime*.js` |
| **P3** | `NewDeckModal.tsx`（AI 大纲生成入口）、`FreeDeckEditor.tsx`（单页智能排版）及死代码清理 | 新增 `documents/ai_deck_generator.py`（结构化大纲生成端点） |

---

## 六、关键技术风险与规避策略

1. **增量 Diff 与后端白名单校验强耦合**：
   - 现状：`store.py` 的 `validate_patch` 和 `_apply_page_action` 采用严格字段白名单，前端一旦新增样式字段而后端未放行，保存会直接报 `400`。
   - 规避：每个阶段扩展 schema 时，坚持**「先写前后端共享字段清单 + 后端 pytest 校验测试，再写前端编辑器 UI」**的顺序；并在 `diffDocuments` / `rebaseDocument` 中补齐文档级 `theme` 变更（新增 `page_action: { kind: 'document_theme', theme }`）。
2. **跨页粘贴图片与大文件保存体积**：
   - 现状：`routes_documents.py` 限制单次 `PATCH` 请求体不超过 8MB，而用户直接 `Ctrl+V` 贴入高清截图（PNG）可能单张就达 2~3MB。
   - 规避：前端粘贴/拖入图片时，自动使用 Canvas 压缩超过 1920px 的位图并按需转 WebP/JPEG（透明图保留 PNG），确保单张图片通常 `< 400KB`。
3. **分组（`group_id`）与撤销/重做、多选缩放的交互边界**：
   - 规避：采用扁平 `group_id` 而非嵌套容器；缩放组时直接复用 `canvasGestures.ts` 已验证的 `groupResize` 与 `rotateSelection`，零重写数学几何逻辑。
4. **PPTX 导出在 PowerPoint 与 WPS 双端兼容性**：
   - 规避：OpenXML 阴影、圆角、线性渐变与表格边框严格使用标准 `DrawingML` 标签（`a:lin`、`a:outerShdw`、`a:prstGeom`），避免私有扩展标签；每完成 P1/P2 即导出实测文件并在 WPS 与 PowerPoint 中人工核验。

---

## 七、分阶段验收标准

- **P0 验收**：
  - 在 `/living` 点击「新建演示文稿」可 1 秒内进入编辑态，无需上传任何文件。
  - 可切换 6 套主题并一键应用全册，母版页码/页脚正确显示且封面自动隐藏。
  - 可按 8 种版式插入新页；支持 `Ctrl+C/V/X` 跨页粘贴、系统剪贴板贴图、拖拽贴图、右键菜单、上移/下移一层、`Ctrl+G` 组合与取消组合、精准字号与有序列表。
  - `npm run typecheck` 通过，后端 `pytest` 覆盖新建空白课件、主题更新、组合与新字段校验。
- **P1 验收**：
  - 任意图形双击可直接输入与格式化文字；支持圆角、虚线边框、阴影、线性渐变。
  - 图片支持画布原位拖拽裁剪；表格支持双击单元格编辑与主题表头/斑马纹；图表支持柱/条/折/面/饼图切换；支持悬浮快捷条、格式刷与公式插板。
- **P2 验收**：
  - 放映态支持页面切换动效与全对象点击逐条显现（空格/方向键正反向推进准确）。
  - 从零设计的一份含「封面 + 图形卡片 + 渐变背景 + 表格 + 饼图 + 公式 + 定象坊沙盘」的课件，导出 `.pptx` 在 WPS/PowerPoint 打开版式还原度 ≥ 90%，导出离线 `.html` 断网打开功能完整。
