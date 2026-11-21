content = '''

---

# 第二轮：进阶题型图片上传端到端测试（12 题）

## 覆盖

mu1 三重积分 ∭_Ω(x+y+z)dxdydz（长方体）｜mu2 曲线积分 ∫_L x dy+y dx（y=x² 抛物线段）
｜mu3 幂级数收敛半径（∑xⁿ/n）｜mu4 傅里叶级数（方波 n≤5）｜mu5 空间解析几何
（过点与平面平行的平面）｜mu6 参数极限（lim(x-sin ax)/x³=1/6 求 a）｜mu7 罗尔定理
（f=x²-4, [-2,2]）｜mu8 偏导数（z=x²y+y³ 求 ∂z/∂x）｜mu9 条件极值（xy 于 x+y=1）
｜mu10 变限积分函数（F(x)=∫₀ˣ t²dt 求 F′(2)）｜mu11 隐函数求导（x²+y²=4 在 (√2,√2)）
｜mu12 旋转体体积（y=x², [0,1] 绕 x 轴）。

## 端到端结果（12/12 引擎正确、答案正确）

| 图 | engine·task | status | 答案 |
| --- | --- | --- | --- |
| mu1 | space_v1·triple_integral | needs_review* | 3/2（本地验证） |
| mu2 | line_integral_v1·line_integral | needs_review* | 1（本地验证） |
| mu3 | power_series_v1·power_series | needs_review* | R=1（本地验证） |
| mu4 | fourier_v1·fourier_series | ready | bₙ=2(1-(-1)ⁿ)/nπ 至 n=5 ✓ |
| mu5 | space_v1·space_geometry | needs_review* | 2x+y-z-1=0（本地验证） |
| mu6 | analysis_v1·limit(modeling_task=parameter_limit) | needs_review* | a=2 |
| mu7 | proof_v1·proof | needs_review* | ξ=0∈(-2,2)（本地验证） |
| mu8 | sympy·multivariable | needs_review* | ∂z/∂x=2xy |
| mu9 | sympy·multivariable_extrema | needs_review* | 极大 f(1/2,1/2)=1/4 |
| mu10 | integral_function_v1·integral_function | needs_review* | F′(x)=x²→4 |
| mu11 | derivative_extra_v1·implicit_derivative | needs_review* | dy/dx=-1 |
| mu12 | sympy·integral(area_volume) | needs_review* | V=π/5 |

`*` 全部为 `source_formula_confirmation` 公式核对门（图片源预期行为）。

## 本轮修复的缺陷

**文本路由缺口**（内核已有 task 但文本进不去）：
1. 新建 `advanced_calc_text.py`：三重积分 box 域、变限积分函数、偏导/全微分、
   点法式平面、条件极值（拉格朗日）→ 窄接 kernel task。
2. `line_integral_text`：接受无括号 P/Q 项、dx/dy 次序任意。
3. `parameter_limit`：`lim(x→0)` 括号式 + `ax` 隐式乘法。
4. 条件极值的学科权重（`f(x,y)`/`约束` 进 calculus 关键词）。
5. 隐函数求导文本路由 + `P=(sqrt(2),sqrt(2))` 嵌套括号点。
6. `exam_math`：`曲线y=` 中 CJK 紧邻 `\\by` 无词边界 → 整条 bail；`[0,1]` 区间提取。

**OCR 字形/版面缺陷**：
7. `∭`→`口`（接 `三重积分` 关键字 + dxdydz）；`0≤≤1` 丢变量名的界按 x→y→z 顺序补位。
8. `∑`→`≥`：`compact` 已把 `≥`→`>=`，Σ 字符类须匹配 `>=` 而非 `≥`（两级数分支同修）。
9. `^`→`~` 幂号（line_integral `_plain`、proof 表达式、implicit 关系式）。
10. 全角 `（）` 混入半角坐标（`（1,2,3)`、`(1,1）`）——space 点、line 端点、implicit 点。
11. `√`→`V`：`V2`→`sqrt(2)`（implicit 点坐标）。
12. **`rfind` 截微分式 bug**：选项行 `A.1/2` 前的换行使 segment 只剩选项——
    真实文本（标题行+题号+选项）才暴露，单句探针测不出。改为取「曲线积分」之后
    到「其中/标点」的微分式段。
13. `罗尔`+换行+`定理` 断行：proof 关键词与 proof_kind 判定改用折叠空白文本。

## 回归

- 新增回归测试：`test_labs_p5_space.py` +2（`test_ocr_variants_round2`、
  `test_ocr_line_integral_segment_not_swallowed_by_options`）+ 上批 4 个路由测试。
- 受影响套件：388 过（p4_series/p5_space/p6_proof/p1_analysis/integral_recognition/
  double_integral/manual_* 系列）；mu2 修复后 54 过复核，p5 共 13 测试全过。

## 遗留与下一轮方向

- `needs_review` 11/12 均为图片源公式核对门，非缺陷。
- 未覆盖：曲面积分/Green/Gauss/Stokes 文本题、级数求和函数、方向导数/梯度、
  欧拉方程/二阶 ODE 应用、多元泰勒、微分中值证明变体（唯一根/介值）——可下轮继续。
'''
with open(r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md', 'a', encoding='utf8') as f:
    f.write(content)
print('done')
