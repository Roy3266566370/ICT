"""一次性初始化 MySQL 数据库与应用账号（``C-DB@1`` 第 3 条）。

用法（在 ``backend/`` 下执行）::

    python scripts/init_mysql_schema.py [--database NAME] [--app-user NAME]
                                        [--host HOST] [--port PORT]
                                        [--rotate-password]

安全边界（D-01）：

- **root 只用于本脚本**做建库/建账号/授权；应用运行时使用独立账号 ``xiangsheng_app``。
- 凭据**唯一来源**是环境变量 ``MYSQL_ROOT_PASSWORD`` / ``MYSQL_APP_PASSWORD``；
  缺失时打印中文说明并以退出码 2 退出，**不建立任何连接**。
- 密码通过 ``pymysql`` 的参数化占位符传递，不拼进 SQL，也不出现在任何输出中。
- 库名/账号名会做标识符白名单校验后才拼入 DDL（MySQL 不支持 DDL 标识符参数化）。
- 本脚本**不建表**：表结构由 Alembic 基线（账号三表）与 ``init_db()``（存量表）负责。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Sequence

#: 凭据环境变量（必填，且是唯一来源）。
ROOT_PASSWORD_ENV = "MYSQL_ROOT_PASSWORD"
APP_PASSWORD_ENV = "MYSQL_APP_PASSWORD"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3306
DEFAULT_DATABASE = "xiangsheng_dev"
DEFAULT_APP_USER = "xiangsheng_app"

#: 应用账号的连接来源主机（与契约 SQL 一致，固定为回环地址）。
APP_HOST = "127.0.0.1"

#: 授予应用账号的最小权限集合（不含 GRANT / SUPER / FILE 等高危权限）。
GRANT_PRIVILEGES: tuple[str, ...] = (
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "ALTER",
    "INDEX",
    "REFERENCES",
    "DROP",
)

#: MySQL 标识符：只允许字母、数字与下划线，防止拼入 DDL 时注入。
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,64}$")


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="初始化 MySQL 数据库与应用账号（不建表，不输出密码）",
    )
    parser.add_argument(
        "--database",
        default=os.environ.get("MYSQL_DATABASE") or DEFAULT_DATABASE,
        help=f"数据库名（默认取 MYSQL_DATABASE，否则 {DEFAULT_DATABASE}）",
    )
    parser.add_argument(
        "--app-user",
        default=os.environ.get("MYSQL_APP_USER") or DEFAULT_APP_USER,
        help=f"应用账号名（默认取 MYSQL_APP_USER，否则 {DEFAULT_APP_USER}）",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("MYSQL_HOST") or DEFAULT_HOST,
        help=f"MySQL 主机（默认取 MYSQL_HOST，否则 {DEFAULT_HOST}）",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"MySQL 端口（默认取 MYSQL_PORT，否则 {DEFAULT_PORT}）",
    )
    parser.add_argument(
        "--rotate-password",
        action="store_true",
        help="显式重置应用账号密码；默认只做 CREATE USER IF NOT EXISTS（不改变既有密码）",
    )
    args = parser.parse_args(argv)
    if args.port is None:
        raw_port = os.environ.get("MYSQL_PORT") or str(DEFAULT_PORT)
        try:
            args.port = int(raw_port)
        except ValueError:
            parser.error(f"MYSQL_PORT 必须是整数，实际为 {raw_port!r}")
    if not (1 <= args.port <= 65535):
        parser.error(f"端口必须在 1–65535 之间，实际为 {args.port}")
    return args


def _validate_identifier(value: str, label: str) -> str:
    """校验库名/账号名，非法时抛 ``ValueError``（调用方转成退出码 2）。"""

    if not _IDENTIFIER_PATTERN.match(value):
        raise ValueError(
            f"{label}只能包含字母、数字与下划线且长度 1–64，当前值不可用：{value!r}"
        )
    return value


def _require_password(env_name: str) -> str | None:
    """读取必填密码；空串视为缺失（返回 ``None``）。"""

    value = os.environ.get(env_name)
    return value if value else None


def _print_missing_credentials(missing: list[str]) -> None:
    print(
        "缺少必需的环境变量：" + "、".join(missing) + "。\n"
        "请先设置后再执行，例如（PowerShell）：\n"
        '  $env:MYSQL_ROOT_PASSWORD = "<root 密码>"\n'
        '  $env:MYSQL_APP_PASSWORD  = "<应用账号密码>"\n'
        "密码只从环境变量读取，本脚本不会写入任何文件，也不会打印密码。",
        file=sys.stderr,
    )


def _apply_schema(cursor: Any, *, database: str, app_user: str, app_password: str,
                  rotate_password: bool) -> None:
    """执行全部幂等 DDL；密码只用参数化占位符传递。"""

    # database 已经过标识符白名单校验，可安全用反引号包裹。
    cursor.execute(
        f"CREATE DATABASE IF NOT EXISTS `{database}` "
        "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
    )
    # 账号与主机用字符串参数传递，避免拼接引号；密码同样参数化。
    cursor.execute(
        "CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s",
        (app_user, APP_HOST, app_password),
    )
    if rotate_password:
        cursor.execute(
            "ALTER USER %s@%s IDENTIFIED BY %s",
            (app_user, APP_HOST, app_password),
        )
    cursor.execute(
        "GRANT " + ", ".join(GRANT_PRIVILEGES) + f" ON `{database}`.* TO %s@%s",
        (app_user, APP_HOST),
    )
    cursor.execute("FLUSH PRIVILEGES")


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)

    missing = [
        env_name
        for env_name in (ROOT_PASSWORD_ENV, APP_PASSWORD_ENV)
        if _require_password(env_name) is None
    ]
    if missing:
        # 契约：缺凭据时退出码 2，且不发起任何连接。
        _print_missing_credentials(missing)
        return 2

    try:
        database = _validate_identifier(args.database, "数据库名")
        app_user = _validate_identifier(args.app_user, "应用账号名")
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    try:
        import pymysql
    except ImportError:
        print(
            "缺少 PyMySQL 依赖：请先执行 python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 1

    root_password = _require_password(ROOT_PASSWORD_ENV)
    app_password = _require_password(APP_PASSWORD_ENV)
    assert root_password is not None and app_password is not None  # 上一分支已校验

    try:
        connection = pymysql.connect(
            host=args.host,
            port=args.port,
            user="root",
            password=root_password,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
            connect_timeout=5,
        )
    except pymysql.MySQLError as exc:
        # pymysql 的异常文本不含密码；这里只回显驱动消息与目标地址。
        print(
            f"连接 MySQL 失败（{args.host}:{args.port}）：{exc}",
            file=sys.stderr,
        )
        return 1

    try:
        with connection.cursor() as cursor:
            _apply_schema(
                cursor,
                database=database,
                app_user=app_user,
                app_password=app_password,
                rotate_password=bool(args.rotate_password),
            )
    except pymysql.MySQLError as exc:
        print(f"初始化失败：{exc}", file=sys.stderr)
        return 1
    finally:
        connection.close()

    # 输出只含非敏感信息；密码绝不出现。
    print(f"数据库：{database}")
    print(f"应用账号：{app_user}@{APP_HOST}")
    print(f"主机：{args.host}")
    print(f"端口：{args.port}")
    print("授予权限：" + ", ".join(GRANT_PRIVILEGES))
    if args.rotate_password:
        print("已按 --rotate-password 重置应用账号密码（值不显示）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())