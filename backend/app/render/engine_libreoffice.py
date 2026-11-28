"""LibreOffice 渲染引擎（备选，spec §3.1 第 2 档）。

流程：``soffice --headless --convert-to pdf`` → PDF 逐页转 PNG（pymupdf）。

适用场景：非 Windows 机器，或本机装了 LibreOffice 但 PowerPoint 不可用。
保真度与 PowerPoint 接近（都是真实渲染），差异主要在字体替换与 SmartArt。
"""

from __future__ import annotations

import importlib.util
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from .errors import RenderError

logger = logging.getLogger(__name__)

#: 默认导出分辨率（与 COM 引擎一致）。
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
#: 默认超时；LibreOffice 首次启动会初始化用户配置，给足余量。
DEFAULT_TIMEOUT_S = 300.0
#: 环境变量：显式指定 soffice 可执行文件。
SOFFICE_ENV = "SOFFICE_PATH"

#: 常见安装位置（Linux / macOS / Windows）。
_COMMON_PATHS = (
    "/usr/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
)


def find_soffice() -> str | None:
    """定位 ``soffice`` 可执行文件；找不到返回 ``None``。"""

    override = os.environ.get(SOFFICE_ENV)
    if override:
        return override if Path(override).is_file() else None

    for name in ("soffice", "soffice.exe"):
        found = shutil.which(name)
        if found:
            return found
    for raw in _COMMON_PATHS:
        if Path(raw).is_file():
            return raw
    return None


def _load_pdf_backend() -> Any:
    """返回 PDF 渲染后端模块（``pymupdf`` 优先，其次旧名 ``fitz``）。"""

    if importlib.util.find_spec("pymupdf") is not None:
        import pymupdf  # noqa: PLC0415

        return pymupdf
    if importlib.util.find_spec("fitz") is not None:
        import fitz  # noqa: PLC0415

        return fitz
    return None


def is_available() -> bool:
    """LibreOffice + PDF 后端都可用时才算可用。"""

    return find_soffice() is not None and _load_pdf_backend() is not None


def _convert_to_pdf(soffice: str, source: Path, work_dir: Path, timeout_s: float) -> Path:
    """调用 soffice 把 pptx 转成 PDF，返回 PDF 路径。

    使用**独立的临时用户配置目录**：否则 soffice 会复用用户已打开的 LibreOffice 实例，
    命令直接返回成功却一个文件都不产出（Windows 上非常常见）。
    """

    profile = (work_dir / "profile").resolve()
    profile.mkdir(parents=True, exist_ok=True)
    command = [
        soffice,
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--norestore",
        "--invisible",
        "--convert-to",
        "pdf",
        "--outdir",
        str(work_dir),
        str(source),
    ]
    logger.info("LibreOffice 转换：%s", " ".join(command[-3:]))
    try:
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RenderError(
            "render_timeout", f"LibreOffice 转换超时（>{timeout_s:.0f}s）"
        ) from exc
    except OSError as exc:
        raise RenderError("engine_unavailable", f"无法执行 soffice：{exc}") from exc

    pdf_path = work_dir / (source.stem + ".pdf")
    if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        detail = (completed.stderr or b"").decode("utf-8", "ignore").strip()
        raise RenderError(
            "render_failed",
            f"LibreOffice 未能生成 PDF（exit={completed.returncode}）"
            + (f"：{detail[:160]}" if detail else ""),
        )
    return pdf_path


def _pdf_to_png(pdf_path: Path, out_dir: Path, width: int, height: int) -> list[Path]:
    """PDF 并发逐页导出 PNG（原子落盘），返回按页序排列的文件路径。"""

    from concurrent.futures import ThreadPoolExecutor

    backend = _load_pdf_backend()
    if backend is None:
        raise RenderError(
            "engine_unavailable",
            "未安装 pymupdf（或旧名 fitz），无法把 PDF 转成 PNG",
        )
    try:
        with backend.open(str(pdf_path)) as probe:
            total = int(getattr(probe, "page_count", 0))
    except Exception as exc:  # noqa: BLE001 - 后端可能抛多种异常
        raise RenderError("render_failed", f"PDF 打开失败：{type(exc).__name__}") from exc

    if total <= 0:
        raise RenderError("render_failed", "PDF 没有任何页面")

    workers = max(1, min(8, os.cpu_count() or 4, total))

    def _render_chunk(indices: list[int]) -> list[tuple[int, Path]]:
        rendered: list[tuple[int, Path]] = []
        document = backend.open(str(pdf_path))
        try:
            for index in indices:
                page = document.load_page(index)
                rect = page.rect
                if not rect.width or not rect.height:
                    raise RenderError("render_failed", f"PDF 第 {index + 1} 页尺寸异常")
                # 精确按目标分辨率导出；pptx→pdf 后页面比例与原页一致。
                matrix = backend.Matrix(width / rect.width, height / rect.height)
                pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                target = out_dir / f"s{index + 1:02d}.png"
                tmp = out_dir / f".s{index + 1:02d}.{os.getpid()}.tmp.png"
                try:
                    pixmap.save(str(tmp))
                    os.replace(tmp, target)
                finally:
                    tmp.unlink(missing_ok=True)
                if not target.is_file() or target.stat().st_size == 0:
                    raise RenderError("render_failed", f"第 {index + 1} 页导出为空")
                rendered.append((index, target))
        finally:
            try:
                document.close()
            except Exception:  # pragma: no cover
                pass
        return rendered

    all_indices = list(range(total))
    chunks = [all_indices[i::workers] for i in range(workers) if all_indices[i::workers]]
    results: list[tuple[int, Path]] = []
    if len(chunks) == 1:
        results = _render_chunk(chunks[0])
    else:
        with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
            for part in pool.map(_render_chunk, chunks):
                results.extend(part)
    results.sort(key=lambda item: item[0])
    return [path for _, path in results]


def render_pptx(
    pptx_path: str | os.PathLike[str],
    out_dir: str | os.PathLike[str],
    *,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> list[Path]:
    """用 LibreOffice + pymupdf 渲染，返回按页序排列的 PNG 路径。

    :raises RenderError: ``engine_unavailable`` / ``render_timeout`` / ``render_failed``。
    """

    source = Path(pptx_path)
    if not source.is_file() or source.stat().st_size == 0:
        raise RenderError("invalid_input", f"源文件不存在或为空：{source.name}")

    soffice = find_soffice()
    if soffice is None:
        raise RenderError("engine_unavailable", "未找到 soffice 可执行文件")
    if _load_pdf_backend() is None:
        raise RenderError("engine_unavailable", "未安装 pymupdf，LibreOffice 链路不可用")

    target_dir = Path(out_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    for stale in target_dir.glob("s*.png"):
        try:
            stale.unlink()
        except OSError:  # pragma: no cover
            logger.warning("无法删除旧页图：%s", stale.name)

    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="xiangsheng_lo_") as work:
        pdf_path = _convert_to_pdf(soffice, source, Path(work), timeout_s)
        files = _pdf_to_png(pdf_path, target_dir, width, height)

    logger.info(
        "LibreOffice 导出 %d 页（%.1fs，%s）",
        len(files),
        time.monotonic() - started,
        target_dir,
    )
    return files


__all__ = [
    "DEFAULT_HEIGHT",
    "DEFAULT_TIMEOUT_S",
    "DEFAULT_WIDTH",
    "SOFFICE_ENV",
    "find_soffice",
    "is_available",
    "render_pptx",
]