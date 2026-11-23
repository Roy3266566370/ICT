"""Measure the vision model against manually annotated endpoints."""
import argparse
import json
import math
import sys
import time
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from app.living.vision import LivingVisionClient
from app.ppt_ai.client import PPTAIError
from PIL import Image, ImageDraw

PROMPT = """读这张 900×485 像素的换基图。以左上角为原点，x 向右、y 向下，返回实际像素。
只返回 JSON，键为 left_x,left_y,left_e1,left_e2,left_v,left_coord,right_x,right_y,right_b1,right_b2,right_v,right_guide,right_coord。
轴、箭头与虚线值均为 [[x1,y1],[x2,y2]]，箭头终点是尖端，虚线取右图可见斜虚线的两个几何端点。
文字值为 {"at":[x,y],"text":"..."}，只抄写坐标对，at 取括号文字的中心。不可猜测不可见对象。"""
TRUTH = {
    'left_x': [[85,343],[431,343]], 'left_y': [[191,139],[191,408]],
    'left_e1': [[191,343],[335,343]], 'left_e2': [[191,343],[191,260]],
    'left_v': [[191,343],[335,260]], 'left_coord': {'at':[285,99],'text':'(2, 1)'},
    'right_x': [[521,343],[867,343]], 'right_y': [[627,139],[627,408]],
    'right_b1': [[627,343],[700,343]], 'right_b2': [[627,343],[700,260]],
    'right_v': [[627,343],[771,260]], 'right_guide': [[700,343],[771,260]],
    'right_coord': {'at':[705,99],'text':'(1, 1)'},
}

NORMALIZED_PROMPT = """你是图像坐标标注员。请按图上可见像素位置测量两组换基图中的下列 13 个对象。
x 从整图左缘到右缘，y 从整图上缘到下缘，分别按各边长度归一到 0–1000。以整幅图为基准，右图不得另起原点。坐标原点是图片左上角，灰色轴线交点是各向量的起点。
返回一个 JSON 对象，且仅有以下 13 个键。每根线须使用 {"x1":整数,"y1":整数,"x2":整数,"y2":整数}，每个坐标文字须使用 {"x":整数,"y":整数,"text":字符串}。没有看到的对象返回 null。
left_x、right_x：左右图的浅灰色水平轴线，从左端到右端，穿过蓝箭头。
left_y、right_y：左右图的浅灰色竖直轴线，从顶端到底端。
left_e1、right_b1：左右图各自蓝色水平箭头，从灰轴交点到最右侧三角形尖端。
left_e2、right_b2：左右图各自棕色箭头，从灰轴交点到三角形尖端。左图棕箭头垂直，右图棕箭头倾斜。
left_v、right_v：左右图各自深色斜箭头，从灰轴交点到三角形尖端。
right_guide：右图棕色斜虚线，从蓝箭头尖附近到深色箭头尖附近。
left_coord、right_coord：各子图标题后的括号坐标，x、y 为括号串中心，text 只抄括号串。"""


def grid_image(original):
    with Image.open(BytesIO(original)) as source:
        image = source.convert('RGB')
    grid = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(grid)
    width, height = image.size
    for label in range(100, 1000, 100):
        x, y = round(label * width / 1000), round(label * height / 1000)
        draw.line((x, 0, x, height), fill=(105, 66, 145, 65))
        draw.line((0, y, width, y), fill=(105, 66, 145, 65))
        draw.text((x + 2, 3), str(label), fill=(105, 66, 145, 255))
        draw.text((3, y + 2), str(label), fill=(105, 66, 145, 255))
    composed = Image.alpha_composite(image.convert('RGBA'), grid).convert('RGB')
    output = BytesIO()
    composed.save(output, format='PNG')
    return output.getvalue()


def to_pixels(actual, expected):
    def point(x, y):
        if any(type(value) not in (int, float) or not 0 <= value <= 1000 for value in (x, y)):
            raise ValueError('normalized coordinate out of range')
        return [x * 0.9, y * 0.485]

    if isinstance(expected, dict):
        return {'at': point(actual['x'], actual['y']), 'text': actual['text']}
    return [point(actual['x1'], actual['y1']), point(actual['x2'], actual['y2'])]


def score(prediction, mode, annotations=TRUTH, image_width=900):
    scores = {}
    for key, expected in annotations.items():
        try:
            actual = prediction[key]
            if mode != 'pixel':
                actual = to_pixels(actual, expected)
            if isinstance(expected, dict):
                error = math.dist(actual['at'], expected['at'])
                if actual['text'].replace(' ', '') != expected['text'].replace(' ', ''):
                    error = None
            else:
                error = max(math.dist(actual[i], expected[i]) for i in range(2))
                if key.endswith(('_x', '_y', '_guide')):
                    error = min(error, max(math.dist(actual[1-i], expected[i]) for i in range(2)))
            scores[key] = error
        except (AttributeError, KeyError, TypeError, ValueError, IndexError):
            scores[key] = None
    return {
        'error_px': {key: round(error, 2) if error is not None else None for key, error in scores.items()},
        'passed': sum(error is not None and error < image_width * .03 for error in scores.values()),
        'total': len(annotations),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('pixel', 'normalized', 'grid'), default='pixel')
    mode = parser.parse_args().mode
    image = (ROOT / 'frontend/e2e/fixtures/basis-alternate.png').read_bytes()
    prompt = PROMPT if mode == 'pixel' else NORMALIZED_PROMPT
    if mode == 'grid':
        image = grid_image(image)
        Path(__file__).with_name('basis-grid-input.png').write_bytes(image)
        prompt += '\n淡紫色细线、顶部及左边上的淡紫色数字是标注辅助网格，100 为格距。用相邻网格内插，细线和数字本身不属于待标注对象。'
    client = LivingVisionClient()
    started = time.monotonic()
    result = {'model': client.profile.model, 'prompt': prompt, 'threshold_px': 27, 'annotations': TRUTH}
    try:
        result['prediction'] = client.generate_json(
            image_png=image, prompt=prompt, max_output_tokens=1800, timeout_s=30)
    except PPTAIError as error:
        result['error'] = {'code': error.code, 'status': error.status}
    result['elapsed_s'] = round(time.monotonic() - started, 2)
    if 'prediction' in result:
        result.update(score(result['prediction'], mode))
    filename = 'vision-result.json' if mode == 'pixel' else f'vision-result-{mode}.json'
    Path(__file__).with_name(filename).write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
