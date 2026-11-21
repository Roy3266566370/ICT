# -*- coding: utf-8 -*-
block = """

## 第六轮：空间解析几何大题端到端（2026-11-20）

13 道空间解析几何题（切平面法线/二次曲面识别/点面距离/点线距离/线面交点/两面夹角/投影/向量运算/混合积体积/两点直线/点向式/三点平面/两直线关系）——12/13 首传即正确路由，剩余 1 个质量门缺陷修复后 **13/13 端到端全对**（needs_review 均为图片源公式核对门，m6c/m6d/m6m 为 ready）。

| 图 | 题型 | geometry_kind | 答案 |
| --- | --- | --- | --- |
| m6a | 曲面切平面+法线 | surface_tangent | 2x+2y−z−2=0 |
| m6b | 二次曲面识别 | quadric_surface | 单叶双曲面 |
| m6c | 点到平面距离 | point_plane_distance | 4/3 |
| m6d | 点到直线距离 | point_line_distance | 3√2/2 |
| m6e | 线面交点+夹角 | line_plane_relation | (5/3,2/3,2/3)，π/2 |
| m6f | 两平面夹角 | plane_plane_relation | π/2 |
| m6g | 线在面上投影 | line_plane_projection | 退化投影点(5/3,2/3,2/3) |
| m6h | 向量运算 | vector_operations | a·b=32，a×b=(−3,6,−3) |
| m6i | 混合积体积 | vector_products | 1/6 |
| m6j | 两点定直线 | line_from_points | (x−1)/3=(y−2)/3=(z−3)/3 |
| m6k | 点向式直线 | line_point_direction | (x−1)/3=−y=(z−2)/2 |
| m6l | 三点定平面 | plane_three_points | x+y+z−1=0 |
| m6m | 两直线关系 | line_line_relation | 相交于原点，π/2 |

### 本轮修复（58–62 号）

1. **`_space_geometry` 分发器**：解析点组 `(a,b,c)`、平面方程→`a,b,c,d` 系数（SymPy 展开左-右，等式 RHS 任意）、对称式直线 `(x−a)/p=(y−b)/q=(z−c)/r`→（点,方向），支持 `x−1=y=z` 隐式分母 1 与 `x/1=y/1=z/0` 零分量。按特异性分派 13 种 geometry_kind；条件不全一律 None。
2. **`两平面 eq1 与 eq2`**：第二个平面无「平面」前缀，补「与」后式子提取。
3. **「指出/说明」概念门**：`concept_answered` 例外——quadric_surface 有确定内核分类结果，不再被 concept+explains_only 升级到 pending_ai。
4. **学科关键词**：切平面/法平面/二次曲面/曲面/椭球/双曲面/抛物面/锥面/点到平面/点到直线/到平面/到直线/两平面/两直线/位置关系/投影/方向向量/数量积/向量积/混合积/平行六面体/向量/夹角/点法式/对称式（均不与物理强词冲突）。
5. **`（(8分）` 双左括号容错**：transcription_issues 括号配对中，多出的左括号数 ≤ 重叠 `((` 出现数时按 OCR 重复字形容错（`((x+y))` 合法嵌套不受影响，真缺右括号仍报缺）。此前 m6d 因此被判 untrusted 整个跳过本地建模。

### 回归

- `test_round6_space_geometry`/`_vectors`/`_ocr_doubled_open_paren` 3 个回归函数
- 受影响套件（p5_space/integral/p1_analysis/physics/network）200 过、0 失败

### 累计

六轮 75 题端到端全对；路由/识别/求解/质量门缺陷修复 62 项。
"""
open(r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md', 'a', encoding='utf-8').write(block)
print('doc ok')
