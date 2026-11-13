"""``C-RUN@1`` 运行快照与检查报告的 Pydantic v2 实现（plan §2.2.2）。

与 ``contracts/schemas/run.schema.json`` 逐字对应：

- ``RunSnapshot``：运行快照不可变，回放只读取 ``input_snapshot``（R10-AC5）。
- ``ValidationReport``：绑定 ``object_id + model_version + revision``，可重复查询（R11-AC4）；
  ``is_stale=true`` 时前端必须显示"过期"，不得显示为通过（R10-AC7）。
- ``summary`` 只统计 ``pass/fail/not_covered``；``stale`` 由 ``is_stale`` 单独表达（C-04）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .knowledge_object import KernelVersion, KnowledgeObject

CheckStatus = Literal["pass", "fail", "not_covered", "stale"]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, protected_namespaces=())


class CheckItem(_StrictModel):
    """单条检查项：``expected`` 来自独立实现，``actual`` 来自确定性内核。"""

    check_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    status: CheckStatus
    expected: str
    actual: str
    detail: str | None


class CheckSummary(_StrictModel):
    """检查计数；必须与 ``items`` 中对应状态的数量一致。"""

    #: ``pass`` 是 Python 关键字，字段名加下划线并用 alias 保持线上键名一致。
    pass_: int = Field(ge=0, alias="pass", serialization_alias="pass")
    fail: int = Field(ge=0)
    not_covered: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True, protected_namespaces=())

    def as_dict(self) -> dict[str, int]:
        """按契约键名输出，``pass`` 是 Python 关键字故此方法统一转换。"""

        return {"pass": self.pass_, "fail": self.fail, "not_covered": self.not_covered}


class ValidationReport(_StrictModel):
    """独立校验报告（R11）。"""

    report_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    model_version: int = Field(ge=1)
    revision: int = Field(ge=0)
    kernel_version: KernelVersion
    validation_profile: str = Field(min_length=1)
    items: list[CheckItem]
    summary: CheckSummary
    is_stale: bool
    created_at: datetime

    @model_validator(mode="after")
    def _summary_matches_items(self) -> "ValidationReport":
        """``summary`` 必须与 ``items`` 计数一致（§2.2.2 语义）。"""

        counted = {"pass": 0, "fail": 0, "not_covered": 0}
        for item in self.items:
            if item.status in counted:
                counted[item.status] += 1
        declared = self.summary.as_dict()
        if declared != counted:
            raise ValueError(
                f"summary 与 items 计数不一致：声明 {declared}，实际 {counted}"
            )
        return self

    def to_payload(self) -> dict[str, Any]:
        """序列化为契约 JSON（``by_alias`` 让 ``pass`` 键名与契约一致）。"""

        return self.model_dump(mode="json", by_alias=True)


class RunSnapshot(_StrictModel):
    """运行快照：冻结 ``model_version`` / ``revision`` / ``input_snapshot`` / ``result``。"""

    run_id: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    model_version: int = Field(ge=1)
    revision: int = Field(ge=0)
    kernel_version: KernelVersion
    input_snapshot: KnowledgeObject
    result: Any
    validation_report: ValidationReport | None
    created_at: datetime

    @model_validator(mode="after")
    def _snapshot_consistency(self) -> "RunSnapshot":
        """快照内的对象与运行头必须指向同一个 object / model_version / revision。"""

        snapshot = self.input_snapshot
        if snapshot.object_id != self.object_id:
            raise ValueError("input_snapshot.object_id 必须与 run.object_id 一致")
        if snapshot.model_version != self.model_version:
            raise ValueError("input_snapshot.model_version 必须与 run.model_version 一致")
        if snapshot.revision != self.revision:
            raise ValueError("input_snapshot.revision 必须与 run.revision 一致")
        if snapshot.kernel_version != self.kernel_version:
            raise ValueError("input_snapshot.kernel_version 必须与 run.kernel_version 一致")
        report = self.validation_report
        if report is not None:
            if report.object_id != self.object_id:
                raise ValueError("validation_report.object_id 必须与 run.object_id 一致")
            if (
                report.model_version != self.model_version
                or report.revision != self.revision
            ):
                raise ValueError(
                    "validation_report 的 model_version/revision 必须与运行快照一致"
                )
        return self


__all__ = [
    "CheckItem",
    "CheckStatus",
    "CheckSummary",
    "RunSnapshot",
    "ValidationReport",
]
