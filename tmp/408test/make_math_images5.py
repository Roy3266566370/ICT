# -*- coding: utf-8 -*-
"""Render 13 advanced-mathematics free-response questions (大题) as PNG screenshots (round 5)."""
from functools import partial

from make_math_images import render as _render

render = partial(_render, title="高等数学期末试卷")

Q = [
    ("m5a_seq.png", "计算题", "1.（8分）求数列极限",
     "lim(n→∞)n(√(n^2+1)-n)。", "解："),
    ("m5b_conv.png", "计算题", "2.（8分）判别级数",
     "∑(-1)^n/n 的敛散性。", "解："),
    ("m5c_rev.png", "计算题", "3.（10分）求曲线y=√x在[0,1]上",
     "绕x轴旋转所得旋转曲面的面积。", "解："),
    ("m5d_pal.png", "计算题", "4.（10分）求对数螺线r=e^θ",
     "在0≤θ≤1上的弧长。", "解："),
    ("m5e_std.png", "综合题", "5.（12分）讨论函数y=x^3-3x的",
     "单调性、极值、凹凸性与拐点。", "解："),
    ("m5f_tay.png", "计算题", "6.（8分）求函数f(x)=e^x在x=1",
     "处的3阶泰勒公式。", "解："),
    ("m5g_con.png", "讨论题", "7.（8分）设f(x)=x·sin(1/x)(x≠0)，",
     "f(0)=0，讨论f在x=0处的连续性。", "解："),
    ("m5h_geo.png", "应用题", "8.（10分）求由抛物线y=x^2与",
     "直线y=x所围成图形的面积。", "解："),
    ("m5i_vol.png", "应用题", "9.（10分）求由y=x^2，y=0与x=2所围",
     "图形绕y轴旋转一周所得旋转体的体积。", "解："),
    ("m5j_int.png", "计算题", "10.（6分）计算不定积分",
     "∫x^2·e^x dx。", "解："),
    ("m5k_lim.png", "计算题", "11.（6分）求极限",
     "lim(x→0)(e^x-1-x)/x^2。", "解："),
    ("m5l_din.png", "计算题", "12.（10分）计算二重积分∬_D xy dσ，",
     "其中D由y=x，y=0与x=1围成。", "解："),
    ("m5m_mul.png", "综合题", "13.（12分）设f(x)=x^3-3x。",
     "（1）求f的单调区间；（2）求f的极值。", "解："),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
