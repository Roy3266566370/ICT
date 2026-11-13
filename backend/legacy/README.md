# legacy：不再参与主链路的参考实现

整改文件 **§8「需要归档（而非删除）的代码」** 原话：

> 以下不是"写坏了"，是"写早了"。移入 legacy/ 目录，保留为参考实现，不再参与主链路。
> 理由：这些代码本身质量不差，问题是它们承载了"产品能力"的角色。归档是让它们退回"参考实现"的位置。

## 归档清单与当前处置

| 对象 | 路径 | 处置 | 说明 |
|---|---|---|---|
| 五个区域组件 | `frontend/src/legacy/regions/` | **已物理迁移** | 主链路改为 iSpec，见 `frontend/src/legacy/README.md` |
| 四个计算内核 | `backend/app/engines/{matrix,force,bfs,budget}.py` | **原地标注 deprecated**（未物理移动） | 见下节说明 |
| 正则候选识别 | `backend/app/parsers/candidates.py` | **已降级为兜底**（`notes` 标 `识别方式: regex_fallback`） | 仅在无 iSpec 时运行 |
| 专用脚本配置 | `backend/scripts/render_courseware.py` | **不参与真实材料链路** | 仅用于课程件样例产物生成 |

## 为什么四个内核没有物理移动

整改文件说这四个内核要"保留为 expression 求值器的领域扩展"，**不是删除**。物理移动到 `backend/legacy/` 会带来两个副作用：

1. `backend/scripts/selftest.py`（17/17 PASS）与 `backend/tests/engines/**`（55 用例）直接 import 它们，移动会打断现有回归；
2. 它们仍是 `expression` 求值器的**领域扩展参考**（例如矩阵的 det/rank、力的 hypot/atan2），保留在原位更便于被未来的求值器借用。

因此采用**标注式归档**：在四个模块的 docstring 首行加 `[legacy]` 标记，并在本文件声明"主链路不再调用"。
如果后续确需物理隔离，按以下顺序做即可：移动文件 → 更新 `backend/app/engines/__init__.py` → 更新 `tests/engines/**` 与 `scripts/selftest.py` 的 import → 跑 `pytest`。

## 主链路现在靠什么

- 识别：`backend/app/ispec/builder.py`（原生图表/表格/OMML → iSpec）
- 计算：`frontend/src/ispec/expr.ts`（受限表达式求值，无 `eval`）
- 渲染：`frontend/src/components/ispec/ISpecView.tsx`（五类原语分流）
- 校验：`contracts/spec/ispec.schema.json` + `backend/app/ispec/validator.py`

四个内核与五个区域组件仅在**历史材料兼容**路径与**回归测试**中继续被引用。