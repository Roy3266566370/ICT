"""Isolated PowerPoint process: export one page as independently placeable objects.

PowerPoint exports a shape as a bitmap of its *rendered bounds*: text that
overflows its text box, shadows and effects enlarge the canvas.  Stretching
that bitmap back into the shape frame therefore squashes glyphs.  For every
object we export once together with a small coloured probe rectangle placed at
the shape-frame origin, measure the probe in the bitmap, and record where the
frame actually sits inside the image.  The web scene can then place the image
at its intrinsic size at that measured offset instead of using ``fill``.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
from pathlib import Path
from uuid import uuid4

#: Bumped whenever the manifest geometry changes; cached pages are re-exported.
EXPORTER_VERSION = 5
#: Probe frame in points.  It is drawn *outside* the shape frame so it never
#: covers teaching content, then removed from the bitmap after measurement.
PROBE_MARGIN = 6.0
PROBE_WEIGHT = 2.0
PROBE_RGB = 0xFF00FF  # COM stores colours as 0xBBGGRR.
MAX_EXPORT_PX = 3840


def color(rgb):
    value = int(rgb) & 0xFFFFFF
    return '#%02x%02x%02x' % (value & 255, (value >> 8) & 255, (value >> 16) & 255)


def _factor(slide_w: float, slide_h: float) -> float:
    """Render at 2x slide points (192 DPI), capped to a sane pixel size."""
    longest = max(float(slide_w), float(slide_h), 1.0)
    return max(1.0, min(2.0, MAX_EXPORT_PX * 3.0 / 4.0 / longest))


def _shape_by_id(slide, identifier):
    for index in range(1, slide.Shapes.Count + 1):
        shape = slide.Shapes(index)
        if int(shape.Id) == int(identifier):
            return shape
    return None


def _probe_origin(path: Path, scale: float) -> tuple[float, float] | None:
    """Shape-frame origin inside an exported bitmap, in points.

    The probe is a magenta rectangle whose *centre line* sits ``PROBE_MARGIN``
    points outside the shape frame.  Its outer antialiased bounding box starts
    another half line-width further out, so the frame origin is recovered from
    that bounding box.  Probe pixels are erased afterwards; they live outside
    the frame and therefore never cover the shape's own pixels.
    """
    try:
        import numpy as np
        from PIL import Image
        with Image.open(path) as image:
            pixels = np.asarray(image.convert('RGBA')).copy()
    except Exception:
        return None
    if pixels.size == 0:
        return None
    core = ((pixels[:, :, 0] > 180) & (pixels[:, :, 1] < 90) &
            (pixels[:, :, 2] > 180) & (pixels[:, :, 3] > 80))
    ys, xs = np.nonzero(core)
    if xs.size == 0:
        return None
    left, right = int(xs.min()), int(xs.max())
    top, bottom = int(ys.min()), int(ys.max())
    # Reject a stray colour match that cannot be the frame probe.
    if right - left < 8 or bottom - top < 8:
        return None
    outer = (left / scale, top / scale)
    # Remove only the probe's outline band, never unrelated magenta content
    # elsewhere in the bitmap.
    band = int(round(PROBE_WEIGHT * scale)) + 2
    yy, xx = np.mgrid[0:pixels.shape[0], 0:pixels.shape[1]]
    near = ((xx - left <= band) | (right - xx <= band) |
            (yy - top <= band) | (bottom - yy <= band))
    halo = core & near
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            shifted = np.roll(np.roll(halo, dy, axis=0), dx, axis=1)
            halo |= shifted & near
    pixels[:, :, 3][halo] = 0
    try:
        Image.fromarray(pixels, 'RGBA').save(path)
    except Exception:
        return None
    return outer


def _direct_geometry(path: Path, shape, scale: float) -> dict | None:
    """Use a plain export when its canvas is exactly the shape frame.

    Pictures, charts, tables and most plain shapes have no overflowing content
    or effects, so their bitmap already starts at the frame origin.  This avoids
    an expensive group/ungroup round-trip for those objects.
    """
    try:
        from PIL import Image
        with Image.open(path) as image:
            width, height = image.size
    except Exception:
        return None
    expected_w = float(shape.Width) * scale
    expected_h = float(shape.Height) * scale
    if abs(width - expected_w) > max(2.0, expected_w * .01):
        return None
    if abs(height - expected_h) > max(2.0, expected_h * .01):
        return None
    return {'frame': [0.0, 0.0], 'scale': round(scale, 5),
            'size': [round(width / scale, 3), round(height / scale, 3)]}


def _direct_approx_export(shape, path: Path, slide_w: float, slide_h: float,
                          factor: float) -> dict | None:
    """Export a shape directly when grouped probe measurement is unavailable.

    Placeholders and group shapes can refuse the group/ungroup round-trip even
    though PowerPoint can render them.  Keeping the natural-size bitmap is a
    better fallback than freezing the whole object: position may be approximate,
    but the object stays visible, editable and exportable.
    """
    try:
        shape.Export(str(path.resolve()), 2, int(round(slide_w * factor)),
                     int(round(slide_h * factor)), 1)
        if not path.exists():
            return None
        from PIL import Image
        with Image.open(path) as image:
            width, height = image.size
        if width < 2 or height < 2:
            return None
        scale = factor * 96.0 / 72.0
        return {'frame': [0.0, 0.0], 'scale': round(scale, 5),
                'size': [round(width / scale, 3), round(height / scale, 3)], 'approx': True}
    except Exception:
        return None


def _measured_export(slide, shape_id: int, path: Path, slide_w: float, slide_h: float,
                     factor: float) -> dict | None:
    """Export one shape and return image geometry.

    Returns ``{"frame": [x_pt, y_pt], "scale": px_per_pt, "size": [w_pt, h_pt]}``
    where ``frame`` is the shape-frame origin inside the bitmap, or ``None``
    when the export or probe measurement failed.
    """
    shape = _shape_by_id(slide, shape_id)
    if shape is None:
        return None
    scale = factor * 96.0 / 72.0
    chart_or_table = False
    for attribute in ('HasChart', 'HasTable'):
        try:
            chart_or_table = chart_or_table or int(getattr(shape, attribute, 0)) == -1
        except Exception:
            pass
    if chart_or_table:
        # Grouping a chart/table with a probe can raise COM errors or block the
        # modal chart editor.  Export directly and keep natural pixel size.
        try:
            shape.Export(str(path.resolve()), 2, int(round(slide_w * factor)),
                         int(round(slide_h * factor)), 1)
            direct = _direct_geometry(path, shape, scale)
            if direct is not None:
                return direct
            from PIL import Image
            with Image.open(path) as image:
                width, height = image.size
            return {'frame': [0.0, 0.0], 'scale': round(scale, 5),
                    'size': [round(width / scale, 3), round(height / scale, 3)],
                    'approx': True}
        except Exception:
            return None
    try:
        has_text = bool(shape.HasTextFrame and shape.TextFrame.HasText)
    except Exception:
        has_text = False
    if not has_text:
        try:
            shape.Export(str(path.resolve()), 2, int(round(slide_w * factor)),
                         int(round(slide_h * factor)), 1)
            direct = _direct_geometry(path, shape, scale)
            if direct is not None:
                return direct
        except Exception:
            pass
    marker = None
    group = None
    result = None
    try:
        # Probe outside the union of the frame and the actual text bounds, so
        # overflowing glyphs are never covered by the measurement outline.
        probe_left = shape.Left - PROBE_MARGIN
        probe_top = shape.Top - PROBE_MARGIN
        probe_right = shape.Left + shape.Width + PROBE_MARGIN
        probe_bottom = shape.Top + shape.Height + PROBE_MARGIN
        try:
            frame = shape.TextFrame
            if frame.HasText:
                text_range = frame.TextRange
                probe_left = min(probe_left, float(text_range.BoundLeft) - PROBE_MARGIN)
                probe_top = min(probe_top, float(text_range.BoundTop) - PROBE_MARGIN)
                probe_right = max(probe_right, float(text_range.BoundLeft) + float(text_range.BoundWidth) + PROBE_MARGIN)
                probe_bottom = max(probe_bottom, float(text_range.BoundTop) + float(text_range.BoundHeight) + PROBE_MARGIN)
        except Exception:
            pass
        probe_outer_left = probe_left - PROBE_WEIGHT / 2.0
        probe_outer_top = probe_top - PROBE_WEIGHT / 2.0
        marker = slide.Shapes.AddShape(1, probe_left, probe_top,
                                       probe_right - probe_left, probe_bottom - probe_top)
        marker.Fill.Visible = 0
        marker.Line.Visible = -1
        marker.Line.ForeColor.RGB = PROBE_RGB
        marker.Line.Weight = PROBE_WEIGHT
        marker.Name = f'__xs_probe_{uuid4().hex}'
        group = slide.Shapes.Range([shape.Name, marker.Name]).Group()
        group.Export(str(path.resolve()), 2, int(round(slide_w * factor)),
                     int(round(slide_h * factor)), 1)
        if path.exists():
            scale = factor * 96.0 / 72.0
            outer = _probe_origin(path, scale)
            if outer is not None:
                origin_x = outer[0] + float(shape.Left) - probe_outer_left
                origin_y = outer[1] + float(shape.Top) - probe_outer_top
                from PIL import Image
                with Image.open(path) as image:
                    width, height = image.size
                result = {'frame': [round(origin_x, 3), round(origin_y, 3)],
                          'scale': round(scale, 5),
                          'size': [round(width / scale, 3), round(height / scale, 3)]}
    except Exception:
        result = None
    finally:
        if group is not None:
            try:
                group.Ungroup()
            except Exception:
                pass
        # The probe may survive a failed ungroup; delete it by its unique name.
        try:
            for index in range(slide.Shapes.Count, 0, -1):
                candidate = slide.Shapes(index)
                if str(candidate.Name).startswith('__xs_probe_'):
                    candidate.Delete()
        except Exception:
            pass
    if result is None:
        current = _shape_by_id(slide, shape_id)
        if current is not None:
            result = _direct_approx_export(current, path, slide_w, slide_h, factor)
    return result


def export_page(source: Path, target: Path, page: int, timeout_s: float | None = None) -> dict:
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    app = None
    deck = None
    started = time.monotonic()
    target.mkdir(parents=True, exist_ok=True)
    holder = {'app': None, 'deck': None}
    watchdog = None
    if timeout_s is not None and timeout_s > 0:
        def abort() -> None:
            # Best effort: ask this dedicated automation instance to quit before
            # the parent force-kills the Python process tree.
            try:
                pythoncom.CoInitialize()
            except Exception:
                pass
            try:
                if holder['deck'] is not None:
                    holder['deck'].Close()
            except Exception:
                pass
            try:
                if holder['app'] is not None:
                    holder['app'].Quit()
            except Exception:
                pass
            os._exit(124)
        watchdog = threading.Timer(timeout_s, abort)
        watchdog.daemon = True
        watchdog.start()
    try:
        app = win32com.client.DispatchEx('PowerPoint.Application')
        holder['app'] = app
        app.AutomationSecurity = 3
        deck = app.Presentations.Open(str(source.resolve()), ReadOnly=True, Untitled=False, WithWindow=False)
        holder['deck'] = deck
        slide = deck.Slides(page)
        slide_w = float(deck.PageSetup.SlideWidth)
        slide_h = float(deck.PageSetup.SlideHeight)
        factor = _factor(slide_w, slide_h)
        identifiers = [int(slide.Shapes(index).Id) for index in range(1, slide.Shapes.Count + 1)]
        objects = {}
        frozen = []
        errors = []
        for shape_id in identifiers:
            identifier = f'n_{shape_id}'
            shape = _shape_by_id(slide, shape_id)
            if shape is None:
                continue
            entry_started = time.monotonic()
            try:
                rotation = float(shape.Rotation)
            except Exception:
                rotation = 0.0
            try:
                shape.Visible = -1
                # Charts/tables may reject the Rotation setter even though they
                # have no meaningful rotation; do not freeze the whole object.
                try:
                    shape.Rotation = 0
                except Exception:
                    pass
                filename = f'{identifier}.png'
                geometry = _measured_export(slide, shape_id, target / filename, slide_w, slide_h, factor)
                if geometry is None:
                    raise RuntimeError('对象边界测量失败')
                entry = {'asset': filename, **{f'asset_{key}': value for key, value in geometry.items()}}
                shape = _shape_by_id(slide, shape_id)
                if shape.HasTextFrame:
                    frame = shape.TextFrame
                    try:
                        char = frame.TextRange.Characters(1, 1)
                        font = char.Font
                        entry['font'] = {'font_size': float(font.Size), 'font_family': str(font.Name),
                                         'color': color(font.Color.RGB), 'bold': int(font.Bold) == -1,
                                         'italic': int(font.Italic) == -1,
                                         'underline': int(font.Underline) == -1}
                        try:
                            spacing = float(font.Spacing)
                            if abs(spacing) > 1e-9:
                                entry['font']['letter_spacing'] = spacing
                        except Exception:
                            pass
                        if entry['font']['font_size'] <= 0:
                            entry['font'].pop('font_size')
                    except Exception:
                        pass
                    try:
                        entry['word_wrap'] = bool(frame.WordWrap)
                    except Exception:
                        pass
                    # Freeze the frame while the text is temporarily removed so
                    # the empty background keeps exactly the original geometry.
                    try:
                        frame.AutoSize = 0
                    except Exception:
                        pass
                    try:
                        frame.TextRange.Text = ''
                        empty = f'{identifier}_empty.png'
                        empty_geometry = _measured_export(slide, shape_id, target / empty,
                                                          slide_w, slide_h, factor)
                        if empty_geometry is not None:
                            entry['empty'] = empty
                            entry.update({f'empty_{key}': value for key, value in empty_geometry.items()})
                        else:
                            entry['empty'] = None
                    except Exception:
                        entry['empty'] = None
                entry['seconds'] = round(time.monotonic() - entry_started, 3)
                objects[identifier] = entry
                shape = _shape_by_id(slide, shape_id)
                if shape is not None:
                    shape.Visible = 0
            except Exception as error:
                frozen.append(identifier)
                # A group/ungroup may invalidate this COM proxy. Do not query
                # it again while recording an object-level fallback.
                errors.append(f'{identifier}: {type(error).__name__}')
                current = _shape_by_id(slide, shape_id)
                if current is not None:
                    try:
                        current.Visible = -1
                        current.Rotation = rotation
                    except Exception:
                        pass
        background = 'background.png'
        slide.Export(str((target / background).resolve()), 'PNG',
                     int(round(slide_w * factor * 96.0 / 72.0)),
                     int(round(slide_h * factor * 96.0 / 72.0)))
        if not (target / background).exists():
            raise RuntimeError('背景导出为空')
        return {'status': 'ready', 'background': background, 'objects': objects,
                'frozen_ids': frozen, 'errors': errors, 'exporter_version': EXPORTER_VERSION,
                'slide_size': [round(slide_w, 3), round(slide_h, 3)],
                'seconds': round(time.monotonic() - started, 3)}
    finally:
        if watchdog is not None:
            watchdog.cancel()
        if deck is not None:
            try:
                deck.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--page', required=True, type=int)
    parser.add_argument('--timeout', type=float, default=None)
    args = parser.parse_args()
    target = Path(args.out)
    target.mkdir(parents=True, exist_ok=True)
    try:
        result = export_page(Path(args.source), target, args.page, args.timeout)
    except Exception as error:
        result = {'status': 'failed', 'message': f'页面对象分离失败：{type(error).__name__}: {error}'}
    temporary = target / 'manifest.tmp'
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    temporary.replace(target / 'manifest.json')
    return 0 if result['status'] == 'ready' else 1


if __name__ == '__main__':
    raise SystemExit(main())
