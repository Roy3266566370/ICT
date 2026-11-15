"""Exercise the real PowerShell route probe without starting/stopping dev services."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")
pytestmark = pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
SCRIPT = Path(__file__).resolve().parents[2] / "start-dev.ps1"
REQUIRED = ("/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/me")

PROBE = r"""
$ErrorActionPreference = 'Stop'
# Windows PowerShell 默认按系统代码页输出，这里统一为 UTF-8，避免中文断言在 GBK 控制台下乱码。
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$backendLog = Join-Path ([System.IO.Path]::GetTempPath()) 'ict-route-probe-no-log'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:ICT_PROBE_SCRIPT, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'start-dev.ps1 syntax error' }
$assignment = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left.Extent.Text -eq '$RequiredRoutes'
}, $true)
. ([scriptblock]::Create($assignment.Extent.Text))
foreach ($name in @('Get-OpenApiPaths', 'Assert-RequiredRoutes', 'Show-LogTail')) {
    $function = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    . ([scriptblock]::Create($function.Extent.Text))
}
Assert-RequiredRoutes $env:ICT_PROBE_URL
Write-Output 'ASSERT_RETURNED_SUCCESS'
"""


@pytest.fixture
def endpoint():
    response = {"body": b"", "status": 200}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(response["status"])
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(response["body"])

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", response
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def run_probe(url):
    env = os.environ.copy()
    env.update(ICT_PROBE_SCRIPT=str(SCRIPT), ICT_PROBE_URL=url)
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", PROBE],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=20,
    )


@pytest.mark.parametrize("document", [
    "<html>not an OpenAPI document</html>",
    json.dumps({"openapi": "3.1.0"}),
    json.dumps({"paths": None}),
    json.dumps({"paths": []}),
    json.dumps({"paths": "not-an-object"}),
    json.dumps([{"openapi": "3.1.0", "paths": {path: {} for path in REQUIRED}}]),
    json.dumps({"Paths": {path: {} for path in REQUIRED}}),
], ids=["html-200", "missing-paths", "null-paths", "array-paths", "string-paths", "array-root", "wrong-case-paths"])
def test_unverifiable_openapi_fails(endpoint, document):
    url, response = endpoint
    response["body"] = document.encode()
    result = run_probe(url)
    output = result.stdout + result.stderr
    assert result.returncode != 0, output
    assert "无法验证账号路由" in output
    assert "ASSERT_RETURNED_SUCCESS" not in output


@pytest.mark.parametrize("paths", [
    {},
    {path: {} for path in REQUIRED[:-1]},
    {**{path: {} for path in REQUIRED[:-1]}, "/API/V1/ME": {}},
], ids=["empty-paths", "missing-me", "wrong-case-me"])
def test_valid_document_with_missing_routes_fails(endpoint, paths):
    url, response = endpoint
    response["body"] = json.dumps({"openapi": "3.1.0", "paths": paths}).encode()
    result = run_probe(url)
    output = result.stdout + result.stderr
    assert result.returncode != 0, output
    assert "缺少账号路由" in output
    assert "/api/v1/me" in output


def test_http_error_fails(endpoint):
    url, response = endpoint
    response["status"] = 503
    result = run_probe(url)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "无法验证账号路由" in result.stdout + result.stderr


def test_complete_document_passes(endpoint):
    url, response = endpoint
    response["body"] = ("\n \t" + json.dumps({"openapi": "3.1.0", "paths": {path: {} for path in REQUIRED}})).encode()
    result = run_probe(url)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Account routes OK" in result.stdout
    assert "ASSERT_RETURNED_SUCCESS" in result.stdout
