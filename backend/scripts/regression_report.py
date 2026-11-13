#!/usr/bin/env python
"""回归分数记录（对齐整改文件 P3-14 的可实现部分）。

整改文件 P3-14 写的是"用 VisPlotBench 协议做回归测试：有可重复的分数曲线"。
本机没有 VisPlotBench 数据集（外部依赖），因此这里做一个**同口径的替代**：
对 `fixtures/corpus` 的 20 份材料重复执行「解析 → iSpec → Schema 校验」，
把每次的分数追加到 `verify/regression_history.jsonl`，并打印与上一次的差。

用法（仓库根）::

    python backend/scripts/regression_report.py            # 跑一次并记录
    python backend/scripts/regression_report.py --show     # 只看历史，不跑

指标口径与 `verify/corpus_report.md` 一致，便于交叉核对：
- recognition_rate        有 iSpec 份数 / should_pass 份数
- interaction_rate         views ≥ 1 的份数 / 全部份数
- schema_error_total       产出 iSpec 后 Schema 校验失败的总数
- fallback_violations      纯文字/纯图片类却产出 iSpec 的份数（必须为 0）
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / "verify" / "regression_history.jsonl"
CORPUS = ROOT / "fixtures" / "corpus" / "manifest.json"

sys.path.insert(0, str(ROOT / "backend"))


def _load_manifest() -> dict[str, Any]:
    if not CORPUS.exists():
        raise SystemExit(f"找不到语料清单：{CORPUS}（先跑 python backend/scripts/build_corpus.py）")
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def _run_once() -> dict[str, Any]:
    from app.ispec import build_ispecs_detailed  # noqa: WPS433 (运行时导入，避免无依赖时导入失败)
    from app.parsers.pptx_parser import parse_pptx

    manifest = _load_manifest()
    entries: list[dict[str, Any]] = []
    for split in ("dev", "eval"):
        for item in manifest.get(split, []):
            rel = item["file"]
            path = ROOT / "fixtures" / "corpus" / rel
            expect = item.get("expect", "should_pass")
            entry: dict[str, Any] = {"file": rel, "expect": expect}
            try:
                material, slides = parse_pptx(str(path))
                result = build_ispecs_detailed(slides, material_id=material.get("material_id"))
                entry["ispec_count"] = len(result.ispecs)
                entry["views"] = sum(len(s.get("views", [])) for s in result.ispecs)
                entry["schema_errors"] = len(result.errors)
                entry["found"] = bool(result.recognition.get("found"))
            except Exception as exc:  # 单份失败不应中断整轮
                entry.update({"ispec_count": 0, "views": 0, "schema_errors": 0, "found": False,
                              "error": f"{type(exc).__name__}: {exc}"})
            entries.append(entry)

    should_pass = [e for e in entries if e["expect"] == "should_pass"]
    should_fail = [e for e in entries if e["expect"] == "should_fail"]
    recognized = [e for e in should_pass if e.get("ispec_count", 0) > 0]
    interactive = [e for e in entries if e.get("views", 0) > 0]
    fallback = [e for e in should_fail if e.get("ispec_count", 0) > 0]

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "corpus_total": len(entries),
        "recognition_rate": round(len(recognized) / len(should_pass), 4) if should_pass else 0.0,
        "interaction_rate": round(len(interactive) / len(entries), 4) if entries else 0.0,
        "schema_error_total": sum(e.get("schema_errors", 0) for e in entries),
        "fallback_violations": len(fallback),
        "failures": sorted(e["file"] for e in should_fail),
        "entries": entries,
    }


def _append(record: dict[str, Any]) -> None:
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    with HISTORY.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def _last_before_current() -> dict[str, Any] | None:
    if not HISTORY.exists():
        return None
    lines = [ln for ln in HISTORY.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    return json.loads(lines[-2])


def _print_compare(current: dict[str, Any], previous: dict[str, Any] | None) -> None:
    keys = ("recognition_rate", "interaction_rate", "schema_error_total", "fallback_violations")
    for key in keys:
        now = current[key]
        if previous is None:
            print(f"  {key:22s} {now}")
        else:
            old = previous.get(key)
            delta = "—" if not isinstance(old, (int, float)) else f"{now - old:+.4f}" if isinstance(now, float) else f"{now - old:+d}"
            print(f"  {key:22s} {now}  (上次 {old}, Δ {delta})")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--show", action="store_true", help="只打印历史，不执行")
    args = parser.parse_args()

    if args.show:
        if not HISTORY.exists():
            print("暂无历史")
            return 0
        for line in HISTORY.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                print(row["generated_at"], "| recognition", row["recognition_rate"],
                      "| interaction", row["interaction_rate"], "| schema_err", row["schema_error_total"],
                      "| fallback", row["fallback_violations"])
        return 0

    previous = _last_before_current() if HISTORY.exists() else None
    current = _run_once()
    _append(current)

    print(f"语料 {current['corpus_total']} 份 | {current['generated_at']}")
    _print_compare(current, previous)
    print("  失败清单（预期失败，0 条 iSpec 属正常）:", ", ".join(current["failures"]) or "无")
    over_fallback = current["fallback_violations"]
    print("  回退伪造检查:", "PASS" if over_fallback == 0 else f"FAIL（{over_fallback} 份被伪造出 iSpec）")
    print(f"  历史记录 → {HISTORY}")
    return 0 if over_fallback == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())