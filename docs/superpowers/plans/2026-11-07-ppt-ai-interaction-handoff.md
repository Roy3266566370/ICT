# 象生 PPT 智能交互增强技术实施任务书 / Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 本文件本次用于交给技术人员实施；编写文档不代表已经实施或验收其中功能。

**Goal：**让用户上传的 PPT 自动形成与原稿内容对应、可以计算和探索的交互网页，支持补充实验、跨页连续模型、目标反求及自动验收。

**Architecture：**保留现有 PPT 解析、原页阅读、自由编辑、iSpec 和在线/离线运行时。在其上新增 PPT AI 领域模块，负责区域识别、交互规划、语义关系、不可变实验分支和验收；AI 提交候选，计算内核与契约校验决定能否执行。专用视图生成作为隔离的试验能力。

**Tech Stack：**Python 3.11、FastAPI、Pydantic、SQLAlchemy、现有 NumPy/SymPy、React 18、TypeScript、Vite、现有 SVG/图表运行时。复用华为云 MaaS V2 和项目后端凭据；浏览器验收建议使用 Playwright。新增依赖须记录用途和版本。

**Spec：**本文第 1—12 节为本次需求与设计依据；第 13 节为实施任务；第 14—16 节为交付、排期与参考资料。代码路径以项目根目录为基准。编制日期：2026-11-07。

## 1. 范围与明确排除项

### 1.1 本次必须覆盖的五项功能

| 原建议编号 | 功能 | 本次要求 |
| --- | --- | --- |
| 1 | AI 设计每页适合的交互 | 分析区域内容、学习问题、可调参数、可用视图，形成可修改、可采用的规划 |
| 2 | 静态图重建为交互对象 | 从图、公式和上下文恢复可计算关系；包含可开关的专用视图生成试验 |
| 4 | 围绕追问生成补充实验 | 创建对照、反例、边界和敏感性实验，保留原稿与原实验 |
| 5 | 跨页连续模型与反向求解 | 建立经核对的概念身份和依赖，支持参数联动、目标反求 |
| 6 | 自动试玩、检查与局部修复 | 规则校验、浏览器操作、在线/离线一致性、有限次数修复 |

### 1.2 本次不做的第 3 项

**暂不建设“通过自然语言直接操作当前画布”的通用入口。**

- 不新增“把当前参数改成某数”“跳到第几步”“拖动某对象”的聊天命令解析器。
- 不让模型返回可以直接修改当前文档、当前参数池或播放状态的任意动作。
- 保留现有滑杆、输入框、拖动、播放、编辑、撤销等人工操作。
- 允许用户输入一个问题，以“生成补充实验”按钮建立新的实验草案；这属于第 4 项。
- 新实验只有在核对并点击“打开实验”后才进入独立分支，不改变原实验。
- 目标反求使用结构化目标/约束表单；首版不做通用自然语言控制。
- 当前题目实验室已有助手与命令相关代码，保持其原行为；不得以复用为由把这些命令接入 PPT 画布。

### 1.3 与此前“上传题目”功能的关系

本文件只规划 PPT 转网页增强，不重新实施 PDF/图片题目上传。当前已出现的题目实验室可提供求解器、轨迹、题目状态等复用基础，但 PPT 的页码、对象、布局、发布与编辑生命周期必须独立适配。

## 2. 当前代码基线与复用位置

本节为 2026-11-07 的静态代码核对结果，不代表所有路径已端到端验收。实施人员接手后先核对工作区的新改动，不覆盖其他正在进行的开发。

| 模块 | 当前已看到的实现 | 本次处理 |
| --- | --- | --- |
| PPT 原生解析 | `backend/app/parsers/pptx_parser.py`、`candidates.py` | 复用文字、图表、表格、公式与元素定位 |
| 交互识别 | `backend/app/ispec/builder.py` | 当前存在“页已有 iSpec 就跳过模型补识别”的门控；改为区域覆盖判断 |
| 模型传输 | `backend/app/ispec/llm/maas.py`、`provider.py` | 复用凭据与传输方式；当前提示词面向 iSpec，需支持分任务契约 |
| 生成契约 | `contracts/spec/ispec.schema.json`、`llm/prompt.py`、`llm/parse.py` | 保持旧 iSpec；新规划、关系和实验使用独立严格 Schema |
| 当前网页文档 | `backend/app/documents/store.py`、`importer.py`、`presentation.py` | 复用稳定 node_id、内容读取、增量编辑和快照；不绕过已有版本检查 |
| 图形场景 | `scene_definitions.py`、`advanced_scenes.py`、`frontend/src/components/experiments/` | 用适配器复用现有矩阵、几何、步骤与数值计算 |
| 题目实验室 | `backend/app/labs/solvers.py`、`frontend/src/labs/compute.ts`、`frontend/src/labs/types.ts` | 已有微积分、梯度下降、BFS、小型 MLP 等计算/轨迹；先核对接口再封装复用 |
| 题目 AI | `backend/app/labs/ai.py` | 有独立启用开关；不要让 PPT 功能依赖其 LAB_AI_ENABLED 开关 |
| 跨页共享 | `backend/app/ispec/shared.py`、`frontend/src/components/reader/sharedParamPool.ts` | 已有标签/单位/类型共享池基础；本次增加概念身份和依赖，不重复做一个互不关联的池 |
| 参数保存 | `backend/app/api/routes_ispec_values.py` | 既有接口使用 expected_updated_at；不要误写成已有 branch_revision |
| 文档编辑 | `backend/app/api/routes_documents.py`、`frontend/src/document/controller.ts` | 已有 expected_revision、operation_id、撤销与草稿机制 |
| 演示运行时 | `DeckPlayer.tsx`、`ExperimentStage.tsx`、`primitiveRouter.ts` | 新规划与实验接入现有容器，不另建一套整稿播放器 |
| 发布与离线 | `backend/app/api/routes_publish.py`、`backend/app/offline.py`、`frontend/src/offline/main.tsx` | 必须冻结新模型、分支、资源和报告，继续复用统一运行时 |
| 账号与数据库 | `backend/app/accounts/`、`db/account_models.py`、`backend/alembic/` | 当前已有相关开发；新增表通过实际 migration head 演进，不硬编码迁移序号 |
| 归属与写校验 | `backend/app/api/__init__.py` | 当前 PPT 使用 SessionDep、WriteDep、owned_material；沿用并与账号开发协调 |

重要事实：

1. 现有 API 可调用，不等于整份陌生 PPT 的语义识别已通过验收。
2. 已有某个示例画布，不等于上传 PPT 可以自动生成该画布。
3. 当前安装声明中已有 SymPy、PDF/OCR 和 three 等依赖；依赖存在不等于 PPT 已具备通用三维重建能力。
4. 新增模块不得把样本文件名、页码或固定标题作为正常业务分派条件。

## 3. 全局约束 / Global Constraints

1. 正式执行路径保留“受限规格 + 登记算子 + 确定性计算”，不在主页面执行 AI 提交的任意脚本。
2. 原稿事实、OCR 提取、模型推断、用户核对、补充实验条件分别记录；用户核对不改变最初来源。
3. 不确定内容可提出候选或补充模型，不得伪造原文摘录或原稿中的数值。
4. 页面是否已有一个交互对象，不再决定其他区域是否需要识别。
5. 当前编辑内容优先于历史上传缓存；内容未变时允许复用缓存。
6. 新 AI 结果只挂载到其对应的内容版本；旧请求不能覆盖新编辑。
7. 布局移动保留对象身份；语义内容改变只使受影响的关系与结果失效。
8. 原稿基线、当前探索、补充实验是不同状态；创建分支不修改基线。
9. 图、公式、指标、解释和保存均绑定同一次求值与版本。
10. 新读接口无生成副作用；生成、重试、修复、应用均使用显式写接口。
11. 所有私有操作走现有归属、Origin、CSRF 校验；公开分享只读取冻结的公开投影。
12. API Key 只保存在后端环境配置中；不进入文档、日志、浏览器、离线包或示例请求。
13. 本文件中的接口、表名和配置名是拟新增约定，不得表述为现有端点。
14. 本轮仅交付计划；未实际新增业务代码、执行数据库迁移或发起云资源创建。

## 4. 用户流程与正式运行方式

### 4.1 上传与交互规划

1. 保持原页优先可读，后台提取原生对象并建立区域覆盖表。
2. AI 对未覆盖或含义不明确的区域提出关系和交互候选。
3. 规划面板展示：区域位置、原文依据、学习问题、可调整参数、将生成的视图、待核对项。
4. 用户可以采用、跳过、编辑范围/初值或补充条件；先准备可用区域，不要求整稿一次全部成功。
5. 采用后编译为可执行规格并检查，再进入现有阅读/实验/演示状态。

### 4.2 追问与补充实验

1. 用户选择一个或多个原稿区域，输入“想验证的问题”。
2. 系统返回新的实验草案：目标、依据、补充条件、比较维度、搜索范围。
3. 用户核对后生成独立实验；原稿与原实验保持可恢复。
4. 新实验支持原有人工控件；本次不引入自然语言直接操控。
5. 结果可保存、重开、分享；离线包中不提供新的模型调用。

### 4.3 跨页探索与目标反求

1. AI 提出属于同一概念的跨页引用及计算依赖，用户确认有歧义的合并。
2. 同一分支内使用一个权威参数状态，各页从该状态读取。
3. 用户通过目标表单选择输出、目标值、允许变化的变量、约束与求解范围。
4. 求解器返回候选或明确终态，用户选择后建立结果分支；不自动改写原稿文字。

## 5. 公共数据与持久化契约

### 5.1 新领域模型

新建 `backend/app/ppt_ai/` 与 `frontend/src/ppt-ai/`。以 `ppt-ai.1` 标识外层契约，旧 iSpec 仍为 `1.0`；禁止把新字段随意塞进旧 Schema。

原稿提取仍使用现有 `parse_ispecs` 的证据规则。补充实验使用独立契约，不能通过放宽原文核验规则实现。适配器可以复用旧视图，但来源与条件标签必须从新 Provenance 读取；无法忠实表达的新模型保留在外层模型/视图适配中，不伪造旧 iSpec 的摘录或“原文提取”状态。

| 对象 | 必需字段与语义 |
| --- | --- |
| SourceAnchor | material/page/node/element 引用、归一化 bbox、摘录、来源版本、semantic_content_hash |
| Provenance | origin_type、原始证据、推断说明、用户核对记录；origin_type 为 native/ocr/model_inference/user_input/supplement/teaching |
| Region | region_id、page_no、node_ids、bbox、category、extraction_state、evidence、issues、semantic_content_hash |
| ModelNode | concept_id、变量名、类型、单位、维度、定义域、默认值、来源与语义角色 |
| ModelRelation | relation_id、类型、输入输出 concept_id、受限表达式或 operator_id、来源、核对状态 |
| InteractionPlan | plan_id、plan_revision、目标区域、问题/目的、参数与范围、视图、绑定、支持状态、依赖的来源哈希 |
| InteractionBundle | bundle_id、bundle_revision、schema_version、source_revision、registry_version、已采用规划、语义图、可执行规格及资源引用；内容不可变 |
| Experiment | experiment_id、parent_bundle_id、来源分支版本、question、recipe_id、补充条件、目标/范围、结果引用 |
| BranchState | branch_id、bundle_id、revision、canonical_values、运行快照引用、更新时间 |
| GeneratedViewArtifact | artifact_id、内容哈希、view_contract_version、资源列表、支持的交互、离线能力、验收状态 |
| ValidationReport | report_id、被测 bundle/branch/artifact 哈希、内核和运行时版本、规则结果、语义待核对项、浏览器证据及修复记录 |
| PptAITask | task_id、归属材料/会话、kind、status、stage、幂等键、输入版本、预算消耗、结果引用、错误与重试信息 |

所有模型均做类型、字段白名单、长度和引用完整性校验。原始模型回复进入受鉴权的诊断记录，不作为可执行产物。

### 5.2 定位与版本

- bbox 使用相对于原始页面的 0—1 坐标；裁剪像素坐标、PPT 原生坐标、网页坐标的转换集中管理。
- node_id 保持现有稳定身份；移动对象后，热区通过当前节点几何变换重新定位。
- semantic_content_hash 包含文本/公式/数据/关系等语义内容，不包含纯位置、颜色与缩放。
- 缓存键包含内容哈希、模型 ID、提示词版本、Schema 版本和能力注册表版本；不得只用文件名或页码。
- 新 bundle 绑定不可变来源快照。新编辑到达后比较哈希：布局变化更新定位，内容变化标记受影响对象待更新。
- 生成完成时输入已过期，任务标为 superseded；保留可审查产物，不自动挂载。
- 发布必须读取一个选定的完整 bundle 和匹配的文档/分支快照，禁止分别读取“各表最新一条”进行拼接。

### 5.3 建议新增表

在 SQLAlchemy 模型与实际 Alembic head 上新增：

- `ppt_ai_tasks`：任务、输入版本、stage、幂等键、租约/心跳、预算与结果。
- `ppt_ai_bundles`：不可变规划/模型/规格快照，material_id、bundle_revision、content_hash。
- `ppt_ai_branches`：bundle_id、branch_id、revision、状态与最近一次求值。
- `ppt_ai_experiments`：问题、recipe、补充条件、搜索范围、结果与所属分支。
- `ppt_ai_artifacts`：产物哈希、受控资源 key、隔离策略和验收报告引用。
- `ppt_ai_validation_reports`：不可变检查报告及其被测版本。

表的 material/session 归属通过现有材料校验取得，不相信请求体自报的 owner。唯一约束至少覆盖“归属 + kind + operation_id”和“material + bundle_revision”。

跨页参数一次变更在同一数据库事务中增加一个 branch_revision；所有依赖视图读取该版本。旧参数保存接口保持兼容，不能假定它本来已有分支事务能力。

### 5.4 公共服务接口

以下签名是开发约定，返回对象对应本节模型；各任务不得自行改名。

- `extract_regions(snapshot: SourceSnapshot) -> RegionExtractionResult`
- `plan_interactions(regions: list[Region], graph: SemanticGraph, budget: CallBudget) -> InteractionPlan`
- `compile_plan(plan: InteractionPlan, registry: CapabilityRegistry) -> CompiledBundle`
- `evaluate_model(bundle: CompiledBundle, values: CanonicalValues) -> EvaluationSnapshot`
- `confirm_links(bundle: InteractionBundle, decisions: list[LinkDecision]) -> SemanticGraph`
- `generate_experiment(request: ExperimentRequest, source: FrozenContext) -> ExperimentDraft`
- `run_experiment(draft: ExperimentDraft, registry: CapabilityRegistry) -> ExperimentResult`
- `solve_target(request: TargetRequest, context: FrozenContext) -> TargetResult`
- `validate_bundle(bundle: CompiledBundle, cases: list[ValidationCase]) -> ValidationReport`
- `freeze_interactions(material_id: str, bundle_id: str, branch_id: str, expected_revision: int) -> FrozenInteractionSnapshot`

EvaluationSnapshot 至少包含输入值、派生量、轨迹、约束检查、异常状态、模型/内核版本与求值哈希。AI 解释引用该哈希，不能另行编造数值。

### 5.5 公共签名所用类型的最小定义

类型集中放在 T01 的 types 文件和对应 Schema 的 definitions 中；禁止接口实现时换成无法校验的自由字典。

| 类型 | 最小结构 |
| --- | --- |
| SourceSnapshot | material_id、document_revision、source_hash、pages、当前 scene_document；未创建网页文档时使用解析快照及其版本 |
| RegionExtractionResult | regions、覆盖表、坐标转换元数据、问题列表、使用的 source_hash |
| SemanticGraph | nodes: ModelNode[]、relations: ModelRelation[]、候选关联、已确认关联、冲突及 graph_revision |
| CallBudget | max_calls、used_calls、deadline、request_bytes_limit、output_tokens_limit；后端持久化消耗，用户不能自报已用次数 |
| CapabilityRegistry | 以 operator_id 索引的输入/输出契约、求值与检查实现、版本、允许视图、offline_supported |
| CompiledBundle | InteractionBundle、执行节点/顺序、适配后的 iSpec/Lab 模型投影、资源哈希、编译检查结果 |
| CanonicalValues | concept_id → number/boolean/string；数组或矩阵用有维度约束的受控值类型，不能拼成待执行代码 |
| EvaluationSnapshot | input_hash、evaluation_hash、branch_revision、values、derived、trace、checks、violations、stop_reason、kernel_version |
| LinkDecision | candidate_id、decision(confirm/reject/split)、选定 concept_id 或新概念定义、预期 graph_revision、核对说明 |
| FrozenContext | bundle_id、bundle_revision、branch_id、branch_revision、选中区域/概念、values、evaluation_hash、必要来源投影 |
| ExperimentRequest | question、recipe_hint（可空）、selection、allowed_variables、ranges、expected_branch_revision、operation_id |
| ExperimentDraft | draft_id、recipe_id、FrozenContext 引用、原条件、补充条件、候选路径、目标谓词、搜索范围、停止规则、待核对项 |
| ExperimentResult | status、使用范围/候选数、每条路径的输入/结果/轨迹、见证样例（若有）、新分支引用、checks、结果哈希 |
| TargetRequest | FrozenContext 引用、目标输出与值、可改变量、固定值、约束、范围、容差、最大迭代数、operation_id |
| TargetResult | status、候选解、采用的求解方法、约束/残差检查、搜索范围、停止原因、候选分支引用 |
| ValidationCase | case_id、被测对象、固定输入、动作序列、预期性质/参考输出、容差和证据要求 |
| FrozenInteractionSnapshot | 匹配的文档、bundle、branch、experiments、公开来源、验收报告摘要、算子版本、资源及哈希清单 |

ViewAST 首版至少定义 group、text、point、line、polyline、rect、circle、axes、curve、heatmap 和受控的 scene3d 引用；每个节点有唯一 id、有限数值几何、白名单样式及已登记绑定。三维引用只能调用可信渲染器；坐标、几何、资源和总节点数均校验。

人工事件描述仅允许登记的 set_parameter、seek、select 等行为，绑定存在的参数/时间轴；不得包含脚本正文。它们由可信运行时响应用户输入，不是本次排除的自然语言画布命令。

数值检查统一采用可配置的绝对/相对容差，初始建议 atol=1e-8、rtol=1e-6；结果包含实际容差。目标求解默认最大 200 次迭代，返回残差和停止原因，不通过四舍五入掩盖不满足约束的结果。

## 6. 功能 A：AI 交互规划与区域级识别

### 6.1 识别链路

1. 原生提取优先：读取当前文档中的文字、OMML、表格、图表、组合和连接关系。
2. 建立区域覆盖表：区分原生已覆盖、OCR 已覆盖、需要视觉理解、需要人工核对。
3. 利用布局与明确引用形成区域组，例如“公式 + 图示 + 图注”。整页图只提供必要上下文，视觉输入优先采用局部裁剪。
4. AI 输出区域语义、候选变量/关系、证据引用和未确定项；随后由规划器选择交互方案。
5. Schema、来源和能力注册表分别检查，不能把 HTTP 200 或模型自报置信度当成可用结论。
6. 模型失败保留原生结果；允许仅重新识别指定区域。

### 6.2 规划输出

每个方案至少回答：

- 当前内容想说明什么，用户可以验证什么问题。
- 可以修改哪些参数，初值/范围/步长依据是什么。
- 哪些结果由哪个算子计算；图、公式、表和结论如何绑定。
- 使用原位覆盖、独立实验，还是多个视图组合。
- 哪些数据来自原稿，哪些是新增实验条件。
- 当前状态为 supported、needs_review、explanation_only 或 unsupported；缺少哪个能力。

首批模式建议：函数与积分探索、二维矩阵/几何、有限步骤过程、数据筛选/对照、梯度下降轨迹、小型网络计算流。使用当前可核对的能力，不根据学科名称直接套固定数据。

### 6.3 能力注册表与编译

新增统一登记：operator_id、输入类型/维度、参数约束、求值器、轨迹结构、可用视图、性质检查、在线/离线能力。

现有 iSpec 模式走兼容适配；需要题目求解器时封装现有 `solve_problem` / `evaluate_problem` 与前端 `computeLab`，不让 PPT 组件直接依赖整套 LabDocument。

编译前展开隐式默认值、检查符号和引用、检测不允许的依赖环、验证单位/维度与定义域。表达式使用受限解析器；不能为了表达式支持直接开放 eval。

新 AI 执行路径必须严格拒绝未校验内容：Schema/校验器/能力注册表缺失或加载失败时，返回明确不可用状态并保留原页。当前 `ispec/validator.py` 存在校验依赖不可用时记录警告并跳过的路径；新编译器不能把该路径返回的空错误列表当作“已通过校验”。应检查校验器可用性及实际 Schema 版本。

## 7. 功能 B：静态图重建与专用视图

### 7.1 正式重建路径

先恢复“图在表达什么”，再恢复外观：

1. 识别图元：坐标轴、点、线、箭头、节点、连边、标签、曲线和分组。
2. 识别约束：连接、映射、顺序、数据字段、公式绑定，区分装饰图形。
3. 以原稿明确数值建立模型；只能估读的点或曲线标为近似，不把像素拟合当作原始数据。
4. 图元、参数、计算模型建立显式绑定，生成可交互视图。
5. 支持在来源图与重建图之间切换核对；只替换用户采用的区域。

原位显示必须与当前网页节点位置对齐；无法可靠恢复外观或区域过密时进入独立实验，并保留来源对照。不得抹掉文字、删除原图后放一个与内容无关的示例。

重建案例：

| 内容 | 重建要求 |
| --- | --- |
| 函数/积分图 | 以已识别表达式采样，显示定义域断点、积分区间或切线；原稿没给表达式时不凭曲线外观断言唯一函数 |
| 矩阵/几何 | 使用原稿矩阵和向量；特殊/奇异情形有明确计算状态 |
| 算法流程/图 | 从明确流程和输入生成轨迹；箭头本身不足以证明是 BFS 等某个算法 |
| 神经网络图 | 恢复层连接与维度；缺权重时只做结构讲解或核对后的教学小模型 |
| 优化轨迹 | 目标函数、梯度、初值和方法均有依据；原图片上的轨迹不直接当作可重放的真实日志 |

### 7.2 生成专用视图的两层方案

**第一层：正式发布采用声明式视图。**AI 输出 ViewAST，自由组合图形、标注、网格、坐标、曲线、热力图、时间线和受控交互描述。由可信 React/SVG/Three 组件绘制。

**第二层：可开关的试验性视图程序。**当声明式布局不足时，AI 可提交独立视图程序，读取经过筛选的计算结果并返回 ViewAST；程序本身不直接访问主页面 DOM，也不承担数学结果的权威计算。必须完成 T09 的隔离与验收后，才可在试验环境启用。

这项试验仍是本次任务，不得只写一个占位按钮。可验收交付是：一个确有必要的专用视图、可运行的隔离链路、违规产物阻断、超时终止与可信降级视图。公开启用须满足实际隔离能力，不能把普通 iframe 宣称为完整安全边界。

### 7.3 隔离协议

- 主应用不得加载模型生成的 script、HTML、React 模块或任意 SVG 字符串。
- 试验程序在无主应用凭据的 opaque-origin sandbox iframe 内，经专用 Worker 执行；只输出经过白名单校验的 ViewAST。
- sandbox 只授予必要的脚本能力，不同时开放 allow-same-origin；不授予表单、顶层导航、弹窗或下载权限。
- Worker 不获得 Cookie、Token、API Key、原始整稿或任意资源读取接口；输入只含该视图需要的参数和计算投影。
- CSP、Worker 加载和网络策略必须共同验证；仅设置 connect-src 不能证明所有外发渠道均被阻断。
- 消息检查 event.source、每次实例的随机 nonce、artifact_id、协议版本、输入 revision、类型、大小与频率。opaque origin 的 origin 可能为 null，不能仅靠 origin 放行。
- 子环境提交的值变化请求只来自明确人工事件，且必须经过父层参数范围/类型检查；不接受模型文本命令。
- ViewAST 禁止事件脚本、foreignObject、任意 URL、HTML 注入和未经登记的资源引用；文字做转义。
- Worker 单次渲染建议超时 200ms、单个 AST 不超过 2,000 节点、消息不超过 256KB。超时由主线程终止 Worker并回退；这些是拟定可配置上限，必须实测。
- iframe 不提供 CPU/内存硬配额。浏览器验收需在独立进程/容器中设总时限及资源限制；实际无法保障的隔离方式不得公开启用。
- 浏览器不支持所需 Worker/隔离链路时，直接回退正式声明式视图；不要降低限制运行原始程序。

## 8. 功能 C：根据问题生成补充实验

### 8.1 用户输入与生成结果

入口是“生成补充实验”，请求包含：问题、选中区域/概念、冻结的原实验版本、允许变化的变量、可选搜索范围。

允许的 recipe_id：

- compare：同一问题下的多条件对照。
- counterexample：在明确范围内搜索违反某个候选命题的输入。
- boundary：定位结果类别或约束状态发生变化的位置。
- sensitivity：改变输入，比较结果影响。

AI 输出实验草案；执行器校验后计算。搜索不是让模型反复猜答案；应转成登记算子、目标谓词和有限搜索计划。

每个草案必须说明原条件、补充条件、冻结变量、搜索范围、比较尺度和停止规则。默认每个实验最多 3 条对照路径、200 个候选点；需要更大范围时显式展示预算。

### 8.2 状态与结果

- 原实验不变；新实验有独立 experiment_id、branch_id、参数和历史。
- 对照共用可比坐标范围、单位和输入口径。
- 解释引用真实结果与轨迹，包含“为什么选这组条件”。
- 搜索终态分别为 found、not_found_in_scope、unknown、timeout；只有被登记的求解方法给出充分依据时，才允许 infeasible_proven。
- “范围内没找到反例”不得显示成“命题已证明”。
- 跨页原文中的常量不能因新实验的补充条件被覆盖。

示例：基于原稿的矩阵组合问题，自动比较先旋转后伸缩与反过来的顺序；找出明显差异后，增加同倍率伸缩作为对照。参数与原稿有差异的部分标为补充实验条件。

## 9. 功能 D：跨页连续模型与目标反求

### 9.1 概念身份和依赖

1. 原生引用、相同定义、单位、维度、上下文和明确文字指代共同作为匹配依据。
2. AI 提出候选关联和理由；同名异义、同义异名、单位不同、默认值冲突进入核对。
3. 用户可以确认、拆分或解绑；确认记录绑定版本。
4. 首版显式支持 same_parameter、derived_from、view_of、step_of；其他关系只作说明，不能直接执行。
5. 派生计算依赖构成 DAG；算法输入图允许环，不能对所有图结构一律禁止环。
6. 建立 concept_id → 参数/视图/来源节点的显式映射；已有 shared_key 是兼容映射，不作为语义身份的唯一依据。

跨页参数池的作用域为“材料 + bundle + branch”。一次人工修改提交一次事务，按拓扑重算，所有视图读取同一 branch_revision。多窗口冲突返回 409 并给出当前版本，不静默覆盖。

### 9.2 目标反求

用户在表单中选择目标输出、目标值、可改变量、约束、范围、容差和最大迭代数。

首批实现：

- 线性逆映射：固定 A 求 Ax=y，区分唯一解、多解、无解，返回残差；奇异情况不强行取逆。
- 单参数目标搜索：表达式输出达到目标值；仅在满足方法条件时使用二分等方法，否则做有界候选搜索并声明范围。
- 已登记的梯度下降实验：在限定集合中搜索能达到给定误差/步数要求的初值或步长；结论只覆盖声明的搜索集合。

多解时支持固定部分变量、选择距离当前参数最近的候选等明确策略。结果通过复算后，以新分支呈现；应用当前分支必须是用户显式操作，且版本仍匹配。

不能把未收敛或超时当作数学无解，不能把有限采样最小值当作全局最优。

## 10. 功能 E：自动验收、试玩与局部修复

### 10.1 三类独立检查

| 检查类别 | 执行方法 | 不能代替什么 |
| --- | --- | --- |
| 来源与语义检查 | 核对摘录、字段、单位、原稿值、补充条件标签；有歧义时人工核对 | 数值自洽不证明原稿理解正确 |
| 数学/程序检查 | Schema、维度、定义域、算子输入、参考结果、性质与残差 | 模型自己再次回答不能充当独立重算 |
| 交互/视觉检查 | 浏览器实际操作、截图、尺寸与遮挡规则、控制台/网络检查 | 截图看起来正常不证明结果正确 |

### 10.2 自动试玩用例

每个控制至少覆盖默认值、下界、上界；适用时覆盖零值、负值、奇异/不连续情形。执行播放、暂停、单步、回退、重置、保存与重开。

必须检查：

- 参数变更实际进入本次求值，所有关联图文引用相同 evaluation_hash。
- 原位热区与当前节点对齐；布局移动后无残留旧热区。
- 曲线定义域外留空并解释原因，不以 0 冒充无定义。
- 对照坐标尺度可比较；隐藏、超范围或不可见控件可被识别。
- 1600×1000 与 390×844 下关键内容可访问，支持键盘或数值输入替代拖动。
- 分享冻结正确；后续编辑不改变旧分享；离线打开无外部资源依赖。
- 专用视图的伪造消息、越界输入、网络请求、无限循环和错误 AST 被阻断或可靠终止。

### 10.3 修复范围和次数

允许自动修复：Schema 字段、明确绑定错误、坐标映射、控件范围与布局溢出等有检查依据的问题。

来源冲突、公式含义不清、未知业务/数学关系不能自动改成另一道题；进入人工核对。

修复在候选副本上执行，默认最多一次；消耗任务共同模型预算。修复后重跑受影响检查及关键回归。失败保留最后可用版本和失败说明，不无限循环。

ValidationReport 记录修复前后哈希、检查结果和浏览器证据。内容、计算模型、视图程序或内核变更后，相关旧报告标记 stale。

## 11. 拟新增 API、任务与模型调用

### 11.1 API

统一前缀沿用 `/api/v1`，成功/失败封装沿用现有约定。下表路径均为拟新增；POST/PATCH 使用 WriteDep，GET 使用 SessionDep，均先校验材料归属。

| 方法与路径 | 请求重点 | 返回 |
| --- | --- | --- |
| POST /materials/{id}/ai-plans | expected_document_revision、operation_id、region_ids（可空）、目的 | 202 + task_id |
| GET /materials/{id}/ai-tasks/{task_id} | 无写副作用 | 任务状态、stage、进度、结果引用或结构化错误 |
| GET /materials/{id}/ai-plans/{plan_id} | plan 归属 | 规划、来源、待核对项 |
| POST /materials/{id}/ai-plans/{plan_id}/apply | expected_plan_revision、expected_document_revision、选中方案、核对记录 | 202 + 编译任务；完成后 bundle_id |
| POST /materials/{id}/ai-regions/{region_id}/retry | 当前内容版本、operation_id、用户修正 | 202 + task_id |
| GET /materials/{id}/ai-bundles/{bundle_id} | 归属与版本 | 模型、规格、状态与能力 |
| POST /materials/{id}/ai-bundles/{bundle_id}/links | expected_bundle_revision、link decisions | 新 bundle_id；不就地篡改旧 bundle |
| POST /materials/{id}/ai-bundles/{bundle_id}/experiments | expected_branch_revision、question、selection、ranges、operation_id | 202 + task_id |
| POST /materials/{id}/ai-bundles/{bundle_id}/target-search | 目标与约束表单、expected_branch_revision、operation_id | 202 + task_id |
| GET /materials/{id}/ai-experiments/{experiment_id} | 实验归属 | 草案、结果、分支引用和状态 |
| GET /materials/{id}/ai-branches/{branch_id} | 归属 | 完整权威状态与 revision |
| PATCH /materials/{id}/ai-branches/{branch_id} | expected_revision、operation_id、人工参数变更 | 新 revision 与统一求值 |
| POST /materials/{id}/ai-bundles/{bundle_id}/validate | branch/version、operation_id | 202 + task_id |
| GET /materials/{id}/ai-reports/{report_id} | 归属 | 报告与受鉴权证据引用 |
| POST /materials/{id}/ai-bundles/{bundle_id}/generated-views | 需求、只读输入契约、operation_id | 202 + task_id；试验开关关闭时明确不可用 |

不存在通用 `/canvas/command` 或聊天动作执行接口。参数更新入口只接受结构化人工变更，不接收自然语言动作。

### 11.2 任务与并发

task kind 使用 ai_plan、ai_rebuild、ai_experiment、ai_verify、ai_codegen、ai_target；统一状态：

`queued → running → needs_review / succeeded / failed / cancelled / superseded`。

- needs_review 通过显式用户确认创建后续执行任务，不靠 GET 自动推进。
- 任务事实持久化，采用租约/心跳、幂等键、输入哈希和阶段检查点。
- 本地最低实现可用独立 worker 进程轮询数据库；可后续接 Celery/Redis，不能只把耗时任务放进 HTTP BackgroundTasks 就宣称支持重启恢复。
- 同一材料的挂载操作串行；相互独立的区域可计算，但提交前校验版本。
- 重试按 kind 分派真实执行器；不支持的任务明确拒绝，不能只改成 queued。
- 中途崩溃恢复时复用已落盘阶段，不能无限重发已成功的模型请求；外部调用结果不确定时记录状态并按幂等/预算规则处理。

### 11.3 MaaS 与预算

- 沿用 `LLM_PROVIDER`、`LLM_MODEL`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_TIMEOUT_S`；模型与地址以部署环境为准。
- 当前选择的服务是 DeepSeek-V4.1-Flash-1017，完整请求地址为 `https://api.modelarts-maas.com/v2/chat/completions`；base_url 只保存到 `/v2`。
- 不在提示词、接口示例或本文件写实际密钥。
- 新增 PPTAIClient.generate_json(task_type, input, schema_version, budget)；不要把所有任务都硬塞进现有 iSpec 提示词。
- 共用传输可抽到 `backend/app/ai/transport.py`，保留现有 MaasProvider/LabAI 的外部接口与独立开关。优先最小适配，不全面重写模型层。
- 自动上传阶段共享现有 `LLM_MAX_CALLS` 预算；不得默默扩大当前上限。先批处理候选摘要，再对关键难区域按预算补视觉。
- 用户主动创建实验有独立、可展示的任务预算。建议默认最多 3 次模型调用，包含初次和结构修正；数学搜索本身不重复调用模型。
- 建议新增 `PPT_AI_ENABLED=false`、`PPT_AI_GENERATED_VIEWS_ENABLED=false`、`PPT_AI_TASK_MAX_CALLS=3`、`PPT_AI_TASK_TIMEOUT_S=300`；均属拟新增配置，交付时同步示例与部署映射。
- 单次模型 timeout 沿用配置；max_tokens 按任务开放配置，建议规划从 4096 起实测，不能沿用 2000 就假定大型结构不会截断。
- Base64 图片请求体官方上限 5MB，项目建议预留编码/提示词余量，超过预算则裁剪/分批，不发送超限请求。
- 缺配置、限流、超时、响应截断、无效 JSON、证据拒收分开记录；用户看到可重试原因，日志不回显服务端完整响应或凭据。
- PPT 文本、图片文字、模型回复都视为不可信材料；材料中写的“执行命令/读取密钥/忽略约束”不能成为系统动作。

## 12. 发布、离线、兼容与回退

1. 共享快照增加经过公开投影的 bundle、语义图、选定分支、实验、视图资源与报告摘要；不带私有路径、session、Token 或原始诊断日志。
2. 发布与离线导出从同一 FrozenInteractionSnapshot 构建，冻结点包含 document/bundle/branch/runtime/kernel/artifact 版本。
3. 旧材料无新字段时继续按当前路径播放；新字段必须有 schema_version 和迁移/兼容策略。
4. 正式交互优先选择已有客户端求值支持的算子。服务端可先生成导数表达式等受限数据，客户端按相同契约求值。
5. 每个算子明确 offline_supported。依赖服务端且无法离线重算的能力，不得导出假滑杆；用户可选明确的结果快照，或使用在线分享。
6. 离线保留已有模型、参数、轨迹和本地计算；“生成新实验/新的 AI 解释”明确需要联网。
7. 专用视图产物若通过隔离和离线验收，打包为无远程依赖的本地资源；否则回退声明式视图或禁止该产物离线导出，必须在导出前说明。
8. 保留现有页图 64MB 上限；新增视图资源建议另设 8MB 总上限，超限明确失败，不漏页、不漏实验。
9. 离线 JSON/HTML 嵌入必须转义闭合脚本和相关特殊字符，禁止把生成内容直接插入主页面 HTML。
10. 关闭新功能开关后，原有上传/阅读/编辑/调参/分享仍可用。已发布快照不因撤销当前规划而被改写；撤销分享仍走已有机制。

## 13. 实施任务与检查点

以下任务中的新文件名为建议拆分；调整文件组织可以，但公共签名、字段语义和验收内容需保持一致，并在交付记录中说明。

每项先补能暴露对应缺口的测试，再实现，再运行该任务测试及受影响回归。不要为了满足“测试先行”给纯文案或机械文件改名编造测试。

### T01 契约、表结构与能力适配边界

**新建：**`contracts/ppt-ai/manifest.schema.json`、`region.schema.json`、`plan.schema.json`、`experiment.schema.json`、`view.schema.json`、`validation.schema.json`；`backend/app/ppt_ai/types.py`、`backend/app/db/ppt_ai_models.py`；`frontend/src/ppt-ai/types.ts`。

**修改：**`backend/app/db/init_db.py`，新增当前 Alembic head 后的迁移；`contracts/openapi.yaml`。

**接口：**产出第 5 节全部公共类型；声明旧 iSpec/Lab 适配边界，禁止前端与后端各自发明字段。

- [ ] 测试 extra 字段、悬空引用、非法 bbox、单位/维度、补充来源、旧材料缺新字段的行为。
- [ ] 实现契约和持久化；SQLite 与当前 MySQL 开发路线均考虑迁移、唯一约束和事务。
- [ ] 检查典型有效样例与拒收样例；新表不改变已有材料归属。

**测试建议：**`backend/tests/ppt_ai/test_contracts.py`、`test_models.py`；断言来源不可丢、不同会话不能通过 ID 读取新实体。

### T02 模型客户端、预算和可恢复任务

**新建：**`backend/app/ppt_ai/client.py`、`tasks.py`、`worker.py`；按需新建 `backend/app/ai/transport.py`、`backend/scripts/run_ppt_ai_worker.py`。

**修改：**`backend/app/settings.py`、`.env.example`、`deploy/docker-compose.yml`；必要时小范围适配现有模型调用。

**接口：**PPTAIClient.generate_json；enqueue_task / run_task / retry_task；使用 T01 类型和第 11 节状态机。

- [ ] 模拟成功、401、429、超时、截断、无效 JSON、提示注入文本、预算耗尽。
- [ ] 实现独立 worker、租约/恢复、真实 kind 分派与安全诊断，不改变真实密钥。
- [ ] 验证重复 operation_id 不重复生成，重启后有终态或明确恢复路径，GET 不触发调用。

**测试建议：**`test_client.py`、`test_tasks.py`；模型响应使用受控服务，真实联调另列，不让默认单测访问付费 API。

### T03 区域提取、覆盖表与内容缓存

**新建：**`backend/app/ppt_ai/regions.py`、`evidence.py`、`source_snapshot.py`。

**修改：**`backend/app/ispec/builder.py`、`image_text.py`、`backend/app/documents/presentation.py`，以最小适配接入。

**接口：**extract_regions(SourceSnapshot)；返回稳定 region_id、覆盖状态和来源哈希。

- [ ] 构造同页“原生图表 + 图片公式 + 装饰图”材料；前两者分别处理，装饰图不伪造实验。
- [ ] 实现局部裁剪、坐标转换、来源核对、按区域重试和版本化缓存。
- [ ] 验证已有图表不使图片公式跳过；仅改一个区域只失效相关缓存；文件改名不改变数学含义。

**测试建议：**`test_regions.py`、`test_evidence.py`、`test_region_cache.py`。

### T04 交互规划、能力注册与编译

**新建：**`backend/app/ppt_ai/planner.py`、`compiler.py`、`registry.py`、`prompts/`、`adapters/ispec.py`、`adapters/labs.py`。

**修改：**必要的 iSpec 扩展通过正式 Schema 和兼容版本进行；不在主业务按样本页码分派。

**接口：**plan_interactions、compile_plan、evaluate_model；注册现有数学、算法和题目实验室算子。

- [ ] 覆盖缺变量、错误表达式结构、不可用算子、维度不匹配、合法但缺原稿依据、无可交互内容。
- [ ] 覆盖缺失 Schema、无效 Schema 和不可用校验器：AI 规格不能挂载，原页仍可读取。
- [ ] 实现语义候选与交互规划分离、编译校验、有限结构修正和可用性状态。
- [ ] 验证改变标题/符号/布局的同题材料产生等价计算，缺条件时能补充或核对，不读固定样例数值。

**测试建议：**`test_planner.py`、`test_compiler.py`、`test_registry_adapters.py`。

### T05 正式图形重建与多视图运行

**新建：**`backend/app/ppt_ai/reconstruction.py`；`frontend/src/ppt-ai/renderer/`、`runtime/registry.ts`、`runtime/evaluate.ts`。

**修改：**`frontend/src/components/ispec/ISpecView.tsx`、`frontend/src/components/experiments/SceneRouter.tsx`、`ExperimentStage.tsx`；必要的 `documents/presentation.py` 适配。

**接口：**声明式 ViewAST → 可信视图；evaluate_model 的前端对等实现/适配器；所有视图读取同一 EvaluationSnapshot。

- [ ] 验证原稿矩阵/曲线/算法输入真正进入计算；缩放、移动和对象分离后热区正确。
- [ ] 实现原图对照、原位/独立实验显示、定义域/奇异状态及键盘替代交互。
- [ ] 选矩阵、函数或积分、算法过程、小型网络/优化中的至少四种模式，分别完成一份真实来源材料的重建。

**测试建议：**`test_reconstruction.py`、`frontend/src/ppt-ai/runtime/runtime.test.ts`；布局验收见 T10。

创建三维能力前先核对现有实现：包中已声明 three，不代表通用数学曲面运行时已完成。确需新增时，明确相机与数学参数分离、采样上限、缺 WebGL 时的数值表/二维视图回退，并补在线/离线对等测试。

### T06 跨页语义关系、参数事务与冲突

**新建：**`backend/app/ppt_ai/relations.py`、`branches.py`；`frontend/src/ppt-ai/runtime/branchStore.ts`。

**修改：**`backend/app/ispec/shared.py`、`frontend/src/components/reader/sharedParamPool.ts`、`useUnifiedSpecState.ts`，按兼容适配处理。

**接口：**confirm_links；GET/PATCH branch；模型求值读取 canonical_values 和同一个 branch_revision。

- [ ] 覆盖同名异义、同义异名、单位/默认值冲突、派生循环、允许有环的算法输入图。
- [ ] 实现核对/解绑、事务更新、拓扑重算和跨页来源定位。
- [ ] 两窗口从同版修改，后提交者获得 409；恢复旧分支不改变其他分支或原稿。

**测试建议：**`test_relations.py`、`test_branch_transactions.py`、`frontend/src/ppt-ai/runtime/branchStore.test.ts`。

### T07 问题驱动的补充实验

**新建：**`backend/app/ppt_ai/experiments.py`、`recipes/compare.py`、`counterexample.py`、`boundary.py`、`sensitivity.py`。

**接口：**generate_experiment、run_experiment；只产生新草案/分支，不调用通用画布动作。

- [ ] 覆盖明确反例、范围内无反例、未知、超时、非法搜索范围、跨版本结果返回。
- [ ] 实现四种 recipe、相同尺度对照、补充条件来源、停止条件和可复现结果。
- [ ] 保存/重开后比较结果一致；创建实验前后原分支哈希一致；自然语言“改当前参数”不会被作为直接命令执行。

**测试建议：**`test_experiments.py`、`test_recipes.py`。

### T08 目标表单与反向求解

**新建：**`backend/app/ppt_ai/targets.py`；`frontend/src/components/ppt-ai/TargetSearchPanel.tsx`。

**接口：**solve_target；请求与终态按第 9 节，结果生成独立候选分支。

- [ ] 线性映射覆盖唯一解、多解、无解与残差；标量搜索覆盖有括区间、无有效区间、不连续、超时。
- [ ] 实现固定变量、最近候选策略、误差容限和明确搜索集合；计算结果复算后才显示可采用。
- [ ] 验证搜索失败不被表述为数学无解，应用过期候选返回版本冲突。

**测试建议：**`test_targets.py`、`frontend/src/ppt-ai/runtime/targetResults.test.ts`。

### T09 专用视图生成试验

**新建：**`backend/app/ppt_ai/generated_views.py`；`frontend/src/ppt-ai/sandbox/host.ts`、`protocol.ts`、`worker.ts`；`frontend/src/components/ppt-ai/GeneratedViewFrame.tsx`。

**接口：**只读输入 → 隔离程序 → 经校验的 ViewAST；artifact 按哈希寻址，协议不接受主应用命令或私有资源请求。

- [ ] 先测试越权 postMessage、错误 source/nonce、旧 revision、注入 SVG、网络读取、超大 AST 和无限循环。
- [ ] 实现第 7.3 节隔离、终止、可信降级和开关；不能把静态扫描通过当作安全证明。
- [ ] 交付一个确有必要的新视图及自动验收证据；默认关闭试验开关，满足隔离/兼容条件后可单独启用。

**测试建议：**`test_generated_artifacts.py`、`frontend/src/ppt-ai/sandbox/protocol.test.ts`、`frontend/e2e/ppt-ai-sandbox.spec.ts`。

### T10 自动校验、浏览器试玩与有限修复

**新建：**`backend/app/ppt_ai/validation.py`、`repair.py`；`frontend/e2e/ppt-ai-interactions.spec.ts`；`backend/scripts/verify_ppt_ai.py`。

**修改：**`frontend/package.json` 与锁文件，添加或接入浏览器测试依赖、定义 `test:ppt-ai:e2e` 脚本；测试依赖版本随锁文件交付，浏览器安装和受控服务启动写入测试说明。

**接口：**validate_bundle；报告分别记录来源、计算和 UI 结果，绑定所有被测哈希。

- [ ] 注入错误绑定、旧文字结论、越界控件、隐藏参数、保存丢值、离线缺资源等故障，确认检测有效。
- [ ] 实现规则检查、性质用例、浏览器控件清单、截图证据及最多一次定向修复。
- [ ] 验证语义歧义进入人工核对；修复失败保留旧版本；模型/API 失败不让原生阅读失效。

**测试建议：**`test_validation.py`、`test_repair.py` 和本任务浏览器用例。

### T11 PPT 前端工作流与私有 API 接入

**新建：**`backend/app/api/routes_ppt_ai.py`；`frontend/src/api/pptAI.ts`；`frontend/src/components/ppt-ai/InteractionPlanPanel.tsx`、`RegionReviewPanel.tsx`、`ExperimentQuestionPanel.tsx`、`ExperimentBranches.tsx`、`ValidationPanel.tsx`。

**修改：**`frontend/src/pages/MaterialDeckPage.tsx`、`frontend/src/components/presentation/DeckPlayer.tsx`、`ConversionReview.tsx`；按需接现有查询键。

**接口：**第 11.1 节 API；沿用错误封装、WriteDep、owned_material、重试与版本提示。

- [ ] 验证未授权 ID、缺 CSRF、非法 Origin、过期版本、任务失败和关闭功能开关。
- [ ] 实现规划采用、区域核对、补充实验草案、分支打开、目标表单、报告；不新增通用聊天操控。
- [ ] 保留现有阅读/编辑/演示流程和人工控件，异步结果过期时不覆盖用户当前状态。

**测试建议：**`backend/tests/ppt_ai/test_api.py`、`frontend/e2e/ppt-ai-workflow.spec.ts`。

### T12 发布、离线快照与兼容

**新建：**`backend/app/ppt_ai/snapshots.py`、`frontend/src/ppt-ai/runtime/snapshot.ts`。

**修改：**`backend/app/api/routes_publish.py`、`backend/app/offline.py`、`frontend/src/offline/main.tsx`、`frontend/src/api/types.ts`，必要时更新构建资源清单。

**接口：**freeze_interactions；与现有发布冻结点统一，不能读取相互不匹配的最新状态。

- [ ] 验证旧快照、发布同时发生编辑、撤销分享、资源缺失、64MB 页图上限、新产物资源超限和离线计算能力不足。
- [ ] 实现公开白名单、版本冻结、资源哈希、脚本嵌入转义与离线能力说明。
- [ ] 在线、分享和离线对固定输入得到一致结果；发布后编辑不影响旧分享；离线新 AI 请求有明确状态。

**测试建议：**`test_ppt_ai_snapshots.py`、扩展 `backend/tests/test_publish.py`、`test_offline_deck.py`；`frontend/e2e/ppt-ai-offline.spec.ts`。

### T13 陌生材料验收与发布候选

**新增材料与报告目录：**`fixtures/ppt-ai/dev/`、`fixtures/ppt-ai/eval/`、`verify/ppt-ai/`。使用有授权或自制材料，记录真实与合成来源，不提交私人试卷或商业数据。

**接口：**使用正式上传、生成、核对、实验、分享、导出流程，不绕过 API 直接构造成功页面。

- [ ] 至少准备 20 份不同材料，按整份文件隔离开发与留出集；覆盖公式、图示、流程、混合页、陌生符号、负例。
- [ ] 对关键样例人工标注预期参数、关系、来源和结果；有条件时由未参与实现的人核对留出集。
- [ ] 分别统计原页可读率、区域识别精确率/召回率、语义正确率、自动可运行率、人工修正量、核验通过率和耗时。
- [ ] 记录失败案例、配置、模型/提示词/代码版本、冷启动与缓存耗时；预期失败被正确拒收不计作自动转换成功。
- [ ] 单独展示至少一份陌生材料的“上传—规划—采用—补充实验—跨页联动/反求—报告—分享/离线”完整证据。

## 14. 统一验收清单与验证命令

### 14.1 五个最容易遗漏的输入/故障 / Review Focus

1. 同页原生图表和图片公式：由 T03 保证分区处理。
2. 跨页同名字母但含义不同、同一概念却符号不同：由 T06 保证候选核对与解绑。
3. 模型处理过程中用户编辑内容：由 T02/T04/T11 保证输入版本过期不挂载。
4. 反例搜索无发现、奇异逆映射、多解、超时：由 T07/T08 保证结果语义正确。
5. 发布或离线包含旧分支、未知脚本或缺资源：由 T09/T12 保证版本、隔离、白名单与明确失败。

### 14.2 最终必须勾选

- [ ] 五项功能均有可执行路径、真实来源案例和失败行为；第 3 项通用自然语言画布控制未被顺带实施。
- [ ] 自动生成和人工配置能分别统计；新增条件与原稿依据清晰。
- [ ] 所有计算和对照来自真实内核；至少一个陌生课件不靠标题/页码硬编码。
- [ ] 跨页同一分支保持一致，多窗口冲突不丢数据。
- [ ] 有效反例可复算；无反例/超时不被表述为证明或无解。
- [ ] 专用视图试验交付可运行隔离路径、阻断和降级证据；公开开关状态有记录。
- [ ] 生成后自动试玩能发现人为植入的故障，修复有次数上限。
- [ ] 分享冻结与离线运行使用同一套模型/视图版本。
- [ ] 日志、报告、公开 API、截图与导出中无密钥、Cookie、Token 或私有绝对路径。
- [ ] 旧 PPT 阅读、编辑、保存、重置、分享和离线回归通过。

### 14.3 验证命令

以下命令在实施完成后运行；本次文档编制没有执行这些业务测试。

```powershell
# 从项目根目录开始
Set-Location backend
py -3.11 -m pytest tests/ppt_ai -q
py -3.11 -m pytest tests/ispec tests/test_free_document.py tests/test_publish.py tests/test_offline_deck.py -q

# 完整后端测试；MySQL 集成测试按现有配置单独启用
py -3.11 -m pytest -q

# 转到前端目录
Set-Location ../frontend
npm test
npm run typecheck
npm run build

# 以下为 T10/T11 交付时新增的脚本约定
npm run test:ppt-ai:e2e
```

浏览器自动化需本地服务、固定测试会话、无真实密钥的受控模型响应。真实 MaaS 联调另列材料数、调用次数与消耗；不能把模拟调用成功写成真实模型验收。

性能：先记录当前基线；简单客户端调参可沿用 P95 ≤150ms 的目标。原申报的 20 页/20MB、准备 ≤180 秒是待实测目标，应同时报告环境、模型调用/OCR 时间与失败率，超标如实记录，不通过修改分母伪造达标。

### 14.4 固定黄金用例

以下是教学/测试输入，不是陌生 PPT 的自动识别效果。预期值由独立参考计算核对；每个案例同时检查参数来源与当前求值绑定。

| 用例 | 固定输入 | 预期 |
| --- | --- | --- |
| 变换顺序 | v=(1,0)，逆时针旋转 90°，横向伸缩 2、纵向 1 | 先旋转再伸缩得 (0,1)；先伸缩再旋转得 (0,2)，浮点误差按容差处理 |
| 跨页函数 | 同一概念 a=2，x=3，y=a*x^2 | 所有关联视图 y=18；另一处未确认相关的 a 不跟随 |
| 唯一逆映射 | A=diag(2,1)，y=(4,3) | x=(2,3)，代入残差在容差内 |
| 多解/无解 | A=diag(1,0)；分别取 y=(2,0)、y=(2,1) | 前者 x1=2、x2 任意；后者无精确解，不能显示普通逆矩阵结果 |
| 标量目标 | x^2=4，范围 [0,3] | 返回 x=2 附近候选并验证残差；负根不属于本次范围 |
| 算法轨迹 | A 指向 B/C，B/C 均指向 D；邻居顺序按字典序，入队即标记 | BFS 顺序 A、B、C、D；D 只入队一次 |
| 原稿/补充隔离 | 在已保存原稿分支上生成一个额外条件对照 | 新 experiment/branch 变化，原分支内容哈希不变，补充条件可见 |
| 导出冻结 | 发布固定 bundle/branch 后继续编辑原稿 | 旧分享结果与原冻结输入一致；新文档显示相应待更新状态 |

人工演示“先做 A 再做 B”对应矩阵乘积 B*A；不得把书写顺序与执行顺序混用。方法名称和算子语义在注册表中固定。

## 15. 实施顺序、风险与交付方式

### 15.1 依赖顺序

T01 → T02/T03 → T04 → T05 → T06 → T07/T08 → T11/T12 → T13。

T09 在 T01、T02、T05 具备后单独攻坚；T10 从 T04 起持续接入，不能等所有功能结束才考虑验收。T09 与其他任务的产物不得共用未隔离的执行路径。

### 15.2 12 月 1 日前的建议检查点

以下是建议排期，需技术负责人按实际人力确认，不是交付时间保证；不得因排期紧张删除已约定的功能却仍宣称完成全部任务。

| 日期 | 建议产出 |
| --- | --- |
| 11/08—11/10 | 契约/任务/版本/来源冻结，选好真实材料与黄金计算用例 |
| 11/11—11/17 | 区域识别、规划、正式重建、初步自动检查；陌生材料能够生成正确实验 |
| 11/18—11/23 | 补充实验、跨页模型、目标反求，前端完整流程 |
| 11/24—11/27 | 专用视图隔离试验、浏览器验收、分享与离线一致性 |
| 11/28—11/30 | 冻结功能、整理留出集报告、演示与失败边界，准备提交 |

若专用视图隔离试验尚未满足公开条件，保留已完成正式重建能力并明确试验开关关闭原因，不能直接降低隔离要求。应单独列出该项剩余任务，不能标记为已全部验收。

### 15.3 技术人员每项交付的内容

- 实际完成范围、负责人、修改/新增文件、数据库迁移与兼容说明。
- 输入/输出契约、配置项及默认值；配置示例只有占位密钥。
- 针对性测试、受影响回归、浏览器操作和证据路径。
- 真实模型与受控响应分别记录；异常、失败材料和人工核对量。
- 特性开关、旧版本回退、任务重试/恢复和产物清理方式。
- 账号/MySQL/题目实验室等并行改动的对接结果；不覆盖其他工作。

本文件无需再询问“是否允许编写计划”。产品负责人后续核对范围和取舍，技术人员按依赖逐项实施；本次没有授权在此对话中直接实施这些业务改动。

## 16. 参考资料

- 项目当前 `README.md`、`象生项目技术交接清单-2026-11-05.md`；历史文件中的已完成状态必须以当前代码和实测复核。
- [华为云 MaaS V2：请求、模型及图像输入限制](https://support.huaweicloud.com/model-call-maas/model-call-019.html)
- [MDN iframe：sandbox 权限与隔离限制](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [MDN postMessage：消息来源校验](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Google Research：交互学习生成、自动评估与人工检查的研究参考](https://research.google/blog/the-future-of-practice-enabling-teachers-to-create-learning-interactives-with-generative-ui/)

外部研究仅作为设计参考，不作为象生的能力证明或效果数据。

## 17. 实施记录（2026-11-07）

本轮已按 T01—T13 落地代码与测试，证据与限制如下；勾选表示对应交付物已存在并通过本机验证，不代表已完成真实陌生商业课件的效果验收。

- [x] T01 契约/表/类型：`contracts/ppt-ai/*.schema.json`、`backend/app/ppt_ai/types.py`、`backend/app/db/ppt_ai_models.py`、Alembic `0002_ppt_ai_tables`、`frontend/src/ppt-ai/types.ts`。
- [x] T02 模型客户端/任务：预算、401/429/超时/截断/无效 JSON/注入文本分类；持久任务、租约、幂等与独立 worker 脚本。
- [x] T03/T04 区域/规划/编译：原生/OCR/视觉/装饰覆盖表、内容哈希缓存、登记算子、iSpec/Lab 适配与参数核对覆盖。
- [x] T05 运行时：声明式 ViewAST、前端求值/渲染、原页热区与工作台预览；新增 canvas view 重建。
- [x] T06/T07/T08：关联核对、不可变 bundle 与分支事务、四种 recipe、线性逆映射/离散枚举/有界标量目标搜索。
- [x] T09 专用视图：默认关闭；opaque-origin + `allow-scripts` iframe + Worker 执行；AST 白名单、nonce/source/revision、200ms 超时降级；一个积分面积+分割矩形试验视图已在本机隔离验收。
- [x] T10 验收：来源/计算/程序/交互/浏览器规则、用例残差、一次有限修复、报告哈希与 stale；Playwright 用例以系统 Chrome（`channel=chrome`）运行。
- [x] T11 工作流：16 组私有 API、`/materials/:id/ai` 前端工作流、Deck 原位热区/AI 面板、MaterialDeckPage 接入；没有通用聊天画布命令。
- [x] T12 发布/离线：发布时冻结选定 bundle+branch；公开投影去除 material/session/路径；断网单文件包含 AI 交互与已验收专用视图；资源 8MB 上限。
- [x] T13 语料报告：`fixtures/ppt-ai/{dev,eval}`（20 份仓库自制 corpus）、`verify/ppt-ai/report.json`、`verify/ppt-ai/evidence.json` 与截图。

验证结果：

- 后端：`python -m pytest -q --ignore=tests/test_dev_route_probe.py` → 503 passed, 8 skipped。
  已知既有 `test_dev_route_probe` 在 Windows PowerShell 中文输出编码下失败，与本次功能无关。
- 前端：`npm test` → 197 passed；`npx tsc --noEmit`、`npm run build` 通过。
- 浏览器：`npx playwright test -c e2e/playwright.config.ts` 一次运行 5 passed（交互/工作流/沙箱/离线）；专用视图与离线均用系统 Chrome 实际截图核对。
- 语料：区域类别期望命中率 100%，自动可运行率 90%；OMML 仅给出 `A/B/det A` 声明值且无可恢复计算关系时标为原文说明，未伪造滑杆；详见报告 limitations。
- 真实 MaaS 联调未在本轮执行；浏览器与单测均使用 `LLM_PROVIDER=none` 的本地确定性路径。专用视图公开启用仍需按部署环境复核隔离与资源上限。
