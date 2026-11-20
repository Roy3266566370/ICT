"""应用配置：全部由环境变量驱动，代码内不写任何真实密钥（R12-AC5、R14-AC4）。

环境变量一览（大小写不敏感，可写入 ``backend/.env``；**不含**真实密钥）：

======================  ==========================  ==========================================
变量名                   默认值                       说明
======================  ==========================  ==========================================
``DATABASE_URL``        ``sqlite:///<backend>/data/xiangsheng.db``  数据库地址，可覆盖（§2.1.1）
``SESSION_SECRET``      （随机生成 + 启动告警）        会话签名密钥；缺失时用
                                                    ``secrets.token_hex`` 生成并提示配置
``SESSION_COOKIE_SECURE`` ``false``                  Cookie 的 ``Secure`` 属性；本地无 HTTPS 时
                                                    必须为 false（T7 验收 3）
``SESSION_TTL_HOURS``   ``24``                      访客会话有效期
``MATERIAL_RETENTION_HOURS`` ``24``                 访客材料保留期（R2-AC5）
``MAX_UPLOAD_BYTES``    ``73400320``                单文件上限 70MB（R3-AC1）
``MAX_UNZIPPED_BYTES``  ``209715200``               解压总量上限 200MB（§2.2.8）
``MAX_SLIDE_PAGES``     ``100``                     页数上限（R3-AC1）
``ALLOWED_ORIGINS``     ``http://localhost:5173,...`` 写请求 Origin 允许列表（R13-AC4）
``ENFORCE_CSRF``        ``true``                    写请求是否校验 X-CSRF-Token
``LOG_LEVEL``           ``INFO``                    应用日志级别
``STRICT_ROUTE_CHECK``  ``true``                    启动期校验必需账号路由；``false`` 仅作应急旁路
                                                     （``C-ROUTE-CHECK@1``，默认必须为 true）
``RENDER_ENGINE``       ``auto``                    渲染引擎：auto/powerpoint_com/libreoffice/svg_fallback
``RENDER_WIDTH``        ``1920``                    整页图宽度
``RENDER_HEIGHT``       ``1080``                    整页图高度
``RENDER_TIMEOUT_S``    ``240``                     单次渲染超时（秒）
``RENDER_EXTRACT_IMAGES`` ``true``                  是否从 pptx 提取原始图片
``ERASE_VARIANCE_THRESHOLD`` ``6.0``                擦除前 bbox 外环带允许的像素方差
``ISEPC_LLM_PROVIDER``  ``none``                    识别层 LLM provider 名；``none`` 表示未接入
``ISEPC_LLM_API_KEY``   （空）                      LLM 密钥；**只能由部署环境注入**，禁止硬编码
``ISEPC_LLM_MODEL``     （空）                      LLM 模型名
``ISEPC_LLM_TIMEOUT_S`` ``20``                      单次 LLM 调用超时（秒）
``ISEPC_LLM_MAX_CALLS`` ``8``                       单份材料允许的 LLM 调用上限
``LAB_AI_ENABLED``      ``false``                   题目实验室是否允许调用 LLM；默认关闭
``PPT_AI_ENABLED``      ``true``                    PPT AI 交互增强总开关；关闭后原有阅读/编辑/分享仍可用
``PPT_AI_GENERATED_VIEWS_ENABLED`` ``false``       专用视图程序试验开关；默认关闭
``PPT_AI_TASK_MAX_CALLS`` ``3``                     单次 PPT AI 任务模型调用上限
``PPT_AI_TASK_TIMEOUT_S`` ``300``                    单次 PPT AI 任务时限（秒）
``PPT_AI_VIEW_TIMEOUT_MS`` ``200``                   专用视图单次渲染超时（毫秒）
``PPT_AI_MAX_ARTIFACT_BYTES`` ``8388608``            新增视图资源总上限（字节）
``PPT_AI_MAX_LLM_TOKENS`` ``4096``                   单次模型输出 token 上限
``LAB_MAX_FILES``       ``6``                       题目实验室单次上传文件数
``LAB_MAX_PAGES``       ``20``                      题目实验室读取页数上限
``LAB_MAX_TEXT_CHARS``  ``30000``                   粘贴题目文字上限
======================  ==========================  ==========================================

账号与 MySQL（``C-DB@1``，T1 追加，仅追加不改变既有字段）：

``AUTH_COOKIE_NAME``  ``xs_auth``；``AUTH_SESSION_ABSOLUTE_HOURS``  ``24``；
``AUTH_SESSION_IDLE_HOURS``  ``12``；``AUTH_REMEMBER_ABSOLUTE_HOURS``  ``720``；
``AUTH_REMEMBER_IDLE_HOURS``  ``168``；``AUTH_DEVELOPMENT_ACTIVE_ON_REGISTER``  ``true``；
``DB_POOL_SIZE``  ``5``；``DB_MAX_OVERFLOW``  ``5``；``DB_POOL_TIMEOUT_SECONDS``  ``10``；
``DB_POOL_RECYCLE_SECONDS``  ``1800``；``MIGRATION_DATABASE_URL``  （空，仅 Alembic 使用）。

注册邮箱验证码（Brevo 事务邮件）：

``BREVO_API_KEY``  （空，只能由部署环境注入）；``BREVO_SENDER_EMAIL``  （空，必须是
Brevo 已验证的发件人）；``BREVO_SENDER_NAME``  ``万象 WANXIANG``；``BREVO_API_URL``
``https://api.brevo.com/v3/smtp/email``；``BREVO_TIMEOUT_S``  ``10``；
``REGISTER_CODE_TTL_SECONDS``  ``300``；``REGISTER_CODE_RESEND_SECONDS``  ``60``；
``REGISTER_CODE_MAX_ATTEMPTS``  ``5``。

账号资料与头像（``C-PROFILE@1``）：``AVATAR_MAX_BYTES``  ``2097152``（2MB）；
``AVATAR_SIZE``  ``512``（服务端重编码后的正方形边长）。
``DATABASE_URL`` 默认值保持 SQLite 不变；只有显式设置 MySQL 串时才切换驱动。

目录常量集中在模块级，测试与脚本可直接引用，不需要再读环境变量。
"""

from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

#: ``backend/`` 目录（``app/settings.py`` 的上两级）。
BACKEND_DIR = Path(__file__).resolve().parents[1]
#: 仓库根目录。
REPO_ROOT = BACKEND_DIR.parent
#: SQLite 与上传原件的落盘根目录（§2.1.1）。
DATA_DIR = BACKEND_DIR / "data"
#: 上传原件与预览目录：``backend/data/uploads/{material_id}/``。
UPLOAD_DIR = DATA_DIR / "uploads"
#: 契约夹具根目录（``fixtures/``，只读）。
FIXTURES_DIR = REPO_ROOT / "fixtures"
#: 手工示例目录（T1 产出，只读）。
EXAMPLES_DIR = FIXTURES_DIR / "examples"
#: PPT 内嵌图导出目录（只读基线，R4-AC2）。
PPT_DIR = FIXTURES_DIR / "ppt"
#: 默认 SQLite 文件（``DATABASE_URL`` 可覆盖）。
DEFAULT_DB_PATH = DATA_DIR / "xiangsheng.db"
#: 渲染产物根目录，按 material_id 隔离（spec §3.2）。
RENDERS_DIR = DATA_DIR / "renders"
#: 课程材料的整页图与擦除图（只读基线，spec §3.2 的仓库内副本）。
FIXTURE_PAGES_DIR = FIXTURES_DIR / "pages"
#: 解析产物根目录（``fixtures/materials/<material>/``，只读）。
MATERIALS_DIR = FIXTURES_DIR / "materials"
#: 题目实验室的上传原件、页预览与识别产物。
LABS_DIR = DATA_DIR / "labs"
#: 活页的上传原件与页预览（``backend/data/living/{page_id}/``）。
LIVING_DIR = DATA_DIR / "living"
#: 账号头像（重新编码后的 JPEG，按 user_id 命名）。
AVATAR_DIR = DATA_DIR / "avatars"

#: 默认允许的写请求来源。
#:
#: 同一个本地服务可以用三种写法打开：``localhost``、``127.0.0.1``、``[::1]``
#: （Vite 默认只监听 IPv6 回环，从 ``http://[::1]:5173/`` 打开时浏览器发出的
#: ``Origin`` 就是 ``http://[::1]:5173``，与 ``localhost`` 不相等）。
#: 三者都指向本机，缺任何一个都会出现"上传/保存被拒绝：请求来源不被允许"，
#: 因此回环别名与端口一起列全；生产环境用 ``ALLOWED_ORIGINS`` 覆盖成本域即可。
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "[::1]")
#: 本地会用到这些端口：5173 前端 dev、4173 前端 preview、8000 后端、8080 compose。
_LOCAL_PORTS = (5173, 4173, 8000, 8080)
DEFAULT_ORIGINS = tuple(
    f"http://{host}:{port}" for port in _LOCAL_PORTS for host in _LOOPBACK_HOSTS
)


class Settings(BaseSettings):
    """运行期配置。字段名即环境变量名（大小写不敏感）。"""

    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        validate_assignment=False,
    )

    # --- 应用 ---
    app_name: str = "万象 WANXIANG API"
    app_version: str = "0.2.0"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"

    # --- 启动期路由完整性（C-ROUTE-CHECK@1）---
    # 默认必须为 True：缺少账号路由时后端不得启动。仅在 .env 显式写入
    # ``STRICT_ROUTE_CHECK=false`` 时才允许应急旁路（R1-AC2 / R1-AC3）。
    strict_route_check: bool = Field(
        default=True,
        description="启动期校验必需账号路由模块与端点；false 仅作应急旁路，默认必须为 true",
    )

    # --- 存储 ---
    database_url: str = Field(
        default="sqlite:///" + DEFAULT_DB_PATH.as_posix(),
        description="SQLAlchemy 连接串；默认落在 backend/data/xiangsheng.db",
    )

    # --- 会话 ---
    session_secret: str = Field(
        default="",
        description="会话签名密钥；为空时启动期随机生成并告警，禁止硬编码",
    )
    session_cookie_name: str = "xiangsheng_session"
    session_cookie_secure: bool = False
    session_ttl_hours: int = Field(default=24, ge=1)
    material_retention_hours: int = Field(default=24, ge=1)
    enforce_csrf: bool = True
    allowed_origins: list[str] = Field(default_factory=lambda: list(DEFAULT_ORIGINS))

    # --- 上传限制（R3-AC1、§2.2.8）---
    max_upload_bytes: int = Field(default=70 * 1024 * 1024, ge=1)
    max_unzipped_bytes: int = Field(default=200 * 1024 * 1024, ge=1)

    # --- 识图模型（可选；默认关闭，不影响无 Key 环境）---
    llm_provider: str = Field(
        default="maas",
        description="识别层模型供应方：none | maas；只有 maas 且配置了 Key 才会联网",
    )
    llm_base_url: str = Field(
        default="https://api.modelarts-maas.com/v2",
        description="OpenAI 兼容端点前缀（MaaS 默认西南-贵阳一）",
    )
    llm_model: str = Field(default="deepseek-v4.1-flash-1017", description="模型 ID；需在控制台确认支持图片输入")
    llm_api_key: str = Field(default="", description="API Key；只从环境变量 LLM_API_KEY 读取")
    llm_timeout_s: int = Field(default=60, ge=5, le=300)
    llm_json_schema: bool = Field(default=True, description='声明式建模使用JSON Schema；不支持的兼容端点可关闭')
    llm_max_calls: int = Field(
        default=3,
        ge=0,
        le=50,
        description="一次识别最多调用模型的页数；0 表示关闭图片兜底",
    )
    max_slide_pages: int = Field(default=100, ge=1)

    # --- 题目实验室（与课件转换分离；默认不产生任何模型调用）---
    lab_max_files: int = Field(default=6, ge=1, le=12)
    lab_understanding_pipeline: str = 'staged'
    lab_max_pages: int = Field(default=20, ge=1, le=60)
    lab_max_text_chars: int = Field(default=30000, ge=100, le=200000)
    lab_ai_enabled: bool = Field(
        default=False,
        description="题目实验室是否允许调用已配置的 LLM；默认 false，识别与讲解全部本地完成",
    )

    # --- PPT AI 领域模块（与题目实验室的 LAB_AI_ENABLED 相互独立）---
    ppt_ai_enabled: bool = Field(
        default=True,
        description="是否启用 PPT AI 交互规划/补充实验/验收；关闭后原有阅读、编辑、分享仍可用",
    )
    ppt_ai_hybrid_matching_enabled: bool = Field(
        default=True,
        description="是否启用规则+语义+模型裁决的混合匹配与十个模板包；关闭后只走旧规划器",
    )
    ppt_ai_generated_views_enabled: bool = Field(
        default=False,
        description="是否允许专用视图程序试验；默认关闭，必须完成隔离验收后才可开启",
    )
    ppt_ai_learning_enabled: bool = Field(
        default=False,
        description="是否启用原页学习呈现/提问/练习；关闭后原阅读与高级管理仍可用",
    )
    ppt_ai_learning_browser_timeout_s: float = Field(
        default=60.0,
        gt=0,
        le=120,
        description="学习入口受信浏览器验证超时（秒）；超时记录未覆盖",
    )
    ppt_ai_task_max_calls: int = Field(
        default=3,
        ge=0,
        le=20,
        description="用户主动创建的单次 PPT AI 任务最多模型调用次数（含结构修正）",
    )
    ppt_ai_task_timeout_s: float = Field(default=300.0, gt=0, le=1800)
    ppt_ai_view_timeout_ms: int = Field(
        default=200,
        ge=20,
        le=5000,
        description="专用视图单次渲染超时（毫秒）；超时由主线程终止 Worker 并降级",
    )
    ppt_ai_max_artifact_bytes: int = Field(
        default=8 * 1024 * 1024,
        ge=1024,
        description="新增视图资源总上限（8MB）；超过时显式失败，不漏页",
    )
    ppt_ai_max_llm_tokens: int = Field(
        default=4096,
        ge=512,
        le=32768,
        description="PPT AI 单次模型输出的 max_tokens；规划从 4096 起实测",
    )
    ppt_ai_inline_dispatch: bool = Field(
        default=True,
        description="POST 后立即唤醒本进程执行器；任务本身仍持久化，可由独立 worker 恢复",
    )

    # --- 分页（§2.2.7 契约级行为 5）---
    default_limit: int = Field(default=20, ge=1)
    max_limit: int = Field(default=50, ge=1)

    # --- 渲染链路（spec §3）---
    render_engine: str = Field(
        default="auto",
        description="auto/powerpoint_com/libreoffice/svg_fallback；缺失依赖时自动降级",
    )
    render_width: int = Field(default=1920, ge=320)
    render_height: int = Field(default=1080, ge=180)
    render_timeout_s: float = Field(default=240.0, gt=0)
    render_extract_images: bool = True
    # --- 擦除校验（spec §3.3）---
    erase_ring_px: int = Field(default=2, ge=1)
    erase_variance_threshold: float = Field(default=6.0, gt=0)

    # --- 识别层 LLM（P1-08）---
    # 只做配置占位：默认 none 表示未接入真实模型；密钥一律由环境变量注入。
    isepc_llm_provider: str = Field(
        default="none",
        description="LLM provider 名；none 表示未配置（识别层静默降级）",
    )
    isepc_llm_api_key: str = Field(
        default="",
        description="LLM 访问密钥；只能由部署环境注入，代码与仓库内禁止硬编码",
    )
    isepc_llm_model: str = Field(default="", description="LLM 模型名；为空表示未配置")
    isepc_llm_timeout_s: float = Field(default=20.0, gt=0)
    isepc_llm_max_calls: int = Field(default=8, ge=1)

    # --- 账号会话（C-DB@1；只追加，既有字段顺序与默认值不动）---
    auth_cookie_name: str = Field(
        default="xs_auth",
        min_length=1,
        description="账号会话 Cookie 名（与访客 session_cookie_name 区分）",
    )
    auth_session_absolute_hours: int = Field(default=24, ge=1)
    auth_session_idle_hours: int = Field(default=12, ge=1)
    auth_remember_absolute_hours: int = Field(default=720, ge=1)
    auth_remember_idle_hours: int = Field(default=168, ge=1)
    auth_development_active_on_register: bool = Field(
        default=True,
        description="注册开关；置 False 时注册返回明确错误（不静默降级）",
    )

    # --- 注册邮箱验证码（Brevo 事务邮件；密钥只从环境注入）---
    brevo_api_key: str = Field(
        default="",
        description="Brevo API Key；只能由部署环境注入，代码与仓库内禁止硬编码",
    )
    brevo_sender_email: str = Field(
        default="",
        description="Brevo 已验证的发件人邮箱；为空时发送验证码返回明确错误",
    )
    brevo_sender_name: str = Field(default="万象 WANXIANG")
    brevo_api_url: str = Field(default="https://api.brevo.com/v3/smtp/email")
    brevo_timeout_s: float = Field(default=10.0, gt=0, le=60)
    register_code_ttl_seconds: int = Field(
        default=300,
        ge=60,
        le=1800,
        description="注册验证码有效期（秒），默认 5 分钟",
    )
    register_code_resend_seconds: int = Field(
        default=60,
        ge=10,
        le=600,
        description="同一邮箱两次发送验证码的最小间隔（秒）",
    )
    register_code_max_attempts: int = Field(
        default=5,
        ge=1,
        le=10,
        description="单个验证码允许的错误尝试次数，超过后立即作废",
    )

    # --- 账号头像（只允许 JPG / PNG / WebP，服务端统一重编码）---
    avatar_max_bytes: int = Field(
        default=2 * 1024 * 1024,
        ge=1,
        description="头像上传上限（默认 2MB）",
    )
    avatar_size: int = Field(
        default=512,
        ge=64,
        le=2048,
        description="服务端重编码后的正方形边长（像素）",
    )

    # --- MySQL 连接池（C-DB@1；仅当 DATABASE_URL 指向 MySQL 时生效）---
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=5, ge=0, le=50)
    db_pool_timeout_seconds: float = Field(default=10.0, gt=0)
    db_pool_recycle_seconds: int = Field(default=1800, ge=60)
    migration_database_url: str = Field(
        default="",
        description="Alembic 专用连接串；空串表示未配置（回退到 database_url）",
    )

    @field_validator('llm_model', mode='before')
    @classmethod
    def _normalize_deepseek_model(cls, value: Any) -> Any:
        if isinstance(value, str) and value.strip().lower() == 'deepseek-v4.1-flash-1017':
            return 'deepseek-v4.1-flash-1017'
        return value

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        """允许 ``ALLOWED_ORIGINS=a,b`` 这样用逗号分隔的写法。"""

        if isinstance(value, str):
            items = [item.strip() for item in value.split(",")]
            return [item for item in items if item]
        return value

    @model_validator(mode="after")
    def _ensure_session_secret(self) -> "Settings":
        """缺省时不落盘任何固定密钥，改用一次性随机值并提示配置。"""

        if not self.session_secret:
            # 用 object.__setattr__ 绕过 validate_assignment 递归，仅赋值一次。
            object.__setattr__(self, "session_secret", secrets.token_hex(32))
            logger.warning(
                "未设置 SESSION_SECRET，已生成一次性随机密钥；"
                "进程重启后旧会话 Cookie 将失效。部署时请在 .env 中配置 SESSION_SECRET。"
            )
        return self

    def normalize_limit(self, limit: int | None) -> int:
        """把分页参数收敛到契约范围：默认 20，最大 50，超限不报错（§2.2.7 行为 5）。"""

        if limit is None:
            return self.default_limit
        return max(1, min(int(limit), self.max_limit))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """返回进程内单例配置（``lru_cache`` 保证随机密钥只生成一次）。"""

    return Settings()


def configure_logging(settings: Settings | None = None) -> None:
    """统一日志格式；日志只记录业务标识，不打印 Cookie/CSRF/密钥（R12-AC5）。"""

    current = settings or get_settings()
    level = getattr(logging, str(current.log_level).upper(), logging.INFO)
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )
    else:
        root.setLevel(level)
