# -*- coding: utf-8 -*-
block = '''

---

## 第七轮：线性代数（m7a–m7m，2026-11-20 续）

13 题：2/3 阶行列式（竖线记法）、逆矩阵、矩阵乘/加/减/数乘、3 元与 2 元线性方程组、奇异矩阵可逆判定、非方阵乘法、特征值。**端到端全对：12 题给出正确答案，1 题（特征值）诚实阻塞**——无本地内核，保留已识别矩阵供核对，未静默给错答。

| 题 | engine·kind | 答案 |
| --- | --- | --- |
| m7a 二阶行列式 \\|1 2;3 4\\| | gauss_v1·determinant | det(A)=-2 |
| m7b 三阶行列式 | gauss_v1·determinant | det(A)=1 |
| m7c 三阶行列式（OCR 首竖线→`[`） | gauss_v1·determinant | det(A)=4 |
| m7d 逆矩阵 | gauss_v1·inverse | [-2,1;1.5,-0.5] |
| m7e A×B | matmul_v1 | [19,22;43,50] |
| m7f A+B | matmul_v1 | [6,8;10,12] |
| m7g A−B | matmul_v1 | [-4,-4;-4,-4] |
| m7h 3A | matmul_v1 | [3,6;9,12] |
| m7i 三元方程组 | gauss_v1·linear_system | x=1,y=2,z=3 |
| m7j 二元方程组 | gauss_v1·linear_system | x=2,y=1 |
| m7k 奇异矩阵可逆判定 | gauss_v1·determinant | det(A)=0 |
| m7l 2×3·3×2 乘法 | matmul_v1 | [4,5;10,11] |
| m7m 特征值 | 诚实阻塞 | 保留矩阵供核对 |

### 本轮修复（6 个真实缺陷）

1. **`特征值`误判**：此前命中行列式关键词静默给无关 det → 单独 kind + 诚实阻塞（_KIND_LABELS 补 eigen）；_eval_gauss 对非高斯 kind 补守卫，不再 KeyError。
2. **`|a b;c d|` 竖线行列式记法不解析**：新增 _BARS 正则。
3. **OCR 首竖线误读 `[`**：_BARS 开闭定界允许 |/[/] 混搭（`[2 1 0;…|`）。
4. **OCR 吃掉竖线内空格**（`|12;34|` → 2×1 非方阵）：_split_digit_rows——行数与每行位数一致时拆成单位数字方阵。
5. **`3A` 数乘误判乘法缺 B**：_detect_kind 补 `kA` 检测。
6. **奇异矩阵行列式抛错**：det=0 是合法答案（可逆判定证据）→ determinant kind 奇异时返回 det(A)=0 且 det_value 归 0，不再报"矩阵奇异"。

- 回归：test_labs_p5_space.py +2 个回归函数（含特征值诚实阻塞断言）；受影响套件 70 过、0 失败。
- 题图归档：tmp/408test/correct/round7_math_linalg/（13 张），manifest.md 已更新。
- **七轮合计 88 题（87 题给出正确答案 + 1 题诚实阻塞）、68 个缺陷修复。**
'''
path = r'E:\代码\ICT\docs\2026-11-19-高等数学图片上传通路测试记录.md'
open(path, 'a', encoding='utf-8').write(block)
print('done')
