"""PPT AI 验收辅助脚本：API 检查 + 可选浏览器用例。

用法（从仓库根）：

    py -3.11 backend/scripts/verify_ppt_ai.py --material-id mat_xxx
    py -3.11 backend/scripts/verify_ppt_ai.py --material-id mat_xxx --browser

浏览器模式需要前端已启动、已准备 E2E_MATERIAL_ID，并且已执行
``npx playwright install chromium``。脚本不读取、不打印任何模型密钥。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310 - 本地验收地址
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="PPT AI 验收辅助")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--material-id", default="")
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    capabilities = get_json(base + "/api/v1/ppt-ai/capabilities")["data"]
    print(
        "PPT AI:", "enabled" if capabilities["enabled"] else "disabled",
        "| generated views:", "enabled" if capabilities["generated_views_enabled"] else "disabled",
        "| operators:", len(capabilities["registry"]),
    )
    print("model available:", capabilities["model"].get("available"))
    if args.material_id:
        # 需要会话 Cookie；此脚本只检查能力表与公开信息，不绕过鉴权。
        print("材料级总览需要浏览器会话；请在浏览器或 Playwright 用例中打开 AI 页。")
    if args.browser:
        npm = shutil.which("npm") or shutil.which("npm.cmd")
        npx = "npx.cmd" if sys.platform == "win32" else "npx"
        if npm is None:
            print("未找到 npm，无法运行浏览器用例", file=sys.stderr)
            return 2
        env = {"E2E_MATERIAL_ID": args.material_id, "E2E_BASE_URL": "http://127.0.0.1:5173"}
        result = subprocess.run(  # noqa: S603 - 本地固定脚本
            [npx, "playwright", "test", "-c", "e2e/playwright.config.ts"],
            cwd=FRONTEND,
            env={**__import__("os").environ, **{k: v for k, v in env.items() if v}},
        )
        return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
