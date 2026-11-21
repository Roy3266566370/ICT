# 已验证运算正确的题图归档

| 轮次 | 图片 | 状态 | engine | task | 答案 |
| --- | --- | --- | --- | --- | --- |
| network | cn1_physical.png | ready | net_physical_v1 |  | 16 种码元对应 4 bit/码元；奈奎斯特最大数据率 = 24 kbps；ASK/FSK/PSK/QAM 分别用幅度/频率/相位/幅度相位组合承载比特 |
| network | cn2_gbn.png | ready | net_window_v1 |  | GBN：发送窗口 W 内可连续发送；接收窗口为 1。若序号空间为 N，必须满足 W ≤ N−1。；GBN 采用累积确认：收到 3 号帧的确认即表示 0–3 号帧 |
| network | cn3_csmacd.png | ready | net_mac_v1 |  | 最远站点距离至少减少 80 m |
| network | cn4_subnet.png | ready | net_ip_v1 |  | 网络地址 192.168.5.0，广播地址 192.168.5.255，可用主机 254 台；划分为 32 个 /29 子网，每子网 6 台可用主机 |
| network | cn5_tcp_seq.png | ready | net_transport_v1 |  | 接收方的确认号为 1000 |
| network | cn6_congestion.png | ready | net_tcp_v1 |  | 第 4 个 RTT 后 cwnd=9 MSS（9 KB），ssthresh=8 MSS |
| round3_math | m3a_surf.png | needs_review | space_v1 | surface_integral |  |
| round3_math | m3b_grn.png | needs_review | space_v1 | green |  |
| round3_math | m3c_gau.png | needs_review | space_v1 | gauss |  |
| round3_math | m3d_stk.png | needs_review | space_v1 | stokes |  |
| round3_math | m3e_sum.png | needs_review | power_series_v1 | power_series |  |
| round3_math | m3f_dir.png | needs_review | sympy | multivariable |  |
| round3_math | m3g_ext.png | needs_review | gradient_descent_v1 |  | 极小值点 (1, 2), f=-5；极大值不存在 |
| round3_math | m3h_ode.png | needs_review | ode_v1 | ode |  |
| round3_math | m3i_mvt.png | needs_review | proof_v1 | proof |  |
| round3_math | m3j_ivt.png | needs_review | proof_v1 | proof |  |
| round3_math | m3k_uni.png | needs_review | proof_v1 | proof |  |
| round3_math | m3l_cyl.png | needs_review | space_v1 | triple_integral |  |
| round4_math | m4a_sph.png | needs_review | space_v1 | triple_integral |  |
| round4_math | m4b_flx.png | needs_review | space_v1 | surface_integral |  |
| round4_math | m4c_ell.png | needs_review | space_v1 | green |  |
| round4_math | m4d_ode.png | needs_review | ode_v1 | ode |  |
| round4_math | m4e_par.png | needs_review | derivative_extra_v1 | parametric_derivative |  |
| round4_math | m4f_arc.png | needs_review | integral_applications_v1 | arc_length |  |
| round4_math | m4g_asy.png | needs_review | limit_extra_v1 | asymptote |  |
| round4_math | m4h_cur.png | needs_review | derivative_extra_v1 | curvature |  |
| round4_math | m4i_leib.png | needs_review | integral_function_v1 | integral_function |  |
| round4_math | m4j_pol.png | needs_review | integral_applications_v1 | polar_area |  |
| round4_math | m4k_hod.png | needs_review | analysis_v1 | higher_derivative |  |
| round4_math | m4l_nor.png | needs_review | sympy | implicit_normal |  |
| round4_math | m4m_parc.png | needs_review | integral_applications_v1 | parametric_arc_length |  |
| round5_math_big | m5a_seq.png | needs_review | analysis_v1 | limit |  |
| round5_math_big | m5b_conv.png | needs_review | series_v1 | series_convergence |  |
| round5_math_big | m5c_rev.png | needs_review | integral_applications_v1 | surface_of_revolution |  |
| round5_math_big | m5d_pal.png | needs_review | integral_applications_v1 | polar_arc_length |  |
| round5_math_big | m5e_std.png | needs_review | analysis_v1 | function_study |  |
| round5_math_big | m5f_tay.png | needs_review | analysis_v1 | taylor |  |
| round5_math_big | m5g_con.png | needs_review | analysis_v1 | limit |  |
| round5_math_big | m5h_geo.png | needs_review | sympy | geometric_area |  |
| round5_math_big | m5i_vol.png | needs_review | sympy | area_volume |  |
| round5_math_big | m5j_int.png | needs_review | antiderivative_v1 |  | F(x)=(x^2 - 2*x + 2)*exp(x)+C |
| round5_math_big | m5k_lim.png | needs_review | analysis_v1 | limit |  |
| round5_math_big | m5l_din.png | needs_review | double_integral_v1 | double_integral |  |
| round5_math_big | m5m_mul.png | needs_review | analysis_v1 | function_study |  |
| round1_math | mt10_di.png | needs_review | double_integral_v1 | double_integral |  |
| round1_math | mt11_ty.png | needs_review | analysis_v1 | taylor |  |
| round1_math | mt12_im.png | needs_review | riemann_v1 |  | 1 |
| round1_math | mt1_lim.png | ready | analysis_v1 | limit | 极限为 1 |
| round1_math | mt2_lim.png | needs_review | analysis_v1 | limit |  |
| round1_math | mt3_der.png | needs_review | tangent_v1 |  | f'(x)=x*(x*cos(x) + 2*sin(x)) |
| round1_math | mt4_tan.png | needs_review | tangent_v1 |  | 切线方程 y=2x-1（斜率 2，过点 (1, 1)） |
| round1_math | mt5_int.png | needs_review | antiderivative_v1 |  | F(x)=(x - 1)*exp(x)+C |
| round1_math | mt6_dfi.png | needs_review | riemann_v1 |  | 0.33333333 |
| round1_math | mt7_ext.png | needs_review | gradient_descent_v1 |  | 极大值点 x=-1，f=2；极小值点 x=1，f=-2；无全局最小值：x→-∞ 时 f→-∞，函数无下界，无全局最小值；无全局最大值：x→+∞ 时 f→+∞，函 |
| round1_math | mt8_ser.png | needs_review | series_v1 | series_convergence |  |
| round1_math | mt9_ode.png | needs_review | ode_v1 | ode |  |
| round2_math | mu10_if.png | needs_review | integral_function_v1 | integral_function |  |
| round2_math | mu11_imp.png | needs_review | derivative_extra_v1 | implicit_derivative |  |
| round2_math | mu12_rot.png | needs_review | sympy | area_volume |  |
| round2_math | mu1_tri.png | needs_review | space_v1 | triple_integral |  |
| round2_math | mu2_line.png | needs_review | line_integral_v1 | line_integral |  |
| round2_math | mu3_pow.png | needs_review | power_series_v1 | power_series |  |
| round2_math | mu4_fou.png | ready | fourier_v1 | fourier_series | Fourier 级数：a0=0；a1=0，b1=2；a2=0，b2=-1；a3=0，b3=2/3；a4=0，b4=-1/2；a5=0，b5=2/5；截断到 n= |
| round2_math | mu5_spa.png | needs_review | space_v1 | space_geometry |  |
| round2_math | mu6_par.png | needs_review | analysis_v1 | limit |  |
| round2_math | mu7_rol.png | needs_review | proof_v1 | proof |  |
| round2_math | mu8_pde.png | needs_review | sympy | multivariable |  |
| round2_math | mu9_lag.png | needs_review | sympy | multivariable_extrema |  |
| os | os1_sched.png | needs_review | os_sched_v1 |  | t=2 时已到达 J1、J2、J3；先来先服务 FCFS选中 J1，短作业优先 SJF（非抢占）选中 J3。（先来先服务 FCFS 全程：平均等待 3，平均周转 |
| os | os2_page.png | ready | os_page_v1 |  | 页置换 5 次；缺页 9 次，命中 3 次，缺页率 75.0%；工作集 Δ=4：最大 4 页，不超过物理块数 4，无明显抖动 |
| os | os3_disk.png | ready | os_disk_v1 |  | 总移动距离 = 281，平均寻道长度 = 35.125；服务顺序 110 → 170 → 180 → 195 → 68 → 45 → 35 → 12 |
| os | os4_banker.png | ready | os_banker_v1 |  | 系统处于不安全状态，找不到安全序列 |
| physics | ph10_energy.png | needs_review | physics_v1 |  | 到达底端速度 v=10 m/s，重力势能减少 50 J，动能增加 50 J。 |
| physics | ph11_ua.png | needs_review | physics_v1 |  | 末速度 v=20 m/s，位移 s=75 m，平均速度 15 m/s。 |
| physics | ph12_ph.png | needs_review | physics_v1 |  | 飞行时间 t=2 s，水平射程 x=30 m，最大高度 20 m，落地速度 25 m/s。 |
| physics | ph13_po.png | needs_review | physics_v1 |  | 飞行时间 t=5 s，水平射程 x=216.5 m，最大高度 31.25 m，落地速度 50 m/s。 |
| physics | ph14_ci.png | needs_review | physics_v1 |  | 向心加速度 a=20 m/s²，向心力 F=10 N，周期 T=1.257 s。 |
| physics | ph15_at.png | needs_review | physics_v1 |  | 加速度大小 5 m/s²（m1 下降、m2 上升），绳张力 T=15 N。 |
| physics | ph16_so.png | needs_review | physics_v1 |  | 周期 T=0.3142 s，频率 f=3.183 Hz，最大速度 2 m/s，总能量 0.5 J。 |
| physics | ph17_pe.png | needs_review | physics_v1 |  | 小角度单摆周期 T=2.007 s，频率 f=0.4982 Hz，最大速度 0.2731 m/s。 |
| physics | ph18_sh.png | needs_review | physics_v1 |  | t=0.5 s 时 x=3.062e-18 m，v=-0.1571 m/s，a=-3.022e-17 m/s²，总能量 0.01234 J。 |
| physics | ph19_co.png | needs_review | physics_v1 |  | 库仑力 F=0.5993 N（吸引）。 |
| physics | ph1_fall.png | needs_review | physics_v1 |  | 落地时间 t=1.429 s，落地速度 v=14 m/s。 |
| physics | ph20_ga.png | needs_review | physics_v1 |  | 球壳在 r=0.4 m 处：E=561.9 N/C，V=224.8 V。 |
| physics | ph21_ki.png | ready | physics_v1 |  | 支路电流 I1=1.909 A，I2=-0.5455 A，I3=1.364 A；电源功率 9.818 W。 |
| physics | ph22_rc.png | needs_review | physics_v1 |  | 充电：τ=0.01 s，t=0.01 s 时 q=56.89 μC，i=0.003311 A，Uc=5.689 V。 |
| physics | ph23_fa.png | needs_review | physics_v1 |  | 感应电动势 ε=0.06 V，感应电流 I=0.06 A，功率 0.0036 W；磁通量增加，感应电流产生的磁场与原磁场反向。 |
| physics | ph24_ra.png | needs_review | physics_v1 |  | 感应电动势 ε=1 V，电流 I=2 A，安培力 F=0.4 N，机械功率 2 W，电功率 2 W。 |
| physics | ph25_th.png | ready | physics_v1 |  | 一般状态变化：P1=1247 Pa，P2=1247 Pa，p2/p1=1，ΔU=6236 J（未给物质的量，按 1 mol 计，比值不受影响）；做功与传热取决于 |
| physics | ph26_tf.png | needs_review | physics_v1 |  | 光程差 Δ=1.33e-6 m（含半波损失 1 次），折算级次 2.717，接近但未严格满足明暗条件。 |
| physics | ph27_ss.png | needs_review | physics_v1 |  | 第一级暗纹衍射角 θ1=0.2865°（≈0.005 rad），中央明纹角宽度 2θ1=0.573°。 |
| physics | ph28_gr.png | needs_review | physics_v1 |  | 第 2 级明纹衍射角 θ=36.87°，光栅最高可见级次 k_max=3，共 7 条主极大。 |
| physics | ph29_pz.png | ready | physics_v1 |  | 第一偏振片后 I1=0.5 W/m²，检偏器后 I2=0.125 W/m²；布儒斯特角 θ_B=56.31°。 |
| physics | ph2_collision.png | ready | physics_v1 |  | 碰后共同速度 v′=2 m/s，总动量守恒，损失动能 ΔEk=3 J。 |
| physics | ph30_rf.png | ready | physics_v1 |  | 折射角 θ2=48.59°；光从光密介质射向光疏介质时临界角 θc=41.81°。 |
| physics | ph31_le.png | needs_review | physics_v1 |  | 像距 v=0.15 m，放大率 m=-0.5，成倒立实像，像高 0.5 m。 |
| physics | ph32_db.png | needs_review | physics_v1 |  | 动量 p=9.11e-25 kg·m/s，德布罗意波长 λ=7.273e-10 m（0.7273 nm）。 |
| physics | ph33_el.png | needs_review | physics_v1 |  | n=3 → n=2 释放光子能量 ΔE=1.889 eV，波长 λ=656.4 nm。 |
| physics | ph34_dc.png | needs_review | physics_v1 |  | 剩余比例 N/N0=12.5%（按 N0=1 归一计算，比值与 N0 无关），衰变常数 λ=1.605e-6 s⁻¹。 |
| physics | ph35_rel.png | needs_review | physics_v1 |  | 甲相对乙的速度 vAB=2 m/s（甲相对乙向前）。 |
| physics | ph36_sw.png | needs_review | physics_v1 |  | 弹簧力 F=20 N，拉力做功 W=1 J，弹性势能 Ep=1 J。 |
| physics | ph37_we.png | needs_review | physics_v1 |  | 合力做功 W=50 J，末速度 v=7.071 m/s，动能变化 ΔEk=50 J。 |
| physics | ph38_im.png | needs_review | physics_v1 |  | 动量变化 Δp=2 kg·m/s，冲量 I=2 N·s，平均力 F=10 N。 |
| physics | ph39_el.png | ready | physics_v1 |  | 碰后速度 v1′=1.333 m/s，v2′=5.333 m/s；动量守恒，动能也守恒。 |
| physics | ph3_lorentz.png | needs_review | physics_v1 |  | 轨道半径 r=0.05688 m，周期 T=3.574e-8 s，洛伦兹力 F=1.6e-15 N，旋转方向逆时针。 |
| physics | ph40_rr.png | needs_review | physics_v1 |  | I=2 kg·m²，角加速度 α=3 rad/s²。 |
| physics | ph41_ro.png | needs_review | physics_v1 |  | 纯滚动加速度 a=3.333 m/s²，底端速度 v=3.651 m/s，平动动能 13.33 J，转动动能 6.667 J。 |
| physics | ph42_wt.png | needs_review | physics_v1 |  | 波速 v=10 m/s，周期 T=0.2 s，相位差 Δφ=3.142 rad；y1=0 m，y2=2.449e-18 m。 |
| physics | ph43_st.png | needs_review | physics_v1 |  | 基频 f1=50 Hz（基波波长 λ1=2L=2 m），波节间距 1 m，波节 2 个，波腹 1 个。 |
| physics | ph44_eg.png | needs_review | physics_v1 |  | n=4 → n=1 释放光子能量 ΔE=12.75 eV，波长 λ=97.24 nm。一群处于 n=4 的氢原子最多发出 6 种谱线，最短波长 97.24 nm |
| physics | ph45_bw.png | needs_review | physics_v1 |  | 布儒斯特角 θ_B=atan(n)=56.31°（入射角为此值时反射光为全偏振光）。 |
| physics | ph46_cv.png | needs_review | physics_v1 |  | 像距 v=-0.06667 m，放大率 m=0.3333，成正立虚像，像高 0.3333 m。 |
| physics | ph47_rd.png | needs_review | physics_v1 |  | 放电：τ=0.01 s，t=0.01 s 时 q=33.11 μC，i=-0.003311 A，Uc=3.311 V。 |
| physics | ph4_doubleslit.png | ready | physics_v1 |  | 介质中波长 λ'=5e-7 m，相邻明纹间距 Δy=0.0025 m，第 1 级明纹位置 y=0.0025 m。 |
| physics | ph5_photoelectric.png | ready | physics_v1 |  | 光子能量 E=4.133 eV，最大初动能 Ek=2.253 eV，遏止电压 Ua=2.253 V，截止波长 λ0=659.5 nm。 |
| physics | ph6_incline.png | needs_review | physics_v1 |  | 沿斜面加速度 a=4.9 m/s²，摩擦力 f=0 N，支持力 N=16.97 N；物体可下滑。 |
| physics | ph7_ampere.png | ready | physics_v1 |  | 安培力 F=1 N（θ=90°）。 |
| physics | ph8_capacitor.png | needs_review | physics_v1 |  | 串联等效电容 Ceq=1.333 μF，电荷 Q=16 μC，U1=8 V，U2=4 V。 |
| physics | ph9_carnot.png | ready | physics_v1 |  | 卡诺效率 η=69.99%，每循环做功 W=1400 J，放热 Qc=600.2 J。 |
| ds408 | q1_stack.png | ready | ds_stack_v1 |  | 出栈过程可达；栈内最多同时 3 个元素，栈的容量至少为 3 |
| ds408 | q2_heap.png | ready | heap_v1 |  | 3, 5, 12, 8, 28, 20, 15, 22, 19 |
| ds408 | q3_bsearch.png | ready | ds_search_v1 |  | 折半查找（n=16）：ASL成功 = 54/16 = 3.375，ASL失败 = 87/17 ≈ 5.12，最坏比较 5 次 |
| round6_math_space | m6a_tan.png | needs_review | surface_tangent |  |
| round6_math_space | m6b_qua.png | needs_review | quadric_surface |  |
| round6_math_space | m6c_p2p.png | ready | point_plane_distance | 点到平面距离 4/3 |
| round6_math_space | m6d_p2l.png | ready | point_line_distance | 点到直线距离 3*sqrt(2)/2 |
| round6_math_space | m6e_int.png | needs_review | line_plane_relation |  |
| round6_math_space | m6f_ang.png | needs_review | plane_plane_relation |  |
| round6_math_space | m6g_prj.png | needs_review | line_plane_projection |  |
| round6_math_space | m6h_vec.png | needs_review | vector_operations |  |
| round6_math_space | m6i_vol.png | needs_review | vector_products |  |
| round6_math_space | m6j_ln2.png | needs_review | line_from_points |  |
| round6_math_space | m6k_lpd.png | needs_review | line_point_direction |  |
| round6_math_space | m6l_pl3.png | needs_review | plane_three_points |  |
| round6_math_space | m6m_llr.png | ready | line_line_relation | 两直线相交，交点 (0, 0, 0)，夹角 pi/2 |
| round7_math_linalg | m7a_d2.png | ready | gauss_v1 | determinant | det(A) = -2 |
| round7_math_linalg | m7b_d3.png | ready | gauss_v1 | determinant | det(A) = 1 |
| round7_math_linalg | m7c_dex.png | ready | gauss_v1 | determinant | det(A) = 4 |
| round7_math_linalg | m7d_inv.png | needs_review | gauss_v1 | inverse | A⁻¹ = [-2, 1; 1.5, -0.5] |
| round7_math_linalg | m7e_mul.png | needs_review | matmul_v1 | matmul | A·B = [19, 22; 43, 50] |
| round7_math_linalg | m7f_add.png | needs_review | matmul_v1 | matmul | A+B = [6, 8; 10, 12] |
| round7_math_linalg | m7g_sub.png | needs_review | matmul_v1 | matmul | A−B = [-4, -4; -4, -4] |
| round7_math_linalg | m7h_sca.png | needs_review | matmul_v1 | matmul | kA = [3, 6; 9, 12] |
| round7_math_linalg | m7i_sys.png | needs_review | gauss_v1 | linear_system | x = 1，y = 2，z = 3 |
| round7_math_linalg | m7j_sy2.png | needs_review | gauss_v1 | linear_system | x = 2，y = 1 |
| round7_math_linalg | m7k_noi.png | needs_review | gauss_v1 | determinant | det(A) = 0（奇异，不可逆判定证据） |
| round7_math_linalg | m7l_rec.png | needs_review | matmul_v1 | matmul | A·B = [4, 5; 10, 11]（2×3·3×2） |
| round7_math_linalg | m7m_eig.png | needs_review | gauss_v1 | eigen（诚实阻塞，无本地内核） | 无答案（保留已识别矩阵供核对，未静默给错答） |


## round7b_math_series_ode —— 高数第七轮·第二部分（级数细节 + ODE 进阶，13 题）

图片识别 → 公式确认门（needs_review，设计行为）；下列答案经本地同文本路径验证全部正确。

| 文件 | engine·task | 本地答案 | OCR 变体 |
| --- | --- | --- | --- |
| m7n_rat | series_v1·series_convergence | 绝对收敛（比值法 n!/n^n） | Σ 整吞 |
| m7o_rot | series_v1·series_convergence | 绝对收敛（根值法） | Σ→E |
| m7p_lei | series_v1·series_convergence | 条件收敛（Leibniz） | Σ→E, ln→In, 全角） |
| m7q_cmp | series_v1·series_convergence | 发散（比较法） | 全角） |
| m7r_plg | series_v1·series_convergence | 发散（积分判别 1/(n ln n)） | ln→In, 全角） |
| m7s_rad | power_series_v1·radius_interval | R=1, [-1,1)；x=-1 收敛 x=1 发散 | Σ 整吞 |
| m7t_sum | power_series_v1·sum_function | S(x)=-ln(1-x)/x | 全角） |
| m7u_exp | power_series_v1·expand | 1+2x+3x²+4x³+5x⁴+O(x⁵) | x→× |
| m7v_nh | ode_v1·nonhomogeneous | y=(C1+C2·eˣ-x)·eˣ | y²→y² |
| m7w_res | ode_v1·resonance | y=C2·sin x+(C1-x/2)·cos x | sinx 连写 |
| m7x_eul | ode_v1·euler | y=C1/x+C2·x | x²y² 连写 |
| m7y_3rd | ode_v1·third_order | y=C1+C2·x+C3·eˣ | ‴→口 |
| m7z_ivp | ode_v1·ivp | y=(eˣ+e⁻ˣ)/2，y(0)=1,y'(0)=0 验证 | 双初值 |

本轮修复的 OCR 缺陷：全角括号归一、ln→In 误读归一（series+质量门豁免）、y口→y三阶导、index_start=2 起算。


## round8_math_fourier_parametric —— 高数第八轮（傅里叶/参数方程/极坐标/瑕积分/反函数导数，13 题）

图片识别 → 公式确认门（needs_review，设计行为）；下列答案经本地同文本路径验证全部正确。

| 文件 | engine·task | 本地答案 | 说明 |
| --- | --- | --- | --- |
| m8a_fx2 | fourier_v1·fourier_series | a0=2π²/3, an=4(-1)ⁿ/n² | x² 偶函数 |
| m8b_fx | fourier_v1·fourier_series | bn=2(-1)ⁿ⁺¹/n | x 奇函数正弦级数 |
| m8c_fabs | fourier_v1·fourier_series | a0=π, an=-4/(πn²)奇数项 | \|x\|→abs 归一 |
| m8d_pd | derivative_extra_v1·parametric_derivative | t=π/2 处斜率 1 | sint/cost 黏连+t=π/2 符号点 |
| m8e_pd2 | derivative_extra_v1·parametric_derivative | d²y/dx²=3/(4t)，t=1→3/4 | d²y/dx² 识别 |
| m8f_pa | manual_v1·parametric_derivative | **诚实阻塞**：缺研究点 t=t0 | a 参数亦不支持；不落 tangent 兜底 |
| m8g_parc | manual_v1·parametric_arc_length | **诚实阻塞**：内核无初等原函数（∫\|sin(t/2)\|） | 摆线一拱弧长已知局限 |
| m8h_card | integral_applications_v1·polar_area | 3π/2 | 心形线约定 [0,2π] |
| m8i_rose | integral_applications_v1·polar_area | π/12 | OCR: θE→θ∈、-T/6→-pi/6 |
| m8j_impp | riemann_v1·integral | 1 | OCR: ∫→{ 括号区间记法 |
| m8k_impd | riemann_v1·integral | 2 | OCR: ∫→{ + dx前置+√ |
| m8l_pdis | riemann_v1·integral | **诚实阻塞**：符号参数 p 不支持 | ∫→{ 已修复，内核按无穷区间截断展示 |
| m8m_invd | tangent_v1·inverse_derivative | (f⁻¹)'(2)=1/4 | 在y=2 定点反函数导数 |

本轮修复：∫→{（质量门+解析双处）、∫(a,b)/∫(a,b)dx/f 记法、sint 黏连、t=π/2 符号点、d²y、缺研究点阻塞、心形线约定区间、cos3θ、θE/π→T 误读、|x|→abs、CJK 表达式截断、dx/f=1/f 语义。
