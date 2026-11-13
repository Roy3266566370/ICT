"""幂等建表（T7 验收 1：9 张表可重复初始化不报错）。

首版不引入 Alembic，统一用 ``Base.metadata.create_all``（§2.1.5）；
``create_all`` 自带 ``checkfirst`` 语义，重复调用不会报错、不会丢数据。

账号三表（``C-MODEL@1``）也由这里注册到 ``Base.metadata``：Alembic 基线只覆盖
这三张表，存量业务表继续走 ``create_all``，两条路径靠 ``checkfirst`` 互不冲突。
"""

from __future__ import annotations

import logging

from sqlalchemy import Engine, inspect, text

from . import account_models as _account_models  # noqa: F401  注册账号三表到 Base.metadata
from . import models as _models  # noqa: F401  仅为注册存量表到 Base.metadata
from . import ppt_ai_models as _ppt_ai_models  # noqa: F401  注册 PPT AI 七表
from .account_models import ACCOUNT_TABLE_NAMES
from .base import Base
from .models import TABLE_NAMES
from .ppt_ai_models import PPT_AI_TABLE_NAMES
from .session import get_engine

logger = logging.getLogger(__name__)

#: 建表完整性校验覆盖的表名：存量基线 + 账号三表 + PPT AI 七表。
REQUIRED_TABLE_NAMES: tuple[str, ...] = (
    tuple(TABLE_NAMES) + tuple(ACCOUNT_TABLE_NAMES) + tuple(PPT_AI_TABLE_NAMES)
)

#: ``create_all`` 只建缺失的表，**不会**给已有表补列；这里登记后续追加的列。
#: DDL 同时兼容 SQLite 与 MySQL 8（NOT NULL + 空串默认值）。
PROFILE_ADDED_COLUMNS: dict[str, str] = {
    "phone": "VARCHAR(32) NOT NULL DEFAULT ''",
}

#: ``ppt_ai_branches`` 的分支用途与学习元数据；老库升级用（SQLite/MySQL 均可用）。
PPT_AI_ADDED_COLUMNS: dict[str, str] = {
    "kind": "VARCHAR(16) NOT NULL DEFAULT 'candidate'",
    "title": "VARCHAR(200) NOT NULL DEFAULT ''",
    "learning_json": "JSON",
    "overrides_json": "JSON",
}


def ensure_profile_columns(engine: Engine) -> None:
    """幂等补齐 ``user_profiles`` 的新增列（老库升级用）。"""

    inspector = inspect(engine)
    if "user_profiles" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("user_profiles")}
    for name, ddl in PROFILE_ADDED_COLUMNS.items():
        if name in existing:
            continue
        with engine.begin() as connection:
            connection.execute(
                text(f"ALTER TABLE user_profiles ADD COLUMN {name} {ddl}")
            )
        logger.info("user_profiles 已补充列：%s", name)


def ensure_ppt_ai_columns(engine: Engine) -> None:
    """幂等补齐 ``ppt_ai_branches`` 的分支用途列，并回填无歧义的历史基准。"""

    inspector = inspect(engine)
    if "ppt_ai_branches" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("ppt_ai_branches")}
    for name, ddl in PPT_AI_ADDED_COLUMNS.items():
        if name in existing:
            continue
        with engine.begin() as connection:
            connection.execute(text(f"ALTER TABLE ppt_ai_branches ADD COLUMN {name} {ddl}"))
        logger.info("ppt_ai_branches 已补充列：%s", name)

    if "kind" not in existing and "kind" not in PPT_AI_ADDED_COLUMNS:
        return
    with engine.begin() as connection:
        bundle_ids = [
            row[0]
            for row in connection.execute(
                text("SELECT DISTINCT bundle_id FROM ppt_ai_branches")
            )
        ]
        for bundle_id in bundle_ids:
            has_baseline = connection.execute(
                text(
                    "SELECT COUNT(*) FROM ppt_ai_branches "
                    "WHERE bundle_id=:bundle AND kind='baseline'"
                ),
                {"bundle": bundle_id},
            ).scalar_one()
            if has_baseline:
                continue
            roots = [
                row[0]
                for row in connection.execute(
                    text(
                        "SELECT id FROM ppt_ai_branches WHERE bundle_id=:bundle "
                        "AND parent_branch_id IS NULL AND status='active' "
                        "ORDER BY created_at ASC"
                    ),
                    {"bundle": bundle_id},
                )
            ]
            if len(roots) == 1:
                connection.execute(
                    text("UPDATE ppt_ai_branches SET kind='baseline' WHERE id=:id"),
                    {"id": roots[0]},
                )
                logger.info("ppt_ai_branches 回填基准分支：%s", roots[0])
            elif len(roots) > 1:
                logger.warning(
                    "ppt_ai_branches bundle=%s 存在 %d 个无父活动分支，未自动选择基准",
                    bundle_id,
                    len(roots),
                )


def init_db(bind: Engine | None = None) -> list[str]:
    """建表并返回实际存在的表名（按契约顺序）；可重复调用。"""

    engine = bind or get_engine()
    Base.metadata.create_all(engine)
    ensure_profile_columns(engine)
    ensure_ppt_ai_columns(engine)
    existing = sorted(Base.metadata.tables)
    missing = [name for name in REQUIRED_TABLE_NAMES if name not in existing]
    if missing:
        # 契约表缺失属于装配错误，必须显式暴露而不是静默通过。
        raise RuntimeError(f"建表不完整，缺少：{missing}")
    logger.info("init_db 完成，共 %d 张表：%s", len(existing), ", ".join(existing))
    return list(existing)


if __name__ == "__main__":  # pragma: no cover - 手工建表入口
    from ..settings import configure_logging, get_settings

    configure_logging(get_settings())
    print("tables:", ", ".join(init_db()))