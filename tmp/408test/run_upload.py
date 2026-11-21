"""Create a guest session, upload matching question images, and inspect recognition."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = os.path.dirname(os.path.abspath(__file__))


def parse_data(response) -> dict:
    """Never include session response bodies in errors: they contain tokens."""
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f"API request failed (HTTP {response.status_code})")
    try:
        payload = response.json()
    except ValueError:
        raise RuntimeError("API response is not valid JSON") from None
    if not isinstance(payload, dict):
        raise RuntimeError("API response must be an object")
    if "error" in payload:
        raise RuntimeError("API returned an error envelope")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("API response requires an object in data")
    return data


def upload(s, server, prefix: str) -> None:
    base = server.base_url + '/api/v1'
    server.check()
    r = s.post(f"{base}/sessions", timeout=30)
    server.check()
    print("sessions:", r.status_code)
    session = parse_data(r)
    csrf = session.get("csrf_token")
    if not isinstance(csrf, str) or not csrf.strip():
        raise RuntimeError("Session response is missing data.csrf_token")
    s.headers.update({"X-CSRF-Token": csrf})

    files = [n for n in os.listdir(OUT) if n.startswith(prefix) and n.endswith(".png")]
    for name in sorted(files):
        path = os.path.join(OUT, name)
        server.check()
        with open(path, "rb") as fh:
            r = s.post(f"{base}/labs",
                       files={"files": (name, fh, "image/png")},
                       data={"roles": "problem", "title": name}, timeout=300)
        server.check()
        print(f"\n=== {name} -> {r.status_code} ===")
        doc = parse_data(r)
        lab_id = doc.get("lab_id")
        problems = doc.get("problems")
        if (not isinstance(lab_id, str) or not lab_id or not isinstance(problems, list)
                or not all(isinstance(p, dict) for p in problems)):
            raise RuntimeError("Upload response requires data.lab_id and data.problems")
        out_path = os.path.join(OUT, f"result_{name}.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            # Preserve the complete envelope (including request_id) for diagnostics.
            json.dump(r.json(), fh, ensure_ascii=False, indent=2)
        print("lab_id:", lab_id, "| problems:", len(problems))
        for p in problems:
            model = p.get("model") or {}
            sol = p.get("solution") or {}
            print(f"  - status={p.get('status')} subject={p.get('subject')} "
                  f"engine={model.get('engine')} ds_kind={model.get('ds_kind')} "
                  f"task={model.get('task')}")
            print(f"    headline={sol.get('headline', '')[:120]}")
            print(f"    answer={sol.get('answer', '')[:160]}")
            for a in ((p.get("recognition") or {}).get("ambiguities") or [])[:4]:
                print(f"    ambiguity: {a.get('field')} - {str(a.get('question') or a.get('id'))[:100]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prefix', nargs='?', default='cn')
    parser.add_argument('--port', type=int, default=8765)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--fresh', action='store_true', help='Start/stop an owned server (default); occupied port fails')
    mode.add_argument('--existing', action='store_true', help='Borrow a verified server; requires --launch-id')
    parser.add_argument('--launch-id')
    parser.add_argument('--check-only', action='store_true', help='Identity check only; no upload/AI requests')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'backend'))
    from scripts.dev_server import server_session

    with server_session(port=args.port, existing=args.existing, launch_id=args.launch_id) as server:
        print(json.dumps({'server_identity': server.identity}), flush=True)
        if not args.check_only:
            import requests

            with requests.Session() as session:
                session.trust_env = False
                upload(session, server, args.prefix)


if __name__ == "__main__":
    main()
