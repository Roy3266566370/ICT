"""SQLAlchemy 2.x 声明基类（9 张表的公共元数据约定）。

命名约定显式给出，避免 SQLite 自动生成匿名约束名后无法维护；首版不发迁移脚本，
建表统一走 ``Base.metadata.create_all``（§2.1.5）。
"""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

#: 约束命名模板（约束名可预测，便于排查与后续 Alembic 化）。
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


__all__ = ["Base", "NAMING_CONVENTION"]
