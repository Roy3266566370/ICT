"""本地开发启动器（T7 验收用；也可作为团队日常启动脚本）。

用法::

    cd backend && python scripts/dev_run.py                 # 127.0.0.1:8000
    python scripts/dev_run.py --port 8010 --reload          # 换端口 + 热重载
    cd .. && python backend/scripts/dev_run.py               # 从仓库根也可执行

脚本只负责定位 ``backend/`` 并把 ``--app-dir`` 指向它，不修改任何应用逻辑。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

#: ``backend/scripts/dev_run.py`` -> ``backend/``
BACKEND_DIR = Path(__file__).resolve().parents[1]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description="启动象生 v0.2 后端（uvicorn）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    parser.add_argument("--log-level", default="info", help="uvicorn 日志级别（默认 info）")
    parser.add_argument("--reload", action="store_true", help="开启热重载（开发用）")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """启动 uvicorn；``app-dir`` 固定为 ``backend/``，保证 ``app.*`` 可导入。"""

    args = parse_args(argv)
    backend = str(BACKEND_DIR)
    if backend not in sys.path:
        sys.path.insert(0, backend)

    import uvicorn  # 延迟导入，保证 ``--help`` 不依赖已安装的 uvicorn

    uvicorn.run(
        "app.main:app",
        app_dir=backend,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        reload=args.reload,
        workers=1,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
