"""把位图示意图还原成可操作的图形场景（"读图重建"，贴近原稿）。

只处理「坐标轴 + 单位方格的线性变换像」这一类图（线性代数课件中最常见的
"一个小方格怎样改变"画法）。处理流程全部是确定性图像算法，不调用大模型：

1. 颜色分割 + 轮廓：检测坐标轴（原点、水平/竖直轴的颜色、宽度、范围）；
2. 检测主形状：描边多边形或退化线段（凸包、描边色/线宽/填充色）；
3. OCR 文字标签：复用 :func:`app.ispec.image_text.recognize_image`（带缓存）；
4. 图下文字（caption）：匹配同左边界、顶部紧邻图底的文本形状，提取 run 样式；
5. 单位长度标定：优先页内「单位方格 / 面积 1」参考图，其次各图自己的面积声明；
6. 校验（不过不产出）：
   - 重投影重合度 IoU ≥ 0.9（用读出的矩阵重建，再与原图形状掩码比较）；
   - 面积声明 ±3%（共享单位时是真正的交叉检验）；
   - 「横向 x 倍、纵向 y 倍」声明 ±5%。

产出的 scene 挂在 ``spec['scene']['figure_scenes']``（``scene`` 在冻结 Schema
里是宽松对象），由前端按原图样式重画并接管拖动。识别失败的图不产出 scene，
前端保持原位图与既有交互，不伪造重建。
"""
from __future__ import annotations

import io
import logging
import re
from copy import deepcopy
from typing import Any, Callable, Mapping, Sequence

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

SCENE_VERSION = 1
#: 重投影重合度下限：低于它就说明"读出的矩阵"不能复现原图形状，不产出 scene。
IOU_MIN = 0.9
#: 面积声明容差（相对值，至少按 1 计）。
AREA_TOL = 0.03
#: 「横向/纵向倍数」声明容差。
SCALE_TOL = 0.05
#: 描边点数下限：太少说明颜色分割没找到主形状。
MIN_STROKE_PX = 200

#: 已验证课件的调色板，优先尝试；失败后退回主色自适应。
_AXIS_PALETTE = (120, 136, 160)
_STROKE_PALETTES = ((22, 35, 58), (196, 98, 45))

_AREA_RE = re.compile(r"面积\s*(?:是|为|仍是|仍为|:|：)?\s*(-?\d+(?:\.\d+)?)")
_SCALE_RE = re.compile(r"横向\s*(\d+(?:\.\d+)?)\s*倍[、,，\s]*纵向\s*(\d+(?:\.\d+)?)\s*倍")


def _near(rgb: np.ndarray, target: Sequence[float], tol: float) -> np.ndarray:
    return (np.abs(rgb - np.array(target)) <= tol).all(axis=-1)


def _group(indices: Any) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    start = prev = None
    for i in indices:
        if start is None:
            start = prev = int(i)
        elif int(i) == prev + 1:
            prev = int(i)
        else:
            groups.append((start, prev))
            start = prev = int(i)
    if start is not None:
        groups.append((start, prev))
    return groups


def _dominant_color(rgb: np.ndarray, alpha: np.ndarray, mask: np.ndarray) -> list[int] | None:
    """mask 内像素的主色（16 级量化取众数）；供坐标轴/描边颜色自适应。"""
    sel = mask & (alpha > 40)
    if sel.sum() < 40:
        return None
    pixels = rgb[sel]
    quantized = (pixels // 16) * 16
    keys, counts = np.unique(quantized.reshape(-1, 3), axis=0, return_counts=True)
    return [int(c) for c in keys[int(np.argmax(counts))]]


def detect_axes(rgba: np.ndarray, shape_mask: np.ndarray) -> tuple[dict[str, Any], np.ndarray] | None:
    """检测水平/竖直坐标轴：取可见像素最多的行组/列组（允许被形状遮一段）。"""
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    axis = (alpha > 40) & _near(rgb, _AXIS_PALETTE, 40) & ~shape_mask

    def pick(mask: np.ndarray) -> tuple[dict[str, Any], np.ndarray] | None:
        row_sum, col_sum = mask.sum(axis=1), mask.sum(axis=0)
        hy, vx = _group(np.where(row_sum >= 20)[0]), _group(np.where(col_sum >= 20)[0])
        if not hy or not vx:
            return None
        (y0, y1) = max(hy, key=lambda g: row_sum[g[0]:g[1] + 1].max())
        (x0, x1) = max(vx, key=lambda g: col_sum[g[0]:g[1] + 1].max())
        yc, xc = (y0 + y1) / 2, (x0 + x1) / 2
        line_mask = np.zeros_like(mask)
        line_mask[y0:y1 + 1, :] = mask[y0:y1 + 1, :]
        line_mask[:, x0:x1 + 1] |= mask[:, x0:x1 + 1]
        hmask = mask[y0:y1 + 1, :].any(axis=0)
        vmask = mask[:, x0:x1 + 1].any(axis=1)
        hx, vy = np.where(hmask)[0], np.where(vmask)[0]
        return {
            "origin": [float(xc), float(yc)],
            "h": {"y": float(yc), "x0": int(hx.min()), "x1": int(hx.max()), "width": int(y1 - y0 + 1)},
            "v": {"x": float(xc), "y0": int(vy.min()), "y1": int(vy.max()), "width": int(x1 - x0 + 1)},
            "color": [int(c) for c in np.median(rgb[mask], axis=0)],
            "alpha": int(np.median(alpha[mask])),
        }, line_mask

    picked = pick(axis)
    if picked is None:
        # 灰度轴自适应：非形状像素里取低饱和主色再试一次（其他课件的轴颜色不同）。
        mx = rgb.max(axis=-1)
        mn = rgb.min(axis=-1)
        grayish = (mx - mn <= 40) & (mn >= 60) & (mx <= 220)
        color = _dominant_color(rgb, alpha, grayish & ~shape_mask)
        if color is not None:
            picked = pick((alpha > 40) & _near(rgb, color, 36) & ~shape_mask)
    return picked


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    import cv2

    inv = (~mask).astype(np.uint8) * 255
    h, w = mask.shape
    flood = inv.copy()
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 0)
    return mask | (flood > 0)


def _offset_polygon(pts: np.ndarray, d: float) -> np.ndarray:
    """凸多边形每条边向外平移 d 像素：掩码边界比真实边缘靠内约 0.5px。"""
    n = len(pts)
    area = 0.5 * float(np.dot(pts[:, 0], np.roll(pts[:, 1], -1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], -1)))
    sign = 1.0 if area > 0 else -1.0
    lines = []
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        t = q - p
        t = t / np.linalg.norm(t)
        lines.append((p + np.array([t[1], -t[0]]) * sign * d, t))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        m = np.array([t1, -t2]).T
        if abs(np.linalg.det(m)) < 1e-9:
            out.append(p2)
            continue
        k = np.linalg.solve(m, p2 - p1)
        out.append(p1 + t1 * k[0])
    return np.array(out)


def detect_shape(rgba: np.ndarray) -> tuple[dict[str, Any], np.ndarray, np.ndarray] | None:
    """检测主形状描边：返回 ``(info, 填充掩码, 描边掩码)``；找不到返回 ``None``。"""
    import cv2

    rgb, alpha = rgba[..., :3], rgba[..., 3]
    stroke = None
    for palette in _STROKE_PALETTES:
        candidate = (alpha >= 128) & _near(rgb, palette, 45)
        if stroke is None or candidate.sum() > stroke.sum():
            stroke = candidate
    if stroke is None or int(stroke.sum()) < MIN_STROKE_PX:
        # 主色自适应：饱和度高、不透明的像素取众数颜色。
        mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
        saturated = (alpha >= 128) & (mx - mn >= 48)
        color = _dominant_color(rgb, alpha, saturated)
        if color is not None:
            stroke = (alpha >= 128) & _near(rgb, color, 48)
    if stroke is None or int(stroke.sum()) < MIN_STROKE_PX:
        return None
    stroke = cv2.morphologyEx(stroke.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    if int(stroke.sum()) < MIN_STROKE_PX:
        return None
    color = [int(c) for c in np.median(rgb[stroke], axis=0)]
    dt = cv2.distanceTransform(stroke.astype(np.uint8), cv2.DIST_L2, 5)
    half = float(np.percentile(dt[stroke], 98))
    width = 2 * half
    # 描边可能被文字标签压住一段（页内「高不变」就盖住了平行四边形的一条边）；
    # 单位方格在线性变换下的像一定是凸的，直接取描边点凸包作外形。
    ys0, xs0 = np.where(stroke)
    hull = cv2.convexHull(np.stack([xs0, ys0], 1).astype(np.int32))
    filled_u8 = np.zeros(stroke.shape, np.uint8)
    cv2.fillConvexPoly(filled_u8, hull, 1)
    filled = filled_u8.astype(bool)
    r = int(round(half))
    eroded = cv2.erode(
        filled.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)),
    ).astype(bool)
    info: dict[str, Any] = {"stroke_color": color, "stroke_width": float(width)}
    if eroded.sum() < 30:
        ys, xs = np.where(stroke)
        if xs.max() - xs.min() >= ys.max() - ys.min():
            yc = float(ys.mean())
            p0, p1 = [float(xs.min()), yc], [float(xs.max()) + 1.0, yc]
            thick = float(ys.max() - ys.min() + 1)
        else:
            xc = float(xs.mean())
            p0, p1 = [xc, float(ys.min())], [xc, float(ys.max()) + 1.0]
            thick = float(xs.max() - xs.min() + 1)
        info.update(kind="segment", vertices=[p0, p1], thickness=thick, fill=None)
        return info, filled, stroke
    cnts, _ = cv2.findContours(eroded.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnt = max(cnts, key=cv2.contourArea)
    peri = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True).reshape(-1, 2)
    inner = eroded & (~stroke)
    inner = cv2.erode(inner.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    fill_rgba = None
    if inner.sum() > 50:
        a = float(np.median(alpha[inner])) / 255
        fill_rgba = [int(c) for c in np.median(rgb[inner], axis=0)] + [round(a, 3)]
    info.update(kind="polygon", vertices=_offset_polygon(approx.astype(float), 0.5).tolist(), fill=fill_rgba)
    return info, filled, stroke


def detect_dashed(
    rgba: np.ndarray,
    axes: Mapping[str, Any],
    axis_mask: np.ndarray,
    ocr_boxes: Sequence[tuple[int, int, int, int]],
    shape_mask: np.ndarray,
) -> dict[str, Any] | None:
    """检测垂直辅助虚线（例如剪切图里标注「高」的那条）。"""
    import cv2

    rgb, alpha = rgba[..., :3], rgba[..., 3]
    m = (alpha > 80) & _near(rgb, axes["color"], 40) & ~shape_mask
    m &= ~cv2.dilate(axis_mask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    for (x0, y0, x1, y1) in ocr_boxes:
        m[max(0, y0 - 4):y1 + 4, max(0, x0 - 4):x1 + 4] = False
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    segs = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area >= 12 and (h >= 2.2 * w or w >= 2.2 * h):
            segs.append((x, y, w, h))
    if len(segs) < 3:
        return None
    vertical = sum(1 for s in segs if s[3] > s[2]) >= len(segs) / 2
    if not vertical:
        return None
    xs = [s[0] + s[2] / 2 for s in segs]
    ys = sorted((s[1], s[1] + s[3]) for s in segs)
    dash = float(np.median([b - a for a, b in ys]))
    gaps = [ys[i + 1][0] - ys[i][1] for i in range(len(ys) - 1)]
    return {"orientation": "v", "x": float(np.median(xs)), "y0": int(ys[0][0]), "y1": int(ys[-1][1]),
            "dash": dash, "gap": float(np.median(gaps)) if gaps else dash,
            "width": float(np.median([s[2] for s in segs])),
            "color": [int(c) for c in np.median(rgb[m], axis=0)],
            "alpha": int(np.median(alpha[m]))}


def polygon_area(vertices: Sequence[Sequence[float]]) -> float:
    v = np.array(vertices)
    x, y = v[:, 0], v[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _labels_from_ocr(
    rgba: np.ndarray,
    ocr_rows: Sequence[Mapping[str, Any]],
    ocr_scale: float,
    axis_color: Sequence[int],
    stroke_color: Sequence[int],
) -> tuple[list[dict[str, Any]], list[tuple[int, int, int, int]]]:
    """OCR 文本框 → 图内标签（文字、位置、颜色、字高）。"""
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    labels: list[dict[str, Any]] = []
    boxes: list[tuple[int, int, int, int]] = []
    for row in ocr_rows:
        box = row.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue
        xs = [float(p[0]) / ocr_scale for p in box]
        ys = [float(p[1]) / ocr_scale for p in box]
        bx = (int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys)))
        sel = (alpha[bx[1]:bx[3], bx[0]:bx[2]] > 60) & _near(
            rgb[bx[1]:bx[3], bx[0]:bx[2]], axis_color, 40)
        if sel.any():
            col = [int(c) for c in np.median(rgb[bx[1]:bx[3], bx[0]:bx[2], :3][sel], axis=0)]
        else:
            sel2 = (alpha[bx[1]:bx[3], bx[0]:bx[2]] > 60) & _near(
                rgb[bx[1]:bx[3], bx[0]:bx[2]], stroke_color, 48)
            col = ([int(c) for c in np.median(rgb[bx[1]:bx[3], bx[0]:bx[2], :3][sel2], axis=0)]
                   if sel2.any() else [int(c) for c in stroke_color])
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        labels.append({"text": text, "score": float(row.get("score") or 0), "box": list(bx),
                       "color": col, "height": int(bx[3] - bx[1])})
        boxes.append(bx)
    return labels, boxes


def _claim_area(caption_text: str) -> float | None:
    m = _AREA_RE.search(caption_text)
    return float(m.group(1)) if m else None


def _claim_scale(caption_text: str) -> tuple[float, float] | None:
    m = _SCALE_RE.search(caption_text)
    return (float(m.group(1)), float(m.group(2))) if m else None


def _caption_template(text: str) -> str:
    if "单位方格" in text:
        return "unit"
    if "横向" in text:
        return "scale"
    if "剪切" in text:
        return "shear"
    if "压到横轴" in text or "压扁" in text or "归零" in text:
        return "collapse"
    return "generic"


def _snap(value: float) -> float:
    s = round(value * 4) / 4
    return s if abs(value * 4 - round(value * 4)) < 0.12 else value


def _analyze_picture(
    blob: bytes,
    ocr_lookup: Callable[[bytes], Mapping[str, Any]],
) -> dict[str, Any] | None:
    """单张位图 → 未标定的图形结构（axes/shape/labels/dashed）；失败返回 ``None``。"""
    try:
        rgba = np.array(Image.open(io.BytesIO(blob)).convert("RGBA")).astype(int)
    except Exception:
        return None
    detected = detect_shape(rgba)
    if detected is None:
        return None
    shape_info, filled, stroke_mask = detected
    picked = detect_axes(rgba, stroke_mask)
    if picked is None:
        return None
    axes, axis_mask = picked
    ocr = ocr_lookup(blob) or {}
    # recognize_image 内部把图缩到 ≤1600；坐标按比例换回原图。
    h, w = rgba.shape[:2]
    ocr_scale = min(1.0, 1600.0 / max(w, h))
    labels, boxes = _labels_from_ocr(
        rgba, ocr.get("rows") or [], ocr_scale, axes["color"], shape_info["stroke_color"])
    dashed = detect_dashed(rgba, axes, axis_mask, boxes, stroke_mask)
    return {
        "image_px": [int(w), int(h)],
        "axes": axes,
        "axis_mask": axis_mask,
        "shape": shape_info,
        "filled": filled,
        "labels": labels,
        "dashed": dashed,
    }


def _infer_matrix(figure: dict[str, Any], unit: float) -> dict[str, Any]:
    """由形状顶点推 M 的两列：离原点最近的顶点是像原点，两侧邻边即 e1/e2。"""
    ox, oy = figure["axes"]["origin"]
    shp = figure["shape"]
    pts = [[(x - ox) / unit, (oy - y) / unit] for x, y in shp["vertices"]]
    shp["vertices_units"] = pts
    o_idx = int(np.argmin([np.hypot(*p) for p in pts]))
    if shp["kind"] == "polygon":
        n = len(pts)
        nb = [pts[(o_idx + 1) % n], pts[(o_idx - 1) % n]]
        nb.sort(key=lambda p: (np.arctan2(p[1], p[0]) + np.pi / 4) % (2 * np.pi))
        e1, e2 = nb
        inferred = False
    else:
        e1, e2 = pts[1 - o_idx], [0.0, 0.0]
        inferred = any("归零" in lab["text"] for lab in figure["labels"])
    return {"a": e1[0], "c": e1[1], "b": e2[0], "d": e2[1], "e2_inferred": inferred}


def _reproject_iou(figure: dict[str, Any], matrix: Mapping[str, float], unit: float) -> float:
    """用识别矩阵重建形状，与原图填充掩码算 IoU。"""
    import cv2

    ox, oy = figure["axes"]["origin"]
    shp = figure["shape"]
    m = matrix
    corners = [(0, 0), (1, 0), (1, 1), (0, 1)]
    poly = [[ox + unit * (m["a"] * x + m["b"] * y), oy - unit * (m["c"] * x + m["d"] * y)]
            for x, y in corners]
    recon = np.zeros(figure["filled"].shape, np.uint8)
    if shp["kind"] == "polygon":
        cv2.fillPoly(recon, [np.round(np.array(poly)).astype(np.int32)], 1)
        r = int(round(shp["stroke_width"] / 2))
        recon = cv2.dilate(recon, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    else:
        (px0, py0), (px1, _) = poly[0], poly[1]
        half_t = shp.get("thickness", 8) / 2
        recon[int(round(py0 - half_t)):int(round(py0 + half_t)),
              int(round(min(px0, px1))):int(round(max(px0, px1)))] = 1
    recon = recon.astype(bool)
    orig = figure["filled"]
    return float((recon & orig).sum() / max(1, (recon | orig).sum()))


def _label_anchor(shape_kind: str) -> str:
    return "e2_mid" if shape_kind == "polygon" else "e1_top"


def _finalize_scene(
    *,
    page_no: int,
    element_id: str,
    bbox_emu: Mapping[str, Any],
    figure: dict[str, Any],
    caption: Mapping[str, Any] | None,
    unit: float,
    calibration: str,
    checks: list[dict[str, Any]],
) -> dict[str, Any]:
    m = figure["matrix"]
    snapped = {k: _snap(float(v)) if isinstance(v, float) else v
               for k, v in m.items() if k in ("a", "b", "c", "d")}
    caption_info = None
    if caption is not None:
        runs = caption.get("runs") or []
        accent = next((r.get("color") for r in runs if re.search(r"\d", r.get("text") or "")),
                      None)
        caption_info = {
            "element_id": caption.get("element_id"),
            "bbox_emu": caption.get("bbox_emu"),
            "text": caption.get("text") or "",
            "runs": runs,
            "align": caption.get("align"),
            "template": _caption_template(caption.get("text") or ""),
            "accent": accent,
        }
    return {
        "v": SCENE_VERSION,
        "page": page_no,
        "element_id": element_id,
        "bbox_emu": {k: float(bbox_emu[k]) for k in ("x", "y", "w", "h")},
        "image_px": figure["image_px"],
        "origin": [float(v) for v in figure["axes"]["origin"]],
        "unit_px": float(unit),
        "calibration": calibration,
        "axes": {k: figure["axes"][k] for k in ("h", "v", "color", "alpha")},
        "shape": {k: figure["shape"][k] for k in
                  ("kind", "vertices", "stroke_color", "stroke_width", "fill", "thickness")
                  if k in figure["shape"]},
        "labels": [
            {**lab, "binding": "height_d" if "高" in lab["text"] else "static",
             "anchor": _label_anchor(figure["shape"]["kind"]) if "高" in lab["text"] else "static"}
            for lab in figure["labels"]
        ],
        "dashed": figure["dashed"],
        "caption": caption_info,
        "matrix": {k: float(m[k]) for k in ("a", "b", "c", "d")} | {"e2_inferred": bool(m["e2_inferred"])},
        "baseline": [float(snapped["a"]), float(snapped["b"]), float(snapped["c"]), float(snapped["d"])],
        "checks": checks,
        "confidence": "high" if calibration == "shared" else "medium",
    }


def recognize_slide_scenes(
    page_no: int,
    pictures: Sequence[Mapping[str, Any]],
    *,
    ocr_lookup: Callable[[bytes], Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """识别一页内所有候选位图；返回 ``element_id → scene``（只含校验通过的图）。

    :param pictures: ``{"element_id", "bbox"（EMU）, "blob", "caption"?}`` 列表；
        ``caption`` 为 ``{"element_id", "bbox_emu", "text", "runs", "align"}``。
    :param ocr_lookup: ``recognize_image`` 或等价函数（应自带缓存）。
    """
    figures: list[dict[str, Any]] = []
    for pic in pictures:
        blob = pic.get("blob")
        if not isinstance(blob, (bytes, bytearray)) or not blob:
            continue
        analyzed = _analyze_picture(bytes(blob), ocr_lookup)
        if analyzed is None:
            continue
        caption = pic.get("caption")
        caption_text = str(caption.get("text") or "") if isinstance(caption, Mapping) else ""
        figures.append({
            "element_id": pic["element_id"],
            "bbox_emu": pic["bbox"],
            "caption": caption if isinstance(caption, Mapping) else None,
            "claim_area": _claim_area(caption_text),
            "claim_scale": _claim_scale(caption_text),
            **analyzed,
        })
    if not figures:
        return {}

    # 单位长度标定：优先「单位方格 / 面积 1」参考图，否则按各图自己的面积声明。
    ref = next(
        (f for f in figures
         if f["caption"] and "单位方格" in str(f["caption"].get("text") or "")),
        None,
    ) or next((f for f in figures if f["claim_area"] == 1.0), None)
    shared_unit = None
    if ref is not None:
        shared_unit = float(np.sqrt(abs(polygon_area(ref["shape"]["vertices"]))))
    scenes: dict[str, dict[str, Any]] = {}
    for f in figures:
        if shared_unit:
            unit, calibration = shared_unit, "shared"
        elif f["claim_area"]:
            unit = float(np.sqrt(abs(polygon_area(f["shape"]["vertices"])) / f["claim_area"]))
            calibration = "self"
        else:
            continue  # 无法标定：宁可不产出，也不给出没有来源的数字
        f["matrix"] = _infer_matrix(f, unit)
        m = f["matrix"]
        det = m["a"] * m["d"] - m["b"] * m["c"]
        checks: list[dict[str, Any]] = [
            {"id": "reproject_iou", "title": "用识别结果重建后与原图形状重合度",
             "expected": f">= {IOU_MIN}", "actual": round(_reproject_iou(f, m, unit), 4),
             "pass": _reproject_iou(f, m, unit) >= IOU_MIN},
        ]
        if f["claim_area"] is not None:
            checks.append({
                "id": "area_claim", "title": "图中面积 = 页面文字声明",
                "expected": f["claim_area"], "actual": round(abs(det), 3),
                "pass": abs(abs(det) - f["claim_area"]) <= AREA_TOL * max(1.0, f["claim_area"]),
            })
        if f["claim_scale"] is not None:
            sx, sy = f["claim_scale"]
            checks.append({
                "id": "scale_claim", "title": "横向/纵向倍数声明",
                "expected": [sx, sy], "actual": [round(m["a"], 3), round(m["d"], 3)],
                "pass": abs(m["a"] - sx) <= SCALE_TOL * sx and abs(m["d"] - sy) <= SCALE_TOL * sy,
            })
        if not all(c["pass"] for c in checks):
            continue
        scenes[f["element_id"]] = _finalize_scene(
            page_no=page_no, element_id=f["element_id"], bbox_emu=f["bbox_emu"],
            figure=f, caption=f["caption"], unit=unit, calibration=calibration, checks=checks)
    return scenes


# ---------------------------------------------------------------------------
# 把读出的场景绑定到 iSpec 参数（读时挂载，见 documents.presentation）
# ---------------------------------------------------------------------------

_CELL_RE = re.compile(r"^cells_(\d+)_matrix_([01])_([01])$")


def _norm_text(text: str) -> str:
    return re.sub(r"[\s　]+", "", text or "")


def _scene_caption_key(scene: Mapping[str, Any]) -> str:
    caption = scene.get("caption")
    return _norm_text(str(caption.get("text") or "")) if isinstance(caption, Mapping) else ""


def _common_prefix_len(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def _bind_cells(spec: Mapping[str, Any], scenes: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]] | None:
    """cells_i_matrix_rc 参数 ↔ 场景：按图下文字与格标签匹配。"""
    ids = {p.get("id") for p in spec.get("parameters", []) if isinstance(p, Mapping)}
    label_defaults = {
        p.get("id"): str(p.get("default") or "")
        for p in spec.get("parameters", []) if isinstance(p, Mapping)
    }
    cells: dict[int, dict[str, str]] = {}
    for pid in ids:
        m = _CELL_RE.match(str(pid))
        if not m:
            continue
        index, row, col = int(m.group(1)), int(m.group(2)), int(m.group(3))
        cells.setdefault(index, {})[f"m{row}{col}"] = str(pid)
    cells = {index: keys for index, keys in cells.items()
             if {"m00", "m01", "m10", "m11"}.issubset(keys)}
    if not cells:
        return None
    # 逐格找最优场景：标签与图下文字的最长公共前缀 ≥2 字才算命中。
    assigned: dict[int, Mapping[str, Any]] = {}
    used: set[str] = set()
    for index in sorted(cells):
        label = _norm_text(label_defaults.get(f"cells_{index}_label", ""))
        best, best_score = None, 0
        for scene in scenes:
            if scene["element_id"] in used:
                continue
            score = _common_prefix_len(label, _scene_caption_key(scene))
            if score > best_score:
                best, best_score = scene, score
        if best is None or best_score < 2:
            continue
        used.add(best["element_id"])
        assigned[index] = best
    if not assigned:
        return None
    binds = []
    for index, scene in assigned.items():
        keys = cells[index]
        binds.append({
            "scene": scene,
            "bind": {
                "a": keys["m00"], "b": keys["m01"], "c": keys["m10"], "d": keys["m11"],
                **({"label": f"cells_{index}_label"} if f"cells_{index}_label" in ids else {}),
            },
        })
    return binds


def _bind_simple(spec: Mapping[str, Any], scenes: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]] | None:
    """a/b/c/d 参数 ↔ 单场景：场景元素即锚点元素，或落在锚点框内。"""
    ids = {p.get("id") for p in spec.get("parameters", []) if isinstance(p, Mapping)}
    if not {"a", "b", "c", "d"}.issubset(ids):
        return None
    anchor = spec.get("anchor") if isinstance(spec.get("anchor"), Mapping) else None
    anchor_el = anchor.get("element_id") if anchor else None
    scene = next((s for s in scenes if s["element_id"] == anchor_el), None)
    if scene is None and isinstance(anchor, Mapping) and isinstance(anchor.get("bbox"), Mapping):
        box = anchor["bbox"]
        cx, cy = box.get("x", 0) + box.get("w", 0) / 2, box.get("y", 0) + box.get("h", 0) / 2
        scene = next(
            (s for s in scenes
             if s["bbox_emu"]["x"] - 1 <= cx <= s["bbox_emu"]["x"] + s["bbox_emu"]["w"] + 1
             and s["bbox_emu"]["y"] - 1 <= cy <= s["bbox_emu"]["y"] + s["bbox_emu"]["h"] + 1),
            None,
        )
        if scene is None:
            scene = max(
                (s for s in scenes
                 if s["bbox_emu"]["x"] < box.get("x", 0) + box.get("w", 0)
                 and s["bbox_emu"]["x"] + s["bbox_emu"]["w"] > box.get("x", 0)
                 and s["bbox_emu"]["y"] < box.get("y", 0) + box.get("h", 0)
                 and s["bbox_emu"]["y"] + s["bbox_emu"]["h"] > box.get("y", 0)),
                key=lambda s: s["bbox_emu"]["w"] * s["bbox_emu"]["h"],
                default=None,
            )
    if scene is None:
        return None
    return [{"scene": scene, "bind": {"a": "a", "b": "b", "c": "c", "d": "d"}}]


def _sync_baseline(param: dict[str, Any], value: float) -> None:
    """把被绑定参数的"原稿基准"改成读图值；已保存的用户值（default）不动。"""
    if "source_default" in param:
        param["source_default"] = value
    else:
        param["default"] = value
        param["source_default"] = value
    if isinstance(param.get("min"), (int, float)) and param["min"] > value:
        param["min"] = value
    if isinstance(param.get("max"), (int, float)) and param["max"] < value:
        param["max"] = value


def attach_figure_scenes(
    specs: list[dict[str, Any]],
    scenes_by_element: Mapping[str, Any],
    project: Callable[[dict[str, Any]], dict[str, Any] | None],
) -> int:
    """把识别场景挂到 ``spec['scene']['figure_scenes']``，返回挂载的场景数。

    - 场景来自 ``payload['figure_scenes']``（element_id → scene），只在校验
      通过时才会存在，这里原样透传；
    - ``project`` 是 documents.presentation 里的锚点投影：元素被自由编辑移动/
      删除时，场景跟随或撤销；
    - 被绑参数的 ``source_default``（原稿基准）改成读图值；用户已保存的值不动。
    """
    if not scenes_by_element:
        return 0
    attached_total = 0
    for spec in specs:
        if not isinstance(spec, dict):
            continue
        page_no = (spec.get("anchor") or {}).get("page")
        if not isinstance(page_no, int):
            pages = {p.get("source", {}).get("page") for p in spec.get("parameters", [])
                     if isinstance(p, Mapping)}
            page_no = pages.pop() if len(pages) == 1 else None
        if page_no is None:
            continue
        page_scenes = [s for s in scenes_by_element.values()
                       if isinstance(s, Mapping) and s.get("page") == page_no]
        if not page_scenes:
            continue
        binds = _bind_cells(spec, page_scenes) or _bind_simple(spec, page_scenes)
        if not binds:
            continue
        params_by_id = {p.get("id"): p for p in spec.get("parameters", []) if isinstance(p, Mapping)}
        attached = []
        for item in binds:
            scene = deepcopy(item["scene"])
            src = project({"page": page_no, "element_id": scene["element_id"],
                           "bbox": scene["bbox_emu"], "status": "original", "excerpt": ""})
            if src is None:
                continue  # 元素在自由编辑中被删/隐藏：场景撤销，不挂到挪走的位置
            scene["bbox_emu"] = src["bbox"]
            caption = scene.get("caption")
            if isinstance(caption, dict) and caption.get("element_id"):
                cap = project({"page": page_no, "element_id": caption["element_id"],
                               "bbox": caption["bbox_emu"], "status": "original", "excerpt": ""})
                if cap is None:
                    scene["caption"] = None
                else:
                    caption["bbox_emu"] = cap["bbox"]
            bind = item["bind"]
            bound_params = [params_by_id.get(bind[key]) for key in ("a", "b", "c", "d")]
            if any(param is None for param in bound_params):
                continue
            baseline = scene["baseline"]
            for key, param in zip(("a", "b", "c", "d"), bound_params):
                _sync_baseline(param, baseline[{"a": 0, "b": 1, "c": 2, "d": 3}[key]])
            scene["bind"] = bind
            attached.append(scene)
        if not attached:
            continue
        scene_def = spec.get("scene")
        if not isinstance(scene_def, dict):
            scene_def = {"scene_type": "figure_lab", "version": "1.0",
                         "title": spec.get("title") or "交互实验"}
            spec["scene"] = scene_def
        scene_def["figure_scenes"] = attached
        attached_total += len(attached)
    return attached_total
