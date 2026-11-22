"""HuggingFace Math-Verify 适配层：增强 LaTeX / 区间 / 集合 / 不等式等价判分与对账。

仅作为现有确定性 SymPy 校验的补充通道：
- 依赖未安装或解析失败时返回 None，不阻断主链路；
- Windows 下关闭内部 multiprocessing 信号超时，避免 spawn 句柄错误，改由长度上限保护；
- 绝不把空解析结果误判为等价。
"""
from __future__ import annotations

import logging
import re
import sys
from typing import Any

MAX_VERIFY_CHARS = 800

try:
    from math_verify import (
        ExprExtractionConfig,
        LatexExtractionConfig,
        parse as _mv_parse,
        verify as _mv_verify,
    )
    _AVAILABLE = True
    # 关闭 parsing_timeout=None 时的冗余提示日志
    logging.getLogger("math_verify").setLevel(logging.ERROR)
except Exception:  # noqa: BLE001 - 可选依赖缺失时静默降级
    _AVAILABLE = False
    ExprExtractionConfig = None  # type: ignore[assignment]
    LatexExtractionConfig = None  # type: ignore[assignment]
    _mv_parse = None  # type: ignore[assignment]
    _mv_verify = None  # type: ignore[assignment]


def is_available() -> bool:
    return _AVAILABLE


def _normalize_plain_math(text: str) -> str:
    """把常见纯文本/中文数学记号规范为 Math-Verify 可稳定解析的 LaTeX。"""
    s = text.strip()
    s = (
        s.replace("≤", r"\le ")
        .replace("≥", r"\ge ")
        .replace("≠", r"\ne ")
        .replace("∞", r"\infty ")
        .replace("π", r"\pi ")
        .replace("∪", r"\cup ")
        .replace("∩", r"\cap ")
        .replace("∅", r"\emptyset ")
        .replace("∈", r"\in ")
        .replace("·", r"\cdot ")
        .replace("×", r"\times ")
        .replace("÷", "/")
        .replace("−", "-")
    )
    # 剥离常见中文前缀（如 "答案："、"结果为 "）
    s = re.sub(r"^(?:答案|结果|解|值)\s*[：:=为是]\s*", "", s)
    # 兼容 SymPy 风格的 ** 幂运算与 oo 无穷
    s = s.replace("**", "^")
    s = re.sub(r"(?<![A-Za-z\\])oo(?![A-Za-z])", r"\\infty", s)
    s = re.sub(r"(?<![A-Za-z\\])pi(?![A-Za-z])", r"\\pi", s)
    # 在微积分/SymPy 语境下，无下标的 log 默认表示自然对数 ln
    s = re.sub(r"(?<!\\)\blog\s*\(", r"\\ln(", s)
    s = re.sub(r"\\log(?!_)\s*\(", r"\\ln(", s)
    s = re.sub(r"(?<!\\)\bln\s*\(", r"\\ln(", s)
    # 把 sqrt(arg) 转为 \sqrt{arg}（仅处理单层括号，嵌套情况交给 ExprExtractionConfig）
    s = re.sub(r"(?<!\\)\bsqrt\(([^()]+)\)", r"\\sqrt{\1}", s)
    s = s.replace("<=", r"\le ").replace(">=", r"\ge ").replace("!=", r"\ne ")
    if not any(marker in s for marker in ("$", r"\(", r"\[")):
        s = f"${s}$"
    return s


def _extract(raw: str) -> list[Any]:
    if not _AVAILABLE or _mv_parse is None:
        return []
    text = (raw or "").strip()
    if not text or len(text) > MAX_VERIFY_CHARS:
        return []
    cfg = [LatexExtractionConfig(), ExprExtractionConfig()]
    timeout = None if sys.platform == "win32" else 2
    normalized = _normalize_plain_math(text)
    try:
        parsed = _mv_parse(normalized, extraction_config=cfg, parsing_timeout=timeout)
        if parsed:
            return list(parsed)
    except Exception:  # noqa: BLE001
        pass
    if normalized != text:
        try:
            parsed = _mv_parse(text, extraction_config=cfg, parsing_timeout=timeout)
            if parsed:
                return list(parsed)
        except Exception:  # noqa: BLE001
            pass
    return []


def verify_math_equivalence(
    expected: str,
    actual: str,
    *,
    float_rounding: int = 6,
) -> bool | None:
    """使用 Math-Verify 比较两个数学答案是否语义等价。

    返回:
    - ``True``: 确认数学等价（含分式、根式化简、区间、集合、不等式翻转、LaTeX 等）
    - ``False``: 两者均成功解析且确认不等价
    - ``None``: 库不可用或任一侧无法解析（交回调用方走原有规则）
    """
    if not _AVAILABLE or _mv_verify is None:
        return None
    gold = _extract(expected)
    pred = _extract(actual)
    if not gold or not pred:
        return None
    timeout = None if sys.platform == "win32" else 3
    try:
        return bool(
            _mv_verify(
                gold,
                pred,
                float_rounding=float_rounding,
                timeout_seconds=timeout,
            )
        )
    except Exception:  # noqa: BLE001
        return None


__all__ = ["is_available", "verify_math_equivalence"]
