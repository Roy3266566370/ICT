"""Score the production local detector against fixed pixel annotations."""

import argparse
import json
import math
from pathlib import Path
import sys
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(HERE.parent / 'walkthrough-2026-11-23'))

from app.documents.auto_vectors import clean_figure, detect_figure
from app.documents.figure_service import read_ocr
from app.ispec.image_text import engine
from vision_probe import TRUTH, score


BASIS = ROOT / 'frontend/e2e/fixtures'
COMPRESSED = {
    'left_x': [[15, 270], [320, 270]], 'left_y': [[167, 118], [167, 377]],
    'left_e1': [[167, 270], [273, 270]], 'left_e2': [[167, 270], [167, 220]],
    'left_v': [[167, 270], [273, 217]], 'left_guide': [[276, 270], [276, 220]],
    'left_coord': {'at': [232, 96], 'text': '(2, 1)'},
    'right_x': [[348, 270], [654, 270]], 'right_y': [[501, 118], [501, 377]],
    'right_b1': [[501, 270], [554, 270]], 'right_b2': [[501, 270], [555, 219]],
    'right_v': [[501, 270], [607, 217]], 'right_guide': [[555, 270], [605, 220]],
    'right_coord': {'at': [556, 96], 'text': '(1, 1)'},
}
SINGLE = {
    'single_x': [[35, 238], [421, 238]], 'single_y': [[132, 55], [132, 307]],
    'single_e1': [[132, 238], [243, 238]], 'single_e2': [[132, 238], [132, 164]],
    'single_v': [[132, 238], [243, 164]], 'single_guide': [[243, 238], [243, 164]],
    'single_coord': {'at': [228, 35], 'text': '(3, 2)'},
}
FIXTURES = {
    BASIS / 'basis-alternate.png': TRUTH,
    BASIS / 'basis-compressed.jpg': COMPRESSED,
    HERE / 'single-projection.png': SINGLE,
    HERE / 'axis-like-negative.png': {},
}


def expected_type(key):
    suffix = key.rsplit('_', 1)[-1]
    return {'x': 'axis', 'y': 'axis', 'guide': 'dashed', 'coord': 'text'}.get(suffix, 'vector')


def endpoint_error(key, expected, candidate):
    if candidate['type'] == 'text':
        return math.dist(candidate['points'][0], expected['at'])
    direct = max(math.dist(a, b) for a, b in zip(candidate['points'], expected))
    if expected_type(key) != 'vector':
        reverse = max(math.dist(a, b) for a, b in zip(reversed(candidate['points']), expected))
        return min(direct, reverse)
    return direct


def grade(annotations, objects, width):
    threshold = width * .03
    possibles = sorted(
        (endpoint_error(key, expected, candidate), key, index)
        for key, expected in annotations.items()
        for index, candidate in enumerate(objects)
        if candidate['type'] == expected_type(key)
    )
    assigned, used, predictions, errors = {}, set(), {}, {}
    for error, key, index in possibles:
        if key in assigned or index in used:
            continue
        assigned[key] = index
        used.add(index)
        errors[key] = error
        candidate = objects[index]
        predictions[key] = ({'at': candidate['points'][0], 'text': candidate['text']}
                            if candidate['type'] == 'text' else candidate['points'])
    # More than one candidate for an expected object is a failed match. Keep
    # unmatched candidates visible separately, even when the score is zero.
    in_range = {index for key, index in assigned.items() if errors[key] < threshold}
    duplicates = {key for error, key, index in possibles if error < threshold and index not in in_range}
    for key in duplicates:
        predictions.pop(key, None)
    result = score(predictions, 'pixel', annotations, width)
    accepted = {index for key, index in assigned.items()
                if result['error_px'][key] is not None and errors[key] < threshold}
    result.update({
        'matched_ids': {key: objects[index]['id'] for key, index in assigned.items()},
        'missing': sorted(set(annotations) - set(assigned)),
        'duplicates': sorted(duplicates),
        'extras': [obj for index, obj in enumerate(objects) if index not in accepted],
        'threshold_px': threshold,
    })
    return result


def run(path, truth, cold_engine):
    if cold_engine:
        engine.cache_clear()
    with Image.open(path) as source:
        image = source.convert('RGB')
    started = time.perf_counter()
    rows = read_ocr(image)
    ocr_done = time.perf_counter()
    systems, objects = detect_figure(image, rows)
    detection_done = time.perf_counter()
    verified = set()
    clean_figure(image, objects, verified_ids=verified)
    cleaned = time.perf_counter()
    return {
        **grade(truth, objects, image.width),
        'systems': systems, 'ocr_rows': len(rows), 'recognized_objects': len(objects),
        'safe_to_apply': grade(truth, [obj for obj in objects if obj['id'] in verified], image.width),
        'raster_preserved_ids': [obj['id'] for obj in objects if obj['id'] not in verified],
        'vision_calls': 0,
        'seconds': {'ocr': round(ocr_done - started, 4),
                    'detection': round(detection_done - ocr_done, 4),
                    'cleanup': round(cleaned - detection_done, 4),
                    'preview': round(detection_done - started, 4)},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--output', type=Path, default=HERE / 'pixel-results.json')
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error('--rounds must be positive')
    samples = {}
    for fixture, truth in FIXTURES.items():
        samples[fixture.name] = {
            'annotations': truth,
            'cold_ocr_engine': [run(fixture, truth, cold_engine=True) for _ in range(args.rounds)],
            'warm_ocr_engine': [run(fixture, truth, cold_engine=False) for _ in range(args.rounds)],
        }
    args.output.write_text(json.dumps(samples, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name, sample in samples.items():
        print(name, [(label, [(r['passed'], r['total'], len(r['extras']), r['seconds']['preview']) for r in sample[label]])
                     for label in ('cold_ocr_engine', 'warm_ocr_engine')])
    basis = samples['basis-alternate.png']
    if any(run['safe_to_apply']['passed'] < 12 or run['safe_to_apply']['extras']
           for label in ('cold_ocr_engine', 'warm_ocr_engine') for run in basis[label]):
        sys.exit('Basis fixture failed the 12/13 acceptance threshold or emitted extra applicable objects')
