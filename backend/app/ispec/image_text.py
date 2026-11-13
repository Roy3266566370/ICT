"""Local image text recognition with evidence boxes and a content-addressed cache."""
from __future__ import annotations

import hashlib
import io
import json
import re
import threading
import os
from uuid import uuid4
from functools import lru_cache

import numpy as np
from PIL import Image

from ..settings import DATA_DIR

_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)


def recognize_image(blob: bytes) -> dict:
    digest = hashlib.sha256(blob).hexdigest()
    target = DATA_DIR/'ocr'/f'rapid144_{digest}.json'
    if target.exists():
        try:
            return json.loads(target.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            pass
    try:
        image = Image.open(io.BytesIO(blob)).convert('RGBA')
        if image.width*image.height > 20_000_000:
            return {'text': '', 'rows': [], 'reason': '图片尺寸过大，待人工确认'}
        rgb = Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image).convert('RGB')
        rgb.thumbnail((1600,1600))
        with _LOCK:
            results, _ = engine()(np.array(rgb))
        rows = [{'box': box, 'text': text, 'score': float(score)} for box, text, score in (results or []) if score >= .6]
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
        matrix = None
        numbers = [row for row in rows if row['score'] >= .85 and re.fullmatch(r'[-−+]?\d+(?:\.\d+)?', row['text'].strip())]
        # Four isolated numeric tokens in two rows/columns, within a small formula
        # image, are a candidate matrix, never an unlabelled chart extraction.
        if len(rows) == len(numbers) == 4 and image.width/image.height < 2.5:
            ordered = sorted(numbers, key=lambda row: sum(p[1] for p in row['box'])/4)
            top = sorted(ordered[:2], key=lambda row: row['box'][0][0])
            bottom = sorted(ordered[2:], key=lambda row: row['box'][0][0])
            centers = [sum(p[1] for p in row['box'])/4 for row in top+bottom]
            if max(centers[:2])-min(centers[:2]) < image.height*.15 and max(centers[2:])-min(centers[2:]) < image.height*.15 and min(centers[2:])-max(centers[:2]) > image.height*.1:
                matrix = [[float(row['text'].replace('−','-')) for row in line] for line in (top, bottom)]
        result = {'text': text[:8000], 'rows': rows, 'matrix': matrix, 'method': 'local_ocr', 'reason': None}
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f'{target.stem}.{uuid4().hex}.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary,target)
        return result
    except (ImportError, OSError, ValueError) as error:
        return {'text': '', 'rows': [], 'matrix': None, 'reason': f'本地图片识别不可用：{type(error).__name__}'}
