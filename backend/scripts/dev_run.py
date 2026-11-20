"""Development-only uvicorn wrapper; production app.main is not modified.

python backend/scripts/dev_run.py --port 8000
python backend/scripts/dev_run.py --check-url http://127.0.0.1:8000

No reload by default: a changed source fingerprint requires an explicit restart.
The identity route is local development metadata, NOT an authentication boundary.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener
from uuid import uuid4

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
IDENTITY_PATH = "/api/__dev__/identity"
PROTOCOL = "ict-dev-v1"


class IdentityError(RuntimeError):
    pass


def canonical(path: Path | str) -> str:
    return os.path.normcase(str(Path(path).resolve()))


def source_fingerprint(app_dir: Path = BACKEND_DIR) -> str:
    """Hash names AND contents, including untracked sources; never use git/mtime.

    Excludes runtime data, secrets and bytecode. A custom app directory is useful
    for isolated integration tests, and is itself part of the identity.
    """
    roots = [BACKEND_DIR / "app", BACKEND_DIR / "scripts"]
    if canonical(app_dir) != canonical(BACKEND_DIR):
        roots.append(Path(app_dir))
    suffixes = {".py", ".json", ".toml", ".yaml", ".yml", ".txt", ".html", ".js", ".css"}
    files = {p for root in roots for p in root.rglob("*")
             if p.is_file() and p.suffix in suffixes and "__pycache__" not in p.parts}
    files.update(BACKEND_DIR.glob("requirements*.txt"))
    digest = hashlib.sha256()
    for path in sorted(files, key=canonical):
        digest.update(canonical(path).encode("utf-8") + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def reserve_port(host: str, port: int) -> socket.socket:
    """Exclusive preflight; retain this socket through uvicorn startup (no TOCTOU)."""
    sock = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.set_inheritable(True)
        return sock
    except OSError as exc:
        sock.close()
        raise RuntimeError(f"Port {host}:{port} unavailable; refusing to reuse or stop its owner: {exc}") from exc


def read_identity(base_url: str, timeout: float = 1.0) -> dict:
    # Do not send local probes through a system proxy or follow redirects to an
    # unrelated service. HTTP 200 HTML/OpenAPI is not a valid identity.
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    url = base_url.rstrip("/") + IDENTITY_PATH
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=timeout) as response:
            if response.geturl() != url:
                raise IdentityError("Identity endpoint redirected; refusing reuse")
            identity = json.load(response)
    except HTTPError as exc:
        raise IdentityError(f"No development identity at {url} (HTTP {exc.code}); restart via dev_run.py") from exc
    except (ValueError, UnicodeError) as exc:
        raise IdentityError(f"Invalid development identity at {url}; refusing reuse") from exc
    if not isinstance(identity, dict) or identity.get("protocol") != PROTOCOL:
        raise IdentityError(f"Unrecognized development identity at {url}; refusing reuse")
    return identity


def assert_identity(base_url: str, *, launch_id: str | None = None,
                    pid: int | None = None, app: str = "app.main:app",
                    app_dir: Path = BACKEND_DIR, timeout: float = 1.0) -> dict:
    identity = read_identity(base_url, timeout)
    expected = {"repo": canonical(REPO_ROOT), "app": app, "app_dir": canonical(app_dir)}
    if launch_id is not None:
        expected["launch_id"] = launch_id
    if pid is not None:
        expected["pid"] = pid
    for key, value in expected.items():
        if identity.get(key) != value:
            raise IdentityError(f"Development identity mismatch: {key}; refusing old/unrelated service")
    if (type(identity.get("pid")) is not int or identity["pid"] <= 0
            or not isinstance(identity.get("launch_id"), str) or not identity["launch_id"]
            or not isinstance(identity.get("started_at"), (int, float))):
        raise IdentityError("Incomplete development process identity; refusing reuse")
    if identity.get("source_fingerprint") != source_fingerprint(app_dir):
        raise IdentityError("Source fingerprint changed: stale backend. Restart required (start-dev.ps1 -Restart).")
    return identity


class DevelopmentIdentity:
    def __init__(self, app, identity: dict):
        self.app = app
        self.identity = identity

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == IDENTITY_PATH:
            body = json.dumps(self.identity).encode("utf-8")
            status = 200 if scope["method"] == "GET" else 405
            await send({"type": "http.response.start", "status": status, "headers": [
                (b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": body if status == 200 else b""})
        else:
            await self.app(scope, receive, send)


def create_dev_app():
    """Executed in the actual worker, also after each uvicorn reload."""
    from uvicorn.importer import import_from_string
    from scripts.dev_server import protect_current_process_tree

    protect_current_process_tree()
    app_dir = Path(os.environ["ICT_DEV_APP_DIR"])
    sys.path.insert(0, str(app_dir))
    fingerprint = source_fingerprint(app_dir)
    identity = dict(protocol=PROTOCOL, repo=canonical(REPO_ROOT), pid=os.getpid(),
                    root_pid=int(os.environ["ICT_DEV_ROOT_PID"]),
                    launch_id=os.environ["ICT_DEV_LAUNCH_ID"], started_at=time.time(),
                    app=os.environ["ICT_DEV_APP"], app_dir=canonical(app_dir),
                    source_fingerprint=fingerprint)
    app = import_from_string(identity["app"])
    if fingerprint != source_fingerprint(app_dir):
        raise RuntimeError("Source changed during import; restart required")
    # Frozen snapshot: recomputing this on requests would falsely bless old code.
    return DevelopmentIdentity(app, identity)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run or verify the local development backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--app", default="app.main:app")
    parser.add_argument("--app-dir", type=Path, default=BACKEND_DIR)
    parser.add_argument("--launch-id")
    parser.add_argument("--check-url", help="Read-only identity and current source check")
    parser.add_argument("--expected-pid", type=int)
    parser.add_argument("--parent-gate", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.check_url:
        try:
            identity = assert_identity(args.check_url, launch_id=args.launch_id,
                                       pid=args.expected_pid, app=args.app, app_dir=args.app_dir)
        except (IdentityError, OSError, URLError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(json.dumps(identity))
        return 0
    if args.parent_gate and sys.stdin.readline().strip() != "START":
        return 1  # No imports/children until the parent has assigned our Windows job.
    try:
        sock = reserve_port(args.host, args.port)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    try:
        # Timestamp-based .pyc can survive a same-size edit within one second.
        # Use a unique, non-created cache namespace and disable writes, in this
        # dev process (and reload children) only; do not delete users' caches.
        import tempfile
        sys.pycache_prefix = str(Path(tempfile.gettempdir()) / ('ict-dev-no-cache-' + uuid4().hex))
        sys.dont_write_bytecode = True
        os.environ.update(PYTHONPYCACHEPREFIX=sys.pycache_prefix, PYTHONDONTWRITEBYTECODE='1')
        sys.path.insert(0, str(BACKEND_DIR))
        os.environ.update(ICT_DEV_APP=args.app, ICT_DEV_APP_DIR=str(args.app_dir.resolve()),
                          ICT_DEV_LAUNCH_ID=args.launch_id or uuid4().hex,
                          ICT_DEV_ROOT_PID=str(os.getpid()))
        from scripts.dev_server import protect_current_process_tree
        protect_current_process_tree()
        import uvicorn
        from uvicorn.supervisors import ChangeReload

        # uvicorn 0.24 sends CTRL_C_EVENT and then joins indefinitely on Windows.
        # Detached processes may have no console; sharing a console can also
        # signal unrelated processes. Terminate only our worker instead. Its
        # self-owned job disposes of descendants when the worker exits.
        class WindowsReload(ChangeReload):
            def stop_worker(self):
                self.process.terminate()
                self.process.join(timeout=5)
                if self.process.is_alive():
                    self.process.kill()
                    self.process.join(timeout=5)
                if self.process.is_alive():
                    raise RuntimeError("Owned reload worker did not exit")

            def restart(self):
                from uvicorn._subprocess import get_subprocess
                self.stop_worker()
                self.process = get_subprocess(config=self.config, target=self.target, sockets=self.sockets)
                self.process.start()

            def shutdown(self):
                self.stop_worker()
                for owned_socket in self.sockets:
                    owned_socket.close()

        config = uvicorn.Config("scripts.dev_run:create_dev_app", factory=True,
                                host=args.host, port=sock.getsockname()[1],
                                log_level=args.log_level, reload=args.reload, workers=1,
                                reload_dirs=[str(args.app_dir)] if args.reload else None)
        server = uvicorn.Server(config)
        if args.reload:
            reloader = WindowsReload if os.name == 'nt' else ChangeReload
            reloader(config, target=server.run, sockets=[sock]).run()
        else:
            server.run(sockets=[sock])
            if not server.started:
                return 1
        return 0
    finally:
        sock.close()


if __name__ == "__main__":
    raise SystemExit(main())
