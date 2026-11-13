"""“AI 说错了”对抗演示：把故障注入提议依次送过四道防线。

不调用真实模型；故障由 ``FaultInjectionProvider`` 人为制造。演示结果如实区分：
注入故障是合成的，不能当作真实模型错误率。
"""

from __future__ import annotations

import copy
import json
from typing import Any

from .declarations import check_declarations
from .ispec.llm.fault import FaultInjectionProvider, SCENARIOS
from .ispec.llm.parse import parse_ispecs
from .ispec.llm.provider import LLMRequest
from .trust import build_trust_report

PAGE_TEXT = "矩阵 [[1, 0], [1, 1]]，det = 1。"
CLEAN_SPEC: dict[str, Any] = {
    "spec_version": "1.0",
    "object_id": "adversarial_matrix",
    "title": "对抗演示矩阵",
    "kind": "geometric",
    "parameters": [
        {
            "id": key,
            "label": key,
            "type": "number",
            "default": value,
            "source": {
                "page": 1,
                "element_id": "e1",
                "bbox": None,
                "status": "original",
                "excerpt": "矩阵 [[1, 0], [1, 1]]",
            },
        }
        for key, value in (("a", 1.0), ("b", 0.0), ("c", 1.0), ("d", 1.0))
    ],
    "expressions": [
        {"id": "det", "expr": "a*d-b*c"},
        {"id": "trace", "expr": "a+d"},
    ],
    "views": [{"type": "text", "template": "det = {{det}}", "title": "当前结果"}],
}

DEFENSE_LABELS = {
    "source_anchor": "原文锚点核验",
    "schema": "类型 / 形状 / 取值范围",
    "independent": "内核与独立参考实现对照",
    "declaration": "原文声明一致性",
}
SCENARIO_LABELS = {
    "clean": "干净输入",
    "forged_excerpt": "伪造原文摘录",
    "schema_shape": "写坏参数类型",
    "matrix_value": "公式与参数不一致",
    "declaration": "与原文 det 声明矛盾",
}


def _det_from_report(report: dict[str, Any]) -> float | None:
    comparison = next(
        (item for item in report.get("validation", {}).get("comparisons", []) if item.get("check_id") == "det"),
        None,
    )
    if comparison is None:
        return None
    try:
        return float(comparison.get("actual"))
    except (TypeError, ValueError):
        return None


def _clean_result() -> dict[str, Any]:
    return {
        "matrix": [[1, 0], [1, 1]],
        "det": 1,
        "trace": 2,
        "render_note": "正确的单位方格变换：det = 1，面积不变。",
    }


def run_scenario(scenario: str) -> dict[str, Any]:
    provider = FaultInjectionProvider(scenario, CLEAN_SPEC)
    request = LLMRequest(pages=[{"page_no": 1, "text": PAGE_TEXT}])
    response = provider.propose(request)
    outcome = parse_ispecs(response.raw_text, pages=request.pages)
    logs: list[dict[str, Any]] = []
    trust = None
    result = None
    if not outcome.ok:
        logs.append(
            {
                "id": f"{scenario}_parse",
                "scenario": scenario,
                "defense": "schema",
                "defense_label": DEFENSE_LABELS["schema"],
                "proposed": "模型响应无法解析",
                "reason": outcome.reason or "模型响应无法解析",
                "action": "不执行",
                "intercepted": True,
            }
        )
    elif outcome.rejected:
        for item in outcome.rejected:
            reason = str(item.get("reason") or "")
            defense = "source_anchor" if "excerpt" in reason or "原文" in reason else "schema"
            logs.append(
                {
                    "id": f"{scenario}_{item.get('index')}",
                    "scenario": scenario,
                    "defense": defense,
                    "defense_label": DEFENSE_LABELS[defense],
                    "proposed": "模型提议的 iSpec",
                    "reason": reason,
                    "action": "拒收，不进入编译",
                    "intercepted": True,
                }
            )
    else:
        spec = outcome.ispecs[0]
        trust = build_trust_report(spec, {1: PAGE_TEXT})
        det = _det_from_report(trust)
        declarations = check_declarations(PAGE_TEXT, {"det": det})
        if trust["validation"]["status"] == "fail":
            logs.append(
                {
                    "id": f"{scenario}_independent",
                    "scenario": scenario,
                    "defense": "independent",
                    "defense_label": DEFENSE_LABELS["independent"],
                    "proposed": "det 表达式比参数实际值多 1",
                    "reason": trust["validation"]["reason"],
                    "action": "判失败，不执行",
                    "intercepted": True,
                }
            )
        failed_declaration = next((item for item in declarations if item["status"] == "fail"), None)
        if failed_declaration is not None:
            logs.append(
                {
                    "id": f"{scenario}_declaration",
                    "scenario": scenario,
                    "defense": "declaration",
                    "defense_label": DEFENSE_LABELS["declaration"],
                    "proposed": f"计算结果 det={failed_declaration.get('actual')}",
                    "reason": failed_declaration["detail"],
                    "action": "标红并禁止进入放映",
                    "intercepted": True,
                }
            )
        if trust["level"] == "green":
            result = _clean_result()
        else:
            matrix = [[1, 0], [1, 1]]
            if scenario in ("matrix_value", "declaration"):
                matrix = [[1, 0], [1, 2]]
            result = {
                "matrix": matrix,
                "det": det,
                "trace": 3 if matrix[1][1] == 2 else 2,
                "render_note": (
                    "如果直接相信模型，会画出 det 与原文不一致的图形。"
                    if trust["level"] == "red"
                    else "该提议未被独立校验。"
                ),
            }
    return {
        "scenario": scenario,
        "label": SCENARIO_LABELS[scenario],
        "proposal": json.loads(response.raw_text)[0],
        "trust": trust,
        "result": result,
        "logs": logs,
        "intercepted": bool(logs),
    }


def run_demo() -> dict[str, Any]:
    clean = run_scenario("clean")
    scenarios = [run_scenario(name) for name in SCENARIOS if name != "clean"]
    return {
        "title": "AI 说错了：四道防线",
        "page_text": PAGE_TEXT,
        "clean": clean,
        "scenarios": scenarios,
        "summary": {
            "injected": len(scenarios),
            "intercepted": sum(1 for item in scenarios if item["intercepted"]),
            "clean_false_positive": 1 if clean["intercepted"] else 0,
            "note": "故障为合成注入，不是真实模型错误率；真实 MaaS 拦截记录需单独统计。",
        },
    }


__all__ = ["CLEAN_SPEC", "DEFENSE_LABELS", "PAGE_TEXT", "run_demo", "run_scenario"]
