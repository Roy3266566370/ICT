"""Render four real 408 OS questions as PNG screenshots."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 27)
FONT_S = ImageFont.truetype("msyh.ttc", 23)

QUESTIONS = [
    (
        "os1_sched.png",
        [
            ("2017年408统考真题  操作系统", FONT_S, (90, 90, 90)),
            ("23. 假设4个作业到达系统的时刻和运行时间如下表所示。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    作业      到达时刻t      运行时间", FONT, (20, 20, 20)),
            ("    J1        0              3", FONT, (20, 20, 20)),
            ("    J2        1              3", FONT, (20, 20, 20)),
            ("    J3        1              2", FONT, (20, 20, 20)),
            ("    J4        3              1", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    系统在t=2时开始作业调度。若分别采用先来先服务和短作", FONT, (20, 20, 20)),
            ("    业优先调度算法，则选中的作业分别是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. J2、J3   B. J1、J4   C. J2、J4   D. J1、J3", FONT, (20, 20, 20)),
        ],
    ),
    (
        "os2_page.png",
        [
            ("2019年408统考真题  操作系统", FONT_S, (90, 90, 90)),
            ("29. 某系统采用LRU页置换算法和局部置换策略，若系统为进程P", FONT, (20, 20, 20)),
            ("    预分配了4个页框，进程P访问页号的序列为0,1,2,7,0,5,3,5,", FONT, (20, 20, 20)),
            ("    0,2,7,6，则进程访问上述页的过程中，产生页置换的总次数", FONT, (20, 20, 20)),
            ("    是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 3        B. 4        C. 5        D. 6", FONT, (20, 20, 20)),
        ],
    ),
    (
        "os3_disk.png",
        [
            ("2009年408统考真题  操作系统", FONT_S, (90, 90, 90)),
            ("29. 假设磁头当前位于第105道，正在向磁道序号增加的方向移", FONT, (20, 20, 20)),
            ("    动。现有一个磁道访问请求序列为35,45,12,68,110,180,170,", FONT, (20, 20, 20)),
            ("    195，采用SCAN调度（电梯调度）算法得到的磁道访问序列是", FONT, (20, 20, 20)),
            ("    （ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 110,170,180,195,68,45,35,12", FONT, (20, 20, 20)),
            ("    B. 110,68,45,35,12,170,180,195", FONT, (20, 20, 20)),
            ("    C. 110,170,180,195,12,35,45,68", FONT, (20, 20, 20)),
            ("    D. 12,35,45,68,110,170,180,195", FONT, (20, 20, 20)),
        ],
    ),
    (
        "os4_banker.png",
        [
            ("2018年408统考真题  操作系统", FONT_S, (90, 90, 90)),
            ("24. 假设系统中有4个同类资源，进程P1、P2和P3需要的资源数", FONT, (20, 20, 20)),
            ("    分别为4、3和1，P1、P2和P3已申请到的资源数分别为2、1", FONT, (20, 20, 20)),
            ("    和0，则执行安全性检测算法的结果是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 不存在安全序列，系统处于不安全状态", FONT, (20, 20, 20)),
            ("    B. 存在多个安全序列，系统处于安全状态", FONT, (20, 20, 20)),
            ("    C. 存在唯一安全序列P3、P1、P2，系统处于安全状态", FONT, (20, 20, 20)),
            ("    D. 存在唯一安全序列P3、P2、P1，系统处于安全状态", FONT, (20, 20, 20)),
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
