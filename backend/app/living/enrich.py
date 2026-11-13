"""enrich：在保真块上生成激活建议（ActivationSuggestion，纯函数）。

只建议、不动手：返回的建议全部是 ``pending``，是否物化由用户在编辑器里决定。
识别置信度低的文本不提建议——宁可少，不可错（老师划错建议只要一秒，但
被错建议烦到就再也不点了）。
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .model import make_suggestion

#: 题目建议的最低要求：科目可分类 + 含"要求动手做"的动词/问句。
#: 学科名词（矩阵、积分…）单独出现只是章节标题，不构成题目。
_SOLVE_CUE = re.compile(
    r"(求|解|计算|证明|化简|试求|求出|推导|作出|画出|设计|实现|执行|模拟|写出|比较|分析|讨论|？|\?|solve|evaluate|compute|determine|find|prove|derive|implement|simulate)",
    re.I,
)
#: 章节/小节标题行——即使含学科名词也不是题目（编号题目靠 _SOLVE_CUE 区分）。
_HEADING_LINE = re.compile(r"^\s*(?:第\s*[0-9一二三四五六七八九十]+\s*[章节篇课部]|§\s*\d+)")
_LATEX_DISPLAY = re.compile(r"(\$\$[^$]+\$\$|\\\[[^\]]+\\\]|\\begin\{equation\*?\}[^$]+?\\end\{equation\*?\})", re.S)
_LATEX_INLINE = re.compile(r"(\\frac|\\int|\\sum|\\sqrt|\\lim|\\partial|\\nabla|\\alpha|\\beta|\\lambda|\\pi)")
_MAX_LAB_SUGGESTIONS = 12
_MAX_FORMULA_SUGGESTIONS = 12
_LECTURE_TASK = re.compile(r"(?:^|\n)\s*(?:[例题练习\d.、：: ]{0,12})?(?:求(?:出|解|矩阵|函数|积分|导数)|计算|证明|解方程|已知)")


def _subject_label(subject: str) -> str:
    from ..labs.recognize import SUBJECT_LABELS

    return str(SUBJECT_LABELS.get(subject) or subject)


def suggest_for_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """扫描块序列，返回 pending 建议列表。"""

    from ..labs.recognize import classify_subject

    suggestions: list[dict[str, Any]] = []
    lab_count = formula_count = 0
    attention_added = False

    for block in blocks:
        if block.get("type") != "text":
            continue
        text = str((block.get("data") or {}).get("md") or "").strip()
        if not attention_added and re.search(r"注意力|self[ -]?attention|scaled[ -]?dot[ -]?product", text, re.I):
            suggestions.append(make_suggestion(
                "canvas_object", block["id"], {"template": "attention"},
                "添加注意力教学实验：调节 Query、温度与因果掩码，观察权重和加权输出（示例数据，保留原文）",
                confidence=0.95,
            ))
            attention_added = True
            continue
        if len(text) < 8 or _HEADING_LINE.match(text):
            continue

        # 题目建议：科目可分类 + 求解动词/问句 → "可生成解题实验"
        is_lecture = bool((block.get("data") or {}).get("collapsed"))
        if lab_count < _MAX_LAB_SUGGESTIONS and (not is_lecture or _LECTURE_TASK.search(text)):
            subject, confidence = classify_subject(text)
            if subject != "unknown" and confidence >= 0.25 and _SOLVE_CUE.search(text):
                suggestions.append(make_suggestion(
                    "lab", block["id"],
                    {"text": text[:8000]},
                    f"检测到{_subject_label(subject)}题目，可一键生成解题实验嵌入此处",
                    confidence=confidence,
                ))
                lab_count += 1
                continue  # 同一块优先题目建议

        # 公式建议：文本块里夹着 $$…$$ 展示公式 → "抽成独立公式块"
        if formula_count < _MAX_FORMULA_SUGGESTIONS:
            match = _LATEX_DISPLAY.search(text)
            if match and not _LATEX_DISPLAY.fullmatch(text.strip()):
                before = text[: match.start()].strip()
                after = text[match.end():].strip()
                suggestions.append(make_suggestion(
                    "formula", block["id"],
                    {"latex": match.group(0).strip("$\\[] "), "before": before, "after": after},
                    "检测到展示公式，可抽成独立公式块便于排版",
                    confidence=0.7,
                ))
                formula_count += 1

    return suggestions


def suggest_for_text(text: str) -> list[dict[str, Any]]:
    """单段文本的建议预览（插入实验块前的干跑）。"""
    block = {"id": "preview", "type": "text", "data": {"md": text}}
    return suggest_for_blocks([block])


__all__ = ["suggest_for_blocks", "suggest_for_text"]
