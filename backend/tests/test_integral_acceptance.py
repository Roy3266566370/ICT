"""独立验收集的回归入口；题集与开发调试用例分离。"""
from __future__ import annotations

import pytest

from scripts.integral_acceptance import (
    CATEGORY_ORDER,
    CASES,
    METRIC_LABELS,
    run_case,
)


@pytest.mark.acceptance
@pytest.mark.parametrize("case", CASES, ids=[case.id for case in CASES])
def test_independent_integral_acceptance_case(case):
    result = run_case(case)
    if result["passed"]:
        return
    messages = [
        f"{METRIC_LABELS[key]}: {message}"
        for key, items in result["metrics"].items()
        for message in items
    ]
    pytest.fail("\n".join(messages))


@pytest.mark.acceptance
def test_acceptance_set_covers_required_categories():
    categories = {case.category for case in CASES}
    assert set(CATEGORY_ORDER) <= categories
    identifiers = [case.id for case in CASES]
    assert len(identifiers) == len(set(identifiers))
    assert len(CASES) >= 30
