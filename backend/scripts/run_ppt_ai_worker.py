"""独立 PPT AI worker：轮询 ``ppt_ai_tasks`` 并执行持久任务。

用法（从仓库根）：

    py -3.11 backend/scripts/run_ppt_ai_worker.py

环境变量与后端共享 ``DATABASE_URL`` / ``PPT_AI_*``。进程重启后，排队任务与
租约过期的运行任务会被重新领取；已成功写出的阶段结果不会被无限重发。
"""

from __future__ import annotations

import logging
import signal
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.init_db import init_db  # noqa: E402
from app.db.session import session_scope  # noqa: E402
from app.ppt_ai.tasks import run_pending  # noqa: E402
from app.settings import configure_logging, get_settings  # noqa: E402

logger = logging.getLogger("ppt_ai.worker")
_STOP = False


def _stop(_signum: int, _frame: object) -> None:
    global _STOP
    _STOP = True


def main() -> int:
    configure_logging(get_settings())
    init_db()
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    logger.info("PPT AI worker 启动（poll=0.8s）")
    while not _STOP:
        try:
            with session_scope() as db:
                executed = run_pending(db, limit=4)
            if not executed:
                time.sleep(0.8)
        except Exception:  # noqa: BLE001 - worker 不能因单轮异常退出
            logger.exception("PPT AI worker 单轮失败")
            time.sleep(1.0)
    logger.info("PPT AI worker 停止")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
