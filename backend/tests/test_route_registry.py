"""``C-ROUTE-CHECK@1`` 启动期路由完整性校验单测。

覆盖（plan §3.1 T1 acceptance 第 1 条）：

- 必需模块导入失败 → ``RouteRegistrationError``；
- 必需模块未导出 ``router`` → 抛错；
- 必需模块未被发现（文件缺失/改名）→ 抛错；
- 非必需模块导入失败 → warning 跳过，不抛错（既有 ``C-REG@1`` 语义不变）；
- ``collect_endpoints`` 能从真实 ``routes_auth`` 识别 4 条账号端点，并忽略 ``HEAD`` / ``OPTIONS``；
- 缺一条端点（路径存在但方法不匹配）→ 抛错且消息含 ``GET /api/v1/me``；
- ``strict=False`` 不执行端点断言，``strict=True`` 缺端点即抛；
- ``settings.strict_route_check`` 默认为 ``True``，且可被环境变量显式关闭。

本模块**不触数据库、不启动真实 HTTP 服务**：全部使用手工构造的 ``FastAPI`` 应用。
"""

from __future__ import annotations

import importlib
import logging

import pytest
from fastapi import APIRouter, FastAPI

from app.api import registry
from app.api.registry import (
    REQUIRED_ENDPOINTS,
    REQUIRED_ROUTE_MODULES,
    RouteRegistrationError,
    assert_required_endpoints,
    collect_endpoints,
    load_routers,
    register_routes,
)
from app.main import create_app
from app.settings import Settings

_ACCOUNT_PREFIX = "/api/v1"


def _noop_endpoint() -> dict[str, bool]:
    """测试用占位 handler（不读取请求，不触数据库）。"""

    return {"ok": True}


async def _noop_websocket(websocket):  # type: ignore[no-untyped-def]
    """测试用 WebSocket handler：``collect_endpoints`` 应跳过无 ``methods`` 的路由。"""

    await websocket.close()


def _build_app(endpoints: list[tuple[str, str]]) -> FastAPI:
    """按 ``(METHOD, 完整路径)`` 构造一个最小应用（不注册任何业务路由）。"""

    app = FastAPI()
    for method, path in endpoints:
        app.add_api_route(path, _noop_endpoint, methods=[method])
    return app


def _account_router(*, omit: tuple[str, str] | None = None) -> APIRouter:
    """返回带全部（或缺少 ``omit`` 指定的）账号端点的 ``APIRouter``。"""

    router = APIRouter(prefix=_ACCOUNT_PREFIX)
    for method, path in sorted(REQUIRED_ENDPOINTS):
        if omit is not None and (method, path) == omit:
            continue
        router.add_api_route(path[len(_ACCOUNT_PREFIX) :], _noop_endpoint, methods=[method])
    return router


# --- 契约常量 ---------------------------------------------------------------


def test_contract_constants_are_frozen() -> None:
    """模块与端点常量与计划 §2.2 完全一致（符号名与取值冻结）。"""

    assert REQUIRED_ROUTE_MODULES == ("routes_auth",)
    assert REQUIRED_ENDPOINTS == frozenset(
        {
            ("POST", "/api/v1/auth/register"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
            ("GET", "/api/v1/me"),
        }
    )


# --- load_routers -----------------------------------------------------------


def test_required_module_import_failure_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """必需模块导入失败 → ``RouteRegistrationError``（一次报告全部缺失）。"""

    monkeypatch.setattr(
        registry, "discover_route_modules", lambda: ["routes_auth", "routes_broken_import"]
    )

    with pytest.raises(RouteRegistrationError) as excinfo:
        load_routers(required=("routes_auth", "routes_broken_import"))

    assert excinfo.value.missing_modules == ("routes_broken_import",)
    assert "routes_broken_import" in str(excinfo.value)


def test_required_module_without_router_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """必需模块导入成功但未导出 ``APIRouter`` → 抛错。"""

    # ``app.api.registry`` 自身不导出 ``router``，用它模拟"导入了但不是路由模块"。
    monkeypatch.setattr(registry, "discover_route_modules", lambda: ["routes_auth", "registry"])

    with pytest.raises(RouteRegistrationError) as excinfo:
        load_routers(required=("registry",))

    assert excinfo.value.missing_modules == ("registry",)


def test_required_module_not_discovered_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """必需模块未被发现（文件缺失或命名不符）→ 抛错，不静默降级。"""

    monkeypatch.setattr(registry, "discover_route_modules", lambda: [])

    with pytest.raises(RouteRegistrationError) as excinfo:
        load_routers(required=REQUIRED_ROUTE_MODULES)

    assert excinfo.value.missing_modules == REQUIRED_ROUTE_MODULES


def test_optional_module_failure_is_skipped(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """非必需模块导入失败 → warning 跳过，不抛错（保持既有 C-REG@1 语义）。"""

    monkeypatch.setattr(
        registry, "discover_route_modules", lambda: ["routes_auth", "routes_broken_import"]
    )

    with caplog.at_level(logging.WARNING, logger="app.api.registry"):
        routers = load_routers()

    assert [name for name, _router in routers] == ["routes_auth"]
    assert any("routes_broken_import" in record.getMessage() for record in caplog.records)


# --- collect_endpoints ------------------------------------------------------


def test_collect_endpoints_finds_real_account_endpoints() -> None:
    """真实 ``routes_auth`` 的 4 条账号端点能被 ``collect_endpoints`` 识别（R1-AC1）。"""

    module = importlib.import_module("app.api.routes_auth")
    app = FastAPI()
    app.include_router(module.router)

    endpoints = collect_endpoints(app)

    assert REQUIRED_ENDPOINTS <= endpoints


def test_collect_endpoints_ignores_head_options_and_methodless_routes() -> None:
    """``HEAD`` / ``OPTIONS`` 不构成契约；无 ``methods`` 的路由（WebSocket）跳过。"""

    app = FastAPI()
    app.add_api_route(
        "/api/v1/ping", _noop_endpoint, methods=["GET", "HEAD", "OPTIONS"]
    )
    app.add_websocket_route("/api/v1/ws", _noop_websocket)

    endpoints = collect_endpoints(app)

    assert ("GET", "/api/v1/ping") in endpoints
    assert not {(method, path) for method, path in endpoints if method in {"HEAD", "OPTIONS"}}
    assert all(path != "/api/v1/ws" for _method, path in endpoints)


# --- assert_required_endpoints ---------------------------------------------


def test_assert_required_endpoints_passes_when_all_present() -> None:
    """4 条账号端点齐全时不抛错。"""

    app = FastAPI()
    app.include_router(_account_router())

    assert_required_endpoints(app, REQUIRED_ENDPOINTS)


def test_assert_required_endpoints_reports_missing_method_path() -> None:
    """方法不匹配视为缺失，消息按 ``METHOD path`` 排序列举。"""

    # ``/api/v1/me`` 只注册了 PUT，因此 GET 仍然缺失。
    app = _build_app(
        [
            ("POST", "/api/v1/auth/register"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
            ("PUT", "/api/v1/me"),
        ]
    )

    with pytest.raises(RouteRegistrationError) as excinfo:
        assert_required_endpoints(app, REQUIRED_ENDPOINTS)

    assert "GET /api/v1/me" in str(excinfo.value)
    assert excinfo.value.missing_endpoints == (("GET", "/api/v1/me"),)


# --- register_routes -------------------------------------------------------


def _patch_partial_routers(monkeypatch: pytest.MonkeyPatch) -> None:
    """把 ``load_routers`` 替换为只返回"缺 3 条端点"的路由，隔离真实模块依赖。"""

    partial = APIRouter(prefix=_ACCOUNT_PREFIX)
    partial.add_api_route("/auth/register", _noop_endpoint, methods=["POST"])

    def _fake_load_routers(*, required: object = ()) -> list[tuple[str, APIRouter]]:
        del required
        return [("routes_auth", partial)]

    monkeypatch.setattr(registry, "load_routers", _fake_load_routers)


def test_register_routes_strict_false_skips_endpoint_assertion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``strict=False`` 等价 ``load_routers(required=())`` 且不执行端点断言。"""

    _patch_partial_routers(monkeypatch)
    app = FastAPI()

    registered = register_routes(app, strict=False)

    assert registered == ["routes_auth"]
    assert ("POST", "/api/v1/auth/register") in collect_endpoints(app)


def test_register_routes_strict_true_fails_on_missing_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``strict=True`` 时端点缺失即抛错（R1-AC3）。"""

    _patch_partial_routers(monkeypatch)

    with pytest.raises(RouteRegistrationError) as excinfo:
        register_routes(FastAPI(), strict=True)

    assert ("GET", "/api/v1/me") in excinfo.value.missing_endpoints


# --- create_app 集成（不执行 lifespan，不触数据库）--------------------------


def test_create_app_provides_all_account_endpoints() -> None:
    """默认（strict）构造的应用必须提供 4 条账号端点（R1-AC1）。"""

    app = create_app()

    assert REQUIRED_ENDPOINTS <= collect_endpoints(app)


def test_create_app_strict_routes_switch_controls_assertion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``create_app(strict_routes=False)`` 跳过端点断言；``True`` 时执行一次。"""

    calls: list[set[tuple[str, str]]] = []

    def _spy(app: FastAPI, required: object) -> None:
        calls.append(set(required))  # type: ignore[arg-type]

    monkeypatch.setattr(registry, "assert_required_endpoints", _spy)

    create_app(strict_routes=False)
    assert calls == []

    create_app(strict_routes=True)
    assert calls == [set(REQUIRED_ENDPOINTS)]


# --- settings 开关 ---------------------------------------------------------


def test_strict_route_check_defaults_to_true() -> None:
    """默认必须为 ``True``，不因 ``.env`` 缺字段而失效（R1-AC2）。"""

    assert Settings.model_fields["strict_route_check"].default is True


def test_strict_route_check_can_be_disabled_by_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """``STRICT_ROUTE_CHECK=false`` 可在 ``.env`` / 环境变量中显式旁路。"""

    monkeypatch.setenv("STRICT_ROUTE_CHECK", "false")
    assert Settings(_env_file=None).strict_route_check is False

    monkeypatch.delenv("STRICT_ROUTE_CHECK", raising=False)
    assert Settings(_env_file=None).strict_route_check is True