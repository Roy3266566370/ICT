from __future__ import annotations

import base64
import binascii
import math
import re

from ..workshop.model import validate_canvas_doc


_TEMPLATE_ID = re.compile(r"[A-Za-z0-9_-]{1,80}")
_WORK_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_PRESET_ID = re.compile(r"[A-Za-z0-9_-]{1,40}")
_PREVIEW_PREFIX = re.compile(r"data:image/(?:png|jpeg|webp);base64,")


def _finite(value) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _param_key(value) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 64


def _presets(value) -> list:
    if not isinstance(value, list) or len(value) > 8:
        raise ValueError("工坊插件最多可保存 8 个情景预设")
    result = []
    ids = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("工坊插件情景预设不合法")
        key, label, params = (item.get(name) for name in ("id", "label", "params"))
        if not isinstance(key, str) or not _PRESET_ID.fullmatch(key) or key in ids:
            raise ValueError("工坊插件情景预设标识不合法")
        if not isinstance(label, str) or not label.strip() or len(label) > 24:
            raise ValueError("工坊插件情景预设名称不合法")
        if not isinstance(params, dict) or len(params) > 24 or any(
                not _param_key(param) or not _finite(number) for param, number in params.items()):
            raise ValueError("工坊插件情景预设参数不合法")
        ids.add(key)
        clean = {"id": key, "label": label, "params": dict(params)}
        if "cursor" in item:
            cursor = item["cursor"]
            if not _finite(cursor) or not 0 <= cursor <= 1:
                raise ValueError("工坊插件情景预设时间轴位置不合法")
            clean["cursor"] = cursor
        result.append(clean)
    return result


def _preview(value) -> str:
    if not isinstance(value, str) or len(value) > 350_000:
        raise ValueError("工坊插件预览图过大或格式不合法")
    prefix = _PREVIEW_PREFIX.match(value)
    if prefix is None:
        raise ValueError("工坊插件预览图格式不合法")
    try:
        payload = base64.b64decode(value[prefix.end():], validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("工坊插件预览图编码不合法") from None
    if not payload or len(payload) > 256 * 1024:
        raise ValueError("工坊插件预览图过大或格式不合法")
    return value


def validate_workshop_plugin(value: dict, *, public: bool = False) -> dict:
    if not isinstance(value, dict):
        raise ValueError("工坊插件配置不合法")
    template = value.get("template_kind")
    if not isinstance(template, str) or not _TEMPLATE_ID.fullmatch(template):
        raise ValueError("工坊插件模板标识不合法")
    clean = {"template_kind": template}
    for field, limit in (("title", 120), ("category", 40)):
        text = value.get(field, "")
        if public:
            text = str(text or "")[:limit]
        if not isinstance(text, str) or len(text) > limit:
            raise ValueError("工坊插件名称或分类不合法")
        clean[field] = text

    for field, allowed in (
        ("display_mode", ("full", "compact", "stage_only")),
        ("theme", ("auto", "light", "dark")),
        ("transparent_bg", ()),
        ("hide_border", ()),
    ):
        if field not in value:
            continue
        setting = value[field]
        valid = isinstance(setting, str) and setting in allowed if allowed else type(setting) is bool
        if valid:
            clean[field] = setting
        elif not public:
            raise ValueError("工坊插件呈现设置不合法")

    if "work_id" in value:
        work_id = value["work_id"]
        if isinstance(work_id, str) and _WORK_ID.fullmatch(work_id):
            clean["work_id"] = work_id
        elif not public:
            raise ValueError("工坊插件来源作品标识不合法")
    if "visible_params" in value:
        params = value["visible_params"]
        if isinstance(params, list) and len(params) <= 24 and all(map(_param_key, params)):
            clean["visible_params"] = list(params)
        elif public:
            clean["visible_params"] = []
        else:
            raise ValueError("工坊插件公开参数列表不合法")
    for field, validator in (("presets", _presets), ("preview_data", _preview), ("doc", validate_canvas_doc)):
        if field not in value or field == "doc" and value[field] is None:
            continue
        try:
            clean[field] = validator(value[field])
        except (TypeError, ValueError, OverflowError) as exc:
            if not public:
                raise ValueError(f"工坊插件 {field} 不合法：{exc}") from exc
    if template == "custom-work" and "doc" not in clean:
        raise ValueError("工坊插件缺少自定义作品画布")
    return clean
