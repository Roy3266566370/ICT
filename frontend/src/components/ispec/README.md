# components/ispec —— 五类原语的唯一运行时

`ISpecView` 是宿主**唯一**需要认识的交互组件；五类原语通过
`primitiveRouter.ts` 分流，不复制宿主组件、不为知识点新增内核。

## 分流规则

| `kind` | 语义 | 分流实现 |
|---|---|---|
| `parametric` | 参数驱动 | `routeSpecViews` 全部视图可见（现有行为） |
| `filter` | 数据筛选 | 全部视图可见（现有行为） |
| `step` | 步骤推进 | `stage`（0/1/2）控制可见视图数；**视图顺序即步骤顺序**，逐个显现 |
| `geometric` | 几何操作 | figure 视图内渲染拖动手柄；拖动/方向键回写参数 |
| `branch` | 分支选择 | 取第一个 `type="enum"` 参数作为开关，按选项筛选视图 |

## branch 的视图匹配约定（schema 冻结，不新增 `when`）

`contracts/spec/ispec.schema.json` 没有 `when` 字段，本运行时不改 schema，改用：

- 视图 `title` **包含**当前选项名 → 只在该选项下显示；
- 视图没有 `title` → 公共视图，所有分支都显示；
- 若没有任何视图匹配当前选项 → 退回显示全部视图（避免空白页）。

新增分支知识点时，把每个视图的 `title` 写成包含对应选项名的文本即可，例如
选项 `"先转后拉"` / `"先拉后转"`，对应视图标题分别包含这两个字符串。

## 新增知识点的正确做法

1. 只写一份 iSpec（`spec_version`、`kind`、`parameters`、`views`）；
2. 参数一律带 `source`（页码 + 状态 + 原文片段）；
3. 视图只用 `figure / text / table / vega` 四种；
4. 不改 `ISpecView`、不改 `primitiveRouter`、不在 `regions/registry.ts` 注册组件。

历史 v0.2 区域组件已归档到 `src/legacy/regions/`，仅作参考实现。