"""上传大小边界：真实课件常见 22–67MB，必须按 70MB 口径受理。"""

from __future__ import annotations

import io
from pathlib import Path

from starlette.datastructures import UploadFile

from app.api.routes_materials import _save_upload_limited


def test_22mb_upload_is_accepted_after_limit_raise(tmp_path: Path) -> None:
    payload = b"x" * (22 * 1024 * 1024)
    upload = UploadFile(file=io.BytesIO(payload), filename="stranger_01_linalg_chapter1.pptx")
    target = tmp_path / "upload.pptx"

    size = _save_upload_limited(upload, target)

    assert size == len(payload)
    assert target.stat().st_size == len(payload)
