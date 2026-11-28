# 万象创造引擎：AI 智能计算方块与“我的世界”式搭积木架构方案

> **目标读者**：架构评审与负责分阶段落地的执行 Agent  
> **核心愿景**：打破“官方无休止手写学科模板”的瓶颈，让**任何老师和学生**都能像玩《我的世界（Minecraft）》红石电路一样，用**通用原子积木 + 自然语言驱动的 AI 智能计算方块**自由搭建任意学科的交互实验，并**一键搬上通文册 PPT 演播，断网也能纯本地跑真内核**。

---

## 一、 核心设计哲学：备课用 AI 造方块，上课断网跑真内核

| 角色 | 传统硬编码模板 | 万象创造引擎（本方案） |
| :--- | :--- | :--- |
| **内容供给** | 开发者逐个手写，永远补不完 | 用户用自然语言 + 通用积木自造，社区画廊 Fork 裂变 |
| **普通用户门槛** | 只能用现成模板，改不了逻辑 | 默认“说话”驱动 AI 生成规则方块，代码藏在折叠抽屉里 |
| **极客/开发者扩展** | 必须改主站源码并重新发版 | 打开规则抽屉直接精调纯函数，或框选封装为自定义积木 |
| **PPT 课堂演播** | 在线依赖或静态截图 | 一键挂载到通文册，导出单文件 HTML，**断网 60fps 本地重算** |

---

## 二、 整体技术架构（四层模型）

```
┌─────────────────────────────────────────────────────────────┐
│  L4 · 演播与生态层（通文册嵌入 / 单文件离线导出 / 公开画廊 Fork）  │
├─────────────────────────────────────────────────────────────┤
│  L3 · AI 搭子层（自然语言生成规则方块 / 增量追问修改 / 自动自检修复） │
├─────────────────────────────────────────────────────────────┤
│  L2 · 通用积木层（输入源 / AI 智能计算方块 / 通用舞台 / 子图封装）    │
├─────────────────────────────────────────────────────────────┤
│  L1 · 隔离计算沙箱（Web Worker + 超时熔断 + 统一 PipelineFrame 协议） │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、 核心模块详细设计

### 1. 统一数据协议（复用现有 `PipelineFrame`，零学习成本）
在 `frontend/src/canvas/types.ts` 中新增通用端口值与节点类型：
- **新增 `PortValue` 分支**：
  ```ts
  | {
      kind: 'customFrames';
      title: string;
      controls: RuleControlSpec[];
      result: PipelineResult; // 直接复用 lab408PipelineTypes.ts 中的 PipelineResult / PipelineFrame
      error?: string;
      elapsedMs?: number;
    }
  ```
- **新增 `NodeType`**：
  - `aiRuleBlock`：**AI 智能计算方块（核心）**——集“自然语言生成 + 动态参数控件 + 沙箱执行 + 折叠代码抽屉”于一体。
  - `universalStageView`：**通用多形态舞台方块**——消费 `customFrames`，自动根据帧内字段（`graph` / `series` / `timeline` / `rows`）切换或并排渲染图拓扑、曲线、甘特图、表格与结论卡，并在 `InstrumentStage` 主舞台自动挂载时间轴！
  - `customSubgraph`（阶段 3）：用户框选多个节点后折叠封装的自定义积木。

### 2. AI 智能计算方块（`aiRuleBlock`）数据结构
保存在 `CanvasNode.payload`（JSON 序列化字符串，天然兼容现有的作品保存、公开画廊、`.xsproj` 工程包与离线 HTML 导出，**无需改数据库表结构**）：

```ts
export interface AiRuleBlockPayload {
  version: 1;
  prompt: string;                // 用户原始自然语言描述
  title: string;                 // 方块标题（如“电梯磁盘调度 SCAN”）
  summary: string;               // 一句话原理与公式说明
  textLabel?: string;            // 可选序列/表达式输入标签
  defaultText?: string;          // 默认输入文本（如 "98,183,37,122,14"）
  controls: {                    // AI 生成的动态滑杆/下拉控件定义
    key: string;
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: number; label: string }[];
  }[];
  presets?: {                    // AI 同时生成 2~3 组教学情景预设
    label: string;
    text?: string;
    params: Record<string, number>;
  }[];
  preferredView: 'auto' | 'chart' | 'graph' | 'timeline' | 'table';
  code: string;                  // 纯函数体：function run({ text, params, upstream }) { ... return { data, frames }; }
  verificationNote?: string;     // AI 提供的手算核对算例，体现“可核对”原则
}
```

### 3. 安全隔离执行沙箱（`frontend/src/canvas/ruleSandbox.ts`）
**安全是第一红线**，用户分享的画布与离线包会在他人浏览器里运行，绝不能用主线程 `eval` / `new Function`：

1. **Web Worker 独立线程执行**：
   - 使用内联 Blob Worker（兼容离线单文件 HTML，无额外脚本路径依赖）。
   - Worker 启动时冻结并遮蔽全局敏感 API（`fetch`、`XMLHttpRequest`、`WebSocket`、`importScripts`、`indexedDB`、`BroadcastChannel` 全部置为 `undefined`）。
   - 仅向沙箱函数注入纯计算白名单参数：`{ text, params, upstream }` 与只读 `Math`。
2. **硬超时熔断 + 结果体量限制**：
   - 单次求值超过 **80ms** 立即 `worker.terminate()` 并重建 Worker，返回明确提示 `计算超时（可能存在死循环），请检查规则逻辑`。
   - 限制输出帧数 `frames.length <= 200`、单表行数 `<= 200`、节点数 `<= 120`，防止内存溢出卡死主线程。
3. **输出校验与降级**：
   - 主线程收到 Worker 返回值后，做严格的 schema 校验与 `NaN/Infinity` 清洗，再交由 `universalStageView` / `InstrumentStage` 渲染。

### 4. 后端 AI 生成与增量修改接口（`backend/app/api/routes_workshop.py`）
- **模型配置复用（无需新增 API Key）**：
  - 直接复用 `backend/app/settings.py` 中已配置的主力文本/结构化模型环境变量：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`、`LLM_TIMEOUT_S`、`LLM_JSON_SCHEMA`，通过现有的 `backend/app/structured_llm.py`（`complete_json`）发起结构化输出调用；**不额外引入第三套 AI 密钥配置**，也不占用视觉模型 `LIVING_FIGURE_VISION_*`。
  - 当本地未配置 `LLM_API_KEY` 时，接口返回明确的状态码与中文提示（`未配置主力模型 LLM_API_KEY，可展开下方代码抽屉手动编写规则`），不阻断手动编排与离线运行。
- 新增 1 个结构化生成接口 `POST /api/v1/workshop/ai-rule-block`：
- **请求体**：
  - `prompt: string`（用户一句话需求，如“演示 B 树 3 阶插入分裂”或增量指令“再加一个初始方向开关”）
  - `current_payload?: AiRuleBlockPayload`（用于对话式增量修改）
  - `last_error?: string`（用于前端沙箱试跑失败后的自动静默修复重试，最多 2 次）
  - `upstream_hints?: string[]`（上游已连线节点的端口类型提示，如 `scalar` / `function` / `algoData`）
- **响应体**：严格符合 `AiRuleBlockPayload` JSON Schema。
- **System Prompt 约束**：
  - 禁止使用任何 DOM、网络、定时器、异步 `async/await`、`eval`；
  - 必须编写纯同步确定性计算逻辑，输出 `frames` 至少 2 帧（逐帧演进过程），每帧带清晰的中文 `title` 与 `summary`；
  - 必须附带 2~3 组有教学对比意义的 `presets` 和 1 条 `verificationNote`（手算核对说明）。

### 5. 前端交互体验设计（对不会代码的人极度友好）
- **节点默认视图（画布态）**：
  - 顶部：自然语言输入框 + 「AI 生成 / 修改规则」按钮（支持多轮对话微调）；
  - 中部：AI 自动生成的动态滑杆 / 下拉选项 / 序列输入框 + 情景预设胶囊；
  - 底部：运行状态条（如 `✓ 12 帧 · 1.4ms`）+ 默认折叠的 `<details>查看/编辑规则代码</details>` 抽屉（极客可手改并点「应用并校验」）。
- **生成即自检流程**：
  1. 用户点击生成 → 请求后端拿到 `AiRuleBlockPayload`；
  2. 前端**静默在 Web Worker 沙箱里用默认参数 + 每个预设各试跑一次**；
  3. 若沙箱报错或超时，自动带 `last_error` 回传后端静默修复（最多 2 轮），成功后再一次性呈现给用户。
- **一键搬上通文册**：
  - 只要画布里有 `aiRuleBlock` 或 `universalStageView`，在现有「保存作品 / 发布」流程下无需任何额外适配——用户在通文册中点击「插入工坊作品」，选择自己保存的作品即可直接嵌入幻灯片；
  - `InstrumentStage.tsx` 自动读取 `aiRuleBlock` 的 `controls`、`presets`、`summary` 与 `frames`，完整呈现精密控制舱、情景预设按钮与时间轴；
  - 导出单文件离线 HTML 时，`CanvasNode.payload` 中的纯函数与内联 Worker 一同打包，**教室断网零延迟运行**。

---

## 四、 分阶段实施路线图（建议按里程碑推进）

### 阶段 1：沙箱底座 + AI 智能计算方块 MVP（核心闭环，最先落地）
- [ ] **后端**：在 `routes_workshop.py` 新增 `POST /api/v1/workshop/ai-rule-block`，定义 Pydantic Schema 与受限 Prompt。
- [ ] **前端沙箱**：新建 `frontend/src/canvas/ruleSandbox.ts`（Blob Web Worker + 80ms 超时熔断 + 输出校验）。
- [ ] **前端节点与引擎**：
  - 在 `types.ts`、`engine.ts`、`nodes.tsx` 注册 `aiRuleBlock` 与 `universalStageView`；
  - 新建 `frontend/src/canvas/AiRuleBlockNode.tsx`（自然语言输入 + 动态控件 + 折叠代码抽屉 + 试跑自动修复）；
  - 在 `InstrumentStage.tsx` 接入 `customFrames` 端口值，支持主舞台渲染、控制舱参数与时间轴播放。
- [ ] **验证**：用自然语言在画布里生成 3 个跨学科实验（如“电梯磁盘调度”“凯恩斯乘数”“冒泡排序步进”），确认无需改源码即可运行并嵌入通文册。

### 阶段 2：AI 一键搭建整张画布（“红石搭子”）
- [ ] 在工坊新建空白画布顶部提供 **「AI 搭积木草图」** 入口：用户输入主题后，AI 自动摆放 `slider / functionSource / aiRuleBlock / universalStageView / textNote` 并自动连线排版（复用 `applyAutoLayout`）。
- [ ] 允许用户像玩积木一样自由删改节点、追加第二块对比视图。

### 阶段 3：框选封装自制积木 + 活页直选公开画廊（生态正循环）
- [ ] 画布支持框选多个节点 → 「封装为自定义积木」（折叠为 `customSubgraph`，存入个人空间并在左侧工具箱复用）。
- [ ] 通文册的「插入工坊插件」弹窗增加 **「我的工坊作品」** 与 **「公开画廊」** 两个 Tab，支持一键把社区或自己搭的积木搬进 PPT。

---

## 五、 测试与安全验收清单

1. **沙箱安全测试（`frontend/src/canvas/ruleSandbox.test.ts`）**：
   - 死循环 `while(true){}` 必须在 100ms 内被强制熔断，主线程不卡顿；
   - 尝试访问 `fetch` / `window` / `document` / `localStorage` 必须被拦截并报错；
   - 超大输出（如返回 10000 帧）必须被截断保护。
2. **契约与离线包测试**：
   - 含 `aiRuleBlock` 的画布导出为单文件离线 HTML 后，在断网环境下打开，拖动滑杆与切换预设仍能实时重算并更新画面。
3. **前端构建检查**：
   - `npm run typecheck`、`npx vite build` 与 `npm run build:offline` 全部通过。
