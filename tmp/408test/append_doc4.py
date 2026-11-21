# -*- coding: utf-8 -*-
path = r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md'
block = '''

## 第四轮：应用与参数化题型（13 题，全部通过）

| # | 题型 | engine·task | 确定性答案 |
| --- | --- | --- | --- |
| m4a | 球面坐标三重积分 ∭_Ω dV | space_v1·triple_integral | 4π/3 |
| m4b | 图形面通量积分（上侧） | space_v1·surface_integral | 1 |
| m4c | 椭圆域格林公式 | space_v1·green | 4π |
| m4d | 一阶 ODE 初值特解 | ode_v1 | y=2eˣ（初值核验通过） |
| m4e | 参数方程 dy/dx | derivative_extra_v1·parametric_derivative | 3/2 |
| m4f | 显式曲线弧长 | integral_applications_v1·arc_length | (80√10−8)/27 |
| m4g | 有理函数渐近线 | limit_extra_v1·asymptote | x=1, y=2 |
| m4h | 曲率与曲率半径 | derivative_extra_v1·curvature | κ=2√5/25 |
| m4i | 双变限 Leibniz | integral_function_v1 | F'(x)=2x³−x |
| m4j | 极坐标面积 | integral_applications_v1·polar_area | π |
| m4k | 三阶导数 | analysis_v1·higher_derivative | −8cos(2x) |
| m4l | 隐函数法线 | sympy·implicit_normal | 法线斜率 1 |
| m4m | 参数曲线弧长 | integral_applications_v1·parametric_arc_length | 2π |

13/13 端到端路由与答案全部正确；needs_review 均为图片源公式核对门。

### 本轮修复（36–46 号）

1. **advanced_calc_text.py 新增 9 个 builder**：球面坐标三重（`x²+y²+z²≤R²`）、图形面通量（P dy dz+Q dz dx+R dx dy 三项式 + z=φ + 上/下侧）、参数方程求导（含 `t=t0` 才接，kernel 要求定点）、显式/参数弧长、曲率、极坐标面积、渐近线（有理函数）、高阶导数（`n阶`/`y‴`/`f^{(n)}`）、隐函数法线（坐标对直接给 point_x+point_y，绕开"分支未确认"）。
2. **椭圆域 Green**：`x²/a+y²/b=1` 区域 → x∈[-√a,√a]，y=±√(b(1-x²/a))。
3. **`∭_Ω dxdydz`/`dV` 空被积函数约定**：先归一 `dxdydz`/`d x d y d z`→`dV`，空被积函数按体积型取 1——此前区域名贪婪字符集会把 `dx` 并进被积函数。
4. **双变限 Leibniz 上界**：`{x^2}`/`{x~2}` 花括号感知整取（懒惰 `[^}]+?` 在 `x` 处截断，`^2` 曾并入被积函数）；界内 `~`→`^`。
5. **参数式 `t3`→`t^3`**：OCR 抹平上标；仅对参数字母 t 还原。
6. **`0≤t≤2π` 端点 `2π` 并列**：区间端点正则允许 `\d*π` 无乘号并列；`-/2`（π 丢失）按端点位置补 `pi`；`2pi`→`2*pi`。
7. **θ→0 字形**：`r=2cos0` 且题给 θ 界时 `cos0→cos(θ)`；`2cos` 并列补乘号。
8. **CJK 紧邻 `\\b` 失效复发**：`设x=`/`设y=` 中 `\bx` 无边界（Python3 CJK 属 `\\w`）→ 改 `(?<![A-Za-z0-9_])`；与第二轮 exam_math 同族缺陷。
9. **`y=` 参数式终止符**：补 `在|上|的`，否则 `y=sin t在0≤t≤2π上的弧长` 被整条吞进 y_expr。
10. **学科关键词**：补 弧长/曲率/参数方程/极坐标/心形线/摆线/球面/球体/通量。
11. **ODE 初值特解**：`y(0)=2` 初值已被 ode.py `y(...)=...` 正则提取并核验——零修改通过。

### 回归

- 新增 `test_round4_*` ×3 + `test_ocr_variants_round4` 共 4 个回归函数
- 受影响套件 236 过、0 失败（space/integral/series/proof/subject/analysis/physics/network）

### 累计

四轮 49 题端到端全对；路由/识别/求解缺陷修复 46 项。
'''
with open(path, 'a', encoding='utf-8') as f:
    f.write(block)
print('appended')
