# -*- coding: utf-8 -*-
"""Upload archived test images under the real lab408test account."""
import json
import os
import sys

import requests

BASE = "http://127.0.0.1:8000/api/v1"
IDENT = "lab408test@example.com"
PASSWORD = "Test!408pass"
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "correct", "round8_math_fourier_parametric")


def main() -> None:
    s = requests.Session()
    s.trust_env = False
    r = s.post(f"{BASE}/auth/login",
               json={"identifier": IDENT, "password": PASSWORD, "remember": False},
               timeout=30)
    print("login:", r.status_code)
    data = r.json().get("data") or {}
    csrf = data.get("csrf_token")
    if not csrf:
        print(r.text[:500])
        return
    s.headers.update({"X-CSRF-Token": csrf})
    r = s.post(f"{BASE}/sessions", timeout=30)
    print("sessions:", r.status_code)
    s.headers.update({"X-CSRF-Token": (r.json().get("data") or {}).get("csrf_token") or csrf})

    files = sorted(n for n in os.listdir(DIR) if n.endswith(".png"))
    print(f"uploading {len(files)} images from {DIR}")
    for name in files:
        with open(os.path.join(DIR, name), "rb") as fh:
            r = s.post(f"{BASE}/labs",
                       files={"files": (name, fh, "image/png")},
                       data={"roles": "problem", "title": name}, timeout=300)
        doc = r.json().get("data") or {}
        probs = doc.get("problems") or []
        st = probs[0].get("status") if probs else "?"
        eng = (probs[0].get("model") or {}).get("engine") if probs else "?"
        print(f"  {name}: {r.status_code} lab={doc.get('lab_id')} status={st} engine={eng}")


if __name__ == "__main__":
    main()
