"""万象 WANXIANG v0.2 后端应用包（FastAPI）。

模块边界（plan.md §2.1.3）：

- ``app.main``      —— 应用装配、中间件、统一异常处理（T7）
- ``app.settings``  —— 配置与环境变量（T7）
- ``app.api``       —— ``/api/v1`` 路由，自动注册（C-REG@1，T7/T10）
- ``app.schemas``   —— Pydantic 领域与 API 模型（C-KO@1/C-RUN@1/C-API@1，T7）
- ``app.db``        —— SQLAlchemy engine/session 与 9 张表（T7）
- ``app.engines``   —— 四个确定性内核（C-ENGINE@1，T8）
- ``app.validators``/``app.parsers`` —— 独立校验与 PPTX 解析（T9/T11）

字段名一律 snake_case，与 ``contracts/schemas/*.schema.json`` 逐字一致（C-03）。
"""

from __future__ import annotations

__all__ = ["__version__"]

#: 与 ``contracts/openapi.yaml`` 的 ``info.version`` 保持一致。
__version__ = "0.2.0"
