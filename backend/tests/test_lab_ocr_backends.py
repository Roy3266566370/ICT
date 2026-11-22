"""OCR 并发实例池与 Pix2Text 可选识别通道测试。"""
import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from app.labs import extract, ocr_backends


def test_rapid_ocr_pool_allows_parallel_checkout(monkeypatch):
    ocr_backends.reset_ocr_pool()
    created = []
    barrier = threading.Barrier(2, timeout=2.0)

    def fake_create():
        token = f"engine-{len(created) + 1}"
        created.append(token)
        return token

    monkeypatch.setattr(ocr_backends, "ocr_pool_limit", lambda: 2)
    monkeypatch.setattr(ocr_backends, "_create_rapid_ocr", fake_create)

    def worker():
        with ocr_backends.checkout_rapid_ocr() as engine:
            # 两个线程必须同时借出不同实例才能通过 barrier，证明未退化为单锁串行
            barrier.wait()
            time.sleep(0.02)
            return engine

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker(), range(2)))

    assert len(created) == 2
    assert set(results) == {"engine-1", "engine-2"}
    ocr_backends.reset_ocr_pool()


def test_format_pix2text_output_handles_blocks_and_strings():
    text, conf = ocr_backends.format_pix2text_output(r"求定积分 $\int_0^1 x^2 dx$")
    assert text == r"求定积分 $\int_0^1 x^2 dx$"
    assert conf is not None and conf > 0.8

    blocks = [
        {"type": "text", "text": "计算下列极限：", "score": 0.96},
        {"type": "isolated", "text": r"\lim_{x \to 0} \frac{\sin x}{x}", "score": 0.94},
        {"type": "embedding", "text": "x=0", "score": 0.90},
    ]
    merged, avg = ocr_backends.format_pix2text_output(blocks)
    assert "计算下列极限：" in merged
    assert r"$$\lim_{x \to 0} \frac{\sin x}{x}$$" in merged
    assert "$x=0$" in merged
    assert avg is not None and abs(avg - (0.96 + 0.94 + 0.90) / 3) < 1e-6


def test_image_pages_uses_pix2text_when_available_and_falls_back(monkeypatch, tmp_path):
    buf = io.BytesIO()
    Image.new("RGB", (120, 60), color="white").save(buf, format="PNG")
    png_bytes = buf.getvalue()

    monkeypatch.setattr(
        extract,
        "pix2text_ocr",
        lambda _img: (r"求定积分 $\int_0^2 x^2\,\mathrm{d}x$", 0.95),
    )
    pages, method = extract._image_pages(png_bytes, "f1", tmp_path)
    assert method == "image_pix2text"
    assert r"\int_0^2" in pages[0]["text"]

    # Pix2Text 不可用时无缝回退到 RapidOCR
    monkeypatch.setattr(extract, "pix2text_ocr", lambda _img: None)
    monkeypatch.setattr(extract, "_ocr", lambda _img: ("求函数导数", 0.91))
    monkeypatch.setattr(extract, "_math_ocr", lambda _img: None)
    pages_fb, method_fb = extract._image_pages(png_bytes, "f2", tmp_path)
    assert method_fb == "image_ocr"
    assert pages_fb[0]["text"] == "求函数导数"
