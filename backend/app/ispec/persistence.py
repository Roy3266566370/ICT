"""iSpec 参数值的跨会话持久化（整改文件 §10.1 第 5 步）。

背景：
    "保存并重新打开，恢复同一状态。" 此前 iSpec 参数只写浏览器
    ``sessionStorage``——换浏览器、关标签页后参数即丢失。区域参数已经能跨会话
    （``backend/data/regions/``），这里把同一语义补到 iSpec：

    1. 按 ``material_id`` 落盘 ``backend/data/ispec-values/<material_id>.json``，
       文件内再按 ``object_id`` 分桶，于是同一材料的多个 iSpec 互不覆盖；
    2. 每桶只有 ``{"values": {...}, "updated_at": ISO8601}`` 两个字段。``updated_at``
       是**桶级**版本号，PUT 时携带上一次读到的值即可做乐观锁；
    3. 写入先在**同目录**写 ``.tmp`` 再 ``os.replace``，并全程持 ``threading.Lock``
       （uvicorn 默认单进程多线程），避免半截 JSON 与"读-改-写"丢更新；
    4. 只接受标量（number / boolean / string）。嵌套对象、数组、函数一律拒绝：
       这些值既无法做乐观锁比较，也会让"参数值"变成一个不受 schema 约束的黑盒；
    5. 单条 iSpec（单个 object 桶）参数数 > 500 直接拒绝，防止被当作任意 KV 存储滥用。

跨 iSpec 共享池（§9-4）复用同一文件：前端把池值写到固定的 :data:`SHARED_OBJECT_ID`
桶里，因此"改一处、全课同步"的池值同样能跨会话恢复。

本模块不抛 HTTP 错误：路由层负责把 :class:`InvalidISpecValues` 映射为 422
``MISSING_FIELD``，把 :class:`VersionConflict` 映射为 409 ``VERSION_CONFLICT``。
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
from collections.abc import Mapping
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..schemas.common import parse_iso, to_iso, utc_now
from ..settings import DATA_DIR

logger = logging.getLogger(__name__)

#: 默认落盘目录。测试 / 多实例可通过 ``ISPEC_VALUES_DIR`` 环境变量整体重定向，
#: 避免把临时数据写进仓库内的 ``backend/data``。
DEFAULT_VALUES_DIR = DATA_DIR / "ispec-values"
#: 环境变量名（值为绝对路径）。
VALUES_DIR_ENV = "ISPEC_VALUES_DIR"
#: 文件内 schema 版本，便于将来无损迁移。
SCHEMA_VERSION = "1"
#: 单个 object 桶允许的最大参数条数（防滥用）。
MAX_PARAMETERS_PER_OBJECT = 500
#: 跨 iSpec 共享池的固定桶名（与前端 ``ISpecValuesRecord`` 的约定一一对应）。
SHARED_OBJECT_ID = "__shared__"
#: 材料 / 对象标识只允许安全字符（id 由服务端生成，此处是纵深防御）。
MATERIAL_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
OBJECT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")
#: 参数 id 的长度上限（防止用超长键撑爆文件）。
MAX_PARAMETER_ID_LENGTH = 128
#: 同目录"读-改-写"的串行锁。读也要加锁，否则可能读到替换中的旧内容。
_LOCK = threading.Lock()


class ISpecValueError(ValueError):
    """iSpec 参数持久化层的基类异常（不直接映射 HTTP 状态码）。"""


class InvalidISpecValues(ISpecValueError):
    """值不合法：非标量、参数过多、标识非法。"""


class VersionConflict(ISpecValueError):
    """乐观锁失败：``expected_updated_at`` 与磁盘上的版本不一致。

    同时携带**当前服务器值**（``current_values`` / ``current_updated_at``），
    供调用方合并后再保存，而不是让前端盲目丢弃用户输入。
    """

    def __init__(self, current_values: Mapping[str, Any], current_updated_at: str | None) -> None:
        self.current_values = dict(current_values)
        self.current_updated_at = current_updated_at
        super().__init__("参数已在别处更新")


# ---------------------------------------------------------------------------
# 路径与读写
# ---------------------------------------------------------------------------


def values_dir() -> Path:
    """返回本模块使用的落盘目录（``ISPEC_VALUES_DIR`` 可重定向）。"""

    override = os.environ.get(VALUES_DIR_ENV, "").strip()
    return Path(override) if override else DEFAULT_VALUES_DIR


def values_path(material_id: str) -> Path:
    """材料对应参数文件路径；非法 id 直接拒绝（不拼进路径）。"""

    if MATERIAL_ID_PATTERN.match(material_id) is None:
        raise InvalidISpecValues(f"材料标识不合法：{material_id!r}")
    return values_dir() / f"{material_id}.json"


def _check_object_id(object_id: str) -> str:
    if OBJECT_ID_PATTERN.match(object_id) is None:
        raise InvalidISpecValues(f"object_id 不合法：{object_id!r}")
    return object_id


def _empty_payload(material_id: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "material_id": material_id,
        "objects": {},
    }


def _read_payload(path: Path, material_id: str) -> dict[str, Any]:
    """读取文件；缺失 / 损坏 / 结构不符一律退化为空载荷（不阻断阅读）。"""

    if not path.is_file():
        return _empty_payload(material_id)
    try:
        with path.open(encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError) as exc:
        logger.warning("iSpec 参数文件 %s 读取失败，按无数据处理：%s", path.name, exc)
        return _empty_payload(material_id)
    if not isinstance(raw, dict):
        return _empty_payload(material_id)
    objects = _clean_objects(raw.get("objects"))
    return {
        "schema_version": SCHEMA_VERSION,
        "material_id": material_id,
        "objects": objects,
    }


def _clean_objects(raw: Any) -> dict[str, dict[str, Any]]:
    """把磁盘内容收窄为 ``{object_id: {values, updated_at}}``；坏桶整条丢弃。"""

    if not isinstance(raw, Mapping):
        return {}
    cleaned: dict[str, dict[str, Any]] = {}
    for object_id, entry in raw.items():
        if not isinstance(object_id, str) or OBJECT_ID_PATTERN.match(object_id) is None:
            continue
        if not isinstance(entry, Mapping):
            continue
        values = entry.get("values")
        if not isinstance(values, Mapping):
            continue
        try:
            clean_values = _normalize_values(values)
        except InvalidISpecValues as exc:
            logger.warning("iSpec 参数桶 %s 内容非法，已忽略：%s", object_id, exc)
            continue
        updated_at = entry.get("updated_at")
        cleaned[object_id] = {
            "values": clean_values,
            "updated_at": updated_at if isinstance(updated_at, str) else None,
        }
    return cleaned


def _write_payload(path: Path, payload: Mapping[str, Any]) -> Path:
    """原子写：同目录 ``.tmp`` → ``os.replace``；调用方必须已持有 :data:`_LOCK`。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
    try:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return path


# ---------------------------------------------------------------------------
# 值校验
# ---------------------------------------------------------------------------


def _is_scalar(value: Any) -> bool:
    """number / boolean / string；拒绝 ``None``、嵌套容器、函数与 NaN/Inf。"""

    if isinstance(value, bool) or isinstance(value, str):
        return True
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    return False


def _normalize_values(values: Any) -> dict[str, Any]:
    """校验并复制参数值；任何一条不合法就整体拒绝（不做"部分保存"）。

    整体拒绝的理由：部分保存会让用户看到"保存成功"但实际丢了一半参数，
    后续读取时难以解释；宁可 422 让前端降级到本机草稿并提示。
    """

    if not isinstance(values, Mapping):
        raise InvalidISpecValues("values 必须是对象（参数 id → 标量值）")
    if len(values) > MAX_PARAMETERS_PER_OBJECT:
        raise InvalidISpecValues(
            f"单个 iSpec 的参数不能超过 {MAX_PARAMETERS_PER_OBJECT} 条"
        )
    clean: dict[str, Any] = {}
    for key, value in values.items():
        if not isinstance(key, str) or not key or len(key) > MAX_PARAMETER_ID_LENGTH:
            raise InvalidISpecValues(f"参数 id 不合法：{key!r}")
        if not _is_scalar(value):
            raise InvalidISpecValues(
                f"参数 {key} 的值不是标量（只允许 number / boolean / string）"
            )
        clean[key] = value
    return clean


def _next_updated_at(previous: str | None) -> str:
    """生成严格递增的 ``updated_at``（秒级精度下两次保存可能同秒）。"""

    candidate = to_iso(utc_now())
    if previous is None or candidate > previous:
        return candidate
    try:
        moment: datetime = parse_iso(previous)
    except ValueError:
        return candidate
    return to_iso(moment + timedelta(seconds=1))


# ---------------------------------------------------------------------------
# 对外 API
# ---------------------------------------------------------------------------


def load_values(material_id: str) -> dict[str, dict[str, Any]]:
    """读取该材料全部 object 桶。

    返回 ``{object_id: {"values": {param_id: value}, "updated_at": str | None}}``。

    任务书里写作 ``{param_id: value, updated_at}``；这里多包一层 ``values``，
    避免参数 id 恰好叫 ``updated_at`` 时与元字段冲突（同名参数是合法的 iSpec id）。
    调用方（路由层）把条目映射为对外的 ``{object_id, values, updated_at}``。
    """

    path = values_path(material_id)
    with _LOCK:
        payload = _read_payload(path, material_id)
    return dict(payload["objects"])


def save_values(
    material_id: str,
    object_id: str,
    values: Mapping[str, Any],
    expected_updated_at: str | None = None,
) -> dict[str, Any]:
    """整体覆盖一个 object 桶，返回 ``{object_id, values, updated_at}``。

    - ``values`` 为空对象表示**清除**该桶（重置参数时调用），返回的
      ``updated_at`` 为 ``None``；
    - ``expected_updated_at is None`` 表示不做乐观锁校验（首次保存 / 已合并过）；
    - ``expected_updated_at`` 与当前版本不一致时抛 :class:`VersionConflict`，
      并带上当前值供调用方合并。

    读-改-写在 :data:`_LOCK` 内完成，因此并发 PUT 不会互相覆盖而不报冲突。
    """

    _check_object_id(object_id)
    clean = _normalize_values(values)
    path = values_path(material_id)

    with _LOCK:
        payload = _read_payload(path, material_id)
        objects: dict[str, dict[str, Any]] = payload["objects"]
        current = objects.get(object_id)
        current_values: dict[str, Any] = dict(current["values"]) if current is not None else {}
        current_updated_at: str | None = current["updated_at"] if current is not None else None

        if expected_updated_at is not None:
            # 客户端认为"无值"时传空串；与磁盘上的 None 等价，不算冲突。
            if expected_updated_at != (current_updated_at or ""):
                raise VersionConflict(current_values, current_updated_at)

        if clean:
            updated_at = _next_updated_at(current_updated_at)
            objects[object_id] = {"values": clean, "updated_at": updated_at}
        else:
            objects.pop(object_id, None)
            updated_at = None

        _write_payload(
            path,
            {
                "schema_version": SCHEMA_VERSION,
                "material_id": material_id,
                "objects": objects,
            },
        )

    logger.info(
        "材料 %s 的对象 %s 参数已落盘：%d 条（%s）",
        material_id,
        object_id,
        len(clean),
        "已清除" if not clean else f"updated_at={updated_at}",
    )
    return {"object_id": object_id, "values": clean, "updated_at": updated_at}


def migrate_unchanged_values(material_id:str, previous:list[dict[str,Any]], current:list[dict[str,Any]])->None:
    """A content edit creates new IDs; carry saved inputs only when the calculation is unchanged."""
    def identity(spec):
        return re.sub(r'__r\d+$','',spec['object_id'])
    def signature(spec):
        return {key:spec.get(key) for key in ('kind','parameters','expressions','constraints','datasets','anchor')}
    before={identity(spec):spec for spec in previous}
    path=values_path(material_id)
    with _LOCK:
        payload=_read_payload(path,material_id)
        objects=payload['objects']
        changed=False
        for spec in current:
            old=before.get(identity(spec))
            if not old or old['object_id']==spec['object_id'] or signature(old)!=signature(spec):
                continue
            saved=objects.get(old['object_id'])
            if saved and spec['object_id'] not in objects:
                objects[spec['object_id']]={'values':dict(saved['values']),'updated_at':_next_updated_at(None)}
                changed=True
        if changed:
            _write_payload(path,payload)


def clear_values(material_id: str) -> None:
    """删除该材料的参数文件（材料被删除时调用；幂等）。"""

    try:
        path = values_path(material_id)
    except InvalidISpecValues:
        return
    with _LOCK:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:  # pragma: no cover - 权限/占用属于环境问题
            logger.warning("iSpec 参数文件 %s 删除失败：%s", path.name, exc)


__all__ = [
    "DEFAULT_VALUES_DIR",
    "InvalidISpecValues",
    "ISpecValueError",
    "MAX_PARAMETERS_PER_OBJECT",
    "SCHEMA_VERSION",
    "SHARED_OBJECT_ID",
    "VALUES_DIR_ENV",
    "VersionConflict",
    "clear_values",
    "load_values",
    "save_values",
    "values_dir",
    "values_path",
]
