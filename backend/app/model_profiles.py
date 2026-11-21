"""Named model profiles keep text and vision endpoints independent.

The living-page figure pass must not silently reuse a text-only model.  A
profile is a small immutable description: provider, endpoint, model, key,
timeouts and budget.  ``available`` is a side-effect-free check; no network
call is made here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .settings import Settings, get_settings


@dataclass(frozen=True, slots=True)
class ModelProfile:
    name: str
    provider: str
    base_url: str
    model: str
    api_key: str
    timeout_s: int
    max_calls: int

    @property
    def available(self) -> bool:
        return (
            self.provider.strip().lower() not in {"", "none", "disabled"}
            and bool(self.base_url.strip())
            and bool(self.model.strip())
            and bool(self.api_key.strip())
        )

    def status(self) -> dict[str, Any]:
        """公开状态：不返回 Key，也不返回任何请求头。"""

        return {
            "profile": self.name,
            "provider": self.provider,
            "model": self.model if self.available else "",
            "available": self.available,
            "max_calls": self.max_calls,
        }

    def chat_endpoint(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"


def vision_profile(settings: Settings | None = None) -> ModelProfile:
    current = settings or get_settings()
    return ModelProfile(
        name="living.figure.vision",
        provider=current.living_figure_vision_provider,
        base_url=current.living_figure_vision_base_url,
        model=current.living_figure_vision_model,
        api_key=current.living_figure_vision_api_key,
        timeout_s=current.living_figure_vision_timeout_s,
        max_calls=current.living_figure_max_calls,
    )


__all__ = ["ModelProfile", "vision_profile"]