"""Render 12 advanced-mathematics exam questions as PNG screenshots (round 2)."""
from make_math_images import render

Q = [
    ("mu1_tri.png", "重积分", "1. 计算三重积分∭_Ω (x+y+z)dxdydz，",
     "其中Ω为0≤x≤1，0≤y≤1，0≤z≤1（ ）。",
     "A. 1       B. 3/2     C. 2       D. 3"),
    ("mu2_line.png", "曲线积分", "2. 计算曲线积分∫_L x dy + y dx，",
     "其中L为y=x^2从(0,0)到(1,1)（ ）。",
     "A. 1/2     B. 1       C. 3/2     D. 2"),
    ("mu3_pow.png", "级数", "3. 求幂级数∑x^n/n的收敛半径（ ）。",
     "", "A. 0       B. 1/2     C. 1       D. 2"),
    ("mu4_fou.png", "级数", "4. 将f(x)=x在[-π,π]上展开为傅里叶",
     "级数，其系数b1等于（ ）。",
     "A. 0       B. 1       C. 2       D. π"),
    ("mu5_spa.png", "空间几何", "5. 求过点(1,2,3)且与平面2x+y-z=1",
     "平行的平面方程（ ）。",
     "A. 2x+y-z=1 B. 2x+y-z=0 C. x+2y-z=1 D. 2x+y+z=9"),
    ("mu6_par.png", "极限", "6. 已知lim(x→0) sin(ax)/x = 2，",
     "则参数a等于（ ）。",
     "A. 1/2     B. 1       C. 2       D. 4"),
    ("mu7_rol.png", "中值定理", "7. 函数f(x)=x^2-4在[-2,2]上满足罗尔",
     "定理条件，则ξ等于（ ）。",
     "A. -1      B. 0       C. 1       D. 2"),
    ("mu8_pde.png", "多元微分", "8. 设z=x^2·y+y^3，求偏导数∂z/∂x（ ）。",
     "", "A. 2xy     B. x^2+3y^2 C. 2x      D. xy"),
    ("mu9_lag.png", "多元极值", "9. 求f(x,y)=xy在约束x+y=1下的",
     "最大值（ ）。",
     "A. 1/8     B. 1/4     C. 1/2     D. 1"),
    ("mu10_if.png", "积分", "10. 设F(x)=∫_0^x t^2 dt，则F'(2)=（ ）。",
     "", "A. 2       B. 4       C. 8/3     D. 8"),
    ("mu11_imp.png", "隐函数", "11. 设y由方程x^2+y^2=4确定，",
     "则在点(√2,√2)处dy/dx=（ ）。",
     "A. -1      B. 0       C. 1       D. √2"),
    ("mu12_rot.png", "定积分应用", "12. 求曲线y=x^2在[0,1]上绕x轴",
     "旋转所得旋转体体积（ ）。",
     "A. π/3     B. π/4     C. π/5     D. π/2"),
]


def main():
    for args in Q:
        print(render(*args))


if __name__ == "__main__":
    main()
