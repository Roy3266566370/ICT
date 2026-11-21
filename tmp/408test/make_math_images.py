"""Render 12 advanced-mathematics (calculus) exam questions as PNG screenshots (round 1)."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

Q = [
    ("mt1_lim.png", "极限", "1. 求极限 lim(x→0) sinx/x（ ）。",
     "", "A. 0       B. 1       C. 2       D. 不存在"),
    ("mt2_lim.png", "极限", "2. 求极限 lim(x→0) (1-cosx)/x^2（ ）。",
     "", "A. 0       B. 1/4     C. 1/2     D. 1"),
    ("mt3_der.png", "导数", "3. 设函数y=x^2·sinx，求dy/dx（ ）。",
     "", "A. 2x·sinx B. x^2·cosx C. x(xcosx+2sinx) D. 2x·cosx"),
    ("mt4_tan.png", "导数", "4. 求曲线y=x^2在点x=1处的切线方程（ ）。",
     "", "A. y=2x-1  B. y=2x+1  C. y=x-1    D. y=x"),
    ("mt5_int.png", "积分", "5. 计算不定积分∫x·e^x dx（ ）。",
     "", "A. e^x+C   B. xe^x+C  C. (x-1)e^x+C D. (x+1)e^x+C"),
    ("mt6_dfi.png", "积分", "6. 计算定积分∫_0^1 x^2 dx（ ）。",
     "", "A. 1/4     B. 1/3     C. 1/2     D. 1"),
    ("mt7_ext.png", "极值", "7. 求函数f(x)=x^3-3x的极值（ ）。",
     "", "A. 极大2 极小-2 B. 极大-2 极小2 C. 无极值 D. 极大4 极小-4"),
    ("mt8_ser.png", "级数", "8. 判别级数Σ1/n^2的收敛性（ ）。",
     "", "A. 发散    B. 条件收敛 C. 绝对收敛 D. 无法判定"),
    ("mt9_ode.png", "微分方程", "9. 求微分方程dy/dx=2y的通解（ ）。",
     "", "A. y=Ce^x  B. y=Ce^2x C. y=2x+C   D. y=x^2+C"),
    ("mt10_di.png", "重积分", "10. 计算二重积分∫∫D xy dσ，其中D为",
     "0≤x≤1，0≤y≤1（ ）。", "A. 1/8     B. 1/4     C. 1/2     D. 1"),
    ("mt11_ty.png", "级数", "11. 求函数f(x)=e^x的麦克劳林展开式，",
     "展开到4阶（ ）。", "A. 含x^4/24 B. 含x^4/12 C. 含x^3/12 D. 不含x^4项"),
    ("mt12_im.png", "积分", "12. 计算广义积分∫_1^+∞ 1/x^2 dx（ ）。",
     "", "A. 发散    B. 1       C. 2       D. 1/2"),
]


def render(name, section, l1, l2, tail, l3=None, *,
           title="高等数学期末考试题", font_size=27, heading_size=23):
    """Render five-field rows with an optional third body line and keyword-only typography."""
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype("msyh.ttc", font_size)
    heading_font = ImageFont.truetype("msyh.ttc", heading_size)
    pad_x, pad_y, line_h = 48, 40, 50
    lines = [(f"{title}  {section}", heading_font, (90, 90, 90)),
             (l1, font, (20, 20, 20))]
    if l2:
        lines.append((l2, font, (20, 20, 20)))
    if l3:
        lines.append((l3, font, (20, 20, 20)))
    lines += [("", font, (20, 20, 20)), (f"    {tail}", font, (20, 20, 20))]
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


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
