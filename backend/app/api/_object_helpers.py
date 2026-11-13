"""T10 共享助手：模板 → 内核分派、参数校验、报告/快照序列化与检查留档。

本模块**不属于任何公开契约**，只在 ``routes_objects`` / ``routes_runs`` /
``routes_checks`` 三份路由之间复用，避免把"对象文档 → 内核输入"的映射写三遍。

设计约束（plan §2.2.7 / §2.2.9 / §2.3.2 与 T10 任务约束）：

1. 模板到内核的映射逐字按实施约束：``matrix_2d`` → ``apply_matrix`` /
   ``compose_matrices``；``force_2d`` → ``force_resultant``；``bfs_flow`` → ``bfs_run``；
   ``budget_compare`` → ``budget_compare``。``kernel_version`` 取对象文档自己的值
   （``linear_v1 / force_v1 / bfs_v1 / budget_v1``，没有 ``matrix_v1``）。
2. ``KernelError``（engines）与 ``InputProblem``（validators）是**同构但不同类型**：
   两者都有 ``code`` / ``message`` / ``field``，因此统一用 ``getattr(exc, "code", None)``
   读出 C-ERR@1 错误码。读不出已知错误码的异常**原样上抛**给全局处理器（记录日志后
   返回 503），绝不伪装成业务错误。
3. 不执行用户代码、无 ``eval``；金额只在 ``budget_compare`` 内部以 ``Decimal`` 运算，
   本模块只负责把十进制字符串原样透传（R9-AC3、R12-AC2）。
4. ``report`` 的 ``is_stale`` 在**响应时**按对象当前版本动态重算（§2.2.7 行为 4）；
   ``summary`` 只统计 ``pass/fail/not_covered``，由 ``ValidationReport`` 复核计数一致。
5. 参数范围越界统一抛 ``KernelError(code="MISSING_FIELD", field=参数 id)``，路由层
   由 :func:`api_error_from` 转成 422 + ``details.field``（任务约束 4）。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from typing import Any


from sqlalchemy import and_, case, literal_column, select

from ..db.models import CheckRecord, KnowledgeObjectRecord, RunRecord
from ..engines import (
    KernelError,
    apply_matrix,
    bfs_run,
    budget_compare,
    compose_matrices,
    force_resultant,
)
from ..schemas.common import to_iso, utc_now
from ..schemas.errors import (
    ApiError,
    ErrorCode,
    model_unavailable,
    version_conflict,
)
from ..schemas.knowledge_object import TEMPLATE_IDS
from ..schemas.run import RunSnapshot, ValidationReport

logger = logging.getLogger(__name__)

#: 影响计算结果的字段集合：用于 "input_snapshot 是否等于当前对象" 的幂等/冲突判定。
COMPUTATION_KEYS: tuple[str, ...] = (
    "template_id",
    "kernel_version",
    "config",
    "parameters",
    "views",
    "bindings",
    "source_refs",
    "validation_profile",
    "model_version",
    "revision",
)

#: 结构签名用到的参数字段：这些字段变化才算"结构变更"（§2.3.2）。
STRUCTURAL_PARAMETER_KEYS: tuple[str, ...] = (
    "id",
    "name",
    "type",
    "unit",
    "range",
    "source_ref_ids",
    "provenance",
    "editable",
)


# ---------------------------------------------------------------------------
# 异常映射
# ---------------------------------------------------------------------------


def api_error_from(exc: Exception) -> ApiError | None:
    """把同构的 ``KernelError`` / ``InputProblem`` 转成 ``ApiError``。

    只有异常码能映射到 C-ERR@1 的 8 个错误码时才返回 ``ApiError``；其余情况返回
    ``None``，由调用方原样上抛（全局处理器记录日志并返回 503），不伪装成业务错误。
    """

    code_text = getattr(exc, "code", None)
    if not isinstance(code_text, str):
        return None
    try:
        code = ErrorCode(code_text)
    except ValueError:
        return None

    raw_message = getattr(exc, "message", None)
    message = raw_message if isinstance(raw_message, str) and raw_message else None
    field_name = getattr(exc, "field", None)
    details = {"field": field_name} if isinstance(field_name, str) and field_name else None
    return ApiError(code, message, details=details)


@contextmanager
def kernel_error_boundary() -> Iterator[None]:
    """把内核/校验器的已知错误转成 ``ApiError``；未知异常继续上抛。"""

    try:
        yield
    except ApiError:
        # 业务错误原样上抛，保留 details（例如 compile 预检里的 UNSUPPORTED_TEMPLATE）。
        raise
    except Exception as exc:  # noqa: BLE001 - 仅转换"有已知 code"的同构异常
        mapped = api_error_from(exc)
        if mapped is None:
            raise
        raise mapped from exc


def conflict_for(record: KnowledgeObjectRecord, message: str | None = None) -> ApiError:
    """409 ``VERSION_CONFLICT``：把库中当前状态回给前端用于合并（R10-AC6）。"""

    return version_conflict(
        message or "对象版本已变化，请重新载入后确认",
        current={
            "model_version": record.model_version,
            "revision": record.revision,
            "updated_at": record.updated_at,
            "object": record.document,
        },
    )


# ---------------------------------------------------------------------------
# 对象文档访问
# ---------------------------------------------------------------------------


def document_config(document: Mapping[str, Any]) -> Mapping[str, Any]:
    """``config`` 始终按对象处理（缺失时退化为空对象，由内核报缺字段）。"""

    config = document.get("config")
    return config if isinstance(config, Mapping) else {}


def document_parameters(document: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """返回参数对象列表（过滤非对象项，形状合法性由 C-KO@1 保证）。"""

    parameters = document.get("parameters")
    if not isinstance(parameters, Sequence) or isinstance(parameters, (str, bytes)):
        return []
    return [item for item in parameters if isinstance(item, Mapping)]


def parameter_value_by_id(
    document: Mapping[str, Any], parameter_id: str, *, missing_message: str | None = None
) -> Any:
    """按 ``parameter_id`` 取数值；缺失抛 ``MISSING_FIELD`` 并带上字段名。"""

    for parameter in document_parameters(document):
        if parameter.get("id") == parameter_id:
            return parameter.get("value")
    raise KernelError(
        "MISSING_FIELD",
        missing_message or f"缺少参数 {parameter_id}",
        parameter_id,
    )


def parameter_value_by_type(
    document: Mapping[str, Any],
    parameter_type: str,
    *,
    fallback_id: str | None = None,
) -> Any:
    """按 ``type`` 定位参数（C-MX/C-FC/C-BFS 的输入向量、力列表、图均按 type 定位）。"""

    for parameter in document_parameters(document):
        if parameter.get("type") == parameter_type:
            return parameter.get("value")
    if fallback_id:
        return parameter_value_by_id(
            document,
            fallback_id,
            missing_message=(
                f"缺少 {parameter_type} 型参数，且回退参数 {fallback_id} 也不存在"
            ),
        )
    raise KernelError(
        "MISSING_FIELD",
        f"缺少 {parameter_type} 型参数",
        parameter_type,
    )


# ---------------------------------------------------------------------------
# 参数范围校验（任务约束 4）
# ---------------------------------------------------------------------------


def _iter_matrix_components(value: Any) -> Iterator[tuple[str, Any]]:
    """展开 ``matrix2`` / ``vector2`` 的数值分量，附带用于 ``details.field`` 的位置。"""

    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise KernelError("MISSING_FIELD", "矩阵/向量参数必须是数组", "value")
    for row_index, row in enumerate(value):
        if isinstance(row, Sequence) and not isinstance(row, (str, bytes)):
            for column_index, component in enumerate(row):
                yield f"[{row_index}][{column_index}]", component
        else:
            yield f"[{row_index}]", row


def _check_number_bound(
    number: Any,
    minimum: Any,
    maximum: Any,
    *,
    name: str,
    parameter_id: str,
    suffix: str,
) -> None:
    """数值型参数越界检查（含 NaN/Inf 拒绝）；``Decimal`` 按其数值参与比较。"""

    if isinstance(number, Decimal):
        numeric = float(number)
    elif isinstance(number, (int, float)) and not isinstance(number, bool):
        numeric = float(number)
    else:
        return
    if numeric != numeric or numeric in (float("inf"), float("-inf")):
        raise KernelError(
            "MISSING_FIELD",
            f"{name}（{parameter_id}）的取值必须是有限数值",
            f"{parameter_id}{suffix}",
        )
    low = float(minimum) if isinstance(minimum, (int, float)) else None
    high = float(maximum) if isinstance(maximum, (int, float)) else None
    if (low is not None and numeric < low) or (high is not None and numeric > high):
        raise KernelError(
            "MISSING_FIELD",
            f"{name}（{parameter_id}）的取值 {number} 超出允许范围 [{low}, {high}]",
            f"{parameter_id}{suffix}",
        )


def _decimal_of(value: Any) -> Decimal | None:
    """把十进制字符串转 ``Decimal``；非法时返回 ``None``（由调用方决定是否报错）。"""

    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(repr(value))
    if isinstance(value, str):
        try:
            return Decimal(value.strip())
        except (InvalidOperation, ValueError):
            return None
    return None


def _check_decimal_bound(
    raw_value: Any,
    bounds: Mapping[str, Any],
    *,
    name: str,
    parameter_id: str,
) -> None:
    """十进制字符串参数的边界检查（优先用 ``min_decimal`` / ``max_decimal``）。"""

    value = _decimal_of(raw_value)
    if value is None:
        raise KernelError(
            "MISSING_FIELD",
            f"{name}（{parameter_id}）的取值必须是十进制字符串",
            parameter_id,
        )
    low = _decimal_of(bounds.get("min_decimal"))
    high = _decimal_of(bounds.get("max_decimal"))
    if low is None and isinstance(bounds.get("min"), (int, float)):
        low = Decimal(str(bounds["min"]))
    if high is None and isinstance(bounds.get("max"), (int, float)):
        high = Decimal(str(bounds["max"]))
    if (low is not None and value < low) or (high is not None and value > high):
        raise KernelError(
            "MISSING_FIELD",
            f"{name}（{parameter_id}）的取值 {raw_value} 超出允许范围 [{low}, {high}]",
            parameter_id,
        )


def validate_parameter_ranges(document: Mapping[str, Any]) -> None:
    """按参数自带的 ``range`` 做闭区间校验。

    ``C-KO@1`` 的 ``Parameter.range`` 是契约字段，消费方（内核、前端、后端）必须同一判定；
    内核只校验模板自身的物理范围（如矩阵 −3..3、力 0..1000N），这里补上"对象声明的范围"，
    让 422 的 ``details.field`` 能精确指到越界参数（任务约束 4）。
    """

    for parameter in document_parameters(document):
        parameter_id = parameter.get("id")
        if not isinstance(parameter_id, str) or not parameter_id:
            continue
        name = parameter.get("name") if isinstance(parameter.get("name"), str) else parameter_id
        kind = parameter.get("type")
        bounds = parameter.get("range")
        bounds = bounds if isinstance(bounds, Mapping) else {}
        value = parameter.get("value")

        if kind in ("matrix2", "vector2"):
            for suffix, component in _iter_matrix_components(value):
                _check_number_bound(
                    component,
                    bounds.get("min"),
                    bounds.get("max"),
                    name=name,
                    parameter_id=parameter_id,
                    suffix=suffix,
                )
        elif kind == "integer":
            _check_number_bound(
                value,
                bounds.get("min"),
                bounds.get("max"),
                name=name,
                parameter_id=parameter_id,
                suffix="",
            )
        elif kind == "decimal":
            _check_decimal_bound(value, bounds, name=name, parameter_id=parameter_id)
        elif kind == "force_list" and isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            for index, force in enumerate(value):
                if not isinstance(force, Mapping):
                    continue
                _check_number_bound(
                    _decimal_of(force.get("magnitude")),
                    bounds.get("min"),
                    bounds.get("max"),
                    name=name,
                    parameter_id=parameter_id,
                    suffix=f"[{index}].magnitude",
                )


# ---------------------------------------------------------------------------
# 模板 → 内核分派
# ---------------------------------------------------------------------------


def _matrix_result(document: Mapping[str, Any]) -> dict[str, Any]:
    config = document_config(document)
    matrix_id = config.get("matrix_parameter_id")
    matrix_id = matrix_id if isinstance(matrix_id, str) and matrix_id else "matrix_A"
    matrix = parameter_value_by_id(
        document, matrix_id, missing_message=f"缺少矩阵参数 {matrix_id}"
    )
    vector = parameter_value_by_type(document, "vector2", fallback_id="vector_x")
    operation = config.get("operation")

    if operation == "matrix_compose":
        second_id = config.get("second_matrix_parameter_id")
        if not isinstance(second_id, str) or not second_id:
            raise KernelError(
                "MISSING_FIELD",
                "operation=matrix_compose 时必须提供 second_matrix_parameter_id",
                "second_matrix_parameter_id",
            )
        second = parameter_value_by_id(
            document, second_id, missing_message=f"缺少第二个矩阵参数 {second_id}"
        )
        order = config.get("compose_order")
        order = order if isinstance(order, str) and order else "A_then_B"
        return compose_matrices(matrix, second, vector, order)

    return apply_matrix(matrix, vector)


def _force_result(document: Mapping[str, Any]) -> dict[str, Any]:
    config = document_config(document)
    forces = parameter_value_by_type(document, "force_list")
    display_precision = config.get("display_precision", 2)
    compute_precision = config.get("compute_precision", 6)
    return force_resultant(forces, display_precision, compute_precision)


def _bfs_result(document: Mapping[str, Any]) -> dict[str, Any]:
    config = document_config(document)
    graph = parameter_value_by_type(document, "graph")
    if not isinstance(graph, Mapping):
        raise KernelError("MISSING_FIELD", "graph 参数必须是对象", "graph")
    directed = config.get("directed", True)
    return bfs_run(
        graph.get("nodes"),
        graph.get("edges"),
        directed=directed if isinstance(directed, bool) else True,
        start_node_id=config.get("start_node_id"),
        max_steps=config.get("max_steps", 200),
    )


def _people_value(document: Mapping[str, Any], limit_parameter_id: str | None) -> Any:
    """定位人数参数：优先 ``people_n``，否则取第一个非预算上限的整数参数。"""

    candidates = [
        parameter
        for parameter in document_parameters(document)
        if parameter.get("type") == "integer" and parameter.get("id") != limit_parameter_id
    ]
    for parameter in candidates:
        if parameter.get("id") == "people_n":
            return parameter.get("value")
    if candidates:
        return candidates[0].get("value")
    raise KernelError("MISSING_FIELD", "缺少人数参数（integer 型）", "people")


def _plan_coefficient(document: Mapping[str, Any], scenario_id: str, suffix: str) -> Any:
    """方案系数：按 ``{scenario_id}_fixed`` / ``{scenario_id}_per_person`` 约定取参数值。"""

    parameter_id = f"{scenario_id}_{suffix}"
    return parameter_value_by_id(
        document,
        parameter_id,
        missing_message=f"缺少方案系数参数 {parameter_id}（C-BUD@1 的 fixed / per_person）",
    )


def _budget_result(document: Mapping[str, Any]) -> dict[str, Any]:
    config = document_config(document)
    limit_id = config.get("budget_limit_parameter_id")
    limit_id = limit_id if isinstance(limit_id, str) and limit_id else None
    parameter_table = {
        str(parameter.get("id")): parameter.get("value")
        for parameter in document_parameters(document)
        if isinstance(parameter.get("id"), str)
    }
    budget_limit = parameter_table.get(limit_id) if limit_id else None
    people = _people_value(document, limit_id)
    display_precision = config.get("display_precision", 2)

    # C-BUD@1 允许对象携带白名单 AST；示例对象不带 AST（C-06 裁决），按系数形态计算。
    ast_a = config.get("ast_a") or config.get("plan_a_ast")
    ast_b = config.get("ast_b") or config.get("plan_b_ast")
    if ast_a is not None and ast_b is not None:
        return budget_compare(
            ast_a=ast_a,
            ast_b=ast_b,
            parameters=parameter_table,
            people=people,
            budget_limit=budget_limit,
            display_precision=display_precision,
        )

    coefficients = {
        scenario_id: {
            "fixed": _plan_coefficient(document, scenario_id, "fixed"),
            "per_unit": _plan_coefficient(document, scenario_id, "per_person"),
        }
        for scenario_id in ("plan_a", "plan_b")
    }
    return budget_compare(
        coefficients,
        people,
        budget_limit,
        display_precision=display_precision,
    )


#: ``template_id`` → 内核分派函数（白名单之外由调用方先抛 ``UNSUPPORTED_TEMPLATE``）。
TEMPLATE_DISPATCH = {
    "matrix_2d": _matrix_result,
    "force_2d": _force_result,
    "bfs_flow": _bfs_result,
    "budget_compare": _budget_result,
}


def template_of(document: Mapping[str, Any]) -> str:
    """取 ``template_id``；不在白名单时抛 ``UNSUPPORTED_TEMPLATE``（R12-AC3）。"""

    template_id = document.get("template_id")
    if not isinstance(template_id, str) or template_id not in TEMPLATE_IDS:
        raise ApiError(
            ErrorCode.UNSUPPORTED_TEMPLATE,
            f"暂不支持该模板：{template_id}",
            details={"template_id": template_id},
        )
    return template_id


def compute_result(document: Mapping[str, Any]) -> dict[str, Any]:
    """用确定性内核按冻结的对象文档重算 ``Result``（服务端结果永远覆盖客户端结果）。"""

    template_id = template_of(document)
    return TEMPLATE_DISPATCH[template_id](document)


def build_validation_report(
    document: Mapping[str, Any],
    result: Mapping[str, Any],
    model_version: int,
    revision: int,
    *,
    current_model_version: int | None = None,
    current_revision: int | None = None,
) -> dict[str, Any]:
    """调用 T9 的 ``build_report`` 产出 ``ValidationReport``。

    这里**只转换异常类型**，不复制校验逻辑：``expected`` 仍来自独立实现，``actual``
    仍是内核结果（`C-RUN@1` / §2.3.3 的分工）。
    """

    try:
        from ..validators.report import build_report  # noqa: PLC0415 - 保持路由可注册
    except Exception as exc:  # pragma: no cover - 校验器缺失属部署异常
        logger.warning("独立校验器不可用：%s", type(exc).__name__)
        raise model_unavailable("独立校验器不可用，暂无法生成校验报告") from exc

    return build_report(
        document,
        result,
        model_version,
        revision,
        current_model_version=current_model_version,
        current_revision=current_revision,
    )


# ---------------------------------------------------------------------------
# 报告与快照序列化
# ---------------------------------------------------------------------------


#: ``checks.created_at`` 只有秒级精度（T7 表结构），同一秒内多条报告无法只按时间排序；
#: 这里用 SQLite 的隐式行号 ``rowid`` 作为插入顺序（§2.1.1 只落地 SQLite）。
#: 每个对象的 ``checks`` 行只会追加、不会被单独删除（材料删除是整对象级联），
#: 因此同一 ``object_id`` 内 ``rowid`` 单调递增，可稳定判定"谁更晚写入"。
CHECK_TABLE_ROWID = literal_column("checks.rowid")

#: 运行表同理：``runs.created_at`` 也是秒级精度，同秒内多条运行只能靠 ``runs.rowid``
#: 还原插入先后；同一 ``object_id`` 的 runs 行只追加、不单独删除，``rowid`` 单调递增。
RUN_TABLE_ROWID = literal_column("runs.rowid")


def recent_check_rows(
    db: Any, object_id: str, *, limit: int | None = None
) -> list[CheckRecord]:
    """按时间倒序返回校验报告行；**同秒用 rowid 倒序兜底**，保证 ``[0]`` 就是最新。

    只按 ``created_at`` 排序时，同一秒内的多条报告顺序取决于随机字符串主键
    （``rpt_<hex>``），``[0]`` 可能是旧报告 —— 这是 P1 缺陷的根因，必须用 rowid 兜底。
    """

    statement = (
        select(CheckRecord)
        .where(CheckRecord.object_id == object_id)
        .order_by(CheckRecord.created_at.desc(), CHECK_TABLE_ROWID.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return list(db.scalars(statement).all())


def latest_check_row(
    db: Any, object_id: str, current_model_version: int, current_revision: int
) -> CheckRecord | None:
    """取"最近一份"校验报告（``GET /objects/{id}`` 的 ``checks_summary``）。

    排序优先级：

    1. **绑定到对象当前版本**（``model_version`` 与 ``revision`` 都相等）的报告优先：
       只要当前版本被校验过，``checks_summary`` 就取它，绝不会因同秒排序抖动而把
       刚生成的新报告挤掉、让前端看到旧报告被误标 ``is_stale=true``。
       （版本只增不减，因此"绑定当前版本"必然也是"语义上最新"。）
    2. ``created_at`` 倒序。
    3. ``rowid`` 倒序（同秒稳定）。
    """

    matches_current = case(
        (
            and_(
                CheckRecord.model_version == current_model_version,
                CheckRecord.revision == current_revision,
            ),
            1,
        ),
        else_=0,
    )
    statement = (
        select(CheckRecord)
        .where(CheckRecord.object_id == object_id)
        .order_by(
            matches_current.desc(),
            CheckRecord.created_at.desc(),
            CHECK_TABLE_ROWID.desc(),
        )
        .limit(1)
    )
    return db.scalars(statement).first()


def recent_run_rows(
    db: Any, object_id: str, *, limit: int | None = None
) -> list[RunRecord]:
    """按时间倒序返回运行快照行；**同秒用 runs.rowid 倒序兜底**，保证 ``[0]`` 最新。

    与 :func:`recent_check_rows` 同一口径（P1 同源缺陷）：只按 ``created_at`` 排序时，
    同一秒内的多条运行顺序取决于随机字符串主键（``run_<hex>``），回放列表首条可能不是
    最新一次运行。``#17`` 按主键取单条，不依赖本顺序。
    """

    statement = (
        select(RunRecord)
        .where(RunRecord.object_id == object_id)
        .order_by(RunRecord.created_at.desc(), RUN_TABLE_ROWID.desc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    return list(db.scalars(statement).all())


def stale_report(
    report: Mapping[str, Any] | None,
    current_model_version: int,
    current_revision: int,
) -> dict[str, Any] | None:
    """按对象**当前**版本重算 ``is_stale`` 后序列化报告（§2.2.7 行为 4、R10-AC7）。

    ``is_stale`` **只**由"报告自身绑定的 ``model_version`` / ``revision`` 与对象当前值
    是否一致"决定（§2.2.2 语义），与 ``created_at``、取用顺序、同秒冲突都无关：

    - 两者都相等 → ``false``（当前版本的报告永远不因"取到它自己"被判过期）；
    - 任一不等 → ``true``（结构变更或参数变更之后的旧报告必须显示"过期"）。

    这样"最近报告取错"只会体现为**选中的报告不对**，而不会污染 ``is_stale`` 的判定口径；
    取用顺序的稳定性由 :func:`latest_check_row` / :func:`recent_check_rows` 负责。
    过期只由 ``is_stale`` 表达，不改写 ``items`` 的状态，也不把 ``stale`` 计入 ``summary``。
    """

    if not isinstance(report, Mapping):
        return None

    payload = dict(report)
    bound_model_version = payload.get("model_version")
    bound_revision = payload.get("revision")
    if isinstance(bound_model_version, int) and isinstance(bound_revision, int):
        payload["is_stale"] = bool(
            bound_model_version != current_model_version
            or bound_revision != current_revision
        )

    try:
        # 复核一次契约形状（含 summary 与 items 计数一致），再按契约键名输出。
        return ValidationReport.model_validate(payload).to_payload()
    except Exception as exc:  # noqa: BLE001 - 历史脏数据不应让查询端点 500
        logger.warning("校验报告不符合 C-RUN@1（%s），按原样返回", type(exc).__name__)
        return payload


def run_payload(
    run: Any,
    current_model_version: int,
    current_revision: int,
) -> dict[str, Any]:
    """ORM ``RunRecord`` → ``RunSnapshot``（snake_case，逐字按 C-RUN@1）。"""

    report = stale_report(run.validation_report, current_model_version, current_revision)
    payload = {
        "run_id": run.id,
        "object_id": run.object_id,
        "model_version": run.model_version,
        "revision": run.revision,
        "kernel_version": run.kernel_version,
        "input_snapshot": run.input_snapshot,
        "result": run.result,
        "validation_report": report,
        "created_at": run.created_at,
    }
    try:
        RunSnapshot.model_validate(payload)
    except Exception as exc:  # noqa: BLE001 - 历史快照不阻断回放
        logger.warning("运行 %s 的快照不符合 C-RUN@1（%s）", getattr(run, "id", "?"), type(exc).__name__)
    return payload


def persist_check(
    db: Any, record: KnowledgeObjectRecord, report: Mapping[str, Any]
) -> CheckRecord:
    """把报告留档到 ``checks``（不写 run，端点 #18 与编译任务共用）。

    报告 id 与库主键一致，重复写入时幂等返回既有行（不产生重复数据）。
    """

    report_id = report.get("report_id")
    if not isinstance(report_id, str) or not report_id:
        raise model_unavailable("校验报告缺少 report_id，无法留档")
    existing = db.get(CheckRecord, report_id)
    if existing is not None:
        return existing

    created_at = report.get("created_at")
    row = CheckRecord(
        id=report_id,
        session_id=record.session_id,
        object_id=record.id,
        model_version=int(report.get("model_version") or record.model_version),
        revision=int(report.get("revision") or record.revision),
        kernel_version=str(report.get("kernel_version") or record.kernel_version),
        validation_profile=str(report.get("validation_profile") or record.validation_profile),
        report=dict(report),
        created_at=created_at if isinstance(created_at, str) and created_at else to_iso(utc_now()),
    )
    db.add(row)
    return row


# ---------------------------------------------------------------------------
# 幂等与结构变更判定
# ---------------------------------------------------------------------------


def computation_fingerprint(document: Mapping[str, Any]) -> str:
    """影响计算结果的字段指纹：用于"重复提交同一 run 不产生重复数据"的判定。"""

    return json.dumps(
        {key: document.get(key) for key in COMPUTATION_KEYS},
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )


def structural_signature(document: Mapping[str, Any]) -> str:
    """结构签名：只有节点/边/模板/AST 依赖等变化才算 ``model_version`` 推进（§2.3.2）。

    参数**数值**不参与签名，因此"只改数值"走 ``revision += 1`` 分支。
    """

    parameters = [
        {key: parameter.get(key) for key in STRUCTURAL_PARAMETER_KEYS}
        for parameter in document_parameters(document)
    ]
    signature = {
        "template_id": document.get("template_id"),
        "kernel_version": document.get("kernel_version"),
        "config": document.get("config"),
        "views": document.get("views"),
        "bindings": document.get("bindings"),
        "source_refs": document.get("source_refs"),
        "validation_profile": document.get("validation_profile"),
        "parameters": parameters,
    }
    return json.dumps(signature, sort_keys=True, ensure_ascii=False, default=str)


__all__ = [
    "CHECK_TABLE_ROWID",
    "COMPUTATION_KEYS",
    "RUN_TABLE_ROWID",
    "STRUCTURAL_PARAMETER_KEYS",
    "api_error_from",
    "build_validation_report",
    "computation_fingerprint",
    "compute_result",
    "conflict_for",
    "document_config",
    "document_parameters",
    "kernel_error_boundary",
    "latest_check_row",
    "parameter_value_by_id",
    "parameter_value_by_type",
    "persist_check",
    "recent_check_rows",
    "recent_run_rows",
    "run_payload",
    "stale_report",
    "structural_signature",
    "template_of",
    "validate_parameter_ranges",
]