# 通用题意理解流程与任务专用建模、校验实施计划

> 执行说明：本文件只定义计划，不授权实施。后续执行使用 superpowers:executing-plans，按任务逐项实现和验证；需要并行代理时另按用户选择执行。

**目标：** 将本地 Agent 拆为理解题目、选择任务并建模、检查模型、调用内核四阶段，提高识别、条件提取和建模准确性，以已有高数和 408 任务验证通用性。

**架构：** 共用来源与事实契约、流程状态和错误处理；每个任务提供自己的输入结构、适用边界、条件映射及校验。默认两次模型调用，程序承担候选筛选、确定性检查和内核执行。

**技术栈：** 沿用 Python、Pydantic、httpx、Ollama、现有数学/算法内核、React/TypeScript；模型先固定 qwen3-vl:2b-instruct-q4_K_M。

**设计依据：** 本次对话确认的“通用流程＋任务专用建模和校验”；已有 `docs/superpowers/specs/2026-11-12-local-understanding-agent-design.md` 仅作为历史约束参考，其中单次理解调用由本计划替代。

## 约束与范围

- 本轮仅新增计划文档，不修改代码、配置、模型或安装依赖。
- 保留 `/labs/{lab_id}/ai-solve`、现有内核子进程、交互挂载、来源鉴权及 revision 冲突保护。
- 不增加付费模型回退，不引入 Agent 框架、向量数据库或通用知识图谱。
- 首批验收：高数的定积分、不定积分、导数、二重积分、极值；408 的 BFS、堆、CPU 调度、页面置换、磁盘调度、银行家算法。
- 其他已有任务维持原路径，未迁移不能静默变更行为；回滚切换必须明确，不在失败后自动调用旧链路掩盖结果。
- 物理、电子本期只定义扩展契约并验证注册机制，不宣称具有新的求解能力。
- 独立多小问可分项执行；有依赖的小问记录依赖并明确未支持，不以模型猜测的前问答案传递到后问。
- 概念、证明、开放设计题保留理解结果与不支持原因，不伪装成内核已验证答案。

## 重点风险及所属任务

1. 正负号、指数、不等号、图边方向读错：任务 1、3、5。
2. 参考答案或学生解答混入已知条件：任务 2、3。
3. 条件已列出却未真正进入模型：任务 4、5。
4. 多小问只完成一问却标整题完成：任务 2、6、7。
5. 修改题目或确认条件后使用旧缓存、迟到结果覆盖修改：任务 6、7。

## 一、公共数据契约

在 `backend/app/labs/understanding_models.py` 新增以下 Pydantic 类型。新增契约标记 `pipeline_version=general-understanding.1`，旧文档缺字段时按旧结果读取，不推断其已经通过新检查。

| 类型 | 必需内容与语义 |
| --- | --- |
| SourceBundle | 当前 problem_id、文本候选、来源列表、用户确认项、内容摘要；参考答案和学生解答不进入默认读题输入 |
| SourceRef | 登记的 source_id、材料角色、页键、可空 bbox、可空文字范围；不允许模型提供本地路径 |
| Fact | id、category、raw、normalized、unit、source_refs、origin；category 为 quantity/expression/relation/constraint/initial_condition/boundary_condition/assumption/data；origin 为 source/user_confirmed，不由模型标记程序推导 |
| Entity | id、label、kind；用于物体、节点、进程、元件等。关系事实可引用实体 ID；纯公式题允许实体列表为空 |
| QuestionGoal | id、原始要求、action、fact_ids、depends_on；action 为 compute/simulate/analyze/prove/explain/design/unknown |
| Ambiguity | id、fact_ids、source_refs、候选读法、影响、blocking；模型信心不作为概率阈值 |
| UnderstandingResult | 完整题干、entities、facts、goals、ambiguities；不含最终答案、内核模型或计算轨迹 |
| CandidateModel | goal_id、task_id、task_version、conditions、bindings、unmapped_fact_ids；bindings 将 JSON 字段路径关联到事实 ID，并区分直接提取和待验证推导 |
| ValidationIssue | code、stage、goal_id、field_path、fact_ids、severity、message；severity 为 blocking/warning |
| ModelValidation | issues、逐事实处置记录、逐目标覆盖状态、可执行标志；仅服务端构造 |
| PipelineResult | understanding、逐小问 candidate/validation/computation、整体状态、版本、输入摘要和调用统计；不由模型设置 checkable |

事实应保留原式与规范形式，规范化不消除定义域限制。多个 OCR 候选不作为多个独立题目事实重复计数。用户确认高于旧候选；原图与 OCR 冲突时形成疑点，不自动选择更容易求解的读法。

## 二、任务扩展契约

在 `backend/app/labs/task_specs.py` 提供静态任务注册表，复用 `kernel_models.py` 的目录与计算入口，不重写求解器。

`TaskSpec` 包含 `id/version/subjects/goal_actions/input_model/requirements/support_limits/validate_semantics/kernel_task`。`input_model` 产生该任务的 JSON schema，`requirements` 由同一字段定义与条件规则产生；不得另外手写一套不一致的提示词字段列表。

接口约定：

- `get_task_spec(task_id: str) -> TaskSpec`
- `select_candidates(u: UnderstandingResult) -> dict[str, list[str]]`：每个目标通常最多 4 个候选；筛选证据不足时使用完整任务的简短标签目录重新选择，不发送全部字段，不直接判不支持。
- `validate_candidate(u: UnderstandingResult, candidate: CandidateModel) -> ModelValidation`
- `to_kernel_plan(candidate: CandidateModel) -> dict`：只转换已通过检查的声明式条件，最终由编排器限制调用。

派生条件默认交现有内核；模型提出派生值时必须经过任务校验，无法核验则不能据此正式求解。二重积分继续优先使用原始区域模式，避免让小模型自行推导积分限。

专业规则举例：

| 任务 | 专用检查 |
| --- | --- |
| 积分/导数 | 变量、原表达式定义域、上下限或求导点、原题要求是否一致 |
| 二重积分 | 全部区域约束保留；原始区域与手填积分限不得混用；换序目标不得丢失 |
| 极值 | 目标、变量范围、约束类型与任务支持范围；不等式不能改写成等式 |
| BFS | 节点/边/起点、有向性、访问顺序；没有规定访问顺序时不声称唯一序列 |
| 堆 | 堆类型、初始数组、删除次数及执行范围 |
| CPU 调度 | 算法、抢占语义、到达/服务时间；RR 时间片、优先级方向及必要的并列规则 |
| 页面置换 | 访问序列、物理块数、算法、初始状态；明确非空初态若现有任务不能表达则拒绝 |
| 磁盘调度 | 起点、请求、方向、边界与回扫计费；不将未说明规则变成原题事实 |
| 银行家算法 | 矩阵形状、非负量、Allocation≤Max、Available、请求对象和向量 |

事实 ID 绑定只提供追踪，不证明语义等价。简单关系可由程序核对，无法判定的语义保留待核对；不开发一个声称能验证所有自然语言的通用校验器。

## 三、实施任务与顺序

每项非平凡变更按“先写指定失败用例→确认失败→实现最小逻辑→运行对应测试→记录结果”执行。本目录当前未确认为 Git 仓库，不在计划中要求直接提交或创建分支。

### 任务 1：建立跨学科基线与错误归因

**新增：** `backend/tests/fixtures/understanding_cases.json`、`verify/general-understanding/baseline.py`。

- [ ] 准备 100 个原题组：高数 40、408 40、缺条件/不支持/跨小问等边界 20；边界组同时包含数学与计算机题。
- [ ] 人工标注关键公式、事实、目标、允许任务、可接受模型、应阻塞原因；专业领域能力以当前内核实际支持为准。
- [ ] 每组按需要包含准确文字、裁剪图、整页图；同原题变体保持同一分组，60 组开发、40 组保留评测，分层拆分。
- [ ] 当前版本运行基线，记录模型与提示摘要、参数、输入图摘要、识别/建模/执行状态、调用数和耗时。真实模型评测与无模型单元测试分开运行。
- [ ] 标注基线错误所属阶段，区别 OCR 失败、条件遗漏、任务错配、内核不支持；不将预期不支持计入可求解题错误。

**交付：** 固定数据清单与基线报告；未获得基线前不承诺准确率提升百分比。

### 任务 2：落实公共契约与任务定义

**新增：** `understanding_models.py`、`task_specs.py`、`backend/tests/test_understanding_contracts.py`、`backend/tests/test_task_specs.py`。
**修改：** `backend/app/labs/kernel_models.py`，仅提取可复用的预检查边界；保留旧入口行为。

- [ ] 测试 `test_reject_unknown_fact_reference`：引用不存在的事实/目标时报结构错误。
- [ ] 测试 `test_source_role_is_not_question_fact`：答案材料不能成为默认题目来源；补充材料须显式关联当前题目。
- [ ] 测试 `test_task_schema_matches_required_fields`：首批任务必填字段与内核一致；ODE 后续接入时必须用 target_lower/target_upper，不再生成 target_bounds。
- [ ] 实现上述类型与 TaskSpec；图关系使用对象/关系事实，不强制转换为公式。
- [ ] 测试 `test_goal_dependency_is_preserved`：两小问及依赖关系完整保留；无执行支持时不可标完成。
- [ ] 运行 `py -3.11 -m pytest backend/tests/test_understanding_contracts.py backend/tests/test_task_specs.py -q`，要求全部通过。

**交付：** 不调用模型即可验证的跨学科契约；生成结构与服务端消费结构保持一致。

### 任务 3：输入保真与独立读题

**修改：** `backend/app/labs/extract.py`、`backend/app/labs/local_agent.py`。
**新增：** `backend/app/labs/understanding_sources.py`、`backend/tests/test_understanding_sources.py`；扩展 `backend/tests/test_local_agent.py`。

接口：`build_source_bundle(problem: dict, lab_id: str) -> SourceBundle`、`extract_understanding(bundle: SourceBundle) -> UnderstandingResult`。

- [ ] 测试 `test_analysis_image_preserves_formula_detail`：大图保留分析来源；显示预览仍可缩放，模型分析图不从缩小图放大生成。
- [ ] 测试 `test_crop_provenance_and_page_context`：裁剪区域可回到原页；跨页条件、图例和表头不被静默删除。没有可信定位时用整题/整页，不使用模型猜测坐标作唯一输入。
- [ ] 测试 `test_visual_text_disagreement_blocks_critical_fact`：x²/x³ 或 ≤/≥ 冲突保留候选，不能自动当作已确认。
- [ ] 测试 `test_unreadable_ocr_still_allows_visual_understanding`：存在有效图片时不因 OCR 少于三个字符而跳过读题；前端触发调整在任务 7 接入。
- [ ] 实现单独的读题提示与 schema；不发送任务字段目录，不生成答案；读取文字、关系、条件和目标。
- [ ] 图片/页数/输出预算显式检查，不静默截断；旧材料无高质量源时继续使用现有预览并注明来源质量限制。
- [ ] 运行来源与本地 Agent 测试，保留既有来源越权、bbox 与预算拒绝测试。

**交付：** 可单独检查的理解结果；识别输入和展示预览解耦，旧文档仍可读。

### 任务 4：候选任务筛选与专用建模

**修改：** `local_agent.py`、`task_specs.py`。
**新增：** `backend/tests/test_understanding_routing.py`。

接口：`build_candidates(u: UnderstandingResult, candidates: dict[str, list[str]]) -> list[CandidateModel]`。

- [ ] 测试 `test_math_and_os_use_different_field_schemas`：积分不接收进程字段，RR 不接收积分字段；缺时间片不可填默认教学值。
- [ ] 测试 `test_unknown_route_can_expand_candidates`：初筛不确定不会直接拒绝一个目录中支持的任务；扩大候选只进行一次。
- [ ] 测试 `test_region_constraints_bind_to_raw_region`：全部区域不等式映射到 region_text，不替换成未验证的积分限。
- [ ] 测试 `test_bfs_order_requirement_not_invented`：访问顺序没有依据时指出歧义，或按当前内核能力明确限制，不能宣称原题规定字典序。
- [ ] 第二次模型调用只发送理解结果、相关任务与必要来源摘录；不重复发送全量图片。需要重看图片时返回识别阶段。
- [ ] 为每个目标输出对应候选和事实绑定；只接受当前任务 schema 中字段。
- [ ] 运行 routing 与 task_specs 测试。

**交付：** 首批高数及 408 任务可经同一接口建模；任务不确定性显式可见。

### 任务 5：条件覆盖与专业模型校验

**新增：** `backend/app/labs/model_validation.py`、`backend/tests/test_model_validation.py`。
**修改：** `task_specs.py`、`kernel_models.py` 的必要预检查接口。

- [ ] 测试 `test_positive_constraint_cannot_be_dropped`：原题 x>0 未进入求解域时阻塞。
- [ ] 测试 `test_fake_binding_does_not_prove_coverage`：仅将条件 ID 填进 bindings、模型实际不含约束，仍然阻塞。
- [ ] 测试 `test_nonempty_initial_frames_not_ignored`：页面置换已知非空初态不能改为空；不支持该输入时返回明确 unsupported。
- [ ] 测试 `test_directed_edge_and_matrix_dimensions`：有向边不能自动反向或转无向；银行家矩阵、向量形状不符时报精确位置。
- [ ] 实现结构→来源→条件处置→专业语义→小问覆盖五层检查；返回结构化错误。
- [ ] 每个影响求解的事实必须为已使用、经规则确认无关、待核对或不支持；“无关”不能只接受模型自报理由。
- [ ] 重计算、符号推导仍在有预算的内核子进程执行，不在 API 预检查中启动无界求解。
- [ ] 运行校验与既有 kernel_models 测试；校验失败时用 spy 断言未调用 run_kernel。

**交付：** 限定任务范围内可解释的校验；语义无法判断的情况保留待核对，不声称通用证明。

### 任务 6：四阶段编排、修复与保存

**修改：** `local_agent.py`、`ai_solve.py`、`backend/app/api/routes_labs.py`、`backend/app/settings.py`。
**新增：** `backend/tests/test_understanding_pipeline.py`；扩展 `test_labs_ai_solve.py`、`test_labs_api.py`。

入口仍为 `understand(problem: dict, *, lab_id: str | None = None) -> dict`，内部执行新阶段并适配现有结果；灰度开关建议 `lab_understanding_pipeline=legacy|staged`，初始 legacy。

- [ ] 测试 `test_two_calls_on_normal_single_goal`：单目标成功时两次模型调用，计算仅来源于内核。
- [ ] 测试 `test_repair_does_not_mutate_confirmed_fact`：错误模型可修复；已确认题目事实不能被改写。
- [ ] 初始全局模型调用预算为每题最多 4 次：正常 2 次，其余最多用于一次路由扩展、一次局部重识别或一次模型修复；所有用途共用剩余预算。多目标必要分批也计入总预算，超预算返回部分完成及明确原因。
- [ ] 从识别阶段返回的新事实使后续候选失效；没有剩余预算重建时停止，不执行旧候选。
- [ ] 使用总时限控制流程，初始 180 秒，各次请求使用剩余时间；内核单次沿用 12 秒限制并不得超过流程剩余预算。耗时门槛在真实评测后调整。
- [ ] 测试 `test_partial_goals_not_marked_complete`：一个目标成功、另一个阻塞时整体 partial；每目标独立保留来源、检查和结果。整题自动判分保持关闭，直到所有必要目标均满足对应判分条件。
- [ ] 测试 `test_unconfirmed_source_computation_cannot_grade`：沿用候选试算门槛；真正关键歧义阻塞执行。
- [ ] 缓存摘要加入模型、pipeline/prompt/task 版本、来源内容/裁剪、确认状态、所有影响输出的参数；增加测试 `test_cache_changes_after_confirmation_or_task_version`。
- [ ] 继续使用现有 CAS revision 写入与锁；测试 `test_late_pipeline_result_preserves_user_edit`。
- [ ] 运行 pipeline、AI solve、API 与既有本地 Agent 回归测试。

**交付：** 可由显式配置启用和回滚的流程；没有无限重试、隐式旧链路回退或模型自报验证通过。

### 任务 7：前端结果呈现与兼容

**修改：** `frontend/src/labs/types.ts`、`frontend/src/labs/autoAI.ts`、`frontend/src/pages/LabWorkbenchPage.tsx`。
**测试：** 扩展 `frontend/src/labs/autoAI.test.ts`，新增 `frontend/src/labs/understandingResult.test.ts`；浏览器脚本置于 `verify/general-understanding/`。

- [ ] 类型增加可选的逐阶段、逐目标结果；旧 ai_solution 正常展示，不自动触发重复调用。
- [ ] 有图片但 OCR 为空仍允许触发；纯空白输入不触发；重试与输入摘要对应。
- [ ] 呈现识别条件与来源、待核对位置、选中任务、检查问题和各问结果；候选试算与正式可核验结果区分。
- [ ] 当前 API 为同步返回，本期展示请求中的等待状态与返回后的阶段摘要，不伪造实时阶段进度，不引入 SSE/轮询服务。
- [ ] 独立多问可选择当前结果供既有画布展示，各问结果保留；不把多个模型强塞入单个画布。依赖问标明未完成原因。
- [ ] 保留跨实验室迟到响应隔离、学习记录同步、保存刷新与分享快照行为；分享不泄露本地路径。
- [ ] 在 frontend 下运行 `npm test`、`npm run typecheck`、`npm run build`，并浏览器验收文字/图片导入、确认、切题、保存恢复和部分完成。

**交付：** 用户可定位错误发生在哪一步，旧结果仍可访问，现有画布与保存流程不退化。

### 任务 8：跨科目扩展约定与最终评测

**新增：** `docs/labs-task-extension.md`、`backend/tests/test_task_extension_contract.py`；使用任务 1 的保留评测集。

- [ ] 扩展文档规定新增任务六项：支持边界、输入 schema、事实映射、语义校验、内核适配、正确/缺条件/不支持用例；有可视化需求才注册前端渲染。
- [ ] 提供文档级物理示例“一维恒加速度”和电子示例“直流电阻网络”：前者需要单位/方向/运动条件，后者需要节点/连接/极性/参考地。均不注册为生产支持任务。
- [ ] 用仅测试环境注册的任务验证主流程无需按 subject 添加 if/else；未注册物理/电子任务返回 unsupported，不进入数学近似替代路径。
- [ ] 新旧流程使用相同模型、参数、原题组对照；先固定参数评估流程，再用开发集尝试 temperature 0/0.1/0.2、repeat_penalty 1.0/1.1，保留集不用于反复挑参数。
- [ ] 对不稳定和困难案例重复 3 次，报告波动，不以单次成功代表稳定能力。
- [ ] 完成高数与 408 分科报告、总耗时与调用次数报告；再决定是否启用 staged 默认值。

**交付：** 可复用的扩展说明和真实模型证据；本期无需微调、换模型或新增物理电子内核。

## 四、验收指标与发布门槛

指标分别按学科、题型和输入方式统计：关键符号正确率、事实提取 precision/recall、任务选择准确率、人工核对建模正确率、整题完成率、错误放行率、错误拒绝率、P50/P95 耗时、平均调用次数和预算耗尽率。

建议初始验收门槛如下，它们是实施目标而非已达到的结果：

1. 漏正数约束、错不等号方向、参考答案混入条件、非空初态被忽略、迟到响应覆盖修改等固定阻断测试全部通过。
2. 保留集上高数、408 各自的正确完整建模率均不低于基线；合计正确完整建模率相对基线提升至少 5 个百分点。若基线已接近上限，则改用错误数减少目标，并在查看新流程保留集结果之前确定。
3. 错误放行数不增加，拒绝率与完成率同时报告；不能靠大面积拒绝获得较高答案正确率。
4. P95 耗时初始目标不超过旧流程两倍；若不能满足，报告准确率/耗时取舍，默认模式暂不切换。
5. 旧文档读取、原图确认、交互模型、保存恢复、分享与自动判分门槛全部回归通过。

100 个原题组用于工程验收，不代表全部考试题分布；报告应列出计数和分母，不把小样本百分点解释为可靠的总体能力保证。

## 五、推荐交付批次

- **批次 A：任务 1—2。** 明确基线、契约和测试边界，不改变用户流程。
- **批次 B：任务 3—5。** 高数与 408 同时验证读题、专用建模、模型校验；先用离线评测验证。
- **批次 C：任务 6—7。** 接入真实产品，完成限次修复、兼容、保存和展示。
- **批次 D：任务 8。** 完成保留集评测与扩展说明，再决定默认启用。

执行前核对工作区现状与用户并行修改；每批只扩大必要范围。当前未测量硬件吞吐或多阶段推理耗时，因此不提供未经验证的工期或性能承诺。
