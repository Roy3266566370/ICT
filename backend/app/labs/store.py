"""实验室文档的状态规范化、计算快照与公开分享裁剪。"""

from __future__ import annotations

import copy
import json
import secrets
from typing import Any, Mapping

from ..schemas.common import to_iso, utc_now
from .recognize import _default_state
from .solvers import MAX_TRACE, evaluate_problem

MODES = {"explore", "guided", "solution"}
MAX_NOTES = 6000
MAX_OBSERVATIONS = 80
MAX_EVENTS = 200
MAX_SCENARIOS = 24
MAX_ATTEMPTS = 40


def new_lab_id() -> str:
    return f"lab_{secrets.token_hex(12)}"


def new_share_id() -> str:
    return secrets.token_urlsafe(12)


def problem_by_id(document: Mapping[str, Any], problem_id: str | None) -> dict[str, Any]:
    problems = document.get("problems") or []
    if not problems:
        return {}
    if problem_id:
        for problem in problems:
            if problem.get("problem_id") == problem_id:
                return dict(problem)
    selected = document.get("selected_problem_id")
    for problem in problems:
        if problem.get("problem_id") == selected:
            return dict(problem)
    return dict(problems[0])


def _coerce_like(value: Any, template: Any) -> Any:
    if isinstance(template, bool):
        return bool(value)
    if isinstance(template, int) and not isinstance(template, bool):
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return template
    if isinstance(template, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            return template
    if isinstance(template, list):
        if isinstance(value, list):
            return value[:12]
        return template
    if isinstance(template, dict):
        return dict(value) if isinstance(value, dict) else template
    return value if isinstance(value, str) else template


def normalize_params(raw: Mapping[str, Any] | None, model: Mapping[str, Any]) -> dict[str, Any]:
    defaults = dict(model.get("defaults") or {})
    result: dict[str, Any] = dict(defaults)
    if not isinstance(raw, Mapping):
        return result
    for key, template in defaults.items():
        if key not in raw:
            continue
        value = _coerce_like(raw.get(key), template)
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            continue
        result[key] = value
    # 限制箱约束结构只读，避免前端通过参数注入额外求解范围。
    if "bounds" in defaults:
        result["bounds"] = defaults["bounds"]
    return result


def _json_size(value: Any) -> int:
    try:
        return len(json.dumps(value, ensure_ascii=False))
    except (TypeError, ValueError):
        return 0


def normalize_state(raw: Mapping[str, Any] | None, model: Mapping[str, Any]) -> dict[str, Any]:
    state = _default_state({"model": model})
    if not isinstance(raw, Mapping):
        return state
    state["params"] = normalize_params(raw.get("params"), model)
    try:
        state["step"] = max(0, min(MAX_TRACE - 1, int(raw.get("step") or 0)))
    except (TypeError, ValueError):
        state["step"] = 0
    mode = str(raw.get("mode") or "explore")
    state["mode"] = mode if mode in MODES else "explore"
    notes = raw.get("notes")
    if isinstance(notes, str):
        state["notes"] = notes[:MAX_NOTES]
    observations = raw.get("observations")
    if isinstance(observations, list):
        state["observations"] = [
            {
                "id": str(item.get("id") or f"obs_{index}")[:64],
                "text": str(item.get("text") or "")[:2400],
                "created_at": item.get("created_at"),
            }
            for index, item in enumerate(observations[:MAX_OBSERVATIONS])
            if isinstance(item, Mapping) and str(item.get("text") or "").strip()
        ]
    events = raw.get("events")
    if isinstance(events, list):
        state["events"] = [
            {
                "id": str(item.get("id") or f"evt_{index}")[:64],
                "kind": str(item.get("kind") or "event")[:40],
                "text": str(item.get("text") or "")[:600],
                "created_at": item.get("created_at"),
            }
            for index, item in enumerate(events[-MAX_EVENTS:])
            if isinstance(item, Mapping)
        ]
    scenarios = raw.get("scenarios")
    if isinstance(scenarios, list):
        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(scenarios[:MAX_SCENARIOS]):
            if not isinstance(item, Mapping):
                continue
            normalized.append(
                {
                    "id": str(item.get("id") or f"scn_{index}")[:64],
                    "name": str(item.get("name") or f"情景 {index + 1}")[:80],
                    "params": normalize_params(item.get("params"), model),
                    "created_at": item.get("created_at"),
                    "kind": str(item.get("kind") or "exploration")[:24],
                    "summary": str(item.get("summary") or "")[:600],
                }
            )
        if normalized:
            state["scenarios"] = normalized
    active = raw.get("active_scenario_id")
    if isinstance(active, str):
        state["active_scenario_id"] = active
    attempts = raw.get("attempts")
    if isinstance(attempts, list):
        state["attempts"] = [
            {
                "id": str(item.get("id") or f"att_{index}")[:64],
                "answer": str(item.get("answer") or "")[:1200],
                "correct": bool(item.get("correct")),
                "feedback": str(item.get("feedback") or "")[:2000],
                "field": str(item.get("field") or "numeric")[:32],
                "created_at": item.get("created_at"),
            }
            for index, item in enumerate(attempts[-MAX_ATTEMPTS:])
            if isinstance(item, Mapping)
        ]
    return state


def recompute_state(problem: Mapping[str, Any], state: Mapping[str, Any]) -> dict[str, Any]:
    """把当前参数交给确定性求解器，保存结果与完整执行轨迹。"""

    result = dict(state)
    ambiguities = (problem.get("recognition") or {}).get("ambiguities") or []
    if any(item.get("severity") == "blocking" and not item.get("resolved") and not (
        item.get('id') == 'source_formula_confirmation' and
        (problem.get('ai_solution') or {}).get('agent_understanding') and
        (problem.get('ai_solution') or {}).get('verification') == 'kernel') for item in ambiguities):
        result["evaluated"] = {
            "status": "blocked",
            "reason": "关键条件尚未核对，先确认后再求解。",
            "computed_at": to_iso(utc_now()),
            "trace": [],
        }
        return result
    try:
        evaluation = evaluate_problem(problem.get("model") or {}, state.get("params") or {})
    except Exception as exc:  # noqa: BLE001 - 保留学生记录，明确标注当前参数无法计算
        result["evaluated"] = {
            "status": "unavailable",
            "reason": f"{type(exc).__name__}: {exc}",
            "computed_at": to_iso(utc_now()),
            "trace": [],
        }
        return result
    trace = evaluation.get("trace") or []
    result["evaluated"] = {
        "status": "ok",
        "computed_at": to_iso(utc_now()),
        "headline": evaluation.get("headline"),
        "metrics": (evaluation.get("metrics") or [])[:8],
        "checks": (evaluation.get("checks") or [])[:8],
        "stop_reason": evaluation.get("stop_reason"),
        "trace": trace[-MAX_TRACE:],
        "trace_count": len(trace),
        "answer": evaluation.get("answer"),
    }
    return result


def save_state(
    document: dict[str, Any],
    problem_id: str | None,
    raw_state: Mapping[str, Any] | None,
) -> dict[str, Any]:
    problem = problem_by_id(document, problem_id)
    if not problem:
        raise ValueError("题目不存在")
    target = next(
        (item for item in document.get("problems") or [] if item.get("problem_id") == problem.get("problem_id")),
        None,
    )
    if target is None:
        raise ValueError("题目不存在")
    model = target.get("model") or {}
    state = normalize_state(raw_state, model)
    state = recompute_state(target, state)
    target["states"] = state
    if _json_size(state) > 240_000:
        # 只保留最近的记录，防止一次保存把文档撑得不可用。
        state["attempts"] = state.get("attempts", [])[-10:]
        state["events"] = state.get("events", [])[-80:]
        state["observations"] = state.get("observations", [])[-30:]
        state["scenarios"] = state.get("scenarios", [])[-9:]
        state["evaluated"]["trace"] = (state["evaluated"].get("trace") or [])[-80:]
    target["states"] = state
    document["selected_problem_id"] = target["problem_id"]
    document["status"] = target.get("status")
    document["subject"] = target.get("subject")
    return state


def active_problem(document: Mapping[str, Any]) -> dict[str, Any]:
    return problem_by_id(document, document.get("selected_problem_id"))


def summary(document: Mapping[str, Any]) -> dict[str, Any]:
    problem = active_problem(document)
    return {
        "lab_id": document.get("lab_id"),
        "title": document.get("title"),
        "subject": document.get("subject") or problem.get("subject"),
        "subject_label": problem.get("subject_label"),
        "status": document.get("status") or problem.get("status"),
        "ai_verification": (problem.get("ai_solution") or {}).get("verification"),
        "problem_count": document.get("problem_count") or len(document.get("problems") or []),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
    }


def shared_snapshot(document: Mapping[str, Any], *, share_id: str) -> dict[str, Any]:
    """公开只读快照：不含会话、文件系统路径与内部位置。"""

    snapshot = copy.deepcopy(document)
    snapshot["share_id"] = share_id
    snapshot["published_at"] = to_iso(utc_now())
    for item in (snapshot.get("source") or {}).get("files") or []:
        item.pop("stored_name", None)
    for problem in snapshot.get("problems") or []:
        for page in problem.get("source_pages") or []:
            page.pop("stored_name", None)
    return snapshot


def preview_keys(document: Mapping[str, Any]) -> set[str]:
    keys: set[str] = set()
    for page in (document.get("source") or {}).get("pages") or []:
        key = page.get("image_key")
        if isinstance(key, str) and key:
            keys.add(key)
    return keys


__all__ = [
    "active_problem",
    "new_lab_id",
    "new_share_id",
    "normalize_params",
    "normalize_state",
    "preview_keys",
    "problem_by_id",
    "recompute_state",
    "save_state",
    "shared_snapshot",
    "summary",
]
