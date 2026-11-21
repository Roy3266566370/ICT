"""Render three real 408 exam questions as PNG screenshots for pipeline testing."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 28)
FONT_S = ImageFont.truetype("msyh.ttc", 24)

QUESTIONS = [
    (
        "q1_stack.png",
        [
            ("2009年408统考真题  数据结构", FONT_S, (90, 90, 90)),
            ("2. 设栈 S 和队列 Q 的初始状态均为空，元素 a, b, c, d, e, f, g", FONT, (20, 20, 20)),
            ("    依次进入栈 S。若每个元素出栈后立即进入队列 Q，且 7 个元", FONT, (20, 20, 20)),
            ("    素出队的顺序是 b, d, c, f, e, a, g，则栈 S 的容量至少是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 1        B. 2        C. 3        D. 4", FONT, (20, 20, 20)),
        ],
    ),
    (
        "q2_heap.png",
        [
            ("2009年408统考真题  数据结构", FONT_S, (90, 90, 90)),
            ("9. 已知关键字序列 5，8，12，19，28，20，15，22 是小根堆（最小堆），", FONT, (20, 20, 20)),
            ("    插入关键字 3，调整后得到的小根堆是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 3，5，12，8，28，20，15，22，19", FONT, (20, 20, 20)),
            ("    B. 3，5，12，19，20，15，22，8，28", FONT, (20, 20, 20)),
            ("    C. 3，8，12，5，20，15，22，28，19", FONT, (20, 20, 20)),
            ("    D. 3，12，5，8，28，20，15，22，19", FONT, (20, 20, 20)),
        ],
    ),
    (
        "q3_bsearch.png",
        [
            ("2010年408统考真题  数据结构", FONT_S, (90, 90, 90)),
            ("9. 已知一个长度为 16 的顺序表 L，其元素按关键字有序排列。若采", FONT, (20, 20, 20)),
            ("    用折半查找法查找一个 L 中不存在的元素，则关键字的比较次数", FONT, (20, 20, 20)),
            ("    最多的是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 4        B. 5        C. 6        D. 7", FONT, (20, 20, 20)),
        ],
    ),
]


def render(name: str, lines: list[tuple[str, object, tuple[int, int, int]]]) -> str:
    pad_x, pad_y, line_h = 48, 40, 52
    w = 1180
    h = pad_y * 2 + line_h * len(lines) + 20
    img = Image.new("RGB", (w, h), (252, 252, 250))
    d = ImageDraw.Draw(img)
    y = pad_y
    for text, font, color in lines:
        d.text((pad_x, y), text, font=font, fill=color)
        y += line_h
    path = os.path.join(OUT, name)
    img.save(path)
    return path


for fname, lines in QUESTIONS:
    print(render(fname, lines))
