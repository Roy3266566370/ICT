# 象生项目优化与功能扩展技术交接清单
**Goal:** 基于现有 PPT 交互网页原型，先完善可靠性、AI 接口和现有交互，再扩展实验生成、反例搜索与求解，最后建设全新业务模块。
**Architecture:** 保留 React、FastAPI、iSpec、网页文档与四类确定性内核。新增功能通过版本化实验定义连接模型规划、受限计算、独立校验和现有视图。耗时任务进入队列，拖动与简单公式继续在浏览器执行。
**Tech Stack:** 现有 React 18、TypeScript、Vite、Zustand、FastAPI、SQLAlchemy、NumPy、SymPy、RapidOCR；按任务需要再引入 SciPy、Celery、Redis、NetworkX、React Flow 或领域求解器，版本必须兼容现有 Python 3.11 和 NumPy 1.26 环境。
**Spec:** 本轮用户要求及前述功能设计；已有产品边界参考 `README.md`、`docs/superpowers/specs/2026-11-02-intelligent-editable-deck-design.md`、`contracts/spec/ispec.schema.json`。本清单中的新接口、文件、模型和配置均为拟新增，不能当作现有实现。

## 使用方法与当前完成度

任务按“现有能力完善 A → 依托现有模块扩展 B → 从零建设模块 C”排序。排序表示复用程度；比赛优先级单独标记。云端建设虽然排在 C 类，但应从第一周并行启动，不能等所有 B 类任务结束。

- **P0：** 数据正确性、保存可靠性、AI 配置基础和比赛所需云端交付。
- **P1：** 本轮重点创新功能，优先完成矩阵领域的完整流程。
- **P2：** 在核心流程完成后选择实施的扩展。
- 所有复选框表示后续待办；当前已实现的基础在各任务中单列。
- 每项由技术负责人填写负责人、开始日期、完成日期、关联提交、测试记录与演示证据。每项独立验收后再进入依赖任务。

| 当前能力 | 已有基础 | 仍需补足 |
| --- | --- | --- |
| 上传与原页展示 | PPTX 上传、解析、渲染、演示网页 | 冷启动性能、失败恢复、不同部署环境稳定性 |
| 图表与公式交互 | 原生图表筛选、公式求值、矩阵交互 | 更可靠的识别、语义核对、跨页传播 |
| 编辑与保存 | 网页文档、自动保存、撤销重做、本机草稿 | 保存时序、刷新/关闭恢复、多窗口冲突验收 |
| 四类计算模板 | 矩阵、力、BFS、预算及独立校验 | 固定黄金输入覆盖、批量效果报告 |
| AI 接入 | MaasProvider、文本/图片请求、解析与降级 | 配置统一、可替换接口、调用状态、真实效果验证 |
| 跨页参数 | shared_key、名称/单位/类型匹配与冲突标记 | 概念身份、显式关联、材料级运行时 |
| 分享与导出 | 冻结分享、离线 HTML、参数读取 | 同版本一致性、工程备份、失败反馈 |
| 云端架构 | Docker 配置与 Windows 分离服务接口 | RDS、Redis、OBS、队列和真实云部署 |

最近一轮已观察基线：后端 241 项通过；独立前端单元测试 30 项通过；四模板黄金自检 17/17；类型检查及在线/离线构建通过。完整 `npm test` 在草稿恢复脚本处失败，不能写成全量通过。这些是检查记录，不替代实施人员交接时重新运行。

## 全局约束

- 不删除现有上传、演示、编辑、原文定位、保存、导出与分享流程。
- 用户文件与手工示例明确区分；新增实验条件不得伪装为 PPT 原文。
- 数学结果由确定性算法计算；模型负责理解、规划和解释。
- 模型输出经过结构、语义、范围、来源与运行检查；只执行已登记的操作与表达式。
- API 密钥只保存在后端环境变量或云端密钥配置中，不进入 `VITE_*`、日志、浏览器或版本库。
- 实验、参数、来源与材料归属绑定；新接口沿用会话、CSRF、Origin 与归属检查。
- 矩阵首版沿用 2×2 与既有参数范围；扩展维度或范围须同步更新契约、计算、控件和测试。
- 数值搜索未找到结果与数学无解分开报告；验证结论包含适用范围及数值容差。
- 新依赖按任务逐项引入；先验证 Python 3.11、Windows 转换与 Linux Worker 的兼容性。

## Review Focus

1. 缺失 API 配置、错误密钥、超时、限流和非 JSON 返回：必须明确显示状态，保留原生解析结果。归 A02。
2. 编辑后立刻刷新/关闭、断网、多窗口同字段修改：不得把未同步修改误报为已保存。归 A03。
3. 两页使用相同字母但指向不同实验：不能自动共享；用户解除关联后状态隔离。归 B05。
4. 奇异矩阵、表达式定义域错误、搜索超时：不得生成伪造结果或“已证明成立”。归 B03、B04。
5. 分享、导出、分支引用旧版本或缺失资源：不得混合读取不同修订。归 A06、B06。

## AI API 配置与接入约定

### 先接通配置，后替换真实值

技术人员先实现以下配置读取、协议适配、错误处理和受控响应测试。你之后只需在后端部署环境填入实际地址、模型和密钥，再执行真实服务验收。占位配置不代表已完成真实模型接入。

以下为**拟写入 `.env.example` 的示例**，本次没有修改任何现有 `.env` 或真实凭据：

```dotenv
# 暂时关闭真实联网，原生解析与手动交互继续可用。
LLM_PROVIDER=none
# OpenAI 兼容协议的根地址，不包含 /chat/completions。
LLM_BASE_URL=https://replace-me.example.invalid/v1
LLM_MODEL=REPLACE_WITH_MODEL_NAME
LLM_API_KEY=
LLM_TIMEOUT_S=60
# 当前含义：一份材料识别时允许调用模型的最大页数/次数预算，不能当作重试次数。
LLM_MAX_CALLS=3
```

配置替换说明：

| 配置 | 当前实现与目标 |
| --- | --- |
| `LLM_PROVIDER` | 当前 `none` 不调用、`maas` 选用现有 MaasProvider。`openai_compatible` 是 A02 拟新增别名，实施前不能直接填写后声称生效。 |
| `LLM_BASE_URL` | 现有客户端会追加 `/chat/completions`。填协议根地址，避免路径重复。 |
| `LLM_MODEL` | 填服务端认可的完整模型名；图片识别需要该模型支持图片输入。 |
| `LLM_API_KEY` | 后端实际密钥；示例保持空白，不覆盖已有真实值。 |
| `LLM_TIMEOUT_S` | 单次 HTTP 调用超时；材料总时限另行控制。 |
| `LLM_MAX_CALLS` | 保留现有识别预算语义；实验规划使用独立预算，避免相互挤占。 |

当前 `settings.py` 还保留 `ISEPC_LLM_*` 一组旧字段，部分注释和示例也沿用旧名称；实际 `build_provider()` 读取 `llm_*`。A02 必须统一文档，并明确旧字段兼容策略，不能保留两套互不生效的配置。

首版统一一个默认模型；文本与视觉模型确有不同需求时，再增加独立路由。拟新增 `LLM_MAX_RETRIES`（默认 1，表示首次之外最多再尝试一次）、`AI_PLAN_MAX_CALLS`（默认 2，包含一次结构修正机会）；这些不是当前已支持字段，应随 A02/B02 实现。

替换真实值时：暂停旧任务或记录其配置版本 → 更新后端环境 → 重启/刷新配置缓存 → 执行文本、图片与错误处理验收。非 OpenAI 兼容的服务需要新适配器，只改 URL 不足以兼容。

## A 类 现有能力完善

### A01 交接基线与测试结果整理

**优先级：P0。基础：已有测试、自检与验收记录。依赖：无。**

范围：`frontend/scripts/test-document.mjs`、`frontend/src/document/controller.ts`、`backend/tests/`、`frontend/src/**/*.test.ts`、`verify/`。

- [ ] 重新运行前后端测试、黄金自检、类型检查和生产构建，保留各命令独立退出码。
- [ ] 定位草稿恢复脚本立即读取 `persisted`、控制器延迟约 220ms 持久化之间的时序差异；先确认产品行为，再调整测试或实现，不能直接删断言。
- [ ] 测试等待真实持久化完成的可观察结果，避免仅依赖固定睡眠。
- [ ] 验收：完整前端测试命令恢复通过；失败用例有原因、修复与回归证据。继续区分“测试数、黄金输入数、材料数”。

### A02 AI API 配置统一与可替换适配

**优先级：P0。基础：已有 MaasProvider、NoopProvider 与请求/响应协议。依赖：无。**

修改：`backend/app/settings.py`、`backend/app/ispec/llm/{__init__,provider,maas}.py`、`.env.example`、`deploy/README.md`。按职责可新增 `backend/app/ai/client.py` 和 `backend/tests/ai/test_client.py`。

接口：提供统一的 `generate(request) -> response`；请求明确任务类型、文本、可选图片和输出约束；响应包含原文、实际模型、耗时、请求标识、可获得的用量和状态。识别层保留现有协议适配。

- [ ] 按上节实现配置；新增 `openai_compatible` 别名时仍兼容已有 `maas`，不覆盖真实配置。
- [ ] 旧字段仅在新字段未显式配置时提供兼容回退；显式新配置优先并提示旧字段弃用，不输出值。
- [ ] 支持文本与图片请求；结构化响应能力按模型实际支持启用，不假定所有接口支持同一参数。
- [ ] 为 401/403、429、超时、5xx、空内容与非 JSON 提供明确错误；只对可重试错误做有界重试。
- [ ] 输出“未配置、调用中、调用失败、已返回但未通过校验、已通过校验”等状态；不把 `available()` 当成真实连通性验证。
- [ ] 验收：占位值/无密钥时不联网，原生解析可用；受控 HTTP 响应测试覆盖上述异常；用户填真实值后完成一条文本和一条图片调用，保留脱敏记录。

### A03 自动保存与草稿恢复可靠性

**优先级：P0。基础：已有文档控制器、本机草稿、去抖保存、合并与冲突状态。依赖：A01。**

范围：`frontend/src/document/{controller,drafts,model}.ts`、`frontend/src/pages/FreeEditPage.tsx`、`frontend/src/components/editor/FreeDeckEditor.tsx`。

- [ ] 验证编辑后立即刷新、关闭页面、路由离开、请求失败与恢复联网；检查生命周期保存是否遗漏，不先认定已存在丢失缺陷。
- [ ] 区分“已保存到服务端”和“仅本机草稿”；离开前按生命周期设计尽力持久化，并定义浏览器无法保证写入时的恢复边界。
- [ ] 同字段冲突可选择恢复方式，不同字段合并保留双方修改。
- [ ] 验收：保存过程中继续编辑，最终结果包含最新输入；刷新可恢复未同步草稿；不同窗口的草稿不互相删除；界面状态与服务端实际修订一致。

### A04 识别来源与人工核对完善

**优先级：P0。基础：原生解析、OCR、模型候选、启发式与用户配置均已有入口。依赖：A02。**

范围：`backend/app/ispec/{builder,image_text,validator,user_config}.py`、`backend/app/ispec/llm/parse.py`、`frontend/src/pages/PreparePage.tsx`、`frontend/src/components/presentation/DeckPlayer.tsx`。

- [ ] 分开保存与展示原生提取、OCR、规则推断、模型推断、用户确认；不使用未经校准的百分比置信度。
- [ ] 候选绑定材料、页码、元素/节点、原文或图像区域；新实验假设独立标注。
- [ ] 允许修改识别内容、确认和重新提取；保留原始候选以便追踪纠正成本。
- [ ] 检查 `validator.py` 中 Schema 缺失会跳过校验的行为；可执行的新实验必须在校验器不可用时停止执行，原页阅读仍可用。
- [ ] 验收：原文不存在的引用被拒收；模型失败不删除原生结果；人工配置不计入自动识别成功率；内容修改后旧交互进入待核对。

### A05 编辑与交互状态一致性

**优先级：P0。基础：稳定 node_id、交互配置、热区与参数保存。依赖：A03、A04。**

范围：`backend/app/documents/`、`backend/app/ispec/node_interaction.py`、`frontend/src/document/`、`frontend/src/components/editor/`、`frontend/src/components/presentation/`。

- [ ] 移动、缩放、旋转对象后热区跟随；隐藏/删除后不残留可操作入口。
- [ ] 改字、公式或数据后只失效受影响的关系，未修改对象的参数保持。
- [ ] 编辑器、演示页、计算表和保存读取同一版本的输入；明确原稿条件与实验条件。
- [ ] 验收：改标题不改变其他对象；移动公式后点击区域正确；修改关系后不继续展示旧计算；撤销重做恢复一致状态。

### A06 分享与离线导出一致性

**优先级：P0。基础：冻结分享快照、单文件 HTML 与离线运行时。依赖：A03、A05。**

范围：`backend/app/api/routes_publish.py`、`backend/app/documents/presentation.py`、`frontend/src/components/presentation/`、`frontend/src/offline/main.tsx`。

- [ ] 分享与导出先确认输入和修订；存在保存失败、冲突、缺失资源时给出明确选择或阻止操作。
- [ ] 导出期间固定快照，不能混入稍后编辑；旧分享继续指向旧快照。
- [ ] 对耗时发布/导出记录执行状态，为 C04 异步化提供接口；不能依赖代理长连接无限等待。
- [ ] 验收：在线、分享、离线的同一实验输入和结果一致；断网打开离线 HTML 没有外部资源依赖；旧分享不随编辑静默改变。

### A07 四模板计算与来源验收补齐

**优先级：P0。基础：四内核、独立校验、17 组固定黄金输入。依赖：A01。**

范围：`fixtures/golden/`、`backend/tests/engines/`、`backend/app/validators/`、`backend/scripts/selftest.py`。

- [ ] 各模板补到至少 20 组明确输入与独立参考结果，合计不少于 80 组；按正常、边界、非法输入分类。
- [ ] 覆盖奇异矩阵、零合力方向、循环/不可达图、金额精度与表达式循环依赖。
- [ ] 明确校验器未覆盖项；不能用“所有已检查项通过”替代“全部结果有覆盖”。
- [ ] 验收：自动生成可复查报告，记录容差、环境、内核版本及未覆盖项。

### A08 真实材料性能与产品体验完善

**优先级：P1。基础：阶段进度、能力检测、原页预览与交互面板。依赖：A04。**

范围：`backend/app/api/routes_jobs.py`、`backend/app/render/`、`frontend/src/components/upload/`、`frontend/src/pages/PreparePage.tsx`、`verify/`。

- [ ] 分别记录解析、页图、OCR、模型、验证及整体耗时，区分冷缓存和热缓存。
- [ ] 明确“原页已可看”和“交互识别未完成”；进度、重试、取消或失败原因与后端状态一致。
- [ ] 用户界面把 category/series/value 等原始字段转换为可理解名称，保留原始数据来源说明。
- [ ] 验收：20 页代表材料核验原定 180 秒目标；限定交互核验 P95 150ms 目标；不达标填写实际结果与环境，不改统计口径。

## B 类 基于现有模块扩展

### B01 统一实验定义与执行底座

**优先级：P1。基础：已有 iSpec、表达式求值、模板、运行快照；实验编排模型需新增。依赖：A04、A07。**

拟新增：`contracts/spec/experiment.schema.json`、`backend/app/experiments/{schemas,registry,executor}.py`、`backend/app/api/routes_experiments.py`、`frontend/src/experiments/{types,store}.ts`、`backend/tests/experiments/test_executor.py`。

接口：`ExperimentSpec` 包含 `schema_version/material_id/source_revision/source_refs/variables/constraints/operations/views`；`ExperimentRun` 包含 `spec_revision/inputs/outputs/status/checks/kernel_versions/seed`。登记的操作先限 `set/sweep/compare/counterexample/solve/step`；不支持项明确拒绝。

- [ ] 先完成手工结构化定义创建实验、执行、保存、重开；不依赖模型即可验收。
- [ ] 每个操作登记入参、范围、执行器、输出和校验器；视图复用现有组件。
- [ ] 请求与材料会话归属绑定，实验定义版本与数值输入修订分开保存。
- [ ] 验收：合法矩阵扫描可运行；未知操作、越界参数、其他材料引用、非法表达式被拒绝；保存重开结果一致。

### B02 自然语言生成实验

**优先级：P1。基础：已有 AI 客户端、对象/来源与 iSpec；需新增规划模块和入口。依赖：A02、B01。**

拟新增：`backend/app/experiments/{retrieval,planner,prompts}.py`、`frontend/src/experiments/ExperimentComposer.tsx`、`backend/tests/experiments/test_planner.py`。

接口：`plan_experiment(material_id, instruction) -> ExperimentSpec候选或需澄清结果`；规划器仅引用当前材料允许使用的对象和能力。

- [ ] 基于标题、符号、对象类型与原文检索上下文；首版用关键词与规则匹配，记录命中来源。
- [ ] 模型输出版本化实验候选；执行结构、语义和来源检查，最多一次结构修正；仍不合法则返回原因。
- [ ] 展示关联原文、新增条件、变量范围与实验目的，用户可修改后执行。
- [ ] 验收：“观察接近不可逆”生成可运行的矩阵扫描；“比较先转再拉”生成两路径对照；材料不支持的要求明确说明；替换 API 配置不要求改业务页面。

### B03 自动反例搜索

**优先级：P1。基础：已有四类计算内核和验证器；搜索模块与命题模板需新增。依赖：B01，接自然语言入口再依赖 B02。**

拟新增：`backend/app/experiments/search/{schemas,enumerate,rank,verify}.py`、`frontend/src/experiments/CounterexampleView.tsx`、`backend/tests/experiments/test_counterexamples.py`。

接口：`search_counterexample(claim, domain, budget) -> status/witness/coverage/checks`。首版支持登记过的矩阵交换律与力合成命题，不接受任意自然语言定理直接执行。

- [ ] 先枚举小整数候选，再按“简单、差异明显、范围合法”排序；需要连续搜索时再引入 SciPy。
- [ ] 返回见证后用独立路径复核，并展示命题、输入、两侧结果与来源。
- [ ] 区分找到反例、有限范围穷举未发现、预算耗尽、超时、未知；未发现不等于证明。
- [ ] 验收：A=[[1,1],[0,1]]、B=[[1,0],[1,1]]、x=(1,1)，得到 ABx=(3,2)、BAx=(2,3)；界面顺序与数学定义一致。固定随机种子可复现。

### B04 逆向求解与目标拖动

**优先级：P1。基础：已有正向计算、参数边界与向量拖动；求解器新增。依赖：B01、A07。**

拟新增：`backend/app/experiments/solve/{schemas,linear,scalar,constrained,verify}.py`、`frontend/src/experiments/TargetSolvePanel.tsx`、`backend/tests/experiments/test_solve.py`。

接口：输入固定参数、未知变量、目标、边界及偏好；输出 `exact/approximate/infeasible/unknown/timeout`、解、残差、约束检查和算法说明。

- [ ] 线性问题使用现有 NumPy/SymPy；标量求根、最小二乘与约束优化按需要引入兼容版本 SciPy。
- [ ] 首版实现 Ax=y 求 x、公式求输入、预算人数边界；多解支持“相对当前输入变化最小”。
- [ ] 目标点拖动只预览，松手或确认后求解；候选解代回原内核验证。
- [ ] 验收：唯一解、多解、奇异矩阵、无解、近似解、越界与超时分别显示正确状态；数值求解失败不得标作已证明无解。

### B05 跨页参数关联与材料级同步

**优先级：P1。基础：已有 shared_key 和表达式拓扑求值；材料级依赖运行时需要扩展。依赖：A05、B01。**

范围：`backend/app/ispec/shared.py`、`frontend/src/ispec/evaluate.ts`；拟新增 `backend/app/experiments/relations.py`、`frontend/src/experiments/dependencyGraph.ts`、`frontend/src/experiments/RelationConfirmPanel.tsx`。

接口：关系包含 `entity_id/from/to/relation_type/source_refs/confirmation_status/revision`；首版计算依赖限定为无环图，关联关系与计算依赖分别存储。

- [ ] 用名称、单位、维度、定义和上下文生成候选；自动建议与用户确认分开。
- [ ] 确认后使用统一实体标识；允许解除关联。相同符号不自动视为相同实体。
- [ ] 只重算修改节点的后继，按拓扑顺序更新；检测循环，联立方程/动态反馈交给专门求解器。
- [ ] 验收：同一矩阵在向量、面积、椭圆页保持同步；两页不同 A 不误合并；解除关联后隔离；刷新保持用户确认的关系。

### B06 实验分支与结果比较

**优先级：P2。基础：已有快照、运行记录、基线对比和参数历史；持久化分支模型新增。依赖：B01、A06。**

拟新增：`backend/app/experiments/{history,branches}.py`、`frontend/src/experiments/BranchCompareView.tsx`、相关数据库模型和迁移、`backend/tests/experiments/test_replay.py`。

接口：分支记录 `parent_run_id/fork_revision/spec_snapshot/input_snapshot/events/versions/seed`；事件有稳定编号和顺序。

- [ ] 支持从已保存运行创建分支，并比较输入、模型条件和输出；首版不做分支合并。
- [ ] 拖动过程合并为一次有效操作；保存模型生成的结构化实验，不在重放时重新调用模型。
- [ ] 验收：A/B 分支输入与结果互不污染；可追溯父状态；版本不兼容明确提示；删除源材料时按资源保留策略处理。

### B07 可编辑工程备份与恢复

**优先级：P1。基础：已有网页文档、参数存储与离线导出；工程包格式与导入需新增。依赖：A03、A06，含实验时依赖 B01。**

拟新增：`backend/app/documents/{archive,restore}.py`、`frontend/src/experiments/ProjectBackupPanel.tsx`、备份接口与验证测试。

- [ ] 导出清单、版本化网页文档、参数、关系、实验定义和必要资源；禁止包含密钥、会话 Cookie 或服务器私有路径。
- [ ] 导入验证包格式、大小、解压路径、资源引用与版本；导入为当前会话的新材料，不直接沿用旧归属。
- [ ] 明确区分“离线演示 HTML”和“可继续编辑的工程备份”。
- [ ] 验收：更换浏览器或新会话后导入，可继续编辑与计算；缺失资源明确报错；包内无凭据。

## C 类 从零建设的新模块

### C01 自适应探究任务

**优先级：P2。基础：当前没有独立任务、学习过程与评价模型。依赖：B01、B04。**

拟新增：`backend/app/learning/{schemas,generator,evaluator,hints}.py`、`frontend/src/learning/`、任务与尝试数据表。

- [ ] 先通过求解器验证任务可完成，再组织题面；保存初始条件、允许操作、成功判据、提示和来源。
- [ ] 首版用规则与状态机判定数值目标；模型负责提示措辞，开放解释不自动给绝对正确性结论。
- [ ] 记录尝试、提示次数、完成状态；自适应先基于可观察表现，不宣称已准确测量理解能力。
- [ ] 验收：“面积翻倍且方向不变”可完成；满足面积但方向错误时给出对应提示；无解任务不发布。

### C02 可视化知识关系编辑器

**优先级：P2。基础：当前没有完整图编辑页面，B05 只提供关联与运行基础。依赖：B05。**

拟新增：`frontend/src/knowledge/`、`backend/app/knowledge/`；可选择 React Flow、NetworkX。

- [ ] 展示知识关联、来源和计算依赖；边类型清晰，不把文字相关性直接视为物理因果关系。
- [ ] 支持连接、断开、确认、回原页查看与版本保存。
- [ ] 验收：图上关系与实际运行一致；非法计算循环被阻止；修改关系有可追溯版本。

### C03 工程领域仿真案例

**优先级：P2。基础：当前四内核不包含管网或动态物理求解器。依赖：B01、B04及领域教师提供参考模型。**

拟新增：`backend/app/simulations/`、`frontend/src/simulations/`、领域数据契约、单位检查与参考样本。

- [ ] 选择一个案例：供水管网可评估 EPANET/WNTR，弹簧阻尼可用 SciPy `solve_ivp`，先确定物理假设。
- [ ] 定义节点/设备/参数/单位/边界条件；PPT 缺失参数要求用户补充并标明假设。
- [ ] 数值求解返回残差或守恒检查及收敛状态；可视化显示实际求解结果。
- [ ] 验收：与独立参考模型核对；单位错误、缺失参数、不收敛分别处理。供水模型不冒充石油多相流模型。

### C04 华为云部署与持久化任务系统

**优先级：P0，第一周即可与 A 类并行。基础：已有 Docker、SQLAlchemy、任务状态和 Windows 服务接口；真实云端服务集成需建设。依赖：A02、A03，实验接入依赖 B01。**

范围：`deploy/`、`backend/app/db/`、`backend/app/api/routes_jobs.py`、存储适配与迁移；拟新增 `backend/app/tasks/`、`backend/app/storage/`。

- [ ] ECS 部署 API/Worker；RDS 保存业务数据；DCS Redis 承担队列消息；OBS保存原件和资源，并为每个服务定义实际业务用途。
- [ ] SQLite→PostgreSQL 迁移检查同秒排序等 SQLite 特有实现，建立稳定序列/时间排序，不只替换 DATABASE_URL。
- [ ] 数据表加入迁移管理；任务设计幂等键、心跳/租约、失败原因、有限重试、恢复与取消策略，业务状态以持久化数据库为准。
- [ ] 上传识别、模型规划、批量搜索和耗时导出进入适合的队列；按任务类型设置时限，避免接口依赖长连接。
- [ ] Windows/Office 对象分离保留独立服务；Linux Worker 不直接调用本机 COM。配置能力检测、令牌与可达性。
- [ ] 验收：真实云端上传→交互→保存→重新打开；重启 Worker 后任务状态可恢复或明确失败；已有结果与资源不丢失；保留 CodeArts/Skills 实际开发、资源创建与部署证据。

### C05 真实材料与用户效果评测系统

**优先级：P0，样本收集与用户招募第一周开始。基础：已有合成语料脚本与验收记录；真实盲测与用户研究流程需建立。依赖：A07、A08；新功能评测依赖相应 B 类任务。**

拟新增：`fixtures/evaluation/`（仅放有权存放的材料或脱敏标注）、`verify/evaluation/`、批量评测脚本与用户任务记录表。

- [ ] 收集至少20份有授权的真实材料，按整份文件划分开发/留出集；固定留出集后不用于调参。
- [ ] 分别统计原生识别、OCR/规则、加入模型之后的效果，公开样本数、失败样本与人工修正量。
- [ ] 分别评估来源准确性、关联精确率/召回率、有效交互率与耗时，不能把 Schema 通过率当语义正确率。
- [ ] 邀请8—12名用户做交叉或平衡顺序任务，对比完成时间与正确率，记录提示与纠正次数。
- [ ] 验收：从逐份原始记录可复算汇总指标；30%提效、90%/85%关联目标等未达成时填写实际值；材料中区分已有结果、目标和计划。

## 建议接口与文件边界

以下均为拟新增接口；实施时沿用现有响应封装、错误码、鉴权和路由注册方式。

| 接口 | 作用 | 所属任务 |
| --- | --- | --- |
| `POST /api/v1/materials/{id}/experiments` | 从合法结构化定义创建实验 | B01 |
| `POST /api/v1/materials/{id}/experiment-plans` | 从自然语言创建规划任务 | B02 |
| `POST /api/v1/experiments/{id}/runs` | 执行指定版本及输入 | B01/B03/B04 |
| `GET /api/v1/experiment-runs/{id}` | 读取运行状态、结果与校验 | B01 |
| `PATCH /api/v1/materials/{id}/relations` | 确认、修改或解除关系 | B05 |
| `POST /api/v1/experiment-runs/{id}/branches` | 从运行创建分支 | B06 |
| `POST /api/v1/materials/{id}/project-export` | 创建工程备份导出任务 | B07 |

耗时请求返回任务标识，再读取状态；快速确定性运行可直接返回结果。AI规划、搜索和仿真不要混入现有 `ispec/builder.py` 形成单一巨型模块。

## 执行顺序与四周安排

建议技术负责人先分配三个工作包：①A类可靠性与接口；②B类实验创新；③C04/C05云端与效果证据。此处是人员分工建议，不表示本次已启动多个开发任务。

| 时间 | 主要工作 | 阶段验收 |
| --- | --- | --- |
| 11/4—11/8 | A01—A04，B01契约与手工实验原型；C04环境准备、C05样本收集并行 | 测试基线明确，AI占位配置可切换，手工实验可执行 |
| 11/9—11/15 | A05—A08，B02/B03；C04云端业务接通 | 一句话生成矩阵实验，反例可复核，云端可保存重开 |
| 11/16—11/22 | B04/B05，优先B07；按余量选择B06；C05效果验证 | 逆向求解、跨页同步、工程恢复有证据 |
| 11/23—11/26 | 关键缺陷修复、独立复现、材料与视频 | 已实现功能与申报文字、数据一致 |
| 11/27—11/29 | 功能冻结与内部提交 | 固定可复现版本及材料包 |
| 11/30—12/1 | 报名/提交状态复核与阻断问题缓冲 | 提交成功留存凭证 |

C01—C03为独立扩展包，按人员能力选择；四周计划不承诺七类新功能全部完成。先完成矩阵领域的端到端实验，再迁移一个力学或预算案例。不要通过削减正确性与来源检查换取演示数量。

## 每项任务的交付要求

- [ ] 负责人、关联任务、实际修改文件、依赖变更、数据迁移与配置项完整。
- [ ] 对新算法/状态转换先固定可验证输入和预期结果，再实施与回归；文档/文案调整只做相应检查。
- [ ] 关键功能有操作步骤、截图或视频、真实结果与失败边界。
- [ ] 业务效果与算法状态一致，原有流程回归通过；按任务分批提交，记录版本，准备回退方式。
- [ ] 填入真实 API 后另做真实服务验收，不能用测试响应或占位值宣布 AI 识别完成。

建议复核命令：后端 `py -3.11 -m pytest -q`；仓库根 `py -3.11 backend/scripts/selftest.py`；前端分别运行 `npm test`、`npm run typecheck`、`npm run build`。只对实际执行并读取退出码的命令标记通过。

## 技术参考

- 华为云 MaaS API：https://support.huaweicloud.com/intl/zh-cn/api-maas/api-maas-0002.html
- SymPy 求解：https://docs.sympy.org/latest/modules/solvers/solveset.html
- SciPy 求解与优化：https://docs.scipy.org/doc/scipy/reference/optimize.html
- NetworkX 依赖图：https://networkx.org/documentation/stable/reference/algorithms/dag.html
- React Flow 交互图：https://reactflow.dev/learn/concepts/adding-interactivity
- Celery 任务：https://docs.celeryq.dev/en/stable/userguide/tasks.html
- EPANET：https://www.epa.gov/water-research/epanet
- WNTR：https://usepa.github.io/WNTR/
