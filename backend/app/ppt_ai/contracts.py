"""``contracts/ppt-ai`` 的严格校验入口。

与旧 iSpec 校验器不同，本模块**不会**在 Schema 缺失或校验器不可用时放行：
PPT AI 的新执行路径必须做到"Schema/校验器/能力注册表缺失 → 明确不可用并保留原页"。
"""

from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping

from .. import __name__ as _package_name  # noqa: F401 - 保持包被显式导入
from . import VIEW_CONTRACT_VERSION

try:  # pragma: no cover - 依赖环境
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError

    _JSONSCHEMA_IMPORT_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - 依赖环境
    Draft202012Validator = None  # type: ignore[assignment]
    SchemaError = Exception  # type: ignore[assignment,misc]
    _JSONSCHEMA_IMPORT_ERROR = exc

#: 仓库根目录：``backend/app/ppt_ai/contracts.py`` 向上 3 层。
REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_DIR = REPO_ROOT / "contracts" / "ppt-ai"

CONTRACT_FILES: dict[str, str] = {
    "manifest": "manifest.schema.json",
    "region": "region.schema.json",
    "plan": "plan.schema.json",
    "experiment": "experiment.schema.json",
    "view": "view.schema.json",
    "validation": "validation.schema.json",
    "target": "target.schema.json",
    "learning": "learning.schema.json",
}

MAX_VIEW_NODES = 2000
MAX_VIEW_MESSAGE_BYTES = 256 * 1024
_VALID_NODE_TYPES = {
    "group",
    "text",
    "point",
    "line",
    "polyline",
    "rect",
    "circle",
    "axes",
    "curve",
    "heatmap",
    "scene3d",
    "mermaid",
    "chart",
}
_MERMAID_HEAD_RE = re.compile(
    r"^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap)\b",
    re.I,
)
_MERMAID_FORBIDDEN_RE = re.compile(
    r"(?:^\s*click\s+|\bjavascript:|<script\b|\bhref\s*=|\bonclick\s*=|\bforeignObject\b)",
    re.I | re.M,
)
_MERMAID_NODE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,48}$")
_CHART_TYPES = {"bar", "line", "area", "scatter", "pie"}
_FORBIDDEN_KEYS = {
    "script",
    "onclick",
    "onload",
    "onerror",
    "onmouseover",
    "href",
    "src",
    "foreignobject",
    "foreignObject",
    "dangerouslySetInnerHTML",
    "innerHTML",
}


class ContractError(ValueError):
    """契约缺失、Schema 非法或数据不符合白名单。"""


def _finite_tree(value: Any) -> bool:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return True
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    if isinstance(value, list):
        return all(_finite_tree(item) for item in value)
    if isinstance(value, Mapping):
        return all(isinstance(key, str) and _finite_tree(item) for key, item in value.items())
    return False


@lru_cache(maxsize=1)
def _validators() -> dict[str, Any]:
    if Draft202012Validator is None:
        raise ContractError(f"jsonschema 不可用：{_JSONSCHEMA_IMPORT_ERROR}")
    compiled: dict[str, Any] = {}
    for kind, filename in CONTRACT_FILES.items():
        path = SCHEMA_DIR / filename
        if not path.is_file():
            raise ContractError(f"契约缺失：{path}")
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
            compiled[kind] = Draft202012Validator(schema)
        except (OSError, ValueError, SchemaError) as exc:
            raise ContractError(f"契约无法加载（{kind}）：{type(exc).__name__}") from exc
    return compiled


def schema_available(kind: str) -> bool:
    """返回指定契约是否可用；不可用时调用方必须拒绝新规格，而不是放行。"""

    try:
        _validators()
    except ContractError:
        return False
    return kind in CONTRACT_FILES


def validate_contract(kind: str, payload: Any) -> None:
    """按 Schema 校验；失败抛出带路径的 :class:`ContractError`。"""

    if kind not in CONTRACT_FILES:
        raise ContractError(f"未知契约类型：{kind}")
    if not _finite_tree(payload):
        raise ContractError("契约数据包含非有限数值")
    validator = _validators()[kind]
    errors = sorted(validator.iter_errors(payload), key=lambda item: list(item.absolute_path))
    if errors:
        first = errors[0]
        path = "/".join(str(part) for part in first.absolute_path) or "<root>"
        raise ContractError(f"{path}: {first.message}")


def _validate_mermaid_node(node: Mapping[str, Any]) -> None:
    payload = node.get("mermaid")
    if not isinstance(payload, Mapping):
        raise ContractError("mermaid 节点缺少 mermaid 对象")
    code = payload.get("code")
    if not isinstance(code, str) or not code.strip() or len(code) > 4000:
        raise ContractError("mermaid.code 必须为 1~4000 字符")
    if not _MERMAID_HEAD_RE.match(code):
        raise ContractError("mermaid.code 必须以受支持的图类型开头（flowchart/graph/sequenceDiagram/stateDiagram/classDiagram/erDiagram/mindmap）")
    if _MERMAID_FORBIDDEN_RE.search(code):
        raise ContractError("mermaid.code 包含禁止的脚本或交互跳转指令")
    active = payload.get("activeNodes")
    if active is not None:
        if not isinstance(active, list) or len(active) > 16:
            raise ContractError("mermaid.activeNodes 必须为不超过 16 项的数组")
        for item in active:
            if not isinstance(item, str) or not _MERMAID_NODE_ID_RE.fullmatch(item):
                raise ContractError(f"mermaid.activeNodes 包含非法节点 ID：{item}")


def _validate_chart_node(node: Mapping[str, Any]) -> None:
    payload = node.get("chart")
    if not isinstance(payload, Mapping):
        raise ContractError("chart 节点缺少 chart 对象")
    chart_type = payload.get("chartType")
    if chart_type not in _CHART_TYPES:
        raise ContractError(f"chart.chartType 不受支持：{chart_type}")
    series = payload.get("series")
    if not isinstance(series, list) or not (1 <= len(series) <= 6):
        raise ContractError("chart.series 必须包含 1~6 个系列")
    categories = payload.get("categories")
    if chart_type != "scatter":
        if not isinstance(categories, list) or not (1 <= len(categories) <= 40):
            raise ContractError("非散点图必须提供 1~40 个 categories")
        for entry in series:
            values = entry.get("values") if isinstance(entry, Mapping) else None
            if not isinstance(values, list) or len(values) != len(categories):
                raise ContractError("chart.series[].values 长度必须与 categories 一致")
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in values):
                raise ContractError("非散点图 values 必须全部为数值")
    else:
        for entry in series:
            values = entry.get("values") if isinstance(entry, Mapping) else None
            if not isinstance(values, list) or not values:
                raise ContractError("散点图 values 不能为空")
            for pt in values:
                if not isinstance(pt, list) or len(pt) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in pt):
                    raise ContractError("散点图 values 必须为 [x, y] 数值对")
    y_domain = payload.get("yDomain")
    if y_domain is not None:
        if not isinstance(y_domain, list) or len(y_domain) != 2 or float(y_domain[0]) >= float(y_domain[1]):
            raise ContractError("chart.yDomain 必须满足 [min, max] 且 min < max")


def validate_view_ast(ast: Any, *, registered_bindings: Iterable[str] = ()) -> None:
    """校验 ViewAST 的 Schema、节点唯一性、节点数、白名单键与绑定。"""

    validate_contract("view", ast)
    if not isinstance(ast, Mapping):
        raise ContractError("ViewAST 必须是对象")
    if ast.get("version") != VIEW_CONTRACT_VERSION:
        raise ContractError("ViewAST 版本不匹配")
    nodes = ast.get("nodes")
    if not isinstance(nodes, list) or len(nodes) > MAX_VIEW_NODES:
        raise ContractError("ViewAST 节点数超过上限")
    allowed_bindings = set(registered_bindings)
    seen: set[str] = set()

    def walk(items: list[Any]) -> None:
        for node in items:
            if not isinstance(node, Mapping):
                raise ContractError("ViewAST 节点必须是对象")
            identifier = node.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ContractError("ViewAST 节点缺少 id")
            if identifier in seen:
                raise ContractError(f"ViewAST 节点 id 重复：{identifier}")
            seen.add(identifier)
            node_type = node.get("type")
            if node_type not in _VALID_NODE_TYPES:
                raise ContractError(f"ViewAST 节点类型未登记：{node_type}")
            for key in node:
                if key.lower() in _FORBIDDEN_KEYS:
                    raise ContractError(f"ViewAST 禁止字段：{key}")
            binding = node.get("binding")
            if binding is not None and binding not in allowed_bindings:
                raise ContractError(f"ViewAST 绑定未登记：{binding}")
            if node_type == "mermaid":
                _validate_mermaid_node(node)
            elif node_type == "chart":
                _validate_chart_node(node)
            children = node.get("children")
            if isinstance(children, list):
                if len(seen) + len(children) > MAX_VIEW_NODES:
                    raise ContractError("ViewAST 节点数超过上限")
                walk(children)

    walk(nodes)
    encoded = json.dumps(ast, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_VIEW_MESSAGE_BYTES:
        raise ContractError("ViewAST 消息超过 256KB")


__all__ = [
    "CONTRACT_FILES",
    "ContractError",
    "MAX_VIEW_MESSAGE_BYTES",
    "MAX_VIEW_NODES",
    "REPO_ROOT",
    "SCHEMA_DIR",
    "schema_available",
    "validate_contract",
    "validate_view_ast",
]
