"""静态图重建：把真实求值结果投影成声明式 ViewAST。

不恢复原图的像素外观，而是恢复"图在表达什么"：坐标轴、曲线、矩形、柱形、
文字标注与有限数值几何。原图对照与重建图切换由前端容器提供；无法可靠恢复
外观时进入独立实验，不抹掉原文字、也不放无关示例。
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from . import VIEW_CONTRACT_VERSION
from .contracts import validate_view_ast

#: 画布逻辑尺寸（前端按容器等比缩放）。
CANVAS_WIDTH = 720
CANVAS_HEIGHT = 420
PADDING = 52


def _finite(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _style(**kwargs: Any) -> dict[str, Any]:
    return {key: value for key, value in kwargs.items() if value is not None}


def _y_range(values: Sequence[float]) -> tuple[float, float]:
    finite = [value for value in values if math.isfinite(value)]
    if not finite:
        return -1.0, 1.0
    low, high = min(finite), max(finite)
    if abs(high - low) < 1e-9:
        return low - 1.0, high + 1.0
    margin = (high - low) * 0.12
    return low - margin, high + margin


def _map_point(x: float, y: float, x_min: float, x_max: float, y_min: float, y_max: float) -> tuple[float, float]:
    width = max(1e-9, x_max - x_min)
    height = max(1e-9, y_max - y_min)
    px = PADDING + (x - x_min) / width * (CANVAS_WIDTH - PADDING * 2)
    py = CANVAS_HEIGHT - PADDING - (y - y_min) / height * (CANVAS_HEIGHT - PADDING * 2)
    return round(px, 3), round(py, 3)


def _series_points(series: Sequence[Mapping[str, Any]], domain: tuple[float, float], y_domain: tuple[float, float]) -> list[list[float]]:
    points = []
    for point in series:
        x = point.get("x")
        y = point.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        px, py = _map_point(float(x), float(y), domain[0], domain[1], y_domain[0], y_domain[1])
        points.append([px, py])
    return points


def _axis_ticks(x_min: float, x_max: float, y_min: float, y_max: float) -> list[list[float]]:
    ticks = []
    for index in range(5):
        x = x_min + (x_max - x_min) * index / 4
        px, py = _map_point(x, y_min, x_min, x_max, y_min, y_max)
        ticks.append([px, py])
    return ticks


def calculus_view_ast(
    *,
    title: str,
    series: Sequence[Mapping[str, Any]],
    domain: Mapping[str, Any],
    rects: Sequence[Mapping[str, Any]] = (),
    tangent: Mapping[str, Any] | None = None,
    labels: Sequence[str] = (),
) -> dict[str, Any]:
    x_min = _finite(domain.get("x_min"), -1.0)
    x_max = _finite(domain.get("x_max"), 1.0)
    if x_max <= x_min:
        x_min, x_max = x_min - 1.0, x_max + 1.0
    ys = [float(point["y"]) for point in series if isinstance(point.get("y"), (int, float))]
    y_min, y_max = _y_range(ys)
    nodes: list[dict[str, Any]] = [
        {
            "id": "axes",
            "type": "axes",
            "x_min": x_min,
            "x_max": x_max,
            "y_min": y_min,
            "y_max": y_max,
            "ticks": _axis_ticks(x_min, x_max, y_min, y_max),
            "style": _style(stroke="#94a3b8", strokeWidth=1),
        }
    ]
    for index, rect in enumerate(rects[:240]):
        x0 = rect.get("x0")
        x1 = rect.get("x1")
        height = rect.get("height")
        if not all(isinstance(value, (int, float)) for value in (x0, x1, height)):
            continue
        left, top = _map_point(float(x0), max(0.0, float(height)), x_min, x_max, y_min, y_max)
        right, bottom = _map_point(float(x1), 0.0, x_min, x_max, y_min, y_max)
        nodes.append(
            {
                "id": f"rect_{index}",
                "type": "rect",
                "x": left,
                "y": min(top, bottom),
                "w": max(0.5, abs(right - left)),
                "h": max(0.5, abs(bottom - top)),
                "style": _style(fill="#dbeafe", stroke="#93c5fd", strokeWidth=0.6, opacity=0.72),
            }
        )
    if tangent:
        slope = _finite(tangent.get("m"))
        intercept = _finite(tangent.get("b"))
        left_x, right_x = x_min, x_max
        left_y, right_y = slope * left_x + intercept, slope * right_x + intercept
        x1, y1 = _map_point(left_x, left_y, x_min, x_max, y_min, y_max)
        x2, y2 = _map_point(right_x, right_y, x_min, x_max, y_min, y_max)
        nodes.append(
            {
                "id": "tangent",
                "type": "line",
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "style": _style(stroke="#f97316", strokeWidth=2, dash=[7, 5]),
            }
        )
    points = _series_points(series, (x_min, x_max), (y_min, y_max))
    if points:
        nodes.append(
            {
                "id": "curve",
                "type": "curve",
                "series": points,
                "x_min": x_min,
                "x_max": x_max,
                "y_min": y_min,
                "y_max": y_max,
                "style": _style(stroke="#1d4ed8", strokeWidth=2.4),
            }
        )
    nodes.append(
        {
            "id": "title",
            "type": "text",
            "x": PADDING,
            "y": 18,
            "text": title[:120],
            "style": _style(fill="#0f172a", fontSize=16, fontWeight=700, textAnchor="start"),
        }
    )
    for index, label in enumerate(labels[:8]):
        nodes.append(
            {
                "id": f"label_{index}",
                "type": "text",
                "x": PADDING,
                "y": CANVAS_HEIGHT - 18 - index * 18,
                "text": str(label)[:120],
                "style": _style(fill="#475569", fontSize=12, textAnchor="start"),
            }
        )
    ast = {
        "version": VIEW_CONTRACT_VERSION,
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
        "interactions": [],
        "nodes": nodes,
    }
    validate_view_ast(ast)
    return ast


def chart_view_ast(
    *,
    title: str,
    categories: Sequence[str],
    series: Sequence[Mapping[str, Any]],
    selected: str = "全部",
) -> dict[str, Any]:
    visible_series = [item for item in series if isinstance(item, Mapping)]
    values = [
        float(value)
        for item in visible_series
        for value in item.get("values", [])
        if isinstance(value, (int, float)) and math.isfinite(float(value))
    ]
    y_min = min(0.0, min(values) if values else 0.0)
    y_max = max(1.0, max(values) if values else 1.0)
    count = max(1, len(categories))
    palette = ["#2563eb", "#0f9f6e", "#f59e0b", "#db2777", "#7c3aed", "#0891b2"]
    nodes: list[dict[str, Any]] = [
        {
            "id": "axes",
            "type": "axes",
            "x_min": 0,
            "x_max": count,
            "y_min": y_min,
            "y_max": y_max,
            "ticks": [],
            "style": _style(stroke="#94a3b8", strokeWidth=1),
        }
    ]
    group_width = (CANVAS_WIDTH - PADDING * 2) / count
    series_count = max(1, len(visible_series))
    bar_width = max(2.0, group_width * 0.72 / series_count)
    for series_index, item in enumerate(visible_series[:8]):
        raw_values = item.get("values", [])
        for index, value in enumerate(raw_values[: len(categories)]):
            if not isinstance(value, (int, float)):
                continue
            x = PADDING + index * group_width + group_width * 0.14 + series_index * bar_width
            top, bottom = _map_point(index + 0.5, float(value), 0, count, y_min, y_max)
            _, base = _map_point(index + 0.5, 0.0, 0, count, y_min, y_max)
            nodes.append(
                {
                    "id": f"bar_{series_index}_{index}",
                    "type": "rect",
                    "x": round(x, 3),
                    "y": round(min(top, base), 3),
                    "w": round(bar_width * 0.88, 3),
                    "h": round(max(1.0, abs(base - top)), 3),
                    "style": _style(fill=palette[series_index % len(palette)], stroke="none", opacity=0.82),
                }
            )
    nodes.append(
        {
            "id": "title",
            "type": "text",
            "x": PADDING,
            "y": 18,
            "text": title[:120],
            "style": _style(fill="#0f172a", fontSize=16, fontWeight=700, textAnchor="start"),
        }
    )
    for index, category in enumerate(categories[:12]):
        x = PADDING + (index + 0.5) * group_width
        nodes.append(
            {
                "id": f"category_{index}",
                "type": "text",
                "x": round(x, 3),
                "y": CANVAS_HEIGHT - 24,
                "text": str(category)[:24],
                "style": _style(fill="#475569", fontSize=11, textAnchor="middle"),
            }
        )
    ast = {
        "version": VIEW_CONTRACT_VERSION,
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
        "interactions": [],
        "nodes": nodes,
    }
    validate_view_ast(ast)
    return ast


def matrix_view_ast(*, title: str, matrix: Sequence[Sequence[float]], vector: Sequence[float] | None, product: Sequence[float] | None) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = [
        {
            "id": "title",
            "type": "text",
            "x": PADDING,
            "y": 18,
            "text": title[:120],
            "style": _style(fill="#0f172a", fontSize=16, fontWeight=700, textAnchor="start"),
        }
    ]
    for row in range(2):
        for column in range(2):
            value = matrix[row][column] if row < len(matrix) and column < len(matrix[row]) else 0
            nodes.append(
                {
                    "id": f"cell_{row}_{column}",
                    "type": "rect",
                    "x": PADDING + column * 74,
                    "y": 70 + row * 74,
                    "w": 66,
                    "h": 66,
                    "style": _style(fill="#eff6ff", stroke="#2563eb", strokeWidth=1.4),
                }
            )
            nodes.append(
                {
                    "id": f"cell_text_{row}_{column}",
                    "type": "text",
                    "x": PADDING + column * 74 + 33,
                    "y": 70 + row * 74 + 40,
                    "text": f"{float(value):g}",
                    "style": _style(fill="#1e3a8a", fontSize=18, fontWeight=600, textAnchor="middle"),
                }
            )
    if vector:
        nodes.append(
            {
                "id": "vector_text",
                "type": "text",
                "x": 300,
                "y": 100,
                "text": f"v = ({float(vector[0]):g}, {float(vector[1]):g})",
                "style": _style(fill="#0f172a", fontSize=16, textAnchor="start"),
            }
        )
    if product:
        nodes.append(
            {
                "id": "product_text",
                "type": "text",
                "x": 300,
                "y": 150,
                "text": f"Av = ({float(product[0]):g}, {float(product[1]):g})",
                "style": _style(fill="#047857", fontSize=16, textAnchor="start"),
            }
        )
    ast = {
        "version": VIEW_CONTRACT_VERSION,
        "width": CANVAS_WIDTH,
        "height": CANVAS_HEIGHT,
        "interactions": [],
        "nodes": nodes,
    }
    validate_view_ast(ast)
    return ast


def build_view_ast(node: Mapping[str, Any], evaluation: Mapping[str, Any]) -> dict[str, Any] | None:
    """按 operator/provider 把一次求值投影为 ViewAST。"""

    operator = str(node.get("operator_id") or "")
    provider = node.get("provider") if isinstance(node.get("provider"), Mapping) else {}
    title = str(node.get("title") or "交互视图")
    derived = evaluation.get("derived") if isinstance(evaluation.get("derived"), Mapping) else {}
    node_result = derived.get(str(node.get("node_id"))) if isinstance(derived, Mapping) else None
    if not isinstance(node_result, Mapping):
        node_result = evaluation
    if operator.startswith("lab.calculus") or provider.get("kind") == "expression":
        series = node_result.get("series") if isinstance(node_result.get("series"), list) else []
        domain = node_result.get("domain") if isinstance(node_result.get("domain"), Mapping) else {"x_min": -1, "x_max": 1}
        rects = node_result.get("rects") if isinstance(node_result.get("rects"), list) else []
        tangent = node_result.get("tangent") if isinstance(node_result.get("tangent"), Mapping) else None
        labels = []
        for metric in node_result.get("metrics", []) if isinstance(node_result.get("metrics"), list) else []:
            if isinstance(metric, Mapping):
                labels.append(f"{metric.get('label', '')}: {metric.get('value', '')}")
        return calculus_view_ast(title=title, series=series, domain=domain, rects=rects, tangent=tangent, labels=labels)
    if operator == "native.chart.explore":
        chart = provider.get("chart") if isinstance(provider.get("chart"), Mapping) else {}
        categories = [str(item) for item in chart.get("categories", [])]
        series = [item for item in chart.get("series", []) if isinstance(item, Mapping)]
        return chart_view_ast(title=title, categories=categories, series=series)
    if operator == "matrix.transform":
        matrix = provider.get("matrix") if isinstance(provider.get("matrix"), list) else [[1, 0], [0, 1]]
        vector = provider.get("vector") if isinstance(provider.get("vector"), list) else None
        product = node_result.get("product") if isinstance(node_result.get("product"), list) else None
        return matrix_view_ast(title=title, matrix=matrix, vector=vector, product=product)
    return None


__all__ = [
    "CANVAS_HEIGHT",
    "CANVAS_WIDTH",
    "build_view_ast",
    "calculus_view_ast",
    "chart_view_ast",
    "matrix_view_ast",
]
