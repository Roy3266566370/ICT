"""陌生 PPT 验收集的端到端回归测试（任务 P1-09）。

三条硬性断言（对应交付要求）：

1. 预期成功类材料至少 8 份产出 iSpec；
2. 纯文字 / 纯图片 / 组合内纯文字材料**不得**产出 iSpec（防回退伪造）；
3. 所有产出的 iSpec 通过 ``contracts/spec/ispec.schema.json`` 校验。

另附语料规模、文件隔离、转换可消费性等辅助断言。测试复用
``backend/scripts/run_corpus.py`` 的评估函数，保证"报告口径"与"测试口径"一致。
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path

import pytest

# backend/tests/corpus/test_corpus_pipeline.py -> backend/
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ispec import validate_ispec  # noqa: E402
from scripts import build_corpus, run_corpus  # noqa: E402

#: 明确"当前架构必须不识别"的材料类别。
NO_STRUCTURE_KINDS = frozenset({"text_only", "picture_chart", "group_textbox"})
#: 语料规模与分集规模。
EXPECTED_TOTAL = 20
EXPECTED_PER_SPLIT = 10


def _manifest_files_missing(manifest: dict[str, object]) -> bool:
    """manifest 中登记的 pptx 是否全部落地（缺失则需重建语料）。"""
    for split in ("dev", "eval"):
        entries = manifest.get(split)
        if not isinstance(entries, list):
            return True
        for entry in entries:
            if not isinstance(entry, dict):
                return True
            relative = entry.get("file")
            if not isinstance(relative, str):
                return True
            if not (run_corpus.CORPUS_DIR / relative).is_file():
                return True
    return False


@pytest.fixture(scope="session")
def manifest() -> dict[str, object]:
    """加载语料清单；缺失或不完整时按确定性方式重新生成。"""
    if not run_corpus.MANIFEST_PATH.is_file():
        build_corpus.build_corpus()
    payload = run_corpus.load_manifest()
    if _manifest_files_missing(payload):
        payload = build_corpus.build_corpus()
    return payload


@pytest.fixture(scope="session")
def results(manifest: dict[str, object]) -> list[run_corpus.CaseResult]:
    """跑一遍无 COM 的端到端链路（解析 → iSpec → Schema → 可消费性）。"""
    return run_corpus.evaluate_corpus(manifest, export_visual=False)


def test_expected_pass_materials_produce_ispec(results: Sequence[run_corpus.CaseResult]) -> None:
    """断言 1：预期成功类材料至少 8 份产出 iSpec。"""
    detected = [case for case in results if case.expect == "should_pass" and case.ispec_count > 0]
    expected = [case for case in results if case.expect == "should_pass"]
    assert len(expected) >= EXPECTED_TOTAL // 2, "should_pass 材料数量不足，语料配比异常"
    assert len(detected) >= 8, (
        f"预期成功材料只有 {len(detected)} 份产出 iSpec（< 8）；"
        + "；".join(f"{case.file}: {case.failure_reason}" for case in expected if case.ispec_count == 0)
    )


def test_text_and_picture_materials_do_not_fabricate_ispec(
    results: Sequence[run_corpus.CaseResult],
) -> None:
    """断言 2：无原生结构的材料不得产出 iSpec，且预期失败材料全部为 0。"""
    offenders = [
        case
        for case in results
        if case.kind in NO_STRUCTURE_KINDS and case.ispec_count > 0
    ]
    assert not offenders, (
        "以下无结构材料产出了 iSpec，疑似回退到公共示例或伪造交互："
        + "；".join(f"{case.file}={case.ispec_count}" for case in offenders)
    )

    should_fail = [case for case in results if case.expect == "should_fail"]
    assert len(should_fail) >= 2, "语料缺少预期失败样本，无法验证系统边界"
    for case in should_fail:
        assert case.ispec_count == 0, f"{case.file}: 预期失败却产出 {case.ispec_count} 条 iSpec"
        assert not case.found, f"{case.file}: recognition.found 应为 False"


def test_all_ispecs_pass_schema_validation(results: Sequence[run_corpus.CaseResult]) -> None:
    """断言 3：所有产出的 iSpec 通过 Schema 校验，且不含转换期问题。"""
    failures: list[str] = []
    schema_error_total = 0
    consumable_error_total = 0
    for case in results:
        for spec in case.ispecs:
            messages = validate_ispec(spec)
            schema_error_total += len(messages)
            if messages:
                failures.append(f"{case.file}/{spec.get('object_id')}: {'; '.join(messages)}")
        consumable_error_total += len(case.consumable_issues)
        if case.consumable_issues:
            failures.append(f"{case.file}: {'; '.join(case.consumable_issues)}")

    assert schema_error_total == 0, "Schema 校验错误：\n" + "\n".join(failures)
    assert consumable_error_total == 0, "iSpec 转换/消费问题：\n" + "\n".join(failures)


def test_corpus_is_file_isolated_and_bounded(
    manifest: dict[str, object], results: Sequence[run_corpus.CaseResult]
) -> None:
    """辅助断言：20 份、dev/eval 各 10、文件名不重叠、单份 < 1MB。"""
    assert manifest.get("total") == EXPECTED_TOTAL

    dev_entries = manifest.get("dev")
    eval_entries = manifest.get("eval")
    assert isinstance(dev_entries, list) and len(dev_entries) == EXPECTED_PER_SPLIT
    assert isinstance(eval_entries, list) and len(eval_entries) == EXPECTED_PER_SPLIT

    dev_names = {str(item.get("file")) for item in dev_entries if isinstance(item, dict)}
    eval_names = {str(item.get("file")) for item in eval_entries if isinstance(item, dict)}
    assert not dev_names & eval_names, "开发集与验收集存在同名文件，未按整份文件隔离"
    assert all(name.startswith("dev/") for name in dev_names)
    assert all(name.startswith("eval/") for name in eval_names)
    assert len(results) == EXPECTED_TOTAL

    for entry in [*dev_entries, *eval_entries]:
        assert isinstance(entry, dict)
        path = run_corpus.CORPUS_DIR / str(entry["file"])
        assert path.is_file(), f"语料缺失：{path}"
        assert path.stat().st_size <= 1024 * 1024, f"{path.name} 超过 1MB 入库阈值"


def test_boundary_and_multi_page_materials(results: Sequence[run_corpus.CaseResult]) -> None:
    """辅助断言：60 页边界不触发 LIMIT_EXCEEDED；多页混合只在有结构页产出。"""
    by_file = {case.file: case for case in results}

    boundary = by_file["eval/eval_10_max_pages_60.pptx"]
    assert boundary.parse_error == ""
    assert boundary.pages == 60, "60 页边界材料页数异常"
    assert boundary.ispec_count == 1
    assert boundary.pages_with_ispec == 1

    mixed = by_file["eval/eval_09_multi_page_mix.pptx"]
    assert mixed.pages == 5
    assert mixed.ispec_count == 2
    assert mixed.pages_with_ispec == 2

    group_table = by_file["dev/dev_07_group_table.pptx"]
    assert group_table.ispec_count == 1, "组合内表格应被递归展开识别"
    group_chart = by_file["eval/eval_07_group_chart.pptx"]
    assert group_chart.ispec_count == 1, "组合内图表应被递归展开识别"