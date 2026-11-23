"""Exercise the configured text model with five non-demo rotation problems."""
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app.labs.walkthrough.service import generate

CASES = {
    'hemisphere': '求第一类曲面积分 ∫∫_Σ 1 dS，其中 Σ 是 x^2+y^2+z^2=1 的上半球面，不含底圆盘。',
    'cylinder': '求第一类曲面积分 ∫∫_Σ (x^2+y^2+z) dS，Σ 是 x^2+y^2=1，0≤z≤2 的完整圆柱侧面。',
    'changed_integrand': '求第一类曲面积分 ∫∫_Σ (x^2+y^2) dS，Σ 是单位球面 x^2+y^2+z^2=1。',
    'cone_flux': '求第二类曲面积分，向量场 F=(0,0,1) 穿过圆锥 z=sqrt(x^2+y^2), 0≤z≤2 的侧面，法向朝内，不含底面。',
    'paraboloid': '求第一类曲面积分 ∫∫_Σ 1 dS，其中 Σ 是 z=x^2+y^2, 0≤z≤1 的整圈旋转抛物面，不含平面圆盘。',
}


def run(item):
    name, text = item
    started = time.monotonic()
    try:
        result = generate({'text': text, 'subject': 'calculus'})
        return name, {'question': text, 'elapsed_s': round(time.monotonic()-started, 2), 'walkthrough': result}
    except Exception as exc:
        return name, {'question': text, 'elapsed_s': round(time.monotonic()-started, 2), 'error': str(exc)}


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=2) as executor:
        output = dict(executor.map(run, CASES.items()))
    Path(__file__).with_name('model-result.json').write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
