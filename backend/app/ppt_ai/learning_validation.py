"""服务端受信浏览器验证（``ppt-learning.1`` §8.3）。

由后端生成临时离线 HTML，调用项目 Node/Playwright 脚本在桌面与手机视口实际点击
学习入口、切换场景、检查溢出与私有字段泄漏。前端自报的 ``browser.status=passed``
不会产生 ``server_verified`` 报告，因此不能通过发布门槛。
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Mapping

from sqlalchemy.orm import Session

from ..db.models import MaterialRecord
from ..db.ppt_ai_models import PptAiBranchRecord, PptAiTaskRecord
from ..settings import REPO_ROOT, get_settings
from .branches import branch_hash, derived_kind
from .learning_types import LearningPublishSelection
from .snapshots import freeze_interactions, public_projection
from .store import get_branch_row, get_bundle, mark_reports_stale, save_report
from .types import ValidationReport
from .util import hash_json, now_iso
from .validation import validate_bundle

logger = logging.getLogger(__name__)

SCRIPT_VERSION = "ppt-learning.browser.1"


class LearningValidationError(ValueError):
    pass


def _first_learning_page(bundle) -> int:
    nodes = [node for node in bundle.compiled.nodes if node.source.page >= 1]
    return nodes[0].source.page if nodes else 1


def _run_browser(
    html_path: Path, out_path: Path, page_no: int, snapshot_hash: str
) -> dict[str, Any]:
    node = shutil.which("node")
    script = REPO_ROOT / "frontend" / "scripts" / "verify-ppt-ai-learning.mjs"
    if node is None or not script.is_file():
        return {
            "status": "skipped",
            "server_verified": False,
            "viewport": None,
            "checks": [{"id": "node", "status": "not_covered", "message": "Node 或验证脚本不可用"}],
            "results": [],
        }
    timeout = float(get_settings().ppt_ai_learning_browser_timeout_s)
    arguments = json.dumps(
        {
            "htmlPath": str(html_path),
            "outPath": str(out_path),
            "pageNo": page_no,
            "snapshotHash": snapshot_hash,
            "runtimeVersion": SCRIPT_VERSION,
        },
        ensure_ascii=False,
    )
    try:
        completed = subprocess.run(
            [node, str(script), arguments],
            cwd=str(REPO_ROOT / "frontend"),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {
            "status": "skipped",
            "server_verified": False,
            "viewport": None,
            "checks": [
                {"id": "timeout", "status": "not_covered", "message": f"浏览器验证超过 {timeout:g} 秒"}
            ],
            "results": [],
        }
    if not out_path.is_file():
        return {
            "status": "failed",
            "server_verified": False,
            "viewport": None,
            "checks": [
                {
                    "id": "script",
                    "status": "fail",
                    "message": f"验证脚本未产出证据（exit={completed.returncode}）：{(completed.stderr or '')[:300]}",
                }
            ],
            "results": [],
        }
    evidence = json.loads(out_path.read_text(encoding="utf-8"))
    checks = [
        {
            "id": f"viewport.{item.get('name', 'unknown')}",
            "status": "pass" if item.get("status") == "passed" else "fail",
            "message": (
                f"{item.get('width')}×{item.get('height')}："
                + ("学习入口与场景可操作" if item.get("status") == "passed" else str(item.get("reason") or "未通过"))
            ),
            "evidence": item,
        }
        for item in evidence.get("results", [])
        if isinstance(item, Mapping)
    ]
    evidence["checks"] = checks
    if completed.returncode != 0 and evidence.get("status") == "passed":
        evidence["status"] = "failed"
        evidence["server_verified"] = False
    return evidence


def handle_learning_verify_task(
    db: Session,
    material: MaterialRecord,
    task: PptAiTaskRecord,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    selection = LearningPublishSelection(
        mode="baseline",
        bundle_id=str(payload.get("bundle_id") or ""),
        expected_bundle_revision=int(payload.get("expected_bundle_revision") or 1),
        branch_id=str(payload.get("branch_id") or ""),
        expected_branch_revision=int(payload.get("expected_branch_revision") or 1),
        expected_document_revision=payload.get("expected_document_revision"),
        selected_learning_item_ids=[str(item) for item in payload.get("selected_learning_item_ids") or []],
        selected_experiment_ids=[],
    )
    bundle = get_bundle(db, selection.bundle_id or "", task.session_id, material.id)
    branch = get_branch_row(db, selection.branch_id or "", task.session_id, material.id)
    if branch.bundle_id != bundle.bundle_id:
        raise LearningValidationError("分支不属于选定 bundle")
    if selection.expected_branch_revision != branch.revision:
        raise LearningValidationError(f"分支已更新（当前 revision={branch.revision}）")
    if not selection.selected_learning_item_ids:
        selection = selection.model_copy(
            update={"selected_learning_item_ids": [node.node_id for node in bundle.compiled.nodes]}
        )
    frozen = freeze_interactions(
        db,
        material=material,
        session_id=task.session_id,
        bundle_id=bundle.bundle_id,
        branch_id=branch.id,
        expected_revision=branch.revision,
        expected_bundle_revision=bundle.bundle_revision,
        learning_item_ids=selection.selected_learning_item_ids,
        experiment_ids=[],
        capabilities={"can_explain_online": False, "can_ask_online": False, "can_explore_locally": True, "can_save_cloud": False, "can_manage": False},
    )
    if frozen is None:
        raise LearningValidationError("没有可验证的学习内容")
    from ..api.routes_publish import build_snapshot, render_standalone_html

    snapshot = build_snapshot(db, material)
    snapshot["ppt_ai"] = public_projection(frozen)
    html_text = render_standalone_html(snapshot, material.id)
    page_no = _first_learning_page(bundle)
    temp_dir = Path(tempfile.mkdtemp(prefix="xiangsheng-learning-verify-"))
    try:
        html_path = temp_dir / "learning.html"
        out_path = temp_dir / "evidence.json"
        html_path.write_text(html_text, encoding="utf-8")
        evidence = _run_browser(html_path, out_path, page_no, frozen.content_hash)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    browser_payload = {
        "status": evidence.get("status") if evidence.get("status") in ("passed", "failed", "skipped") else "skipped",
        "server_verified": evidence.get("server_verified") is True,
        "checks": evidence.get("checks", []),
        "screenshots": [],
        "viewport": evidence.get("viewport"),
        "script_version": SCRIPT_VERSION,
        "snapshot_hash": frozen.content_hash,
        "checked_at": evidence.get("checked_at") or now_iso(),
    }
    report = validate_bundle(
        bundle,
        [],
        browser=browser_payload,
        branch={
            "branch_id": branch.id,
            "revision": branch.revision,
            "evaluation_hash": branch_hash(branch),
        },
    )
    report = report.model_copy(
        update={
            "bundle_hash": hash_json(bundle.model_dump(mode="json")),
            "branch_hash": branch_hash(branch),
            "runtime_version": SCRIPT_VERSION,
        }
    )
    mark_reports_stale(db, bundle.bundle_id)
    save_report(db, session_id=task.session_id, report=report)
    task.input_hash = frozen.content_hash
    return {
        "__status__": "succeeded" if report.status in ("passed", "needs_review") else "failed",
        "__stage__": "learning_verified",
        "report_id": report.report_id,
        "status": report.status,
        "browser": browser_payload,
        "summary": report.summary,
        "snapshot_hash": frozen.content_hash,
        "branch_hash": branch_hash(branch),
    }


__all__ = ["LearningValidationError", "handle_learning_verify_task"]
