"""Render 13 university-physics exam questions as PNG screenshots (round 4)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 27)
FONT_S = ImageFont.truetype("msyh.ttc", 23)

Q = [
    ("ph35_rel.png", "力学", "34. 甲船以vA=5m/s向东行驶，乙船以vB=3m/s向东行驶。",
     "求甲船相对乙船的速度（ ）。", "A. 1m/s    B. 2m/s    C. 4m/s    D. 8m/s"),
    ("ph36_sw.png", "力学", "36. 劲度系数k=200N/m的弹簧从原长被拉伸x=0.1m。",
     "求拉力做的功（ ）。", "A. 0.5J    B. 1J      C. 2J      D. 4J"),
    ("ph37_we.png", "力学", "38. 质量m=2kg的物体在合力F=10N作用下沿位移s=5m运动，",
     "由静止开始。求合力做功后的末速度（ ）。", "A. 5m/s    B. 7.07m/s C. 10m/s   D. 14.1m/s"),
    ("ph38_im.png", "力学", "40. 质量m=0.5kg的物体速度由v1=2m/s变为v2=6m/s，",
     "作用时间t=0.2s。求平均冲力（ ）。", "A. 5N      B. 10N     C. 15N     D. 20N"),
    ("ph39_el.png", "力学", "42. 质量m1=2kg的物体以v1=4m/s与静止的m2=1kg物体",
     "发生弹性碰撞。求碰后m1的速度（ ）。", "A. 1.33m/s B. 2m/s    C. 2.67m/s D. 4m/s"),
    ("ph40_rr.png", "力学", "44. 转动惯量J=2kg·m2的刚体在力矩M=6N·m作用下",
     "由静止开始转动。求角加速度（ ）。", "A. 1rad/s² B. 2rad/s² C. 3rad/s² D. 6rad/s²"),
    ("ph41_ro.png", "力学", "46. 半径R=0.1m、质量m=2kg的圆柱体沿倾角30°的斜面",
     "纯滚动下滑s=2m，取g=10m/s²。求到底时的速度（ ）。",
     "A. 2.58m/s B. 3.65m/s C. 4.47m/s D. 6.32m/s"),
    ("ph42_wt.png", "力学", "48. 一列简谐行波振幅A=0.02m，波长λ=2m，频率f=5Hz。",
     "求波速（ ）。", "A. 2.5m/s  B. 5m/s    C. 10m/s   D. 20m/s"),
    ("ph43_st.png", "力学", "50. 长L=1m的弦两端固定，波速v=100m/s。",
     "求基频（ ）。", "A. 25Hz    B. 50Hz    C. 100Hz   D. 200Hz"),
    ("ph44_eg.png", "近代物理", "52. 一群处于n=4激发态的氢原子向低能级跃迁。",
     "最多能发出几种不同频率的光（ ）。", "A. 3种     B. 4种     C. 6种     D. 10种"),
    ("ph45_bw.png", "几何光学", "54. 光从空气射向折射率n=1.5的玻璃。",
     "求布儒斯特角（ ）。", "A. 41.8°   B. 48.6°   C. 56.3°   D. 60°"),
    ("ph46_cv.png", "几何光学", "56. 凹透镜焦距f=-10cm，物距u=20cm处放一物体。",
     "求像距（ ）。", "A. -6.67cm B. -20cm   C. 6.67cm  D. 20cm"),
    ("ph47_rd.png", "电磁学", "58. RC放电电路中电阻R=1000Ω、电容C=10μF、电源电压E=9V。",
     "求放电t=0.01s时电容上的电压（ ）。", "A. 3.31V   B. 5.69V   C. 8.08V   D. 9.0V"),
]


def render(name, section, l1, l2, options):
    pad_x, pad_y, line_h = 48, 40, 50
    lines = [(f"大学物理期末考试题  {section}", FONT_S, (90, 90, 90)),
             (l1, FONT, (20, 20, 20)), (l2, FONT, (20, 20, 20)),
             ("", FONT, (20, 20, 20)), (f"    {options}", FONT, (20, 20, 20))]
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


for args in Q:
    print(render(*args))
