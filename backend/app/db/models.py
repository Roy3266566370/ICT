"""9 张共享表的 ORM 模型（plan §2.1.1、T7 验收 1）+ P2 追加的 ``shares``。

表清单：``sessions / materials / pages / elements / knowledge_objects /
object_versions / jobs / runs / checks``。"字段只保留首版需要项"（§2.1.1），因此：

- 时间一律存 ISO 8601 UTC 字符串（``2026-11-01T00:00:00Z``），与响应体逐字一致，
  避免 SQLite 的 naive datetime 时区问题；比较用 ``schemas.common.parse_iso``。
- ``config`` / ``candidates`` / ``document`` / ``result`` / ``report`` 等结构化内容用
  ``JSON`` 列存，形状由 ``contracts/schemas`` 约束，不在 SQL 层重复建模。
- 不做 ORM 关系映射：级联删除由路由显式执行，语义更可控（R2-AC4 立即不可访问）。

字段名与契约同名（``material_id``、``object_id``、``model_version``、``revision``…），
仅内部主键用 ``id``，对外序列化时映射为 ``*_id``。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

#: id 列长度：``ses_``/``mat_``/``obj_``/``job_``/``run_``/``rep_`` + 32 hex。
ID_LENGTH = 64
#: ISO 8601 UTC 最长 20 字符，留余量。
TIMESTAMP_LENGTH = 32


class SessionRecord(Base):
    """访客会话（R2-AC1）：只存服务端凭据与保留策略，不存任何用户身份。"""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    csrf_token: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False, index=True)
    retention_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)


class MaterialRecord(Base):
    """材料：一次上传或一次示例克隆得到的处理单元（§1.1）。"""

    __tablename__ = "materials"
    __table_args__ = (
        Index("ix_materials_session_created", "session_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="processing")
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    clone_of_example_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: 规则化候选对象（CandidateObject[]），T11 的 map_candidates 产物。
    candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False, index=True)


class PageRecord(Base):
    """材料页：页码、标题、段落、摘录与首图引用（R4-AC1）。"""

    __tablename__ = "pages"
    __table_args__ = (
        Index("ix_pages_material_page_no", "material_id", "page_no", unique=True),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    page_no: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    paragraphs: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    image_asset_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)


class ElementRecord(Base):
    """页内元素：文本/图片/形状 + EMU 坐标，供来源高亮与受鉴权取图（R4-AC2/AC4）。"""

    __tablename__ = "elements"
    __table_args__ = (
        Index("ix_elements_material_page", "material_id", "page_no"),
        Index("ix_elements_material_asset", "material_id", "asset_id"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    page_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("pages.id"), nullable=False
    )
    page_no: Mapped[int] = mapped_column(Integer, nullable=False)
    element_id: Mapped[str] = mapped_column(String(ID_LENGTH), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    asset_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    #: 图片文件位置（如 ``fixtures/ppt/s06_3.png``），只由解析产物写入，禁止前端拼接。
    asset_file: Mapped[str | None] = mapped_column(String(512), nullable=True)


class KnowledgeObjectRecord(Base):
    """知识对象当前版本（C-KO@1 的完整文档 + 检索用冗余列）。"""

    __tablename__ = "knowledge_objects"
    __table_args__ = (
        Index("ix_knowledge_objects_session", "session_id"),
        Index("ix_knowledge_objects_material", "material_id"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str | None] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=True
    )
    template_id: Mapped[str] = mapped_column(String(32), nullable=False)
    kernel_version: Mapped[str] = mapped_column(String(32), nullable=False)
    model_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validation_profile: Mapped[str] = mapped_column(String(64), nullable=False)
    #: KnowledgeObject 完整文档（snake_case，C-KO@1）。
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class ObjectVersionRecord(Base):
    """对象结构版本历史：``model_version`` 变化时留档，供运行回放与审计（R5-AC4）。"""

    __tablename__ = "object_versions"
    __table_args__ = (
        Index("ix_object_versions_object_model", "object_id", "model_version", unique=True),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    object_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("knowledge_objects.id"), nullable=False
    )
    model_version: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class JobRecord(Base):
    """后台任务事实（R3-AC3/AC4）：阶段、尝试次数、进度、失败原因。"""

    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_session_created", "session_id", "created_at"),
        Index("ix_jobs_material", "material_id"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    object_id: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    #: 仅可计量阶段给值；``rendering`` 阶段必须为 NULL（§2.3.5）。
    progress_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class RunRecord(Base):
    """运行快照（C-RUN@1）：不可变，回放只读 ``input_snapshot``（R10-AC5）。"""

    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_object_created", "object_id", "created_at"),
        Index("ix_runs_session", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    object_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("knowledge_objects.id"), nullable=False
    )
    model_version: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    kernel_version: Mapped[str] = mapped_column(String(32), nullable=False)
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    result: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSON, nullable=True)
    validation_report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class CheckRecord(Base):
    """独立校验报告（C-RUN@1 ValidationReport），按 object 回查（R11-AC4）。"""

    __tablename__ = "checks"
    __table_args__ = (
        Index("ix_checks_object_created", "object_id", "created_at"),
        Index("ix_checks_session", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    object_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("knowledge_objects.id"), nullable=False
    )
    model_version: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    kernel_version: Mapped[str] = mapped_column(String(32), nullable=False)
    validation_profile: Mapped[str] = mapped_column(String(64), nullable=False)
    report: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class ShareRecord(Base):
    """发布快照（P2-10：``POST /materials/{id}/publish``）。

    设计要点：

    - ``share_id`` 由 ``secrets.token_urlsafe(12)`` 生成（16 字符、不可预测、不可枚举），
      作为**公开**主键；不关联任何会话 Cookie。
    - ``snapshot_json`` 在发布瞬间冻结 ``regions + ispecs + 页图清单``，因此教师之后修改
      材料不会影响已发出的链接（快照化，而不是"实时投影"）。
    - ``revoked_at`` 非空即失效；公开端点一律 404（不区分"不存在"与"已撤销"）。
    - ``shares`` 是 P2 追加表，**不在** 9 张共享表基线 ``TABLE_NAMES`` 内
      （``init_db`` 用 ``create_all`` 幂等建表，追加表不影响既有表结构）。
    """

    __tablename__ = "shares"
    __table_args__ = (
        Index("ix_shares_material", "material_id", "created_at"),
        Index("ix_shares_session", "session_id"),
    )

    share_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    material_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("materials.id"), nullable=False
    )
    #: 仅用于审计与级联清理，**绝不**出现在任何公开响应里。
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class LabRecord(Base):
    """题目交互实验室：原题、识别条件、模型、解答、轨迹和学生记录的统一文档。

    文档整体放在 ``document`` JSON 中，用 ``revision`` 做乐观锁；会话归属与保留期
    冗余成列，便于列表、清理与权限校验。第一版不拆子表，避免把识别结果与学生
    探索状态分散到多张表后难以保证同一次保存的一致性。
    """

    __tablename__ = "labs"
    __table_args__ = (
        Index("ix_labs_session_created", "session_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ready")
    problem_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False, index=True)


class LabShareRecord(Base):
    """题目实验室的只读分享快照（公开主键，不含会话与文件系统路径）。"""

    __tablename__ = "lab_shares"
    __table_args__ = (
        Index("ix_lab_shares_lab", "lab_id", "created_at"),
        Index("ix_lab_shares_session", "session_id"),
    )

    share_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    lab_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("labs.id"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class LivingPageRecord(Base):
    """通文册：由任意文件转换而成的"保真层 + 激活层"块序列。

    ``document`` JSON 存 ``page.1`` 文档（blocks + suggestions + source），
    块级学生进度单独放 ``living_page_progress``，避免每次交互都重写整个文档。
    """

    __tablename__ = "living_pages"
    __table_args__ = (
        Index("ix_living_pages_session_created", "session_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    block_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False, index=True)


class LivingShareRecord(Base):
    """活页只读分享快照（公开主键；快照内嵌资产白名单，不含会话与文件系统路径）。"""

    __tablename__ = "living_shares"
    __table_args__ = (
        Index("ix_living_shares_page", "page_id", "created_at"),
        Index("ix_living_shares_session", "session_id"),
    )

    share_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    page_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("living_pages.id"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class LivingProgressRecord(Base):
    """学生端按块的交互进度：一次分享一行，``blocks`` 存 ``{block_id: 状态}``。

    挂在 ``share_id`` 而不是 ``page_id`` 上：老师看到的学情对应"发出去的那份快照"，
    事后改文档不影响已发链接的数据语义。
    """

    __tablename__ = "living_progress"
    __table_args__ = (
        Index("ix_living_progress_share_session", "share_id", "session_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    share_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("living_shares.share_id"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    blocks: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


class WorkshopWorkRecord(Base):
    """定象坊作品：一张画布文档（CanvasDoc JSON）。

    ``forked_from_share`` 记录作品谱系——fork 别人的发布作品时指回来源分享，
    画廊可以数出"这个作品被改造过几次"。
    """

    __tablename__ = "workshop_works"
    __table_args__ = (
        Index("ix_workshop_works_session_created", "session_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    forked_from_share: Mapped[str | None] = mapped_column(String(ID_LENGTH), nullable=True)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    expires_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False, index=True)


class WorkshopShareRecord(Base):
    """工坊作品发布快照（公开只读；``forks`` 反规范化计数，画廊直接读）。"""

    __tablename__ = "workshop_shares"
    __table_args__ = (
        Index("ix_workshop_shares_work", "work_id", "created_at"),
        Index("ix_workshop_shares_session", "session_id"),
    )

    share_id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    work_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("workshop_works.id"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(String(TIMESTAMP_LENGTH), nullable=True)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class WorkshopBlueprintRecord(Base):
    """定象坊个人蓝图库：云端持久化自制复合积木与 AI 规则积木，解除 localStorage 24 个上限。"""

    __tablename__ = "workshop_blueprints"
    __table_args__ = (
        Index("ix_workshop_blueprints_session_updated", "session_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(ID_LENGTH), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(ID_LENGTH), ForeignKey("sessions.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False, default="composite")
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    summary: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    blueprint_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(TIMESTAMP_LENGTH), nullable=False)


#: 契约要求的 9 张表（T7 验收 1 的自检基线）。
TABLE_NAMES: tuple[str, ...] = (
    "sessions",
    "materials",
    "pages",
    "elements",
    "knowledge_objects",
    "object_versions",
    "jobs",
    "runs",
    "checks",
)

__all__ = [
    "CheckRecord",
    "ElementRecord",
    "JobRecord",
    "KnowledgeObjectRecord",
    "LabRecord",
    "LabShareRecord",
    "LivingPageRecord",
    "LivingProgressRecord",
    "LivingShareRecord",
    "MaterialRecord",
    "ObjectVersionRecord",
    "PageRecord",
    "RunRecord",
    "SessionRecord",
    "ShareRecord",
    "TABLE_NAMES",
    "PLAZA_TABLE_NAMES",
    "PlazaItemRecord",
    "PlazaReactionRecord",
    "WorkshopBlueprintRecord",
    "WorkshopShareRecord",
    "WorkshopWorkRecord",
]


class PlazaItemRecord(Base):
    __tablename__ = "plaza_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    share_id: Mapped[str] = mapped_column(String(64), unique=True)
    author_user_id: Mapped[str | None] = mapped_column(String(64), index=True)
    author_session_id: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(String(240), default="")
    subject: Mapped[str] = mapped_column(String(32), index=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    cover_meta_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    allow_fork: Mapped[bool] = mapped_column(default=True)
    is_featured: Mapped[bool] = mapped_column(default=False)
    views: Mapped[int] = mapped_column(default=0)
    likes: Mapped[int] = mapped_column(default=0)
    bookmarks: Mapped[int] = mapped_column(default=0)
    forks: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(String(16), default="published", index=True)
    created_at: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[str] = mapped_column(String(32))


class PlazaReactionRecord(Base):
    __tablename__ = "plaza_reactions"
    __table_args__ = (Index("uq_plaza_reaction", "plaza_item_id", "user_id", "kind", unique=True),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    plaza_item_id: Mapped[str] = mapped_column(ForeignKey("plaza_items.id"))
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[str] = mapped_column(String(32))


PLAZA_TABLE_NAMES = (PlazaItemRecord.__tablename__, PlazaReactionRecord.__tablename__)
