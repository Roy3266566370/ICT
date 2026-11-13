"""T01：旧库分支用途列补齐与无歧义回填。"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, inspect, text

from app.db.init_db import ensure_ppt_ai_columns


def test_old_branch_table_gets_kind_and_unambiguous_baseline(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///" + (tmp_path / "old.db").as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE ppt_ai_branches ("
                "id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL, "
                "material_id VARCHAR(64) NOT NULL, bundle_id VARCHAR(64) NOT NULL, "
                "parent_branch_id VARCHAR(64), revision INTEGER NOT NULL, status VARCHAR(16) NOT NULL, "
                "canonical_values JSON NOT NULL, evaluation JSON, applied_operations JSON NOT NULL, "
                "created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO ppt_ai_branches VALUES "
                "('brn_root','ses','mat','bnd',NULL,1,'active','{}',NULL,'[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),"
                "('brn_child','ses','mat','bnd','brn_root',1,'candidate','{}',NULL,'[]','2026-01-01T00:00:01Z','2026-01-01T00:00:01Z')"
            )
        )
    ensure_ppt_ai_columns(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("ppt_ai_branches")}
    assert {"kind", "title", "learning_json"} <= columns
    with engine.connect() as connection:
        rows = dict(connection.execute(text("SELECT id, kind FROM ppt_ai_branches")).fetchall())
    assert rows["brn_root"] == "baseline"
    assert rows["brn_child"] == "candidate"


def test_ambiguous_roots_are_not_auto_selected_as_baseline(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///" + (tmp_path / "ambiguous.db").as_posix(), future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE ppt_ai_branches ("
                "id VARCHAR(64) PRIMARY KEY, session_id VARCHAR(64) NOT NULL, "
                "material_id VARCHAR(64) NOT NULL, bundle_id VARCHAR(64) NOT NULL, "
                "parent_branch_id VARCHAR(64), revision INTEGER NOT NULL, status VARCHAR(16) NOT NULL, "
                "canonical_values JSON NOT NULL, evaluation JSON, applied_operations JSON NOT NULL, "
                "created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)"
            )
        )
        for identifier in ("brn_a", "brn_b"):
            connection.execute(
                text(
                    "INSERT INTO ppt_ai_branches VALUES "
                    f"('{identifier}','ses','mat','bnd',NULL,1,'active','{{}}',NULL,'[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')"
                )
            )
    ensure_ppt_ai_columns(engine)
    with engine.connect() as connection:
        kinds = [row[0] for row in connection.execute(text("SELECT kind FROM ppt_ai_branches"))]
    assert all(kind == "candidate" for kind in kinds)
