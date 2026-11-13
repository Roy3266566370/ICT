# legacy —— v0.2 参考实现（不参与主链路）

本目录按 `docs/rebuild-spec.md` §8 / §5.4 归档：

> 五个区域组件、四个内核、正则候选、专用脚本 → 移入 legacy/ 目录，保留为参考实现，不再参与主链路。

## 目录内容

| 目录 | 原 script_id | 说明 |
|---|---|---|
| `regions/matrixEigen` | `matrix_eigen_2d` | S6 三条向量与特征方向 |
| `regions/matrixColumns` | `matrix_columns_2d` | S9 矩阵各列与基向量 |
| `regions/matrixOrder` | `matrix_order_2d` | S10 乘法顺序 |
| `regions/svdSteps` | `svd_steps_2d` | S14 SVD 三步 |
| `regions/detArea` | `det_area_2d` | S18 行列式与面积 |

这些组件只作为**行为参考与视觉对照**保留：

- `frontend/src/regions/registry.ts` 已改为空注册表，主链路不会再加载它们；
- 主链路的交互由 `components/ispec/ISpecView` + `ispec/primitiveRouter.ts` 统一渲染五类原语；
- 迁移脚本：`backend/scripts/migrate_regions_to_ispec.py`，把
  `fixtures/materials/matrix-courseware/regions.json` 转成
  `fixtures/materials/mat_matrix_courseware/ispecs.json`。

> 新增知识类型时**只写 iSpec**，不要往这里加组件，也不要在 `regions/registry.ts` 重新注册。