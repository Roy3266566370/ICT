# contracts —— 象生 v0.2 接口契约实物（T1）

唯一设计源：`.codeartsdoer/plans/xiangsheng-v0.2/plan.md` §2.2（2.2.0–2.2.11）、§3.1 T1。
本目录由 T1 独占，是前后端共同引用的**唯一共享数据基线**；目录内文件不含业务代码。

## 1. 文件清单

| 文件 | 对应契约 | 用途 | 消费方 |
|---|---|---|---|
| `schemas/knowledge_object.schema.json` | `C-KO@1`（§2.2.1） | `KnowledgeObject` / `Parameter` / `ParameterRange` / `SourceRef` / `ViewBinding` | T2（TS 类型）、T4、T5、T6、T7（Pydantic）、T10 |
| `schemas/run.schema.json` | `C-RUN@1`（§2.2.2） | `RunSnapshot` / `ValidationReport` / `CheckItem` / `CheckStatus` | T4、T7、T9、T10 |
| `schemas/template_matrix_2d.schema.json` | `C-MX@1`（§2.2.3） | `Matrix2dConfig` / `Matrix2dResult`（含 steps、composition、ellipse） | T5、T7、T8、T9、T10 |
| `schemas/template_force_2d.schema.json` | `C-FC@1`（§2.2.4） | `Force2dConfig` / `Force2dResult` | T6、T7、T8、T9 |
| `schemas/template_bfs_flow.schema.json` | `C-BFS@1`（§2.2.5） | `BfsFlowConfig` / `BfsFlowResult` / `BfsStep` 三分支 | T6、T7、T8、T9 |
| `schemas/template_budget_compare.schema.json` | `C-BUD@1`（§2.2.6） | `BudgetCompareConfig` / `AstNode` / `BudgetCompareResult` / `BudgetScenario` / `LineSeries` | T6、T7、T8、T9 |
| `openapi.yaml` | `C-API@1`（§2.2.7）+ `C-ERR@1`（§2.2.8） | 19 个 `/api/v1` 端点、统一响应包、8 个错误码枚举 | T2（客户端）、T3、T4、T7、T10、T13 |
| `../fixtures/examples/index.json` | §2.2.7 `TemplateDescriptor.example_id` | 四个手工示例的索引（example_id / template_id / file / golden_file） | T2（mockClient）、T3（场景卡） |
| `../fixtures/examples/{matrix_2d,force_2d,bfs_flow,budget_compare}.json` | `C-KO@1` | 四个 `manual_demo` 示例对象（可直接喂给 `KnowledgeObject` 校验） | T2、T3、T4、T5、T6 |
| `../fixtures/golden/{matrix_2d,force_2d,bfs_flow,budget_compare}.json` | §2.2.3–§2.2.6 黄金表 | 17 条黄金输入/输出，供 T9 `selftest.py` 逐项 PASS/FAIL | T8、T9、T13 |

## 2. 命名与版本约定

1. **字段名逐字复制 §2.2 的 TypeScript 声明**，全部为 `snake_case`（`object_id`、`schema_version`、`source_ref_ids`、`magnitude_rounded`、`angle_deg`、`terminated_reason`…）。不做 camelCase↔snake_case 自动转换，前端 `types.ts`、后端 Pydantic 模型、JSON 文件三处必须同名。
   > 注意：§2.2.1 的一句说明写"字段名用上面 camelCase 形式"，但同段所有声明都是 `snake_case`，且 §2.2.9 明确写"逐字一致（snake_case）"。本目录以**声明逐字一致**为最高优先级，见 §7 的 C-03。
2. **JSON Schema 使用 2020-12**，`$id` 带版本：`urn:xiangsheng:schema:knowledge_object:1`、`urn:xiangsheng:schema:run:1`、`urn:xiangsheng:schema:template_matrix_2d:1`、`urn:xiangsheng:schema:template_force_2d:1`、`urn:xiangsheng:schema:template_bfs_flow:1`、`urn:xiangsheng:schema:template_budget_compare:1`。契约破坏性变更必须换 `:2`。
3. **所有对象类型 `additionalProperties: false`**；未知字段一律拒绝（前后端都不许夹带私货）。
4. 模板 schema 的顶层形态是"模板绑定自检载荷"：`{ template_id, config, result? }`，`config` 必填、`result` 可选；具体结构在 `$defs` 中，可被单独 `$ref` 校验。
5. `run.schema.json` 通过相对引用复用 `knowledge_object.schema.json`（`input_snapshot`），`openapi.yaml` 通过相对引用复用两个 schema 文件，避免出现第二份真源。
6. 金额一律**十进制字符串**（`"9400.00"`、`"-600.00"`），JSON 里不出现浮点金额；力的大小入参同样是十进制字符串。

## 3. 与 §2.2 逐条对照 Checklist

图例：`✔` 完全一致（逐字）；`✔*` 一致但用 JSON Schema 无法表达、由 Pydantic/前端断言 + 自查脚本兜底；`△` 做了必要取舍，理由见 §7。

### 3.1 §2.2.0 契约索引

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| C-KO@1 / C-RUN@1 / C-MX@1 / C-FC@1 / C-BFS@1 / C-BUD@1 | 由 T1 提供 schema 文件 | ✔ 6 个 schema 文件 |
| C-ERR@1 | 由 T1 提供码表（并入 schema 的 enum） | ✔ `openapi.yaml` → `components.schemas.ErrorCode.enum`（8 个） |
| C-API@1 | T1 交付 OpenAPI 样例 | ✔ `openapi.yaml`（19 端点） |
| C-ENGINE@1 / C-MAT@1 / C-UI@1 / C-REG@1 | 非 T1 write_set | ✔ 未创建 |

### 3.2 §2.2.1 `C-KO@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| 字段 | 16 个：`schema_version, object_id, title, material_id, model_version, revision, template_id, kernel_version, config, parameters, views, bindings, source_refs, validation_profile, created_at, updated_at` | ✔ 逐字，全部 `required` |
| `TemplateId` | `matrix_2d｜force_2d｜bfs_flow｜budget_compare` | ✔ enum 4 值 |
| `Provenance` | `original｜inferred｜user_confirmed｜manual_demo` | ✔ enum 4 值 |
| `ParameterType` | 8 值：`matrix2, vector2, force_list, graph, integer, decimal, enum, text` | ✔ enum 8 值，且每个 `type` 用 `if/then` 联动约束 `value` 形状 |
| `SourceRef` | 8 字段：`id, provenance, label, material_id, page, element_id, bbox, excerpt` | ✔ 逐字；`id` 加 `^src_` 前缀约束，`excerpt` 加 `maxLength: 160` |
| `ParameterRange` | `min, max, step` + 可选 `min_decimal?, max_decimal?` | ✔ 前三个必填、后两个可选 |
| `Parameter` | 9 字段：`id, name, type, value, unit, range, source_ref_ids, provenance, editable` | ✔ 逐字；`source_ref_ids` 加 `minItems: 1` |
| `ViewBinding` | `parameter_id, view_id, target` | ✔ 逐字 |
| 规则 1 | `schema_version="0.2"`、`model_version≥1`、`revision≥0` | ✔ `const` + `minimum` |
| 规则 2 | `parameters[].id`、`source_refs[].id` 对象内唯一 | ✔* JSON Schema 无跨元素唯一性关键字；`views` 用 `uniqueItems` 表达可得部分，其余由 Pydantic/TS 断言保证 |
| 规则 3 | `bindings` 的 `parameter_id`/`view_id` 必须命中 | ✔* 跨数组引用无法在 JSON Schema 表达，写入 `description` 并列为 `MISSING_FIELD` 判定点；4 个示例对象已用脚本验证引用闭合 |
| 规则 4 | `config` 只写 `parameter_id` 字符串 | △ `config` 声明为 `{"type":"object"}`（文档为 `Record<string, unknown>`），逐模板形状由 `template_*.schema.json` 的 `$defs` 约束；不在 C-KO 里对 `config` 做 `oneOf` 外部引用，避免与 `Record<string, unknown>` 的字面声明冲突 |
| 规则 5 | `bbox` 仅在 `element_id≠null` 且 `page≠null` 时非空 | ✔ `SourceRef.allOf` 两条 `if/then`：任一为 `null` 则 `bbox` 必须为 `null` |
| 规则 6 | 参数级与来源级各一份 `provenance` | ✔ 两处独立字段 |
| 序列化 | 前后端一致、不自动转换 | ✔ snake_case（见 C-03） |

### 3.3 §2.2.2 `C-RUN@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| `RunSnapshot` | 9 字段：`run_id, object_id, model_version, revision, kernel_version, input_snapshot, result, validation_report, created_at` | ✔ 逐字全部必填；`input_snapshot` `$ref` → `knowledge_object.schema.json`；`result` 为开放形状（文档为 `unknown`） |
| `CheckStatus` | `pass｜fail｜not_covered｜stale` | ✔ enum 4 值 |
| `CheckItem` | `check_id, title, status, expected, actual, detail` | ✔ 逐字 |
| `ValidationReport` | 10 字段（含 `items`、`summary`、`is_stale`） | ✔ 逐字 |
| `summary` | `{ pass, fail, not_covered }` | ✔ 三个 `integer ≥ 0`；`stale` 不计入（见 C-04） |
| 语义 | `is_stale=true` 前端必须显示"过期"；`summary` 与 `items` 计数一致 | ✔ 写入 `description`（计数一致性无法用 JSON Schema 表达，属 Pydantic/前端断言） |

### 3.4 §2.2.3 `C-MX@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| `Matrix2dConfig` | `operation, matrix_parameter_id, second_matrix_parameter_id, compose_order, angle_unit` | ✔ 逐字；`operation=matrix_compose` 时 `second_matrix_parameter_id` 必须为字符串、`compose_order` 必须非 null，`matrix_apply` 时两者必须为 null（`if/then`） |
| `Matrix2dResult` | 12 字段：`ax, columns, det, trace, rank, eigenvalues, invertible, inverse, singular_reason, steps, composition, ellipse` | ✔ 逐字全部必填 |
| `rank` | `0｜1｜2` | ✔ `integer` + `enum` |
| `eigenvalues` | `{real:true,values:[n,n]}｜{real:false,reason}` | ✔ `oneOf` 两支，`real` 用 `const` |
| `steps` | 固定 2 项，`step:1/2` 与固定文案 | ✔ `prefixItems` + `items:false` + `minItems/maxItems:2`，`step`/`title` 用 `const` |
| `composition` | `null` 或 `{order, ab, ba, abx, bax, commutes}` | ✔ `order` 枚举仅两个顺序值（不含 null） |
| `ellipse` | `null` 或 `{a, b}` | ✔ |
| 规则 1–8 | 计算规则属 T8 职责 | ✔ 已把规则写成对应字段 `description`；`singular_reason`/`eigenvalues.reason` 的契约文案逐字引用 |
| 黄金表 6 例 | `mx_basic, mx_identity, mx_zero_vector, mx_singular, mx_noncommute, mx_textbook_s6` | ✔ 6 例全在 `fixtures/golden/matrix_2d.json`，id 与文档一致 |

### 3.5 §2.2.4 `C-FC@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| `Force2dConfig` | `operation, angle_unit, display_precision, compute_precision` | ✔ 逐字；`operation`/`angle_unit` 用 `const`，两个精度带 `default` |
| `force_list` 值形状 | `{ magnitude: string; angle_deg: number }[]`，长度 2..4 | ✔ `C-KO` 的 `Parameter.force_list` 分支 `minItems:2, maxItems:4`，`magnitude` 用非负十进制 pattern，`angle_deg` 用 `[0,360)` |
| `Force2dResult` | 12 字段（`forces, fx, fy, magnitude, magnitude_rounded, magnitude_exact, direction_deg, direction_rounded, direction_defined, cancel, note, tolerance`） | ✔ 逐字全部必填；`direction_deg`/`direction_rounded` 为 `null | 值` |
| `tolerance` | `1e-9` | ✔ 用 `const: 1e-9`（文档在类型位置写数值字面量，见 C-05） |
| 规则 1–5 | 计算与校验规则属 T8 | ✔ 写入 `description`；`cancel=true` 的 `note` 文案逐字固定 |
| 黄金表 3 例 | `fc_perpendicular, fc_cancel, fc_three` | ✔ 3 例全在 `fixtures/golden/force_2d.json` |

### 3.6 §2.2.5 `C-BFS@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| `BfsFlowConfig` | `operation, directed, start_node_id, neighbor_order, max_steps` | ✔ 逐字；`neighbor_order` 用 `const: lexicographic_by_id`；`max_steps` `1..200` |
| graph 值形状 | `{ nodes: {id,label}[]; edges: {from,to}[] }` | ✔ 在 `C-KO` 的 `graph` 分支：`nodes` `maxItems:20`、`edges` `maxItems:40` |
| `BfsFlowResult` | 11 字段（`order, enqueue_order, visited, unvisited, parent, level, edges_of_spanning_tree, rejected_edges, trace, terminated_reason, has_cycle`） | ✔ 逐字全部必填；`parent` 为 `object/string|null`、`level` 为 `object/integer` |
| `BfsStep` | 三分支：`dequeue{index,node,queue_after,visited_after}`、`enqueue{index,node,from,queue_after}`、`skip{index,node,from,reason}` | ✔ `oneOf` 三支，`kind` 用 `const`，`skip.reason` enum 3 值 |
| `terminated_reason` | `completed｜max_steps_reached` | ✔ enum 2 值 |
| 黄金表 3 例 | `bfs_golden, bfs_cycle, bfs_unreachable` | ✔ 3 例全在 `fixtures/golden/bfs_flow.json`（任务书称 `bfs_diamond`，见 C-10） |

### 3.7 §2.2.6 `C-BUD@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| `BudgetCompareConfig` | `operation, scenarios, budget_limit_parameter_id` | ✔ 逐字；`scenarios` 用 `prefixItems` 固定 `["plan_a","plan_b"]`；`budget_limit_parameter_id` 为 `string|null` |
| `AstNode` | `constant｜ref｜add｜multiply` 四分支 | ✔ 递归 `oneOf` 四支；`add`/`multiply` 的 `args` 为 `AstNode[]` 且 `minItems:2`；未知 `op` 直接校验失败 |
| `BudgetCompareResult` | 9 字段（`inputs, scenarios, difference, equal, budget_limit, remaining, over_budget, lines, display_precision`） | ✔ 逐字全部必填 |
| `BudgetScenario` | 5 字段（`scenario_id, name, total, per_person, fixed`） | ✔ 逐字；`scenarios` 顺序固定 plan_a→plan_b（与 `remaining`/`over_budget`/`lines` 一一对应） |
| `LineSeries` | `scenario_id, at_zero, at_max, slope` | ✔ 逐字，金额字段均为十进制字符串 |
| 规则 1–7 | Decimal 计算、AST 白名单、范围、格式化为 `"9400.00"` | ✔ 写入 `description`；金额用 `DecimalString` pattern，浮点金额在校验层即被拒绝 |
| 黄金表 5 例 | `bd_n80, bd_n100, bd_limit_ok, bd_over_budget, bd_cycle` | ✔ 5 例全在 `fixtures/golden/budget_compare.json`（任务书称 `bud_breakeven`，见 C-10） |
| AST 入参 | §2.2.9 `budget_compare(ast_a, ast_b, parameters, people, budget_limit, display_precision)` | △ 文档未定义 AST 存放位置（C-06）：golden `input` 用命名表达式表 `expressions.{plan_a,plan_b}`；示例对象 `config` 保持逐字三字段、**不携带 AST** |

### 3.8 §2.2.7 `C-API@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| 统一成功包 | `{ data, request_id }` | ✔ `components.schemas.ApiSuccess`（`additionalProperties:false`），每个端点用 `allOf` 覆盖 `data` |
| 统一错误包 | `{ error: { code, message, retryable, details? }, request_id }` | ✔ `components.schemas.ApiError` / `ErrorBody`；`request_id` 在顶层（见 C-07） |
| 端点 #1–#19 | 19 个 | ✔ 19 个 operation（分布在 16 个 path 条目），编号与表格逐条对应 |
| #1 `POST /sessions` | `200 SessionInfo`，auth N | ✔ `security: []` |
| #2 `GET /sessions/current` | `200 {session_id, expires_at, csrf_token}` | △ 返回 `SessionInfo`（多 `retention_hours`），见 C-02 |
| #3 `GET /templates` | `200 TemplateDescriptor[]` | ✔ auth N |
| #4 `POST /examples/{example_id}/clone` | `201 {material_id, object_id}` | ✔ |
| #5 `POST /materials` | multipart `file` → `202 {material_id, job_id}` | ✔ `INVALID_FILE`/`LIMIT_EXCEEDED` 已挂 400/413 |
| #6 `GET /materials` | `limit?` → `200 {items, retention_expires_at}` | ✔ |
| #7 `GET /materials/{id}` | `200 MaterialDetail`，404 | ✔ |
| #8 `DELETE /materials/{id}` | `204` 无体 | ✔ 无 `content` |
| #9 `GET /materials/{id}/assets/{asset_id}` | `200` 二进制 png/jpeg | ✔ 仅 `image/png`、`image/jpeg` |
| #10 `GET /jobs/{id}` | `200 JobStatus` | ✔ |
| #11 `POST /jobs/{id}/retry` | `202 {job_id, attempt}` | ✔ |
| #12 `GET /objects/{id}` | `200 {object, checks_summary}` | ✔ `ObjectWithChecks` |
| #13 `PUT /objects/{id}/model` | `{expected_version, object}` → `200 {object}` | ✔ 409 `VERSION_CONFLICT`、422 `MISSING_FIELD` |
| #14 `POST /objects/{id}/compile` | `{model_version}` → `202 {job_id}` | ✔ |
| #15 `POST /objects/{id}/runs` | `{model_version, revision, input_snapshot, result?}` → `201 RunSnapshot` | ✔ `result` 为可选入参，`description` 写明服务端重算覆盖 |
| #16 `GET /objects/{id}/runs` | `limit?` → `200 {items}` | ✔ |
| #17 `GET /runs/{run_id}` | `200 RunSnapshot` | ✔ |
| #18 `POST /objects/{id}/validate` | `{model_version, revision}` → `200 ValidationReport` | ✔ 同步，不建 job |
| #19 `GET /objects/{id}/checks` | `200 {items: ValidationReport[]}` | ✔ |
| 关键结构 | `SessionInfo, TemplateDescriptor, MaterialSummary, MaterialDetail, SlidePage, SlideElement, CandidateObject, JobStage, JobStatus` | ✔ 字段逐字复制；`TemplateDescriptor` 8 字段、`JobStatus` 8 字段、`JobStage` 9 值 |
| 契约级行为 1–6 | `data` 包裹、CSRF+Origin、`result` 服务端覆盖、validate 同步、`limit` 默认 20/最大 50、asset 归属校验 | ✔ 写入 `info.description` 与对应 `operation.description` |
| **P1 追加** | `MaterialSummary` 增加两个**可选**属性：`template_id`（`string`，enum 四模板）、`run_count`（`integer`，`minimum: 0`） | ✔ 未改 `required`（仍 7 项）、未改 `additionalProperties: false`、未升版本号；理由与兼容性论证见 §3.8.1 |
| **P2 追加** | 新增 2 个端点：`GET /materials/{id}/regions`、`PATCH /materials/{id}/regions/{region_id}`（区域确认/纠正持久化） | ✔ 只加说明、不动 schema；未改任何既有 operation 与 `PageRegion` 形状；理由与持久化/失效机制见 §3.8.2 |

#### 3.8.1 P1 追加记录：`MaterialSummary.template_id` / `run_count`（向后兼容，不升版本号）

- **为什么加**：R2-AC2 要求空间页"列出当前会话的材料、最近运行"，原 `MaterialSummary` 承载不了这两类信息，只能靠前端补请求：
  - `template_id`：空间页要显示材料归属场景（「空间与矩阵」等）。原契约得先拿到 `object_id` 再打 `GET /objects/{object_id}`，20 条材料会变成 20 次附带请求。
  - `run_count`：空间页要显示"已保存 N 次运行"。原契约只能逐对象调 `GET /objects/{id}/runs` 再自行计数。
- **为什么是可选而非必填**：材料在 `processing` / `awaiting_confirmation` 阶段可能尚未确认模板，`run_count` 也可能尚未统计。若设必填，服务端会被迫返回伪造的 `0` 或 `null`——违反 R1-AC6（不得出现未经验证的指标）与 §2.3.6"不编造"。因此两字段均为**可选**：**缺键 = 未知/不适用，不等于 0**。
- **向后兼容论证**：
  1. `required` 未变，旧客户端只读原有 7 个字段，不感知新键；
  2. `additionalProperties` 仍为 `false`，新字段显式声明，未放松"拒绝未知字段"的防线；
  3. schema `$id` 与 openapi `info.version`（`0.2.0`）均未变，符合 §2.2 开头"一经放行即冻结，后续只做向后兼容的澄清"；
  4. 唯一语义风险是客户端把"缺键"误读为 `0`，已在两个字段的 `description` 里写明，T3 渲染时按"未知"处理（不显示 `0 次运行`）。
- **影响面**：`MaterialSummary` 被 `MaterialList.items`（端点 #6）与 `MaterialDetail.material`（端点 #7）两处 `$ref` 引用，两个端点响应自动获得该能力；`contracts/schemas/*.json` 中**不存在** `MaterialSummary` 定义，故 6 个 JSON Schema 全部未改动；`fixtures/` 不含 `MaterialSummary` 载荷，17 条黄金用例与 4 个示例对象不受影响。

#### 3.8.2 P2 追加记录：区域确认/纠正持久化端点（向后兼容追加，不升版本号、不改任何 schema）

- **为什么加**：`C-API@1` 原有 19 个端点没有任何"区域（`PageRegion`）确认/纠正"的写入能力。rebuild-spec §2 第 5 条要求"能确认区域与参数，识别错了能改，不支持的有明确状态"，而前端只能把修正写进 `sessionStorage`——换标签页、刷新、重启即丢失，工作台仍按识别基线渲染。为补齐第 5 条，**新增两个端点**（不改既有端点、不改 `contracts/schemas/*.json`、不改 §4 的 `PageRegion` 形状）：
  - `GET /api/v1/materials/{material_id}/regions` → `200 {material_id, baseline_source, page_count, regions[], invalidated_region_ids[]}`；`regions[]` 为基线 `PageRegion` 字段 + 追加字段 `status`（覆盖后）、`parameter_overrides`、`has_override`、`note`、`updated_at`、`fact_signature`。
  - `PATCH /api/v1/materials/{material_id}/regions/{region_id}`，请求体 `{status?: "confirmed"|"static_only", parameter_overrides?: object, note?: string}` → `200 {region_id, status, parameter_overrides, note, updated_at, fact_signature}`。
- **为什么是追加语义**：既有客户端不认识新端点即不调用，旧响应完全不变；新字段只出现在新增端点响应里，不进入任何既有 `$ref`。`required`、`additionalProperties`、`$id` 与 `openapi.info.version`（`0.2.0`）均未修改。
- **错误约定**：归属校验失败复用 D2（404 + `SESSION_EXPIRED`）；区域不存在 → 404 + `MISSING_FIELD`；非法 `status` → 422 + `MISSING_FIELD`；写请求沿用 `X-CSRF-Token` + Origin 校验。
- **持久化位置（刻意不写 9 张共享表）**：`backend/data/regions/<material_id>.json`，形状 `{region_id: {status, parameter_overrides, note, updated_at, fact_signature}}`，先写 `.tmp` 再 `os.replace` 原子替换。基线 `fixtures/materials/**/regions.json` 与 `data/renders/<material_id>/regions.json` 保持只读。
- **覆盖失效机制**：每条覆盖保存 `fact_signature = sha1(page_count | bbox.x,y,w,h | script_id)[:12]`。重新解析后页数 / bbox / script_id 任一变化即指纹不符，读取时忽略该覆盖（不回放旧确认），下次 PATCH 以新签名重写。
- **请求体字段名**：响应一律 snake_case（`parameter_overrides`）。为兼容任务书里出现的 `parameterOverrides` 写法，请求体两个键名都接受（`AliasChoices`），未知字段仍 422。
- **影响面**：前端仅 `api/types.ts`、`api/client.ts`、`api/hooks.ts`、`api/mockClient.ts`、`components/reader/regionData.ts`、`pages/PreparePage.tsx` 使用；`fixtures/**` 未修改；无新依赖。

### 3.9 §2.2.8 `C-ERR@1`

| 条款 | 要求 | 落盘结果 |
|---|---|---|
| 码表 | 8 个：`INVALID_FILE, LIMIT_EXCEEDED, PARSE_FAILED, MODEL_UNAVAILABLE, UNSUPPORTED_TEMPLATE, MISSING_FIELD, VERSION_CONFLICT, SESSION_EXPIRED` | ✔ `ErrorCode.enum` 顺序与文档一致 |
| HTTP / retryable 映射 | 400/413/422/503/422/422/409/401；`retryable` 仅 `PARSE_FAILED`、`MODEL_UNAVAILABLE` 为 true | ✔ 写入 `ErrorCode.description` 与 `ErrorBody.retryable.description` |
| 归属失败响应 | HTTP 404 + `code=SESSION_EXPIRED`、`message="资源不可用"` | ✔ 写入 `Error404` 与 `ApiError` 说明（同一 code 两个 HTTP 状态，见 C-08） |

### 3.10 §2.2.9–§2.2.11（非 T1 write_set）

| 条款 | 处置 |
|---|---|
| §2.2.9 `C-ENGINE@1` | 不在 T1 write_set。本目录的模板 schema 即 T8 返回值字段名的判定基准（`description` 里已写明规则编号） |
| §2.2.10 `C-MAT@1` | 不在 T1 write_set（属 T11 `fixtures/materials/`）。**未创建**，`fixtures/ppt/` 只读且未被修改 |
| §2.2.11 `C-UI@1` | 不在 T1 write_set（属 T2），未创建 |

### 3.11 §3.1 T1 `acceptance_and_local_checks` 逐条

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 所有 JSON 可解析，字段名与 §2.2 逐字一致 | ✔ 15 个 JSON 全部可解析；字段名逐字复制 |
| 2 | 黄金 `expected` 与黄金表数值一致，含 `mx_noncommute` 的 `abx=[3,2]`/`bax=[2,3]` | ✔ 17 例；`mx_noncommute` 已用 `A·B`、`B·A`、`(AB)x`、`(BA)x` 独立重算验证 |
| 3 | 四个示例对象 `provenance="manual_demo"`、`material_id=null`、`page=null`、`bbox=null` | ✔ 8 个断言全 PASS（参数级与来源级 provenance 均为 `manual_demo`） |
| 4 | `openapi.yaml` 路径集合与 19 个端点一致，含 8 个错误码 | ✔ 19 个 operation / 16 个 path 条目；`ErrorCode.enum` 长度 8 |
| 5 | `fixtures/ppt/` 不被修改 | ✔ 未写入该目录 |

## 4. 黄金用例索引（17 例）

| 模板 | 用例 id | 断言要点 |
|---|---|---|
| matrix_2d | `mx_basic` | `ax=[2,1]`、`det=1`、`trace=2`、`rank=2`、`eigenvalues=[1,1]`、`invertible=true`、`steps[0].terms` 与文档一致 |
| matrix_2d | `mx_identity` | `ax=[2,-1]`、`rank=2`（单位矩阵不特判） |
| matrix_2d | `mx_zero_vector` | `ax=[0,0]`、`steps[1].partial=[0,0]` |
| matrix_2d | `mx_singular` | `det=0`、`rank=1`、`invertible=false`、`inverse=null`、`singular_reason` 非空、`ellipse=null` |
| matrix_2d | `mx_noncommute` | `ab=[[2,1],[1,1]]`、`ba=[[1,1],[1,2]]`、`abx=[3,2]`、`bax=[2,3]`、`commutes=false` |
| matrix_2d | `mx_textbook_s6` | `ax=[3,3]`、`eigenvalues=[1,3]`、`det=3`、`trace=4`（PPT 第 6 页） |
| force_2d | `fc_perpendicular` | `fx=10`、`fy=10`、`magnitude=14.142135623730951`（10√2）、`magnitude_rounded="14.14"`、`magnitude_exact="14.142136"`、`direction_deg=45`、`cancel=false` |
| force_2d | `fc_cancel` | `magnitude=0`、`cancel=true`、`direction_deg=null`、`direction_defined=false`、`note` 固定文案 |
| force_2d | `fc_three` | `fx=8`、`fy=4`、`magnitude=8.94427190999916`、`direction_deg=26.56505117707799` |
| bfs_flow | `bfs_golden` | `order=["A","B","C","D"]`、`enqueue_order` 中 D 只出现一次、`parent={A:null,B:A,C:A,D:B}`、`rejected_edges` 含 `{from:"C",to:"D",reason:"D 已在队列中"}` |
| bfs_flow | `bfs_cycle` | `order=["A","B","C"]`、`has_cycle=true`、`terminated_reason="completed"` |
| bfs_flow | `bfs_unreachable` | `order=["A","B"]`、`unvisited=["C"]` |
| budget_compare | `bd_n80` | `total_a="9400.00"`、`total_b="10000.00"`、`difference="-600.00"`、`remaining=null`、`over_budget=null` |
| budget_compare | `bd_n100` | 两方案均 `"11000.00"`、`difference="0.00"`、`equal=true`（平衡点） |
| budget_compare | `bd_limit_ok` | `remaining=["600.00","0.00"]`、`over_budget=[false,false]` |
| budget_compare | `bd_over_budget` | `remaining=["-4400.00","-5000.00"]`、`over_budget=[true,true]` |
| budget_compare | `bd_cycle` | `MISSING_FIELD`、`message_contains="循环依赖"`、`field="plan_a"` |

## 5. 验收命令与输出

在仓库根 `E:\代码\ICT` 执行：

```bash
python -c "import json,glob;fs=glob.glob('contracts/**/*.json',recursive=True)+glob.glob('fixtures/examples/*.json')+glob.glob('fixtures/golden/*.json');[json.load(open(p,encoding='utf-8')) for p in fs];print('JSON OK',len(fs))"
python -c "import yaml,sys;d=yaml.safe_load(open('contracts/openapi.yaml',encoding='utf-8'));print('paths',len(d['paths']))"
```

真实输出：

```
JSON OK 15
paths 16
```

`JSON OK 15` = 6 个 schema + `examples/index.json` + 4 个示例对象 + 4 个黄金文件。

`paths 16` 是 **path 条目数**，不是端点数：§2.2.7 的 19 个端点里，`/materials`、`/materials/{material_id}`、`/objects/{object_id}/runs` 三个路径各承载 2 个方法。用下面的命令统计方法级端点数：

```bash
python -c "import yaml;d=yaml.safe_load(open('contracts/openapi.yaml',encoding='utf-8'));m=('get','post','put','delete','patch');print('endpoints',sum(1 for v in d['paths'].values() for k in v if k in m))"
# endpoints 19
```

补充自检（T1 本地执行，非交付物）：

- 用 `jsonschema.Draft202012Validator` 校验 4 个示例对象 → `KnowledgeObject` 错误数 0，各模板 `config` 错误数 0；`material_id`/`page`/`bbox` 全为 `null`、provenance 全为 `manual_demo`、`bindings` 引用闭合，共 8 条断言全 PASS。
- 独立重算 17 条黄金数值（矩阵用标量公式、力用 `math.cos/sin/atan2`、BFS 用 `collections.deque`、预算用 `Decimal` + `ROUND_HALF_UP`）→ `FAILS = 0`，全部 PASS。

## 6. 下游使用提示

- **T2（前端类型与 mockClient）**：`frontend/src/api/types.ts` 从 §2.2 的 TS 声明复制，字段名与这 6 个 schema 完全同名。mock 时读 `fixtures/examples/index.json` → `file` 指定的对象，`example_id` 与 `TemplateDescriptor.example_id` 对齐；`golden_file` 供本地断言使用。
- **T5/T6（模板组件）**：`result` 形状以 `template_*.schema.json#/$defs/*Result` 为准，不要自行增删字段；`ParamControl` 的 `range` 直接读 `Parameter.range`。
- **T7（Pydantic）**：建议用 `extra="forbid"` 对齐 `additionalProperties: false`；`Parameter.value` 用按 `type` 的判别联合（`Field(discriminator="type")` 或 `model_validator`）。
- **T8（内核）**：返回值 dict 的键必须与本目录 `$defs` 中对应字段逐字一致；`KernelError.code` 取 §2.2.8 八码之一。
- **T9（selftest）**：直接遍历 `fixtures/golden/*.json`，对 `expected` 做**子集比对**（expected 只包含该用例声明的断言项），浮点比较用 `1e-9`，金额用 `Decimal` 精确比较。
- **T10（路由）**：`openapi.yaml` 的 19 个 operation 即路由清单；204 端点不得返回 body。

## 7. 契约内部矛盾与待决策项（**未自行修改契约**）

以下条目均已在落盘时做出"最小保守处置"，但需要 Team Leader 确认。编号供后续讨论引用。

| 编号 | 位置 | 矛盾描述 | 本任务处置 | 待决策 |
|---|---|---|---|---|
| **C-01** | §2.2.7 端点表 vs `TemplateDescriptor.schema_path` 注释 | 注释提到"`/api/v1/templates/{id}/schema` 之外仅供调试展示"，暗示存在第 20 个端点，但端点表只列 19 个 | 按 19 个落盘，`schema_path` 指向 `contracts/schemas/...` 文件路径，不新增端点 | 是否需要补 `GET /api/v1/templates/{id}/schema`（会变成 20 端点） |
| **C-02** | §2.2.7 #2 vs `SessionInfo` | #2 响应表只列 `{session_id, expires_at, csrf_token}`，但 `SessionInfo` 有 4 字段（多 `retention_hours`） | #2 返回 `SessionInfo`（向后兼容超集） | 若要求严格 3 字段，需新增 `SessionCurrent` 类型 |
| **C-03** | §2.2.1 序列化说明 vs 全部 TS 声明 / §2.2.9 | §2.2.1 写"字段名用上面 camelCase 形式"，但同段声明全为 `snake_case`，§2.2.9 明确写"逐字一致（snake_case）" | 以**声明逐字**为准 = `snake_case`；任务书要求的 camelCase 与文档声明冲突 | 建议把 §2.2.1 该句改为 "snake_case"，仅涉及文档措辞 |
| **C-04** | §2.2.2 `summary` vs `CheckStatus` | `CheckStatus` 有 4 值，`summary` 只有 `pass/fail/not_covered` 三个计数，`stale` 无处计数 | `summary` 按文档保持 3 个计数；`stale` 只由 `is_stale` 表达 | 是否需要 `summary.stale`（会破坏已冻结形状） |
| **C-05** | §2.2.4 `tolerance: 1e-9;` | 在 TypeScript 接口里把数值字面量写在类型位置（非法 TS），语义应为"固定容差常量" | 用 `const: 1e-9` 表达 | 文档该行应改为 `tolerance: number` 或直接移除 |
| **C-06** | §2.2.6 config vs §2.2.9 内核签名 vs R9-AC7 | config 只有 `operation/scenarios/budget_limit_parameter_id`，**未定义 AST 存放位置**；但内核要 `ast_a/ast_b`，且要求检测循环依赖 | config 保持逐字三字段不变；golden `input` 增加 `expressions.{plan_a,plan_b}` 命名表达式表（唯一能表达"自引用"的形状，同时覆盖 constant/ref/add/multiply 四节点）；示例对象**不携带 AST**，由前端 domain 按 `fixed + per_person × n` 构造 | 建议在 config 增补 `expression_a`/`expression_b`（AstNode）或明确"AST 由前端按固定模板构造" |
| **C-07** | §2.2.7 `ApiError` vs 任务书表述 | 契约 TS 中 `request_id` 在**顶层**；任务书写作 `{error:{code,message,retryable,request_id}}` | 按契约顶层；错误对象内只有 `code/message/retryable/details` | 确认前端按顶层读 `request_id` |
| **C-08** | §2.2.8 表 vs 末段 / D2 | `SESSION_EXPIRED` 表中 HTTP=401，末段与 D2 又规定归属失败返回 **404** 且 code 仍是 `SESSION_EXPIRED` | 两个响应都定义；404 的 description 写明该特殊约定 | 消费者需按 HTTP 状态区分"会话过期"与"资源不可用"，确认前端逻辑 |
| **C-09** | §2.2.7 契约级行为 2 | 原文"不满足返回 403 + `INVALID_FILE` 之外的专用码仍复用 `SESSION_EXPIRED`（会话无效时）或 `MISSING_FIELD`（缺 token）"同时提到 403、401、422，无法同时成立 | 按语义落盘：会话无效→401/404 `SESSION_EXPIRED`；缺 token→422 `MISSING_FIELD`；未定义 403 | 需明确 CSRF 失败到底返回 403（无专用码）还是 422 |
| **C-10** | 黄金用例命名 | 文档表命名 `bfs_golden` / `bd_n100`，任务书称 `bfs_diamond` / `bud_breakeven` | 用**文档表命名**（任务书亦声明"以文档实际命名为准"），在两个用例的 `notes` 里写明任务书别名 | 确认下游 selftest 按文档 id 匹配 |
| **C-11** | §2.2.3 `steps[1].partial` | 语义未定义，黄金表只给了 `mx_zero_vector` 的 `[0,0]`（两种解释在零向量下相同） | 定义为"第一项（column_index=0）执行后的部分和"；`mx_basic` 取 `[1,0]`，并在 `notes` 写明 | 若 T8 期望 `partial == result`，需改 `mx_basic` 的 `[1,0]` |
| **C-12** | §2.2.3 `compose_order` vs §2.3.6 | `A_then_B` 与"AB 表示先 B 后 A"的映射未显式写出 | 只把 §2.3.6 原文引用到 `description`，不改枚举语义；golden 同时给出 `ab`/`ba`/`abx`/`bax`，不依赖 `order` 判定 | 建议补一句"`A_then_B` 对应界面展示 BA 路径" |
| **C-13** | `fixtures/examples/index.json` | §2.2 未定义示例索引结构，也未定义 `example_id` 命名（仅 `TemplateDescriptor.example_id` 引用它） | 自定义：`{schema_version, examples:[{example_id, template_id, kernel_version, scenario_slug, name, headline, summary, object_id, material_id, provenance, file, golden_file, golden_case_ids}]}` | T3/T2 若已有约定需对齐 |
| **C-14** | `validation_profile` | 字段存在但取值集合未枚举 | 暂定 `{matrix_2d,force_2d,bfs_flow,budget_compare}_v1_full`，示例对象采用 | 若 T9 需要固定取值清单，请确认命名 |
| **C-15** | §2.2.1 `config` 类型 vs 模板契约 | `config` 声明为 `Record<string, unknown>`，但每个模板都有确定形状 | 顶层 `{"type":"object"}` + 指向模板 schema 的 `description`，不做 `oneOf` 外部引用 | 若希望 schema 层强校验 config，可改为 `oneOf` 引用四个模板 config（会增加校验器的外部解析依赖） |

## 8. 明确未做的事

- 未创建 `frontend/`、`backend/`、`deploy/` 下任何文件（不属 T1）。
- 未创建 `fixtures/materials/`（属 T11）。
- 未修改 `fixtures/ppt/`（只读基线）。
- 未写任何业务代码；本目录只有契约与夹具。