"""LLM 响应的解析、Schema 校验与**证据拒收**。

处理顺序（任何一步失败都只影响该条，不抛裸异常）：

1. 从模型文本中提取 JSON 数组（允许 ```` ```json ```` 代码块与前后说明文字）；
2. 逐条做证据核验：``parameters[].source.page`` 必须为正整数，
   ``source.excerpt`` 必须非空；
3. ``excerpt`` 去掉空白后必须是**该页原文**的子串（模糊匹配只忽略空白，
   不做同义词/改写匹配）——这是"无证据不出结论"的硬实现；
4. 通过证据核验的条目再走正式的 JSON Schema 校验。

证据不足的条目不进入 ``ispecs``，只记进 ``rejected[{index, reason}]``。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from ..validator import validate_ispec

#: 代码块提取（```json ... ``` 或 ``` ... ```）。
_FENCE_PATTERN = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)
#: 空白归一化：只忽略空白，不做任何改写。
_WHITESPACE_PATTERN = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class ParseOutcome:
    """一次响应解析的结果。

    :param ok: 是否成功解析出 JSON 数组（与"是否有条目通过核验"无关）。
    :param reason: ``ok=False`` 时的原因（人类可读）。
    :param ispecs: 通过证据核验与 Schema 校验的 iSpec。
    :param rejected: 被拒收的条目，形状为 ``{"index": int, "reason": str}``。
    """

    ok: bool
    reason: str | None = None
    ispecs: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)


def _normalize(text: str) -> str:
    """去掉全部空白字符（换行/空格/全角空格），用于 excerpt 子串匹配。"""

    return _WHITESPACE_PATTERN.sub("", text)


def _page_texts(pages: Sequence[Mapping[str, Any]] | None) -> dict[int, str]:
    """建立 ``page_no -> 原文`` 映射；只接受正整数页码。"""

    mapping: dict[int, str] = {}
    for page in pages or ():
        if not isinstance(page, Mapping):
            continue
        page_no = page.get("page_no")
        if isinstance(page_no, bool) or not isinstance(page_no, int) or page_no < 1:
            continue
        text = page.get("text")
        if isinstance(text, str):
            mapping[page_no] = text
    return mapping


def _extract_json(raw_text: str) -> tuple[Any | None, str | None]:
    """从模型文本中提取第一个可解析的 JSON 值。

    依次尝试：整段文本 → 每个代码块 → 首个 ``[`` 到末个 ``]`` 的切片。
    """

    if not isinstance(raw_text, str) or not raw_text.strip():
        return None, "LLM 响应为空"

    candidates: list[str] = [raw_text.strip()]
    candidates.extend(block.strip() for block in _FENCE_PATTERN.findall(raw_text))
    start = raw_text.find("[")
    end = raw_text.rfind("]")
    if 0 <= start < end:
        candidates.append(raw_text[start : end + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate), None
        except (ValueError, TypeError):
            continue
    return None, "LLM 响应中没有可解析的 JSON"


def _evidence_problem(
    spec: Mapping[str, Any],
    page_texts: Mapping[int, str],
) -> str | None:
    """检查一条 iSpec 的证据字段；返回问题描述，``None`` 表示证据完整。"""

    parameters = spec.get("parameters")
    if not isinstance(parameters, list):
        # 交给正式 Schema 报错（这里不重复造规则）。
        return None

    for index, parameter in enumerate(parameters):
        if not isinstance(parameter, Mapping):
            return f"parameters[{index}] 不是对象"
        source = parameter.get("source")
        if not isinstance(source, Mapping):
            return f"parameters[{index}].source 缺失"

        page = source.get("page")
        if isinstance(page, bool) or not isinstance(page, int) or page < 1:
            return f"parameters[{index}].source.page 缺失或非法（必须为正整数）"

        excerpt = source.get("excerpt")
        if not isinstance(excerpt, str) or not excerpt.strip():
            return f"parameters[{index}].source.excerpt 为空"

        page_text = page_texts.get(page)
        if page_text is None:
            return f"第 {page} 页原文缺失，无法核验 excerpt"

        if _normalize(excerpt) not in _normalize(page_text):
            # 固定文案：无证据不出结论（调用方与测试都依赖这句话）。
            return "excerpt 未在原文中出现"

    return None


def parse_ispecs(
    raw_text: str,
    *,
    pages: Sequence[Mapping[str, Any]] | None = None,
) -> ParseOutcome:
    """解析模型响应并按证据规则拒收（本函数**不抛异常**）。

    :param raw_text: 模型返回的原始文本（可以是纯 JSON 或带代码块）。
    :param pages: 页面原文列表，元素形状为 ``{"page_no": int, "text": str}``；
        缺省时任何 ``excerpt`` 都无法核验，会被拒收。
    """

    payload, reason = _extract_json(raw_text)
    if reason is not None:
        return ParseOutcome(ok=False, reason=reason)
    if not isinstance(payload, list):
        return ParseOutcome(ok=False, reason="LLM 响应必须是 JSON 数组")

    page_texts = _page_texts(pages)
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            rejected.append({"index": index, "reason": "iSpec 必须是 JSON 对象"})
            continue

        problem = _evidence_problem(item, page_texts)
        if problem is not None:
            rejected.append({"index": index, "reason": problem})
            continue

        messages = validate_ispec(item)
        if messages:
            rejected.append(
                {"index": index, "reason": "iSpec schema 校验失败：" + "；".join(messages)}
            )
            continue

        accepted.append(item)

    return ParseOutcome(ok=True, ispecs=accepted, rejected=rejected)


__all__ = ["ParseOutcome", "parse_ispecs"]