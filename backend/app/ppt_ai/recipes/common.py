"""补充实验 recipe 的共同上下文与有限搜索工具。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence

from ..evaluation import numeric_output
from ..types import CanonicalValues, CompiledNode, ExperimentCandidate

MAX_PATHS = 3
MAX_CANDIDATES = 200


@dataclass
class RecipeContext:
    node: CompiledNode
    base_values: CanonicalValues
    allowed_variables: list[str]
    ranges: dict[str, list[float]]
    output: str
    tolerance: float
    deadline: float
    evaluate: Callable[[CanonicalValues], tuple[dict[str, Any], float | None]]
    max_candidates: int = MAX_CANDIDATES
    predicate: dict[str, Any] | None = None

    def timeout(self) -> bool:
        return time.monotonic() > self.deadline

    def values_with(self, concept_id: str, value: float) -> CanonicalValues:
        values = dict(self.base_values)
        values[concept_id] = value
        return values

    def parameter(self, concept_id: str):
        for parameter in self.node.parameters:
            if parameter.concept_id == concept_id or parameter.id == concept_id:
                return parameter
        raise ValueError(f"节点没有参数：{concept_id}")

    def numeric(self, concept_id: str) -> bool:
        return self.parameter(concept_id).type in ("number", "integer")

    def discrete_values(self, concept_id: str) -> list[float | bool | str]:
        parameter = self.parameter(concept_id)
        if parameter.type == "boolean":
            return [False, True]
        if parameter.type == "enum":
            return list(parameter.options) or [parameter.default]
        if parameter.type == "string":
            return [parameter.default]
        return []

    def effective_ranges(self) -> dict[str, list[float]]:
        result: dict[str, list[float]] = {}
        for concept_id in self.allowed_variables:
            if not self.numeric(concept_id):
                continue
            if concept_id in self.ranges:
                result[concept_id] = list(self.ranges[concept_id])
                continue
            parameter = self.parameter(concept_id)
            default = float(parameter.default) if isinstance(parameter.default, (int, float)) else 0.0
            low = float(parameter.min) if parameter.min is not None else default - 5.0
            high = float(parameter.max) if parameter.max is not None else default + 5.0
            # 超宽范围收敛到默认值附近，避免用大范围制造“找到反例”的假象。
            if high - low > 40:
                low, high = default - 10.0, default + 10.0
            result[concept_id] = [low, high]
        return result


@dataclass
class RecipeOutcome:
    status: str
    paths: list[ExperimentCandidate] = field(default_factory=list)
    checks: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    predicate: dict[str, Any] | None = None
    stop_reason: str = ""
    evaluated: int = 0


def scan(count: int, low: float, high: float) -> list[float]:
    count = max(2, min(int(count), MAX_CANDIDATES))
    if high <= low:
        return [low]
    return [round(low + (high - low) * index / (count - 1), 10) for index in range(count)]


def path(
    index: int,
    label: str,
    values: CanonicalValues,
    result: Mapping[str, Any],
    output: str,
    *,
    witness: Mapping[str, Any] | None = None,
) -> ExperimentCandidate:
    value = numeric_output(result, output)
    return ExperimentCandidate(
        path_id=f"path_{index}",
        label=label[:160],
        values=values,
        output_value=value,
        result={
            "headline": result.get("headline"),
            "metrics": result.get("metrics", [])[:12],
            "subject": result.get("subject"),
        },
        checks=[item for item in result.get("checks", []) if isinstance(item, dict)][:12],
        witness=dict(witness) if witness else None,
    )


def output_of(result: Mapping[str, Any], output: str) -> float | None:
    return numeric_output(result, output)


__all__ = [
    "MAX_CANDIDATES",
    "MAX_PATHS",
    "RecipeContext",
    "RecipeOutcome",
    "output_of",
    "path",
    "scan",
]
