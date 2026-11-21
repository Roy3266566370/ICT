"""Render 12 advanced-mathematics exam questions as PNG screenshots (round 3)."""
from make_math_images import render

Q = [
    ("m3a_surf.png", "曲面积分", "1. 计算曲面积分∬_Σ z dS，其中Σ为",
     "平面z=x+y在0≤x≤1，0≤y≤1上的部分（ ）。",
     "A. 1       B. √3      C. 2√3     D. 3"),
    ("m3b_grn.png", "曲线积分", "2. 利用格林公式计算∮_L (x^2-y)dx",
     "+(x+y^2)dy，L为圆周x^2+y^2=1取正向（ ）。",
     "A. π       B. 2π      C. 3π      D. 4π"),
    ("m3c_gau.png", "曲面积分", "3. 利用高斯公式计算∯_Σ x dy dz+y",
     "dz dx+z dx dy，Σ为正方体0≤x≤1，0≤y≤1，",
     "0≤z≤1的表面外侧（ ）。 A.1 B.2 C.3 D.4"),
    ("m3d_stk.png", "曲线积分", "4. 利用斯托克斯公式计算∮_Γ (-y)dx",
     "+x dy+z dz，Γ为平面z=1上正方形0≤x≤1，",
     "0≤y≤1的边界取上侧（ ）。 A.0 B.1 C.2 D.4"),
    ("m3e_sum.png", "级数", "5. 求幂级数∑n·x^n的和函数（ ）。",
     "", "A. x/(1-x)^2  B. 1/(1-x)^2 C. x/(1-x) D. 1/(1-x)"),
    ("m3f_dir.png", "多元微分", "6. 求函数z=x^2+y^2在点(1,1)",
     "沿方向(3,4)的方向导数（ ）。",
     "A. 2       B. 5/2     C. 14/5    D. 4"),
    ("m3g_ext.png", "多元极值", "7. 求函数f(x,y)=x^2+y^2-2x-4y",
     "的极值（ ）。",
     "A. -5      B. -4      C. 0       D. 5"),
    ("m3h_ode.png", "微分方程", "8. 求微分方程y''-3y'+2y=0的通解（ ）。",
     "", "A. C1e^x+C2e^2x   B. (C1+C2x)e^x"),
    ("m3i_mvt.png", "中值定理", "9. f(x)=x^2在[1,2]上满足拉格朗日中值",
     "定理，则ξ等于（ ）。",
     "A. 1       B. 3/2     C. 2       D. 5/2"),
    ("m3j_ivt.png", "中值定理", "10. 证明方程x^3-4x+1=0在区间(0,1)",
     "内至少有一个实根。",
     "A. 正确    B. 错误"),
    ("m3k_uni.png", "中值定理", "11. 证明方程x^3+x-1=0在区间[0,1]",
     "内有唯一实根。",
     "A. 正确    B. 错误"),
    ("m3l_cyl.png", "重积分", "12. 计算三重积分∭_Ω z dV，Ω由圆柱面",
     "x^2+y^2=1与平面z=0,z=1围成（ ）。",
     "A. π/4     B. π/2     C. π       D. 2π"),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
