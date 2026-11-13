"""后端脚本包（手工建表、黄金自检、开发启动器）。

现有脚本：

- ``dev_run.py``   —— 本地启动 uvicorn（T7 验收用）。
- ``selftest.py``  —— 黄金用例自检（T9 交付，本包预留导入路径）。

脚本统一用 ``python scripts/<name>.py`` 或 ``python -m scripts.<name>`` 执行。
"""

from __future__ import annotations

__all__: list[str] = []
