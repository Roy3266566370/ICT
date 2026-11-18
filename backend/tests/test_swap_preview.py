"""拖拽边界的只读换序预览：支持线性/二次分段，拒绝越界与非法表达式。"""
from __future__ import annotations

from app.labs.order_swap_general import preview_swap


def test_linear_region_preview_is_verified():
    result = preview_swap("x*y", "x", "0", "1", "0", "x")

    assert result["supported"] is True
    assert result["piece_count"] >= 1
    for record in result["swaps"]:
        assert record["region_verified"] is True
        assert record["numeric_verified"] is True


def test_non_monotone_quadratic_boundary_splits_into_two_pieces():
    result = preview_swap("1", "x", "-1", "1", "0", "x**2")

    assert result["supported"] is True
    assert result["piece_count"] == 2
    assert all(record["region_verified"] for record in result["swaps"])


def test_crossed_or_empty_region_is_rejected():
    result = preview_swap("1", "x", "0", "1", "x", "0")

    assert result["supported"] is False
    assert "单调" in result["reason"] or "换序" in result["reason"]


def test_invalid_expression_or_variable_is_rejected():
    assert preview_swap("__import__('os')", "x", "0", "1", "0", "x")["supported"] is False
    assert preview_swap("x*y", "z", "0", "1", "0", "x")["supported"] is False
    assert preview_swap("x*y", "x", "0", "1", "0", "y")["supported"] is False
    assert preview_swap("x*y", "x", "1", "0", "0", "x")["supported"] is False
