"""账号三表基线：``users`` / ``login_identities`` / ``auth_sessions``。

对应契约 ``C-MIGRATION@1`` 与 ``C-MODEL@1``：

- 只创建账号三表；存量业务表继续由 ``init_db()`` 的 ``create_all`` 负责（D-07）。
- 列、可空性、索引名与唯一约束名必须与 ``app/db/account_models.py`` **完全一致**，
  否则 MySQL 下 ``create_all`` 与 Alembic 会建出同名重复索引。
- ``id`` 为业务主键（``usr_`` / ``lid_`` / ``aut_`` + 32 hex），不做自增。

Revision ID: 0001_account_tables
Revises: None
Create Date: 2026-11-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_account_tables"
down_revision = None
branch_labels = None
depends_on = None

#: MySQL 表选项（与 ORM 的 ``MYSQL_TABLE_OPTIONS`` 逐字一致）。
MYSQL_TABLE_OPTIONS: dict[str, str] = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    """创建账号三表（按外键依赖顺序：users → login_identities / auth_sessions）。"""

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("platform_role", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_users_status_created", "users", ["status", "created_at"], unique=False)

    op.create_table(
        "login_identities",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("issuer", sa.String(length=255), nullable=False),
        sa.Column("identifier", sa.String(length=320), nullable=False),
        sa.Column("display_identifier", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_login_identities_user_id_users",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_login_identities"),
        sa.UniqueConstraint(
            "provider",
            "issuer",
            "identifier",
            name="uq_login_identities_provider_issuer_identifier",
        ),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_login_identities_user", "login_identities", ["user_id"], unique=False)

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("device_label", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_auth_sessions_user_id_users",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_auth_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index(
        "ix_auth_sessions_user_revoked",
        "auth_sessions",
        ["user_id", "revoked_at"],
        unique=False,
    )
    op.create_index(
        "ix_auth_sessions_absolute_expires",
        "auth_sessions",
        ["absolute_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    """按外键依赖逆序删除：auth_sessions → login_identities → users。"""

    op.drop_index("ix_auth_sessions_absolute_expires", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_revoked", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_login_identities_user", table_name="login_identities")
    op.drop_table("login_identities")
    op.drop_index("ix_users_status_created", table_name="users")
    op.drop_table("users")