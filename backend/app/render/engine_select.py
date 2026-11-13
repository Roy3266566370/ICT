"""渲染引擎选择（spec §3.1）：COM → LibreOffice → 结构化兜底。

返回值固定为 ``{"engine": ..., "fidelity": ...}``（另有 ``reason`` 便于日志与排查）：

===============  =========  ====================================================
engine           fidelity   含义
===============  =========  ====================================================
powerpoint_com   high       Windows + PowerPoint，真实整页位图（首选）
libreoffice      high       soffice + pymupdf，真实整页位图（备选）
svg_fallback     low        以上都不可用：前端按结构还原，必须提示"可能与原版式有差异"
===============  =========  ====================================================

可用性判定全部走各自引擎的 ``is_available()``（带缓存），不在这里重复探测逻辑。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from . import engine_com, engine_libreoffice
from .errors import ENGINE_COM, ENGINE_LIBREOFFICE, ENGINE_SVG, FIDELITY_HIGH, FIDELITY_LOW

logger = logging.getLogger(__name__)

#: ``select_engine(prefer=...)`` 支持的取值。
ENGINE_PREFERENCES: tuple[str, ...] = ("auto", ENGINE_COM, ENGINE_LIBREOFFICE, ENGINE_SVG)

#: 环境变量 / 配置项名：强制指定引擎。
RENDER_ENGINE_ENV = "RENDER_ENGINE"


@dataclass(frozen=True, slots=True)
class EngineChoice:
    """一次渲染的引擎选择结果。"""

    engine: str
    fidelity: str
    reason: str | None = None

    @property
    def produces_page_images(self) -> bool:
        """是否真的会产出整页位图（``svg_fallback`` 不产 PNG）。"""

        return self.engine != ENGINE_SVG

    def as_dict(self) -> dict[str, str | None]:
        return {"engine": self.engine, "fidelity": self.fidelity, "reason": self.reason}


def select_engine(prefer: str | None = None) -> EngineChoice:
    """按优先级挑选引擎。

    :param prefer: ``auto``（默认）/``powerpoint_com``/``libreoffice``/``svg_fallback``。
        指定某个具体引擎但不可用时，**不会**悄悄换别的引擎，而是退回
        ``svg_fallback`` 并写明原因（便于排查配置问题）。
    """

    choice_pref = (prefer or "auto").strip().lower()
    if choice_pref in ("com", "powerpoint"):
        choice_pref = ENGINE_COM
    elif choice_pref in ("lo", "soffice"):
        choice_pref = ENGINE_LIBREOFFICE
    elif choice_pref in ("svg", "fallback"):
        choice_pref = ENGINE_SVG
    if choice_pref not in ENGINE_PREFERENCES:
        logger.warning("未知的渲染引擎偏好 %r，按 auto 处理", prefer)
        choice_pref = "auto"

    if choice_pref == ENGINE_SVG:
        return EngineChoice(ENGINE_SVG, FIDELITY_LOW, "显式指定结构化兜底")

    if choice_pref == ENGINE_COM:
        if engine_com.is_available():
            return EngineChoice(ENGINE_COM, FIDELITY_HIGH, None)
        return EngineChoice(ENGINE_SVG, FIDELITY_LOW, "指定了 PowerPoint COM，但本机不可用")

    if choice_pref == ENGINE_LIBREOFFICE:
        if engine_libreoffice.is_available():
            return EngineChoice(ENGINE_LIBREOFFICE, FIDELITY_HIGH, None)
        return EngineChoice(ENGINE_SVG, FIDELITY_LOW, "指定了 LibreOffice，但本机不可用")

    # auto：首选 COM
    if engine_com.is_available():
        return EngineChoice(ENGINE_COM, FIDELITY_HIGH, None)
    if engine_libreoffice.is_available():
        logger.warning("PowerPoint COM 不可用，改用 LibreOffice 渲染")
        return EngineChoice(ENGINE_LIBREOFFICE, FIDELITY_HIGH, "PowerPoint COM 不可用，已回退 LibreOffice")
    logger.error("本机既无 PowerPoint COM 也无 LibreOffice，渲染降级为 svg_fallback（fidelity=low）")
    return EngineChoice(ENGINE_SVG, FIDELITY_LOW, "本机无可用渲染引擎（COM/LibreOffice 均不可用）")


def reset_availability_cache() -> None:
    """清空引擎可用性缓存（测试或安装 Office 后使用）。"""

    engine_com._AVAILABLE_CACHE = None  # noqa: SLF001 - 有意暴露给测试


def select_engine_dict(prefer: str | None = None) -> dict[str, str | None]:
    """引擎选择的字典视图（spec §3.1 要求返回 ``{engine, fidelity}``）。

    额外带 ``reason`` 便于排查"为什么降级"；不需要时可只读前两个键。
    """

    return select_engine(prefer).as_dict()


__all__ = [
    "ENGINE_PREFERENCES",
    "RENDER_ENGINE_ENV",
    "EngineChoice",
    "reset_availability_cache",
    "select_engine",
    "select_engine_dict",
]