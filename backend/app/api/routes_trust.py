"""可信与对抗演示端点（只读、确定性，不调用真实模型）。"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..adversarial import run_demo
from . import API_PREFIX, ok

router = APIRouter(prefix=API_PREFIX, tags=["trust"])


@router.get("/trust/adversarial-demo", summary="AI 故障注入与四道防线演示")
def adversarial_demo(request: Request) -> JSONResponse:
    """返回干净输入、四类合成故障、拦截日志与对照结果。"""

    return ok(request, run_demo())


__all__ = ["router"]
