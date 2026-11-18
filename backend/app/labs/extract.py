"""把 PDF / 图片 / PPTX / 文本文件转成可核对的原文页。

识别与求解完全在本机完成；这里不调用任何外部模型。扫描版 PDF 或截图使用本地
RapidOCR，文字版 PDF 优先读取文字层。每个预览都是落盘 PNG，接口只按白名单键
读取，不把用户文件名拼进路径。
"""

from __future__ import annotations

import io
import re
import threading
import time
import zipfile
from importlib.util import find_spec
from multiprocessing import get_context
from pathlib import Path
from typing import Any, Iterable, Sequence

from PIL import Image, ImageOps

from ..settings import LABS_DIR, get_settings
from .expr import normalize_function_notation

ROLES = {"problem", "data", "attempt", "reference", "courseware"}
ROLE_LABELS = {
    "problem": "题目",
    "data": "补充数据",
    "attempt": "我的解答",
    "reference": "参考答案",
    "courseware": "课件",
}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
TEXT_SUFFIXES = {".txt", ".md", ".csv"}
SUPPORTED_SUFFIXES = {".pdf", ".pptx"} | IMAGE_SUFFIXES | TEXT_SUFFIXES

_OCR_LOCK = threading.Lock()
_OCR_ENGINE: Any | None = None
_LATEX_OCR_LOCK = threading.Lock()
_LATEX_OCR_ENGINE: Any | None = None
_LATEX_OCR_RETRY_AT = 0.0

#: Hard wall-clock budget for one local formula read. The autoregressive LaTeX
#: model can spend minutes on a full-width line and still reject its own output;
#: after this deadline the request continues with ordinary OCR + AI reading.
_MATH_OCR_TIMEOUT_S = 15.0
_LATEX_MODEL_FILES = {
    'image_resizer_path': 'image_resizer.onnx',
    'encoder_path': 'encoder.onnx',
    'decoder_path': 'decoder.onnx',
    'tokenizer_json': 'tokenizer.json',
}

#: 本地公式模型约 180MB；只使用已下载到包目录的权重，请求内不触发下载。
_MATH_OCR_CUES = ("∫", "\\int", "\\frac", "dx", "dy", "dt", "\\sqrt")
_LIMIT_CUE = re.compile(r"(?<![A-Za-z])lim(?![A-Za-z])|极限", re.I)


class ExtractError(ValueError):
    """文件无法读取或超出范围。"""


def _suffix(name: str) -> str:
    return Path(name).suffix.lower()


def _file_id(index: int) -> str:
    return f"f{index + 1}"


def _validate_pptx(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = {info.filename.replace("\\", "/") for info in archive.infolist()}
    except zipfile.BadZipFile as exc:
        raise ExtractError("PPTX 文件已损坏") from exc
    if "[Content_Types].xml" not in names:
        raise ExtractError("不是有效的 PPTX 文件")
    if any(name.endswith("vbaProject.bin") for name in names):
        raise ExtractError("检测到宏项目，实验室不执行宏，已拒绝")


def _ocr_engine() -> Any:
    global _OCR_ENGINE
    with _OCR_LOCK:
        if _OCR_ENGINE is None:
            from rapidocr_onnxruntime import RapidOCR  # 延迟加载，避免拖慢无 OCR 请求

            _OCR_ENGINE = RapidOCR()
        return _OCR_ENGINE


def _ocr(image: Image.Image) -> tuple[str, float | None]:
    """返回识别文字与平均置信度；OCR 不可用时返回空文本而不是伪造内容。"""

    try:
        import numpy as np

        engine = _ocr_engine()
        prepared = image.convert("RGB")
        # 截图类小图直接送模型时上下标和斜体 a/α 很容易混淆；先放大再识别。
        if prepared.width < 900 and prepared.height < 260:
            prepared = prepared.resize((prepared.width * 4, prepared.height * 4), Image.LANCZOS)
            prepared = ImageOps.expand(prepared, border=12, fill="white")
        array = np.asarray(prepared)
        result, _elapsed = engine(array)
    except Exception:  # noqa: BLE001 - OCR 缺失不应让整次上传失败
        return "", None
    rows: list[dict] = []
    scores: list[float] = []
    for item in result or []:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        text = str(item[1]).strip()
        if not text:
            continue
        try:
            scores.append(float(item[2]))
        except (TypeError, ValueError):
            pass
        box = item[0]
        ys = [float(point[1]) for point in box]
        rows.append({'text': text, 'x': min(float(point[0]) for point in box),
                     'cy': sum(ys) / len(ys), 'height': max(ys) - min(ys)})
    if not rows:
        return "", None
    lines: list[dict] = []
    for row in sorted(rows, key=lambda row: row['cy']):
        group = next((line for line in lines if abs(line['cy'] - row['cy'])
                      <= max(line['height'], row['height']) * .55), None)
        if group is None:
            lines.append({**row, 'rows': [row]})
        else:
            group['rows'].append(row)
    average = sum(scores) / len(scores) if scores else None
    return '\n'.join(' '.join(row['text'] for row in sorted(line['rows'], key=lambda row: row['x']))
                     for line in lines), average


def _local_latex_paths() -> dict[str, Any]:
    """Use only weights already on disk; never download inside a request."""
    try:
        spec = find_spec('rapid_latex_ocr')
    except (ImportError, ValueError):
        return {'available': False}
    origin = getattr(spec, 'origin', None) if spec else None
    if not origin:
        return {'available': False}
    base = Path(origin).parent
    config = base / 'config.yaml'
    paths = {key: base / 'models' / name for key, name in _LATEX_MODEL_FILES.items()}
    if not config.is_file() or not all(path.is_file() for path in paths.values()):
        return {'available': False}
    return {'available': True, 'config_path': config, **paths}


def _latex_ocr_engine() -> Any | None:
    """懒加载本地公式 OCR；模型不完整时返回 None，不影响普通 OCR。"""

    global _LATEX_OCR_ENGINE, _LATEX_OCR_RETRY_AT
    with _LATEX_OCR_LOCK:
        if _LATEX_OCR_ENGINE is not None:
            return _LATEX_OCR_ENGINE
        if time.monotonic() < _LATEX_OCR_RETRY_AT:
            return None
        paths = _local_latex_paths()
        if not paths.get('available'):
            _LATEX_OCR_RETRY_AT = time.monotonic() + 60
            return None
        try:
            from rapid_latex_ocr import LaTeXOCR  # 延迟加载，避免拖慢无公式的请求

            _LATEX_OCR_ENGINE = LaTeXOCR(
                config_path=paths['config_path'],
                image_resizer_path=paths['image_resizer_path'],
                encoder_path=paths['encoder_path'],
                decoder_path=paths['decoder_path'],
                tokenizer_json=paths['tokenizer_json'],
            )
        except Exception:  # noqa: BLE001 - 缺模型时回退普通 OCR
            _LATEX_OCR_RETRY_AT = time.monotonic() + 60
            return None
        return _LATEX_OCR_ENGINE


def _latex_worker(connection: Any, paths: dict[str, Any], array: Any) -> None:
    """Subprocess body: one bounded formula read, then exit."""
    try:
        from rapid_latex_ocr import LaTeXOCR

        engine = LaTeXOCR(
            config_path=paths['config_path'],
            image_resizer_path=paths['image_resizer_path'],
            encoder_path=paths['encoder_path'],
            decoder_path=paths['decoder_path'],
            tokenizer_json=paths['tokenizer_json'],
        )
        latex, _elapsed = engine(array)
        connection.send(str(latex or ''))
    except Exception:  # noqa: BLE001 - 失败时让父进程走普通 OCR
        try:
            connection.send('')
        except Exception:  # noqa: BLE001
            pass
    finally:
        try:
            connection.close()
        except Exception:  # noqa: BLE001
            pass


def _looks_like_formula(latex: str) -> bool:
    """过滤公式模型对普通文字图片产生的伪 LaTeX。"""

    text = (latex or "").strip()
    if not 4 <= len(text) <= 500:
        return False
    if not any(cue in text for cue in ("\\int", "\\frac", "\\sqrt", "^{", "_{", "=")):
        return False
    if text.count("\\text{") > 2:
        return False
    # Fragment soup from a mostly visual layout (many tildes/overlines) is worse
    # than ordinary OCR; keep the latter instead of polluting the question text.
    if text.count("\\tilde") >= 2 or text.count("\\overline") >= 2 or text.count("\\mathrm") >= 3:
        return False
    if "\\begin{array}" in text and not any(cue in text for cue in ("\\int", "\\frac", "\\sqrt", "=")):
        return False
    if text.count("\\sim") >= 2 or text.count("\\nu") >= 3:
        return False
    cjk = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    return cjk <= 4


def _read_latex_group(text: str, start: int) -> tuple[str, int] | None:
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index], index + 1
    return None


def _latex_display(latex: str) -> str:
    """把公式模型的 LaTeX 转成学生能直接读懂的一行公式。"""

    text = normalize_function_notation(latex.strip())
    text = _ARRAY_WRAPPER.sub("", text)
    text = text.replace('\\ ', ' ')
    text = re.sub(r"\\lim\s*_\s*\{([^{}]*)\}", lambda match: f"lim_{match.group(1)}", text)
    text = text.replace("\\to", "→").replace("\\rightarrow", "→")
    text = text.replace("\\lim", "lim")
    for command in ("\\textstyle", "\\displaystyle", "\\!", "\\,", "\\;", "\\left", "\\right"):
        text = text.replace(command, "")
    text = (
        text.replace("+\\infty", "+∞")
        .replace("-\\infty", "-∞")
        .replace("\\infty", "∞")
    )
    text = text.replace("\\mathrm{d}", "d").replace("\\cdot", "·").replace("\\times", "×")
    text = text.replace("\\pi", "π")
    # 根式
    marker = "\\sqrt"
    while True:
        index = text.find(marker)
        if index < 0:
            break
        cursor = index + len(marker)
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        group = _read_latex_group(text, cursor)
        if group is None:
            break
        content, end = group
        text = f"{text[:index]}√({content}){text[end:]}"
    # 积分上下限：\int_{0}^{1} → ∫_0^1；同时兼容 \int_0^1。
    text = re.sub(
        r"\\int\s*_\s*\{([^{}]+)\}\s*\^\s*\{([^{}]+)\}",
        lambda match: f"∫_{match.group(1).strip()}^{match.group(2).strip()} ",
        text,
    )
    text = re.sub(
        r"\\int\s*_\s*([^\s^{]+)\s*\^\s*([^\s^{]+)",
        lambda match: f"∫_{match.group(1)}^{match.group(2)} ",
        text,
    )
    text = text.replace("\\int", "∫ ")
    # 分式：按平衡括号展开，支持嵌套。
    marker = "\\frac"
    while True:
        index = text.find(marker)
        if index < 0:
            break
        cursor = index + len(marker)
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        numerator = _read_latex_group(text, cursor)
        if numerator is None:
            break
        num, cursor = numerator
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        denominator = _read_latex_group(text, cursor)
        if denominator is None:
            break
        den, end = denominator
        text = f"{text[:index]}({num})/({den}){text[end:]}"
    # 上下标：x^{2} → x^2，a_{n} → a_n
    for prefix in ("^", "_"):
        while True:
            match = re.search(rf"\{prefix}\s*\{{", text)
            if match is None:
                break
            group = _read_latex_group(text, match.end() - 1)
            if group is None:
                break
            content, end = group
            text = f"{text[:match.start()]}{prefix}{content}{text[end:]}"
    text = re.sub(r"\}\s*d\s*([xyzt])", r"} d\1", text)
    text = re.sub(r"(?<=[)\]\d])d\s*([xyzt])\b", r" d\1", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\blim_([^\s(（]+)", r"lim_{\1}", text)
    # Preserve unrecognized commands: deleting them can silently change the
    # function or consume its argument after braces have been flattened.
    return re.sub(r"\s+", " ", text).strip()


def _should_try_math_ocr(text: str) -> bool:
    """Short formula-rich snippets need math OCR even if text OCR looks fluent.

    Long prose pages stay on the ordinary OCR path to avoid invented formulas.
    """

    compact = re.sub(r"\s+", "", text or "")
    limit_cue = bool(_LIMIT_CUE.search(text or ""))
    if len(compact) <= 160 and ('二重积分' in compact or '∬' in compact):
        return True
    if len(compact) >= 24:
        chinese = len(re.findall(r'[\u4e00-\u9fff]', compact))
        return len(compact) <= 160 and chinese <= 12 and (
            limit_cue or any(cue in compact for cue in _MATH_OCR_CUES)
        )
    if len(compact) < 12:
        return True
    return limit_cue or any(cue in compact for cue in _MATH_OCR_CUES)


def _is_ocr_noise(text: str) -> bool:
    """判断通用 OCR 是否只剩数字/``dx`` 等公式碎片，而没有可读文字。"""

    compact = re.sub(r"\s+", "", text or "")
    if any("\u4e00" <= char <= "\u9fff" for char in compact):
        return False
    cleaned = re.sub(
        r"(?:d\s*[xyzt]|dx|dy|dt|sin|cos|tan|log|ln|exp|sqrt|[0-9+\-*/=().,，。∫∞^_²³])",
        "",
        compact,
        flags=re.I,
    )
    cleaned = re.sub(r"[A-Za-z]", "", cleaned)
    return len(cleaned.strip()) < 2


def _formula_sensitive(text: str) -> bool:
    """数学排版不能用整行文字的平均置信度证明识别正确。"""

    return bool(
        re.search(
            r"[∫√²³⁰¹⁴⁵⁶⁷⁸⁹^≤≥∞]|\\(?:int|frac|sqrt)|"
            r"\b(?:d[xyzt]|sqrt|integral|formula)\b|"
            r"[A-Za-z]\s*[=<>]|"
            r"积分|微分|导数|函数|曲线|方程|不等式|平面区域|旋转体",
            text or "",
            re.I,
        )
    )


def _formula_review(text: str, *, visual_formula: bool = False) -> dict[str, Any]:
    """保留 OCR 候选但要求核对，避免把高置信度的错指数直接送入求解。"""

    required = visual_formula or _formula_sensitive(text)
    return {
        "requires_formula_confirmation": required,
        "extraction_issues": [
            {
                "id": "source_formula_confirmation",
                "severity": "blocking",
                "message": "请对照原稿核对完整公式：图片识别可能遗漏或误读分式、根号、上下标及积分上下限。",
            }
        ] if required else [],
    }


def _pdf_has_visible_images(page: Any) -> bool:
    """裁剪页可能还引用原整页的图片，只检查当前页内可见的图片。"""

    try:
        for info in page.get_image_info():
            x0, y0, x1, y1 = info["bbox"]
            rect = page.rect
            if min(x1, rect.x1) > max(x0, rect.x0) and min(y1, rect.y1) > max(y0, rect.y0):
                return True
    except Exception:  # noqa: BLE001 - 缺少图片信息时保持已有扫描页路径
        pass
    return False


def _crop_multiline_formula(image: Image.Image, regions: Sequence[Any]) -> Image.Image:
    """Crop a tall or wide formula block so the local decoder sees only math.

    Full-width question screenshots often contain a scoring label above a
    multi-line fraction. The formula decoder otherwise spends its budget on the
    label and returns fragment soup.
    """
    rows = []
    label_bottom = 0.0
    for item in regions or []:
        try:
            points, text = item[0], str(item[1])
            box = (min(float(p[0]) for p in points), min(float(p[1]) for p in points),
                   max(float(p[0]) for p in points), max(float(p[1]) for p in points))
        except (TypeError, ValueError, IndexError):
            continue
        if not text.strip():
            continue
        if re.search(r'[\u4e00-\u9fff]', text):
            label_bottom = max(label_bottom, box[3])
            continue
        if re.search(r'[0-9A-Za-z∫√^=+*/()\[\]−-]', text):
            rows.append(box)
    if image.width > 1600 and image.height > 200:
        top = label_bottom + image.height * 0.08 if label_bottom else image.height * 0.05
        box = (int(image.width * 0.04), max(0, int(top)),
               int(image.width * 0.70), image.height)
        if box[3] - box[1] >= image.height * 0.2:
            return image.crop(box)
    if len(rows) < 2:
        return image
    left, top = min(box[0] for box in rows), min(box[1] for box in rows)
    right, bottom = max(box[2] for box in rows), max(box[3] for box in rows)
    if bottom - top < image.height * 0.25:
        return image
    pad_x = int((right - left) * 0.25) + 16
    pad_y = int((bottom - top) * 0.45) + 12
    box = (max(0, int(left) - pad_x), max(0, int(top) - pad_y),
           min(image.width, int(right) + pad_x), min(image.height, int(bottom) + pad_y))
    if box[2] - box[0] < image.width * 0.25 or box[3] - box[1] < image.height * 0.2:
        return image
    return image.crop(box)


def _crop_formula_region(image: Image.Image, regions: Sequence[Any]) -> Image.Image:
    """Separate a one-line formula from a Chinese example label, keeping margins.

    General OCR often misses the tall integral immediately before its first
    Latin character. Never crop at that character or remove multiline context.
    """
    if image.width > 1600 or image.height > 420 or image.width / max(image.height, 1) < 2.4:
        return image
    labels, formulas = [], []
    for item in regions or []:
        try:
            points, text = item[0], str(item[1])
            box = (min(float(p[0]) for p in points), min(float(p[1]) for p in points),
                   max(float(p[0]) for p in points), max(float(p[1]) for p in points))
        except (TypeError, ValueError, IndexError):
            continue
        if re.search(r'[\u4e00-\u9fff]', text):
            # A label containing a recognized math symbol might include a bound.
            if not re.search(r'[∫√^=<>≤≥]|[A-Za-z]', text):
                labels.append(box)
        elif re.search(r'[0-9A-Za-z∫√^=+*/()\[\]−-]', text):
            formulas.append(box)
    if not labels or not formulas:
        return image
    left = min(b[0] for b in formulas)
    top, bottom = min(b[1] for b in formulas), max(b[3] for b in formulas)
    line_height = max(b[3]-b[1] for b in formulas)
    if bottom-top > line_height*1.6:
        return image
    prefixes = [b for b in labels if b[2] <= left and min(b[3],bottom)-max(b[1],top) > line_height*0.35]
    if not prefixes:
        return image
    prefix_right = max(b[2] for b in prefixes)
    # Everything after the label is content, including missed integral signs,
    # isolated coefficients, and upper/lower limits beyond the text baselines.
    return image.crop((max(0,int(prefix_right)-3),0,image.width,image.height))


def _math_ocr(image: Image.Image, *, loose: bool = False) -> str | None:
    """把公式截图转成 LaTeX；失败时返回 None。

    小图先放大两倍再送模型，能显著减少上下标、``dx`` 和分数被漏掉的情况。
    ``loose=True`` 供手写圈选使用：放宽“必须含积分/分数/上下标”的启发式，
    但仍拒绝大段中文和过短/过长结果。
    """

    try:
        import numpy as np

        if image.width > 1200 and image.height <= 200:
            # A full-width single line is prose or a multi-part formula. The
            # LaTeX decoder would spend its whole budget on it and reject the
            # result; ordinary OCR + the AI read path handle this shape.
            return None
        paths = _local_latex_paths()
        if not paths.get('available'):
            return None
        prepared = image.convert("RGB")
        try:
            regions, _ = _ocr_engine()(np.asarray(prepared))
            if prepared.width > 1600 or prepared.height > 420:
                prepared = _crop_multiline_formula(prepared, regions)
            elif prepared.width / max(prepared.height, 1) >= 2.4:
                prepared = _crop_formula_region(prepared, regions)
        except Exception:  # Recognition remains available if region detection fails.
            pass
        if prepared.width <= 900 and prepared.height <= 420:
            prepared = prepared.resize(
                (max(1, prepared.width * 3), max(1, prepared.height * 3)), Image.LANCZOS
            )
            prepared = ImageOps.expand(prepared, border=24, fill="white")
        array = np.asarray(prepared)
        with _LATEX_OCR_LOCK:
            context = get_context('spawn')
            receiver, sender = context.Pipe(duplex=False)
            process = context.Process(target=_latex_worker, args=(sender, paths, array), daemon=True)
            process.start()
            sender.close()
            latex = None
            try:
                if receiver.poll(_MATH_OCR_TIMEOUT_S):
                    try:
                        latex = receiver.recv()
                    except EOFError:
                        latex = None
                else:
                    # The autoregressive decoder is still running; abandon it
                    # rather than holding the upload for minutes.
                    process.terminate()
            finally:
                process.join()
                try:
                    process.close()
                except Exception:  # noqa: BLE001
                    pass
                try:
                    receiver.close()
                except Exception:  # noqa: BLE001
                    pass
    except Exception:  # noqa: BLE001 - 公式模型失败时保持普通 OCR 路径
        return None
    text = str(latex or "").strip()
    if loose:
        if not 2 <= len(text) <= 500:
            return None
        cjk = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
        return None if cjk > 4 or text.count("\\text{") > 2 else text
    return text if _looks_like_formula(text) else None


_ARRAY_WRAPPER = re.compile(r"\\(?:begin|end)\{array\}(?:\{[^{}]*\})?")
_LIMIT_OPERATOR = re.compile(r"\\(?:lim|int|prod|sum)\s*_\s*\{[^{}]*(?:\\to|\\rightarrow|→|->)[^{}]*\}")
_ARROW_SUBSCRIPT = re.compile(r"(_\s*\{\s*[A-Za-z]\s*\\?(?:to|rightarrow)\s*[^{}]*\})")


def _repair_math_formula(latex: str, ocr_text: str) -> str:
    """公式模型常把竖排 lim 读成积分号，并把版面碎片带进结果。

    只在普通 OCR 明确出现 lim/极限时改写带箭头下标的积分号，避免误伤真正的
    积分题；随后截取“算子 + 左式 = 数值”这一段，丢掉题号和答题横线等碎片。
    """

    text = _ARRAY_WRAPPER.sub("", latex or "")
    if re.search(r"(?:\\?lim|极限)", ocr_text or "", flags=re.I):
        text = re.sub(
            r"\\(?:int|prod|sum)(?=" + _ARROW_SUBSCRIPT.pattern + ")",
            r"\\lim",
            text,
            count=1,
        )
    operator = _LIMIT_OPERATOR.search(text)
    if operator:
        core = text[operator.start():]
        equation = re.search(r"=\s*[-+]?(?:\d+(?:\.\d+)?|\.\d+)", core)
        if equation:
            core = core[: equation.end()]
        text = core
    return text.strip()


def _merge_math_text(ocr_text: str, display_text: str) -> str:
    """把公式 OCR 结果放到一行可读公式里，同时保留普通 OCR 的中文题干。

    小截图里题号常被单独识别成一行，直接保留会让拆题器把一道题拆成两段；
    只有一个题号时才重排，多题截图仍按原文本拆分。纯公式碎片已在可读公式里
    完整出现，不再拼进“原题”文本。
    """

    lines = [line.strip() for line in (ocr_text or "").splitlines() if line.strip()]
    markers = []
    stripped: list[str] = []
    for line in lines:
        match = re.match(r"^(?:第\s*)?([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[.、．:：)）]\s*", line)
        if match:
            markers.append(match.group(1))
            line = line[match.end():].strip()
        if not line:
            continue
        if re.search(r"[\u4e00-\u9fff]", line):
            stripped.append(line)
            continue
        if line[0] in "(（[{<≥≤=+-/*^" or line[0].isdigit():
            continue
        if len(re.findall(r"[A-Za-z]{2,}", line)) >= 2 and len(line) >= 10:
            stripped.append(line)
    if len(set(markers)) > 1:
        return f"{ocr_text.strip()}\n{display_text}".strip()
    head = f"{markers[0]}. {display_text}" if markers else display_text
    return "\n".join([head, *stripped])


def _save_preview(image: Image.Image, lab_dir: Path, key: str, max_width: int = 1400, *, fast: bool = False) -> str:
    image = image.convert("RGB")
    analysis = lab_dir / "analysis" / f"{key}.png"
    analysis.parent.mkdir(parents=True, exist_ok=True)
    image.save(analysis, format="PNG", compress_level=3)
    if image.width > max_width:
        ratio = max_width / image.width
        image = image.resize((max_width, max(1, int(image.height * ratio))), Image.LANCZOS)
    target = lab_dir / "previews" / f"{key}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG", optimize=not fast, compress_level=3 if fast else 6)
    return key


def _pdf_pages(data: bytes, file_id: str, lab_dir: Path, remaining: int, *, preserve_layout: bool = False) -> tuple[list[dict[str, Any]], str]:
    try:
        try:
            import pymupdf
        except ImportError:  # pragma: no cover - 旧环境兼容
            import fitz as pymupdf  # type: ignore[no-redef]
    except ImportError as exc:  # pragma: no cover
        raise ExtractError("服务器缺少 PDF 解析组件，请安装 PyMuPDF") from exc

    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise ExtractError("PDF 无法打开，文件可能已损坏或加密") from exc
    if getattr(document, "needs_pass", False):
        raise ExtractError("PDF 已加密，无法读取")

    pages: list[dict[str, Any]] = []
    methods: set[str] = set()
    try:
        if preserve_layout and len(document) > remaining:
            raise ExtractError(f"PDF 共 {len(document)} 页，超过活页剩余 {remaining} 页额度，请拆分文件后上传")
        count = min(len(document), remaining)
        for index in range(count):
            page = document[index]
            text = page.get_text("text").strip()
            native_text = text
            method = "pdf_text"
            image_key = f"{file_id}_p{index + 1}"
            ocr_text: str | None = None
            math_text: str | None = None
            confidence: float | None = None
            # 公式可能作为图片夹在正常的文字层里，字数不能证明页面已完整读取。
            mixed_content = _pdf_has_visible_images(page)
            mixed_math = mixed_content and _formula_sensitive(native_text)
            needs_ocr = len(text) < 24 or mixed_content or "\ufffd" in text
            if preserve_layout:
                # 讲义中的插图和稀疏标题不应触发整页 OCR 覆盖原生文字层。
                needs_ocr = not text
            try:
                scale = max(1.0, 1200 / max(1.0, float(page.rect.width)))
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                preview = _save_preview(image, lab_dir, image_key, fast=True) if preserve_layout else _save_preview(image, lab_dir, image_key)
            except Exception:  # noqa: BLE001 - 预览失败不影响文字
                image = None
                preview = None
            if needs_ocr:
                if image is not None:
                    ocr_text, confidence = _ocr(image)
                    if ocr_text.strip() and not (
                        len(native_text) >= 24 and mixed_content and not mixed_math
                        and not _formula_sensitive(ocr_text)
                    ):
                        text = ocr_text.strip()
                        method = "pdf_ocr"
                        if confidence is not None and confidence < 0.72:
                            method = "pdf_ocr_low_confidence"
                    if _should_try_math_ocr(text) and image is not None:
                        math_text = _math_ocr(image)
                        if math_text is not None:
                            display_text = _latex_display(_repair_math_formula(math_text, text))
                            noise = _is_ocr_noise(text)
                            text = display_text if noise else f"{text}\n{display_text}".strip()
                            method = "pdf_math_ocr" if noise else "pdf_ocr+math_ocr"
            review = (
                _formula_review(
                    f"{native_text}\n{text}\n{math_text or ''}",
                    visual_formula=mixed_math or math_text is not None,
                )
                if needs_ocr
                else {"requires_formula_confirmation": False, "extraction_issues": []}
            )
            methods.add(method)
            pages.append(
                {
                    "page": index + 1,
                    "text": text,
                    "method": method,
                    "image_key": preview,
                    "image_width": image.width if image is not None else None,
                    "image_height": image.height if image is not None else None,
                    "ocr_text": ocr_text,
                    "math_text": math_text,
                    "native_text": native_text,
                    "preserve_layout": preserve_layout,
                    "ocr_confidence": confidence,
                    **review,
                }
            )
    finally:
        document.close()
    if not pages:
        raise ExtractError("PDF 没有可读取的页面")
    return pages, "+".join(sorted(methods))


def _image_pages(data: bytes, file_id: str, lab_dir: Path) -> tuple[list[dict[str, Any]], str]:
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        image = ImageOps.exif_transpose(image)
    except Exception as exc:  # noqa: BLE001
        raise ExtractError("图片无法读取，请换一张 PNG/JPG/WebP") from exc
    preview = _save_preview(image, lab_dir, f"{file_id}_p1")
    ocr_text, confidence = _ocr(image)
    math_text = _math_ocr(image) if _should_try_math_ocr(ocr_text) else None
    if math_text is not None:
        # 通用 OCR 只剩公式碎片时直接用可读公式；否则保留其文字并追加公式。
        display_text = _latex_display(_repair_math_formula(math_text, ocr_text))
        if _is_ocr_noise(ocr_text):
            text = display_text
            method = "image_math_ocr"
        else:
            text = _merge_math_text(ocr_text, display_text)
            method = "image_ocr+math_ocr"
    else:
        text = ocr_text
        method = "image_ocr"
        if confidence is not None and confidence < 0.72:
            method = "image_ocr_low_confidence"
    return (
        [
            {
                "page": 1,
                "text": text,
                "method": method,
                "image_key": preview,
                "ocr_text": ocr_text,
                "math_text": math_text,
                "ocr_confidence": confidence,
                **_formula_review(text, visual_formula=math_text is not None),
            }
        ],
        method,
    )


def _pptx_pages(data: bytes, remaining: int) -> tuple[list[dict[str, Any]], str]:
    from pptx import Presentation

    _validate_pptx(data)
    try:
        presentation = Presentation(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise ExtractError("PPTX 无法打开") from exc
    pages: list[dict[str, Any]] = []
    for index, slide in enumerate(presentation.slides):
        if index >= remaining:
            break
        parts: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                text = "\n".join(
                    paragraph.text for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()
                ).strip()
                if text:
                    parts.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
        pages.append(
            {
                "page": index + 1,
                "text": "\n".join(parts).strip(),
                "method": "pptx_text",
                "image_key": None,
            }
        )
    if not pages:
        raise ExtractError("PPTX 没有可读取的幻灯片")
    return pages, "pptx_text"


def _text_pages(data: bytes, file_id: str, lab_dir: Path, suffix: str) -> tuple[list[dict[str, Any]], str]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("gb18030")
        except UnicodeDecodeError as exc:
            raise ExtractError("文本文件编码无法识别，请使用 UTF-8") from exc
    # 纯文本也生成一张可阅读的纸面预览，保证“原稿对照”始终有视觉来源。
    if suffix in TEXT_SUFFIXES:
        preview = _text_preview(text, lab_dir, f"{file_id}_p1")
    else:
        preview = None
    return (
        [{"page": 1, "text": text.strip(), "method": "plain_text", "image_key": preview}],
        "plain_text",
    )


def _text_preview(text: str, lab_dir: Path, key: str) -> str:
    from PIL import ImageDraw, ImageFont

    sampled = text[:2400] if text else "（空文件）"
    lines: list[str] = []
    for raw in sampled.splitlines() or [sampled]:
        while len(raw) > 46:
            lines.append(raw[:46])
            raw = raw[46:]
        lines.append(raw)
    height = max(420, 60 + len(lines[:36]) * 26)
    image = Image.new("RGB", (860, height), "#fbf9f4")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("msyh.ttc", 17)
    except Exception:  # noqa: BLE001 - 无中文字体时用默认字体
        font = ImageFont.load_default()
    for index, line in enumerate(lines[:36]):
        draw.text((44, 40 + index * 26), line, fill="#2f3a49", font=font)
    return _save_preview(image, lab_dir, key)


def extract_files(
    uploads: Sequence[tuple[str, str, str, bytes]],
    *,
    lab_id: str,
    root: Path | None = None,
    max_pages: int | None = None,
    preserve_layout: bool = False,
) -> dict[str, Any]:
    """保存原件、生成页预览并返回 ``source`` 结构。

    ``uploads`` 的元组为 ``(file_id, filename, role, bytes)``；页数总量受
    ``LAB_MAX_PAGES`` 限制。任何单文件错误都会中止整次识别并回滚目录。
    ``root`` 缺省为 ``LABS_DIR``，活页等其他管线传入自己的根目录复用本函数。
    """

    settings = get_settings()
    if not uploads:
        raise ExtractError("没有可读取的文件")
    if len(uploads) > settings.lab_max_files:
        raise ExtractError(f"最多同时上传 {settings.lab_max_files} 个文件")
    if any(role not in ROLES for _, _, role, _ in uploads):
        raise ExtractError("文件用途不在允许范围内")

    lab_dir = (root if root is not None else LABS_DIR) / lab_id
    files_dir = lab_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, Any]] = []
    all_pages: list[dict[str, Any]] = []
    remaining = max_pages if max_pages is not None else settings.lab_max_pages
    methods: set[str] = set()

    for file_id, filename, role, data in uploads:
        if remaining <= 0:
            if preserve_layout:
                raise ExtractError("材料总页数超过活页上限，请拆分后上传")
            break
        suffix = _suffix(filename)
        if suffix not in SUPPORTED_SUFFIXES:
            raise ExtractError(f"暂不支持 {suffix or '无扩展名'} 文件；可用 PDF、PNG/JPG/WebP、PPTX、TXT/MD/CSV")
        safe_name = Path(filename).name[:180]
        stored_name = f"{file_id}{suffix}"
        (files_dir / stored_name).write_bytes(data)

        if suffix == ".pdf":
            if not data.startswith(b"%PDF"):
                raise ExtractError(f"{safe_name} 不是有效的 PDF")
            if preserve_layout:
                pages, method = _pdf_pages(data, file_id, lab_dir, remaining, preserve_layout=True)
            else:
                pages, method = _pdf_pages(data, file_id, lab_dir, remaining)
            kind = "pdf"
        elif suffix in IMAGE_SUFFIXES:
            pages, method = _image_pages(data, file_id, lab_dir)
            kind = "image"
        elif suffix == ".pptx":
            pages, method = _pptx_pages(data, remaining)
            kind = "pptx"
        else:
            pages, method = _text_pages(data, file_id, lab_dir, suffix)
            kind = "text"

        remaining -= len(pages)
        methods.add(method)
        for page in pages:
            page["file_id"] = file_id
            all_pages.append(page)
        files.append(
            {
                "file_id": file_id,
                "name": safe_name,
                "role": role,
                "role_label": ROLE_LABELS[role],
                "kind": kind,
                "stored_name": stored_name,
                "pages": len(pages),
                "chars": sum(len(page["text"]) for page in pages),
                "methods": sorted({page["method"] for page in pages}),
            }
        )

    if not all_pages:
        raise ExtractError("没有读到任何页面")
    problem_pages = [page for page in all_pages if _role_of(page["file_id"], files) in ("problem", "courseware", "data")]
    if not problem_pages:
        raise ExtractError("请至少把一份文件标为“题目”或“课件”")
    return {
        "files": files,
        "pages": all_pages,
        "method": "+".join(sorted(methods)),
    }


def _role_of(file_id: str, files: Iterable[dict[str, Any]]) -> str:
    for item in files:
        if item["file_id"] == file_id:
            return str(item["role"])
    return ""


def text_source(text: str, *, lab_id: str) -> dict[str, Any]:
    """纯文本题目的来源结构；不写任何文件。"""

    _ = lab_id
    return {
        "files": [
            {
                "file_id": "f1",
                "name": "粘贴的题目文本",
                "role": "problem",
                "role_label": "题目",
                "kind": "text",
                "stored_name": None,
                "pages": 1,
                "chars": len(text),
                "methods": ["typed_text"],
            }
        ],
        "pages": [
            {
                "file_id": "f1",
                "page": 1,
                "text": text,
                "method": "typed_text",
                "image_key": None,
                "ocr_text": None,
                "math_text": None,
            }
        ],
        "method": "typed_text",
    }


def sanitize_excerpt(text: str, limit: int = 220) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    return compact[:limit]


__all__ = [
    "ExtractError",
    "ROLE_LABELS",
    "ROLES",
    "SUPPORTED_SUFFIXES",
    "extract_files",
    "sanitize_excerpt",
    "text_source",
]
