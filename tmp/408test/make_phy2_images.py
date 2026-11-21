"""Render five university-physics exam questions as PNG screenshots (round 2)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 27)
FONT_S = ImageFont.truetype("msyh.ttc", 23)

QUESTIONS = [
    (
        "ph6_incline.png",
        [
            ("大学物理期末考试题  力学", FONT_S, (90, 90, 90)),
            ("4. 质量为2.0kg的物体沿倾角30°的光滑斜面由静止下滑，", FONT, (20, 20, 20)),
            ("    取g=9.8m/s²。求物体下滑的加速度大小（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 4.9m/s²   B. 8.5m/s²   C. 9.8m/s²   D. 19.6m/s²", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph7_ampere.png",
        [
            ("大学物理期末考试题  电磁学", FONT_S, (90, 90, 90)),
            ("12. 一根长0.5m的直导线通有电流10A，置于磁感应强度为", FONT, (20, 20, 20)),
            ("    0.2T的匀强磁场中，导线与磁场方向垂直。求导线所受安", FONT, (20, 20, 20)),
            ("    培力的大小（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 0.5N      B. 1.0N      C. 2.0N      D. 4.0N", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph8_capacitor.png",
        [
            ("大学物理期末考试题  电磁学", FONT_S, (90, 90, 90)),
            ("6. 两个电容器C1=2μF和C2=4μF串联后接在电压U=12V的", FONT, (20, 20, 20)),
            ("    电源两端。求串联后的等效电容（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 6μF       B. 3μF       C. 1.33μF    D. 0.75μF", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph9_carnot.png",
        [
            ("大学物理期末考试题  热学", FONT_S, (90, 90, 90)),
            ("10. 一卡诺热机工作在高温热源727°C和低温热源27°C之间，", FONT, (20, 20, 20)),
            ("    每循环从高温热源吸收热量2000J。求该热机的效率（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 70%       B. 37%       C. 27%       D. 96%", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph10_energy.png",
        [
            ("大学物理期末考试题  力学", FONT_S, (90, 90, 90)),
            ("8. 质量为1.0kg的物体从光滑轨道上高度h=5m处由静止滑下，", FONT, (20, 20, 20)),
            ("    取g=10m/s²。求物体到达轨道底端时的速度大小（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 5m/s      B. 7.1m/s    C. 10m/s     D. 14m/s", FONT, (20, 20, 20)),
        ],
    ),
]


def render(name: str, lines: list[tuple[str, object, tuple[int, int, int]]]) -> str:
    pad_x, pad_y, line_h = 48, 40, 50
    w, h = 1180, pad_y * 2 + line_h * len(lines) + 20
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
