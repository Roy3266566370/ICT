"""Render five real university-physics exam questions as PNG screenshots (round 1)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 27)
FONT_S = ImageFont.truetype("msyh.ttc", 23)

QUESTIONS = [
    (
        "ph1_fall.png",
        [
            ("大学物理期末考试题  力学", FONT_S, (90, 90, 90)),
            ("19. 一个物体从高度h=10m处自由落下，忽略空气阻力，", FONT, (20, 20, 20)),
            ("    取重力加速度g=9.8m/s²。求物体落地时的速度大小。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 9.8m/s    B. 14m/s    C. 19.6m/s    D. 28m/s", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph2_collision.png",
        [
            ("大学物理期末考试题  力学", FONT_S, (90, 90, 90)),
            ("7. 质量为m1=2.0kg的物体以速度v1=3.0m/s运动，与静止的", FONT, (20, 20, 20)),
            ("    质量为m2=1.0kg的物体发生完全非弹性碰撞。求碰撞后两", FONT, (20, 20, 20)),
            ("    物体的共同速度大小（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 1.0m/s    B. 1.5m/s    C. 2.0m/s    D. 3.0m/s", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph3_lorentz.png",
        [
            ("大学物理期末考试题  电磁学", FONT_S, (90, 90, 90)),
            ("15. 一电荷量为1.6×10^-19C、质量为9.1×10^-31kg的带电粒", FONT, (20, 20, 20)),
            ("    子，以1.0×10^7m/s的速度垂直射入磁感应强度为1.0×10^-3T", FONT, (20, 20, 20)),
            ("    的匀强磁场中。求该粒子做圆周运动的轨道半径（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 5.7×10^-2m  B. 5.7×10^-4m  C. 3.6×10^-2m  D. 1.8×10^-1m", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph4_doubleslit.png",
        [
            ("大学物理期末考试题  波动光学", FONT_S, (90, 90, 90)),
            ("22. 在杨氏双缝干涉实验中，入射光波长为500nm，双缝间距", FONT, (20, 20, 20)),
            ("    为0.2mm，缝屏间距为1.0m。求屏上相邻明条纹的间距（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 1.25mm    B. 2.5mm    C. 4.0mm    D. 5.0mm", FONT, (20, 20, 20)),
        ],
    ),
    (
        "ph5_photoelectric.png",
        [
            ("大学物理期末考试题  近代物理", FONT_S, (90, 90, 90)),
            ("9. 已知金属铯的逸出功为1.88eV，现用波长为300nm的紫外光", FONT, (20, 20, 20)),
            ("    照射铯表面。求逸出光电子的最大初动能（以eV为单位，", FONT, (20, 20, 20)),
            ("    结果保留两位小数）（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 1.88eV    B. 2.26eV    C. 4.14eV    D. 0.38eV", FONT, (20, 20, 20)),
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
