"""Editable PPT vectors and evidence-backed pixel geometry."""
from __future__ import annotations

import base64
from io import BytesIO
from itertools import combinations
import logging
import math
import re
import unicodedata

import numpy as np
from PIL import Image, ImageFilter
from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml

from .layers import ensure_document, manifest_ready, prepare_page, read_manifest
from .store import LOCK, document_root, read_document, write_document

logger = logging.getLogger(__name__)

def _vector(node, start, end, style):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < .1:
        return None
    return {
        **node, "type": "vector", "x": (start[0] + end[0] - length) / 2,
        "y": (start[1] + end[1] - 16) / 2, "width": length, "height": 16,
        "rotation": math.degrees(math.atan2(dy, dx)), "style": {**node["style"], **style},
        "locked": False,
    }


def _stroke_color(shape):
    color = shape.line.color
    if color.type == MSO_COLOR_TYPE.RGB:
        return "#" + str(color.rgb)
    if color.type != MSO_COLOR_TYPE.SCHEME:
        return None
    keys = {**{f"ACCENT_{i}": f"accent{i}" for i in range(1, 7)},
            "DARK_1": "dk1", "LIGHT_1": "lt1", "DARK_2": "dk2", "LIGHT_2": "lt2",
            "TEXT_1": "dk1", "BACKGROUND_1": "lt1", "TEXT_2": "dk2", "BACKGROUND_2": "lt2"}
    key = keys.get(color.theme_color.name)
    if not key:
        return None
    master = shape.part.slide_layout.slide_master.part
    mapping = master._element.find(qn("p:clrMap"))
    aliases = {"TEXT_1": "tx1", "BACKGROUND_1": "bg1", "TEXT_2": "tx2", "BACKGROUND_2": "bg2"}
    if mapping is not None:
        key = mapping.get(aliases.get(color.theme_color.name, key), key)
    relation = next((item for item in master.rels.values() if item.reltype.endswith("/theme")), None)
    if relation is None:
        return None
    scheme = parse_xml(relation.target_part.blob).find(".//" + qn("a:clrScheme"))
    entry = scheme.find(qn("a:" + key)) if scheme is not None else None
    if entry is None or not len(entry):
        return None
    rgb = entry[0].get("lastClr") or entry[0].get("val")
    if not rgb or not re.fullmatch(r"[0-9a-fA-F]{6}", rgb):
        return None
    brightness = color.brightness
    values = [int(rgb[i:i+2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(v + (255-v)*brightness if brightness >= 0 else v*(1+brightness)):02x}" for v in values)


def native_vector(shape, node):
    if shape.shape_type != MSO_SHAPE_TYPE.LINE:
        return None
    geometry = shape._element.find(".//" + qn("a:prstGeom"))
    line = shape._element.find(".//" + qn("a:ln"))
    if geometry is None or geometry.get("prst") != "line" or line is None:
        return None
    color = _stroke_color(shape)
    if color is None:
        return None
    start = (shape.begin_x.pt, shape.begin_y.pt)
    end = (shape.end_x.pt, shape.end_y.pt)
    cx, cy = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
    angle = math.radians(shape.rotation)
    cos, sin = math.cos(angle), math.sin(angle)

    def rotate(point):
        x, y = point[0] - cx, point[1] - cy
        return cx + x * cos - y * sin, cy + x * sin + y * cos

    def arrow(tag):
        marker = line.find(qn("a:" + tag))
        return marker is not None and marker.get("type") in ("triangle", "stealth", "arrow")

    dash = line.find(qn("a:prstDash"))
    style_name = dash.get("val", "solid") if dash is not None else "solid"
    return _vector(node, rotate(start), rotate(end), {
        "stroke": color, "stroke_width": shape.line.width.pt or 1,
        "line_style": "dotted" if "dot" in style_name.lower() and "dash" not in style_name.lower()
        else "dashed" if style_name != "solid" else "solid",
        "arrow_start": arrow("headEnd"), "arrow_end": arrow("tailEnd"),
    })


def _point(value, width, height):
    if not isinstance(value, list) or len(value) != 2 or not all(
        type(v) in (int, float) and 0 <= v <= 1 for v in value
    ):
        return None
    return np.array([value[0] * (width - 1), value[1] * (height - 1)])


def _basis_overlay(image, cleaned, vectors, node):
    """Match the two-panel unit-basis diagram by geometry, then clear its dynamic ink."""
    if len(vectors) != 6:
        return None
    ordered = sorted(vectors, key=lambda v: v["x"] + v["width"]/2)

    def axes(group):
        by_angle = sorted(group, key=lambda v: v["rotation"])
        diagonal, resultant, horizontal = by_angle
        return horizontal, diagonal, resultant

    left, vertical, left_sum = axes(ordered[:3])
    first, second, total = axes(ordered[3:])
    if not (abs(left["rotation"]) < 8 and abs(first["rotation"]) < 8 and
            -100 < vertical["rotation"] < -80 and -63 < second["rotation"] < -34 and
            -35 < total["rotation"] < -17 and abs(total["rotation"]-left_sum["rotation"]) < 5 and
            .9 < total["width"]/left_sum["width"] < 1.1 and
            1.7 < left["width"]/first["width"] < 2.4):
        return None
    ih, iw = image.shape[:2]
    scale = np.array([iw/node["width"], ih/node["height"]])
    shift = np.array([node["x"], node["y"]])

    def endpoints(vector):
        angle = math.radians(vector["rotation"])
        mid = np.array([vector["x"]+vector["width"]/2, vector["y"]+8])
        half = np.array([math.cos(angle), math.sin(angle)])*vector["width"]/2
        return (mid-half-shift)*scale, (mid+half-shift)*scale

    origin, corner = endpoints(first)
    start, target = endpoints(total)
    b2start, b2tip = endpoints(second)
    unit = np.linalg.norm(corner-origin)
    left_origin, left_corner = endpoints(left)
    vertical_origin, vertical_tip = endpoints(vertical)
    left_start, left_target = endpoints(left_sum)
    if max(np.linalg.norm(vertical_origin-left_origin), np.linalg.norm(left_start-left_origin),
           np.linalg.norm(left_corner + vertical_tip - vertical_origin - left_target)) > unit*.3:
        return None
    if max(np.linalg.norm(start-origin), np.linalg.norm(b2start-origin),
           np.linalg.norm(corner + b2tip - b2start - target)) > unit*.2:
        return None

    # The original title is on the first dark text row in this band. Replace
    # only that row and leave the horizontal grid, left heading and labels alone.
    x0 = max(0, round(origin[0]-unit*2))
    x1 = min(iw, round(origin[0]+unit*3.2))
    y0 = max(0, round(origin[1]-unit*4.1))
    y1 = max(0, round(origin[1]-unit*2.7))
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    dark = crop.max(axis=2) < 135
    rows = np.flatnonzero(dark.sum(axis=1) > 5)
    if not len(rows) or rows[-1]-rows[0] > unit*.65:
        return None
    columns = np.flatnonzero(dark.any(axis=0))
    if len(columns) < 30:
        return None
    title = [x0 + columns[0]-2, y0 + rows[0]-3, x0 + columns[-1]+4, y0 + rows[-1]+4]
    tx0, ty0, tx1, ty1 = (int(q) for q in title)
    background = np.median(crop.reshape(-1, 3), axis=0)
    if np.min(background) < 235:
        return None
    cleaned[max(0,ty0):ty1, max(0,tx0):tx1] = background

    yy, xx = np.indices((ih, iw), dtype=np.float32)
    ux, uy = (target-corner)/np.linalg.norm(target-corner)
    along = (xx-corner[0])*ux + (yy-corner[1])*uy
    across = (yy-corner[1])*ux - (xx-corner[0])*uy
    # The b₁ label is blue. Remove only the ochre guide under it.
    ochre = (image[:,:,0]-image[:,:,2] > 13) & (image[:,:,1]-image[:,:,2] > 6)
    cleaned[ochre & (abs(across)<5) & (along>=-2) & (along<=np.linalg.norm(target-corner)+2)] = background

    def slide_point(point):
        return (np.array(point)/scale+shift).tolist()

    # Snap small raster measurement errors to the exact original composition.
    # Preserve the visible resultant endpoint as the invariant.
    corner = np.array([(origin[0]+target[0])/2, origin[1]])
    for vector, tip in ((first, corner), (second, origin + target - corner)):
        geometry = _vector(vector, slide_point(origin), slide_point(tip), {})
        if geometry is not None:
            vector.update(geometry)

    return {
        "firstId": first["id"], "secondId": second["id"], "resultId": total["id"],
        "title": slide_point((tx0, ty0)), "fontSize": float((ty1-ty0)/scale[1]),
    }


def _general_basis_overlay(vectors, node):
    """Fallback basis matcher for 3+ arrows sharing a common origin with v ≈ c1*b1 + c2*b2."""
    if len(vectors) < 3:
        return None

    def endpoints(vector):
        angle = math.radians(vector["rotation"])
        mid = np.array([vector["x"] + vector["width"] / 2, vector["y"] + 8.0])
        half = np.array([math.cos(angle), math.sin(angle)]) * vector["width"] / 2
        return mid - half, mid + half

    pts = [(v, *endpoints(v)) for v in vectors]
    best = None
    for i, (v1, s1, e1) in enumerate(pts):
        d1 = e1 - s1
        l1 = float(np.linalg.norm(d1))
        if l1 < 18:
            continue
        for j, (v2, s2, e2) in enumerate(pts):
            if i == j:
                continue
            d2 = e2 - s2
            l2 = float(np.linalg.norm(d2))
            if l2 < 18 or float(np.linalg.norm(s1 - s2)) > min(l1, l2) * 0.25:
                continue
            cross = float(d1[0] * d2[1] - d1[1] * d2[0])
            if abs(cross) < l1 * l2 * 0.2:
                continue
            for k, (vr, sr, er) in enumerate(pts):
                if k in (i, j):
                    continue
                dr = er - sr
                lr = float(np.linalg.norm(dr))
                if lr < max(l1, l2) * 0.7 or float(np.linalg.norm(sr - s1)) > min(l1, l2) * 0.25:
                    continue
                c1 = (dr[0] * d2[1] - dr[1] * d2[0]) / cross
                c2 = (d1[0] * dr[1] - d1[1] * dr[0]) / cross
                if not (0.35 <= c1 <= 3.5 and 0.35 <= c2 <= 3.5):
                    continue
                residual = float(np.linalg.norm(dr - (c1 * d1 + c2 * d2)))
                if residual > lr * 0.18:
                    continue
                score = abs(v1["rotation"]) + residual / lr * 30
                if best is None or score < best[0]:
                    tx = float(max(12.0, min(s1[0], e1[0], e2[0], er[0])))
                    ty = float(max(12.0, min(s1[1], e1[1], e2[1], er[1]) - 32.0))
                    best = (score, {
                        "firstId": v1["id"],
                        "secondId": v2["id"],
                        "resultId": vr["id"],
                        "title": [round(tx, 2), round(ty, 2)],
                        "fontSize": 18.0,
                    })
    return best[1] if best else None


def pixel_arrow_candidates(image):
    """Find arrow shafts and heads in flat teaching diagrams at pixel precision."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    hsv = np.asarray(image.convert("HSV"))
    height, width = hsv.shape[:2]
    result = []
    chroma = np.ptp(rgb, axis=2)
    hue_values = hsv[:, :, 0].astype(np.int16)
    for hue in (*range(0, 256, 16), None):
        if hue is None:
            mask = (rgb.max(axis=2) <= 115) & (chroma <= 38)
        else:
            distance = abs(hue_values - hue)
            mask = (np.minimum(distance, 256-distance) <= 19) & (chroma >= 37)
        if not 20 < np.count_nonzero(mask) < width*height*.12:
            continue
        remaining = set(zip(*np.nonzero(mask)))
        while remaining:
            first = remaining.pop()
            points = [first]
            for y, x in points:
                for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0),
                               (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    key = (y+dy, x+dx)
                    if key in remaining:
                        remaining.remove(key)
                        points.append(key)
            if not 35 <= len(points) <= 8000:
                continue
            pixels = np.array(points)[:, ::-1]
            center = pixels.mean(axis=0)
            _, axes = np.linalg.eigh(np.cov(pixels.T))
            axis = axes[:, -1]
            normal = np.array([-axis[1], axis[0]])
            along = (pixels-center) @ axis
            across = (pixels-center) @ normal
            low, high = along.min(), along.max()
            extent = high-low
            if extent < 23 or np.ptp(across) > min(22, extent*.3):
                continue
            fraction = (along-low)/extent
            shaft = (fraction > .3) & (fraction < .7)
            if np.count_nonzero(shaft) < 12:
                continue
            shaft_width = np.ptp(across[shaft])
            if shaft_width > 8:
                continue
            ends = ((fraction > .03) & (fraction < .23), (fraction > .77) & (fraction < .97))
            span = [np.ptp(across[end]) if np.any(end) else 0 for end in ends]
            if max(span) < shaft_width+1.3 or min(span) > shaft_width+2:
                continue
            offset = np.median(across[shaft])
            tail, tip = (low, high) if span[1] > span[0] else (high, low)
            color = np.median(rgb[pixels[shaft, 1], pixels[shaft, 0]], axis=0).astype(int)
            def normalize(t):
                point = center + axis*t + normal*offset
                return np.clip(point/[width-1, height-1], 0, 1).tolist()
            result.append({"start": normalize(tail), "end": normalize(tip),
                           "color": "#" + "".join(f"{c:02x}" for c in color), "confidence": .95})
    return result[:32]


def _figure_runs(flags, max_gap=0):
    indices = np.flatnonzero(flags)
    return [
        (int(run[0]), int(run[-1]))
        for run in np.split(indices, np.flatnonzero(np.diff(indices) > max_gap + 1) + 1)
        if run.size
    ]


def _figure_axis(rgb, foreground, origin, arrows, vertical):
    if vertical:
        rgb, foreground, origin = rgb.swapaxes(0, 1), foreground.T, origin[::-1]
    x, y = np.rint(origin).astype(int)
    candidates = []
    for row in range(max(0, y - 8), min(len(rgb), y + 9)):
        for start, end in _figure_runs(foreground[row], max_gap=3):
            if end - start >= 35 and start - 5 <= x <= end + 5:
                candidates.append((start, end, row))
    if not candidates:
        return None
    start, end, row = max(candidates, key=lambda line: line[1] - line[0] - abs(line[2] - y) * .1)
    peers = [
        candidate[2] for candidate in candidates
        if abs(candidate[2] - row) <= 2
        and abs(candidate[0] - start) + abs(candidate[1] - end) <= 6
    ]
    center = float(np.median(peers))
    parallel, normal = (1, 0) if vertical else (0, 1)
    for tail, tip, _ in arrows:
        lo, hi = sorted((tail[parallel], tip[parallel]))
        if max(abs(tail[normal] - center), abs(tip[normal] - center)) <= 6 and lo - 8 <= start and end <= hi + 8:
            return None
    pixels = rgb[row, start:end + 1][foreground[row, start:end + 1]]
    color = np.median(pixels, axis=0)
    points = [[start, center], [end, center]]
    if vertical:
        points = [point[::-1] for point in points]
    return points, color, len(set(peers))


def _figure_style(color, width):
    return {'stroke': '#' + ''.join(f'{int(channel):02x}' for channel in color), 'width': width}


def _figure_arrow_style(rgb, foreground, start, end, candidate):
    direction = (end - start) / math.dist(start, end)
    center = np.rint((start + end) * .5).astype(int)
    normal = np.array([-direction[1], direction[0]])
    cross = np.rint(center + np.arange(-4, 5)[:, None] * normal).astype(int)
    cross = np.clip(cross, 0, [rgb.shape[1] - 1, rgb.shape[0] - 1])
    thickness = np.count_nonzero(foreground[cross[:, 1], cross[:, 0]])
    return {'stroke': candidate['color'], 'width': max(2, int(thickness))}


def _isolated_figure_arrow(rgb, start, end, candidate):
    color = np.array([int(candidate['color'][i:i + 2], 16) for i in (1, 3, 5)])
    if np.ptp(color) < 45 or math.dist(start, end) < 32:
        return False
    shaft = np.rint(start + np.linspace(.16, .72, 17)[:, None] * (end - start)).astype(int)
    pixels = rgb[shaft[:, 1], shaft[:, 0]]
    return np.mean(np.max(abs(pixels - color), axis=1) < 44) >= .9


def _figure_dash(rgb, background, start, end):
    distance = math.dist(start, end)
    if distance < 27:
        return None
    count = round(distance) + 1
    line = np.linspace(start, end, count)
    normal = np.array([start[1] - end[1], end[0] - start[0]]) / distance
    offsets = np.arange(-5, 6)
    points = np.rint(line[:, None, :] + normal * offsets[None, :, None]).astype(int)
    x = np.clip(points[:, :, 0], 0, rgb.shape[1] - 1)
    y = np.clip(points[:, :, 1], 0, rgb.shape[0] - 1)
    pixels = rgb[y, x]
    interior = round(min(9, distance * .13))
    pixels = pixels[interior:-interior]
    contrast = np.max(background - pixels, axis=2)
    dark = (np.ptp(pixels, axis=2) >= 15) & (contrast >= np.maximum(34, np.quantile(contrast, .9, axis=0) * .64))
    candidates = []
    for index, offset in enumerate(offsets):
        mask = dark[:, index]
        runs = [(a, b) for a, b in _figure_runs(mask, max_gap=1) if b - a >= 2]
        if len(runs) < 3 or mask.mean() > .86 or runs[-1][1] - runs[0][0] < distance * .40:
            continue
        gaps = np.diff([a for a, _ in runs])
        if max(gaps) > min(gaps) * 2.8:
            continue
        strength = np.median(contrast[:, index][mask])
        candidates.append((strength - abs(offset) * 2, offset, pixels[:, index][mask]))
    if candidates:
        _, offset, ink = max(candidates, key=lambda item: item[0])
        shift = normal * offset
        points = np.clip([start + shift, end + shift], 0, [rgb.shape[1] - 1, rgb.shape[0] - 1])
        return points, _figure_style(np.median(ink, axis=0), 2.0)
    return None


_COORDINATE_LABEL = re.compile(r'\(\s*([−+-]?\d+(?:\.\d+)?)\s*,\s*([−+-]?\d+(?:\.\d+)?)\s*\)\s*$')


def _figure_labels(ocr, rgb, background):
    for row in ocr:
        try:
            text = unicodedata.normalize('NFKC', row['text']).strip()
            box = np.asarray(row['box'], dtype=float)
            score = float(row['score'])
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
        coordinate = _COORDINATE_LABEL.search(text)
        if coordinate is None or box.shape != (4, 2) or not np.isfinite(box).all() or not .75 <= score <= 1:
            continue
        box = np.clip(box, 0, [rgb.shape[1], rgb.shape[0]])
        x0, y0 = box.min(axis=0).astype(int).tolist()
        x1, y1 = box.max(axis=0).astype(int).tolist()
        if x1 - x0 < 8 or y1 - y0 < 5:
            continue
        prefix = text[:coordinate.start()]
        if prefix:
            # A detector often returns one box for the entire heading. Look for the
            # blank band nearest the estimated start of the coordinate substring.
            def measure(value):
                return sum(2 if unicodedata.east_asian_width(c) in 'FW' else 1 for c in value)

            expected = x1 - (x1 - x0) * measure(coordinate[0]) / measure(text)
            ink = (background - rgb[y0:y1, x0:x1]).max(axis=2) > 65
            separators = [x0 + (a + b) // 2 for a, b in _figure_runs(~ink.any(axis=0)) if b - a >= 1]
            near = [p for p in separators if abs(p - expected) <= (y1 - y0) * .6]
            if not near:
                continue
            x0 = min(near, key=lambda p: abs(p - expected))
        if x1 - x0 < 5:
            continue
        ink = (background - rgb[y0:y1, x0:x1]).max(axis=2) > 65
        rows, columns = np.nonzero(ink)
        if not len(rows):
            continue
        box = [max(x0, x0 + int(columns.min()) - 1), max(y0, y0 + int(rows.min()) - 1),
               min(x1, x0 + int(columns.max()) + 2), min(y1, y0 + int(rows.max()) + 2)]
        center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
        color = np.median(rgb[y0 + rows, x0 + columns], axis=0)
        yield f'({coordinate[1]}, {coordinate[2]})', center, box, score, _figure_style(color, 1.0)


def detect_figure(image, ocr):
    """Extract geometry supported by raster strokes, with OCR boxes in source pixels."""
    rgb = np.asarray(image.convert('RGB'), dtype=np.int16)
    height, width = rgb.shape[:2]
    background = np.median(rgb[::5, ::5], axis=(0, 1)).astype(np.int16)
    foreground = (background - rgb).max(axis=2) >= 19
    arrows = []
    for candidate in pixel_arrow_candidates(image):
        start, end = (
            np.asarray(candidate[key]) * [width - 1, height - 1]
            for key in ('start', 'end')
        )
        if not any(math.dist(start, a) < 10 and math.dist(end, b) < 8 for a, b, _ in arrows):
            arrows.append((start, end, candidate))
    # Vote for origins using converging arrow tails. Isolated components, such
    # as connected letters in JPEG headings, cannot establish a coordinate panel.
    groups = []
    for arrow in arrows:
        group = next((group for group in groups if math.dist(group[0][0], arrow[0]) <= 12), None)
        if group is None:
            groups.append([arrow])
        else:
            group.append(arrow)
    systems, objects, panels = [], [], []

    def add(kind, points, system, style, evidence, confidence=.95, **details):
        objects.append({
            'id': f'figure-{len(objects) + 1}', 'type': kind,
            'points': [[round(float(value), 2) for value in point] for point in points],
            'system_id': system['id'] if system else None, 'style': style,
            'provenance': 'pixel', 'evidence': evidence, 'confidence': confidence, **details,
        })

    for group in sorted(groups, key=lambda group: tuple(group[0][0])):
        directions = [end - start for start, end, _ in group]
        shares_origin = any(abs(a[0] * b[1] - a[1] * b[0]) > np.linalg.norm(a) * np.linalg.norm(b) * .16
                            for a, b in combinations(directions, 2))
        if not shares_origin:
            for start, end, candidate in group:
                if _isolated_figure_arrow(rgb, start, end, candidate):
                    add('vector', (start, end), None, _figure_arrow_style(rgb, foreground, start, end, candidate),
                        ['arrowhead', 'continuous_colored_shaft'])
            continue
        origin = np.median([start for start, _, _ in group], axis=0)
        horizontal = _figure_axis(rgb, foreground, origin, group, vertical=False)
        vertical = _figure_axis(rgb, foreground, origin, group, vertical=True)
        if horizontal and vertical:
            crossing = np.asarray([vertical[0][0][0], horizontal[0][0][1]])
            if all(math.dist(crossing, start) <= 12 for start, _, _ in group):
                origin = crossing
        system = {'id': f'system-{len(systems) + 1}', 'origin_px': origin.tolist(),
                  'unit_px': float(min(math.dist(origin, end) for _, end, _ in group))}
        systems.append(system)
        for axis in (horizontal, vertical):
            if axis is not None:
                points, color, thickness = axis
                add('axis', points, system, _figure_style(color, thickness), ['continuous_axis', 'shared_origin'])
        x_limits = (horizontal[0][0][0], horizontal[0][1][0]) if horizontal else (
            min(origin[0], *(end[0] for _, end, _ in group)),
            max(origin[0], *(end[0] for _, end, _ in group)),
        )
        panels.append((system, x_limits, directions))
        for start, end, candidate in sorted(group, key=lambda v: tuple(v[1])):
            tip_delta = end - origin
            snapped_end = np.where(abs(tip_delta) <= 2, origin, end)
            add('vector', (origin, snapped_end), system, _figure_arrow_style(rgb, foreground, start, end, candidate),
                ['arrowhead', 'continuous_shaft', 'shared_origin'])
        for (_, start, _), (_, end, _) in combinations(group, 2):
            dash = _figure_dash(rgb, background, start, end)
            if dash:
                points, style = dash
                add('dashed', points, system, style, ['repeated_dash_strokes', 'vector_tip_alignment'], .9)
    for text, center, box, score, style in _figure_labels(ocr, rgb, background):
        possible = [(system, directions) for system, (x0, x1), directions in panels
                    if x0 - 10 <= center[0] <= x1 + 10 and center[1] < system['origin_px'][1] - 15]
        if not possible:
            continue
        system, directions = min(possible, key=lambda item: math.dist(center, item[0]['origin_px']))
        existing_labels = [obj for obj in objects if obj['type'] == 'text' and obj['system_id'] == system['id']]
        if any(math.dist(obj['points'][0], center) < 5 for obj in existing_labels):
            continue
        if not existing_labels:
            _fit_orthogonal_unit(system, directions, text)
        add('text', [center], system, style, ['ocr_box', 'coordinate_label'], score, text=text, bbox=box)
    return systems, objects


def _fit_orthogonal_unit(system, directions, text):
    if (len(directions) < 3 or not any(abs(x) < abs(y) * .05 for x, y in directions)
            or not any(abs(y) < abs(x) * .05 for x, y in directions)):
        return
    coordinate = [float(value.replace('−', '-')) for value in _COORDINATE_LABEL.fullmatch(text).groups()]
    if not all(math.isfinite(value) for value in coordinate):
        return
    x, y = max(directions, key=np.linalg.norm)
    if coordinate[0] * x <= 0 or coordinate[1] * y >= 0:
        return
    units = [x / coordinate[0], -y / coordinate[1]]
    if .5 <= min(units) and min(units) >= max(units) * .76:
        system['unit_px'] = float(np.mean(units))


def clean_figure(image, objects, *, verified_ids=None):
    """Erase verified strokes on locally flat raster and optionally collect their IDs."""
    source = np.asarray(image.convert('RGB'), dtype=np.float32)
    result = source.copy()
    height, width = source.shape[:2]
    for obj in objects:
        style = obj.get('style') or {}
        stroke = style.get('stroke', '')
        if not isinstance(stroke, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', stroke):
            continue
        color = np.array([int(stroke[i:i + 2], 16) for i in (1, 3, 5)])
        points = np.asarray(obj['points'], dtype=float)
        kind = obj['type']
        radius = max(2.5, style.get('width', 2) / 2 + 1)
        pad = 14 if kind == 'vector' else math.ceil(radius + 6)
        if kind == 'text':
            if not obj.get('bbox'):
                continue
            left, top, right, bottom = obj['bbox']
        else:
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
        x0, y0 = max(0, math.floor(left - pad)), max(0, math.floor(top - pad))
        x1, y1 = min(width, math.ceil(right + pad + 1)), min(height, math.ceil(bottom + pad + 1))
        crop = source[y0:y1, x0:x1]
        if not crop.size:
            continue
        yy, xx = np.ogrid[y0:y1, x0:x1]
        if kind == 'text':
            corridor = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom)
        else:
            corridor = np.zeros(crop.shape[:2], dtype=bool)
            for start, end in zip(points, points[1:]):
                length = math.dist(start, end)
                if length < 1:
                    continue
                ux, uy = (end - start) / length
                along = (xx - start[0]) * ux + (yy - start[1]) * uy
                across = (yy - start[1]) * ux - (xx - start[0]) * uy
                limit = np.where(along > length - min(24, length * .3), max(radius, 9), radius) if kind == 'vector' else radius
                corridor |= (along >= -2) & (along <= length + 2) & (abs(across) <= limit)
        surround = crop[~corridor]
        if len(surround) < 20:
            continue
        background = np.median(surround, axis=0)
        if np.mean(abs(surround - background).max(axis=1) <= 16) < .8:
            continue
        delta = color - background
        if delta @ delta < 300:
            continue
        contrast = crop - background
        fraction = (contrast @ delta) / (delta @ delta)
        disagreement = abs(contrast - fraction[:, :, None] * delta).max(axis=2)
        neutral_arrow = kind == 'vector' and np.ptp(color) <= 35
        threshold = .4 if neutral_arrow else .13
        ceiling = 1.45 if kind == 'axis' else 2.2
        tolerance = 16 if kind in ('axis', 'text') or neutral_arrow else 33
        mask = corridor & (fraction >= threshold) & (fraction <= ceiling) & (disagreement < tolerance)
        if kind in ('text', 'vector', 'dashed'):
            grown = np.asarray(Image.fromarray(mask).convert('L').filter(ImageFilter.MaxFilter(3))) > 0
            fringe = corridor & grown & (fraction >= .055) & (fraction <= ceiling) & (disagreement < 12)
            if neutral_arrow:
                fringe &= abs(across) <= radius
            mask |= fringe
        if kind == 'dashed' and np.ptp(color) >= 15:
            # Compression can desaturate guides beside stronger labels. Their
            # color direction still distinguishes overlapping neighboring ink.
            mask &= (contrast @ (color - color.mean())) > 0
        if kind == 'text':
            ink = corridor & (abs(contrast).max(axis=2) >= 65)
            if np.count_nonzero(mask) < max(8, np.count_nonzero(ink) * .8):
                continue
        else:
            rows, columns = np.nonzero(mask)
            distance = math.dist(points[0], points[-1])
            covered = math.hypot(np.ptp(columns), np.ptp(rows)) if len(rows) else 0
            if len(rows) < max(5, distance * .35) or covered < distance * (.54 if kind == 'dashed' else .74):
                continue
        result[y0:y1, x0:x1][mask] = background
        if verified_ids is not None:
            verified_ids.add(obj['id'])
    return Image.fromarray(result.astype(np.uint8))


def replace_picture_arrows(image, candidates, node):
    """Check the shaft against real pixels before masking and recreating it."""
    if not isinstance(candidates, list):
        return None
    original = np.asarray(image.convert("RGB"), dtype=np.float32)
    height, width, _ = original.shape
    cleaned = original.copy()
    yy, xx = np.indices((height, width), dtype=np.float32)
    used = np.zeros((height, width), dtype=bool)
    output = []
    replacements = {}
    for index, item in enumerate(candidates[:32]):
        if len(output) >= 12:
            break
        if not isinstance(item, dict):
            continue
        confidence, color = item.get("confidence"), item.get("color")
        if type(confidence) not in (int, float) or not .75 <= confidence <= 1:
            continue
        if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            continue
        rgb = np.array([int(color[i:i+2], 16) for i in (1, 3, 5)])
        start = _point(item.get("start"), width, height)
        end = _point(item.get("end"), width, height)
        if start is None or end is None:
            continue
        distance = float(np.linalg.norm(end-start))
        if distance < 20:
            continue
        ux, uy = (end-start)/distance
        along = (xx-start[0])*ux + (yy-start[1])*uy
        across = (yy-start[1])*ux - (xx-start[0])*uy
        radius = min(14, max(4, distance*.09))
        corridor = (along >= -radius) & (along <= distance+radius) & (abs(across) <= radius)
        surround = (along > distance*.15) & (along < distance*.75) & (abs(across)>radius+1) & (abs(across)<radius+8)
        if np.count_nonzero(surround) < 20:
            continue
        background = np.median(original[surround], axis=0)
        flat = np.max(abs(original-background), axis=2) < 22
        sides = [flat[surround & (across * sign > 0)] for sign in (1, -1)]
        # A neighboring vector or guide can occupy one side of a valid arrow.
        if np.mean(flat[surround]) < .65 or max(side.mean() if side.size else 0 for side in sides) < .72:
            continue
        delta = rgb - background
        if np.linalg.norm(delta) < 65:
            continue
        fraction = ((original-background) @ delta) / (delta @ delta)
        error = np.max(abs(original-background-fraction[...,None]*delta), axis=2)
        neutral = np.ptp(rgb) < 35
        chroma = np.ptp(original, axis=2)
        if neutral:
            mask = corridor & (fraction >= .48) & (error < 24) & (chroma < 30)
        else:
            mask = corridor & (fraction >= .08) & (error < 34) & (chroma >= 16)
        if np.count_nonzero(mask & used) > np.count_nonzero(mask) * .4:
            continue
        pixels = along[mask]
        if len(pixels) < distance*.45 or np.ptp(pixels) < distance*.81:
            continue
        bins = np.histogram(pixels, bins=10, range=(0, distance))[0]
        if np.count_nonzero(bins) < 9:
            continue
        # Clean the anti-aliased edge only near the confirmed stroke pixels.
        # Using the whole corridor would also erase nearby axes and labels.
        grown = np.asarray(Image.fromarray(mask).convert("L").filter(ImageFilter.MaxFilter(5))) > 0
        fringe = (fraction >= .035) & (error < 22)
        fringe &= (chroma < 17) if neutral else (chroma >= 5)
        mask |= grown & fringe & ~used
        width_px = min(8, max(1.5, np.count_nonzero(mask & (along>distance*.2) & (along<distance*.65))/(distance*.45)))

        def to_slide(point):
            return node["x"] + point[0]/width*node["width"], node["y"] + point[1]/height*node["height"]

        vector = _vector({
            **node, "id": f'{node["id"]}_arrow_{index}', "name": "识别的箭头",
            "asset_id": None, "source_element_id": None, "source_shape_id": None,
            "z": node["z"] + (index+1)/100,
        }, to_slide(start), to_slide(end), {
            "stroke": color, "stroke_width": width_px*node["width"]/width,
            "arrow_end": True,
        })
        if vector:
            replacements[vector["id"]] = (mask & ~used, background)
            used |= mask
            output.append(vector)
    if not output:
        return None
    basis = None
    # Verify both three-arrow groups before painting over any detected ink.
    # Short strokes detected in surrounding text must remain in the bitmap.
    for group in combinations(output, 6):
        basis = _basis_overlay(original, cleaned, group, node)
        if basis:
            output = list(group)
            break
    basis = basis or _general_basis_overlay(output, node)
    for vector in output:
        mask, background = replacements[vector["id"]]
        cleaned[mask] = background
    if basis:
        for vector in output:
            if vector["id"] == basis["secondId"]:
                vector["basis"] = basis
    blob = BytesIO()
    Image.fromarray(cleaned.astype(np.uint8)).save(blob, format="PNG", optimize=True)
    if blob.tell() > 2_000_000:
        return None
    return "data:image/png;base64," + base64.b64encode(blob.getvalue()).decode("ascii"), output


def _picture(shape):
    if shape.shape_type != MSO_SHAPE_TYPE.PICTURE or shape.rotation:
        return None
    if any((shape.crop_left, shape.crop_top, shape.crop_right, shape.crop_bottom)):
        return None
    if shape.width.pt < 95 or shape.height.pt < 65:
        return None
    with Image.open(BytesIO(shape.image.blob)) as original:
        if original.width < 100 or original.height < 65 or original.width*original.height > 12_000_000:
            return None
        if original.convert("RGBA").getchannel("A").getextrema() != (255,255):
            return None
        image = original.convert("RGB")
        image.thumbnail((960, 960))
    return image


def _collect_shapes(shapes):
    out = {}
    for shape in shapes:
        out[shape.shape_id] = shape
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.GROUP:
            out.update(_collect_shapes(getattr(shape, "shapes", [])))
    return out


def prepare_source_vectors(material_id, title, *, retry_groups=False):
    """Replace independently exported native groups and lines with editable objects."""
    from .capabilities import layer_editor_available
    from .importer import native_figure_scene, native_group_nodes
    from .layers import source_page_number
    from .pptx_export import _changed

    if not layer_editor_available()[0]:
        return
    ensure_document(material_id, title)
    document = read_document(material_id)
    source = document_root(material_id) / "source.pptx"
    if not document or not source.is_file():
        return
    deck = Presentation(source)
    for page in document["pages"]:
        source_no = source_page_number(page)
        if source_no is None or not 1 <= source_no <= len(deck.slides):
            continue
        previously_prepared = page.get("native_vectors") or (page.get("modified") and not page.get("math_recognition"))
        if previously_prepared and not retry_groups:
            continue
        slide = deck.slides[source_no - 1]
        shapes = _collect_shapes(slide.shapes)
        replacements = {}
        current_ids = {node["id"] for node in page["nodes"]}
        for node in page["nodes"]:
            shape = shapes.get(node.get("source_shape_id"))
            if shape is None:
                continue
            try:
                if node.get("whole_group"):
                    position = {key: node.get(f"base_{key}", node[key]) for key in ("x", "y")}
                    if _changed({**node, **position}):
                        continue
                    children = native_group_nodes(shape, node, asset_root=source.parent / "native" /
                                                  document["source_key"] / f"p{source_no:02d}")
                    if children and not any(child["id"] in current_ids for child in children):
                        for child in children:
                            for axis, source_position in position.items():
                                child[axis] += node[axis] - source_position
                        replacements[node["id"]] = children
                elif node["type"] == "shape" and not previously_prepared:
                    vector = native_vector(shape, node)
                    if vector:
                        replacements[node["id"]] = [{**vector, "figure_provenance": "native"}]
            except (AttributeError, ValueError, TypeError, OverflowError) as error:
                logger.info("Native figure kept as raster (%s)", type(error).__name__)
        if not replacements:
            continue
        prepare_page(material_id, page["page_no"])
        manifest = read_manifest(material_id, document["source_key"], source_no)
        if not manifest_ready(manifest):
            continue
        frozen = set(manifest.get("frozen_ids", []))
        replacements = {key: value for key, value in replacements.items()
                        if key not in frozen and key in manifest.get("objects", {})}
        if not replacements:
            continue
        with LOCK:
            current = read_document(material_id)
            if not current or current["source_key"] != document["source_key"]:
                return
            latest = next(p for p in current["pages"] if p["page_no"] == page["page_no"])
            if latest["nodes"] != page["nodes"]:
                continue
            nodes = [item for node in sorted(latest["nodes"], key=lambda n: n["z"])
                     for item in replacements.get(node["id"], [node])]
            for index, node in enumerate(nodes):
                node["z"] = index
            scenes = dict(latest.get("figure_scenes") or {})
            for identifier, children in replacements.items():
                scene = native_figure_scene(children, page)
                if scene:
                    scenes[identifier] = scene
            if scenes:
                latest["figure_scenes"] = scenes
            latest.update(nodes=nodes, modified=True, native_vectors=True, auto_vectors=True)
            current["revision"] += 1
            write_document(material_id, current)
