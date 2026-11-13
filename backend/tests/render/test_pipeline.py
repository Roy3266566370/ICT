"""渲染编排的降级行为测试（spec §3.1）。

不启动真实 PowerPoint / LibreOffice：用 monkeypatch 替换两个引擎的
``is_available`` / ``render_pptx``，只验证"优先级与降级链"的确定性。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.render import pipeline
from app.render.errors import ENGINE_COM, ENGINE_LIBREOFFICE, ENGINE_SVG, RenderError
from app.render.engine_select import EngineChoice, select_engine


def _write_page(out_dir: str | Path, page_no: int = 1) -> Path:
    """在给定目录写一张合法的 1920x1080 页图（尺寸校验用）。"""

    directory = Path(out_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"s{page_no:02d}.png"
    Image.fromarray(
        np.full((1080, 1920, 3), 246, dtype=np.uint8), mode="RGB"
    ).save(path)
    return path


def test_select_engine_explicit_svg_is_low_fidelity() -> None:
    """显式指定 svg_fallback → 直接返回 low，不去探测引擎。"""

    choice = select_engine("svg_fallback")
    assert choice.engine == ENGINE_SVG
    assert choice.fidelity == "low"
    assert choice.produces_page_images is False
    assert choice.as_dict()["engine"] == ENGINE_SVG


def test_falls_back_to_libreoffice_when_com_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """COM 失败 → 自动用 LibreOffice，fidelity 保持 high，并记录失败引擎。"""

    monkeypatch.setattr(pipeline.engine_com, "is_available", lambda: True)
    monkeypatch.setattr(pipeline.engine_libreoffice, "is_available", lambda: True)

    def com_boom(*args: object, **kwargs: object) -> list[Path]:
        raise RenderError("render_failed", "PowerPoint 导出失败（测试）")

    def lo_ok(pptx: object, out_dir: object, **kwargs: object) -> list[Path]:
        return [_write_page(out_dir)]  # type: ignore[arg-type]

    monkeypatch.setattr(pipeline.engine_com, "render_pptx", com_boom)
    monkeypatch.setattr(pipeline.engine_libreoffice, "render_pptx", lo_ok)

    source = tmp_path / "deck.pptx"
    source.write_bytes(b"not-a-real-pptx")
    outcome = pipeline.render_material(
        source,
        "mat_test",
        renders_dir=tmp_path / "renders",
        extract_images=False,
    )

    assert outcome.engine == ENGINE_LIBREOFFICE
    assert outcome.fidelity == "high"
    assert outcome.render_status == pipeline.RENDER_STATUS_OK
    assert outcome.page_count == 1
    assert any("powerpoint_com" in message for message in outcome.errors)
    assert outcome.manifest()["render_engine"] == ENGINE_LIBREOFFICE


def test_all_engines_failed_degrades_to_svg_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """两个引擎都失败 → 不抛异常，返回 svg_fallback + low + 原因。"""

    monkeypatch.setattr(pipeline.engine_com, "is_available", lambda: True)
    monkeypatch.setattr(pipeline.engine_libreoffice, "is_available", lambda: True)

    def boom(*args: object, **kwargs: object) -> list[Path]:
        raise RenderError("render_failed", "引擎崩溃（测试）")

    monkeypatch.setattr(pipeline.engine_com, "render_pptx", boom)
    monkeypatch.setattr(pipeline.engine_libreoffice, "render_pptx", boom)

    source = tmp_path / "deck.pptx"
    source.write_bytes(b"not-a-real-pptx")
    outcome = pipeline.render_material(
        source,
        "mat_test",
        renders_dir=tmp_path / "renders",
        extract_images=False,
    )

    assert outcome.engine == ENGINE_SVG
    assert outcome.fidelity == "low"
    assert outcome.page_count == 0
    assert outcome.render_status == pipeline.RENDER_STATUS_FALLBACK
    # 降级也必须"可读"：结构化内容仍能展示
    assert outcome.readable is True
    assert any("svg_fallback" in message for message in outcome.errors)


def test_render_material_writes_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """渲染完成后写 render.json，且字段可供只读接口直接消费。"""

    monkeypatch.setattr(pipeline.engine_com, "is_available", lambda: True)
    monkeypatch.setattr(pipeline.engine_libreoffice, "is_available", lambda: False)
    monkeypatch.setattr(
        pipeline.engine_com,
        "render_pptx",
        lambda pptx, out_dir, **kwargs: [_write_page(out_dir, 1), _write_page(out_dir, 2)],
    )

    source = tmp_path / "deck.pptx"
    source.write_bytes(b"not-a-real-pptx")
    outcome = pipeline.render_material(
        source,
        "mat_manifest",
        renders_dir=tmp_path / "renders",
        extract_images=False,
        regions=[
            {"region_id": "rgn_x", "page": 1, "bbox": {"x": 1, "y": 1, "w": 2, "h": 2}}
        ],
    )

    manifest_path = tmp_path / "renders" / "mat_manifest" / "render.json"
    assert manifest_path.is_file()
    assert outcome.erased == {1: tmp_path / "renders" / "mat_manifest" / "pages" / "s01_erased.png"}

    import json

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert payload["render_engine"] == ENGINE_COM
    assert payload["page_count"] == 2
    assert payload["pages"][0]["file"] == "pages/s01.png"
    assert payload["erase"][0]["page"] == 1


def test_engine_choice_is_plain_mapping() -> None:
    """``select_engine`` 的返回值可无损转成 ``{engine, fidelity}``。"""

    choice = EngineChoice(ENGINE_COM, "high")
    assert choice.as_dict() == {"engine": ENGINE_COM, "fidelity": "high", "reason": None}