"""PowerPoint COM 导出的独立子进程（由 :mod:`app.render.engine_com` 调用）。

为什么单独起进程，而不是同进程 COM 或 ``multiprocessing``：

1. COM 调用无法被中断（PowerPoint 卡死时线程也卡死）；独立进程可被 ``kill()``。
2. Windows 的 ``multiprocessing`` 使用 spawn，会重新导入 ``__main__``；
   在 uvicorn / 交互环境里会重复执行入口代码。独立 ``python -m`` 进程没有这个问题。
3. 子进程退出即释放 PowerPoint 实例，避免残留进程占用文件。

用法::

    python -m app.render.com_export_runner \\
        --pptx <file.pptx> --out <pages_dir> --width 1920 --height 1080 \\
        --result <result.json>

结果写 ``result.json``（UTF-8）::

    {"ok": true, "count": 24, "files": [...], "duration_s": 12.3}
    {"ok": false, "code": "render_failed", "message": "..."}

本模块**只做导出**，不做解析、不执行宏、不联网。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def export_with_com(
    pptx_path: str,
    out_dir: str,
    width: int,
    height: int,
) -> dict[str, Any]:
    """用 PowerPoint COM 逐页导出 PNG，返回结果字典（不抛异常）。"""

    started = time.monotonic()
    app = None
    presentation = None
    try:
        import pythoncom  # noqa: PLC0415
        import win32com.client  # noqa: PLC0415

        pythoncom.CoInitialize()
        try:
            app = win32com.client.DispatchEx("PowerPoint.Application")
            # ReadOnly/Untitled/WithWindow 必须显式给出，避免加锁或弹窗。
            presentation = app.Presentations.Open(
                pptx_path, ReadOnly=True, Untitled=False, WithWindow=False
            )
            total = int(presentation.Slides.Count)
            files: list[str] = []
            for index in range(1, total + 1):
                target = str(Path(out_dir) / f"s{index:02d}.png")
                presentation.Slides(index).Export(target, "PNG", int(width), int(height))
                exported = Path(target)
                if not exported.is_file() or exported.stat().st_size == 0:
                    raise RuntimeError(f"第 {index} 页导出后文件为空")
                files.append(target)
            return {
                "ok": True,
                "count": total,
                "files": files,
                "duration_s": round(time.monotonic() - started, 3),
            }
        finally:
            if presentation is not None:
                try:
                    presentation.Close()
                except Exception:  # pragma: no cover - 已关闭
                    pass
            if app is not None:
                try:
                    app.Quit()
                except Exception:  # pragma: no cover - 已退出
                    pass
            try:
                pythoncom.CoUninitialize()
            except Exception:  # pragma: no cover
                pass
    except Exception as exc:  # noqa: BLE001 - 子进程必须把异常转为结果
        return {
            "ok": False,
            "code": "render_failed",
            "message": f"PowerPoint 导出失败：{type(exc).__name__}: {exc}",
            "duration_s": round(time.monotonic() - started, 3),
        }


def _write_result(path: str, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    """命令行入口。"""

    parser = argparse.ArgumentParser(description="PowerPoint COM 页图导出（子进程）")
    parser.add_argument("--pptx", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--result", required=True, help="结果 JSON 路径")
    args = parser.parse_args(argv)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = export_with_com(args.pptx, str(out_dir), args.width, args.height)
    _write_result(args.result, payload)
    return 0 if payload.get("ok") else 2


if __name__ == "__main__":  # pragma: no cover - 子进程入口
    sys.exit(main())