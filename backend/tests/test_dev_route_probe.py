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


def run_probe(url, command=PROBE, **extra_env):
    env = os.environ.copy()
    env.update(ICT_PROBE_SCRIPT=str(SCRIPT), ICT_PROBE_URL=url, **extra_env)
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", command],
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


# Load functions by AST only: never execute start-dev.ps1's real 8000/5173 logic.
PROCESS_PRELUDE = PROBE[:PROBE.index('$assignment =')] + r'''
$taskRoot = Split-Path $env:ICT_PROBE_SCRIPT
foreach ($name in @('Test-Listening', 'Test-Url', 'Start-Detached', 'Assert-PortOwner',
    'Assert-ManagedProcess', 'Get-ManagedRecord', 'New-ProcessRecord', 'Stop-OwnedTree', 'Wait-OwnedService')) {
    $function = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if ($null -eq $function) { throw "Missing function $name" }
    . ([scriptblock]::Create($function.Extent.Text))
}
'''


@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership APIs')
def test_unknown_port_has_no_permission_to_restart(endpoint, tmp_path):
    from urllib.request import ProxyHandler, build_opener

    url, response = endpoint
    response['body'] = b'{"still_alive":true}'
    command = PROCESS_PRELUDE + r'''
$port = ([Uri]$env:ICT_PROBE_URL).Port
Get-ManagedRecord $port $env:ICT_STATE 'not-a-repo-launch'
throw 'SHOULD_NOT_ACCEPT_UNKNOWN_OWNER'
'''
    result = run_probe(url, command, ICT_STATE=str(tmp_path / 'absent.json'))
    assert result.returncode != 0
    assert 'Unknown owner' in result.stdout + result.stderr
    assert 'SHOULD_NOT_ACCEPT_UNKNOWN_OWNER' not in result.stdout
    with build_opener(ProxyHandler({})).open(url) as reply:
        assert json.load(reply)['still_alive']


@pytest.mark.skipif(os.name != 'nt', reason='Windows listener ownership APIs')
def test_readiness_rejects_another_process_http_200(endpoint):
    url, response = endpoint
    response['body'] = b'{}'
    command = PROCESS_PRELUDE + r'''
$p = Get-Process -Id $PID
Wait-OwnedService $p ([Uri]$env:ICT_PROBE_URL).Port $env:ICT_PROBE_URL $null
Write-Output 'SHOULD_NOT_BECOME_READY'
'''
    result = run_probe(url, command)
    assert result.returncode != 0
    assert 'does not belong to recorded PID' in result.stdout + result.stderr
    assert 'SHOULD_NOT_BECOME_READY' not in result.stdout


def run_owned_powershell(command, env):
    """Enclose test-created PowerShell and all descendants in our own Windows job."""
    from scripts.dev_server import _WindowsJob

    job = _WindowsJob()
    process = None
    try:
        process = subprocess.Popen(
            [POWERSHELL, '-NoProfile', '-NonInteractive', '-Command',
             'if ([Console]::ReadLine() -ne "START") { exit 1 }; ' + command],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8', errors='replace', env=env,
        )
        job.assign(process)
        stdout, stderr = process.communicate('START\n', timeout=45)
        return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
    finally:
        job.close()
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)


@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership APIs')
@pytest.mark.parametrize('tamper', ['', 'started_ticks', 'repo', 'command_line', 'launch_id', 'pid'])
def test_detached_process_record_and_guarded_tree_stop(tmp_path, tamper):
    import socket
    import sys
    from uuid import uuid4

    folder = tmp_path / '带空格 app'
    folder.mkdir()
    # A separate real uvicorn app, never app.main or any business/AI import.
    (folder / 'simple.py').write_text('''async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        raise RuntimeError("lifespan not supported")
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})
''', encoding='utf-8')
    with socket.socket() as reserve:
        reserve.bind(('127.0.0.1', 0))
        port = reserve.getsockname()[1]
    env = os.environ.copy()
    env.update(ICT_PROBE_SCRIPT=str(SCRIPT), ICT_PYTHON=sys.executable,
               ICT_TARGET=str(SCRIPT.parent / 'backend/scripts/dev_run.py'),
               ICT_APP_DIR=str(folder), ICT_PORT=str(port), ICT_TOKEN=uuid4().hex,
               ICT_OUT=str(tmp_path / 'server out.log'), ICT_ERR=str(tmp_path / 'server err.log'),
               ICT_STATE=str(tmp_path / 'process.json'), ICT_TAMPER=tamper,
               PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    command = PROCESS_PRELUDE + r'''
$p = $null
try {
    $p = Start-Detached $env:ICT_PYTHON @('-u', $env:ICT_TARGET, '--port', $env:ICT_PORT,
        '--launch-id', $env:ICT_TOKEN, '--app', 'simple:app', '--app-dir', $env:ICT_APP_DIR) `
        $taskRoot $env:ICT_OUT $env:ICT_ERR
    if ($p -isnot [System.Diagnostics.Process]) { throw 'Start-Detached must return PassThru process' }
    $record = New-ProcessRecord $p $env:ICT_TOKEN $env:ICT_TARGET
    Wait-OwnedService $p ([int]$env:ICT_PORT) "http://127.0.0.1:$($env:ICT_PORT)" $null
    $record | ConvertTo-Json | Set-Content -LiteralPath $env:ICT_STATE -Encoding UTF8
    $verified = Get-ManagedRecord ([int]$env:ICT_PORT) $env:ICT_STATE $env:ICT_TARGET
    if ($verified.pid -ne $p.Id) { throw 'wrong recorded process' }
    if ($env:ICT_TAMPER) {
        if ($env:ICT_TAMPER -eq 'pid') { $record.pid = $PID }
        else { $record.($env:ICT_TAMPER) = 'tampered' }
        $rejected = $false
        try { $null = Assert-ManagedProcess $record $env:ICT_TARGET }
        catch { $rejected = $true }
        if (-not $rejected) { throw 'Tampered record accepted' }
    } else {
        & $env:ICT_PYTHON $env:ICT_TARGET --check-url "http://127.0.0.1:$($env:ICT_PORT)" `
            --launch-id $env:ICT_TOKEN --expected-pid $p.Id --app simple:app --app-dir $env:ICT_APP_DIR
        if ($LASTEXITCODE -ne 0) { throw 'identity check failed' }
        # This is the same verify-then-stop path used by -Restart.
        $owned = Assert-ManagedProcess $verified $env:ICT_TARGET
        Stop-OwnedTree $owned
    }
    Write-Output 'PROCESS_GUARD_OK'
} finally {
    if ($null -ne $p) { Stop-OwnedTree $p }
}
'''
    result = run_owned_powershell(command, env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'PROCESS_GUARD_OK' in result.stdout
    with socket.socket() as probe:
        probe.settimeout(.25)
        assert probe.connect_ex(('127.0.0.1', port)) != 0
