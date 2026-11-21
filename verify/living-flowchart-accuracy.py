"""Score nodes and directed edges on two published FlowVQA diagrams via the live API."""
from __future__ import annotations

import argparse
from collections import Counter
import io
import json
from pathlib import Path
import re

import pymupdf
from PIL import Image
import requests

SOURCE = ("https://papers.nips.cc/paper_files/paper/2024/file/"
          "3a10c46572628d58cb44fb705f25cbbf-Paper-Conference.pdf")

# Manually transcribed from the two full diagrams in Figure 5, page 19.
CASES = [
    ("lamp", (800, 1091), [
        "Lamp doesn't work", "Lamp plugged in?", "Plug in lamp",
        "Bulb burned out?", "Replace bulb", "Repair lamp",
    ], [(0, 1), (1, 2), (1, 3), (3, 4), (3, 5)]),
    ("tea", (630, 1120), [
        "Start", "Turn on kettle", "Wait for kettle to boil", "Water boiled?", "Wait",
        "Pour water on teabag in cup", "Wait 2-3 min", "Add milk and sugar", "Stop",
    ], [(0, 1), (1, 2), (2, 3), (3, 4), (4, 2), (3, 5), (5, 6), (6, 7), (7, 8)]),
]


def normalize(label):
    return re.sub(r"[^a-z0-9]", "", label.lower())


def score(expected, actual):
    missing = list((expected - actual).elements())
    extra = list((actual - expected).elements())
    hits = sum((expected & actual).values())
    return {"matched": hits, "expected": expected.total(), "predicted": actual.total(),
            "precision": round(hits / max(1, actual.total()), 4),
            "recall": round(hits / expected.total(), 4), "missing": missing, "extra": extra}


def crop(pdf, size):
    ref, mask, *_ = next(item for item in pdf[18].get_images() if item[2:4] == size)
    pixels = pymupdf.Pixmap(pdf, ref)
    if mask:
        pixels = pymupdf.Pixmap(pixels, pymupdf.Pixmap(pdf, mask))
    image = Image.frombytes("RGBA" if pixels.alpha else "RGB", size, pixels.samples).convert("RGBA")
    background = Image.new("RGBA", size, "white")
    background.alpha_composite(image)
    buffer = io.BytesIO()
    background.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:5173")
    parser.add_argument("--pdf", type=Path, help="Optional local copy of the published FlowVQA paper")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.pdf:
        content = args.pdf.read_bytes()
    else:
        response = requests.get(SOURCE, timeout=30)
        response.raise_for_status()
        content = response.content
    base = args.base.rstrip("/")
    client = requests.Session()
    session = client.post(f"{base}/api/v1/sessions", timeout=15)
    session.raise_for_status()
    headers = {"X-CSRF-Token": session.json()["data"]["csrf_token"]}
    status = client.get(f"{base}/api/v1/living/ai-status", timeout=15)
    status.raise_for_status()
    vision = status.json()["data"]["vision"]
    results = []
    with pymupdf.open(stream=content, filetype="pdf") as pdf:
        for name, size, labels, links in CASES:
            result = {"case": name, "ok": False}
            results.append(result)
            try:
                uploaded = client.post(f"{base}/api/v1/pages", headers=headers, timeout=180,
                                       files={"files": (f"{name}.png", crop(pdf, size), "image/png")})
                uploaded.raise_for_status()
                doc = uploaded.json()["data"]
                region = next(r for b in doc["blocks"] if b["type"] == "page"
                              for r in b["data"].get("regions", []) if r["kind"] in ("figure", "diagram"))
                url = f'{base}/api/v1/pages/{doc["page_id"]}/regions/{region["id"]}/diagram'
                response = client.post(url, headers=headers, timeout=180,
                                               json={"expected_revision": doc["revision"]})
                if not response.ok:
                    raise ValueError(f'HTTP {response.status_code}: {response.json()["error"]["message"]}')
                doc = response.json()["data"]
                diagram = next(r["diagram"] for b in doc["blocks"] if b["type"] == "page"
                               for r in b["data"].get("regions", []) if r["id"] == region["id"])
                names = {n["id"]: normalize(n["label"]) for n in diagram["nodes"]}
                keys = list(map(normalize, labels))
                nodes = score(Counter(keys), Counter(names.values()))
                edges = score(Counter((keys[a], keys[b]) for a, b in links),
                              Counter((names[e["from"]], names[e["to"]]) for e in diagram["edges"]))
                result.update(nodes=nodes, directed_edges=edges,
                              confidence=diagram["confidence"], warnings=diagram["warnings"],
                              ok=all(metric["precision"] == metric["recall"] == 1 for metric in (nodes, edges)))
            except (ValueError, RuntimeError, StopIteration, requests.RequestException) as error:
                result["error"] = str(error) or type(error).__name__
            print(json.dumps(result, ensure_ascii=True), flush=True)
    args.report.write_text(json.dumps({"source": SOURCE, "figure": 5, "vision": vision,
                                      "cases": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    return 0 if all(result["ok"] for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
