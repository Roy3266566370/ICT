"""候选召回：规则特征 + 词汇语义相似度；每个区域最多 5 个候选。"""

from __future__ import annotations

import re
from typing import Iterable, Sequence

from ..conditions.normalize import compact_text
from ..recognition_types import ConditionSet, MatchCandidate, RecallKind, TemplateDescriptor
from ..util import template_tokens

MAX_CANDIDATES = 5


def _contains(text: str, phrase: str) -> bool:
    phrase = compact_text(phrase)
    return bool(phrase) and phrase in text


def _lexical_score(text: str, template: TemplateDescriptor) -> float:
    tokens = template_tokens(
        " ".join((template.description, *template.aliases, *template.examples, template.title))
    )
    if not tokens:
        return 0.0
    hits = sum(1 for token in tokens if token in text)
    return min(0.16, hits / max(1, len(tokens)) * 0.5)


def _condition_keys(condition_set: ConditionSet) -> set[str]:
    return {condition.key for condition in condition_set.conditions if condition.key}


def recall_candidates(
    condition_set: ConditionSet,
    catalog: Sequence[TemplateDescriptor],
    *,
    limit: int = MAX_CANDIDATES,
) -> list[MatchCandidate]:
    text = compact_text(condition_set.text + " " + condition_set.formula)
    present = _condition_keys(condition_set)
    candidates: list[MatchCandidate] = []
    for template in catalog:
        score = 0.0
        reasons: list[str] = []
        recalls: list[RecallKind] = []
        if condition_set.category in template.categories:
            score += 0.24
            reasons.append(f"区域类别与模板类别一致：{condition_set.category}")
            recalls.append("rule")
        keyword_hits = [alias for alias in (*template.aliases, *template.keywords) if _contains(text, alias)]
        if keyword_hits:
            score += min(0.34, 0.08 + 0.055 * len(keyword_hits))
            reasons.append("命中术语：" + "、".join(keyword_hits[:4]))
            recalls.append("rule")
        formula_hit = False
        for pattern in template.formula_patterns:
            try:
                if re.search(pattern, condition_set.text + "\n" + condition_set.formula, re.I):
                    formula_hit = True
                    reasons.append(f"公式特征命中：{pattern}")
                    break
            except re.error:
                continue
        if formula_hit:
            score += 0.18
            recalls.append("rule")
        required = set(template.required_conditions)
        satisfied = required & present
        if required:
            ratio = len(satisfied) / len(required)
            score += 0.24 * ratio
            if ratio == 1:
                score += 0.08
                reasons.append("必需条件均已在原文定位")
            else:
                reasons.append("缺少条件：" + "、".join(sorted(required - satisfied)))
        missing = sorted(required - present)
        conflicts: list[str] = []
        negative_hits = [word for word in template.negative_keywords if _contains(text, word)]
        if negative_hits:
            score -= 0.32
            conflicts.append("命中反例特征：" + "、".join(negative_hits[:3]))
        lexical = _lexical_score(text, template)
        if lexical > 0.01:
            score += lexical
            recalls.append("semantic")
        if not (condition_set.category in template.categories or keyword_hits or formula_hit):
            continue
        score = max(0.0, min(1.0, score))
        if score < 0.12:
            continue
        strong_rule = bool(
            condition_set.category in template.categories
            and (keyword_hits or formula_hit)
            and not missing
            and not conflicts
            and score >= 0.66
        )
        candidates.append(
            MatchCandidate(
                template_ref=template.ref,
                score=round(score, 4),
                recalls=recalls,
                reasons=reasons[:8],
                missing=missing,
                conflicts=conflicts,
                strong_rule=strong_rule,
            )
        )
    candidates.sort(key=lambda item: (item.strong_rule, item.score), reverse=True)
    return candidates[: max(1, min(limit, MAX_CANDIDATES))]


__all__ = ["MAX_CANDIDATES", "recall_candidates"]
