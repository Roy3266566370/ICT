"""把识别请求拼成模型 prompt（只输出 JSON 数组，且强制证据字段）。

这里是一份**手工提炼**的 Schema 摘要，而不是把整份
``contracts/spec/ispec.schema.json`` 塞进上下文：模型只需要知道必填字段、
五类 ``kind``、参数形状和视图形状，其余细节交给
:func:`app.ispec.llm.parse.parse_ispecs` 用正式 Schema 校验。

核心约束（"无证据不出结论"）：

1. 只输出 JSON 数组，不要 Markdown 说明、不要注释；
2. 每个参数的 ``source`` 必须同时包含 ``page``（整数，≥1）与
   ``excerpt``（该页原文片段，**逐字复制、不得改写/翻译/补全**）；
3. 原文里找不到依据的参数不要输出；宁可少输出，也不要编造。
"""

from __future__ import annotations

from typing import Any, Mapping

from .provider import LLMRequest

#: 给模型的紧凑 Schema 摘要（与 ``ispec.schema.json`` 的必填项一致）。
SCHEMA_SUMMARY = """\
iSpec v1.0 必填字段：
- spec_version: 固定字符串 "1.0"
- object_id: ^[A-Za-z0-9_.:-]+$，同一材料内唯一
- kind: parametric | filter | step | geometric | branch
- parameters: 数组，至少 1 项；每项必填 id / label / default / source
  · id: ^[A-Za-z_][A-Za-z0-9_]*$
  · type: number | integer | boolean | enum | string（缺省 number）
  · default: number | boolean | string
  · enum 参数需给 options（字符串数组）
  · source: 必填 source.page（整数且 >= 1）与 status
    以及 source.excerpt（字符串，该页原文片段，逐字复制，不得改写）
  · status: original | inferred | confirmed | manual_demo
- views: 数组，至少 1 项，只能是以下形状之一（注意：每个视图对象严禁携带 parameters 字段）：
  · {"type":"vega","spec_ref":"line|bar|scatter|heatmap|grid_and_transform","title":"...","x":"...","y":"...","dataset":"..."}
  · {"type":"table","columns":["..."],"title":"...","dataset":"..."}
  · {"type":"text","template":"...","title":"..."}
  · {"type":"figure","spec_ref":"vectors|circle_ellipse|grid_transform|step_diagram|det_area","title":"..."}
- 若有派生量，expressions 放在 iSpec 顶层，形如 [{"id":"area","expr":"length * width"}]。
  views 只引用参数或派生量，不能在视图内定义 expressions。
可选字段：title、expressions、datasets、constraints、checks、notes。
禁止新增 Schema 未定义的字段（additionalProperties=false）。
"""


def _render_pages(request: LLMRequest) -> str:
    """把页面原文按页渲染成可引用的块；空页明确标注，避免模型臆测。"""

    blocks: list[str] = []
    for page in request.pages:
        if not isinstance(page, Mapping):
            continue
        page_no = page.get("page_no")
        text = page.get("text")
        summary = page.get("elements_summary")
        blocks.append(
            "\n".join(
                [
                    f"--- 第 {page_no} 页 ---",
                    f"页面元素：{summary if isinstance(summary, str) and summary.strip() else '（无原生元素）'}",
                    "页面原文（excerpt 必须从这里逐字复制）：",
                    text if isinstance(text, str) and text.strip() else "（本页无文字）",
                ]
            )
        )
    return "\n\n".join(blocks) if blocks else "（没有可识别的页面）"


def build_prompt(request: LLMRequest, *, json_object: bool = False) -> str:
    """构造 prompt：只允许输出 JSON 数组，且每个参数必须带证据字段。"""

    hints: Mapping[str, Any] = request.hints or {}
    supported = hints.get("supported_kinds") or [
        "parametric",
        "filter",
        "step",
        "geometric",
        "branch",
    ]
    max_specs = hints.get("max_specs", 8)
    kinds = ", ".join(str(item) for item in supported)
    output = '{"ispecs": [...]}' if json_object else 'JSON 数组'

    return "\n".join(
        [
            "你是课件交互识别器。根据下面的 PPT 页面原文，找出可交互的区域，输出 iSpec。",
            "",
            "【输出格式】",
            f"只输出 {output}，数组最多 {max_specs} 个元素；不要输出 Markdown 代码块标记、",
            "不要解释、不要注释、不要在 JSON 外写任何文字。",
            f"kind 只能取：{kinds}。",
            "",
            "【证据规则（硬性）】",
            "1. 每个参数的 source 必须同时包含 page（整数）与 excerpt（字符串）。",
            "2. excerpt 必须是从该页原文里逐字复制的片段，不得改写、翻译、概括或补全。",
            "3. 若某参数在原文中找不到明确依据，就不要输出该参数；找不到依据的交互区域整体不输出。",
            "4. 不确定时宁可少输出，也不要编造原文或页码。",
            "",
            "【Schema 摘要】",
            SCHEMA_SUMMARY,
            "",
            "【页面原文】",
            _render_pages(request),
            "",
            f"请现在输出 {output}：",
        ]
    )


__all__ = ["SCHEMA_SUMMARY", "build_prompt"]
