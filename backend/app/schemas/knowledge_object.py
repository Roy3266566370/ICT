"""``C-KO@1`` 统一对象模型的 Pydantic v2 实现（plan §2.2.1）。

与 ``contracts/schemas/knowledge_object.schema.json`` 逐字对应：字段名全部 snake_case，
``extra="forbid"`` 对齐 JSON Schema 的 ``additionalProperties: false``，不做 alias 转换。

已实现的校验规则（provider 与 consumer 必须同一判定）：

1. ``schema_version == "0.2"``；``model_version >= 1``；``revision >= 0``。
2. ``parameters[].id`` 与 ``source_refs[].id`` 在对象内唯一。
3. ``bindings[]`` 的 ``parameter_id`` / ``view_id`` 必须能在 ``parameters`` / ``views`` 中找到。
4. ``config`` 只写 parameter_id 字符串（形状由模板契约约束，本文件不重复定义）。
5. ``source_refs[].bbox`` 仅在 ``element_id`` 与 ``page`` 均非空时允许非空。
6. ``provenance`` 参数级与来源级各一份。

规则 1/2/3/5 的失败统一抛 :class:`pydantic.ValidationError`，路由侧由
``app.schemas.errors.from_validation_error`` 收敛为 ``MISSING_FIELD``（422）。
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Literal, Mapping, Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# 枚举与常量（取值与 JSON Schema 的 enum 逐字一致）
# ---------------------------------------------------------------------------

TemplateId = Literal["matrix_2d", "force_2d", "bfs_flow", "budget_compare"]
Provenance = Literal["original", "inferred", "user_confirmed", "manual_demo"]
ParameterType = Literal[
    "matrix2",
    "vector2",
    "force_list",
    "graph",
    "integer",
    "decimal",
    "enum",
    "text",
]
KernelVersion = Literal["linear_v1", "force_v1", "bfs_v1", "budget_v1"]

#: template_id → kernel_version 的唯一对应（JSON Schema 的四条 ``if/then``）。
TEMPLATE_KERNEL: dict[str, str] = {
    "matrix_2d": "linear_v1",
    "force_2d": "force_v1",
    "bfs_flow": "bfs_v1",
    "budget_compare": "budget_v1",
}

#: 模板白名单（R12-AC3）。未知取值一律 ``UNSUPPORTED_TEMPLATE``。
TEMPLATE_IDS: tuple[str, ...] = tuple(TEMPLATE_KERNEL)

#: 十进制字符串（禁止二进制浮点参与金额传输，R9-AC3）。
DECIMAL_PATTERN = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$")
#: 非负十进制字符串（力的大小，R7-AC5）。
NON_NEGATIVE_DECIMAL_PATTERN = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]+)?$")

#: bfs_flow 图规模上限（R8-AC6）。
MAX_GRAPH_NODES = 20
MAX_GRAPH_EDGES = 40
#: force_2d 共点力数量上限/下限（R7-AC6）。
MIN_FORCES = 2
MAX_FORCES = 4

#: 来源摘录长度上限（§2.2.1）。
MAX_EXCERPT_LENGTH = 160


class _StrictModel(BaseModel):
    """统一的序列化约定：禁止未定义字段、禁止别名。"""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=False,
        # model_version 是契约字段名，与 pydantic 的 "model_" 保护前缀无关。
        protected_namespaces=(),
    )


def _as_number(value: Any, field_name: str) -> float:
    """把入参转成有限浮点数；``bool`` 与非数值一律拒绝。"""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} 必须是数值")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{field_name} 必须是有限数值")
    return number


def _check_vector2(value: Any, field_name: str) -> list[float]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{field_name} 必须是长度为 2 的数组")
    items = list(value)
    if len(items) != 2:
        raise ValueError(f"{field_name} 必须是长度为 2 的数组")
    return [_as_number(item, f"{field_name}[{index}]") for index, item in enumerate(items)]


def _check_matrix2(value: Any, field_name: str) -> list[list[float]]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{field_name} 必须是 2×2 数组")
    rows = list(value)
    if len(rows) != 2:
        raise ValueError(f"{field_name} 必须是 2×2 数组")
    return [_check_vector2(row, f"{field_name}[{index}]") for index, row in enumerate(rows)]


# ---------------------------------------------------------------------------
# 子结构
# ---------------------------------------------------------------------------


class Bbox(_StrictModel):
    """元素外接框（EMU 绝对坐标）；页级来源必须为 ``None``（R4-AC3）。"""

    x: float
    y: float
    w: float
    h: float


class ParameterRange(_StrictModel):
    """参数取值范围；金额边界用十进制字符串，避免浮点误差。"""

    min: float | None
    max: float | None
    step: float | None
    min_decimal: str | None = None
    max_decimal: str | None = None

    @field_validator("min_decimal", "max_decimal")
    @classmethod
    def _check_decimal_text(cls, value: str | None, info: Any) -> str | None:
        if value is None:
            return None
        if not DECIMAL_PATTERN.match(value):
            raise ValueError(f"{info.field_name} 必须是十进制字符串，禁止浮点")
        return value

    @model_validator(mode="after")
    def _check_bounds(self) -> "ParameterRange":
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("range.min 不得大于 range.max")
        if self.step is not None and self.step <= 0:
            raise ValueError("range.step 必须为正数")
        return self


class SourceRef(_StrictModel):
    """来源引用：保留 ``page`` / ``element_id`` / ``bbox`` / ``excerpt`` 四类溯源字段。"""

    id: str = Field(min_length=1, pattern="^src_")
    provenance: Provenance
    label: str = Field(min_length=1)
    material_id: str | None
    #: 页码 1-based；页级来源为 null。schema 中 page 属 required，故不给默认值。
    page: int | None = Field(ge=1)
    element_id: str | None
    bbox: Bbox | None
    #: 原文摘录 <= 160 字；无摘录时显式写 null（schema 中 excerpt 属 required）。
    excerpt: str | None = Field(max_length=MAX_EXCERPT_LENGTH)

    @model_validator(mode="after")
    def _bbox_requires_element(self) -> "SourceRef":
        """规则 5：页级来源不得携带元素框。"""

        if self.bbox is not None and (self.page is None or self.element_id is None):
            raise ValueError(
                "source_refs[].bbox 只有在 page 与 element_id 均非空时才允许非空"
            )
        return self


class ViewBinding(_StrictModel):
    """参数到视图消费点的绑定（同一参数驱动多个视图，R10-AC1）。"""

    parameter_id: str = Field(min_length=1)
    view_id: str = Field(min_length=1)
    target: str = Field(min_length=1)


class Parameter(_StrictModel):
    """参数：``id/name/type/value/unit/range/source_ref_ids/provenance/editable``。"""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: ParameterType
    #: 形状由 ``type`` 决定，见 ``_check_value_shape``。
    value: Any
    unit: str = Field(min_length=1)
    range: ParameterRange
    source_ref_ids: list[str] = Field(min_length=1)
    provenance: Provenance
    editable: bool

    @field_validator("source_ref_ids")
    @classmethod
    def _check_source_ids(cls, value: list[str]) -> list[str]:
        if any(not item for item in value):
            raise ValueError("source_ref_ids 中的 id 不得为空")
        return value

    @model_validator(mode="after")
    def _check_value_shape(self) -> "Parameter":
        """按 ``type`` 校验 ``value`` 形状（与 JSON Schema 的 8 条 ``if/then`` 一致）。"""

        kind = self.type
        value = self.value

        if kind == "matrix2":
            _check_matrix2(value, f"parameters[{self.id}].value")
        elif kind == "vector2":
            _check_vector2(value, f"parameters[{self.id}].value")
        elif kind == "force_list":
            self._check_force_list(value)
        elif kind == "graph":
            self._check_graph(value)
        elif kind == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"parameters[{self.id}].value 必须是整数")
        elif kind == "decimal":
            if not isinstance(value, str) or not DECIMAL_PATTERN.match(value):
                raise ValueError(
                    f"parameters[{self.id}].value 必须是十进制字符串，禁止浮点（R9-AC3）"
                )
        elif kind in ("enum", "text"):
            if not isinstance(value, str):
                raise ValueError(f"parameters[{self.id}].value 必须是字符串")
        return self

    def _check_force_list(self, value: Any) -> None:
        if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
            raise ValueError(f"parameters[{self.id}].value 必须是力列表")
        forces = list(value)
        if not (MIN_FORCES <= len(forces) <= MAX_FORCES):
            raise ValueError(
                f"parameters[{self.id}].value 的共点力数量必须在 {MIN_FORCES}..{MAX_FORCES}"
            )
        for index, force in enumerate(forces):
            if not isinstance(force, Mapping):
                raise ValueError(f"parameters[{self.id}].value[{index}] 必须是对象")
            extra = set(force) - {"magnitude", "angle_deg"}
            if extra:
                raise ValueError(
                    f"parameters[{self.id}].value[{index}] 含未定义字段：{sorted(extra)}"
                )
            magnitude = force.get("magnitude")
            if not isinstance(magnitude, str) or not NON_NEGATIVE_DECIMAL_PATTERN.match(
                magnitude
            ):
                raise ValueError(
                    f"parameters[{self.id}].value[{index}].magnitude 必须是非负十进制字符串"
                )
            angle = force.get("angle_deg")
            angle_value = _as_number(angle, f"parameters[{self.id}].value[{index}].angle_deg")
            if not 0 <= angle_value < 360:
                raise ValueError(
                    f"parameters[{self.id}].value[{index}].angle_deg 必须在 [0, 360)"
                )

    def _check_graph(self, value: Any) -> None:
        if not isinstance(value, Mapping):
            raise ValueError(f"parameters[{self.id}].value 必须是图对象")
        extra = set(value) - {"nodes", "edges"}
        if extra:
            raise ValueError(f"parameters[{self.id}].value 含未定义字段：{sorted(extra)}")
        nodes = value.get("nodes")
        edges = value.get("edges")
        if not isinstance(nodes, Sequence) or isinstance(nodes, (str, bytes)):
            raise ValueError(f"parameters[{self.id}].value.nodes 必须是数组")
        if not isinstance(edges, Sequence) or isinstance(edges, (str, bytes)):
            raise ValueError(f"parameters[{self.id}].value.edges 必须是数组")
        if len(nodes) > MAX_GRAPH_NODES:
            raise ValueError(
                f"parameters[{self.id}].value.nodes 超过上限 {MAX_GRAPH_NODES}（R8-AC6）"
            )
        if len(edges) > MAX_GRAPH_EDGES:
            raise ValueError(
                f"parameters[{self.id}].value.edges 超过上限 {MAX_GRAPH_EDGES}（R8-AC6）"
            )
        for index, node in enumerate(nodes):
            if not isinstance(node, Mapping) or set(node) - {"id", "label"}:
                raise ValueError(f"parameters[{self.id}].value.nodes[{index}] 形状不合法")
            if not isinstance(node.get("id"), str) or not node["id"]:
                raise ValueError(f"parameters[{self.id}].value.nodes[{index}].id 不能为空")
            if not isinstance(node.get("label"), str):
                raise ValueError(f"parameters[{self.id}].value.nodes[{index}].label 必须是字符串")
        for index, edge in enumerate(edges):
            if not isinstance(edge, Mapping) or set(edge) - {"from", "to"}:
                raise ValueError(f"parameters[{self.id}].value.edges[{index}] 形状不合法")
            for key in ("from", "to"):
                if not isinstance(edge.get(key), str) or not edge[key]:
                    raise ValueError(
                        f"parameters[{self.id}].value.edges[{index}].{key} 不能为空"
                    )


# ---------------------------------------------------------------------------
# 顶层对象
# ---------------------------------------------------------------------------


class KnowledgeObject(_StrictModel):
    """由材料派生的可执行最小单元，绑定唯一 ``template_id``。"""

    schema_version: Literal["0.2"]
    object_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    material_id: str | None
    model_version: int = Field(ge=1)
    revision: int = Field(ge=0)
    template_id: TemplateId
    kernel_version: KernelVersion
    config: dict[str, Any]
    parameters: list[Parameter]
    views: list[str]
    bindings: list[ViewBinding]
    source_refs: list[SourceRef]
    validation_profile: str = Field(min_length=1)
    created_at: datetime
    updated_at: datetime

    @field_validator("views")
    @classmethod
    def _check_views(cls, value: list[str]) -> list[str]:
        if any(not item for item in value):
            raise ValueError("views 中的 id 不得为空")
        if len(set(value)) != len(value):
            raise ValueError("views 不得重复")
        return value

    @model_validator(mode="after")
    def _check_cross_references(self) -> "KnowledgeObject":
        """规则 2（唯一性）+ 规则 3（bindings 引用闭合）+ 模板/内核一致性。"""

        expected_kernel = TEMPLATE_KERNEL.get(self.template_id)
        if expected_kernel is None:
            raise ValueError(f"template_id 不在白名单内：{self.template_id}")
        if self.kernel_version != expected_kernel:
            raise ValueError(
                f"kernel_version 必须为 {expected_kernel}（template_id={self.template_id}）"
            )

        parameter_ids = [item.id for item in self.parameters]
        duplicated_parameters = sorted(
            {item for item in parameter_ids if parameter_ids.count(item) > 1}
        )
        if duplicated_parameters:
            raise ValueError(f"parameters[].id 重复：{duplicated_parameters}")

        source_ids = [item.id for item in self.source_refs]
        duplicated_sources = sorted(
            {item for item in source_ids if source_ids.count(item) > 1}
        )
        if duplicated_sources:
            raise ValueError(f"source_refs[].id 重复：{duplicated_sources}")

        parameter_id_set = set(parameter_ids)
        source_id_set = set(source_ids)
        view_set = set(self.views)

        for item in self.parameters:
            unknown = [sid for sid in item.source_ref_ids if sid not in source_id_set]
            if unknown:
                raise ValueError(
                    f"parameters[{item.id}].source_ref_ids 引用了不存在的来源：{unknown}"
                )

        for binding in self.bindings:
            if binding.parameter_id not in parameter_id_set:
                raise ValueError(
                    f"bindings[].parameter_id 未命中 parameters：{binding.parameter_id}"
                )
            if binding.view_id not in view_set:
                raise ValueError(f"bindings[].view_id 未命中 views：{binding.view_id}")
        return self

    @model_validator(mode="after")
    def _check_timestamps(self) -> "KnowledgeObject":
        if self.updated_at < self.created_at:
            raise ValueError("updated_at 不得早于 created_at")
        return self


__all__ = [
    "DECIMAL_PATTERN",
    "MAX_EXCERPT_LENGTH",
    "MAX_FORCES",
    "MAX_GRAPH_EDGES",
    "MAX_GRAPH_NODES",
    "MIN_FORCES",
    "TEMPLATE_IDS",
    "TEMPLATE_KERNEL",
    "Bbox",
    "KernelVersion",
    "KnowledgeObject",
    "Parameter",
    "ParameterRange",
    "ParameterType",
    "Provenance",
    "SourceRef",
    "TemplateId",
    "ViewBinding",
]
