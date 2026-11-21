# -*- coding: utf-8 -*-
"""Render 13 analytic-geometry free-response questions as PNG (round 6)."""
from functools import partial

from make_math_images import render as _render

render = partial(_render, title="高等数学期末试卷", font_size=26, heading_size=22)

Q = [
    ("m6a_tan.png", "计算题", "1.（10分）求曲面z=x^2+y^2在点(1,1,2)处",
     "的切平面方程与法线方程。", "解："),
    ("m6b_qua.png", "填空题", "2.（8分）指出二次曲面x^2/4+y^2/9-z^2=1",
     "的名称并说明其类型。", "解："),
    ("m6c_p2p.png", "计算题", "3.（6分）求点P(1,2,3)到平面",
     "x+2y-2z+5=0的距离。", "解："),
    ("m6d_p2l.png", "计算题", "4.（8分）求点P(1,0,2)到直线",
     "x/1=y/1=z/0的距离。", "解："),
    ("m6e_int.png", "计算题", "5.（10分）求直线x-1=y=z与平面",
     "x+y+z=3的交点及夹角。", "解："),
    ("m6f_ang.png", "计算题", "6.（6分）求两平面x+y+z=1与",
     "x-y=0的夹角。", "解："),
    ("m6g_prj.png", "计算题", "7.（10分）求直线(x-1)/1=y/1=z/1",
     "在平面x+y+z=3上的投影方程。", "解："),
    ("m6h_vec.png", "计算题", "8.（8分）设a=(1,2,3)，b=(4,5,6)，",
     "求a·b、a×b及a与b的夹角。", "解："),
    ("m6i_vol.png", "计算题", "9.（6分）设a=(1,0,0)，b=(0,1,0)，c=(0,0,1)，",
     "求以a,b,c为棱的平行六面体体积。", "解："),
    ("m6j_ln2.png", "计算题", "10.（6分）求过点A(1,2,3)与B(4,5,6)",
     "的直线方程。", "解："),
    ("m6k_lpd.png", "计算题", "11.（6分）求过点(1,0,2)且方向向量",
     "为(3,-1,2)的直线方程。", "解："),
    ("m6l_pl3.png", "计算题", "12.（8分）求过点(1,0,0)，(0,1,0)",
     "与(0,0,1)的平面方程。", "解："),
    ("m6m_llr.png", "判断题", "13.（8分）判断直线x/1=y/0=z/0与",
     "x/0=y/1=z/0的位置关系。", "解："),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
