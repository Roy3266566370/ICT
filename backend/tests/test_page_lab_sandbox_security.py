"""P0 安全专项测试：验证 page_lab Node 试运行子进程的环境变量隔离与最小权限边界。"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from app.ppt_ai.page_lab import _node_permission_flags, _sanitized_node_env, dry_run


def test_sanitized_node_env_strips_all_secrets(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-secret-llm-canary")
    monkeypatch.setenv("LIVING_FIGURE_VISION_API_KEY", "sk-secret-vision-canary")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-openai-canary")
    monkeypatch.setenv("XIANGSHENG_DB_URL", "postgresql://user:pass@host/db")
    monkeypatch.setenv("NODE_OPTIONS", "--require=/tmp/evil.js")

    clean = _sanitized_node_env()
    for secret_key in ("LLM_API_KEY", "LIVING_FIGURE_VISION_API_KEY", "OPENAI_API_KEY", "XIANGSHENG_DB_URL"):
        assert secret_key not in clean
    assert clean.get("NODE_OPTIONS") == ""


def test_node_subprocess_cannot_read_parent_secrets_or_filesystem(monkeypatch, tmp_path):
    node = shutil.which("node")
    if node is None:
        pytest.skip("本机未安装 node")

    canary = "sk-canary-never-leak-998877"
    monkeypatch.setenv("LLM_API_KEY", canary)
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("TOP_SECRET", encoding="utf-8")

    perm_flags = _node_permission_flags(node)
    probe_script = (
        "const fs = require('node:fs');"
        "const cp = require('node:child_process');"
        "const envDump = JSON.stringify(process.env);"
        "let fsBlocked = false;"
        f"try {{ fs.readFileSync({json.dumps(str(secret_file))}, 'utf8'); }} catch (e) {{ fsBlocked = e && e.code === 'ERR_ACCESS_DENIED'; }}"
        "let cpBlocked = false;"
        "try { cp.execSync('echo hi'); } catch (e) { cpBlocked = e && e.code === 'ERR_ACCESS_DENIED'; }"
        "process.stdout.write(JSON.stringify({ envDump, fsBlocked, cpBlocked }));"
    )
    completed = subprocess.run(
        [node, *perm_flags, "-e", probe_script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=5,
        cwd=str(tmp_path),
        env=_sanitized_node_env(),
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    data = json.loads(completed.stdout)
    assert canary not in data["envDump"]
    assert "LLM_API_KEY" not in data["envDump"]
    if perm_flags:
        assert data["fsBlocked"] is True
        assert data["cpBlocked"] is True


def test_dry_run_still_passes_for_valid_program_under_hardened_sandbox():
    program = (
        "function render(input){var x=100+input.a*50+input.t*80;"
        "return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],"
        "nodes:[{id:'v',type:'arrow',x1:100,y1:210,x2:x,y2:210,label:'v',style:{stroke:'#2563eb',strokeWidth:3}}]};}"
    )
    dry_run(
        program,
        [{"id": "a", "label": "a", "min": 0, "max": 2, "step": 0.1, "default": 1, "unit": ""}],
        {"duration_s": 5, "stops": [{"t": 0, "label": "开始"}, {"t": 1, "label": "结束"}]},
    )
