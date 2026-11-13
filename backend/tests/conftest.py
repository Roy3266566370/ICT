"""pytest 共享配置：把 ``backend/`` 加入导入路径，并提供黄金夹具加载与子集断言。

本文件只负责测试基础设施，不包含任何业务逻辑。
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

import pytest

# backend/tests/conftest.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="session")
def repo_root() -> Path:
    """仓库根目录（用于定位 ``fixtures/golden``）。"""

    return REPO_ROOT


@pytest.fixture
def load_golden(repo_root: Path) -> Callable[[str], dict[str, Any]]:
    """加载 ``fixtures/golden/<template_id>.json``。"""

    def _load(template_id: str) -> dict[str, Any]:
        path = repo_root / "fixtures" / "golden" / f"{template_id}.json"
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)

    return _load


@pytest.fixture
def assert_subset() -> Callable[..., None]:
    """断言 ``expected`` 中的每个字段都在 ``actual`` 中出现且数值一致。

    - ``expected`` 为 object：只校验出现的键（黄金夹具常省略未覆盖字段）。
    - ``expected`` 为数组：长度必须一致，逐项递归。
    - 数值：容差 1e-9（§2.3.6 规则 3）。
    """

    def _is_number(value: object) -> bool:
        return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)

    def _check(actual: Any, expected: Any, path: str = "root") -> None:
        if isinstance(expected, Mapping):
            assert isinstance(actual, Mapping), f"{path}: 期望对象，实际 {type(actual).__name__}"
            for key, expected_value in expected.items():
                assert key in actual, f"{path}.{key}: 缺少字段 {key!r}"
                _check(actual[key], expected_value, f"{path}.{key}")
            return

        if isinstance(expected, (list, tuple)):
            assert isinstance(actual, (list, tuple)), f"{path}: 期望数组，实际 {type(actual).__name__}"
            assert len(actual) == len(expected), f"{path}: 数组长度 {len(actual)} != {len(expected)}"
            for index, expected_item in enumerate(expected):
                _check(actual[index], expected_item, f"{path}[{index}]")
            return

        if _is_number(expected):
            assert _is_number(actual), f"{path}: 期望数值，实际 {type(actual).__name__}"
            assert actual == pytest.approx(expected, abs=1e-9, rel=0), (
                f"{path}: 期望 {expected}，实际 {actual}"
            )
            return

        assert actual == expected, f"{path}: 期望 {expected!r}，实际 {actual!r}"

    return _check