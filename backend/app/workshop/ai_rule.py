"""AI 智能计算方块的受限结构化生成：复用现有主力文本模型配置。"""

from __future__ import annotations

import json
import math
import re
import time
from typing import Any

from pydantic import ValidationError

from ..ppt_ai.client import HttpxTransport
from ..settings import get_settings
from ..structured_llm import JsonObject, complete_json

AI_RULE_VERSION = 1
MAX_CODE = 24000
MAX_CONTROLS = 8
MAX_PRESETS = 4
KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")
FORBIDDEN_CODE = re.compile(
    r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|indexedDB|BroadcastChannel|"
    r"localStorage|sessionStorage|document|window|parent|top|globalThis|self|postMessage|eval|async|await|"
    r"Date|performance|crypto|Worker|SharedWorker|MessageChannel|MessagePort|WebTransport|caches)\b|"
    r"Math\.random|import\s*\(|new\s+Function\s*\("
)
VIEWS = {"auto", "shapes", "grid", "chart", "graph", "timeline", "table"}
MAX_CUSTOM_PORTS = 6
ALLOWED_INPUT_KINDS = {
    "scalar", "series", "matrix2", "body", "function", "function2d", "vectorFunction2d",
    "tensor2d", "dataset2d", "field2d", "algoData", "customFrames",
    "lab408Data", "physicsData", "calculusData", "businessData",
}
ALLOWED_OUTPUT_KINDS = {"scalar", "series", "customFrames"}


class AiRuleUnavailable(RuntimeError):
    """模型未配置或生成结果不可用。"""


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _control(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    key = _text(raw.get("key"), 40)
    label = _text(raw.get("label"), 40)
    if not KEY_RE.fullmatch(key) or not label:
        return None
    options: list[dict[str, Any]] = []
    seen: set[float] = set()
    for item in raw.get("options") or []:
        if not isinstance(item, dict):
            continue
        value = _number(item.get("value"))
        option_label = _text(item.get("label"), 32)
        if value is None or not option_label or value in seen:
            continue
        seen.add(value)
        options.append({"value": value, "label": option_label})
        if len(options) >= 10:
            break
    minimum = _number(raw.get("min"))
    maximum = _number(raw.get("max"))
    if minimum is not None and maximum is not None and not minimum < maximum:
        minimum = maximum = None
    step = _number(raw.get("step"))
    current = _number(raw.get("value"))
    if current is None:
        current = options[0]["value"] if options else (minimum if minimum is not None else 0)
    if options:
        if not any(abs(current - option["value"]) < 1e-12 for option in options):
            current = options[0]["value"]
    else:
        current = max(minimum if minimum is not None else -1e6, min(maximum if maximum is not None else 1e6, current))
    result: dict[str, Any] = {"key": key, "label": label, "value": current}
    if minimum is not None:
        result["min"] = minimum
    if maximum is not None:
        result["max"] = maximum
    if step is not None and step > 0:
        result["step"] = step
    if options:
        result["options"] = options
    return result


def normalize_rule_payload(raw: Any, fallback_prompt: str = "") -> dict[str, Any]:
    """把模型 JSON 收敛为前端 AiRuleBlockPayload；非法时抛 ValueError。"""

    if not isinstance(raw, dict):
        raise ValueError("必须返回 JSON 对象")
    code = raw.get("code") if isinstance(raw.get("code"), str) else ""
    if not re.search(r"function\s+run\s*\(", code):
        raise ValueError("code 必须包含 function run({ text, params, upstream, rand })")
    if len(code) > MAX_CODE:
        raise ValueError(f"code 超过 {MAX_CODE} 字")
    forbidden = FORBIDDEN_CODE.search(code)
    if forbidden:
        raise ValueError(f"code 包含被禁止的标识符或语法：{forbidden.group().strip()}，请改用其他写法")
    controls: list[dict[str, Any]] = []
    for raw_control in (raw.get("controls") or []):
        control = _control(raw_control)
        if control is not None:
            controls.append(control)
        if len(controls) >= MAX_CONTROLS:
            break
    allowed = {item["key"] for item in controls}
    presets: list[dict[str, Any]] = []
    for item in (raw.get("presets") or [])[:MAX_PRESETS]:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label") or item.get("name") or item.get("title"), 24)
        if not label:
            continue
        params: dict[str, float] = {}
        raw_params = item.get("params")
        for key, number in (raw_params.items() if isinstance(raw_params, dict) else ()):
            value = _number(number)
            if isinstance(key, str) and key in allowed and value is not None:
                params[key] = value
        text = _text(item.get("text"), 4000)
        if not params and not text:
            continue
        preset: dict[str, Any] = {"label": label, "params": params}
        if text:
            preset["text"] = text
        presets.append(preset)
    preferred = raw.get("preferredView")
    if preferred not in VIEWS:
        preferred = "auto"
    prompt = _text(raw.get("prompt"), 2000) or _text(fallback_prompt, 2000)
    title = _text(raw.get("title"), 60) or _text(prompt, 40) or "AI 计算方块"
    result: dict[str, Any] = {
        "version": AI_RULE_VERSION,
        "prompt": prompt,
        "title": title,
        "summary": _text(raw.get("summary"), 300),
        "controls": controls,
        "presets": presets,
        "preferredView": preferred,
        "code": code,
    }
    for key, limit in (("textLabel", 80), ("defaultText", 4000), ("verificationNote", 300)):
        value = _text(raw.get(key), limit)
        if value:
            result[key] = value
    # 可选自定义多输入端口声明（最多 6 个）
    raw_inputs = raw.get("inputs")
    if isinstance(raw_inputs, list):
        custom_inputs: list[dict[str, Any]] = []
        seen_in: set[str] = set()
        for item in raw_inputs:
            if not isinstance(item, dict):
                continue
            pid = _text(item.get("id"), 40)
            label = _text(item.get("label"), 32)
            if not KEY_RE.fullmatch(pid) or not label or pid in seen_in:
                continue
            seen_in.add(pid)
            port_obj: dict[str, Any] = {"id": pid, "label": label}
            kind = item.get("kind")
            if isinstance(kind, str) and kind in ALLOWED_INPUT_KINDS:
                port_obj["kind"] = kind
            custom_inputs.append(port_obj)
            if len(custom_inputs) >= MAX_CUSTOM_PORTS:
                break
        if custom_inputs:
            result["inputs"] = custom_inputs
    # 可选自定义多输出端口声明（最多 6 个）
    raw_outputs = raw.get("outputs")
    if isinstance(raw_outputs, list):
        custom_outputs: list[dict[str, Any]] = []
        seen_out: set[str] = set()
        for item in raw_outputs:
            if not isinstance(item, dict):
                continue
            pid = _text(item.get("id"), 40)
            label = _text(item.get("label"), 32)
            kind = item.get("kind")
            if not KEY_RE.fullmatch(pid) or not label or pid in seen_out or kind not in ALLOWED_OUTPUT_KINDS:
                continue
            seen_out.add(pid)
            custom_outputs.append({"id": pid, "label": label, "kind": kind})
            if len(custom_outputs) >= MAX_CUSTOM_PORTS:
                break
        if custom_outputs:
            result["outputs"] = custom_outputs
    return result


SYSTEM_PROMPT = """你是定象坊的 AI 规则方块生成器。只输出一个 JSON 对象，不输出 Markdown 或解释。
字段：version=1、prompt、title、summary、textLabel(可选)、defaultText(可选)、controls、presets、inputs(可选)、outputs(可选)、preferredView、code、verificationNote。
要求：
1. code 必须是字符串，内容为同步纯函数 function run({ text, params, upstream, inputs, rand }) { ... return { data, frames }; }。
2. 禁止 DOM、网络、定时器、localStorage、eval、new Function、import、require、async/await；只能使用普通 JavaScript、Number、String、Math 等纯计算能力。
   规则按完整单词扫描 code，变量名、属性名、注释和字符串也会匹配。避免使用 parent、top、self、window、document、globalThis、Date、performance 等保留名称。并查集用 ufParent 或 leader，树的前驱用 predecessor，堆顶用 heapHead。
3. frames 为 2–20 帧数组，每帧至少包含中文 title 和 summary。显示字段包括：
   - shapes: { viewBox: [400,240], items: [...] }，最多 160 个 2D 图元，适合力学、几何、电路。图元 kind 和坐标：circle(cx,cy,r)、rect(x,y,w,h,rx?)、line/arrow(x1,y1,x2,y2)、polygon(points:[[x,y],...])、text(x,y,text,size?,anchor?)。可用 fill、stroke、strokeWidth、opacity 和 label。
   - grid: { cells: number[][], min?, max?, rowLabels?, colLabels?, palette?: 'heat'|'diverging'|'binary', showValues?, activeCell?: [row,col] }，最大 32×32，行列从 0 开始，适合迷宫、动态规划、卷积、生命游戏。
   - graph: { nodes:[{id,label,x,y,active?}], edges:[{from,to,label?,active?}] }，坐标按 0–100；series: [{label,values:number[]}]；timeline: [{label,segments:[{label,start,end}]}]；columns 与 rows 用于表格。
4. controls 为 1–6 个参数，每项含 key、label、value；数值型可带 min/max/step，离散型带 options。
5. presets 为 2–3 组教学情景，每项必须含 label（不要用 name），params 的 key 必须来自 controls；可带 text。
6. preferredView 只能是 auto/shapes/grid/chart/graph/timeline/table。
7. verificationNote 写一条可手算核对的具体算例。
8. 只做确定性计算。随机模拟使用 rand()，可提供整数 seed 控件。禁止 Math.random、当前时间或外部数据。
9. upstream_hints 提供参考数据的端口、类型和字段。当它非空时优先读取 upstream[0] 或 inputs.<portId>，按 kind 及字段计算，并在未连线或数据暂不可用时回退到示例或参数。把核心有限标量写入 data.value，供下游数值端口使用。
10. 多输入/多输出扩展（当任务涉及多路子系统汇聚或分流时使用，最多 6 路）：
   - inputs: [{ id, label, kind? }]，id 为英文标识符（如 supply/demand/policy），代码中通过 inputs[id] 读取对应端口值（如 inputs.supply?.v），无连线时回退默认值。
   - outputs: [{ id, label, kind: 'scalar'|'series'|'customFrames' }]，代码中把对应输出写入 data.outputs = { [id]: 数值或数字数组 }。"""


FUSE_SYSTEM_PROMPT = """你是定象坊的 AI 积木语义融合引擎。用户框选了画布上的多个积木（含连线与外部接口），请按用户融合意图将它们重铸为一块紧凑、可交互、同屏联动展示的单个 AI 规则方块 JSON。
只输出一个 JSON 对象，不输出 Markdown 或解释。字段与普通 AI 规则方块完全一致：
version=1、prompt、title、summary、textLabel(可选)、defaultText(可选)、controls、presets、inputs(可选)、outputs(可选)、preferredView、code、verificationNote。
核心融合要求：
1. 合并重复或语义相近的参数，保留最核心的可调控件（controls 数量 1–8 个）。
2. 在同一帧中通过 shapes / series（多条对比曲线） / grid / table 联合呈现原多个积木的关键结果，避免信息丢失。
3. 若 external_ports.inputs 非空：在输出的 inputs 中保留这些外部输入端口的 id、label、kind，并在 run({ text, params, upstream, inputs, rand }) 中优先消费 inputs[portId]（同时兼容 upstream），未连线时优雅回退到控件参数或默认值。
4. 若 external_ports.outputs 非空：在输出的 outputs 中保留对应外部输出端口的 id、label、kind（scalar/series/customFrames），并把对应计算结果写入 data.outputs[portId] 以及 data.value。
5. 严格遵守同步纯函数沙箱限制：禁止 fetch/window/document/parent/top/self/globalThis/Date/performance/Math.random/eval/async/await，确保在 300ms 内完成计算，输出 2–20 帧，提供 2–3 组 presets 和可手算核对的 verificationNote。"""


COMPOSITE_SUMMARY_PROMPT = """你是定象坊的模块命名助手。根据给定的复合积木内部节点、连线与端口摘要，生成一个简洁贴切的中文模块名称和一句话功能简介。
只输出一个 JSON 对象：{"title": "2~14字中文模块名", "summary": "15~80字一句话说明该模块接收什么输入、计算或展示什么内容"}。不输出 Markdown 或额外文字。"""


COMPOSE_SYSTEM_PROMPT = """你是定象坊的积木实验编排师。根据用户需求和提供的可用积木目录（catalog）以及画布现有积木（existing_nodes），规划要添加的积木与精确连线，使整套实验能够直接运行。
只输出一个 JSON 对象，不输出 Markdown 或额外解释：
{
  "title": "实验方案标题(<=24字)",
  "summary": "一句话说明数据如何从源积木流向变换和视图(<=120字)",
  "add_nodes": [
    {"ref": "n1", "type": "目录中的精确type", "label": "可选中文别名", "params": {"可选有限数值参数": 1}, "text": "可选表达式或说明文本"}
  ],
  "wires": [
    {"from": "已有节点id或add_nodes中的ref", "fromPort": "源输出端口id(通常为out)", "to": "已有节点id或add_nodes中的ref", "toPort": "目标输入端口id(通常为in)"}
  ]
}
硬性规则：
1. add_nodes 中每项的 type 必须严格来自输入的 catalog；绝不编造不存在的 type。
2. wires 中每条连线的 from/to 必须指向 existing_nodes 的 id 或 add_nodes 的 ref，且 from != to；fromPort 必须来自源节点的 outputs，toPort 必须来自目标节点的 inputs，且端口类型 kind 必须兼容（若输入口无 kind 约束则可接任意类型）。
3. 严禁构成纯同步依赖环（除非环路经过 delayRegister 延迟寄存器）。
4. mode="compose" 时：用 2~8 块最贴合的真内核内置积木搭出完整可运行的「源 → 变换 → 视图」链路（优先用目录里的内置学科积木，例如弹簧振子/抛体/单摆配轨迹仪与能量表、函数源配导数/积分/函数图像、滑杆配旋转器与向量场等），并全部连好线。
5. mode="wire_existing" 时：优先把 existing_nodes 里尚未连线的积木按端口类型合理连接成完整实验；仅在确实缺少关键源或视图时才补充 1~2 块 add_nodes。
6. 若添加 functionSource，请在 text 中提供合法表达式（如 "sin(x)+0.5*x"）；若添加 slider，可按需设置 params.v / min / max。"""


def _invoke_rule_llm(
    *,
    system_prompt: str,
    context: dict[str, Any],
    fallback_prompt: str,
    error_prefix: str = "AI 规则生成失败",
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.llm_api_key.strip() or not settings.llm_model.strip() or settings.llm_provider.strip().lower() == "none":
        raise AiRuleUnavailable("未配置主力模型 LLM_API_KEY，可展开代码抽屉手动编写规则")
    transport = HttpxTransport()
    started = time.monotonic()
    normalized: dict[str, Any] | None = None

    def send(url: str, *, headers: dict[str, str], json_body: dict[str, Any]):
        remaining = float(settings.llm_timeout_s) - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("AI 规则生成超时，请缩短描述后重试")
        return transport.post(url, headers=headers, json_body=json_body, timeout=min(float(settings.llm_timeout_s), remaining))

    def validate(data: dict[str, Any]) -> None:
        nonlocal normalized
        normalized = normalize_rule_payload(data, fallback_prompt=fallback_prompt)
        if len(normalized["controls"]) < 1:
            raise ValueError("至少需要 1 个 controls 参数")
        if len(normalized.get("presets") or []) < 2:
            raise ValueError("需要提供 2–3 组 presets 预设")
        if not normalized.get("verificationNote"):
            raise ValueError("缺少 verificationNote 手算核对说明")

    try:
        complete_json(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            send=send,
            response_model=JsonObject,
            validator=validate,
            max_retries=1,
            model=settings.llm_model,
            temperature=0.2,
            max_tokens=6000,
            **({"extra_body": {"thinking": {"type": "disabled"}}}
               if settings.llm_provider.strip().lower() == "maas" else {}),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
        )
    except Exception as exc:  # noqa: BLE001 - convert provider/validation errors to one API message
        kind = type(exc).__name__
        if isinstance(exc, TimeoutError) or "Timeout" in kind:
            message = "模型调用超时，请稍后重试或缩短描述"
        elif "Connection" in kind or "Connect" in kind:
            message = "模型连接失败，请检查后端 LLM_BASE_URL、网络，或展开代码抽屉手动编写规则"
        elif isinstance(exc, ValidationError):
            detail = exc.errors(include_input=False, include_url=False, include_context=False)[0]
            message = detail["msg"].removeprefix("Value error, ")[:300]
        else:
            message = str(exc).splitlines()[0][:300] if str(exc) else kind
        raise AiRuleUnavailable(f"{error_prefix}：{message}") from exc
    if normalized is None:
        raise AiRuleUnavailable(f"{error_prefix}：模型没有返回可用规则")
    return normalized


def generate_ai_rule(
    prompt: str,
    *,
    current_payload: dict[str, Any] | None = None,
    last_error: str | None = None,
    upstream_hints: list[str] | None = None,
) -> dict[str, Any]:
    context = {
        "prompt": prompt[:2000],
        "current_payload": current_payload if isinstance(current_payload, dict) else None,
        "last_error": (last_error or "")[:1200],
        "upstream_hints": [str(item)[:600] for item in (upstream_hints or [])][:8],
    }
    return _invoke_rule_llm(
        system_prompt=SYSTEM_PROMPT,
        context=context,
        fallback_prompt=prompt,
        error_prefix="AI 规则生成失败",
    )


def fuse_ai_rule(
    nodes_summary: list[dict[str, Any]],
    wires_summary: list[dict[str, Any]],
    external_ports: dict[str, Any],
    user_prompt: str,
    *,
    current_payload: dict[str, Any] | None = None,
    last_error: str | None = None,
) -> dict[str, Any]:
    """将多个选中积木按用户语义意图融合为单块综合 aiRuleBlock。"""

    if len(nodes_summary) < 2:
        raise AiRuleUnavailable("AI 融合至少需要选中 2 个积木")
    context = {
        "user_prompt": user_prompt[:2000],
        "nodes_summary": nodes_summary[:6],
        "wires_summary": wires_summary[:30],
        "external_ports": external_ports,
        "current_payload": current_payload if isinstance(current_payload, dict) else None,
        "last_error": (last_error or "")[:1200],
    }
    return _invoke_rule_llm(
        system_prompt=FUSE_SYSTEM_PROMPT,
        context=context,
        fallback_prompt=user_prompt,
        error_prefix="AI 积木融合失败",
    )


def summarize_composite(
    nodes_summary: list[dict[str, Any]],
    wires_summary: list[dict[str, Any]],
    ports_summary: list[dict[str, Any]],
) -> dict[str, str]:
    """根据复合积木内部拓扑结构，调用轻量模型自动生成中文模块名与一句话简介。"""

    settings = get_settings()
    if not settings.llm_api_key.strip() or not settings.llm_model.strip() or settings.llm_provider.strip().lower() == "none":
        raise AiRuleUnavailable("未配置主力模型 LLM_API_KEY，请手动输入模块名称与简介")
    transport = HttpxTransport()
    started = time.monotonic()
    parsed: dict[str, str] | None = None

    def send(url: str, *, headers: dict[str, str], json_body: dict[str, Any]):
        remaining = min(20.0, float(settings.llm_timeout_s)) - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("AI 自动命名超时")
        return transport.post(url, headers=headers, json_body=json_body, timeout=remaining)

    def validate(data: dict[str, Any]) -> None:
        nonlocal parsed
        if not isinstance(data, dict):
            raise ValueError("必须返回 JSON 对象")
        title = _text(data.get("title"), 32)
        summary = _text(data.get("summary"), 200)
        if not title:
            raise ValueError("缺少模块名称 title")
        parsed = {"title": title, "summary": summary}

    context = {
        "nodes": nodes_summary[:24],
        "wires": wires_summary[:40],
        "ports": ports_summary[:20],
    }
    try:
        complete_json(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            send=send,
            response_model=JsonObject,
            validator=validate,
            max_retries=1,
            model=settings.llm_model,
            temperature=0.3,
            max_tokens=400,
            **({"extra_body": {"thinking": {"type": "disabled"}}}
               if settings.llm_provider.strip().lower() == "maas" else {}),
            messages=[
                {"role": "system", "content": COMPOSITE_SUMMARY_PROMPT},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc).splitlines()[0][:200] if str(exc) else type(exc).__name__
        raise AiRuleUnavailable(f"AI 自动命名失败：{message}") from exc
    if parsed is None:
        raise AiRuleUnavailable("AI 自动命名失败：模型未返回有效结果")
    return parsed


MAX_COMPOSE_ADD_NODES = 10
MAX_COMPOSE_WIRES = 24


def normalize_compose_plan(
    raw: Any,
    *,
    allowed_types: set[str],
    existing_ids: set[str],
) -> dict[str, Any]:
    """清洗并校验 AI 画布编排与自动连线计划；非法时抛 ValueError。"""

    if not isinstance(raw, dict):
        raise ValueError("编排结果必须是 JSON 对象")

    add_nodes: list[dict[str, Any]] = []
    added_refs: set[str] = set()
    for idx, item in enumerate((raw.get("add_nodes") or [])[:MAX_COMPOSE_ADD_NODES]):
        if not isinstance(item, dict):
            continue
        node_type = _text(item.get("type"), 48)
        if not node_type or (allowed_types and node_type not in allowed_types):
            continue
        ref = _text(item.get("ref"), 40) or f"n{idx + 1}"
        if not KEY_RE.fullmatch(ref) or ref in added_refs or ref in existing_ids:
            ref = f"ai_n{idx + 1}"
        added_refs.add(ref)
        clean_params: dict[str, float] = {}
        raw_params = item.get("params")
        if isinstance(raw_params, dict):
            for k, v in raw_params.items():
                num = _number(v)
                if isinstance(k, str) and KEY_RE.fullmatch(k) and num is not None:
                    clean_params[k] = num
        node_entry: dict[str, Any] = {"ref": ref, "type": node_type}
        label = _text(item.get("label"), 48)
        if label:
            node_entry["label"] = label
        if clean_params:
            node_entry["params"] = clean_params
        text = _text(item.get("text"), 800)
        if text:
            node_entry["text"] = text
        add_nodes.append(node_entry)

    valid_ids = existing_ids | added_refs
    wires: list[dict[str, str]] = []
    seen_targets: set[tuple[str, str]] = set()
    for item in (raw.get("wires") or [])[:MAX_COMPOSE_WIRES]:
        if not isinstance(item, dict):
            continue
        frm = _text(item.get("from"), 48)
        to = _text(item.get("to"), 48)
        if not frm or not to or frm == to or frm not in valid_ids or to not in valid_ids:
            continue
        from_port = _text(item.get("fromPort"), 48) or "out"
        to_port = _text(item.get("toPort"), 48) or "in"
        if (to, to_port) in seen_targets:
            continue
        seen_targets.add((to, to_port))
        wires.append({
            "from": frm,
            "fromPort": from_port,
            "to": to,
            "toPort": to_port,
        })

    if not add_nodes and not wires:
        raise ValueError("编排结果既未添加有效积木也未生成有效连线")

    return {
        "title": _text(raw.get("title"), 48) or "AI 编排实验",
        "summary": _text(raw.get("summary"), 200) or "已按需求自动组合并连接积木。",
        "add_nodes": add_nodes,
        "wires": wires,
    }


def compose_workshop_canvas(
    prompt: str,
    *,
    mode: str,
    catalog: list[dict[str, Any]],
    existing_nodes: list[dict[str, Any]],
    existing_wires: list[dict[str, Any]],
) -> dict[str, Any]:
    """根据用户需求与画布现状，调用主力文本模型编排积木并生成端口兼容连线计划。"""

    settings = get_settings()
    if not settings.llm_api_key.strip() or not settings.llm_model.strip() or settings.llm_provider.strip().lower() == "none":
        raise AiRuleUnavailable("未配置主力模型 LLM_API_KEY，无法使用 AI 自动搭实验与连线")
    transport = HttpxTransport()
    started = time.monotonic()
    allowed_types = {
        str(item.get("type") or "").strip()
        for item in catalog
        if isinstance(item, dict) and str(item.get("type") or "").strip()
    }
    existing_ids = {
        str(item.get("id") or "").strip()
        for item in existing_nodes
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }
    normalized: dict[str, Any] | None = None

    def send(url: str, *, headers: dict[str, str], json_body: dict[str, Any]):
        remaining = float(settings.llm_timeout_s) - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("AI 编排超时，请缩短描述后重试")
        return transport.post(url, headers=headers, json_body=json_body, timeout=min(float(settings.llm_timeout_s), remaining))

    def validate(data: dict[str, Any]) -> None:
        nonlocal normalized
        normalized = normalize_compose_plan(data, allowed_types=allowed_types, existing_ids=existing_ids)

    context = {
        "mode": "wire_existing" if mode == "wire_existing" else "compose",
        "prompt": prompt[:2000],
        "existing_nodes": existing_nodes[:40],
        "existing_wires": existing_wires[:60],
        "catalog": catalog[:120],
    }
    try:
        complete_json(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            send=send,
            response_model=JsonObject,
            validator=validate,
            max_retries=1,
            model=settings.llm_model,
            temperature=0.2,
            max_tokens=2500,
            **({"extra_body": {"thinking": {"type": "disabled"}}}
               if settings.llm_provider.strip().lower() == "maas" else {}),
            messages=[
                {"role": "system", "content": COMPOSE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        kind = type(exc).__name__
        if isinstance(exc, TimeoutError) or "Timeout" in kind:
            message = "模型调用超时，请稍后重试"
        elif "Connection" in kind or "Connect" in kind:
            message = "模型连接失败，请检查后端 LLM_BASE_URL 与网络"
        elif isinstance(exc, ValidationError):
            detail = exc.errors(include_input=False, include_url=False, include_context=False)[0]
            message = detail["msg"].removeprefix("Value error, ")[:300]
        else:
            message = str(exc).splitlines()[0][:300] if str(exc) else kind
        raise AiRuleUnavailable(f"AI 编排实验失败：{message}") from exc
    if normalized is None:
        raise AiRuleUnavailable("AI 编排实验失败：模型未返回有效编排方案")
    return normalized


__all__ = [
    "AiRuleUnavailable",
    "compose_workshop_canvas",
    "fuse_ai_rule",
    "generate_ai_rule",
    "normalize_compose_plan",
    "normalize_rule_payload",
    "summarize_composite",
]
