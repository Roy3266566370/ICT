# -*- coding: utf-8 -*-
"""Render 13 advanced-mathematics exam questions as PNG screenshots (round 4)."""
from make_math_images import render

Q = [
    ("m4a_sph.png", "三重积分", "1. 计算三重积分∭_Ω dxdydz，Ω为球体",
     "x^2+y^2+z^2≤1（ ）。",
     "A. π       B. 4π/3    C. 2π      D. 4π"),
    ("m4b_flx.png", "曲面积分", "2. 计算曲面积分∬_Σ x dy dz+y dz dx",
     "+z dx dy，Σ为平面z=1在0≤x≤1，",
     "0≤y≤1部分的上侧（ ）。 A.1 B.2 C.3 D.4"),
    ("m4c_ell.png", "曲线积分", "3. 利用格林公式计算∮_L (-y)dx+x dy，",
     "L为椭圆x^2/4+y^2=1取正向（ ）。",
     "A. 2π      B. 4π      C. 6π      D. 8π"),
    ("m4d_ode.png", "微分方程", "4. 求微分方程y'-y=0满足y(0)=2",
     "的特解（ ）。",
     "A. e^x     B. 2e^x    C. e^x+1   D. 2e^(-x)"),
    ("m4e_par.png", "参数求导", "5. 设x=t^2，y=t^3，求在t=1处",
     "dy/dx的值（ ）。",
     "A. 1       B. 3/2     C. 2       D. 3"),
    ("m4f_arc.png", "积分应用", "6. 求曲线y=x^(3/2)在[0,4]上",
     "的弧长（ ）。",
     "A. 8       B. 9.07    C. 10      D. 12"),
    ("m4g_asy.png", "函数性态", "7. 求函数y=(2x+1)/(x-1)",
     "的渐近线（ ）。",
     "A. x=1,y=2 B. x=2,y=1 C. x=-1   D. 无"),
    ("m4h_cur.png", "导数应用", "8. 求曲线y=x^2在点(1,1)处",
     "的曲率（ ）。",
     "A. 2/(5√5) B. 1/√5    C. 2√5     D. 1"),
    ("m4i_leib.png", "变限积分", "9. 设F(x)=∫_x^{x^2} t dt，",
     "求F'(x)（ ）。",
     "A. 2x^3-x  B. x^2     C. 2x^3    D. x^3"),
    ("m4j_pol.png", "积分应用", "10. 求曲线r=2cosθ所围图形的面积，",
     "θ∈[-π/2,π/2]（ ）。",
     "A. π/2     B. π       C. 2π      D. 4π"),
    ("m4k_hod.png", "高阶导数", "11. 设y=sin(2x)，求y的三阶",
     "导数（ ）。",
     "A. 8cos2x  B. -8cos2x C. -4cos2x D. 8sin2x"),
    ("m4l_nor.png", "隐函数", "12. 求曲线x^2+y^2=4在点(√2,√2)",
     "处的法线方程（ ）。",
     "A. y=x     B. y=-x    C. x+y=2  D. y=1"),
    ("m4m_parc.png", "积分应用", "13. 求参数曲线x=cos t，y=sin t",
     "在0≤t≤2π上的弧长（ ）。",
     "A. π       B. 2π      C. 4π      D. 1"),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
