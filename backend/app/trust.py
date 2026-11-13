"""iSpec 可信报告（``trust.1``）。

报告完全由规则生成，不读取模型自评分：

- 参数：来源类别、原文锚点、锚点是否真正出现在该页文字中；
- 校验：矩阵模板可用 ``validators/rules.py`` 的独立参考实现对照；其余模板显式
  ``not_covered``，不冒充“独立校验通过”；
- 声明：从页面文字抽取 ``det = 6`` 一类可核对声明，再用当前计算结果核对；
- 整体等级：红（校验/声明/锚点失败）> 灰（未独立校验）> 黄（含推断/默认值）> 绿。
"""

from __future__ import annotations

import math
import re
from typing import Any, Mapping, Sequence

from .ppt_ai.evidence import verify_anchor
from .ppt_ai.util import hash_json, now_iso
from .validators import rules

TRUST_VERSION = "trust.1"
SOURCE_LABELS = {
    "original": "原文读取",
    "inferred": "推断",
    "confirmed": "用户确认",
    "default": "默认值",
}
LEVEL_LABELS = {
    "green": "可信",
    "yellow": "待确认",
    "red": "校验失败",
    "gray": "未独立校验",
}
_MATRIX_IDS = (("a", "b", "c", "d"), ("a11", "a12", "a21", "a22"))
_DET_DECLARATION = re.compile(r"det\s*(?:=|＝|为)\s*(-?\d+(?:\.\d+)?)", re.I)


def _source_category(status: str) -> str:
    if status == "original":
        return "original"
    if status == "confirmed":
        return "confirmed"
    if status == "manual_demo":
        return "default"
    return "inferred"


def _anchor_normalize(text: str) -> str:
    translation = str.maketrans({
        "：": ":", "，": ",", "。": ".", "；": ";", "（": "(", "）": ")",
        "【": "[", "】": "]", "－": "-", "−": "-", "—": "-", "～": "~",
    })
    return re.sub(r"\s+", "", str(text or "").translate(translation)).casefold()


def _page_text(page: Mapping[str, Any]) -> str:
    parts: list[str] = []
    title = page.get("title")
    if isinstance(title, str) and title.strip():
        parts.append(title.strip())
    for element in page.get("elements", []) if isinstance(page.get("elements"), list) else []:
        if not isinstance(element, Mapping):
            continue
        for key in ("text", "math_text"):
            value = element.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return "\n".join(parts)


def page_texts_from_payload(payload: Mapping[str, Any] | None) -> dict[int, str]:
    """从 iSpec 产物的 ``page_layouts`` 建立页码 → 原文映射。

    图片元素的 OCR 文字与结构化矩阵也属于该页可核验来源；原生矩阵 iSpec 的
    excerpt 是 OCR 识别后的矩阵字符串，不能只拿普通文本框文字核对。
    """

    result: dict[int, str] = {}
    element_pages: dict[str, int] = {}
    pages = (payload or {}).get("page_layouts", []) if isinstance(payload, Mapping) else []
    for page in pages:
        if not isinstance(page, Mapping):
            continue
        page_no = page.get("page_no")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
            continue
        result[page_no] = _page_text(page)
        for element in page.get("elements", []) if isinstance(page.get("elements"), list) else []:
            if isinstance(element, Mapping) and isinstance(element.get("element_id"), str):
                element_pages[element["element_id"]] = page_no
    recognition = payload.get("image_recognition") if isinstance(payload, Mapping) else None
    if isinstance(recognition, Mapping):
        for element_id, raw in recognition.items():
            page_no = element_pages.get(str(element_id))
            if page_no is None or not isinstance(raw, Mapping):
                continue
            parts = [result.get(page_no, "")]
            if isinstance(raw.get("text"), str):
                parts.append(raw["text"])
            if raw.get("matrix") is not None:
                import json

                parts.append(json.dumps(raw["matrix"], ensure_ascii=False))
            result[page_no] = "\n".join(part for part in parts if part)
    return result


def page_texts_from_pages(pages: Sequence[Mapping[str, Any]]) -> dict[int, str]:
    result: dict[int, str] = {}
    for page in pages:
        if not isinstance(page, Mapping):
            continue
        page_no = page.get("page_no")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
            continue
        text = page.get("text")
        if isinstance(text, str):
            result[page_no] = text
            continue
        result[page_no] = "\n".join(
            str(part)
            for part in (page.get("title"), page.get("excerpt"))
            if isinstance(part, str) and part.strip()
        )
    return result


def _parameter_anchor(parameter: Mapping[str, Any], spec: Mapping[str, Any]) -> dict[str, Any]:
    source = parameter.get("source") if isinstance(parameter.get("source"), Mapping) else {}
    anchor = dict(source)
    if anchor.get("bbox") is None and isinstance(spec.get("anchor"), Mapping):
        anchor["bbox"] = spec["anchor"].get("bbox")
    anchor.setdefault("page", spec.get("anchor", {}).get("page"))
    return anchor


def _matrix_values(parameters: Sequence[Mapping[str, Any]]) -> tuple[list[list[float]], dict[str, float]] | None:
    values = {
        str(parameter.get("id")): parameter.get("default")
        for parameter in parameters
        if isinstance(parameter, Mapping)
    }
    for ids in _MATRIX_IDS:
        if all(isinstance(values.get(key), (int, float)) and not isinstance(values.get(key), bool) for key in ids):
            matrix = [
                [float(values[ids[0]]), float(values[ids[1]])],
                [float(values[ids[2]]), float(values[ids[3]])],
            ]
            aliases = {"a": matrix[0][0], "b": matrix[0][1], "c": matrix[1][0], "d": matrix[1][1]}
            aliases.update({ids[0]: matrix[0][0], ids[1]: matrix[0][1], ids[2]: matrix[1][0], ids[3]: matrix[1][1]})
            return matrix, aliases
    return None


def _evaluate_expression(expression: str, variables: Mapping[str, float]) -> float | None:
    from .labs.expr import ExprError, parse_expression, safe_float
    import sympy as sp

    names = tuple(sorted(variables))
    try:
        parsed = parse_expression(expression, names)
        substitutions = {sp.Symbol(name, real=True): value for name, value in variables.items()}
        value = safe_float(parsed.subs(substitutions))
    except (ExprError, ValueError, TypeError, ZeroDivisionError):
        return None
    return float(value) if value is not None and math.isfinite(float(value)) else None


def _compare(
    check_id: str,
    title: str,
    expected: float | bool,
    actual: float | bool | None,
    *,
    tolerance: float = rules.TOLERANCE,
) -> dict[str, Any]:
    if actual is None:
        return {
            "check_id": check_id,
            "title": title,
            "status": "not_covered",
            "expected": str(expected),
            "actual": None,
            "delta": None,
            "detail": "当前 iSpec 没有可对照的计算结果。",
        }
    if isinstance(expected, bool) or isinstance(actual, bool):
        ok = bool(expected) == bool(actual)
        return {
            "check_id": check_id,
            "title": title,
            "status": "pass" if ok else "fail",
            "expected": str(expected).lower(),
            "actual": str(actual).lower(),
            "delta": None,
            "detail": "布尔结果一致。" if ok else "布尔结果不一致。",
        }
    delta = abs(float(expected) - float(actual))
    ok = delta <= tolerance
    return {
        "check_id": check_id,
        "title": title,
        "status": "pass" if ok else "fail",
        "expected": f"{float(expected):.10g}",
        "actual": f"{float(actual):.10g}",
        "delta": delta,
        "detail": (
            f"独立参考与内核差值 {delta:.3g}，在容差 {tolerance:g} 内。"
            if ok
            else f"独立参考与内核差值 {delta:.3g}，超过容差 {tolerance:g}。"
        ),
    }


def _validate_matrix(spec: Mapping[str, Any]) -> dict[str, Any]:
    parameters = spec.get("parameters") if isinstance(spec.get("parameters"), list) else []
    matrix_data = _matrix_values(parameters)
    if matrix_data is None:
        return {
            "status": "not_covered",
            "profile": None,
            "reason": "未识别为可独立复算的 2×2 矩阵 iSpec。",
            "comparisons": [],
        }
    matrix, aliases = matrix_data
    try:
        reference = rules.matrix_reference(matrix, [1.0, 1.0])
    except rules.InputProblem as exc:
        return {
            "status": "not_covered",
            "profile": "matrix_2d",
            "reason": f"独立参考实现无法读取矩阵：{exc}",
            "comparisons": [],
        }
    expressions = {
        str(item.get("id")): str(item.get("expr") or "")
        for item in (spec.get("expressions") if isinstance(spec.get("expressions"), list) else [])
        if isinstance(item, Mapping)
    }
    comparisons: list[dict[str, Any]] = []
    if expressions.get("det"):
        comparisons.append(
            _compare("det", "行列式 det", reference.det, _evaluate_expression(expressions["det"], aliases))
        )
    if expressions.get("trace"):
        comparisons.append(
            _compare("trace", "迹 trace", reference.trace, _evaluate_expression(expressions["trace"], aliases))
        )
    if expressions.get("rank"):
        comparisons.append(
            _compare("rank", "秩 rank", reference.rank, _evaluate_expression(expressions["rank"], aliases))
        )
    if not comparisons:
        return {
            "status": "not_covered",
            "profile": "matrix_2d",
            "reason": "矩阵 iSpec 没有 det/trace/rank 表达式，无法做内核对照；不显示为独立校验通过。",
            "comparisons": [],
        }
    if any(item["status"] == "fail" for item in comparisons):
        status = "fail"
        reason = "独立参考实现与内核结果不一致。"
    elif any(item["status"] == "pass" for item in comparisons):
        status = "pass"
        reason = "矩阵 det/trace/rank 已由独立参考实现对照。"
    else:
        status = "not_covered"
        reason = "矩阵表达式未能计算出可对照的有限值。"
    return {"status": status, "profile": "matrix_2d", "reason": reason, "comparisons": comparisons}


def _declarations(
    spec: Mapping[str, Any],
    page_texts: Mapping[int, str],
    validation: Mapping[str, Any],
) -> list[dict[str, Any]]:
    pages = {
        source.get("page")
        for source in (
            (parameter.get("source") if isinstance(parameter, Mapping) else None)
            for parameter in spec.get("parameters", [])
        )
        if isinstance(source, Mapping) and isinstance(source.get("page"), int)
    }
    text = "\n".join(page_texts.get(page, "") for page in pages)
    result: list[dict[str, Any]] = []
    det_comparison = next(
        (item for item in validation.get("comparisons", []) if item.get("check_id") == "det"),
        None,
    )
    if det_comparison is not None:
        actual = det_comparison.get("actual")
        declared = _DET_DECLARATION.search(text)
        if declared is not None:
            expected = float(declared.group(1))
            try:
                actual_value = float(actual) if actual is not None else None
            except (TypeError, ValueError):
                actual_value = None
            result.append(
                {
                    "id": "decl_det",
                    "claim": declared.group(0),
                    "status": "pass"
                    if actual_value is not None and abs(actual_value - expected) <= rules.TOLERANCE
                    else "fail",
                    "expected": expected,
                    "actual": actual_value,
                    "detail": (
                        "原文声明与当前行列式一致。"
                        if actual_value is not None and abs(actual_value - expected) <= rules.TOLERANCE
                        else "原文声明与当前计算结果矛盾。"
                    ),
                }
            )
    return result


def _model_info(spec: Mapping[str, Any], parameters: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    raw = spec.get("model") if isinstance(spec.get("model"), Mapping) else {}
    inferred = any(item.get("status") == "inferred" for item in parameters)
    used = bool(raw.get("used"))
    confidence = raw.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        confidence = None
    return {
        "used": used,
        "confidence": float(confidence) if confidence is not None else None,
        "provider": str(raw.get("provider") or "")[:64],
        "note": str(raw.get("note") or ("存在推断参数；未记录模型调用，推断可能来自规则模板。" if inferred else "未记录模型调用。"))[:500],
    }


def build_trust_report(
    spec: Mapping[str, Any],
    page_texts: Mapping[int, str],
    *,
    validation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """为一条 iSpec 生成可信报告。"""

    parameters_raw = [item for item in spec.get("parameters", []) if isinstance(item, Mapping)]
    parameters: list[dict[str, Any]] = []
    anchor_failures = 0
    anchor_unavailable = 0
    for parameter in parameters_raw:
        source = parameter.get("source") if isinstance(parameter.get("source"), Mapping) else {}
        status = _source_category(str(source.get("status") or "inferred"))
        anchor = _parameter_anchor(parameter, spec)
        page = anchor.get("page")
        page_available = isinstance(page, int) and page in page_texts
        if status == "default":
            errors = ["默认值没有原文锚点，需用户确认。"]
            anchor_checked = False
        elif not page_available:
            errors = ["该页原文不可用，尚不能核验锚点。"]
            anchor_checked = False
            anchor_unavailable += 1
        else:
            # bbox 这里只用于前端高亮（EMU），锚点核验只比较原文摘录；
            # 全角/半角标点与 OCR 空白差异不应把真实原文误判为伪造。
            normalized_pages = {key: _anchor_normalize(value) for key, value in page_texts.items()}
            normalized_anchor = {
                key: value for key, value in anchor.items() if key != "bbox"
            }
            normalized_anchor["excerpt"] = _anchor_normalize(str(anchor.get("excerpt") or ""))
            errors = verify_anchor(normalized_anchor, normalized_pages, require_excerpt=True)
            anchor_checked = True
            anchor_failures += 1 if errors else 0
        parameters.append(
            {
                "id": str(parameter.get("id") or ""),
                "label": str(parameter.get("label") or parameter.get("id") or ""),
                "status": status,
                "status_label": SOURCE_LABELS[status],
                "value": parameter.get("default"),
                "unit": str(parameter.get("unit") or ""),
                "anchor": {
                    "page": anchor.get("page"),
                    "element_id": anchor.get("element_id"),
                    "bbox": anchor.get("bbox"),
                    "excerpt": str(source.get("excerpt") or "")[:160],
                },
                "anchor_checked": anchor_checked,
                "anchor_verified": anchor_checked and not errors,
                "anchor_errors": errors[:10],
                "user_checks": list(source.get("user_checks") or [])[:20]
                if isinstance(source.get("user_checks"), list)
                else [],
            }
        )
    validation_result = dict(validation) if isinstance(validation, Mapping) else _validate_matrix(spec)
    validation_result.setdefault("comparisons", [])
    validation_result.setdefault("status", "not_covered")
    validation_result.setdefault("profile", None)
    validation_result.setdefault("reason", "当前模板没有第二套独立实现。")
    declarations = _declarations(spec, page_texts, validation_result)
    model = _model_info(spec, parameters_raw)

    declaration_failed = any(item["status"] == "fail" for item in declarations)
    if validation_result["status"] == "fail" or declaration_failed or anchor_failures:
        level = "red"
        reason = (
            "存在校验失败或与原文声明矛盾。"
            if validation_result["status"] == "fail" or declaration_failed
            else "参数原文锚点未能核验，禁止作为可信依据。"
        )
    elif validation_result["status"] != "pass":
        level = "gray"
        reason = "该模板没有第二套独立实现，未独立校验。"
    elif anchor_unavailable:
        level = "yellow"
        reason = "部分参数所在页原文不可用，锚点尚不能核验。"
    elif any(item["status"] in ("inferred", "default") for item in parameters):
        level = "yellow"
        reason = "存在推断或默认参数，需用户确认。"
    else:
        level = "green"
        reason = "所有参数来自原文或已确认，独立校验通过。"
    return {
        "version": TRUST_VERSION,
        "generated_at": now_iso(),
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "reason": reason,
        "parameters": parameters,
        "validation": validation_result,
        "declarations": declarations,
        "model": model,
        "anchor_failures": anchor_failures,
        "anchor_unavailable": anchor_unavailable,
        "report_hash": hash_json(
            {
                "object_id": spec.get("object_id"),
                "level": level,
                "parameters": [
                    (item["id"], item["status"], item["anchor_verified"], item["value"])
                    for item in parameters
                ],
                "validation": validation_result.get("status"),
            }
        ),
    }


__all__ = [
    "LEVEL_LABELS",
    "SOURCE_LABELS",
    "TRUST_VERSION",
    "build_trust_report",
    "page_texts_from_pages",
    "page_texts_from_payload",
]
