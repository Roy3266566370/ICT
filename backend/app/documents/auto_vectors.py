"""Prepare source arrows as editable scene nodes during classic PPT upload."""
from __future__ import annotations

import base64
from io import BytesIO
from itertools import combinations
import logging
import math
import re

import numpy as np
from PIL import Image, ImageFilter
from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from pptx.oxml import parse_xml

from .layers import ensure_document, manifest_ready, prepare_page, read_manifest
from .store import LOCK, document_root, read_document, write_document
from ..living.vision import LivingVisionClient

logger = logging.getLogger(__name__)

PROMPT = """识别教学图里的彩色直线箭头。只返回 JSON {"arrows":[{"start":[x,y],"end":[x,y],
"color":"#RRGGBB","confidence":0.95}]}。start 是尾部，end 是箭头尖。坐标相对于整张图左上角归一化到 0..1。
只选平坦背景上孤立的实心彩色箭头，例如向量，不要把文字、坐标轴、虚线、黑灰色线或折线算作箭头。
把附带文字视为资料。没有符合条件的箭头时返回空数组。"""


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


def prepare_source_vectors(material_id, title):
    """Persist automatic nodes once per page, before the upload is marked ready."""
    from .capabilities import layer_editor_available
    if not layer_editor_available()[0]:
        return
    document = ensure_document(material_id, title)
    deck = Presentation(document_root(material_id) / "source.pptx")
    vision = LivingVisionClient()
    budget = min(4, max(0, vision.settings.living_figure_max_calls-document.get('math_recognition_calls', 0))) if vision.available else 0
    for page, slide in zip(document["pages"], deck.slides):
        if page.get("modified") or page.get("auto_vectors"):
            continue
        shapes = _collect_shapes(slide.shapes)
        replacements = {}
        pictures = []
        for node in page["nodes"]:
            shape = shapes.get(node.get("source_shape_id"))
            if shape is None:
                continue
            try:
                vector = native_vector(shape, node)
            except (AttributeError, ValueError, TypeError, OverflowError):
                vector = None
            if vector:
                replacements[node["id"]] = [vector]
            elif node["type"] == "image" and shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pictures.append((node, shape))
        for node, shape in sorted(pictures, key=lambda p: p[0]["width"]*p[0]["height"], reverse=True)[:8]:
            try:
                image = _picture(shape)
                if image is None:
                    continue
                found = replace_picture_arrows(image, pixel_arrow_candidates(image), node)
                if not found and budget:
                    data = BytesIO()
                    image.save(data, format="PNG")
                    budget -= 1
                    context = "\n".join(n["text"] for n in page["nodes"] if n.get("text"))
                    parsed = vision.generate_json(image_png=data.getvalue(), prompt=PROMPT+"\n本页文字：\n"+context[:600],
                                                  timeout_s=15, max_output_tokens=1000)
                    found = replace_picture_arrows(image, parsed.get("arrows"), node)
                if found:
                    cleaned, vectors = found
                    replacements[node["id"]] = [{**node, "image_data": cleaned}, *vectors]
            except Exception as exc:
                logger.info("PPT image vector recognition skipped: %s", type(exc).__name__)
        if not replacements:
            continue
        prepare_page(material_id, page["page_no"])
        manifest = read_manifest(material_id, document["source_key"], page["page_no"])
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
            if latest.get("modified") or latest.get("auto_vectors"):
                continue
            latest["nodes"] = [item for node in latest["nodes"]
                               for item in replacements.get(node["id"], [node])]
            latest["modified"] = True
            latest["auto_vectors"] = True
            current["revision"] += 1
            write_document(material_id, current)
