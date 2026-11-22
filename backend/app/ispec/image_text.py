"""Local image text recognition with evidence boxes and a content-addressed cache."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import threading
import os
from uuid import uuid4
from functools import lru_cache

import numpy as np
from PIL import Image, ImageOps

from ..settings import DATA_DIR

_LOCK = threading.Lock()
logger = logging.getLogger(__name__)
_PADDING = 20
_CACHE_VERSION = 2


@lru_cache(maxsize=1)
def engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)


@lru_cache(maxsize=1)
def pix2text_engine():
    from pix2text import Pix2Text
    return Pix2Text.from_config(device='cpu')


def _recognize_rows(rgb: Image.Image) -> tuple[list[dict], str]:
    try:
        scale = 2 if rgb.height < 64 else 1
        gray = ImageOps.grayscale(rgb)
        corners = ((0, 0), (rgb.width-1, 0), (0, rgb.height-1), (rgb.width-1, rgb.height-1))
        if sum(gray.getpixel(point) for point in corners) < 512:
            gray = ImageOps.invert(gray)
        gray = ImageOps.autocontrast(gray)
        if scale == 2:
            gray = gray.resize((rgb.width*2, rgb.height*2), Image.Resampling.BICUBIC)
        prepared = ImageOps.expand(gray, border=_PADDING, fill=255).convert('RGB')
        results = pix2text_engine().recognize(prepared, return_text=False)
        rows = []
        for item in results or []:
            score = float(item.get('score', 0))
            box = np.asarray(item['position'], dtype=float)
            kind = 'formula' if item.get('type') in ('formula', 'isolated', 'embedding') else 'text'
            if not np.isfinite(score) or not 0 <= score <= 1 or box.shape != (4, 2) or not np.isfinite(box).all():
                continue
            if kind == 'text' and score < .6:
                continue
            box = np.clip((box - _PADDING) / scale, 0, rgb.size)
            rows.append({'box': box.tolist(), 'text': str(item['text']), 'score': score, 'type': kind})
        return rows, 'pix2text'
    except ImportError:
        pass  # Optional dependency: existing installations keep using RapidOCR.
    except Exception as error:
        # Model downloads/inference must not prevent the existing OCR path.
        logger.warning('Pix2Text unavailable, using RapidOCR (%s)', type(error).__name__)
    results, _ = engine()(np.array(rgb))
    return [{'box': np.asarray(box).tolist(), 'text': text, 'score': float(score)}
            for box, text, score in (results or []) if score >= .6], 'rapidocr'


def _latex_matrix(text: str) -> list[list[float]] | None:
    cleaned = re.sub(r'\\begin\{(bmatrix|pmatrix|Bmatrix|matrix|smallmatrix|array)\}\s*\{\s*\\begin\{\1\}', r'\\begin{\1}', text)
    matches = list(re.finditer(
        r'\\begin\{(bmatrix|pmatrix|Bmatrix|matrix|smallmatrix|array)\}(.*?)\\end\{\1\}', cleaned, re.S))
    if len(matches) != 1:
        return None
    raw_rows: list[list[str]] = []
    body = matches[0][2].strip()
    if matches[0][1] == 'array':
        body = re.sub(r'^\{[clr|\s]+\}', '', body).strip()
    for line in re.split(r'\\\\', body):
        if not line.strip():
            continue
        cells = [cell.strip().replace('−', '-') for cell in line.split('&')]
        cells = [re.sub(r'^\{\s*\\(?:overline|underline)\s*\{\s*\{\s*\}\s*\}\s*\}$', '', cell).strip() for cell in cells]
        cells = [re.sub(r'^\{\s*([^{}]*)\s*\}$', r'\1', cell).strip() for cell in cells]
        if not any(cells):
            continue  # Pix2Text may emit entirely empty rows for vertical spacing.
        raw_rows.append(cells)
    if not raw_rows:
        return None
    if len({len(r) for r in raw_rows}) == 1 and len(raw_rows[0]) > 1:
        keep_cols = [col for col in range(len(raw_rows[0])) if any(row[col] != '' for row in raw_rows)]
        if keep_cols and len(keep_cols) < len(raw_rows[0]):
            raw_rows = [[row[col] for col in keep_cols] for row in raw_rows]
    matrix = []
    for cells in raw_rows:
        if any(not re.fullmatch(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?', cell) for cell in cells):
            return None
        values = [float(cell) for cell in cells]
        if not all(np.isfinite(value) for value in values) or (matrix and len(values) != len(matrix[0])):
            return None
        matrix.append(values)
    return matrix or None


def recognize_image(blob: bytes) -> dict:
    digest = hashlib.sha256(blob).hexdigest()
    target = DATA_DIR/'ocr'/f'p2t_{digest}.json'
    # Serialize the cache miss, inference and atomic write so concurrent callers
    # recognize identical content only once.
    with _LOCK:
        return _recognize_image(blob, target)


def _recognize_image(blob: bytes, target) -> dict:
    if target.exists():
        try:
            cached = json.loads(target.read_text(encoding='utf-8'))
            if isinstance(cached, dict) and cached.get('version') == _CACHE_VERSION and cached.get('backend') != 'rapidocr':
                return cached
            # Installing Pix2Text must upgrade earlier fallback results, rather
            # than keeping those images permanently on RapidOCR.
            try:
                from pix2text import Pix2Text
            except Exception:
                if isinstance(cached, dict) and cached.get('version') == _CACHE_VERSION:
                    return cached
        except (ValueError, OSError):
            pass
    try:
        image = Image.open(io.BytesIO(blob)).convert('RGBA')
        if image.width*image.height > 20_000_000:
            return {'text': '', 'rows': [], 'reason': '图片尺寸过大，待人工确认'}
        rgb = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image).convert('RGB')
        rgb.thumbnail((1600,1600))
        rows, backend = _recognize_rows(rgb)
        from .formula_review import review_image_rows, review_reason
        formula_rows = [row for row in rows if row.get('type') == 'formula']
        status, reason = 'recognized', None
        suspects = [(i, issue) for i, row in enumerate(formula_rows)
                    if (issue := review_reason(row['text'], row['score'])) is not None]
        if suspects:
            original = io.BytesIO()
            image.save(original, format='PNG')
            status, reason = review_image_rows(original.getvalue(), formula_rows, suspects)
        # Join boxes sharing a text baseline (subscripts can be separate detections).
        lines = []
        for row in sorted(rows, key=lambda row: sum(point[1] for point in row['box'])/4):
            ys = [point[1] for point in row['box']]
            cy, height = sum(ys)/4, max(ys)-min(ys)
            group = next((line for line in lines if abs(line['cy']-cy) <= max(height, line['height'])*.55), None)
            if group is None:
                lines.append({'cy': cy, 'height': height, 'rows': [row]})
            else:
                group['rows'].append(row)
        text = '\n'.join(' '.join(r['text'] for r in sorted(line['rows'], key=lambda r: r['box'][0][0])) for line in lines)
        math_text = '\n'.join(row['text'] for row in rows if row.get('type') == 'formula')[:8000]
        matrix = _latex_matrix(math_text) if status != 'needs_review' else None
        numbers = [row for row in rows if row['score'] >= .85 and re.fullmatch(r'[-−+]?\d+(?:\.\d+)?', row['text'].strip())]
        # Four isolated numeric tokens in two rows/columns, within a small formula
        # image, are a candidate matrix, never an unlabelled chart extraction.
        if not math_text and len(rows) == len(numbers) == 4 and image.width/image.height < 2.5:
            ordered = sorted(numbers, key=lambda row: sum(p[1] for p in row['box'])/4)
            top = sorted(ordered[:2], key=lambda row: row['box'][0][0])
            bottom = sorted(ordered[2:], key=lambda row: row['box'][0][0])
            centers = [sum(p[1] for p in row['box'])/4 for row in top+bottom]
            if max(centers[:2])-min(centers[:2]) < image.height*.15 and max(centers[2:])-min(centers[2:]) < image.height*.15 and min(centers[2:])-max(centers[:2]) > image.height*.1:
                matrix = [[float(row['text'].replace('−','-')) for row in line] for line in (top, bottom)]
        result = {'text': text[:8000], 'math_text': math_text, 'rows': rows, 'matrix': matrix,
                  'method': 'local_ocr', 'backend': backend, 'reason': reason,
                  'status': status, 'version': _CACHE_VERSION}
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f'{target.stem}.{uuid4().hex}.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary,target)
        return result
    except (ImportError, OSError, ValueError) as error:
        return {'text': '', 'rows': [], 'matrix': None, 'reason': f'本地图片识别不可用：{type(error).__name__}'}
