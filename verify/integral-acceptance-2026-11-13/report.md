# 独立积分验收集报告

生成时间：2026-11-13T10:33:24+00:00

- 题目数：31
- 通过：31
- 未通过：0

## 错误类型统计

| 类型 | 受影响题目数 |
| --- | ---: |
| 答案错误（answer_error） | 0 |
| 步骤错误（step_error） | 0 |
| 误判不支持（false_unsupported） | 0 |
| 条件丢失（condition_loss） | 0 |
| 条件/定义域被擅自扩写（condition_extra） | 0 |
| 验证等级错误（verification_error） | 0 |
| 答案/图形/改参不一致（consistency_error） | 0 |
| 运行异常（exception） | 0 |

## 分类结果

| 分类 | 题数 | 通过 | 未通过 |
| --- | ---: | ---: | ---: |
| 换元 | 3 | 3 | 0 |
| 分部 | 5 | 5 | 0 |
| 对数 | 4 | 4 | 0 |
| 根式 | 4 | 4 | 0 |
| 周期函数 | 3 | 3 | 0 |
| 特殊函数 | 3 | 3 | 0 |
| 非初等 | 3 | 3 | 0 |
| 瑕点 | 4 | 4 | 0 |
| 反向区间 | 2 | 2 | 0 |

## 逐题结果

| 编号 | 分类 | 任务 | 状态 | 验证等级 | 方法 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| sub-poly-exp | 换元 | antiderivative | complete | symbolic | method-substitution, method-substitution-integrate, method-substitution-back | 通过 |
| sub-linear-trig | 换元 | antiderivative | complete | symbolic | method-substitution, method-substitution-integrate, method-substitution-back | 通过 |
| sub-radical | 换元 | antiderivative | complete | symbolic | method-substitution, method-substitution-integrate, method-substitution-back | 通过 |
| parts-xcos | 分部 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| parts-x2exp | 分部 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| parts-log | 分部 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| parts-xlog | 分部 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| parts-atan | 分部 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| log-recip | 对数 | antiderivative | complete | symbolic | — | 通过 |
| log-nested | 对数 | antiderivative | complete | numeric | method-substitution, method-substitution-integrate, method-substitution-back | 通过 |
| log-over-x | 对数 | antiderivative | complete | symbolic | method-substitution, method-substitution-integrate, method-substitution-back | 通过 |
| log-square | 对数 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| radical-sqrt | 根式 | antiderivative | complete | symbolic | — | 通过 |
| radical-shift | 根式 | antiderivative | complete | symbolic | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| radical-asin | 根式 | antiderivative | complete | symbolic | — | 通过 |
| periodic-sin2 | 周期函数 | antiderivative | complete | symbolic | — | 通过 |
| periodic-tan | 周期函数 | antiderivative | complete | symbolic | — | 通过 |
| periodic-sec2 | 周期函数 | antiderivative | complete | symbolic | — | 通过 |
| special-gauss | 特殊函数 | antiderivative | complete | symbolic | — | 通过 |
| special-sinc | 特殊函数 | antiderivative | complete | symbolic | — | 通过 |
| non-elementary-power | 非初等 | antiderivative | unsupported | unconfirmed | — | 通过 |
| non-elementary-sin1x | 非初等 | antiderivative | unsupported | unconfirmed | — | 通过 |
| def-log-endpoint | 瑕点 | integral | complete | — | method-parts-choose, method-parts-duv, method-parts-formula, method-parts-finish | 通过 |
| def-sqrt-endpoint | 瑕点 | integral | complete | — | — | 通过 |
| def-tan-divergent | 瑕点 | integral | divergent | — | — | 通过 |
| def-recip-divergent | 瑕点 | integral | divergent | — | — | 通过 |
| def-reversed-poly | 反向区间 | integral | complete | — | — | 通过 |
| def-reversed-sin | 反向区间 | integral | complete | — | — | 通过 |
| def-gauss | 特殊函数 | integral | complete | — | — | 通过 |
| def-sqrt-square | 根式 | integral | complete | — | — | 通过 |
| def-power-unsupported | 非初等 | integral | unsupported | — | — | 通过 |

## 未通过详情

本批次没有未通过题目。

## 口径与限制

- 验收题由人工按数学分类选取，不是随机抽样，不能代表所有题型。
- 期望原函数用 SymPy 结构比较；相差常数视为同一原函数族。
- 数值抽查阅验只说明样本点一致，不是全域证明；等级字段单独标注。
- 定积分图形评估按当前分割数核对，分割数误差不代表解析值错误。
- 未覆盖多元积分、参数积分、复积分和需要人工指定分支的题目。
