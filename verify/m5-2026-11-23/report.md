# M5 广度扩展验收报告（2026-11-23）

## 1. 验收范围与交付清单

本次验收覆盖 [M5 实施方案](../../docs/superpowers/plans/2026-11-23-m5-walkthrough-expansion-and-nl-relations.md) 的全部 4 项任务：

1. **活页自然语言生成动态关系（主线 A）**
   - 后端：[relation_generation.py](../../backend/app/documents/relation_generation.py)、[routes_documents.py](../../backend/app/api/routes_documents.py)
   - 前端：[types.ts](../../frontend/src/document/types.ts)、[documents.ts](../../frontend/src/api/documents.ts)、[PageRelationsPanel.tsx](../../frontend/src/components/editor/PageRelationsPanel.tsx)、[NodeProperties.tsx](../../frontend/src/components/editor/NodeProperties.tsx)、[FreeDeckEditor.tsx](../../frontend/src/components/editor/FreeDeckEditor.tsx)
   - 核心保障：服务端白名单表达式与防环自动修复闭环、只返预览绝不自动落盘、前端实时试算确认卡、单次 `controller.replace` 原子应用与一键 `Ctrl+Z` 完整撤销。
2. **实验室多态 Walkthrough 与 `slice_accumulate` 扩展（主线 B - 旋转体体积 & 二重积分）**
   - 后端：[pattern_router.py](../../backend/app/labs/walkthrough/pattern_router.py)、[service.py](../../backend/app/labs/walkthrough/service.py)、[volume_slice.py](../../backend/app/labs/walkthrough/volume_slice.py)、[double_slice.py](../../backend/app/labs/walkthrough/double_slice.py)
   - 前端：[walkthrough.ts](../../frontend/src/labs/walkthrough.ts)、[SurfaceCanvas.tsx](../../frontend/src/components/labs/primitives/SurfaceCanvas.tsx)、[RegionSliceCanvas.tsx](../../frontend/src/components/labs/primitives/RegionSliceCanvas.tsx)、[WalkthroughStage.tsx](../../frontend/src/components/labs/walkthrough/WalkthroughStage.tsx)、[WalkthroughPlayer.tsx](../../frontend/src/components/labs/walkthrough/WalkthroughPlayer.tsx)
3. **实验室新解题思想 `limit_approach`（主线 B - 极限与导数逼近）**
   - 后端：[limit_approach.py](../../backend/app/labs/walkthrough/limit_approach.py)
   - 前端：[ZoomCurveCanvas.tsx](../../frontend/src/components/labs/primitives/ZoomCurveCanvas.tsx)、[LimitApproachPlayer.tsx](../../frontend/src/components/labs/walkthrough/LimitApproachPlayer.tsx)

---

## 2. 真实题型变体与 SymPy 独立验算矩阵

| 解题思想 / 题型 | 验收变体 | 精确解析值 | SymPy 逐步验算 | 篡改拦截 |
| --- | --- | --- | --- | --- |
| 旋转体体积（圆盘法） | $y = x^2,\; x \in [0, 2]$ 绕 $x$ 轴 | $\frac{32\pi}{5}$ | 4/4 `verified` | 100% `unverified` |
| 旋转体体积（垫圈法） | $R(x)=\sqrt{x},\; r(x)=x,\; x \in [0, 1]$ | $\frac{\pi}{6}$ | 4/4 `verified` | 100% `unverified` |
| 旋转体体积（三角函数） | $y = \sin x,\; x \in [0, \pi]$ 绕 $x$ 轴 | $\frac{\pi^2}{2}$ | 4/4 `verified` | 100% `unverified` |
| 二重积分（矩形 X-型） | $\iint_{[0,2]\times[0,1]} (x + 2y)\,dx\,dy$ | $4$ | 4/4 `verified` | 100% `unverified` |
| 二重积分（三角形 X-型） | $0 \le x \le 1,\; 0 \le y \le x,\; f=xy$ | $\frac{1}{8}$ | 4/4 `verified` | 100% `unverified` |
| 二重积分（抛物线 Y-型） | $0 \le y \le 1,\; y^2 \le x \le y,\; f=x+y$ | $\frac{3}{20}$ | 4/4 `verified` | 100% `unverified` |
| 极限逼近（重要极限） | $\lim_{x \to 0} \frac{\sin x}{x}$ | $1$ | 4/4 `verified` | 100% `unverified` |
| 极限逼近（等价无穷小） | $\lim_{x \to 0} \frac{1-\cos x}{x^2}$ | $\frac{1}{2}$ | 4/4 `verified` | 100% `unverified` |
| 导数定义（割线逼近） | $f(x)=x^3-2x$ 在 $x_0=1$ 处导数 | $1$ | 4/4 `verified` | 100% `unverified` |

---

## 3. 自动化测试与构建结果

- **后端全量定向回归（M0–M5）**：
  - `test_m5_nl_relations.py` + `test_m5_walkthrough_slice.py` + `test_m5_walkthrough_limit.py` + `test_m4_relations.py` + 既有曲面积分 Walkthrough 测试：**34 passed in 5.37s**
- **前端单元测试**：
  - `src/labs/walkthrough.test.ts`：**7/7 pass**（含曲面积分、旋转体垫圈、二重积分 Y-型域与极限逼近误差收敛）
  - `npm run test:core`：**全部 PASS**
- **前端类型检查与全量构建**：
  - `npm run typecheck`：**0 报错**
  - `npm run build`（含 `npm run build:offline` 重编离线 `runtime.js` / `runtime.css`）：**构建成功**
- **Playwright 端到端验收**：
  - `frontend/e2e/m5-nl-relations.spec.ts`：**1 passed (16.5s)**（覆盖未配置模型报错提示、提案预览与试算校验、确认应用、一键撤销原子回滚、重做保存后放映态仅开放终点手柄及拖动实时联动）
