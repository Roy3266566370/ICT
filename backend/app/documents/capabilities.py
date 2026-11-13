"""Capability probe for free editing's PowerPoint object separation."""
from __future__ import annotations

import importlib.util
import os
import sys

from ..render.engine_com import find_powerpoint_exe

#: Optional standalone Windows conversion service. When set, servers without a
#: local Office installation can delegate page separation to it.
REMOTE_SERVICE_ENV = 'LAYER_EXPORT_SERVICE_URL'
REMOTE_TOKEN_ENV = 'LAYER_EXPORT_SERVICE_TOKEN'


def remote_service() -> str | None:
    value = os.environ.get(REMOTE_SERVICE_ENV, '').strip()
    return value.rstrip('/') if value.startswith(('http://', 'https://')) else None


def layer_editor_available(*, force: bool = False) -> tuple[bool, str | None, str]:
    """Return ``(available, reason, engine)`` for the free-editing layer exporter.

    The probe is intentionally cheap: it checks platform, pywin32 and the
    PowerPoint executable instead of launching Office. Any later COM failure is
    still reported by the page manifest with a readable message.
    """
    if remote_service():
        return True, None, 'remote_windows_service'
    if sys.platform != 'win32':
        return False, '当前服务器不是 Windows，无法使用 PowerPoint 对象分离。请部署 Windows 转换服务（设置 LAYER_EXPORT_SERVICE_URL），或在 Windows 上运行万象。', 'unavailable'
    if importlib.util.find_spec('win32com') is None:
        return False, '缺少 pywin32，无法启动 PowerPoint 对象分离。请安装后端 Windows 依赖，或改用 Windows 转换服务。', 'unavailable'
    if find_powerpoint_exe() is None:
        return False, '未检测到 Microsoft PowerPoint。自由编辑需要 PowerPoint 桌面版分离对象，请安装 Office 或配置 Windows 转换服务。', 'unavailable'
    return True, None, 'powerpoint_com'
