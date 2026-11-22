"""题目实验室 OCR 并发实例池与 Pix2Text 可选识别通道。

1. 用有界 LifoQueue 实例池替代全局单锁 `_OCR_LOCK`，避免多请求或多页 PDF 上传串行互卡；
2. 当 `LAB_OCR_BACKEND` 为 `auto` 或 `pix2text` 且环境已安装 `pix2text` 时，优先走
   Pix2Text（MFD 公式检测 + MFR 公式转 LaTeX + 文本版面混排），失败或未安装时自动回退
   RapidOCR + rapid-latex-ocr。
"""
from __future__ import annotations

import logging
import math
import queue
import threading
import time
from contextlib import contextmanager
from importlib.util import find_spec
from typing import Any

from PIL import Image

from ..settings import get_settings

logger = logging.getLogger(__name__)

_OCR_POOL_LOCK = threading.Lock()
_OCR_POOL: queue.LifoQueue[Any] = queue.LifoQueue()
_OCR_POOL_CREATED = 0

_PIX2TEXT_LOCK = threading.Lock()
_PIX2TEXT_ENGINE: Any | None = None
_PIX2TEXT_RETRY_AT = 0.0


def ocr_pool_limit() -> int:
    try:
        return max(1, min(8, int(getattr(get_settings(), "lab_ocr_workers", 2))))
    except Exception:  # noqa: BLE001
        return 2


def _create_rapid_ocr() -> Any:
    from rapidocr_onnxruntime import RapidOCR  # 延迟加载，避免拖慢无 OCR 请求

    return RapidOCR()


@contextmanager
def checkout_rapid_ocr():
    """从并发实例池借出一个 RapidOCR 实例，替代全局单锁串行阻塞。"""
    global _OCR_POOL_CREATED
    engine: Any | None = None
    try:
        engine = _OCR_POOL.get_nowait()
    except queue.Empty:
        should_create = False
        with _OCR_POOL_LOCK:
            if _OCR_POOL_CREATED < ocr_pool_limit():
                _OCR_POOL_CREATED += 1
                should_create = True
        if should_create:
            try:
                engine = _create_rapid_ocr()
            except Exception:
                with _OCR_POOL_LOCK:
                    _OCR_POOL_CREATED = max(0, _OCR_POOL_CREATED - 1)
                raise
        else:
            engine = _OCR_POOL.get()
    try:
        yield engine
    finally:
        if engine is not None:
            _OCR_POOL.put(engine)


def reset_ocr_pool() -> None:
    """测试辅助：清空并发实例池与 Pix2Text 缓存状态。"""
    global _OCR_POOL_CREATED, _PIX2TEXT_ENGINE, _PIX2TEXT_RETRY_AT
    with _OCR_POOL_LOCK:
        while not _OCR_POOL.empty():
            try:
                _OCR_POOL.get_nowait()
            except queue.Empty:
                break
        _OCR_POOL_CREATED = 0
    with _PIX2TEXT_LOCK:
        _PIX2TEXT_ENGINE = None
        _PIX2TEXT_RETRY_AT = 0.0


def ocr_backend_mode() -> str:
    try:
        mode = str(getattr(get_settings(), "lab_ocr_backend", "auto") or "auto").strip().lower()
        return mode if mode in {"auto", "pix2text", "rapidocr"} else "auto"
    except Exception:  # noqa: BLE001
        return "auto"


def _pix2text_engine() -> Any | None:
    """懒加载可选的 Pix2Text；未安装或加载失败时缓存重试窗口，避免请求内重复报错。"""
    global _PIX2TEXT_ENGINE, _PIX2TEXT_RETRY_AT
    if ocr_backend_mode() == "rapidocr":
        return None
    with _PIX2TEXT_LOCK:
        if _PIX2TEXT_ENGINE is not None:
            return _PIX2TEXT_ENGINE
        if time.monotonic() < _PIX2TEXT_RETRY_AT:
            return None
        if find_spec("pix2text") is None:
            _PIX2TEXT_RETRY_AT = time.monotonic() + 300
            return None
        try:
            from pix2text import Pix2Text

            _PIX2TEXT_ENGINE = Pix2Text.from_config()
            return _PIX2TEXT_ENGINE
        except Exception as exc:  # noqa: BLE001
            logger.info("Pix2Text 不可用，自动降级为 RapidOCR：%s", str(exc)[:200])
            _PIX2TEXT_RETRY_AT = time.monotonic() + 60
            return None


def format_pix2text_output(raw: Any) -> tuple[str, float | None]:
    """把 Pix2Text 返回的字符串或分块列表整理为带 LaTeX 标记的题干文本。"""
    if isinstance(raw, str):
        cleaned = raw.strip()
        return cleaned, 0.92 if cleaned else None
    if isinstance(raw, list):
        parts: list[str] = []
        scores: list[float] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            kind = str(item.get("type") or "").lower()
            if kind in {"isolated", "formula"}:
                parts.append(f"$${text}$$")
            elif kind == "embedding":
                parts.append(f"${text}$")
            else:
                parts.append(text)
            score = item.get("score")
            if isinstance(score, (int, float)) and math.isfinite(float(score)):
                scores.append(float(score))
        joined = "\n".join(parts).strip()
        avg = (sum(scores) / len(scores)) if scores else (0.92 if joined else None)
        return joined, avg
    return "", None


def pix2text_ocr(image: Image.Image) -> tuple[str, float | None] | None:
    """使用 Pix2Text 进行中英文本与数学公式混排识别；不可用或无产出时返回 None。"""
    engine = _pix2text_engine()
    if engine is None:
        return None
    try:
        prepared = image.convert("RGB")
        if hasattr(engine, "recognize_text_formula"):
            raw = engine.recognize_text_formula(prepared, return_text=True)
        elif hasattr(engine, "recognize"):
            raw = engine.recognize(prepared)
        else:
            return None
        text, confidence = format_pix2text_output(raw)
        if text:
            return text, confidence
    except Exception as exc:  # noqa: BLE001
        logger.warning("Pix2Text 识别失败，回退 RapidOCR：%s", str(exc)[:200])
    return None


__all__ = [
    "checkout_rapid_ocr",
    "format_pix2text_output",
    "ocr_backend_mode",
    "ocr_pool_limit",
    "pix2text_ocr",
    "reset_ocr_pool",
]
