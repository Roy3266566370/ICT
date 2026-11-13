"""独立验收：来源/语义、数学/程序、交互/视觉三类检查分开记录。

报告绑定被测 bundle / branch / artifact 的哈希与内核版本；截图看起来正常不证明
结果正确，模型再次回答也不充当独立重算。浏览器证据缺省时明确记 ``not_covered``。
"""

from __future__ import annotations

import logging
from typing import Any, Mapping, Sequence

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiTaskRecord
from ..ispec.validator import validate_ispec
from ..settings import get_settings
from . import REGISTRY_VERSION
from .branches import branch_hash, create_branch
from .contracts import ContractError, schema_available, validate_contract, validate_view_ast
from .evaluation import KERNEL_VERSION, evaluate_node, numeric_output
from .registry import REGISTRY
from .repair import repair_bundle
from .store import (
    get_branch_row,
    get_bundle,
    mark_reports_stale,
    save_bundle,
    save_report,
)
from .types import (
    InteractionBundle,
    PlanReviewItem,
    ValidationCase,
    ValidationReport,
)
from .util import hash_json, new_id, now_iso

logger = logging.getLogger(__name__)

RUNTIME_VERSION = "ppt-ai.runtime.1"
ATOL = 1e-8
RTOL = 1e-6


class _Rules:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def add(
        self,
        rule_id: str,
        category: str,
        status: str,
        message: str,
        *,
        evidence: Any = None,
    ) -> None:
        self.items.append(
            {
                "rule_id": rule_id,
                "category": category,
                "status": status,
                "message": message[:1000],
                "evidence": evidence,
            }
        )

    def summary(self) -> dict[str, int]:
        result = {"pass": 0, "fail": 0, "not_covered": 0, "warn": 0}
        for item in self.items:
            status = str(item["status"])
            if status in result:
                result[status] += 1
        return result


def _source_rules(bundle: InteractionBundle, rules: _Rules) -> None:
    if not bundle.compiled.nodes:
        rules.add("source.nodes", "source", "fail", "bundle 没有编译节点")
        return
    for node in bundle.compiled.nodes:
        anchor = node.source
        if anchor.material_id != bundle.material_id:
            rules.add(f"source.{node.node_id}.material", "source", "fail", "来源材料与 bundle 不一致")
        if not anchor.excerpt.strip():
            rules.add(f"source.{node.node_id}.excerpt", "source", "fail", "缺少原文摘录")
        if anchor.bbox.x + anchor.bbox.w > 1.000001 or anchor.bbox.y + anchor.bbox.h > 1.000001:
            rules.add(f"source.{node.node_id}.bbox", "source", "fail", "bbox 超出页面")
        for parameter in node.parameters:
            if parameter.provenance.origin_type in ("native", "ocr", "user_input") and not parameter.provenance.evidence.strip():
                rules.add(
                    f"source.{node.node_id}.{parameter.id}.evidence",
                    "source",
                    "fail",
                    "直接来源参数缺少证据",
                )
    rules.add("source.anchors", "source", "pass", f"{len(bundle.compiled.nodes)} 个节点均绑定来源锚点")


def _math_rules(bundle: InteractionBundle, rules: _Rules) -> None:
    for node in bundle.compiled.nodes:
        if not REGISTRY.has(node.operator_id):
            rules.add(f"math.{node.node_id}.operator", "math", "fail", f"算子未登记：{node.operator_id}")
            continue
        parameter_errors = REGISTRY.validate_parameters(node.operator_id, node.parameters)
        if parameter_errors:
            rules.add(
                f"math.{node.node_id}.parameters",
                "math",
                "fail",
                "；".join(parameter_errors),
            )
        seed = {parameter.concept_id: parameter.default for parameter in node.parameters}
        evaluated = evaluate_node(node, seed)
        if evaluated["violations"]:
            rules.add(
                f"math.{node.node_id}.evaluate",
                "math",
                "fail",
                "默认值求值存在违反条件",
                evidence=evaluated["violations"],
            )
        else:
            rules.add(f"math.{node.node_id}.evaluate", "math", "pass", "默认值求值通过确定性内核")
        for check in evaluated["checks"]:
            status = str(check.get("status") or "")
            if status == "fail":
                rules.add(
                    f"math.{node.node_id}.check.{check.get('id', '')}",
                    "math",
                    "fail",
                    str(check.get("label") or "检查失败") + "：" + str(check.get("detail") or ""),
                )
            elif status == "warn":
                rules.add(
                    f"math.{node.node_id}.check.{check.get('id', '')}",
                    "math",
                    "warn",
                    str(check.get("detail") or "检查有告警"),
                )


def _program_rules(bundle: InteractionBundle, rules: _Rules) -> None:
    if not schema_available("manifest") or not schema_available("view"):
        rules.add("program.schema", "program", "fail", "契约或校验器不可用")
        return
    try:
        validate_contract("manifest", bundle.model_dump(mode="json"))
        rules.add("program.manifest", "program", "pass", "bundle 通过 manifest Schema")
    except ContractError as exc:
        rules.add("program.manifest", "program", "fail", f"bundle 契约失败：{exc}")
    if bundle.registry_version != REGISTRY_VERSION:
        rules.add("program.registry", "program", "warn", "能力注册表版本与当前内核不一致")
    for node in bundle.compiled.nodes:
        bindings = [parameter.concept_id for parameter in node.parameters]
        for view in node.views:
            ast = view.get("ast") if isinstance(view, Mapping) else None
            if ast is None:
                continue
            try:
                validate_view_ast(ast, registered_bindings=bindings)
                rules.add(f"program.{node.node_id}.{view.get('view_id')}", "program", "pass", "ViewAST 通过白名单校验")
            except ContractError as exc:
                rules.add(f"program.{node.node_id}.{view.get('view_id')}", "program", "fail", f"ViewAST 失败：{exc}")
    for spec in bundle.compiled.ispecs:
        errors = validate_ispec(spec)
        if errors:
            rules.add(
                f"program.ispec.{spec.get('object_id')}",
                "program",
                "fail",
                "iSpec 投影不合法：" + "；".join(errors[:3]),
            )
    encoded = len(str(bundle.compiled.resources).encode("utf-8"))
    if encoded > get_settings().ppt_ai_max_artifact_bytes:
        rules.add("program.resources", "program", "fail", "新增视图资源超过 8MB 上限")
    else:
        rules.add("program.resources", "program", "pass", f"资源清单 {encoded} 字节，未超限")


def _interaction_rules(bundle: InteractionBundle, cases: Sequence[ValidationCase], rules: _Rules) -> None:
    for node in bundle.compiled.nodes:
        if node.operator_id == "explain.text":
            continue
        if not node.parameters:
            rules.add(f"interaction.{node.node_id}.controls", "interaction", "fail", "交互节点没有可调参数")
            continue
        if not node.views:
            rules.add(f"interaction.{node.node_id}.views", "interaction", "fail", "交互节点没有视图")
        numeric = [parameter for parameter in node.parameters if parameter.type in ("number", "integer")]
        missing_ranges = [parameter.id for parameter in numeric if parameter.min is None or parameter.max is None]
        if missing_ranges:
            rules.add(
                f"interaction.{node.node_id}.ranges",
                "interaction",
                "warn",
                "数值参数缺少范围，前端只能使用输入框：" + "、".join(missing_ranges),
            )
        else:
            rules.add(f"interaction.{node.node_id}.controls", "interaction", "pass", "默认值/上下界可被控件覆盖")
        if not node.offline_supported:
            rules.add(f"interaction.{node.node_id}.offline", "interaction", "warn", "该节点未声明离线可计算")
    for case in cases:
        node_id = str(case.target.get("node_id") or "")
        node = next((item for item in bundle.compiled.nodes if item.node_id == node_id), None)
        if node is None:
            rules.add(f"case.{case.case_id}", "interaction", "fail", f"用例节点不存在：{node_id}")
            continue
        values = dict(bundle.seed_values)
        values.update(case.inputs)
        for action in case.actions:
            if action.get("event") == "set_parameter":
                target = str(action.get("target") or "")
                if target:
                    values[target] = action.get("value")
        evaluated = evaluate_node(node, values)
        if evaluated["violations"]:
            rules.add(f"case.{case.case_id}", "math", "fail", "用例输入导致求值违反条件", evidence=evaluated["violations"])
            continue
        expected = case.expected or {}
        failed = False
        for key, expected_value in expected.items():
            if key == "checks":
                continue
            actual = numeric_output(evaluated["result"], str(key))
            if isinstance(expected_value, (int, float)) and not isinstance(expected_value, bool):
                if actual is None:
                    rules.add(f"case.{case.case_id}.{key}", "math", "fail", "没有可比较的数值输出")
                    failed = True
                    continue
                tolerance = max(ATOL, case.tolerance, RTOL * abs(float(expected_value)))
                residual = abs(actual - float(expected_value))
                status = "pass" if residual <= tolerance else "fail"
                rules.add(
                    f"case.{case.case_id}.{key}",
                    "math",
                    status,
                    f"实际 {actual:.8g}，期望 {expected_value}，残差 {residual:.3g}",
                    evidence={"residual": residual, "tolerance": tolerance},
                )
                failed = failed or status == "fail"
            else:
                actual_raw = evaluated["result"].get(key)
                status = "pass" if actual_raw == expected_value else "fail"
                rules.add(f"case.{case.case_id}.{key}", "math", status, f"实际 {actual_raw!r}，期望 {expected_value!r}")
                failed = failed or status == "fail"
        if not failed and not expected:
            rules.add(f"case.{case.case_id}", "interaction", "pass", "动作序列执行完成，没有计算错误")


def _client_browser_evidence(browser: Any) -> dict[str, Any] | None:
    """通用验收只接受客户端自报证据，服务端权威字段一律剥离。"""

    if not isinstance(browser, Mapping):
        return None
    return {key: value for key, value in browser.items() if key != "server_verified"}


def _browser_rules(browser: Mapping[str, Any] | None, rules: _Rules) -> dict[str, Any]:
    payload = dict(browser or {})
    status = str(payload.get("status") or "skipped")
    if status == "passed":
        rules.add("visual.browser", "visual", "pass", "浏览器操作证据通过")
    elif status == "failed":
        rules.add("visual.browser", "visual", "fail", "浏览器操作证据失败")
    else:
        rules.add("visual.browser", "visual", "not_covered", "未执行浏览器试玩；截图不能替代独立检查。")
    viewport = payload.get("viewport")
    if status == "passed" and viewport not in (None, "1600x1000,390x844", "both"):
        rules.add("visual.viewports", "visual", "warn", "浏览器证据只覆盖单一视口，建议同时检查 1600×1000/390×844")
    return {
        "status": status if status in ("passed", "failed", "skipped") else "skipped",
        "server_verified": payload.get("server_verified") is True,
        "checks": [item for item in payload.get("checks", []) if isinstance(item, dict)][:200],
        "screenshots": [str(item) for item in payload.get("screenshots", [])][:50],
        "viewport": viewport if isinstance(viewport, str) else None,
        "note": str(payload.get("note") or ""),
    }


def _semantic_review(bundle: InteractionBundle) -> list[PlanReviewItem]:
    items: list[PlanReviewItem] = []
    selected = {node.option_id for node in bundle.compiled.nodes}
    for plan in bundle.plans:
        for option in plan.options:
            if option.option_id not in selected:
                continue
            if option.support_status == "needs_review":
                for item in option.review_items:
                    if item.required:
                        items.append(item)
            elif option.support_status == "unsupported":
                items.append(
                    PlanReviewItem(
                        item_id=f"unsupported_{option.option_id}",
                        kind="other",
                        prompt=option.support_reason or "方案不受支持，需人工核对。",
                        required=True,
                    )
                )
    if bundle.graph.conflicts:
        items.append(
            PlanReviewItem(
                item_id="graph_conflicts",
                kind="link",
                prompt=f"存在 {len(bundle.graph.conflicts)} 个跨页关联冲突，需人工确认。",
                required=True,
            )
        )
    return items[:100]


def validate_bundle(
    bundle: InteractionBundle,
    cases: Sequence[ValidationCase] = (),
    *,
    browser: Mapping[str, Any] | None = None,
    branch: Mapping[str, Any] | None = None,
) -> ValidationReport:
    rules = _Rules()
    _source_rules(bundle, rules)
    _math_rules(bundle, rules)
    _program_rules(bundle, rules)
    _interaction_rules(bundle, cases, rules)
    browser_payload = _browser_rules(browser, rules)
    review = _semantic_review(bundle)
    summary = rules.summary()
    if summary["fail"]:
        status = "failed"
    elif review or summary["not_covered"] or summary["warn"]:
        status = "needs_review"
    else:
        status = "passed"
    branch_id = str(branch.get("branch_id")) if branch and branch.get("branch_id") else None
    branch_hash_value = str(branch.get("evaluation_hash")) if branch and branch.get("evaluation_hash") else ""
    report = ValidationReport(
        report_id=new_id("report"),
        material_id=bundle.material_id,
        bundle_id=bundle.bundle_id,
        branch_id=branch_id,
        artifact_id=None,
        bundle_hash=hash_json(bundle.model_dump(mode="json")),
        branch_hash=branch_hash_value,
        kernel_version=KERNEL_VERSION,
        runtime_version=RUNTIME_VERSION,
        status=status,  # type: ignore[arg-type]
        summary=summary,
        rules=rules.items,
        semantic_review=review,
        browser=browser_payload,
        repair=None,
        created_at=now_iso(),
        stale=False,
    )
    validate_contract("validation", report.model_dump(mode="json"))
    return report


def handle_verify_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    bundle_id = str(payload.get("bundle_id") or "")
    branch_id = str(payload.get("branch_id") or "") or None
    bundle = get_bundle(db, bundle_id, task.session_id, material.id)
    branch_row = get_branch_row(db, branch_id, task.session_id, material.id) if branch_id else None
    if branch_row is not None and branch_row.bundle_id != bundle.bundle_id:
        raise ValueError("分支不属于该 bundle")
    expected = payload.get("expected_branch_revision")
    if branch_row is not None and isinstance(expected, int) and expected != branch_row.revision:
        return {
            "__status__": "superseded",
            "__stage__": "superseded",
            "reason": f"分支已更新（当前 revision={branch_row.revision}）。",
        }
    cases = [ValidationCase.model_validate(item) for item in payload.get("cases", []) if isinstance(item, Mapping)]
    # 通用验收只保存客户端自报证据；server_verified 只能由 ai_learn_verify 的
    # 服务端受信浏览器任务写入，这里强制剥离，避免客户端伪造受信报告。
    browser = _client_browser_evidence(payload.get("browser"))
    branch_dict = (
        {
            "branch_id": branch_row.id,
            "revision": branch_row.revision,
            "evaluation_hash": branch_hash(branch_row),
        }
        if branch_row is not None
        else None
    )
    mark_reports_stale(db, bundle.bundle_id)
    report = validate_bundle(bundle, cases, browser=browser, branch=branch_dict)
    report_row = save_report(db, session_id=task.session_id, report=report)
    result: dict[str, Any] = {
        "report_id": report.report_id,
        "status": report.status,
        "summary": report.summary,
        "bundle_id": bundle.bundle_id,
        "branch_id": branch_id,
        "bundle_hash": report.bundle_hash,
    }
    auto_repair = bool(payload.get("auto_repair"))
    if auto_repair and report.status == "failed":
        repaired_bundle, repair_record = repair_bundle(bundle, report)
        report.repair = repair_record
        report_row.report = report.model_dump(mode="json")
        db.flush()
        if repaired_bundle is not None:
            save_bundle(db, session_id=task.session_id, material_id=material.id, bundle=repaired_bundle)
            repaired_branch = create_branch(
                db,
                session_id=task.session_id,
                material_id=material.id,
                bundle=repaired_bundle,
                values=branch_row.canonical_values if branch_row is not None else None,
                parent_branch_id=branch_row.id if branch_row is not None else None,
                status="candidate",
            )
            after = validate_bundle(
                repaired_bundle,
                cases,
                browser=browser,
                branch={
                    "branch_id": repaired_branch.id,
                    "revision": repaired_branch.revision,
                    "evaluation_hash": branch_hash(repaired_branch),
                },
            )
            save_report(db, session_id=task.session_id, report=after)
            repair_record = {
                **repair_record,
                "candidate_branch_id": repaired_branch.id,
                "after_report_id": after.report_id,
                "after_status": after.status,
            }
            report.repair = repair_record
            result.update(
                {
                    "repair": repair_record,
                    "candidate_bundle_id": repaired_bundle.bundle_id,
                    "candidate_branch_id": repaired_branch.id,
                    "after_report_id": after.report_id,
                    "after_status": after.status,
                }
            )
        else:
            result["repair"] = repair_record
    return {
        "__status__": "succeeded" if result.get("status") != "failed" else "failed",
        "__stage__": "validated",
        **result,
    }


__all__ = [
    "RUNTIME_VERSION",
    "handle_verify_task",
    "validate_bundle",
]
