# -*- coding: utf-8 -*-
"""Render 13 series/ODE questions as PNG (round 7 continued: n-z)."""
from functools import partial

from make_math_images import render as _render

render = partial(_render, title="高等数学期末试卷", font_size=26, heading_size=22)

Q = [
    ("m7n_rat.png", "计算题", "14.（8分）判断级数 Σ n!/n^n 的敛散性。", "", "解："),
    ("m7o_rot.png", "计算题", "15.（8分）用根值判别法判断级数 Σ(n/(2n+1))^n 的敛散性。", "", "解："),
    ("m7p_lei.png", "讨论题", "16.（8分）判断级数 Σ(-1)^n/(n lnn)（n=2起）的敛散性，",
     "是绝对收敛还是条件收敛？", "解："),
    ("m7q_cmp.png", "计算题", "17.（6分）判断级数 Σ n/(n^2+1) 的敛散性。", "", "解："),
    ("m7r_plg.png", "计算题", "18.（8分）判断级数 Σ 1/(n lnn)（n=2起）的敛散性。", "", "解："),
    ("m7s_rad.png", "计算题", "19.（8分）求幂级数 Σ x^n/n 的收敛半径与收敛区间，",
     "并判断端点敛散性。", "解："),
    ("m7t_sum.png", "计算题", "20.（10分）求幂级数 Σ x^n/(n+1) 的和函数。", "", "解："),
    ("m7u_exp.png", "计算题", "21.（8分）将函数 f(x)=1/(1-x)^2 展开为 x 的幂级数",
     "（到 x^4 项）。", "解："),
    ("m7v_nh.png",  "计算题", "22.（10分）求微分方程 y″-3y′+2y=e^x 的通解。", "", "解："),
    ("m7w_res.png", "计算题", "23.（10分）求微分方程 y″+y=sinx 的通解。", "", "解："),
    ("m7x_eul.png", "计算题", "24.（8分）求欧拉方程 x^2 y″+x y′-y=0 的通解。", "", "解："),
    ("m7y_3rd.png", "计算题", "25.（8分）求微分方程 y‴-y″=0 的通解。", "", "解："),
    ("m7z_ivp.png", "计算题", "26.（8分）求微分方程 y″-y=0 满足 y(0)=1, y′(0)=0 的特解。", "", "解："),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
