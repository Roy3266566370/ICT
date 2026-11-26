"""AI 智能计算方块的受限结构化生成：复用现有主力文本模型配置。"""

from __future__ import annotations

import json
import math
import re
import time
from typing import Any

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
    if FORBIDDEN_CODE.search(code):
        raise ValueError("code 包含被禁止的浏览器、网络、定时器或异步能力")
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
    return result


SYSTEM_PROMPT = """你是定象坊的 AI 规则方块生成器。只输出一个 JSON 对象，不输出 Markdown 或解释。
字段：version=1、prompt、title、summary、textLabel(可选)、defaultText(可选)、controls、presets、preferredView、code、verificationNote(可选)。
要求：
1. code 必须是字符串，内容为同步纯函数 function run({ text, params, upstream, rand }) { ... return { data, frames }; }。
2. 禁止 DOM、网络、定时器、localStorage、eval、new Function、import、require、async/await；只能使用普通 JavaScript、Number、String、Math 等纯计算能力。
3. frames 为 2–20 帧数组，每帧至少包含中文 title 和 summary。显示字段包括：
   - shapes: { viewBox: [400,240], items: [...] }，最多 160 个 2D 图元，适合力学、几何、电路。图元 kind 和坐标：circle(cx,cy,r)、rect(x,y,w,h,rx?)、line/arrow(x1,y1,x2,y2)、polygon(points:[[x,y],...])、text(x,y,text,size?,anchor?)。可用 fill、stroke、strokeWidth、opacity 和 label。
   - grid: { cells: number[][], min?, max?, rowLabels?, colLabels?, palette?: 'heat'|'diverging'|'binary', showValues?, activeCell?: [row,col] }，最大 32×32，行列从 0 开始，适合迷宫、动态规划、卷积、生命游戏。
   - graph: { nodes:[{id,label,x,y,active?}], edges:[{from,to,label?,active?}] }，坐标按 0–100；series: [{label,values:number[]}]；timeline: [{label,segments:[{label,start,end}]}]；columns 与 rows 用于表格。
4. controls 为 1–6 个参数，每项含 key、label、value；数值型可带 min/max/step，离散型带 options。
5. presets 为 2–3 组教学情景，每项必须含 label（不要用 name），params 的 key 必须来自 controls；可带 text。
6. preferredView 只能是 auto/shapes/grid/chart/graph/timeline/table。
7. verificationNote 写一条可手算核对的具体算例。
8. 只做确定性计算。随机模拟使用 rand()，可提供整数 seed 控件。禁止 Math.random、当前时间或外部数据。
9. upstream_hints 提供参考数据的端口、类型和字段。当它非空时优先读取 upstream[0]，按 kind 及字段计算，并在未连线或数据暂不可用时回退到示例或参数。把核心有限标量写入 data.value，供下游数值端口使用。"""


def generate_ai_rule(
    prompt: str,
    *,
    current_payload: dict[str, Any] | None = None,
    last_error: str | None = None,
    upstream_hints: list[str] | None = None,
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
        normalized = normalize_rule_payload(data, fallback_prompt=prompt)
        if len(normalized["controls"]) < 1:
            raise ValueError("至少需要 1 个 controls 参数")
        if len(normalized.get("presets") or []) < 2:
            raise ValueError("需要提供 2–3 组 presets 预设")
        if not normalized.get("verificationNote"):
            raise ValueError("缺少 verificationNote 手算核对说明")

    context = {
        "prompt": prompt[:2000],
        "current_payload": current_payload if isinstance(current_payload, dict) else None,
        "last_error": (last_error or "")[:1200],
        "upstream_hints": [str(item)[:600] for item in (upstream_hints or [])][:8],
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
            max_tokens=6000,
            **({"extra_body": {"thinking": {"type": "disabled"}}}
               if settings.llm_provider.strip().lower() == "maas" else {}),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
            ],
        )
    except Exception as exc:  # noqa: BLE001 - convert provider/validation errors to one API message
        kind = type(exc).__name__
        if isinstance(exc, TimeoutError) or "Timeout" in kind:
            message = "模型调用超时，请稍后重试或缩短描述"
        elif "Connection" in kind or "Connect" in kind:
            message = "模型连接失败，请检查后端 LLM_BASE_URL、网络，或展开代码抽屉手动编写规则"
        else:
            message = str(exc).splitlines()[0][:300] if str(exc) else kind
        raise AiRuleUnavailable(f"AI 规则生成失败：{message}") from exc
    if normalized is None:
        raise AiRuleUnavailable("AI 规则生成失败：模型没有返回可用规则")
    return normalized


__all__ = ["AiRuleUnavailable", "generate_ai_rule", "normalize_rule_payload"]
