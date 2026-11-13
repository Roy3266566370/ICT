"""``C-REG@1`` 后端路由自动注册 + ``C-ROUTE-CHECK@1`` 启动期路由完整性校验。

规则（``C-REG@1``）：

1. 用 ``pkgutil.iter_modules(app.api.__path__)`` 扫描 ``app/api`` 下的模块，
   匹配 ``^routes_([a-z_]+)$``。
2. 导入模块并取其中名为 ``router`` 的 ``APIRouter``；路由自带 ``prefix="/api/v1"``。
3. **非必需模块**缺失或导入失败不影响启动：记录 warning 后跳过，这样并行新增
   ``routes_objects.py`` / ``routes_runs.py`` / ``routes_checks.py`` 不必修改 ``main.py``。

规则（``C-ROUTE-CHECK@1``，启动期完整性）：

4. ``REQUIRED_ROUTE_MODULES`` 中的模块（账号路由 ``routes_auth``）**必须**可导入且导出
   ``APIRouter``；否则抛 :class:`RouteRegistrationError`，让进程启动失败（R1-AC2）。
5. 严格模式下 ``REQUIRED_ENDPOINTS`` 中每条 ``(METHOD, path)`` 都必须出现在应用中，
   缺失即抛 :class:`RouteRegistrationError` 并在消息中列出 ``METHOD path``（R1-AC3）。

扫描顺序按模块名排序，保证注册结果可复现。
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
import re
from collections.abc import Collection, Iterable, Sequence


from fastapi import APIRouter, FastAPI

logger = logging.getLogger(__name__)

#: 路由模块名前缀模式（C-REG@1）。
ROUTE_MODULE_PATTERN = re.compile(r"^routes_([a-z_]+)$")
#: 路由模块所在的包名。
ROUTE_PACKAGE = "app.api"

#: 启动期**必需**的路由模块短名（C-ROUTE-CHECK@1）。导入失败或未导出 router 即启动失败。
REQUIRED_ROUTE_MODULES: tuple[str, ...] = ("routes_auth",)

#: 账号闭环必需的端点（C-ROUTE-CHECK@1）。任一条缺失即启动失败（R1-AC3）。
REQUIRED_ENDPOINTS: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/api/v1/auth/register"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/logout"),
        ("GET", "/api/v1/me"),
    }
)

#: ``collect_endpoints`` 忽略的 HTTP 方法：HEAD/OPTIONS 由框架自动补充，不构成契约。
_IGNORED_METHODS = frozenset({"HEAD", "OPTIONS"})


def _format_endpoints(endpoints: Iterable[tuple[str, str]]) -> str:
    """把 ``(METHOD, path)`` 集合渲染为按 ``METHOD path`` 排序的逗号分隔文本。"""

    return ", ".join(sorted(f"{method} {path}" for method, path in endpoints))


class RouteRegistrationError(RuntimeError):
    """必需路由模块导入失败或必需端点缺失时抛出（C-ROUTE-CHECK@1）。

    消息只包含模块名与 ``METHOD path``，绝不包含凭据（R12-AC5）。
    """

    def __init__(
        self,
        message: str,
        *,
        missing_modules: Sequence[str] = (),
        missing_endpoints: Sequence[tuple[str, str]] = (),
    ) -> None:
        super().__init__(message)
        self._missing_modules: tuple[str, ...] = tuple(missing_modules)
        self._missing_endpoints: tuple[tuple[str, str], ...] = tuple(missing_endpoints)

    @property
    def missing_modules(self) -> tuple[str, ...]:
        """导入失败或未导出 ``router`` 的必需模块短名。"""

        return self._missing_modules

    @property
    def missing_endpoints(self) -> tuple[tuple[str, str], ...]:
        """缺失的必需端点 ``(METHOD, path)``，顺序与构造时一致。"""

        return self._missing_endpoints


def discover_route_modules() -> list[str]:
    """返回 ``app/api`` 下匹配约定的模块短名（已排序，便于复现）。"""

    package = importlib.import_module(ROUTE_PACKAGE)
    names: list[str] = []
    for module_info in pkgutil.iter_modules(package.__path__):
        if ROUTE_MODULE_PATTERN.match(module_info.name):
            names.append(module_info.name)
    return sorted(names)


def load_routers(*, required: Collection[str] = ()) -> list[tuple[str, APIRouter]]:
    """导入路由模块，返回 ``(模块短名, router)``。

    - ``required`` 中的模块：导入失败或未导出 ``APIRouter`` → 记入 ``missing_modules``；
      扫描结束后一次性抛 :class:`RouteRegistrationError`（R1-AC2）。
    - 其余模块保持既有语义：``logger.warning(...)`` 后跳过（R1-AC4）。
    """

    required_names = set(required)
    routers: list[tuple[str, APIRouter]] = []
    missing_modules: list[str] = []
    discovered: list[str] = []

    for name in discover_route_modules():
        discovered.append(name)
        module_path = f"{ROUTE_PACKAGE}.{name}"
        is_required = name in required_names
        try:
            module = importlib.import_module(module_path)
        except Exception as exc:  # 依赖缺失（尚未交付的并行模块）不得阻断启动
            if is_required:
                logger.error(
                    "必需路由模块 %s 导入失败（%s: %s）", module_path, type(exc).__name__, exc
                )
                missing_modules.append(name)
            else:
                logger.warning(
                    "跳过路由模块 %s：导入失败（%s: %s）", module_path, type(exc).__name__, exc
                )
            continue

        router = getattr(module, "router", None)
        if not isinstance(router, APIRouter):
            if is_required:
                logger.error("必需路由模块 %s 未导出 APIRouter 类型的 router", module_path)
                missing_modules.append(name)
            else:
                logger.warning("跳过路由模块 %s：未导出 APIRouter 类型的 router", module_path)
            continue

        routers.append((name, router))

    # 必需模块若压根没有被发现（文件被改名/删除），同样视为缺失，避免静默降级。
    for name in sorted(required_names):
        if name not in discovered:
            logger.error(
                "必需路由模块 %s 未被发现：app/api 下缺少 routes_*.py 或命名不符合约定", name
            )
            missing_modules.append(name)

    if missing_modules:
        missing = sorted(set(missing_modules))
        raise RouteRegistrationError(
            "必需路由模块缺失：" + ", ".join(missing),
            missing_modules=missing,
        )

    return routers


def collect_endpoints(app: FastAPI) -> set[tuple[str, str]]:
    """展开应用已注册的 ``(METHOD.upper(), path)``，忽略 ``HEAD`` / ``OPTIONS``。"""

    endpoints: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if not path or methods is None:
            continue
        for method in methods:
            upper = str(method).upper()
            if upper in _IGNORED_METHODS:
                continue
            endpoints.add((upper, str(path)))
    return endpoints


def assert_required_endpoints(
    app: FastAPI, required: Collection[tuple[str, str]]
) -> None:
    """校验必需端点全部存在；缺失即抛 :class:`RouteRegistrationError`（R1-AC3）。"""

    missing = sorted(set(required) - collect_endpoints(app))
    if missing:
        raise RouteRegistrationError(
            "必需端点缺失：" + _format_endpoints(missing),
            missing_endpoints=missing,
        )


def register_routes(app: FastAPI, *, strict: bool = True) -> list[str]:
    """把发现到的路由注册到应用，返回成功注册的模块短名列表。

    ``strict=True``（默认）：账号路由模块必需 + 必需端点断言，任一失败即抛
    :class:`RouteRegistrationError`，让调用方的启动流程失败（R1-AC2 / R1-AC3）。
    ``strict=False``：仅用于应急旁路（``STRICT_ROUTE_CHECK=false``），等价
    ``load_routers(required=())`` 且**不**执行端点断言。
    """

    required_modules: tuple[str, ...] = REQUIRED_ROUTE_MODULES if strict else ()

    registered: list[str] = []
    for name, router in load_routers(required=required_modules):
        app.include_router(router)
        registered.append(name)
        logger.info("已注册路由模块：%s（前缀 %s）", name, router.prefix or "-")
    if not registered:
        logger.warning("未发现任何 routes_* 路由模块，/api/v1 可能为空")

    if strict:
        assert_required_endpoints(app, REQUIRED_ENDPOINTS)

    return registered


def iter_router_paths(routers: Iterable[tuple[str, APIRouter]]) -> Iterable[str]:
    """调试辅助：展开 ``APIRouter`` 中的 ``method path``，供启动日志核对端点。"""

    for _name, router in routers:
        for route in router.routes:
            methods = ",".join(sorted(getattr(route, "methods", set()) or set()))
            yield f"{methods} {getattr(route, 'path', '')}"


__all__ = [
    "REQUIRED_ENDPOINTS",
    "REQUIRED_ROUTE_MODULES",
    "ROUTE_MODULE_PATTERN",
    "ROUTE_PACKAGE",
    "RouteRegistrationError",
    "assert_required_endpoints",
    "collect_endpoints",
    "discover_route_modules",
    "iter_router_paths",
    "load_routers",
    "register_routes",
]
