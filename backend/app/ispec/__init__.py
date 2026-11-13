"""iSpec 生成与校验（C-SPEC@1，``contracts/spec/ispec.schema.json``）。

识别层只产出 iSpec，运行时只消费 iSpec。本包不依赖 ``app.parsers`` 的正则逻辑，
只读取解析产物里**可直读的原生数据**（图表 / 表格 / OMML 公式）：

* :func:`build_ispecs` —— 从 ``slides.json`` 生成通过 Schema 校验的 iSpec 列表；
* :func:`build_ispecs_detailed` —— 额外返回识别结论与被丢弃条目的校验错误；
* :func:`validate_ispec` —— 单条 iSpec 的 JSON Schema 校验；
* :func:`assign_shared_keys` —— 跨 iSpec 参数同一性（§9-4）：同一变量在多页出现时分配共享键。

约定：

1. 无原生内容时返回空列表，**绝不回退到公共示例区域**；
2. 每条参数都带 ``source``（页码 + 元素 id + 原文片段），无证据不出结论；
3. 单条 iSpec 校验失败只丢弃该条，不拖垮整个材料。
"""

from __future__ import annotations

from .builder import IspecBuildResult, build_ispecs, build_ispecs_detailed
from .shared import (
    SharedAssignResult,
    apply_shared_keys,
    assign_shared_keys,
    parameter_signature,
)
from .validator import filter_valid_ispecs, validate_ispec

__all__ = [
    "IspecBuildResult",
    "SharedAssignResult",
    "apply_shared_keys",
    "assign_shared_keys",
    "build_ispecs",
    "build_ispecs_detailed",
    "filter_valid_ispecs",
    "parameter_signature",
    "validate_ispec",
]