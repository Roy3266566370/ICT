"""声明一致性：从课件原文抽取可核对结论，再用当前计算结果对照。"""

from __future__ import annotations

import math
import re
from typing import Any, Mapping

_NUMBER = r"-?\d+(?:\.\d+)?"
_DET = re.compile(rf"det\s*(?:=|＝|为)\s*({_NUMBER})", re.I)
_PATH = re.compile(rf"(?:最短路径|最短路)(?:长度)?\s*(?:为|是|=)\s*({_NUMBER})", re.I)
_TOTAL = re.compile(rf"(?:总额|总计|合计|总计金额)\s*(?:为|是|=)?\s*({_NUMBER})\s*元", re.I)
_BALANCE = re.compile(r"(物体|系统)?\s*(处于)?平衡|合力\s*(为|等于|=)?\s*0")


def extract_declarations(page_text: str) -> list[dict[str, Any]]:
    text = str(page_text or "")
    result: list[dict[str, Any]] = []
    for match in _DET.finditer(text):
        result.append(
            {
                "id": f"decl_det_{match.start()}",
                "kind": "det",
                "claim": match.group(0),
                "expected": float(match.group(1)),
                "tolerance": 1e-9,
            }
        )
    for match in _PATH.finditer(text):
        result.append(
            {
                "id": f"decl_path_{match.start()}",
                "kind": "path_length",
                "claim": match.group(0),
                "expected": float(match.group(1)),
                "tolerance": 1e-9,
            }
        )
    for match in _TOTAL.finditer(text):
        result.append(
            {
                "id": f"decl_total_{match.start()}",
                "kind": "total_amount",
                "claim": match.group(0),
                "expected": float(match.group(1)),
                "tolerance": 0.01,
            }
        )
    if _BALANCE.search(text):
        result.append(
            {
                "id": "decl_balance",
                "kind": "balance",
                "claim": "物体处于平衡（合力为 0）",
                "expected": 0.0,
                "tolerance": 1e-7,
            }
        )
    return result


def check_declarations(
    page_text: str,
    actuals: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """``actuals`` 可含 ``det`` / ``force_magnitude`` / ``path_length`` / ``total_amount``。"""
    result: list[dict[str, Any]] = []
    for declaration in extract_declarations(page_text):
        kind = declaration["kind"]
        actual = actuals.get(
            {
                "det": "det",
                "path_length": "path_length",
                "total_amount": "total_amount",
                "balance": "force_magnitude",
            }[kind]
        )
        if isinstance(actual, bool) or not isinstance(actual, (int, float)):
            result.append(
                {
                    **declaration,
                    "status": "not_covered",
                    "actual": None,
                    "detail": "当前模板没有可用于核对该声明的计算结果。",
                }
            )
            continue
        delta = abs(float(actual) - float(declaration["expected"]))
        passed = delta <= float(declaration["tolerance"])
        result.append(
            {
                **declaration,
                "status": "pass" if passed else "fail",
                "actual": float(actual),
                "delta": delta,
                "detail": (
                    f"原文声明 {declaration['expected']:g}，当前计算 {float(actual):g}。"
                    if passed
                    else f"原文声明 {declaration['expected']:g}，当前计算 {float(actual):g}，结论矛盾。"
                ),
            }
        )
    return result


__all__ = ["check_declarations", "extract_declarations"]
