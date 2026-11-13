"""PPT AI 七张表：``ppt_ai_tasks`` / ``plans`` / ``bundles`` / ``branches`` /
``experiments`` / ``artifacts`` / ``validation_reports``。

- 只新增表，不修改既有材料、账号或实验室表。
- 列、可空性、索引名与唯一约束名必须与 ``app/db/ppt_ai_models.py`` 完全一致，
  否则 MySQL 下 ``create_all`` 与 Alembic 会建出重复索引。
- 外键按依赖顺序创建：tasks/plans/bundles → branches/experiments/artifacts/reports。

Revision ID: 0002_ppt_ai_tables
Revises: 0001_account_tables
Create Date: 2026-11-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_ppt_ai_tables"
down_revision = "0001_account_tables"
branch_labels = None
depends_on = None

MYSQL_TABLE_OPTIONS: dict[str, str] = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.String(length=32), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "ppt_ai_tasks",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("stage", sa.String(length=64), nullable=False),
        sa.Column("operation_id", sa.String(length=100), nullable=False),
        sa.Column("input_version", sa.Integer(), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("budget_used", sa.Integer(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("lease_expires_at", sa.String(length=32), nullable=True),
        sa.Column("heartbeat_at", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_tasks_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_tasks_material_id_materials"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_tasks"),
        sa.UniqueConstraint("session_id", "material_id", "kind", "operation_id", name="uq_ppt_ai_tasks_operation"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_tasks_material_created", "ppt_ai_tasks", ["material_id", "created_at"])
    op.create_index("ix_ppt_ai_tasks_status_lease", "ppt_ai_tasks", ["status", "lease_expires_at"])

    op.create_table(
        "ppt_ai_plans",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("plan_revision", sa.Integer(), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_plans_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_plans_material_id_materials"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_plans"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_plans_material_created", "ppt_ai_plans", ["material_id", "created_at"])

    op.create_table(
        "ppt_ai_bundles",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("bundle_revision", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.String(length=24), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("registry_version", sa.String(length=64), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_bundles_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_bundles_material_id_materials"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_bundles"),
        sa.UniqueConstraint("material_id", "bundle_revision", name="uq_ppt_ai_bundles_material_revision"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_bundles_material_created", "ppt_ai_bundles", ["material_id", "created_at"])

    op.create_table(
        "ppt_ai_branches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("bundle_id", sa.String(length=64), nullable=False),
        sa.Column("parent_branch_id", sa.String(length=64), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("canonical_values", sa.JSON(), nullable=False),
        sa.Column("evaluation", sa.JSON(), nullable=True),
        sa.Column("applied_operations", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_branches_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_branches_material_id_materials"),
        sa.ForeignKeyConstraint(["bundle_id"], ["ppt_ai_bundles.id"], name="fk_ppt_ai_branches_bundle_id_ppt_ai_bundles"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_branches"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_branches_bundle_created", "ppt_ai_branches", ["bundle_id", "created_at"])
    op.create_index("ix_ppt_ai_branches_material", "ppt_ai_branches", ["material_id"])

    op.create_table(
        "ppt_ai_experiments",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("bundle_id", sa.String(length=64), nullable=False),
        sa.Column("branch_id", sa.String(length=64), nullable=True),
        sa.Column("parent_branch_id", sa.String(length=64), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("recipe_id", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("result_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_experiments_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_experiments_material_id_materials"),
        sa.ForeignKeyConstraint(["bundle_id"], ["ppt_ai_bundles.id"], name="fk_ppt_ai_experiments_bundle_id_ppt_ai_bundles"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_experiments"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_experiments_bundle_created", "ppt_ai_experiments", ["bundle_id", "created_at"])
    op.create_index("ix_ppt_ai_experiments_material", "ppt_ai_experiments", ["material_id"])

    op.create_table(
        "ppt_ai_artifacts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("bundle_id", sa.String(length=64), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("view_contract_version", sa.String(length=64), nullable=False),
        sa.Column("program", sa.Text(), nullable=False),
        sa.Column("ast", sa.JSON(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
        sa.Column("supported_interactions", sa.JSON(), nullable=False),
        sa.Column("offline_supported", sa.Boolean(), nullable=False),
        sa.Column("acceptance_status", sa.String(length=16), nullable=False),
        sa.Column("isolation", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_artifacts_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_artifacts_material_id_materials"),
        sa.ForeignKeyConstraint(["bundle_id"], ["ppt_ai_bundles.id"], name="fk_ppt_ai_artifacts_bundle_id_ppt_ai_bundles"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_artifacts"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_artifacts_bundle_created", "ppt_ai_artifacts", ["bundle_id", "created_at"])
    op.create_index("ix_ppt_ai_artifacts_material", "ppt_ai_artifacts", ["material_id"])

    op.create_table(
        "ppt_ai_validation_reports",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column("material_id", sa.String(length=64), nullable=False),
        sa.Column("bundle_id", sa.String(length=64), nullable=False),
        sa.Column("branch_id", sa.String(length=64), nullable=True),
        sa.Column("artifact_id", sa.String(length=64), nullable=True),
        sa.Column("bundle_hash", sa.String(length=64), nullable=False),
        sa.Column("branch_hash", sa.String(length=64), nullable=False),
        sa.Column("kernel_version", sa.String(length=64), nullable=False),
        sa.Column("runtime_version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("stale", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], name="fk_ppt_ai_reports_session_id_sessions"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name="fk_ppt_ai_reports_material_id_materials"),
        sa.ForeignKeyConstraint(["bundle_id"], ["ppt_ai_bundles.id"], name="fk_ppt_ai_reports_bundle_id_ppt_ai_bundles"),
        sa.PrimaryKeyConstraint("id", name="pk_ppt_ai_validation_reports"),
        **MYSQL_TABLE_OPTIONS,
    )
    op.create_index("ix_ppt_ai_reports_bundle_created", "ppt_ai_validation_reports", ["bundle_id", "created_at"])
    op.create_index("ix_ppt_ai_reports_material", "ppt_ai_validation_reports", ["material_id"])


def downgrade() -> None:
    for table, indexes in (
        ("ppt_ai_validation_reports", ["ix_ppt_ai_reports_bundle_created", "ix_ppt_ai_reports_material"]),
        ("ppt_ai_artifacts", ["ix_ppt_ai_artifacts_bundle_created", "ix_ppt_ai_artifacts_material"]),
        ("ppt_ai_experiments", ["ix_ppt_ai_experiments_bundle_created", "ix_ppt_ai_experiments_material"]),
        ("ppt_ai_branches", ["ix_ppt_ai_branches_bundle_created", "ix_ppt_ai_branches_material"]),
        ("ppt_ai_bundles", ["ix_ppt_ai_bundles_material_created"]),
        ("ppt_ai_plans", ["ix_ppt_ai_plans_material_created"]),
        ("ppt_ai_tasks", ["ix_ppt_ai_tasks_material_created", "ix_ppt_ai_tasks_status_lease"]),
    ):
        for index in indexes:
            op.drop_index(index, table_name=table)
        op.drop_table(table)
