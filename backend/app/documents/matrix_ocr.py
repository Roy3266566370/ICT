"""Read bracketed numeric matrices locally and anchor cells to source pixels."""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from io import BytesIO
import math
import re
import threading

from PIL import Image, ImageOps

_LOCK = threading.Lock()
_NUMBER = re.compile(r'[-+]?\d+(?:\.\d+)?')


def _union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes)]


@lru_cache(maxsize=12)
def _read(image_png: bytes) -> dict | None:
    """Bound image sizes, serialize the shared OCR engine, cache repeated checks."""
    if len(image_png) > 8_000_000:
        return None
    try:
        import cv2
        import numpy as np
        from ..labs.extract import _ocr_engine

        with Image.open(BytesIO(image_png)) as source:
            width, height = source.size
            if min(width, height) < 12 or width * height > 2_000_000:
                return None
            rgba = source.convert('RGBA')
        background = Image.new('RGBA', rgba.size, 'white')
        background.alpha_composite(rgba)
        image = background.convert('RGB')
        mask = (cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY) < 190).astype('uint8')
        _, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        components = [[int(x), int(y), int(x+w), int(y+h)]
                      for x, y, w, h, area in stats[1:] if area >= 2]
        delimiters = sorted([b for b in components
                             if b[3]-b[1] >= height*.55 and b[3]-b[1] > 2*(b[2]-b[0])], key=lambda b:b[0])
        if not delimiters or len(delimiters) % 2 or len(delimiters) > 12:
            return None
        glyphs = [b for b in components if b not in delimiters]
        scale = min(4, 4800/max(width, height), math.sqrt(12_000_000/(width*height)))
        prepared = ImageOps.expand(image.resize((round(width*scale), round(height*scale)), Image.Resampling.LANCZOS), border=12, fill='white')
        with _LOCK:
            raw, _ = _ocr_engine()(np.asarray(prepared), use_cls=False)
        numbers = []
        claimed = set()
        for polygon, text, confidence in raw or []:
            text = str(text).strip().replace('\u2212', '-')
            if not _NUMBER.fullmatch(text) or confidence < .6:
                continue
            box = [(min(p[0] for p in polygon)-12)/scale,
                   (min(p[1] for p in polygon)-12)/scale,
                   (max(p[0] for p in polygon)-12)/scale,
                   (max(p[1] for p in polygon)-12)/scale]
            selected = []
            for i, b in enumerate(glyphs):
                overlap = max(0,min(box[2],b[2])-max(box[0],b[0])) * max(0,min(box[3],b[3])-max(box[1],b[1]))
                if overlap/((b[2]-b[0])*(b[3]-b[1])) > .65:
                    selected.append(i)
            if not selected:
                continue  # A delimiter can itself be read as 1 or 7.
            if claimed.intersection(selected):
                return None
            claimed.update(selected)
            value = float(text)
            if not math.isfinite(value):
                return None
            numbers.append({'value': int(value) if value.is_integer() else value,
                            'box': _union([glyphs[i] for i in selected]), 'components': selected, 'confidence': float(confidence)})
        matrices = []
        used = set()
        for left, right in zip(delimiters[::2], delimiters[1::2]):
            if abs(left[1]-right[1]) > height*.12 or abs(left[3]-right[3]) > height*.12:
                return None
            # Italic glyphs can overhang the horizontal bracket tips.
            x0, x1 = (left[0]+left[2])/2, (right[0]+right[2])/2
            inside = [i for i,d in enumerate(numbers) if x0 < (d['box'][0]+d['box'][2])/2 < x1
                      and left[1] <= (d['box'][1]+d['box'][3])/2 <= left[3]]
            if not inside or used.intersection(inside):
                return None
            used.update(inside)
            bands = []
            for i in sorted(inside, key=lambda i:(numbers[i]['box'][1]+numbers[i]['box'][3])/2):
                b = numbers[i]['box']; cy = (b[1]+b[3])/2
                if not bands or abs(cy-bands[-1][0]) > max(8,(b[3]-b[1])*.65):
                    bands.append((cy, []))
                bands[-1][1].append(i)
            rows = [sorted(indices,key=lambda i:numbers[i]['box'][0]) for _,indices in bands]
            cols = len(rows[0])
            if not 1 <= len(rows) <= 6 or not 1 <= cols <= 6 or any(len(row) != cols for row in rows):
                return None
            median_width = float(np.median([numbers[i]['box'][2]-numbers[i]['box'][0] for i in inside]))
            for col in range(cols):
                centers = [(numbers[row[col]]['box'][0]+numbers[row[col]]['box'][2])/2 for row in rows]
                if max(centers)-min(centers) > max(12,median_width*.8):
                    return None
            # Refuse missed digits/signs rather than silently filling a partial matrix.
            owned = {i for index in inside for i in numbers[index]['components']}
            for i,b in enumerate(glyphs):
                if x0 < (b[0]+b[2])/2 < x1 and left[1] < (b[1]+b[3])/2 < left[3] and i not in owned:
                    return None
            cells = []
            for r,row in enumerate(rows):
                for c,index in enumerate(row):
                    b = numbers[index]['box']
                    x,y,x2,y2 = max(0,b[0]-2),max(0,b[1]-2),min(width,b[2]+2),min(height,b[3]+2)
                    cells.append({'row':r,'col':c,'bbox':[x/width,y/height,(x2-x)/width,(y2-y)/height]})
            matrices.append({'values':[[numbers[i]['value'] for i in row] for row in rows], 'cells':cells})
        if len(used) != len(numbers):
            return None
        result = {'matrices':matrices, '_confidence': min(item['confidence'] for item in numbers)}
        texts = [str(item[1]).strip() for item in raw or []]
        if len(matrices) == 3 and '+' in texts and any(t in {'=', '\u4e8c'} for t in texts):
            a,b,c = [m['values'] for m in matrices]
            if len(a)==len(b)==len(c) and all(len(ar)==len(br)==len(cr) and all(abs(x+y-z)<1e-8 for x,y,z in zip(ar,br,cr)) for ar,br,cr in zip(a,b,c)):
                result.update(operation='add', operands=[0,1], result=2)
        return result
    except Exception:
        return None


def ocr_matrix_image(image_png: bytes) -> dict | None:
    """Recognize complete bracketed matrices, ordered from left to right."""
    result = _read(image_png)
    return {key:deepcopy(value) for key,value in result.items() if key != '_confidence'} if result is not None else None


def matrix_ocr_confidence(image_png: bytes) -> float:
    result = _read(image_png)
    return result.get('_confidence', 0) if result else 0


@lru_cache(maxsize=12)
def diagram_text(image_png: bytes) -> str:
    """Read diagram legends under the same OCR lock used for matrix cells."""
    try:
        import numpy as np
        from ..labs.extract import _ocr_engine
        with Image.open(BytesIO(image_png)) as source:
            if source.width*source.height > 12_000_000:
                return ''
            image = Image.new('RGBA', source.size, 'white')
            image.alpha_composite(source.convert('RGBA'))
            image.thumbnail((1600, 1600))
            image = image.convert('RGB')
        with _LOCK:
            rows, _ = _ocr_engine()(np.asarray(image), use_cls=False)
        return '\n'.join(str(row[1]) for row in rows or [] if row[2] >= .8)
    except Exception:
        return ''


def calibrate_matrix_ocr(image_png: bytes, config: dict) -> dict | None:
    """Require exact local values/layout, replace model boxes with pixel boxes."""
    try:
        if config.get('operation') not in (None, 'add'):
            return None
        actual = _read(image_png)
        matrices = config['matrices']
        if actual is None or len(matrices) != len(actual['matrices']):
            return None
        output = deepcopy(config)
        for expected, found, target in zip(matrices, actual['matrices'], output['matrices']):
            values = expected['values']
            if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for row in values for v in row):
                return None
            if values != found['values']:
                return None
            wanted = {(r,c) for r,row in enumerate(values) for c in range(len(row))}
            cells = expected['cells']
            if any(type(c['row']) is not int or type(c['col']) is not int for c in cells):
                return None
            if len(cells) != len(wanted) or {(c['row'],c['col']) for c in cells} != wanted:
                return None
            target['cells'] = deepcopy(found['cells'])
        if config.get('operation') == 'add':
            if actual.get('operation') != 'add' or config.get('operands') != [0,1] or config.get('result') != 2:
                return None
        if actual.get('operation') == 'add':
            output.update(operation='add', operands=[0, 1], result=2)
        return output
    except (KeyError, TypeError, ValueError):
        return None
