"""Small, owned dev-server context for tests and acceptance runners (Python 3.11).

A fresh context never attaches to an existing port. On Windows a kill-on-close
Job Object owns the child AND its descendants, even if the root exits first.
"""
from __future__ import annotations

from contextlib import contextmanager
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from uuid import uuid4

from scripts.dev_run import BACKEND_DIR, REPO_ROOT, assert_identity, reserve_port


class _WindowsJob:
    def __init__(self):
        class BasicLimits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                        ("flags", wintypes.DWORD), ("min_ws", ctypes.c_size_t),
                        ("max_ws", ctypes.c_size_t), ("active", wintypes.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                        ("scheduling", wintypes.DWORD)]

        class IOCounts(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in
                        ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", BasicLimits), ("io", IOCounts),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        signatures = {
            "CreateJobObjectW": ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            "SetInformationJobObject": ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            "AssignProcessToJobObject": ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
            "TerminateJobObject": ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            "OpenProcess": ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            "WaitForSingleObject": ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            "QueryInformationJobObject": ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                           wintypes.DWORD, ctypes.c_void_p], wintypes.BOOL),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(self.api, name)
            fn.argtypes, fn.restype = args, result
        self.handle = self.api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, process):
        if not self.api.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def _member_handles(self):
        capacity = 64
        while True:
            class ProcessIds(ctypes.Structure):
                _fields_ = [('assigned', wintypes.DWORD), ('count', wintypes.DWORD),
                            ('ids', ctypes.c_size_t * capacity)]
            members = ProcessIds()
            if self.api.QueryInformationJobObject(self.handle, 3, ctypes.byref(members),
                                                  ctypes.sizeof(members), None):
                break
            error = ctypes.get_last_error()
            if error not in (122, 234):
                raise ctypes.WinError(error)
            capacity *= 2
        handles = []
        try:
            for pid in members.ids[:members.count]:
                handle = self.api.OpenProcess(0x100000, False, pid)
                if handle:
                    handles.append(handle)
                elif ctypes.get_last_error() != 87:
                    raise ctypes.WinError(ctypes.get_last_error())
            return handles
        except BaseException:
            for handle in handles:
                self.api.CloseHandle(handle)
            raise

    def terminate_and_wait(self):
        # Job accounting may reach zero before process handles signal and files unlock.
        handles = self._member_handles()
        try:
            if not self.api.TerminateJobObject(self.handle, 1):
                raise ctypes.WinError(ctypes.get_last_error())
            for handle in handles:
                if self.api.WaitForSingleObject(handle, 10000) != 0:
                    raise RuntimeError('Owned Windows process did not finish releasing resources')
            self._wait_empty()
        finally:
            for handle in handles:
                self.api.CloseHandle(handle)

    def _wait_empty(self):
        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_int64) for name in
                        ('user_time', 'kernel_time', 'period_user_time', 'period_kernel_time')] + [
                            (name, wintypes.DWORD) for name in
                            ('page_faults', 'total_processes', 'active_processes', 'terminated_processes')]

        deadline = time.monotonic() + 10
        while True:
            accounting = Accounting()
            if not self.api.QueryInformationJobObject(self.handle, 1, ctypes.byref(accounting),
                                                      ctypes.sizeof(accounting), None):
                raise ctypes.WinError(ctypes.get_last_error())
            if accounting.active_processes == 0:
                return
            if time.monotonic() >= deadline:
                raise RuntimeError('Owned Windows process tree did not finish exiting')
            time.sleep(0.01)

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


_self_job = None


def protect_current_process_tree():
    """Keep a private job handle until OS process exit; descendants die with us.

    Used by the detached wrapper and each reload worker, not by borrowed servers.
    Never close a self-containing job explicitly (that would terminate ourselves).
    """
    global _self_job
    if os.name == 'nt' and _self_job is None:
        job = _WindowsJob()
        # GetCurrentProcess pseudo handle (-1), with full access to ourselves.
        if not job.api.AssignProcessToJobObject(job.handle, wintypes.HANDLE(-1)):
            error = ctypes.WinError(ctypes.get_last_error())
            job.close()
            raise error
        _self_job = job


@dataclass
class RunningServer:
    base_url: str
    identity: dict
    app: str = "app.main:app"
    app_dir: Path = BACKEND_DIR

    def check(self, base_url: str | None = None) -> dict:
        """Pin both this launch and current source, optionally through the Vite proxy."""
        return assert_identity(base_url or self.base_url, launch_id=self.identity["launch_id"],
                               pid=self.identity["pid"], app=self.app, app_dir=self.app_dir)


@contextmanager
def fresh_server(*, port: int = 0, app: str = "app.main:app", app_dir: Path = BACKEND_DIR,
                 timeout: float = 25, env: dict | None = None):
    # Before Popen: occupied ports must fail without launching or killing anything.
    with reserve_port("127.0.0.1", port) as reservation:
        port = reservation.getsockname()[1]
    launch_id = uuid4().hex
    url = f"http://127.0.0.1:{port}"
    command = [sys.executable, "-u", str(BACKEND_DIR / "scripts" / "dev_run.py"),
               "--port", str(port), "--app", app, "--app-dir", str(app_dir),
               "--launch-id", launch_id, "--parent-gate", "--log-level", "warning"]
    child_env = os.environ.copy()
    child_env.update(PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    if env:
        child_env.update(env)
    process = None
    job = None
    with tempfile.TemporaryFile() as log:
        try:
            job = _WindowsJob() if os.name == "nt" else None
            process = subprocess.Popen(command, cwd=REPO_ROOT, env=child_env, stdin=subprocess.PIPE,
                                       stdout=log, stderr=log, start_new_session=os.name != "nt")
            # The stdin gate prevents any application import/child creation before
            # assignment. If assignment fails, fail closed; never fall back to PID kills.
            if job:
                job.assign(process)
            process.stdin.write(b"START\n")
            process.stdin.close()
            deadline = time.monotonic() + timeout
            while True:
                if process.poll() is not None:
                    log.seek(0)
                    detail = log.read().decode("utf-8", errors="replace")[-4000:]
                    raise RuntimeError(f"Fresh server exited ({process.returncode}) before readiness:\n{detail}")
                try:
                    identity = assert_identity(url, launch_id=launch_id, pid=process.pid,
                                               app=app, app_dir=app_dir, timeout=0.25)
                    # HTTP success from another launch cannot mask a child exit.
                    if process.poll() is not None:
                        raise RuntimeError("Fresh server exited during identity verification")
                    break
                except (URLError, TimeoutError, ConnectionError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"Fresh server startup timed out after {timeout}s: {url}")
                    time.sleep(0.05)
            yield RunningServer(url, identity, app, app_dir)
        finally:
            if process is not None and process.stdin and not process.stdin.closed:
                process.stdin.close()
            try:
                if job:
                    job.terminate_and_wait()
            finally:
                if job:
                    job.close()
                if process is not None:
                    if os.name != "nt":
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    elif process.poll() is None:
                        process.kill()
                    process.wait(timeout=10)


@contextmanager
def server_session(*, port: int, existing: bool = False, launch_id: str | None = None):
    """Acceptance default = fresh; attachment requires an explicitly pinned launch."""
    if existing:
        if not launch_id:
            raise ValueError("--existing requires --launch-id from the development identity endpoint")
        url = f"http://127.0.0.1:{port}"
        identity = assert_identity(url, launch_id=launch_id)
        yield RunningServer(url, identity)  # Never stop a borrowed process.
    else:
        if launch_id:
            raise ValueError("--launch-id is only valid with --existing")
        with fresh_server(port=port) as server:
            yield server
