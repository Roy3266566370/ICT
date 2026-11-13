"""渲染链路的统一错误类型（spec §3）。

渲染与解析、内核一样，出错只抛一种可分类的异常，**不抛裸异常、不泄露堆栈**：

* ``engine_unavailable`` —— 本机没有可用的渲染引擎（COM / LibreOffice）。
* ``render_timeout``    —— 引擎超时（COM 子进程被强制终止 / soffice 超时）。
* ``render_failed``     —— 引擎报错、页数为 0、导出文件缺失。
* ``erase_rejected``    —— 擦除校验不通过（区域四周不是纯背景），该区域保持静态。
* ``invalid_input``     —— 源文件不存在/为空/不是 pptx。

``retryable`` 供后台任务决定是否值得重试（超时与引擎忙可重试，输入错误不可重试）。
"""

from __future__ import annotations

from typing import Final

#: 引擎标识（写入 ``render.json.render_engine`` 与材料渲染状态）。
ENGINE_COM: Final[str] = "powerpoint_com"
ENGINE_LIBREOFFICE: Final[str] = "libreoffice"
ENGINE_SVG: Final[str] = "svg_fallback"

#: 保真度（``high`` 表示真实页面位图；``low`` 表示结构还原，前端必须提示）。
FIDELITY_HIGH: Final[str] = "high"
FIDELITY_LOW: Final[str] = "low"

#: ``RenderError.code`` 的合法取值。
RENDER_ERROR_CODES: Final[frozenset[str]] = frozenset(
    {
        "engine_unavailable",
        "render_timeout",
        "render_failed",
        "erase_rejected",
        "invalid_input",
    }
)

#: 可重试的错误码。
RETRYABLE_RENDER_CODES: Final[frozenset[str]] = frozenset(
    {"render_timeout", "render_failed"}
)


class RenderError(Exception):
    """渲染失败。

    :param code: :data:`RENDER_ERROR_CODES` 之一。
    :param message: 面向用户/日志的单行说明，不含堆栈。
    :param retryable: 是否建议重试；缺省由错误码推导。
    """

    def __init__(self, code: str, message: str, *, retryable: bool | None = None) -> None:
        if code not in RENDER_ERROR_CODES:
            raise ValueError(f"未知的 RenderError.code：{code!r}")
        self.code = code
        self.message = message
        self.retryable = code in RETRYABLE_RENDER_CODES if retryable is None else retryable
        super().__init__(f"{code}: {message}")

    def __str__(self) -> str:  # pragma: no cover - 仅用于日志与测试
        return f"{self.code}: {self.message}"


__all__ = [
    "ENGINE_COM",
    "ENGINE_LIBREOFFICE",
    "ENGINE_SVG",
    "FIDELITY_HIGH",
    "FIDELITY_LOW",
    "RENDER_ERROR_CODES",
    "RETRYABLE_RENDER_CODES",
    "RenderError",
]