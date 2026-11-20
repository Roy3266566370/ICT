"""Real uvicorn subprocesses, no business app, database or paid AI calls."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import py_compile
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import ProxyHandler, build_opener

import pytest

from scripts import dev_server
from scripts.dev_run import (BACKEND_DIR, IdentityError, assert_identity,
                             read_identity, reserve_port, source_fingerprint)
from scripts.dev_server import fresh_server, server_session

APP_SOURCE = '''import json, os, subprocess, sys, time
VERSION = "old"
if os.environ.get("CHILD_PID_FILE"):
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    with open(os.environ["CHILD_PID_FILE"], "w") as f:
        f.write(str(child.pid))
if os.environ.get("FAIL_IMPORT"):
    raise RuntimeError("intentional import failure")
if os.environ.get("EXIT_ROOT"):
    os._exit(23)
if os.environ.get("HANG_IMPORT"):
    time.sleep(120)
async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup":
                if os.environ.get("FAIL_STARTUP"):
                    await send({"type": "lifespan.startup.failed", "message": "intentional startup failure"})
                    return
                await send({"type": "lifespan.startup.complete"})
            else:
                await send({"type": "lifespan.shutdown.complete"})
                return
    else:
        body = json.dumps({"pid": os.getpid(), "version": VERSION}).encode()
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})
'''


@pytest.fixture
def app_dir(tmp_path):
    # Non-ASCII AND spaces exercise Windows argument handling.
    folder = tmp_path / "测试 app"
    folder.mkdir()
    (folder / "probe_app.py").write_text(APP_SOURCE, encoding="utf-8")
    return folder


def get_json(url):
    with build_opener(ProxyHandler({})).open(url, timeout=2) as response:
        return json.load(response)


def assert_exited(pid):
    if os.name == "nt":
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        api.OpenProcess.restype = wintypes.HANDLE
        api.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        api.WaitForSingleObject.restype = wintypes.DWORD
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = api.OpenProcess(0x100000, False, pid)  # SYNCHRONIZE; no termination rights
        if handle:
            try:
                assert api.WaitForSingleObject(handle, 5000) == 0, f"orphan PID {pid}"
            finally:
                api.CloseHandle(handle)
        else:
            assert ctypes.get_last_error() == 87  # ERROR_INVALID_PARAMETER: already gone
    else:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            # Linux may retain an adopted zombie until init reaps it.
            stat = Path(f"/proc/{pid}/stat")
            if stat.exists() and stat.read_text().split()[2] == "Z":
                return
            time.sleep(0.05)
        pytest.fail(f"orphan PID {pid}")


def assert_port_closed(url):
    port = int(url.rsplit(":", 1)[1])
    with socket.socket() as sock:
        sock.settimeout(0.25)
        assert sock.connect_ex(("127.0.0.1", port)) != 0


def test_fresh_identity_and_cleanup(app_dir):
    with fresh_server(app="probe_app:app", app_dir=app_dir) as server:
        identity = server.check()
        assert identity["pid"] != os.getpid()
        assert identity["root_pid"] == identity["pid"]  # Not the py.exe launcher.
        assert get_json(server.base_url)["pid"] == identity["pid"]
        for kwargs in ({"launch_id": "wrong"}, {"pid": os.getpid()}, {"app": "app.main:app"}):
            with pytest.raises(IdentityError, match=next(iter(kwargs))):
                assert_identity(server.base_url, app_dir=app_dir, **{"app": "probe_app:app", **kwargs})
        with pytest.raises(IdentityError, match="app_dir"):
            assert_identity(server.base_url, app="probe_app:app")
    assert_exited(identity["pid"])
    assert_port_closed(server.base_url)


def test_frozen_fingerprint_and_same_size_same_mtime_edit(app_dir):
    source = app_dir / "probe_app.py"
    # Leave a valid timestamp pyc behind: a fresh server must not serve it after
    # a same-size/same-mtime source change.
    py_compile.compile(str(source), doraise=True)
    before = source.stat()
    with fresh_server(app="probe_app:app", app_dir=app_dir) as old:
        original = old.identity["source_fingerprint"]
        source.write_text(APP_SOURCE.replace('VERSION = "old"', 'VERSION = "new"'), encoding="utf-8")
        os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns))
        assert read_identity(old.base_url)["source_fingerprint"] == original
        assert get_json(old.base_url)["version"] == "old"
        with pytest.raises(IdentityError, match="Restart required"):
            old.check()
    with fresh_server(app="probe_app:app", app_dir=app_dir) as new:
        assert new.check()["source_fingerprint"] != original
        assert new.identity["launch_id"] != old.identity["launch_id"]
        assert get_json(new.base_url)["version"] == "new"


def test_fingerprint_includes_added_deleted_and_renamed_sources(app_dir):
    original = source_fingerprint(app_dir)
    added = app_dir / "untracked.py"
    added.write_text("value = 1\n")
    after_add = source_fingerprint(app_dir)
    assert after_add != original
    renamed = app_dir / "renamed.py"
    added.rename(renamed)
    assert source_fingerprint(app_dir) != after_add
    renamed.unlink()
    assert source_fingerprint(app_dir) == original


def test_occupied_port_never_spawns_or_reuses_200(app_dir, monkeypatch):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"openapi":"3.1.0"}')

        def log_message(self, *_):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{httpd.server_port}"
        with pytest.raises(IdentityError, match="Unrecognized"):
            read_identity(url)
        def forbidden(*args, **kwargs):
            pytest.fail("Popen must not be called for an occupied port")
        monkeypatch.setattr(dev_server.subprocess, "Popen", forbidden)
        started = time.monotonic()
        with pytest.raises(RuntimeError, match="unavailable"):
            with fresh_server(port=httpd.server_port, app="probe_app:app", app_dir=app_dir):
                pytest.fail("must not yield the old HTTP 200 service")
        assert time.monotonic() - started < 2
        assert get_json(url)["openapi"] == "3.1.0"  # Still alive, not killed.
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(5)


def test_port_stolen_between_preflight_and_popen_is_not_ready(app_dir, monkeypatch):
    from scripts.dev_run import PROTOCOL, REPO_ROOT, canonical

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(dict(protocol=PROTOCOL, repo=canonical(REPO_ROOT),
                app='probe_app:app', app_dir=canonical(app_dir), pid=os.getpid(),
                launch_id='a-different-launch', started_at=time.time(),
                source_fingerprint=source_fingerprint(app_dir))).encode())

        def log_message(self, *_):
            pass

    real_popen = subprocess.Popen
    httpd = thread = None
    def steal_then_spawn(command, **kwargs):
        nonlocal httpd, thread
        port = int(command[command.index('--port') + 1])
        httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return real_popen(command, **kwargs)
    monkeypatch.setattr(dev_server.subprocess, 'Popen', steal_then_spawn)
    try:
        with pytest.raises(RuntimeError, match='mismatch|exited'):
            with fresh_server(app='probe_app:app', app_dir=app_dir):
                pytest.fail('HTTP 200 from a different launch must not be readiness')
        assert get_json(f'http://127.0.0.1:{httpd.server_port}')['launch_id'] == 'a-different-launch'
    finally:
        if httpd:
            httpd.shutdown()
            httpd.server_close()
            thread.join(5)


def test_cli_preflight_precedes_app_import(app_dir):
    with reserve_port("127.0.0.1", 0) as occupied:
        port = occupied.getsockname()[1]
        occupied.listen()
        result = subprocess.run([sys.executable, str(BACKEND_DIR / "scripts/dev_run.py"),
                                 "--port", str(port), "--app", "nonexistent:app"],
                                capture_output=True, text=True, encoding='utf-8', timeout=10,
                                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
        assert result.returncode != 0
        assert "unavailable" in result.stderr
        assert "No module named" not in result.stderr


@pytest.mark.parametrize("mode", ["body_exception", "FAIL_IMPORT", "FAIL_STARTUP", "EXIT_ROOT", "HANG_IMPORT"])
def test_descendants_reaped_on_all_exit_paths(app_dir, tmp_path, mode):
    child_file = tmp_path / "child.pid"
    env = {"CHILD_PID_FILE": str(child_file)}
    if mode != "body_exception":
        env[mode] = "1"
    started = time.monotonic()
    with pytest.raises(RuntimeError):
        with fresh_server(app="probe_app:app", app_dir=app_dir, env=env,
                          timeout=3 if mode == "HANG_IMPORT" else 15) as server:
            assert child_file.exists()
            raise RuntimeError("intentional body failure")
    assert time.monotonic() - started < 12
    assert child_file.exists(), "test must create a real descendant"
    assert_exited(int(child_file.read_text()))
    if mode == "body_exception":
        assert_exited(server.identity["pid"])
        assert_port_closed(server.base_url)


def test_owned_descendant_releases_database_before_context_returns(app_dir, tmp_path):
    resources = tmp_path / 'resources'
    resources.mkdir()
    ready = resources / 'ready'
    child_code = ("import os,sqlite3,time; from pathlib import Path; "
                  "c=sqlite3.connect(os.environ['CHILD_LOCK_FILE']); "
                  "c.execute('create table t (x)'); c.commit(); "
                  "Path(os.environ['LOCK_READY']).write_text('ready'); time.sleep(120)")
    (app_dir / 'probe_app.py').write_text(APP_SOURCE.replace('import time; time.sleep(120)', child_code), encoding='utf-8')
    with fresh_server(app='probe_app:app', app_dir=app_dir, env={
        'CHILD_PID_FILE': str(tmp_path / 'child.pid'), 'CHILD_LOCK_FILE': str(resources / 'child.db'),
        'LOCK_READY': str(ready),
    }):
        deadline = time.monotonic() + 5
        while not ready.exists():
            assert time.monotonic() < deadline, 'child did not open its database'
            time.sleep(0.01)
    shutil.rmtree(resources)
    assert not resources.exists()


def test_bad_import_fails_fast(app_dir):
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="exited"):
        with fresh_server(app="does_not_exist:app", app_dir=app_dir, timeout=15):
            pytest.fail("bad import must not yield")
    assert time.monotonic() - started < 10


def test_existing_mode_requires_explicit_pin():
    # Must reject before contacting any user's port.
    with pytest.raises(ValueError, match="requires --launch-id"):
        with server_session(port=1, existing=True):
            pytest.fail("missing identity pin")
    with pytest.raises(ValueError, match="only valid with --existing"):
        with server_session(port=1, launch_id="wrong"):
            pytest.fail("cannot pin a fresh launch")


@pytest.mark.parametrize('relative,args', [
    ('tools/verify_natural_labs.py', ['all']),
    ('tmp/408test/run_upload.py', []),
])
def test_acceptance_runners_fail_before_business_without_pin(relative, args):
    script = BACKEND_DIR.parent / relative
    if not script.exists():
        pytest.skip('local acceptance script is not present in this checkout')
    result = subprocess.run([sys.executable, str(script), *args, '--existing', '--check-only'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
    assert result.returncode != 0
    assert '--existing requires --launch-id' in result.stderr


@pytest.mark.skipif(os.name != 'nt', reason='Windows Job Object integration')
def test_job_assignment_failure_never_releases_import_gate(app_dir, tmp_path, monkeypatch):
    child_file = tmp_path / 'must-not-exist.pid'
    def reject(self, process):
        raise OSError('intentional job assignment failure')
    monkeypatch.setattr(dev_server._WindowsJob, 'assign', reject)
    with pytest.raises(OSError, match='assignment failure'):
        with fresh_server(app='probe_app:app', app_dir=app_dir,
                          env={'CHILD_PID_FILE': str(child_file)}):
            pytest.fail('must not yield without containment')
    assert not child_file.exists()


@pytest.mark.skipif(os.name != 'nt', reason='Windows reload worker tree integration')
def test_reload_reports_actual_worker_and_new_source(app_dir, tmp_path):
    from uuid import uuid4
    from urllib.error import URLError

    with reserve_port('127.0.0.1', 0) as reserve:
        port = reserve.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    token = uuid4().hex
    job = dev_server._WindowsJob()
    process = None
    workers = []
    def wait_identity(previous_pid=None):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert process.poll() is None, 'reload supervisor exited'
            try:
                identity = assert_identity(url, launch_id=token, app='probe_app:app', app_dir=app_dir, timeout=.25)
                if identity['pid'] != previous_pid:
                    assert identity['root_pid'] == process.pid
                    assert identity['pid'] != process.pid
                    return identity
            except (URLError, IdentityError, TimeoutError, ConnectionError):
                pass  # Expected only while the old worker is being replaced.
            time.sleep(.1)
        pytest.fail('reload worker did not become current')
    child_file = tmp_path / 'reload-child.pid'
    env = os.environ.copy()
    env.update(CHILD_PID_FILE=str(child_file), PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    with (tmp_path / 'reload.log').open('wb') as log:
        try:
            process = subprocess.Popen(
                [sys.executable, str(BACKEND_DIR / 'scripts/dev_run.py'), '--port', str(port),
                 '--app', 'probe_app:app', '--app-dir', str(app_dir), '--launch-id', token,
                 '--parent-gate', '--reload', '--log-level', 'warning'],
                stdin=subprocess.PIPE, stdout=log, stderr=log, env=env,
            )
            job.assign(process)
            process.stdin.write(b'START\n')
            process.stdin.close()
            first = wait_identity()
            workers.append(first['pid'])
            old_child = int(child_file.read_text())
            source = app_dir / 'probe_app.py'
            source.write_text(APP_SOURCE.replace('VERSION = "old"', 'VERSION = "new"'), encoding='utf-8')
            # StatReload uses mtime; force a distinct timestamp without sleeping.
            os.utime(source, (time.time() + 2, time.time() + 2))
            second = wait_identity(first['pid'])
            workers.append(second['pid'])
            workers.append(int(child_file.read_text()))
            assert_exited(old_child)  # Replaced worker's descendants must not outlive the reload.
            assert get_json(url)['version'] == 'new'
            assert first['source_fingerprint'] != second['source_fingerprint']
        finally:
            if process is not None and process.stdin and not process.stdin.closed:
                process.stdin.close()
            job.close()
            if process is not None:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=10)
    for pid in workers:
        assert_exited(pid)
    assert_port_closed(url)
