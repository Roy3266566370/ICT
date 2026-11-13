"""模板端点（``C-API@1`` #3；R12-AC3）。

模板注册表 = **内置枚举**（四个白名单模板的固定文案与限制）+ ``fixtures/examples/index.json``
（T1 提供的 ``example_id`` / ``scenario_slug`` 等）。索引缺失时降级为内置默认值，
端点仍返回 4 条记录——``/api/v1/templates`` 在解析器不可用时也必须可用（T7 约束 9）。
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..schemas.api_models import TemplateDescriptor
from ..settings import EXAMPLES_DIR
from . import API_PREFIX, ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix=API_PREFIX, tags=["templates"])

#: 模板内置注册表（顺序即前端场景卡顺序，R1-AC4：空间与矩阵 → 力与向量 → 计算机过程 → 办公推演）。
BUILTIN_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "template_id": "matrix_2d",
        "name": "空间与矩阵",
        "scenario_slug": "matrix",
        "kernel_version": "linear_v1",
        "validation_profile": "matrix_2d_v1_full",
        "example_id": "example_matrix_2d",
        "schema_file": "template_matrix_2d.schema.json",
        "limits": {
            "矩阵元素范围": "-3 ~ 3（步长 0.1）",
            "输入向量范围": "-3 ~ 3",
            "数值容差": "1e-9",
            "奇异矩阵": "det=0 时拒绝求逆并给出原因",
        },
    },
    {
        "template_id": "force_2d",
        "name": "力与向量",
        "scenario_slug": "force",
        "kernel_version": "force_v1",
        "validation_profile": "force_2d_v1_full",
        "example_id": "example_force_2d",
        "schema_file": "template_force_2d.schema.json",
        "limits": {
            "力的个数": "2 ~ 4 个共点力",
            "力的大小": "0 ~ 1000 N",
            "角度单位": "deg（0° 指向 x 轴正方向，逆时针为正）",
            "不计算": "运动、摩擦、碰撞",
        },
    },
    {
        "template_id": "bfs_flow",
        "name": "计算机过程",
        "scenario_slug": "bfs",
        "kernel_version": "bfs_v1",
        "validation_profile": "bfs_flow_v1_full",
        "example_id": "example_bfs_flow",
        "schema_file": "template_bfs_flow.schema.json",
        "limits": {
            "节点数": "<= 20",
            "边数": "<= 40",
            "邻居顺序": "按节点 id 字典序",
            "允许环": "是（不得死循环）",
        },
    },
    {
        "template_id": "budget_compare",
        "name": "办公推演",
        "scenario_slug": "budget",
        "kernel_version": "budget_v1",
        "validation_profile": "budget_compare_v1_full",
        "example_id": "example_budget_compare",
        "schema_file": "template_budget_compare.schema.json",
        "limits": {
            "人数": "0 ~ 2000 人",
            "预算上限": "0 ~ 1000000 元",
            "金额精度": "0.01 元（十进制字符串传输）",
            "表达式": "仅 add / multiply / ref / constant 四种节点",
        },
    },
)


def example_index_path() -> Any:
    """``fixtures/examples/index.json`` 的路径（不存在时由调用方降级处理）。"""

    return EXAMPLES_DIR / "index.json"


def load_example_index() -> dict[str, Any] | None:
    """读取示例索引；文件缺失或损坏返回 ``None``（调用方决定降级或 503）。"""

    path = example_index_path()
    if not path.is_file():
        logger.warning("示例索引缺失：%s", path)
        return None
    try:
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError) as exc:
        logger.warning("示例索引读取失败：%s（%s）", path, type(exc).__name__)
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("examples"), list):
        logger.warning("示例索引结构不合法：%s", path)
        return None
    return payload


def _indexed_templates() -> dict[str, dict[str, Any]]:
    """把索引按 ``template_id`` 建映射，供模板注册表合并。"""

    payload = load_example_index()
    if not payload:
        return {}
    result: dict[str, dict[str, Any]] = {}
    for entry in payload.get("examples", []):
        if not isinstance(entry, dict):
            continue
        template_id = entry.get("template_id")
        if isinstance(template_id, str):
            result[template_id] = entry
    return result


def build_template_descriptors() -> list[TemplateDescriptor]:
    """合并内置枚举与示例索引，产出四个 ``TemplateDescriptor``。"""

    indexed = _indexed_templates()
    descriptors: list[TemplateDescriptor] = []
    for builtin in BUILTIN_TEMPLATES:
        entry = indexed.get(builtin["template_id"], {})
        example_id = entry.get("example_id") or builtin["example_id"]
        descriptors.append(
            TemplateDescriptor(
                template_id=builtin["template_id"],
                name=builtin["name"],
                scenario_slug=builtin["scenario_slug"],
                kernel_version=builtin["kernel_version"],
                validation_profile=builtin["validation_profile"],
                example_id=str(example_id),
                limits=dict(builtin["limits"]),
                #: 仅供调试展示；§2.2.7 明确不存在 /templates/{id}/schema 端点（契约缺口 C-01）。
                schema_path=f"contracts/schemas/{builtin['schema_file']}",
            )
        )
    return descriptors


def template_ids() -> tuple[str, ...]:
    """白名单模板 id（供其他模块校验 ``template_id``）。"""

    return tuple(item["template_id"] for item in BUILTIN_TEMPLATES)


@router.get("/templates", summary="模板白名单列表（端点 #3）")
def list_templates(request: Request) -> JSONResponse:
    """返回四个模板描述；无需会话（auth N），解析器不可用时同样可用。"""

    return ok(request, build_template_descriptors())


__all__ = [
    "BUILTIN_TEMPLATES",
    "build_template_descriptors",
    "load_example_index",
    "router",
    "template_ids",
]
