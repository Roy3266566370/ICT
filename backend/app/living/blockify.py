"""blockify：把抽取结果转成"保真层"块序列（纯函数，无 IO 无副作用）。

输入是 :func:`app.labs.extract.extract_files` 的返回结构（``files`` + ``pages`` +
``method``）；输出 ``(blocks, notes)``。

规则：

1. 每个文件先落一个 ``section`` 块（文件名当标题）；
2. 每页先落一个 floor ``page`` 块（原页图）——这是转换的地板；
3. 页里有文字时按段切成 ``text`` 块，整段都是展示公式的直接落成 ``formula``；
   有文字的页，原页图块标记 ``collapsed``（原文对照，默认收起）；
4. 识别不了的就老老实实留在页图/文本块里，不编内容。
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .model import new_block_id

#: 一个页面最多切成的文本块数；超出后合并成尾块，防止长 PDF 炸出几百块。
MAX_BLOCKS_PER_PAGE = 40
#: 整段都是展示公式（$$…$$、\[…\]）时直接落成 formula 块。
_DISPLAY_FORMULA = re.compile(
    r"^\s*(?:\$\$.+\$\$|\\\[.+\\\]|\\begin\{(?:equation|align|gather)\*?\}.+\\end\{(?:equation|align|gather)\*?\})\s*$",
    re.S,
)
_LATEX_INLINE = re.compile(r"(\\frac|\\int|\\sum|\\sqrt|\\lim|\\partial|\\nabla|\\alpha|\\beta|\\lambda|\\pi)")


def _segments(text: str) -> list[str]:
    """把页文本切段：先按空行，退化为单行页时按行分组。"""
    raw = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if len(raw) <= 1:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if len(lines) <= 1:
            return [text.strip()] if text.strip() else []
        # 没有空行时按行聚合：短行并段，疑似题目/公式的行独立成段，方便建议命中。
        grouped: list[str] = []
        buf: list[str] = []
        for line in lines:
            standalone = bool(_LATEX_INLINE.search(line)) or bool(
                re.match(
                    r"^(?:\d+[.、)]|第\s*\d+\s*[题章例]|[（(]\d+[)）]|例\s*\d*|求|解|计算|证明|已知|设|若)",
                    line,
                )
            )
            if standalone:
                if buf:
                    grouped.append("\n".join(buf))
                    buf = []
                grouped.append(line)
            else:
                buf.append(line)
                if len("\n".join(buf)) >= 400:
                    grouped.append("\n".join(buf))
                    buf = []
        if buf:
            grouped.append("\n".join(buf))
        return grouped
    # 空行分段后仍可能过长：超长的段再按行硬切。
    out: list[str] = []
    for part in raw:
        while len(part) > 1200:
            out.append(part[:1200])
            part = part[1200:].lstrip("\n")
        if part.strip():
            out.append(part)
    return out


def _function_from_latex(latex: str) -> tuple[str | None, list[str]]:
    """LaTeX → 画布可求值表达式 + 用到的参数字母；失败返回 (None, [])。

    复用题目实验室的受限解析器；只接受自由变量 ⊆ {x,a,b,c} 的一元函数，
    解析不了就不标 expression，前端只落 formula 块。
    """
    try:
        from ..labs.ink import latex_to_expression

        expression = latex_to_expression(latex)
    except Exception:  # noqa: BLE001 - 解析失败不阻断
        return None, []
    if not expression:
        return None, []
    try:
        from ..labs.expr import parse_expression

        symbols = {
            str(symbol)
            for symbol in parse_expression(
                expression, variables=("x", "a", "b", "c"),
            ).free_symbols
        }
    except Exception:  # noqa: BLE001 - 参数缺失不阻断
        symbols = set()
    return expression, [name for name in ("a", "b", "c") if name in symbols]


def _source(file_id: str | None, page: int | None, span: int | None = None,
            region: str | None = None) -> dict[str, Any] | None:
    ref: dict[str, Any] = {}
    if file_id:
        ref["file_id"] = file_id
    if isinstance(page, int):
        ref["page"] = page
    if isinstance(span, int):
        ref["span"] = [span, span]
    if isinstance(region, str) and region.strip():
        ref["region"] = region.strip()[:40]
    return ref or None


def blockify(source: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """``source`` → ``(blocks, notes)``。"""

    files = {str(f.get("file_id")): f for f in source.get("files") or []}
    pages = source.get("pages") or []
    blocks: list[dict[str, Any]] = []
    notes: list[str] = []
    seen_files: set[str] = set()
    region_total = 0

    if not pages:
        notes.append("没有读取到页面内容")
        return blocks, notes

    for page in pages:
        file_id = str(page.get("file_id") or "")
        file_info = files.get(file_id) or {}
        file_name = str(file_info.get("name") or file_id or "材料")
        if file_id not in seen_files:
            seen_files.add(file_id)
            blocks.append({
                "id": new_block_id(),
                "type": "section",
                "source": _source(file_id, None),
                "data": {"heading": file_name, "level": 1},
            })

        page_no = page.get("page")
        text = str(page.get("text") or "").strip()
        image_key = page.get("image_key")
        segments = _segments(text)
        preserve_layout = bool(page.get("preserve_layout") and image_key)
        if preserve_layout:
            # 原页负责公式与图示保真，文字层仅作检索和激活，避免拆散图中标签。
            segments = [text] if text else []
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            heading = next((line for line in lines
                            if not line.isdigit() and not line.startswith("《")
                            and not line.startswith("http") and len(line) <= 100), "原稿")
            blocks.append({"id": new_block_id(), "type": "section", "source": _source(file_id, page_no),
                           "data": {"heading": f"第 {page_no} 页 · {heading}", "level": 2}})
        if len(segments) > MAX_BLOCKS_PER_PAGE:
            segments = segments[: MAX_BLOCKS_PER_PAGE - 1] + ["\n\n".join(segments[MAX_BLOCKS_PER_PAGE - 1:])]
            notes.append(f"{file_name} 第 {page_no} 页内容过长，已合并尾部段落")

        src = _source(file_id, page_no if isinstance(page_no, int) else None)
        page_regions = [
            dict(region) for region in page.get("regions") or []
            if isinstance(region, dict) and region.get("bbox")
        ]
        region_total += len(page_regions)
        if isinstance(image_key, str) and image_key:
            page_data: dict[str, Any] = {
                "image_key": image_key,
                "alt": f"{file_name} 第 {page_no} 页" + ("（隐藏页）" if page.get("hidden") else ""),
                "collapsed": bool(segments) and not preserve_layout,
                "width": page.get("image_width"),
                "height": page.get("image_height"),
            }
            if page_regions:
                page_data["regions"] = page_regions
            blocks.append({
                "id": new_block_id(),
                "type": "page",
                "floor": True,
                "source": src,
                "data": page_data,
            })

        if preserve_layout:
            for region in page_regions:
                if region.get("kind") != "formula":
                    continue
                latex = str(region.get("latex") or "").strip()
                if not latex:
                    continue
                expression, params = _function_from_latex(latex)
                if expression:
                    region["expression"] = expression
                    if params:
                        region["params"] = params
                block = {
                    "id": new_block_id(),
                    "type": "formula",
                    "source": _source(
                        file_id, page_no if isinstance(page_no, int) else None,
                        region=str(region.get("id") or ""),
                    ),
                    "data": {"latex": latex},
                }
                blocks.append(block)
                region["block_id"] = block["id"]

        for index, seg in enumerate(segments):
            kind = "formula" if _DISPLAY_FORMULA.match(seg) else "text"
            key = "latex" if kind == "formula" else "md"
            blocks.append({
                "id": new_block_id(),
                "type": kind,
                "source": _source(file_id, page_no if isinstance(page_no, int) else None, index),
                "data": {key: seg, **({"collapsed": True} if preserve_layout and kind == "text" else {})},
            })

        if not segments and not image_key:
            blocks.append({
                "id": new_block_id(),
                "type": "text",
                "source": src,
                "data": {"md": f"（{file_name} 第 {page_no} 页没有读取到文字）"},
            })

    if region_total:
        notes.append(f"识别到 {region_total} 个可交互区域（图示/公式热区）")
    hidden_pages = [p.get("page") for p in pages if p.get("hidden")]
    if hidden_pages:
        notes.append(f"{len(hidden_pages)} 页为隐藏幻灯片，仍按原样保留")
    ocr_pages = [p for p in pages if "ocr" in str(p.get("method") or "")]
    if ocr_pages:
        notes.append(f"{len(ocr_pages)} 页通过 OCR 识别，公式与符号可能存在误差")
    if any("\ufffd" in str(p.get("text") or "") for p in pages):
        notes.append("部分文字层含无法解码的字符，请以原页图示与公式为准")
    return blocks, notes


__all__ = ["blockify"]
