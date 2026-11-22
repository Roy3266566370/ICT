"""Conservative pixel measurements for flat, filled ellipse diagrams.

Coordinates and radii are pixels, never inferred mathematical units. Angles
are counterclockwise in mathematical (y-up) coordinates, modulo 180 degrees.
"""
from __future__ import annotations

import io
import math

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError


def ellipse_geometry(image_png: bytes) -> dict | None:
    """Return a verified dominant filled ellipse, or None for other imagery."""
    try:
        with Image.open(io.BytesIO(image_png)) as source:
            if source.width * source.height > 12_000_000:
                return None
            rgba = source.convert('RGBA')
            original_rgb = np.asarray(rgba)[..., :3]
            background = Image.new('RGBA', rgba.size, 'white')
            rgb = np.asarray(Image.alpha_composite(background, rgba).convert('RGB'))
    except (UnidentifiedImageError, OSError, ValueError):
        return None
    height, width = rgb.shape[:2]
    if min(height, width) < 20:
        return None
    # Flat diagram fills recur exactly; quantization also admits antialiasing.
    quantized = (rgb // 8).astype(np.int32)
    keys = quantized[..., 0] * 1024 + quantized[..., 1] * 32 + quantized[..., 2]
    counts = np.bincount(keys.ravel(), minlength=32768)
    candidates = []
    for key in np.argsort(counts)[-12:][::-1]:
        if counts[key] < max(80, width * height * .003):
            continue
        pixels = rgb[keys == key]
        color = np.median(pixels, axis=0)
        if color.min() > 252:
            continue
        tolerance = min(20, max(3, float(np.max(255 - color)) * .35))
        mask = (np.max(np.abs(rgb.astype(np.float32) - color), axis=2) < tolerance).astype(np.uint8)
        # Bridge thin coordinate axes crossing an otherwise contiguous fill.
        kernel_size = max(3, int(min(width, height) * .014) | 1)
        closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((kernel_size, kernel_size), np.uint8))
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if len(contour) < 20 or area < max(100, width * height * .008):
                continue
            (cx, cy), (d1, d2), degrees = cv2.fitEllipse(contour)
            if min(d1, d2) < 12 or max(d1, d2) / min(d1, d2) > 12:
                continue
            theta = math.radians(degrees)
            points = contour[:, 0, :] - [cx, cy]
            u = points[:, 0] * math.cos(theta) + points[:, 1] * math.sin(theta)
            v = -points[:, 0] * math.sin(theta) + points[:, 1] * math.cos(theta)
            radial_error = np.abs(np.sqrt((2 * u / d1) ** 2 + (2 * v / d2) ** 2) - 1)
            residual = float(np.quantile(radial_error, .9))
            ellipse_area = math.pi * d1 * d2 / 4
            area_agreement = min(area, ellipse_area) / max(area, ellipse_area)
            component = np.zeros_like(mask)
            cv2.drawContours(component, [contour], -1, 1, -1)
            fill_fraction = float(mask[component != 0].mean())
            if residual > .065 or area_agreement < .93 or fill_fraction < .82:
                continue
            major, minor = max(d1, d2) / 2, min(d1, d2) / 2
            angle = (-(degrees if d1 >= d2 else degrees + 90)) % 180
            if major / minor < 1.025:
                angle = 0.0
            elif angle > 175:
                angle -= 180
            pigment = np.median(original_rgb[(component != 0) & (mask != 0)], axis=0)
            candidates.append((area, {
                'center': [float(cx), float(cy)],
                'axes': [float(major), float(minor)],
                'angle': float(angle),
                'color': '#' + ''.join(f'{int(value):02X}' for value in pigment),
                'confidence': float(min(area_agreement, fill_fraction, 1 - residual)),
                'boundary_residual': residual,
                'fill_fraction': fill_fraction,
                'image_size': [width, height],
            }))
    if not candidates:
        return None
    result = max(candidates, key=lambda item: item[0])[1]
    result['marker'] = _ellipse_marker(np.asarray(rgba), result)
    return result


def filled_polygons(image_png: bytes) -> list[dict]:
    """Measure flat filled parallelograms; points use image (y-down) pixels."""
    try:
        with Image.open(io.BytesIO(image_png)) as source:
            if source.width * source.height > 12_000_000:
                return []
            rgba = np.asarray(source.convert('RGBA'))
    except (UnidentifiedImageError, OSError, ValueError):
        return []
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    height, width = alpha.shape
    visible = (alpha > 0) & (rgb.min(axis=2) < 245)
    quantized = (rgb // 8).astype(np.int32)
    keys = quantized[..., 0] * 1024 + quantized[..., 1] * 32 + quantized[..., 2]
    counts = np.bincount(keys[visible], minlength=32768)
    results = []
    for key in np.argsort(counts)[-12:][::-1]:
        if counts[key] < max(100, width * height * .003):
            continue
        color = np.median(rgb[(keys == key) & visible], axis=0)
        mask = ((np.max(np.abs(rgb.astype(np.float32) - color), axis=2) < 14) & visible).astype(np.uint8)
        kernel_size = max(3, int(min(width, height) * .012) | 1)
        closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((kernel_size, kernel_size), np.uint8))
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < max(100, width * height * .003):
                continue
            hull = cv2.convexHull(contour)
            polygon = cv2.approxPolyDP(hull, .015 * cv2.arcLength(hull, True), True)
            if len(polygon) != 4:
                continue
            points = polygon[:, 0, :].astype(np.float64)
            if np.min(np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)) < 15:
                continue
            # Opposite-edge midpoints must agree for a parallelogram.
            diagonal_error = np.linalg.norm((points[0] + points[2]) - (points[1] + points[3]))
            if diagonal_error > .06 * np.max(np.linalg.norm(points - points.mean(axis=0), axis=1)):
                continue
            area = abs(cv2.contourArea(polygon))
            agreement = min(area, cv2.contourArea(hull)) / max(area, cv2.contourArea(hull))
            region = np.zeros_like(mask)
            cv2.fillPoly(region, [polygon], 1)
            fill = float(mask[region != 0].mean())
            if agreement < .95 or fill < .75:
                continue
            center = points.mean(axis=0)
            if any(np.linalg.norm(center - np.mean(r['points'], axis=0)) < 5 for r in results):
                continue
            pigment = np.median(rgb[(region != 0) & (mask != 0)], axis=0)
            results.append({
                'points': points.tolist(),
                'color': '#' + ''.join(f'{int(v):02X}' for v in pigment),
                'area': float(area),
                'confidence': float(min(agreement, fill)),
                'fill_fraction': fill,
                'image_size': [width, height],
            })
    return sorted(results, key=lambda r: min(p[0] for p in r['points']))



def _ellipse_marker(rgba: np.ndarray, geometry: dict) -> list[float] | None:
    """Find a uniquely round opaque pigment dot near the fitted boundary."""
    rgb = rgba[..., :3]
    opaque = (rgba[..., 3] >= 220) & (np.ptp(rgb, axis=2) >= 30)
    quantized = (rgb // 8).astype(np.int32)
    keys = quantized[..., 0] * 1024 + quantized[..., 1] * 32 + quantized[..., 2]
    counts = np.bincount(keys[opaque], minlength=32768)
    major, minor = geometry['axes']
    theta = math.radians(geometry['angle'])
    radius = max(3, min(8, round(minor * .065)))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    markers = []
    for key in np.argsort(counts)[-12:][::-1]:
        if counts[key] < 20:
            continue
        color = np.median(rgb[(keys == key) & opaque], axis=0)
        mask = ((np.max(np.abs(rgb.astype(np.float32) - color), axis=2) < 18) & opaque).astype(np.uint8)
        opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for contour in contours:
            area = cv2.contourArea(contour)
            perimeter = cv2.arcLength(contour, True)
            if area < 20 or area > math.pi * (minor * .22) ** 2 or perimeter == 0:
                continue
            if 4 * math.pi * area / perimeter ** 2 < .78:
                continue
            (_, _), (d1, d2), _ = cv2.fitEllipse(contour)
            if min(d1, d2) / max(d1, d2) < .8:
                continue
            moments = cv2.moments(contour)
            px, py = moments['m10'] / moments['m00'], moments['m01'] / moments['m00']
            dx, dy = px - geometry['center'][0], -(py - geometry['center'][1])
            u = dx * math.cos(theta) + dy * math.sin(theta)
            v = -dx * math.sin(theta) + dy * math.cos(theta)
            radial = math.sqrt((u / major) ** 2 + (v / minor) ** 2)
            if not .85 < radial < 1.2:
                continue
            if not any(math.hypot(px - p[0], py - p[1]) < radius for p in markers):
                markers.append([float(px), float(py)])
    return markers[0] if len(markers) == 1 else None
