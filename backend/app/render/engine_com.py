"""PowerPoint COM 渲染引擎（Windows 首选，spec §3.1 第 1 档）。

实现要点（可反复使用，不要改坏）：

1. **独立子进程**执行 COM：PowerPoint 偶发卡死时，主进程可 ``terminate()`` 掉子进程，
   从而实现真正的超时（COM 调用本身无法被打断）。
2. ``DispatchEx`` 创建独立实例，避免复用用户正在使用的 PowerPoint；
   ``Presentations.Open(..., WithWindow=False)`` 不弹窗；``finally`` 中严格
   ``Presentation.Close()`` → ``Application.Quit()`` → ``CoUninitialize()``。
3. 每页 ``Slides(i).Export(png, "PNG", 1920, 1080)``；导出后校验文件存在且非空。
4. 不做任何宏执行：``Open`` 时 PowerPoint 对纯 ``.pptx`` 不会运行宏（``vbaProject.bin``
   在上传阶段已被拒绝）。
"""

from __future__ import annotations

import glob
import importlib.util
import json
import logging
import os

import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from .errors import RenderError

logger = logging.getLogger(__name__)

#: 默认导出分辨率（spec §3.1 / §3.2：整页 1920x1080）。
DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080

#: 默认超时：24 页约 20~40 秒，给足余量。
DEFAULT_TIMEOUT_S = 240.0

#: 环境变量：显式指定 POWERPNT.EXE（找不到注册表时使用）。
POWERPOINT_EXE_ENV = "POWERPOINT_EXE"

#: 常见安装位置（Office 365 / 2019 / 2016，32/64 位）。
_COMMON_PATHS = (
    r"C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE",
    r"C:\Program Files (x86)\Microsoft Office\root\Office16\POWERPNT.EXE",
    r"C:\Program Files\Microsoft Office\Office16\POWERPNT.EXE",
    r"C:\Program Files (x86)\Microsoft Office\Office16\POWERPNT.EXE",
    r"C:\Program Files (x86)\Microsoft Office\Office15\POWERPNT.EXE",
    r"C:\Program Files\Microsoft Office\Office15\POWERPNT.EXE",
)

#: 注册表 App Paths 键（最可靠，跟随实际安装位置）。
_APP_PATH_KEY = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\POWERPNT.EXE"

_AVAILABLE_CACHE: bool | None = None


def find_powerpoint_exe() -> Path | None:
    """定位 ``POWERPNT.EXE``；找不到返回 ``None``。"""

    override = os.environ.get(POWERPOINT_EXE_ENV)
    if override:
        candidate = Path(override)
        return candidate if candidate.is_file() else None

    if sys.platform == "win32":
        try:
            import winreg  # noqa: PLC0415 - 仅 Windows 可用

            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(root, _APP_PATH_KEY) as key:
                        value, _type = winreg.QueryValueEx(key, "")
                        candidate = Path(str(value))
                        if candidate.is_file():
                            return candidate
                except OSError:
                    continue
        except Exception:  # pragma: no cover - 注册表不可用
            pass

    for raw in _COMMON_PATHS:
        candidate = Path(raw)
        if candidate.is_file():
            return candidate
    # 兜底：Office 自定义安装路径
    for pattern in (
        r"C:\Program Files\Microsoft Office\**\POWERPNT.EXE",
        r"C:\Program Files (x86)\Microsoft Office\**\POWERPNT.EXE",
    ):
        matches = glob.glob(pattern, recursive=True)
        if matches:
            return Path(matches[0])
    return None


def _probe_com() -> bool:
    """实际 Dispatch 一次再安全退出，确认 COM 可用（约 1 秒，结果缓存）。"""

    try:
        import pythoncom  # noqa: PLC0415
        import win32com.client  # noqa: PLC0415
    except Exception:  # pragma: no cover - 非 Windows / 未装 pywin32
        return False
    from app.render.com_export_runner import (  # noqa: PLC0415
        _count_presentations,
        _has_existing_powerpoint,
        _is_powerpoint_visible,
        _safe_quit_powerpoint,
    )

    pythoncom.CoInitialize()
    app = None
    had_existing_instance = False
    existing_presentations: int | None = None
    try:
        had_existing_instance = _has_existing_powerpoint(win32com.client)
        app = win32com.client.DispatchEx("PowerPoint.Application")
        existing_presentations = _count_presentations(app)
        if _is_powerpoint_visible(app):
            had_existing_instance = True
        return True
    except Exception as exc:  # pragma: no cover - 未安装 Office
        logger.info("PowerPoint COM 探测失败：%s", type(exc).__name__)
        return False
    finally:
        _safe_quit_powerpoint(
            app,
            had_existing_instance=had_existing_instance,
            existing_presentations=existing_presentations,
        )
        try:
            pythoncom.CoUninitialize()
        except Exception:  # pragma: no cover
            pass


def is_available(*, force: bool = False) -> bool:
    """判断本机能否用 PowerPoint COM 渲染（带缓存，``force`` 可强制重探）。"""

    global _AVAILABLE_CACHE
    if not force and _AVAILABLE_CACHE is not None:
        return _AVAILABLE_CACHE

    if sys.platform != "win32":
        _AVAILABLE_CACHE = False
        return False
    if importlib.util.find_spec("win32com") is None:  # 未安装 pywin32
        _AVAILABLE_CACHE = False
        return False
    if find_powerpoint_exe() is not None:
        _AVAILABLE_CACHE = True
        return True
    # 注册表与常见路径都没找到时，实际探测一次，避免误判。
    _AVAILABLE_CACHE = _probe_com()
    return _AVAILABLE_CACHE


def render_pptx(
    pptx_path: str | os.PathLike[str],
    out_dir: str | os.PathLike[str],
    *,
    width: int = DEFAULT_WIDTH,
    height: int = DEFAULT_HEIGHT,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> list[Path]:
    """用 PowerPoint COM 把 pptx 每页导出为 PNG，返回按页序排列的文件路径。

    实际导出在独立子进程（``python -m app.render.com_export_runner``）里完成，
    因此超时可以直接 ``kill()``；主进程不会被 COM 卡死。

    :raises RenderError: ``engine_unavailable`` / ``render_timeout`` / ``render_failed``。
    """

    source = Path(pptx_path)
    if not source.is_file() or source.stat().st_size == 0:
        raise RenderError("invalid_input", f"源文件不存在或为空：{source.name}")
    if not is_available():
        raise RenderError(
            "engine_unavailable", "本机没有可用的 PowerPoint COM（pywin32/PowerPoint）"
        )

    target_dir = Path(out_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    # 清掉旧页图，避免上次残留导致页数虚高。
    for stale in target_dir.glob("s*.png"):
        try:
            stale.unlink()
        except OSError:  # pragma: no cover - 文件被占用
            logger.warning("无法删除旧页图：%s", stale.name)

    backend_dir = Path(__file__).resolve().parents[2]
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="xiangsheng_com_") as work:
        result_path = Path(work) / "result.json"
        command = [
            sys.executable,
            "-m",
            "app.render.com_export_runner",
            "--pptx",
            str(source),
            "--out",
            str(target_dir),
            "--width",
            str(int(width)),
            "--height",
            str(int(height)),
            "--result",
            str(result_path),
        ]
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(backend_dir) + os.pathsep + environment.get("PYTHONPATH", "")
        try:
            process = subprocess.Popen(
                command,
                cwd=str(backend_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
            )
        except OSError as exc:
            raise RenderError("engine_unavailable", f"无法启动渲染子进程：{exc}") from exc

        try:
            _stdout, stderr = process.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            _terminate_process_tree(process)
            process.communicate()
            raise RenderError(
                "render_timeout",
                f"PowerPoint 渲染超时（>{timeout_s:.0f}s），已终止子进程",
            ) from None

        payload = _read_result(result_path)
        if payload is None:
            detail = (stderr or b"").decode("utf-8", "ignore").strip()
            raise RenderError(
                "render_failed",
                f"渲染子进程异常退出（exitcode={process.returncode}）"
                + (f"：{detail[-160:]}" if detail else ""),
            )

    if not payload.get("ok"):
        raise RenderError(
            str(payload.get("code") or "render_failed"),
            str(payload.get("message") or "未知渲染错误"),
        )

    files = [Path(str(item)) for item in payload.get("files") or []]
    if not files:
        raise RenderError("render_failed", "PowerPoint 没有导出任何页")
    missing = [item.name for item in files if not item.is_file()]
    if missing:
        raise RenderError("render_failed", f"导出文件缺失：{', '.join(missing[:5])}")

    logger.info(
        "PowerPoint 导出 %d 页（%.1fs，%s）",
        len(files),
        time.monotonic() - started,
        target_dir,
    )
    return files


def _terminate_process_tree(process: subprocess.Popen[bytes]) -> None:
    """结束**本次启动**的渲染子进程及其子进程树（按 PID，绝不按镜像名批量杀）。

    Windows 上用 ``taskkill /PID <pid> /T /F``：只影响本进程创建的那棵进程树，
    不会误伤用户正在编辑的 PowerPoint 文档。其余平台用 ``kill()``。
    """

    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=15,
                check=False,
            )
            return
        except (OSError, subprocess.SubprocessError):
            logger.warning("按 PID 结束渲染子进程树失败，退回 kill()", exc_info=True)
    try:
        process.kill()
    except OSError:  # pragma: no cover - 进程已退出
        logger.debug("kill() 渲染子进程失败", exc_info=True)


def _read_result(path: Path) -> dict[str, Any] | None:
    """读取子进程结果文件；不存在/损坏返回 ``None``。"""

    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


__all__ = [
    "DEFAULT_HEIGHT",
    "DEFAULT_TIMEOUT_S",
    "DEFAULT_WIDTH",
    "POWERPOINT_EXE_ENV",
    "find_powerpoint_exe",
    "is_available",
    "render_pptx",
]