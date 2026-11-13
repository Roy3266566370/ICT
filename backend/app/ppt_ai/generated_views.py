"""专用视图生成试验（T09）：只读输入 → 隔离程序 → 经校验的 ViewAST。

默认关闭。交付内容包括：

- 一个确有必要的“积分面积 + 分割矩形”专用视图程序；
- 静态白名单检查（禁止网络、DOM、凭据、无限循环与动态执行）；
- 前端在 opaque-origin sandbox iframe + Worker 中执行，主线程超时终止并降级；
- artifact 按哈希寻址，默认 ``pending``，只有客户端隔离验收通过才可标记 accepted。
"""

from __future__ import annotations

import logging
import re
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from ..settings import get_settings
from . import VIEW_CONTRACT_VERSION
from .client import PPTAIClient, PPTAIError
from .contracts import ContractError, validate_view_ast
from .evaluation import evaluate_node
from .reconstruction import calculus_view_ast
from .registry import REGISTRY
from .store import get_branch_row, get_bundle, save_artifact
from .types import GeneratedViewArtifact
from .util import hash_json, new_id, now_iso

logger = logging.getLogger(__name__)

FORBIDDEN_PROGRAM_TOKENS = (
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "import(",
    "require(",
    "process",
    "document",
    "window",
    "parent",
    "top.",
    "localStorage",
    "sessionStorage",
    "cookie",
    "eval(",
    "Function(",
    "while(true)",
    "while (true)",
    "for(;;)",
    "for (;;)",
    "constructor",
    "prototype",
    "globalThis",
    "Deno",
    "shadowRoot",
    "postMessage",
)
MAX_PROGRAM_CHARS = 20000


class GeneratedViewError(ValueError):
    pass


def validate_program_static(program: str) -> None:
    if not isinstance(program, str) or not program.strip():
        raise GeneratedViewError("视图程序为空")
    if len(program) > MAX_PROGRAM_CHARS:
        raise GeneratedViewError("视图程序超过长度上限")
    lowered = program.lower()
    for token in FORBIDDEN_PROGRAM_TOKENS:
        if token.lower() in lowered:
            raise GeneratedViewError(f"视图程序包含禁止能力：{token}")


#: 专用“积分面积 + 分割矩形”视图程序（只读 projection → ViewAST）。
AREA_PROGRAM = r"""
function render(input) {
  var series = (input.series || []).filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); });
  var rects = (input.rects || []).filter(function (r) { return r && isFinite(r.x0) && isFinite(r.x1) && isFinite(r.height); });
  var domain = input.domain || {x_min: -1, x_max: 1};
  var W = 720, H = 420, P = 52;
  var xs = series.map(function (p) { return p[0]; });
  var ys = series.map(function (p) { return p[1]; });
  var xMin = Math.min.apply(null, xs.concat([domain.x_min]));
  var xMax = Math.max.apply(null, xs.concat([domain.x_max]));
  var yMin = Math.min.apply(null, ys.concat([0]));
  var yMax = Math.max.apply(null, ys.concat([1]));
  if (xMax - xMin < 1e-9) { xMax = xMin + 1; }
  if (yMax - yMin < 1e-9) { yMax = yMin + 1; }
  var pad = (yMax - yMin) * 0.08;
  yMin -= pad; yMax += pad;
  function mapX(x) { return P + (x - xMin) / (xMax - xMin) * (W - 2 * P); }
  function mapY(y) { return H - P - (y - yMin) / (yMax - yMin) * (H - 2 * P); }
  var nodes = [
    {id: 'axes', type: 'axes', x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax,
     ticks: [[P, H - P], [W - P, H - P]], style: {stroke: '#94a3b8', strokeWidth: 1}},
    {id: 'area_curve', type: 'curve', x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax,
     series: series.map(function (p) { return [mapX(p[0]), mapY(p[1])]; }),
     style: {stroke: '#1d4ed8', strokeWidth: 2.4}}
  ];
  rects.slice(0, 240).forEach(function (rect, index) {
    var left = mapX(rect.x0), right = mapX(rect.x1);
    var top = mapY(Math.max(0, rect.height)), base = mapY(0);
    nodes.push({id: 'rect_' + index, type: 'rect', x: left, y: Math.min(top, base),
      w: Math.max(0.5, right - left), h: Math.max(0.5, Math.abs(base - top)),
      style: {fill: '#dbeafe', stroke: '#93c5fd', strokeWidth: 0.6, opacity: 0.72}});
  });
  var metrics = (input.metrics || []).slice(0, 6);
  if (metrics.length) {
    nodes.push({id: 'metrics_panel', type: 'rect', x: P - 8, y: 14,
      w: 270, h: 24 + metrics.length * 20, style: {fill: '#ffffff', stroke: '#e2e8f0', strokeWidth: 1, opacity: 0.9}});
  }
  metrics.forEach(function (metric, index) {
    nodes.push({id: 'metric_' + index, type: 'text', x: P, y: 28 + index * 20,
      text: String(metric.label || '') + '：' + String(metric.value || ''),
      style: {fill: '#334155', fontSize: 13, textAnchor: 'start'}});
  });
  if (nodes.length > 2000) { throw new Error('AST node limit'); }
  return {version: 'ppt-ai.view.1', width: W, height: H, interactions: [], nodes: nodes};
}
"""


def _projection(node, values) -> dict[str, Any]:
    evaluated = evaluate_node(node, values)
    result = evaluated["result"]
    params = {parameter.id: values.get(parameter.concept_id, parameter.default) for parameter in node.parameters}
    lower = float(params.get("lower", result.get("domain", {}).get("x_min", 0.0)))
    upper = float(params.get("upper", result.get("domain", {}).get("x_max", 1.0)))
    n = max(2, min(80, int(params.get("n", 8))))
    rects = []
    series = result.get("series") if isinstance(result.get("series"), list) else []
    if series:
        def at(x: float) -> float:
            nearest = min(series, key=lambda point: abs(float(point.get("x", 0)) - x))
            return float(nearest.get("y") or 0.0)
        dx = (upper - lower) / n
        for index in range(n):
            x0 = lower + index * dx
            x1 = x0 + dx
            rects.append({"x0": x0, "x1": x1, "height": at((x0 + x1) / 2)})
    projection = {
        "series": [
            [float(point.get("x", 0.0)), float(point.get("y", 0.0))]
            for point in series
            if isinstance(point, Mapping) and isinstance(point.get("y"), (int, float))
        ][:2000],
        "rects": rects,
        "domain": result.get("domain") or {"x_min": lower, "x_max": upper},
        "metrics": [item for item in result.get("metrics", []) if isinstance(item, Mapping)][:8],
    }
    return projection


def _artifact_ast(node, projection: Mapping[str, Any], values) -> dict[str, Any]:
    # 服务端生成可信对照 AST；客户端执行程序后仍需经过同一 Schema。
    series = [{"x": point[0], "y": point[1]} for point in projection.get("series", [])]
    ast = calculus_view_ast(
        title=node.title,
        series=series,
        domain=projection.get("domain") or {"x_min": -1, "x_max": 1},
        rects=projection.get("rects", []),
        labels=[f"{item.get('label', '')}: {item.get('value', '')}" for item in projection.get("metrics", [])],
    )
    return ast


def generate_artifact(
    bundle,
    branch,
    *,
    node_id: str,
    requirement: str,
    client: PPTAIClient | None = None,
    budget=None,
    on_model_attempt=None,
) -> GeneratedViewArtifact:
    if not get_settings().ppt_ai_generated_views_enabled:
        raise GeneratedViewError("专用视图生成试验未开启（PPT_AI_GENERATED_VIEWS_ENABLED=false）")
    node = next((item for item in bundle.compiled.nodes if item.node_id == node_id), None)
    if node is None:
        raise GeneratedViewError(f"节点不存在：{node_id}")
    if node.operator_id not in ("lab.calculus.integral", "lab.calculus.derivative", "lab.calculus.expression"):
        raise GeneratedViewError("该节点不需要专用视图；请使用声明式视图")
    values = dict(branch.canonical_values or bundle.seed_values)
    try:
        from .evaluation import evaluate_model

        snapshot = evaluate_model(
            bundle,
            values,
            overrides=getattr(branch, "overrides_json", None) or None,
        )
        values.update(snapshot.derived_values)
        for parameter in node.parameters:
            binding = parameter.binding
            if binding.mode == "linked" and binding.concept_id in snapshot.derived_values:
                values[parameter.concept_id] = snapshot.derived_values[binding.concept_id]
    except (ValueError, TypeError):
        pass
    projection = _projection(node, values)
    program = AREA_PROGRAM
    source = "deterministic-template"
    # 可选 AI 代码生成：仍只作为待验收 artifact，绝不在后端执行。
    if client is not None and client.available() and requirement.strip():
        from .types import CallBudget

        budget = budget or CallBudget(max_calls=1)
        try:
            response = client.generate_json(
                "generated_view",
                {
                    "requirement": requirement[:1000],
                    "operator_id": node.operator_id,
                    "projection_keys": list(projection),
                    "read_only_contract": "render(input) -> ViewAST",
                },
                VIEW_CONTRACT_VERSION,
                budget,
                instructions="只生成 render(input) 函数，读取只读 input，返回 ViewAST；不得访问网络、DOM、Cookie 或动态执行。",
                on_attempt=on_model_attempt,
            )
            candidate = response.data.get("program")
            if isinstance(candidate, str) and len(candidate) <= MAX_PROGRAM_CHARS:
                validate_program_static(candidate)
                program = candidate
                source = "model"
        except (PPTAIError, GeneratedViewError) as exc:
            logger.info("专用视图 AI 代码生成跳过：%s", exc)
    validate_program_static(program)
    ast = _artifact_ast(node, projection, values)
    validate_view_ast(ast, registered_bindings=[parameter.concept_id for parameter in node.parameters])
    content = {
        "program": program,
        "ast": ast,
        "resources": [],
        "view_contract_version": VIEW_CONTRACT_VERSION,
        "node_id": node_id,
        "requirement": requirement[:1000],
    }
    return GeneratedViewArtifact(
        artifact_id=new_id("artifact"),
        material_id=bundle.material_id,
        bundle_id=bundle.bundle_id,
        content_hash=hash_json(content),
        view_contract_version=VIEW_CONTRACT_VERSION,
        program=program,
        program_language="javascript",
        ast=ast,
        resources=[],
        supported_interactions=[],
        offline_supported=True,
        acceptance_status="pending",
        isolation={
            "iframe_sandbox": "allow-scripts",
            "opaque_origin": True,
            "worker": True,
            "timeout_ms": get_settings().ppt_ai_view_timeout_ms,
            "max_nodes": 2000,
            "max_message_bytes": 256 * 1024,
            "csp": "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src data:",
            "generator": source,
            "requirement": requirement[:1000],
            "node_id": node_id,
            "projection": projection,
        },
        created_at=now_iso(),
    )


def handle_codegen_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    bundle_id = str(payload.get("bundle_id") or "")
    branch_id = str(payload.get("branch_id") or "")
    node_id = str(payload.get("node_id") or "")
    requirement = str(payload.get("requirement") or "")
    if not bundle_id or not node_id:
        raise ValueError("缺少 bundle_id 或 node_id")
    bundle = get_bundle(db, bundle_id, task.session_id, material.id)
    branch = get_branch_row(db, branch_id, task.session_id, material.id) if branch_id else None
    if branch is None:
        raise ValueError("专用视图必须绑定一个分支")
    if branch.bundle_id != bundle.bundle_id:
        raise ValueError("分支不属于该 bundle")
    from .model_calls import attempt_callback
    from .types import CallBudget

    budget = CallBudget(
        max_calls=int(get_settings().ppt_ai_task_max_calls),
        used_calls=int(task.budget_used or 0),
    )
    artifact = generate_artifact(
        bundle,
        branch,
        node_id=node_id,
        requirement=requirement,
        client=PPTAIClient(),
        budget=budget,
        on_model_attempt=attempt_callback(task.id),
    )
    task.budget_used = budget.used_calls
    save_artifact(db, session_id=task.session_id, artifact=artifact)
    return {
        "__status__": "succeeded",
        "__stage__": "artifact_ready",
        "artifact_id": artifact.artifact_id,
        "content_hash": artifact.content_hash,
        "acceptance_status": artifact.acceptance_status,
        "offline_supported": artifact.offline_supported,
        "node_id": node_id,
        "isolation": artifact.isolation,
        "budget_used": budget.used_calls,
    }


__all__ = [
    "AREA_PROGRAM",
    "FORBIDDEN_PROGRAM_TOKENS",
    "GeneratedViewError",
    "generate_artifact",
    "handle_codegen_task",
    "validate_program_static",
]
