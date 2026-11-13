"""跨 iSpec 参数同一性（整改文件 §9-4）。

问题：同一门课里"销售额"会同时出现在第 2 页的柱子图与第 7 页的汇总表上。若两页各自
持有一份互不相干的参数，用户在某一页改完再翻页，另一页仍显示旧值——"改一处、全课同步"
就落空了。这里在不引入跨页运行时的前提下，用**共享标识**把同一变量钉在一起：

1. **归一化签名** = ``label + unit + type``，逐项做 NFKC（全角→半角）、去空白、大小写折叠，
   因此 ``"销售额"`` 与 ``" 销售额 "``、``"＄"`` 与 ``"$"`` 视为同一签名；
2. 同一签名出现在**不同 iSpec** 中 ≥2 次才分配 ``shared_key``（只在一条 iSpec 里出现
   等同于页内参数，不共享）；
3. ``shared_key`` 形如 ``shared_销售额_a1b2c3d4``：可读前缀 + 签名 SHA-1 前 8 位，
   签名不变则键不变（跨进程、跨机器稳定）；
4. 同签名但 ``default`` 不同的组标 ``conflict=True`` 并记录各自的默认值，
   **绝不自动改默认值**——用哪一个值必须由用户确认。

本模块全部是纯函数：不修改入参、不读写文件、不依赖全局状态，可重入。
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

#: ``shared_key`` 前缀（前端 sessionStorage 共享池的键值语义由此区分）。
SHARED_KEY_PREFIX = "shared_"
#: ``shared_key`` 中可读标签的最大长度（防止键过长）。
_SLUG_MAX = 24
#: 签名内部分隔符（``\x1f`` 不会出现在任何正常 label/unit/type 中）。
_SIGNATURE_SEPARATOR = "\x1f"
_WHITESPACE = re.compile(r"\s+")
_UNSAFE = re.compile(r"[^0-9A-Za-z_\u4e00-\u9fff]+")
_HASH_LENGTH = 8


def normalize_token(text: Any) -> str:
    """归一化单个字段：NFKC（全角→半角）→ 去全部空白 → 大小写折叠。"""
    normalized = unicodedata.normalize("NFKC", str(text if text is not None else ""))
    return _WHITESPACE.sub("", normalized).casefold()


def parameter_signature(parameter: Mapping[str, Any]) -> str:
    """参数的同一性签名：``label | unit | type``（三项均已归一化）。

    ``type`` 缺省按 Schema 默认值 ``number`` 处理，避免同一变量因为显式/隐式类型
    不一致而被拆成两组。
    """
    label = normalize_token(parameter.get("label"))
    unit = normalize_token(parameter.get("unit"))
    parameter_type = normalize_token(parameter.get("type") or "number")
    return _SIGNATURE_SEPARATOR.join((label, unit, parameter_type))


def shared_key_for(signature: str, label: Any) -> str:
    """由签名生成稳定的 ``shared_key``：``shared_<可读标签>_<哈希8位>``。"""
    digest = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:_HASH_LENGTH]
    slug = _UNSAFE.sub("", unicodedata.normalize("NFKC", str(label or "")))[:_SLUG_MAX]
    return f"{SHARED_KEY_PREFIX}{slug or 'param'}_{digest}"


def _default_fingerprint(value: Any) -> str:
    """默认值的比较指纹：数值按浮点比较（``10`` 与 ``10.0`` 视为相同）。"""
    if isinstance(value, bool):
        return f"b:{value}"
    if isinstance(value, (int, float)):
        return f"n:{float(value):.12g}"
    return f"s:{value}"


def _page_of(parameter: Mapping[str, Any]) -> int | None:
    source = parameter.get("source")
    if not isinstance(source, Mapping):
        return None
    page = source.get("page")
    return page if isinstance(page, int) and not isinstance(page, bool) else None


def _excerpt_of(parameter: Mapping[str, Any]) -> str:
    source = parameter.get("source")
    if not isinstance(source, Mapping):
        return ""
    excerpt = source.get("excerpt")
    return excerpt if isinstance(excerpt, str) else ""


@dataclass(frozen=True, slots=True)
class SharedAssignResult:
    """一次共享键分配的结果（纯数据，可直接 JSON 化）。"""

    #: 签名 → ``{shared_key, label, unit, type, occurrences, conflict, defaults}``。
    groups: Mapping[str, dict[str, Any]] = field(default_factory=dict)
    #: ``object_id`` → ``{parameter_id: shared_key}``，由调用方写回各 iSpec。
    assignments: Mapping[str, Mapping[str, str]] = field(default_factory=dict)

    @property
    def shared_groups(self) -> list[dict[str, Any]]:
        """按 ``shared_key`` 排序的组列表（稳定输出，便于前端与快照比对）。"""
        return sorted(self.groups.values(), key=lambda group: str(group["shared_key"]))

    @property
    def conflicts(self) -> list[dict[str, Any]]:
        """默认值不一致、需要用户确认的组。"""
        return [group for group in self.shared_groups if group.get("conflict")]


def assign_shared_keys(specs: Sequence[Mapping[str, Any]]) -> SharedAssignResult:
    """为跨 iSpec 重复出现的同一变量分配 ``shared_key``。

    :param specs: 已通过 Schema 校验的 iSpec 列表（本函数不修改它们）。
    :returns: :class:`SharedAssignResult`；只在一条 iSpec 出现的参数不分配共享键。
    """
    # 签名 → 观测到的出现位置（保序）
    occurrences: dict[str, list[dict[str, Any]]] = {}
    object_ids: dict[str, set[str]] = {}
    defaults: dict[str, list[Any]] = {}
    fingerprints: dict[str, set[str]] = {}
    labels: dict[str, str] = {}
    units: dict[str, str] = {}
    types: dict[str, str] = {}

    for spec in specs:
        if not isinstance(spec, Mapping):
            continue
        object_id = spec.get("object_id")
        if not isinstance(object_id, str) or not object_id:
            continue
        parameters = spec.get("parameters")
        if not isinstance(parameters, Sequence) or isinstance(parameters, (str, bytes)):
            continue
        for parameter in parameters:
            if not isinstance(parameter, Mapping):
                continue
            parameter_id = parameter.get("id")
            label = parameter.get("label")
            if not isinstance(parameter_id, str) or not parameter_id:
                continue
            if not isinstance(label, str) or not normalize_token(label):
                continue

            signature = parameter_signature(parameter)
            page = _page_of(parameter)
            occurrences.setdefault(signature, []).append(
                {
                    "object_id": object_id,
                    "param_id": parameter_id,
                    "page": page,
                    "excerpt": _excerpt_of(parameter),
                }
            )
            object_ids.setdefault(signature, set()).add(object_id)
            fingerprint = _default_fingerprint(parameter.get("default"))
            seen_fingerprints = fingerprints.setdefault(signature, set())
            if fingerprint not in seen_fingerprints:
                seen_fingerprints.add(fingerprint)
                defaults.setdefault(signature, []).append(parameter.get("default"))
            labels.setdefault(signature, label)
            units.setdefault(signature, str(parameter.get("unit") or ""))
            types.setdefault(signature, str(parameter.get("type") or "number"))

    groups: dict[str, dict[str, Any]] = {}
    assignments: dict[str, dict[str, str]] = {}
    for signature, members in occurrences.items():
        # 只在一个 iSpec 里出现 = 页内参数，不共享
        if len(object_ids[signature]) < 2:
            continue
        shared_key = shared_key_for(signature, labels[signature])
        distinct_defaults = defaults.get(signature, [])
        groups[signature] = {
            "shared_key": shared_key,
            "label": labels[signature],
            "unit": units[signature],
            "type": types[signature],
            "occurrences": list(members),
            "conflict": len(distinct_defaults) > 1,
            "defaults": list(distinct_defaults),
        }
        for member in members:
            assignments.setdefault(member["object_id"], {})[member["param_id"]] = shared_key

    return SharedAssignResult(groups=groups, assignments=assignments)


def apply_shared_keys(
    specs: Sequence[Mapping[str, Any]],
    result: SharedAssignResult,
) -> list[dict[str, Any]]:
    """把共享键写进 iSpec 参数（返回新列表，不改入参）。

    只覆盖/补写 ``shared_key`` 字段，其余字段保持原样；未分配的参数不带该字段。
    """
    applied: list[dict[str, Any]] = []
    for spec in specs:
        if not isinstance(spec, Mapping):
            continue
        object_id = spec.get("object_id")
        per_spec = result.assignments.get(object_id) if isinstance(object_id, str) else None
        if not per_spec:
            applied.append(dict(spec))
            continue
        raw_parameters = spec.get("parameters")
        parameters: list[Any] = []
        if isinstance(raw_parameters, Sequence) and not isinstance(raw_parameters, (str, bytes)):
            for parameter in raw_parameters:
                if not isinstance(parameter, Mapping):
                    parameters.append(parameter)
                    continue
                parameter_id = parameter.get("id")
                shared_key = per_spec.get(parameter_id) if isinstance(parameter_id, str) else None
                parameters.append(
                    {**parameter, "shared_key": shared_key} if shared_key else dict(parameter)
                )
        else:  # pragma: no cover - Schema 已保证 parameters 是数组
            parameters = list(raw_parameters) if isinstance(raw_parameters, list) else []
        applied.append({**spec, "parameters": parameters})
    return applied


__all__ = [
    "SHARED_KEY_PREFIX",
    "SharedAssignResult",
    "apply_shared_keys",
    "assign_shared_keys",
    "normalize_token",
    "parameter_signature",
    "shared_key_for",
]