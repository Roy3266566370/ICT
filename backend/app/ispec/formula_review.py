"""Validate image OCR evidence before building teaching interactions."""
import json
import re

REVIEW_MESSAGE = '疑似微积分算子识别异常，请对照原图核对'
_LIMIT = r'\s*(?:\{[^{}]+\}|[+-]?\w)'
_BOUNDS = re.compile(rf'_{_LIMIT}\s*\^{_LIMIT}|\^{_LIMIT}\s*_{_LIMIT}')
_DIFFERENTIAL = re.compile(r'(?:\\(?:mathrm|mathbf|mathit)\s*\{d\}|d)\s*(?:\\,\s*)?[A-Za-z]\s*[.,。]?\s*$')
_INTEGRAL = re.compile(r'\\(?:int|iint|iiint|oint)(?![A-Za-z])|[∫∬∭∮]')


def parse_formula(latex: str):
    if not latex.strip() or len(latex) > 800:
        return None
    try:
        from latex2sympy2_extended import latex2sympy
        from sympy import Basic
        clean = latex.strip().strip('$').rstrip('.,。').strip()
        clean = re.sub(r'\\(?:mathbf|mathrm|mathit)\s*\{([A-Za-z])\}', r'\1', clean)
        clean = re.sub(r'\\[,;:!]', '', clean)
        parsed = latex2sympy(clean)
        return parsed if isinstance(parsed, Basic) else None
    except Exception:
        # ANTLR has its own exceptions for invalid tokens.
        return None


def review_reason(latex: str, score: float) -> str | None:
    if _BOUNDS.search(latex) and _DIFFERENTIAL.search(latex) and not _INTEGRAL.search(latex):
        return REVIEW_MESSAGE
    if score < .90:
        return '公式识别置信度不足，请对照原图核对'
    from .image_text import _latex_matrix
    if _latex_matrix(latex) is None and parse_formula(latex) is None:
        return '公式无法解析，请对照原图核对'
    return None


def review_formula(image_png: bytes, latex: str, score: float, *, reason: str | None = None):
    reason = reason or review_reason(latex, score)
    if reason is None:
        return latex, 'recognized', None
    prompt = ('请仅返回 {"latex":"修正后的 LaTeX"}；若原图含矩阵请转录为完整标准 \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}（不要嵌套 matrix 或留空占位列），无法辨认时返回 {"latex":null}。'
              '\nOCR待核对初稿为 ' + latex[:800])
    corrected = _valid_correction(_request_review(image_png, prompt).get('latex'), reason)
    if corrected is not None:
        return corrected, 'vision_confirmed', None
    return latex, 'needs_review', reason


def _valid_correction(corrected, reason: str) -> str | None:
    if not isinstance(corrected, str) or not 0 < len(corrected.strip()) <= 800:
        return None
    corrected = corrected.strip().strip('$').strip()
    if reason == REVIEW_MESSAGE and not _INTEGRAL.search(corrected):
        return None
    return corrected if review_reason(corrected, 1) is None else None


def review_image_rows(image_png: bytes, rows: list[dict], suspects: list[tuple[int, str]]):
    if len(suspects) == 1:
        index, reason = suspects[0]
        rows[index]['text'], status, reason = review_formula(
            image_png, rows[index]['text'], rows[index]['score'], reason=reason)
        return status, reason
    drafts = [{'index': index, 'latex': rows[index]['text'][:800]} for index, _ in suspects]
    prompt = ('按初稿下标逐条对应原图。只返回 JSON {"corrections":{"0":"LaTeX"}}，'
              '以实际下标为键，无法确认则省略该键。\n初稿：' + json.dumps(drafts, ensure_ascii=False))
    corrections = _request_review(image_png, prompt).get('corrections')
    remaining = None
    for index, reason in suspects:
        latex = _valid_correction(corrections.get(str(index)), reason) if isinstance(corrections, dict) else None
        if latex is None:
            remaining = remaining or reason
        else:
            rows[index]['text'] = latex
    return ('needs_review', remaining) if remaining else ('vision_confirmed', None)


def _request_review(image_png: bytes, prompt: str) -> dict:
    from ..living.vision import LivingVisionClient
    from ..ppt_ai.client import PPTAIError

    client = LivingVisionClient()
    if not client.available:
        return {}
    instructions = '逐字符转录原图中的数学公式，只转录可见内容，不解题。\n'
    try:
        return client.generate_json(image_png=image_png, prompt=instructions+prompt, max_output_tokens=1024,
                                    timeout_s=min(45, client.profile.timeout_s),
                                    retry_without_response_format=False)
    except PPTAIError as error:
        import logging
        logging.getLogger(__name__).info('Formula vision review unavailable (%s)', error.code)
        return {}
