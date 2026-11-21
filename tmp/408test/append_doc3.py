content = '''

---

# 第三轮：曲线/曲面积分与中值定理图片上传端到端测试（12 题）

## 覆盖

m3a 标量曲面积分 ∬_Σ z dS（z=x+y 图形面）｜m3b 格林公式 ∮_L(P dx+Q dy)（单位圆）
｜m3c 高斯公式 ∯_Σ P dy dz+Q dz dx+R dx dy（正方体外侧）｜m3d 斯托克斯公式
∮_Γ P dx+Q dy+R dz（平面边界）｜m3e 幂级数和函数（∑n·xⁿ）｜m3f 方向导数
（z=x²+y² 于 (1,1) 沿 (3,4)）｜m3g 二元无约束极值｜m3h 二阶常系数 ODE
（y″-3y′+2y=0）｜m3i 拉格朗日中值定理（f=x², [1,2]）｜m3j 介值有根
（x³-4x+1, (0,1)）｜m3k 唯一实根（x³+x-1, [0,1]）｜m3l 柱坐标三重积分
（∭_Ω z dV，圆柱面）。

## 端到端结果（12/12 引擎正确、答案正确）

| 图 | engine·task | status | 答案 |
| --- | --- | --- | --- |
| m3a | space_v1·surface_integral | needs_review* | √3 |
| m3b | space_v1·green | needs_review* | 2π |
| m3c | space_v1·gauss | needs_review* | 3 |
| m3d | space_v1·stokes | needs_review* | 2 |
| m3e | power_series_v1·power_series | needs_review* | S(x)=x/(1-x)² |
| m3f | sympy·multivariable(directional) | needs_review* | 14/5 |
| m3g | gradient_descent_v1（optimization） | needs_review* | f(1,2)=-5 |
| m3h | ode_v1·ode | needs_review* | C1eˣ+C2e²ˣ |
| m3i | proof_v1·proof(mvt) | needs_review* | ξ=3/2 |
| m3j | proof_v1·proof(ivt_root) | needs_review* | c∈(0,1) 认证 |
| m3k | proof_v1·proof(ivt_unique_root) | needs_review* | 唯一根认证 |
| m3l | space_v1·triple_integral(cylindrical) | needs_review* | π/2 |

`*` 全部为 `source_formula_confirmation` 公式核对门（图片源预期行为）。

## 本轮修复的缺陷

**文本路由**（`advanced_calc_text.py` 新增 6 个 builder）：
1. `_surface_graph`：图形面标量曲面积分（`∬_Σ f dS` + `z=z(x,y)` + 矩形界）。
2. `_green`：`P dx+Q dy` + 圆域/矩形界；三项场（dz）显式拒绝让给 stokes。
3. `_gauss`：`P dy dz+Q dz dx+R dx dy` + box 界。
4. `_stokes`：`P dx+Q dy+R dz` + `平面 z=c` + 矩形界（排序在 green 之前）。
5. `_directional`：`方向导数` + 点 + 方向向量。
6. `_triple_cylindrical`：`柱面 x²+y²=a` + `z=c1,c2` → cylindrical 区域。

**proof 题面变体**：`(0,1)` 开区间、`实根`/`有...根` 非相邻关键词、`x`→`×` 字形。

**学科分类缺陷**（最有价值的两个）：
7. **物理裸词 `高斯` 误伤微积分"高斯公式"**——物理关键词与 `_PHYSICS_STRONG`
   里的 `高斯` 改为 `高斯定理|高斯面|高斯定律`；微积分侧补 `高斯公式|奥高公式`。
8. **`algorithm` 判定分支在 `calculus` 之前且无分高者胜**——任何含"边"字
   （图的边）的高数题被劫持；改为 `algorithm ≥ optimization 且 ≥ calculus` 才接管。
9. 二元裸"极值"归属：`f(x,y)` 关键词曾把无约束极值掀到 calculus——加消歧规则：
   有极值词且无约束词时归 optimization（gradient_descent_v1 精确解同一答案），
   条件极值留给 calculus 拉格朗日路由。

**OCR 字形**：
10. `∬/∯/∭`→`口`、`Σ`→`E`/`∑`/`×`（独占一项的 `×` 按 x 处理，复合项内按乘号）、
    `Γ`→`「`、`y''`→`y"`（仅字母后替换避免误伤引号）、`Z` 大写界、全角括号进场提取。
11. `_triple_integrand` 区域名贪心字符集含 `\\s`——`∭_Ω z dV` 的 `z` 被吃；
    改为 ≤3 字符区域标签（`Ω`/`D`/`Σ`）。

**二阶 ODE**：`y"-3y'+2y=0` 的 `"`→`''` 归一（`_normalize_equation`）。

## 回归

- `test_labs_p5_space.py` +5：surface/green/gauss/stokes 路由、directional/极值/柱坐标、
  开区间与实根、calculus-vs-physics/algorithm 分类、`test_ocr_variants_round3`（5 例）。
- 受影响套件：数学+物理 276 过、DS/网络/学科分类 101 过、p5+subject_recovery 21 过；
  合计 398 过、0 失败（修 `algorithm` 判定序后 `test_exam_task_classification` 的
  `f(x,y)…极值→optimization` 契约保持不变）。

## 遗留与下一轮方向

- 11/12 `needs_review` 均为公式核对门；m3g 走 optimization 是既有契约（符号极值
  仅在"约束/条件"语境走 calculus 拉格朗日路由）。
- 未覆盖：球面坐标三重、参数化曲面/通量曲面积分、椭圆域 Green、高斯公式的非盒域、
  变限积分 Leibniz 上下限同时含 x、级数端点判定细节、ODE 初值/特解、多元泰勒——
  需要更复杂的文本结构或内核扩展，建议下轮按同样流程继续。
'''
with open(r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md', 'a', encoding='utf8') as f:
    f.write(content)
print('done')
