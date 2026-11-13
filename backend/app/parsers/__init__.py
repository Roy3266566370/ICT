"""材料解析包（C-MAT@1，plan §2.2.10）。

本包只做两件事，且都必须是**纯读取**：

* :func:`~app.parsers.pptx_parser.parse_pptx` —— 把 PPTX 解析为
  ``material.json`` / ``slides.json`` 两个 Python 字典；
* :func:`~app.parsers.candidates.map_candidates` —— 从页面文本中规则化提取
  候选数学对象（不编造、不合并同名符号）。

T7 的上传链路只依赖本包导出的 ``parse_pptx`` / ``map_candidates`` /
``ParseError`` 三个入口，不得复制解析逻辑（plan §2.2.10 P1 澄清）。

导入示例::

    from app.parsers import ParseError, map_candidates, parse_pptx

    material, slides = parse_pptx("用空间视角理解矩阵运算.pptx",
                                  material_id="mat_matrix_courseware")
    candidates = map_candidates(slides)

``import app.parsers`` 本身不需要 ``python-pptx``：该依赖只在 ``parse_pptx``
被调用时需要，缺失时抛出 :class:`ParseError`（对应 ``MODEL_UNAVAILABLE`` 降级）。
"""

from __future__ import annotations

from typing import Final

#: 解析器版本串，写入 ``material.json.parser_version``（plan §2.2.10）。
PARSER_VERSION: Final[str] = "pptx_parser_v1"

#: ``ParseError.code`` 的合法取值，与 C-ERR@1 的错误码集合对齐。
PARSE_ERROR_CODES: Final[frozenset[str]] = frozenset(
    {"INVALID_FILE", "PARSE_FAILED", "LIMIT_EXCEEDED"}
)


class ParseError(Exception):
    """解析失败（不是普通异常）。

    ``code`` 取 :data:`PARSE_ERROR_CODES` 中的值，``message`` 是面向调用方的
    单行说明，**不含堆栈**：T7 直接映射为同名 ``ErrorCode`` 返回给前端。

    * ``INVALID_FILE`` —— 路径不存在、文件为空、不是 pptx（扩展名/魔数不符）；
    * ``PARSE_FAILED`` —— 文件损坏、加密、缺 ``python-pptx``、没有任何幻灯片；
    * ``LIMIT_EXCEEDED`` —— 页数超过 :data:`~app.parsers.pptx_parser.MAX_PAGES`。
    """

    def __init__(self, code: str, message: str) -> None:
        if code not in PARSE_ERROR_CODES:
            raise ValueError(f"未知的 ParseError.code：{code!r}")
        super().__init__(message)
        self.code = code
        self.message = message

    def __str__(self) -> str:  # pragma: no cover - 仅用于日志
        return f"{self.code}: {self.message}"


from .candidates import (  # noqa: E402  (置于 ParseError 定义之后，避免循环导入)
    detect_merge_conflicts,
    map_candidates,
    map_candidates_with_conflicts,
    solve_matrix_from_mappings,
)
from .pptx_parser import (  # noqa: E402
    ASSET_DIR,
    MAX_PAGES,
    build_material_dict,
    parse_pptx,
)

__all__ = [
    "ASSET_DIR",
    "MAX_PAGES",
    "PARSE_ERROR_CODES",
    "PARSER_VERSION",
    "ParseError",
    "build_material_dict",
    "detect_merge_conflicts",
    "map_candidates",
    "map_candidates_with_conflicts",
    "parse_pptx",
    "solve_matrix_from_mappings",
]
