"""PPT AI 领域模块（``ppt-ai.2``；读取兼容 ``ppt-ai.1``）。

正式执行路径保持"受限规格 + 登记算子 + 确定性计算"：模型只提交候选，
契约校验、能力注册表和确定性内核决定能否执行。本包不依赖题目实验室的
``LAB_AI_ENABLED`` 开关，PPT 功能使用独立的 ``PPT_AI_*`` 配置。
"""

from __future__ import annotations

SCHEMA_VERSION = "ppt-ai.2"
REGISTRY_VERSION = "ppt-ai.registry.1"
VIEW_CONTRACT_VERSION = "ppt-ai.view.1"

__all__ = ["REGISTRY_VERSION", "SCHEMA_VERSION", "VIEW_CONTRACT_VERSION"]
