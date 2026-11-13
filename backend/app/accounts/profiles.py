"""账号资料与偏好（``C-PROFILE@1``）。

- ``user_profiles`` 与 ``users`` 一对一；老账号首次读取时惰性建行，避免迁移脚本；
- 昵称（``users.display_name``）与用户名（登录身份）分离：本模块只改昵称；
- 兴趣标签以 JSON 数组字符串落库，读取时容错解析（损坏数据回退空数组）；
- 所有校验失败统一 ``MISSING_FIELD``（422），与既有账号接口的错误形状一致；
- 日志不记录简介、标签等个人资料内容。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.account_models import UserProfileRecord, UserRecord, utc_now
from ..schemas.errors import missing_field

logger = logging.getLogger(__name__)

#: 登录后的默认落地入口（与前端 `DefaultEntry` 同取值）。
DEFAULT_ENTRY_SPACE = "space"
DEFAULT_ENTRY_LABS = "labs"
DEFAULT_ENTRIES: frozenset[str] = frozenset({DEFAULT_ENTRY_SPACE, DEFAULT_ENTRY_LABS})

DISPLAY_NAME_MAX_LENGTH = 64
BIO_MAX_LENGTH = 200
PROFILE_TEXT_MAX_LENGTH = 64
SUBJECT_MAX_LENGTH = 32
INTEREST_MAX_COUNT = 8
INTEREST_MAX_LENGTH = 24
#: 中国大陆手机号：11 位、1 开头、第二位 3–9。
PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")
PHONE_MAX_LENGTH = 32


def get_or_create_profile(db: Session, user_id: str) -> UserProfileRecord:
    """取账号资料；不存在时创建默认资料（并发安全，失败时回读既有行）。"""

    profile = db.get(UserProfileRecord, user_id)
    if profile is not None:
        return profile

    moment = utc_now()
    profile = UserProfileRecord(
        user_id=user_id,
        bio="",
        occupation="",
        school="",
        phone="",
        interests="[]",
        preferred_subject="",
        default_entry=DEFAULT_ENTRY_SPACE,
        avatar_id=None,
        avatar_updated_at=None,
        created_at=moment,
        updated_at=moment,
    )
    db.add(profile)
    try:
        db.commit()
    except IntegrityError:
        # 并发请求已创建同一行：回滚后以数据库中的行为准。
        db.rollback()
        existing = db.get(UserProfileRecord, user_id)
        if existing is None:
            raise
        return existing
    return profile


def interests_of(profile: UserProfileRecord) -> list[str]:
    """把 ``interests`` 列解析为字符串数组；损坏数据回退空数组而不是报错。"""

    try:
        raw = json.loads(profile.interests or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, str)]


def _clean_text(value: str) -> str:
    return value.strip()


def _validate_length(value: str, maximum: int, label: str) -> str:
    if len(value) > maximum:
        raise missing_field(f"{label}最多 {maximum} 个字符", field=label)
    return value


def normalize_phone(value: str) -> str:
    """规范化手机号；空串表示清除。支持 ``+86`` / ``86`` 前缀与空格、短横线。

    只接受中国大陆 11 位手机号（``1[3-9]`` 开头），否则抛 422；返回值只含数字。
    """

    raw = (value or "").strip()
    if raw == "":
        return ""
    digits = re.sub(r"[\s\-]", "", raw)
    if digits.startswith("+"):
        digits = digits[1:]
    if len(digits) == 13 and digits.startswith("86"):
        digits = digits[2:]
    if PHONE_PATTERN.fullmatch(digits) is None:
        raise missing_field(
            "手机号格式不正确，请输入 11 位中国大陆手机号", field="phone"
        )
    return digits


def _normalize_interests(interests: Sequence[str]) -> list[str]:
    """去空白、去空项、去重并保留顺序；校验数量与单项长度。"""

    normalized: list[str] = []
    for item in interests:
        if not isinstance(item, str):
            raise missing_field("兴趣标签必须是文本", field="interests")
        text = item.strip()
        if text == "" or text in normalized:
            continue
        if len(text) > INTEREST_MAX_LENGTH:
            raise missing_field(
                f"单个兴趣标签最多 {INTEREST_MAX_LENGTH} 个字符", field="interests"
            )
        normalized.append(text)
    if len(normalized) > INTEREST_MAX_COUNT:
        raise missing_field(f"兴趣标签最多 {INTEREST_MAX_COUNT} 个", field="interests")
    return normalized


def update_profile(
    db: Session,
    user: UserRecord,
    *,
    display_name: Optional[str] = None,
    bio: Optional[str] = None,
    occupation: Optional[str] = None,
    school: Optional[str] = None,
    phone: Optional[str] = None,
    interests: Optional[Sequence[str]] = None,
    preferred_subject: Optional[str] = None,
    default_entry: Optional[str] = None,
) -> UserProfileRecord:
    """更新当前账号的昵称、简介与偏好；``None`` 表示"保持不变"。

    只允许调用方传入 ``get_active_user`` 取到的账号，本函数不做权限判断。
    """

    profile = get_or_create_profile(db, user.id)
    moment = utc_now()

    if display_name is not None:
        name = _clean_text(display_name)
        if name == "":
            raise missing_field("昵称不能为空", field="display_name")
        user.display_name = _validate_length(name, DISPLAY_NAME_MAX_LENGTH, "昵称")
    if bio is not None:
        profile.bio = _validate_length(_clean_text(bio), BIO_MAX_LENGTH, "个人简介")
    if occupation is not None:
        profile.occupation = _validate_length(
            _clean_text(occupation), PROFILE_TEXT_MAX_LENGTH, "职业"
        )
    if school is not None:
        profile.school = _validate_length(
            _clean_text(school), PROFILE_TEXT_MAX_LENGTH, "学校"
        )
    if phone is not None:
        profile.phone = normalize_phone(phone)
    if interests is not None:
        profile.interests = json.dumps(
            _normalize_interests(interests), ensure_ascii=False
        )
    if preferred_subject is not None:
        profile.preferred_subject = _validate_length(
            _clean_text(preferred_subject), SUBJECT_MAX_LENGTH, "常用学科"
        )
    if default_entry is not None:
        if default_entry not in DEFAULT_ENTRIES:
            raise missing_field("默认入口只能是 space 或 labs", field="default_entry")
        profile.default_entry = default_entry

    profile.updated_at = moment
    db.commit()
    logger.info("已更新账号资料 user_id=%s", user.id)
    return profile


__all__ = [
    "BIO_MAX_LENGTH",
    "DEFAULT_ENTRIES",
    "DEFAULT_ENTRY_LABS",
    "DEFAULT_ENTRY_SPACE",
    "DISPLAY_NAME_MAX_LENGTH",
    "INTEREST_MAX_COUNT",
    "INTEREST_MAX_LENGTH",
    "PHONE_MAX_LENGTH",
    "PHONE_PATTERN",
    "get_or_create_profile",
    "interests_of",
    "normalize_phone",
    "update_profile",
]
