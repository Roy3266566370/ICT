"""故障注入 provider：仅用于演示与评测，不在正常识别链路启用。

它包装一份干净 iSpec 提议，按场景人为制造四类错误：

- ``forged_excerpt``：编造原文里没有的摘录 → 原文锚点防线拒收；
- ``schema_shape``：写坏类型/范围 → Schema 与条件校验防线拒收；
- ``matrix_value``：公式与参数不一致 → 独立校验失败；
- ``declaration``：计算正确但与原文声明矛盾 → 声明一致性失败。

没有真实模型调用；provider 的 ``name`` 明确标注 ``fault-injection``。
"""

from __future__ import annotations

import copy
import json
from typing import Any

from .provider import LLMRequest, LLMResponse

SCENARIOS = ("clean", "forged_excerpt", "schema_shape", "matrix_value", "declaration")


class FaultInjectionProvider:
    name = "fault-injection"

    def __init__(self, scenario: str, base_spec: dict[str, Any]):
        if scenario not in SCENARIOS:
            raise ValueError(f"未知故障场景：{scenario}")
        self.scenario = scenario
        self.base_spec = copy.deepcopy(base_spec)

    def available(self) -> bool:
        return True

    def propose(self, request: LLMRequest) -> LLMResponse:
        spec = copy.deepcopy(self.base_spec)
        parameters = spec.get("parameters") if isinstance(spec.get("parameters"), list) else []
        if self.scenario == "forged_excerpt" and parameters:
            parameters[0].setdefault("source", {})["excerpt"] = "模型编造的原文：矩阵元素全部为 9"
        elif self.scenario == "schema_shape" and parameters:
            parameters[0]["min"] = "不是数值"
        elif self.scenario == "matrix_value":
            expressions = spec.get("expressions") if isinstance(spec.get("expressions"), list) else []
            for expression in expressions:
                if isinstance(expression, dict) and expression.get("id") == "det":
                    expression["expr"] = f"({expression.get('expr')}) + 1"
        elif self.scenario == "declaration":
            key = next(
                (key for key in ("d", "a22") if any(item.get("id") == key for item in parameters)),
                None,
            )
            if key is not None:
                for item in parameters:
                    if item.get("id") == key:
                        item["default"] = float(item.get("default") or 0) + 1
        return LLMResponse(
            raw_text=json.dumps([spec], ensure_ascii=False),
            model="fault-injection",
        )


__all__ = ["FaultInjectionProvider", "SCENARIOS"]
