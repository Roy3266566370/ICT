"""iSpec 的 JSON Schema 校验（``jsonschema`` 实现）。

Schema 已冻结在 ``contracts/spec/ispec.schema.json``（2020-12），本模块只读不改。

设计约束：

1. **不拖垮整个材料**：单条失败只记录错误并丢弃该条（见 :func:`filter_valid_ispecs`）；
2. **Schema 缺失不丢数据**：契约文件读不到时降级为"全部通过"并记录告警，
   不让夹具缺失把用户材料判成识别失败；
3. **校验器缓存**：Schema 解析与编译只做一次（``lru_cache``）。
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

try:  # pragma: no cover - 依赖环境
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError

    _JSONSCHEMA_IMPORT_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover - 依赖环境
    Draft202012Validator = None  # type: ignore[assignment]
    SchemaError = Exception  # type: ignore[assignment,misc]
    _JSONSCHEMA_IMPORT_ERROR = exc

#: 仓库根目录（``backend/app/ispec/validator.py`` 向上 3 层）。
REPO_ROOT = Path(__file__).resolve().parents[3]
#: 冻结的 iSpec Schema 路径。
SCHEMA_PATH = REPO_ROOT / "contracts" / "spec" / "ispec.schema.json"


def _load_schema() -> dict[str, Any] | None:
    """读取 Schema；文件缺失/损坏返回 ``None``（调用方降级为不校验）。"""
    if not SCHEMA_PATH.is_file():
        logger.warning("iSpec Schema 缺失：%s，本次跳过校验", SCHEMA_PATH)
        return None
    try:
        import json

        payload = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("iSpec Schema 读取失败（%s），本次跳过校验", type(exc).__name__)
        return None
    return payload if isinstance(payload, dict) else None


@lru_cache(maxsize=1)
def _validator() -> Any | None:
    """编译并缓存 Draft 2020-12 校验器；不可用时返回 ``None``。"""
    if Draft202012Validator is None:
        logger.warning("jsonschema 不可用（%s），本次跳过 iSpec 校验", _JSONSCHEMA_IMPORT_ERROR)
        return None
    schema = _load_schema()
    if schema is None:
        return None
    try:
        return Draft202012Validator(schema)
    except SchemaError as exc:  # pragma: no cover - 契约文件被篡改
        logger.error("iSpec Schema 自身非法，已跳过校验：%s", exc.message)
        return None


def validate_ispec(spec: Any) -> list[str]:
    """校验单条 iSpec，返回人类可读的错误列表（空列表表示通过）。

    错误格式：``"parameters[0].source.page: '1' is not of type 'integer'"``。
    校验器不可用时返回空列表（降级，不阻断识别链路）。
    """
    validator = _validator()
    if validator is None:
        return []
    errors = sorted(validator.iter_errors(spec), key=lambda item: list(item.absolute_path))
    messages: list[str] = []
    for error in errors:
        path = "/".join(str(part) for part in error.absolute_path) or "<root>"
        messages.append(f"{path}: {error.message}")
    return messages


def filter_valid_ispecs(
    specs: Iterable[Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """逐条校验并丢弃非法项。

    :returns: ``(通过校验的 iSpec 列表, 错误记录列表)``；错误记录形状为
        ``{"object_id": ..., "errors": [...]}``，供 API 写入诊断产物。
    """
    valid: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for spec in specs:
        if not isinstance(spec, dict):
            errors.append({"object_id": None, "errors": ["iSpec 必须是对象"]})
            continue
        messages = validate_ispec(spec)
        if messages:
            errors.append({"object_id": spec.get("object_id"), "errors": messages})
            continue
        valid.append(spec)
    return valid, errors


__all__ = ["SCHEMA_PATH", "filter_valid_ispecs", "validate_ispec"]