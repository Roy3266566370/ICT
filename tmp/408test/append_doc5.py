# -*- coding: utf-8 -*-
block = """

## 第五轮：高数大题（非选择题）端到端（2026-11-20）

13 道大题（计算题/综合题/应用题/讨论题，带「（N分）解：」版面、无选项）：12/13 首传即正确路由，剩余 1 个 OCR 变体修复后 **13/13 端到端全对**（needs_review 均为图片源公式核对门）。

| 图 | 题型 | engine·task | 答案 |
| --- | --- | --- | --- |
| m5a | 数列极限 n(√(n²+1)−n) | analysis_v1·sequence_limit | 1/2 |
| m5b | 交错级数敛散 | series_v1·series_convergence | 条件收敛，和 −ln2 |
| m5c | 旋转曲面面积 | integral_applications_v1·surface_of_revolution | π(5√5−1)/6 |
| m5d | 极坐标弧长 r=e^θ | integral_applications_v1·polar_arc_length | √2(e−1) |
| m5e | 函数性态综合 | analysis_v1·function_study | 单调/极值/凹凸/拐点全报 |
| m5f | x=1 处 3 阶泰勒 | analysis_v1·taylor | e·Σ(x−1)ᵏ/k! |
| m5g | 分段连续性 | analysis_v1(continuity) | x=0 连续，两侧极限 0 |
| m5h | 两曲线围成面积 | sympy·geometric_area | 1/6 |
| m5i | 绕 y 轴旋转体 | sympy·area_volume | 8π |
| m5j | 不定积分 ∫x²eˣdx | antiderivative_v1 | (x²−2x+2)eˣ+C |
| m5k | 洛必达型极限 | analysis_v1·limit | 1/2 |
| m5l | 三角域二重积分 | double_integral_v1 | 1/8 |
| m5m | 多小问综合 | analysis_v1·function_study | 两问合并报告（多小问门 pending_ai，预期） |

### 本轮修复（47–57 号）

1. **大题静默错答链路**：「（N分）」分值括号未剥 → 表达式解析失败 → `calculus_analysis` 静默回退裸 `x` → 照常算出错误答案（seq 答发散、lim 答 0）。修复：剥尾部 `（N分）`/`。\s*$` 与分值标注；解析失败的题不再用 `x` 兜底给误导性答案。
2. **`sqrt(` 被插乘号误伤**：隐式乘法规则把函数名末尾字母+`(` 当成 `n(` → `sqr*t(`；限缩为真变量上下文。
3. **几何面积 builder**：两曲线求交由 `sp.solve` 求解失败（parse_expression 生成的符号带 assumptions，`sp.Symbol('x')` 是不同符号）→ 改用 `f.free_symbols`；上下曲线按中点值排序。
4. **旋转体 y 轴**：`y=x²,y=0,x=2` 边界枚举此前无合成路径 → 交点+竖直线合成区间。
5. **二重积分「D由…围成」**：边界直线枚举合成三角形/梯形域 bounds（`y=x, y=0, x=1` → `0≤x≤1, 0≤y≤x`）。
6. **continuity 尾注**：`(x≠0)` 定义域限定泄漏进表达式 → 剥除。
7. **泰勒非零点浮点残差**：`taylor_point` 存 `1.00000000000000` Float → 双侧极限检验浮点残差≠0 误报「一阶导数不存在」→ 精确 Rational。
8. **学科消歧对称规则**：「单调区间+极值」性态综合此前被 `极值` 裸词掀去 optimization → 有 `单调/凹凸/拐点` 词时归 calculus（function_study 全覆盖）。
9. **新 builder**：sequence_limit/series_convergence(交错)/surface_of_revolution/polar_arc_length/continuity/geometric_area/rotation_volume(y轴)/multivariable study 文本路由。
10. **`lim 尾 `（）`/解：` 答题区残留剥除**（大题版式）。
11. **OCR `θ→日`**：`0≤日≤1` 极坐标上下文归一回 θ。

### 回归

- `test_round5_big_questions`/`_enclosed_regions`/`_analysis_repairs`/`_ocr_theta_as_ri` 4 个回归函数
- 受影响套件（p5_space/integral_recognition/p1_analysis）65 过、0 失败

### 累计

五轮 62 题端到端全对；路由/识别/求解缺陷修复 57 项。
"""
open(r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md', 'a', encoding='utf-8').write(block)
print('ok')
