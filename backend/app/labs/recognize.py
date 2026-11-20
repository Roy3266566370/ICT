"""题目识别与统一模型编译（本地规则版）。

本模块只做三件事：

1. 把来源页拆成"一道完整题目"：题号切分、跨页续写合并、保留原页来源；
2. 按科目提取条件、公式、数据和可交互参数；关键条件无法确定时生成明确问题，
   而不是猜测后直接求解；
3. 生成四类确定性模型（微积分 / 最优化 / 数据结构与算法 / 深度学习）。

模型不使用模型生成的任意代码。表达式由 :mod:`app.labs.expr` 白名单解析；
题目未提供的数据使用 ``teaching`` / ``supplement`` 标记，原题文本始终保留。
"""

from __future__ import annotations

import ast
import json
import math
import re
from typing import Any, Iterable, Mapping, Sequence

import sympy as sp

from .expr import ExprError, expression_text, parse_expression, safe_float, to_latex

SUBJECT_LABELS = {
    "calculus": "微积分",
    "optimization": "最优化",
    "algorithm": "数据结构与算法",
    "deep_learning": "深度学习",
    "linear_algebra": "线性代数",
    "operating_system": "操作系统",
    "computer_organization": "计算机组成原理",
    "computer_network": "计算机网络",
    "physics": "大学物理",
    "general": "通用",
    "unknown": "待选择",
}

SUBJECT_KEYWORDS: dict[str, tuple[tuple[str, int], ...]] = {
    "physics": (
        ("质点", 8), ("运动学", 10), ("匀变速", 10), ("自由落体", 10), ("自由落下", 10), ("平抛", 10), ("斜抛", 10),
        ("抛体", 9), ("相对运动", 9), ("牛顿", 9), ("受力", 8), ("斜面", 8), ("摩擦", 7),
        ("连接体", 9), ("滑轮", 8), ("圆周运动", 9), ("向心", 9), ("动能", 8), ("势能", 8),
        ("机械能", 9), ("弹簧", 7), ("劲度系数", 9), ("动量", 9), ("冲量", 9), ("冲力", 8), ("碰撞", 9),
        ("弹性碰撞", 10), ("非弹性碰撞", 10), ("振动", 8), ("单摆", 9), ("弹簧振子", 10),
        ("简谐", 9), ("振幅", 8), ("重力加速度", 9), ("加速度", 6), ("速度", 5),
        ("位移", 5), ("质量", 4), ("功", 4), ("仰角", 8), ("抛射角", 8), ("相对地面", 8),
        ("合力", 5), ("光滑", 4), ("高度", 5), ("重力势能", 8), ("弹性势能", 8), ("相对", 3),
        ("刚体", 10), ("转动惯量", 10), ("力矩", 8), ("角动量", 9), ("纯滚动", 10), ("定轴转动", 10),
        ("机械波", 10), ("行波", 9), ("波长", 8), ("驻波", 10), ("波节", 9), ("波腹", 9), ("波速", 8), ("相位差", 8),
        ("库仑", 10), ("点电荷", 9), ("电场", 7), ("电势", 8), ("高斯定理", 10), ("高斯面", 10), ("高斯定律", 10), ("球壳", 9), ("带电球", 9),
        ("电容", 8), ("电容器", 10), ("串联", 6), ("并联", 6), ("基尔霍夫", 10), ("双回路", 9), ("支路电流", 9), ("回路", 5), ("时间常数", 8), ("充电", 7), ("放电", 7),
        ("洛伦兹", 10), ("安培力", 10), ("带电粒子", 9), ("轨道半径", 8), ("磁感应强度", 9), ("磁场", 6),
        ("磁通量", 10), ("法拉第", 10), ("楞次", 9), ("感应电动势", 10), ("切割磁感线", 10), ("导体棒", 9),
        ("理想气体", 10), ("等温", 9), ("等压", 9), ("等容", 9), ("绝热", 10), ("卡诺", 10), ("热机", 9), ("热力学", 9),
        ("双缝", 10), ("干涉", 9), ("薄膜", 8), ("增透膜", 10), ("增反膜", 10), ("衍射", 10), ("单缝", 9),
        ("光栅", 10), ("偏振", 10), ("马吕斯", 10), ("布儒斯特", 10),
        ("折射", 9), ("全反射", 10), ("临界角", 9), ("透镜", 9), ("成像", 8), ("焦距", 8), ("物距", 8), ("像距", 8),
        ("光电效应", 10), ("逸出功", 10), ("遏止电压", 10), ("德布罗意", 10), ("物质波", 9),
        ("能级", 9), ("跃迁", 9), ("光谱线", 9), ("放射性", 9), ("半衰期", 10), ("衰变", 9),
    ),
    "deep_learning": (
        ("神经网络", 8), ("反向传播", 8), ("损失函数", 7), ("softmax", 7),
        ("卷积", 6), ("激活函数", 6), ("多层感知", 7), ("mlp", 5),
        ("张量", 4), ("梯度下降", 2), ("权重", 3), ("偏置", 3), ("学习率", 2),
        ("neural network", 8), ("backprop", 8), ("loss function", 7),
        ("activation", 5), ("epoch", 4), ("tensor", 4),
    ),
    "algorithm": (
        ("大根堆", 9), ("小根堆", 9), ("最大堆", 9), ("最小堆", 9), ("堆顶", 8),
        ("广度优先", 8), ("bfs", 8), ("队列", 6), ("邻接", 5), ("图搜索", 7),
        ("最短路径", 7), ("遍历", 4), ("二叉", 5), ("算法", 3), ("节点", 3),
        ("边", 2), ("栈", 3), ("dfs", 5), ("复杂度", 4),
        ("时间复杂度", 7), ("空间复杂度", 7), ("执行次数", 6), ("执行频度", 6), ("语句频度", 6),
        ("入栈", 6), ("出栈", 6), ("压栈", 5), ("合法出栈", 8),
        ("双端队列", 8), ("循环队列", 7), ("顺序队列", 7), ("队头", 5), ("队尾", 5),
        ("入队", 6), ("出队", 6),
        ("括号匹配", 8), ("中缀", 5), ("后缀", 5), ("逆波兰", 6), ("表达式", 3),
        ("递归", 5), ("递归调用", 6), ("调用栈", 6),
        ("模式匹配", 8), ("朴素匹配", 7), ("kmp", 8), ("next数组", 8), ("nextval", 8), ("主串", 6), ("模式串", 6),
        ("逆置", 6), ("顺序表", 7), ("单链表", 8), ("双向链表", 8), ("循环链表", 7), ("链表", 6), ("去重", 5), ("有序表", 5),
        ("对称矩阵", 9), ("三角矩阵", 9), ("三对角", 9), ("压缩存储", 9), ("三元组", 7), ("稀疏矩阵", 9),
        ("地址计算", 7), ("首地址", 6), ("循环", 4), ("数组", 5), ("行优先", 6), ("列优先", 6),
        ("哈夫曼", 8), ("并查集", 8), ("带权路径", 7), ("WPL", 7),
        ("最小生成树", 8), ("Prim", 8), ("Kruskal", 8), ("Dijkstra", 8), ("Floyd", 8),
        ("拓扑", 7), ("关键路径", 8), ("AOE", 8),
        ("二叉排序树", 8), ("AVL", 7), ("平衡二叉树", 7), ("B树", 8), ("B+树", 8),
        ("邻接矩阵", 8), ("邻接表", 8),
        ("散列", 8), ("哈希", 8), ("判定树", 7), ("ASL", 7),
        ("先序", 5), ("中序", 5), ("后序", 5), ("层序", 5), ("线索", 6), ("排序", 5), ("稳定性", 4),
        ("breadth-first", 8), ("queue", 6), ("adjacency", 5),
        ("shortest path", 7), ("binary tree", 5), ("algorithm", 3),
    ),
    "calculus": (
        ("面积", 6), ("体积", 6), ("旋转体", 7), ("法线", 8), ("斜率", 5), ("隐函数", 7),
        ("定积分", 8), ("不定积分", 7), ("积分", 6), ("导数", 7), ("微分", 6),
        ("极限", 6), ("切线", 5), ("∫", 8), ("\\int", 8), ("曲边", 4),
        ("原函数", 6), ("d x", 3), ("dx", 3), ("连续", 2), ("间断点", 5),
        ("泰勒", 7), ("麦克劳林", 7), ("高阶导数", 7), ("单调区间", 8), ("单调", 5), ("微分方程", 9),
        ("级数", 9), ("幂级数", 9), ("傅里叶", 9), ("罗尔定理", 9), ("拉格朗日", 7),
        ("介值定理", 9), ("零点", 6), ("有根", 6),
        ("三重积分", 9), ("二重积分", 9), ("曲线积分", 9), ("曲面积分", 9),
        ("空间解析几何", 9), ("平面方程", 8), ("直线方程", 8), ("法向量", 7),
        ("偏导", 8), ("方向导数", 8), ("条件极值", 8), ("变限积分", 9),
        ("f(x,y)", 8), ("f(x, y)", 8), ("约束", 4),
        ("∬", 8), ("∭", 8), ("∂", 6),
        ("高斯公式", 9), ("奥高公式", 9), ("斯托克斯", 9), ("格林公式", 9),
        ("∯", 8), ("∮", 8), ("中值定理", 8), ("实根", 7),
        ("圆柱面", 9), ("柱坐标", 9),
        ("凹凸", 6), ("拐点", 6), ("渐近线", 6), ("函数研究", 8),
        ("弧长", 8), ("曲率", 8), ("参数方程", 8), ("极坐标", 8),
        ("心形线", 7), ("摆线", 7), ("球面", 6), ("球体", 6), ("通量", 7),
        ("切平面", 8), ("法平面", 8), ("二次曲面", 9), ("曲面", 5),
        ("椭球", 8), ("双曲面", 8), ("抛物面", 8), ("锥面", 7),
        ("点到平面", 9), ("点到直线", 9), ("到平面", 8), ("到直线", 8),
        ("两平面", 7), ("两直线", 7),
        ("位置关系", 6), ("投影", 4), ("方向向量", 7), ("数量积", 8),
        ("向量积", 8), ("混合积", 8), ("平行六面体", 8), ("向量", 4),
        ("夹角", 4), ("点法式", 7), ("对称式", 5),
        ("integral", 8), ("derivative", 7), ("differentiate", 6),
        ("limit", 5), ("tangent", 5), ("antiderivative", 6),
    ),
    "optimization": (
        ("极值", 8), ("驻点", 6),
        ("梯度下降", 7), ("最小值", 6), ("最大值", 5), ("最优解", 7),
        ("目标函数", 8), ("约束", 6), ("初始点", 6), ("迭代", 5),
        ("收敛", 4), ("可行域", 5), ("学习率", 5), ("极小", 5), ("极大", 4),
        ("gradient descent", 8), ("minimum", 6), ("maximum", 5),
        ("optimal", 7), ("objective", 8), ("constraint", 6),
        ("learning rate", 6), ("initial point", 6), ("iteration", 5),
    ),
    "linear_algebra": (
        ("线性代数", 10), ("矩阵", 8), ("行列式", 9), ("逆矩阵", 9), ("逆阵", 8),
        ("线性方程组", 9), ("方程组", 6), ("增广矩阵", 8), ("高斯消元", 9), ("消元", 5),
        ("矩阵乘法", 8), ("矩阵运算", 7), ("数乘", 6), ("主元", 6), ("特征值", 4),
        ("matrix", 7), ("determinant", 8), ("inverse", 7), ("gauss", 7),
        ("linear system", 8), ("linear algebra", 9), ("matmul", 6),
    ),
    "operating_system": (
        ("操作系统", 10), ("进程调度", 10), ("作业调度", 9), ("cpu调度", 9), ("处理机调度", 9),
        ("先来先服务", 8), ("短作业优先", 9), ("最短剩余时间", 9), ("时间片轮转", 10), ("时间片", 8),
        ("周转时间", 9), ("带权周转", 9), ("等待时间", 6), ("到达时间", 7), ("服务时间", 6), ("甘特图", 7),
        ("高响应比", 10), ("响应比", 9), ("HRRN", 9),
        ("进程", 7), ("优先级调度", 8),
        ("页面置换", 10), ("缺页", 9), ("页框", 8), ("物理块", 8), ("页面访问", 8), ("置换算法", 8),
        ("最佳置换", 9), ("最近最久", 9), ("页面走向", 9), ("引用串", 8),
        ("磁盘调度", 10), ("磁头", 8), ("寻道", 9), ("磁道", 8), ("柱面", 8), ("电梯算法", 9),
        ("银行家", 10), ("安全序列", 10), ("安全状态", 9), ("死锁", 8), ("allocation", 6), ("available", 5),
        ("operating system", 10), ("page fault", 9), ("page replacement", 10), ("round robin", 9),
        ("turnaround", 9), ("disk scheduling", 10), ("banker", 10), ("deadlock", 8),
        ("fcfs", 5), ("sjf", 7), ("srtf", 8), ("sstf", 8), ("c-scan", 7), ("lru", 5),
        ("内核态", 10), ("用户态", 10), ("管态", 8), ("系统调用", 9), ("访管", 8),
        ("中断", 6), ("异常", 6), ("陷阱", 8), ("微内核", 9), ("宏内核", 8), ("原语", 7),
        ("PCB", 9), ("进程控制块", 9), ("进程状态", 9), ("就绪态", 8), ("阻塞态", 8), ("唤醒", 8),
        ("线程", 8), ("用户级线程", 9), ("内核级线程", 9),
        ("信号量", 10), ("P操作", 9), ("V操作", 9), ("临界区", 9), ("互斥锁", 8),
        ("生产者", 8), ("消费者", 8), ("读者", 7), ("写者", 7), ("哲学家", 9),
        ("死锁", 10), ("资源分配图", 9), ("死锁预防", 9), ("死锁避免", 9), ("死锁检测", 9),
        ("死锁解除", 9), ("循环等待", 7), ("占有并等待", 8), ("非抢占", 7),
        ("首次适应", 10), ("最佳适应", 10), ("最坏适应", 10), ("邻近适应", 9),
        ("空闲分区", 9), ("空闲区", 8), ("连续分配", 9), ("内碎片", 8), ("外碎片", 8), ("内存利用率", 8),
        ("虚拟内存", 10), ("请求分页", 10), ("工作集", 10), ("抖动", 9), ("时钟置换", 9),
        ("缺页率", 8), ("页表项", 8), ("Belady", 9),
        ("有效访问时间", 10), ("页表访问次数", 10), ("页表访问", 8), ("地址转换", 10), ("缺页开销", 9),
        ("TLB命中率", 12), ("TLB", 8), ("快表", 8),
        ("文件系统", 8), ("文件目录", 8), ("目录项", 9), ("路径名", 8), ("FCB", 9),
        ("文件控制块", 9), ("inode", 9), ("索引结点", 9), ("文件权限", 9), ("权限位", 9),
        ("硬链接", 9), ("软链接", 9), ("符号链接", 9), ("文件描述符", 8), ("打开文件表", 8),
        ("文件打开", 9), ("文件读写", 9), ("文件关闭", 8), ("文件共享", 9), ("文件", 5), ("目录", 5),
        ("文件存储", 9), ("文件逻辑结构", 9), ("目录结构", 8), ("路径查找", 9),
        ("文件分配表", 10), ("FAT表", 10), ("位示图", 9), ("索引分配", 9), ("链接分配", 9),
        ("多级索引", 8), ("一级间接", 8), ("二级间接", 8), ("三级间接", 8), ("最大文件", 8),
        ("盘块", 7), ("磁盘块", 7),
        ("磁盘访问时间", 10), ("旋转延迟", 9), ("传输时间", 8), ("单缓冲", 9), ("双缓冲", 9),
        ("假脱机", 10), ("设备分配", 9), ("设备管理", 9), ("SPOOLing", 10), ("缓冲池", 8), ("缓冲", 8),
    ),
    "computer_organization": (
        ("计算机组成原理", 12), ("组成原理", 10), ("CPU执行时间", 10), ("CPU 执行时间", 10),
        ("主频", 9), ("时钟周期", 9), ("CPI", 9), ("MIPS", 8), ("指令数", 6), ("指令条数", 6),
        ("加速比", 9), ("性能比较", 7), ("进制转换", 9), ("进制", 5), ("二进制", 7), ("十六进制", 6),
        ("八进制", 5), ("十进制", 6), ("原码", 9), ("反码", 9), ("补码", 9),
        ("移码", 9), ("符号扩展", 9), ("有符号数", 7), ("无符号数", 7),
        ("溢出", 6), ("算术移位", 9), ("逻辑移位", 9), ("循环移位", 8), ("补码加", 8), ("补码减", 8),
        ("乘法", 5), ("除法", 5), ("乘除", 7), ("Booth", 8), ("恢复余数", 8),
        ("浮点数", 8), ("IEEE", 10), ("754", 9), ("单精度", 8), ("双精度", 8), ("阶码", 8), ("尾数", 7),
        ("规格化", 8), ("舍入", 6), ("上溢", 7), ("下溢", 7),
        ("ALU", 10), ("算术逻辑单元", 9), ("加法器", 7), ("寄存器", 8), ("寄存器传送", 9),
        ("多路选择器", 9),
        ("数据通路", 9), ("控制信号", 7), ("MUX", 8), ("数据选择器", 8),
        ("存储容量", 9), ("地址线", 7), ("数据线", 6), ("字扩展", 9), ("位扩展", 9),
        ("芯片", 5), ("交叉编址", 9), ("主存", 7), ("存储器", 7),
        ("Cache", 9), ("缓存", 7), ("组相联", 9), ("直接映射", 8), ("全相联", 8),
        ("命中率", 8), ("替换策略", 7), ("写直达", 8), ("写回", 7),
        ("虚拟存储", 10), ("虚拟地址", 9), ("页表", 9), ("TLB", 9), ("快表", 8),
        ("页框", 8), ("虚实地址", 9), ("物理地址", 7),
        ("指令格式", 9), ("操作码", 8), ("寻址方式", 9), ("有效地址", 8), ("指令编码", 8),
        ("机器指令", 7), ("C表达式", 6), ("C 表达式", 6),
        ("控制器", 8), ("微程序", 9), ("微指令", 8), ("硬布线", 9), ("取指", 7), ("间址", 8),
        ("单周期", 8), ("多周期", 8), ("控制存储器", 8),
        ("流水线", 9), ("时空图", 9), ("吞吐率", 8), ("加速比", 9), ("数据冒险", 9),
        ("控制冒险", 9), ("结构冒险", 9), ("转发", 6), ("暂停", 6),
        ("总线", 9), ("总线带宽", 10), ("总线仲裁", 9), ("DMA", 10), ("程序查询", 9),
        ("中断方式", 8), ("中断优先级", 9), ("嵌套", 7), ("中断", 6), ("CPU时间开销", 9),
    ),
    "computer_network": (
        ("计算机网络", 10), ("tcp", 9), ("udp", 8), ("慢启动", 10), ("拥塞控制", 10), ("拥塞窗口", 10),
        ("三次握手", 10), ("四次挥手", 10), ("滑动窗口", 8), ("流量控制", 7), ("子网掩码", 10),
        ("ip地址", 9), ("路由", 7), ("以太网", 8), ("csma", 8), ("交换机", 7), ("集线器", 7),
        ("报文", 6), ("rtt", 7), ("网络层", 8), ("传输层", 8), ("数据链路", 8), ("物理层", 7),
        ("域名", 6), ("dns", 9), ("http", 9), ("https", 9), ("web", 6), ("页面", 5),
        ("mac地址", 8), ("arp", 9),
        ("传输轮次", 8), ("cwnd", 10), ("ssthresh", 10),
        ("osi", 10), ("tcp/ip", 10), ("体系结构", 8), ("分层", 6), ("封装", 9), ("解封装", 9),
        ("协议与服务", 10), ("应用层", 8), ("表示层", 8), ("会话层", 8), ("传输层", 8),
        ("网络层", 8), ("数据链路层", 9), ("物理层", 8), ("路由器", 8), ("交换机", 8),
        ("集线器", 8), ("网关", 8), ("网桥", 8), ("中继器", 8), ("网络设备", 8), ("哪一层", 6),
        ("发送时延", 9), ("传播时延", 9), ("传输时延", 8), ("时延带宽积", 10),
        ("带宽", 7), ("吞吐量", 9), ("电路交换", 10), ("报文交换", 10), ("分组交换", 10),
        ("奈奎斯特", 10), ("香农", 10), ("码元", 9), ("波特率", 9), ("比特率", 8),
        ("编码", 5), ("调制", 8), ("复用", 8), ("频分", 8), ("时分", 7), ("波分", 8), ("码分", 8),
        ("crc", 10), ("循环冗余", 10), ("生成多项式", 10), ("海明", 10), ("汉明", 10),
        ("奇偶校验", 10), ("奇校验", 9), ("偶校验", 9), ("校验位", 8),
        ("差错检测", 10), ("差错控制", 10), ("检错", 9), ("纠错", 8),
        ("滑动窗口", 10), ("停止等待", 10), ("gbn", 10), ("回退n", 9), ("选择重传", 10),
        ("发送窗口", 9), ("接收窗口", 9), ("序号空间", 9), ("信道利用率", 9),
        ("aloha", 10), ("csma", 9), ("csma/cd", 10), ("csma/ca", 10), ("冲突检测", 9),
        ("冲突避免", 9), ("最小帧长", 10), ("退避", 9), ("二进制指数", 10),
        ("mac帧", 10), ("vlan", 10), ("自学习", 9), ("转发表", 9), ("冲突域", 9), ("广播域", 9),
        ("ipv4", 9), ("ipv6", 10), ("子网", 9), ("子网掩码", 10), ("cidr", 10), ("vlsm", 10),
        ("网络地址", 8), ("广播地址", 8), ("地址聚合", 9), ("聚合", 8), ("汇总", 7),
        ("最长前缀", 9), ("ip数据报", 9), ("分片", 7), ("mtu", 8), ("地址压缩", 9),
        ("arp", 9), ("dhcp", 9), ("icmp", 9), ("nat", 8), ("路由表", 9), ("距离向量", 10),
        ("链路状态", 10), ("rip", 9), ("ospf", 9), ("bgp", 9), ("自治系统", 9),
        ("端口", 8), ("熟知端口", 9), ("动态端口", 9), ("time_wait", 9), ("确认号", 8),
        ("tcp首部", 9), ("udp首部", 9),
        ("拥塞避免", 9), ("快重传", 9), ("快恢复", 9), ("传输控制", 7),
        ("网页", 8), ("url", 9), ("网址", 9), ("页面显示", 8), ("浏览器", 6),
        ("dns", 9), ("递归查询", 10), ("迭代查询", 10),
        ("持久连接", 9), ("非持久连接", 9), ("ftp", 8),
        ("smtp", 8), ("pop3", 8), ("imap", 8), ("电子邮件", 8), ("邮件", 7),
    ),
}

NUMBER_MARKER = re.compile(
    # 分隔符后紧跟数字的是小数（OCR 断行后 "0.2T" 位于行首），不是题号。
    r"(?m)^\s*(?:第\s*)?([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[.、．:：)）](?!\d)\s*"
)
NUMBER_WORDS = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}
ALLOWED_ROLES = ("problem", "courseware", "data")
STOP_EXPR = r"(?=\s*(?:的|，|,|。|；|;|\n|求|其中|初始|起点|学习率|迭代|约束|满足|在点|目标|已知|$))"


class RecognitionError(ValueError):
    """无法形成任何可用题目。"""


# ---------------------------------------------------------------------------
# 来源与拆分
# ---------------------------------------------------------------------------


def _basic_source(page: Mapping[str, Any]) -> dict[str, Any]:
    text = str(page.get("text") or "")
    return {
        "file_id": page.get("file_id"),
        "page": page.get("page"),
        "excerpt": re.sub(r"\s+", " ", text).strip()[:220],
    }


def _page_labels(pages: Sequence[Mapping[str, Any]], files: Sequence[Mapping[str, Any]]) -> str:
    roles = {item.get("file_id"): str(item.get("role")) for item in files}
    kinds = {item.get("file_id"): str(item.get("kind")) for item in files}
    parts: list[str] = []
    for page in pages:
        role = roles.get(page.get("file_id"), "")
        kind = kinds.get(page.get("file_id"), "")
        if role == "problem":
            parts.append("题目")
        elif role == "data":
            parts.append("补充数据")
        elif role == "courseware":
            parts.append("课件")
        if kind == "pdf":
            parts.append("PDF")
        elif kind == "image":
            parts.append("图片")
        elif kind == "pptx":
            parts.append("PPTX")
    return " + ".join(dict.fromkeys(parts)) or "文本"


def _problem_pages(pages: Sequence[Mapping[str, Any]], files: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    roles = {item.get("file_id"): str(item.get("role")) for item in files}
    usable = lambda page: bool(str(page.get('text') or '').strip() or page.get('image_key'))
    primary = [page for page in pages if roles.get(page.get("file_id")) == "problem" and usable(page)]
    if primary:
        return primary
    courseware = [page for page in pages if roles.get(page.get("file_id")) == "courseware" and usable(page)]
    if courseware:
        return courseware
    return [page for page in pages if roles.get(page.get("file_id")) in ("problem", "courseware", "data") and usable(page)]


def _split_page(text: str) -> list[tuple[str | None, str]]:
    matches = list(NUMBER_MARKER.finditer(text))
    if not matches:
        cleaned = text.strip()
        return [(None, cleaned)] if cleaned else []
    parts: list[tuple[str | None, str]] = []
    # 题号前若有引导语（如“三、计算题”），并入第一题，避免丢失上下文。
    prefix = text[: matches[0].start()].strip()
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if index == 0 and prefix:
            body = f"{prefix}\n{body}"
        parts.append((match.group(1), body))
    return parts


_SUBQUESTION_MARKER = re.compile(
    r'(?<![^\s。；;:：])(?:[（(]\s*([1-9]\d?)\s*[）)]|([①②③④⑤⑥⑦⑧⑨⑩]))\s*(?=[\u4e00-\u9fff])'
)


def _subquestion_parts(text: str) -> list[dict[str, Any]]:
    matches = list(_SUBQUESTION_MARKER.finditer(text))
    numbers = [int(m.group(1)) if m.group(1) else '①②③④⑤⑥⑦⑧⑨⑩'.index(m.group(2)) + 1 for m in matches]
    if len(matches) >= 2 and numbers == list(range(1, len(matches) + 1)):
        shared = text[:matches[0].start()].strip()
        bodies = [text[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)].strip()
                  for i, m in enumerate(matches)]
        if all(re.search(r'求|计算|判断|证明|讨论|分析|写出|说明|确定|画|设计', body) for body in bodies):
            shared_tail = bool(re.search(r'(?:以上|上述|各|所有|全部|这|两).{0,8}(?:问|小题).{0,8}(?:均|都|统一|研究|考虑)', bodies[-1]))
            return [dict(number=n, shared_text=shared, body=body, shared_tail=shared_tail)
                    for n, body in zip(numbers, bodies)]
    joined = re.search(r'(求[^。；\n]*?单调[^。；\n]*?)[，,]?\s*(?:并|且|同时|以及)\s*(求[^。；\n]*?极值[^\n]*)$', text)
    if joined and text[:joined.start()].strip():
        return [dict(number=i + 1, shared_text=text[:joined.start()].strip(), body=body.strip())
                for i, body in enumerate(joined.groups())]
    return []


def _expand_subquestions(problems: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expanded = []
    for parent_index, problem in enumerate(problems, 1):
        parts = _subquestion_parts(problem['text'])
        if not parts:
            expanded.append(problem)
            continue
        for part in parts:
            label = f"{problem['number']}({part['number']})" if problem['number'] else f"({part['number']})"
            expanded.append({**problem, 'number': label,
                             'text': '\n'.join(filter(None, (part['shared_text'], part['body']))),
                             'subquestion': {**part, 'parent_index': parent_index,
                                             'parent_number': problem['number'], 'parent_text': problem['text']}})
    return expanded


def _subquestion_context_issues(text: str, shared_text: str) -> list[str]:
    body = text[len(shared_text):] if shared_text and text.startswith(shared_text) else text
    issues = []
    if re.search(r'第\s*[一二三四五六七八九十1-9]+\s*问|(?:上|前)一?问|上述(?:结果|结论|条件)|(?<![A-Za-z0-9_])[（(]\s*[1-9]\d?\s*[）)]\s*(?:的|中|所得|结果|结论)|改为|改成|另设|重新定义|同上', body):
        issues.append('本小问依赖其他小问或改写条件，请补全独立条件后求解')
    if shared_text and body != text:
        definitions = re.findall(r'(?:f|g|h)\s*\([^()]+\)\s*=', shared_text)
        if len(definitions) > 1:
            issues.append('公共题干包含多个函数，请为本小问保留所需函数与完整条件，避免绑定到另一函数')
        shared_function, _ = _extract_function_expression(shared_text)
        own_function, _ = _extract_function_expression(body)
        if shared_function and own_function and shared_function != own_function:
            issues.append('本小问与公共题干给出了不同函数，请明确本问使用的函数')
        interval = r'[∈]|(?:<=?|≤)\s*[xy]\s*(?:<=?|≤)|[\[(]\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*[\])]'
        if re.search(interval, shared_text) and re.search(interval, body):
            issues.append('公共题干和本小问均指定了区间，请确认本问区间，避免沿用其他条件')
    return issues


def _apply_subquestion_context(problem: dict[str, Any], context: Mapping[str, Any]) -> None:
    problem['subquestion'] = dict(context)
    issues = _subquestion_context_issues(problem['text'], str(context.get('shared_text') or ''))
    original_child = '\n'.join(filter(None, (context.get('shared_text'), context.get('body'))))
    if context.get('shared_tail') and problem['text'].strip() == original_child.strip():
        issues.append('题尾包含适用于多个小问的条件，请明确本问完整条件后求解')
    if issues:
        problem['status'] = 'pending_ai'
        problem['recognition']['ambiguities'].append(_ambiguity(
            'subquestion_context', 'text', '；'.join(issues), options=[]))


def split_problems(
    pages: Sequence[Mapping[str, Any]],
    files: Sequence[Mapping[str, Any]],
    *,
    single_problem: bool = False,
) -> list[dict[str, Any]]:
    """按题号拆分，并把后续无题号页面合并到上一题（跨页题干/图示）。"""

    relevant = _problem_pages(pages, files)
    if not relevant:
        raise RecognitionError("没有读到可用于识别的题目文字")
    marked = False if single_problem else any(NUMBER_MARKER.search(str(page.get("text") or "")) for page in relevant)
    if not marked:
        text = "\n".join(str(page.get("text") or "").strip() for page in relevant).strip()
        first = relevant[0]
        last = relevant[-1]
        return _expand_subquestions([
            {
                "number": None,
                "text": text,
                "pages": list(relevant),
                "page_from": int(first.get("page") or 1),
                "page_to": int(last.get("page") or 1),
            }
        ])

    problems: list[dict[str, Any]] = []
    by_number: dict[str, dict[str, Any]] = {}
    for page in relevant:
        segments = _split_page(str(page.get("text") or ""))
        if not segments and page.get('image_key'):
            segments = [(None, '')]
        for number, segment in segments:
            if not segment.strip() and not page.get('image_key'):
                continue
            if number is not None and number in by_number:
                # 同一题号出现在后续页：视为跨页续写，而不是新题。
                target = by_number[number]
                target["text"] = f"{target['text']}\n{segment}".strip()
                target["pages"].append(page)
                target["page_to"] = int(page.get("page") or target["page_to"])
                continue
            if number is None and problems:
                # 没有题号的页面归入上一题，保留跨页图示/条件。
                target = problems[-1]
                target["text"] = f"{target['text']}\n{segment}".strip()
                target["pages"].append(page)
                target["page_to"] = int(page.get("page") or target["page_to"])
                continue
            item = {
                "number": number,
                "text": segment.strip(),
                "pages": [page],
                "page_from": int(page.get("page") or 1),
                "page_to": int(page.get("page") or 1),
            }
            problems.append(item)
            if number is not None:
                by_number[number] = item
    # 单页多题时，上一步只按题号合并了同名题号；清理重复页面引用。
    for item in problems:
        unique: list[Mapping[str, Any]] = []
        seen: set[tuple[Any, Any]] = set()
        for page in item["pages"]:
            key = (page.get("file_id"), page.get("page"))
            if key not in seen:
                seen.add(key)
                unique.append(page)
        item["pages"] = unique
    return _expand_subquestions(problems)


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

_PHYSICS_STRONG = (
    "质点运动", "匀变速", "自由落体", "自由落下", "平抛", "斜抛", "抛体", "相对运动", "牛顿",
    "受力分析", "斜面", "连接体", "滑轮", "圆周运动", "向心", "动能定理",
    "机械能守恒", "弹簧振子", "弹簧势能", "劲度系数", "动量", "冲量", "冲力", "碰撞", "相对",
    "单摆", "简谐", "振动", "重力加速度", "初速度", "加速度", "位移",
    "仰角", "抛射角", "相对地面", "合力", "光滑", "抛出", "重力势能", "弹性势能",
    "刚体", "转动惯量", "纯滚动", "机械波", "行波", "波长", "波速", "驻波", "波节", "波腹",
    "库仑", "高斯定理", "高斯面", "点电荷", "电荷", "电场", "电场强度", "场强", "电势", "球壳", "球面", "带电", "电容器", "基尔霍夫", "双回路", "支路电流", "时间常数", "充电", "放电",
    "洛伦兹", "安培力", "带电粒子", "磁通量", "法拉第", "感应电动势", "切割磁感线", "导体棒",
    "理想气体", "等温", "等压", "等容", "绝热", "卡诺", "热机", "热力学", "串联", "并联",
    "力矩", "角动量",
    "双缝", "干涉", "薄膜", "增透膜", "增反膜", "衍射", "单缝", "光栅", "偏振", "马吕斯", "布儒斯特",
    "折射", "全反射", "临界角", "透镜", "成像", "焦距", "物距", "像距",
    "光电效应", "逸出功", "遏止电压", "德布罗意", "物质波", "能级", "跃迁", "光谱线",
    "放射性", "半衰期", "衰变",
)


def normalize_latex_prose(text: str) -> str:
    """Turn common LaTeX into plain text before the regex recognizer runs."""
    if not isinstance(text, str):
        return ''
    if ('\\' not in text and '$' not in text
            and not re.search(r'[∫∬∭][₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹]', text)):
        return text
    value = text.replace('\\left', '').replace('\\right', '').replace('$', '')
    subscript = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')
    superscript = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹', '0123456789')
    value = re.sub(
        r'[∫∬∭]([₀₁₂₃₄₅₆₇₈₉]+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)',
        lambda match: match.group(0)[0] + '_' + match.group(1).translate(subscript)
        + '^' + match.group(2).translate(superscript),
        value,
    )
    value = re.sub(
        r'([A-Za-z0-9)\]])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)',
        lambda match: match.group(1) + '^' + match.group(2).translate(superscript),
        value,
    )
    value = re.sub(r'\\operatorname\*?\s*\{\s*lim\s*\}', 'lim', value)
    value = re.sub(r'\\operatorname\*?\s*lim', 'lim', value)
    for command, plain in (('\\le', '<='), ('\\leq', '<='), ('\\ge', '>='), ('\\geq', '>='),
                           ('\\ne', '!='), ('\\neq', '!='), ('\\cdot', '*'), ('\\times', '*'),
                           ('\\div', '/'), ('\\pi', 'pi'), ('\\to', '→'), ('\\infty', 'oo')):
        value = value.replace(command, plain)
    value = re.sub(r'\\(?:longrightarrow|rightarrow)', '→', value)
    _fn_names = 'arcsin|arccos|arctan|arccot|arcsec|arccsc|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|log|ln|exp|sqrt|abs|max|min'
    value = re.sub(rf'\\({_fn_names})\b', r'\1', value)
    value = re.sub(rf'\\({_fn_names})(?=[xyztuvn](?![A-Za-z]))', r'\1 ', value)
    value = re.sub(r'\\mathrm\s*\{\s*d\s*\}', 'd', value)
    for _ in range(6):
        updated = re.sub(r'\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}', r'((\1)/(\2))', value)
        updated = re.sub(r'\\sqrt\s*\[\s*([^\]]+)\s*\]\s*\{([^{}]*)\}', r'(\2)^(1/(\1))', updated)
        updated = re.sub(r'\\sqrt\s*\{([^{}]*)\}', r'sqrt(\1)', updated)
        updated = re.sub(r'\\?lim\s*_\s*\{([^{}]*)\}', lambda m: 'lim_(' + _latex_group_plain(m.group(1)) + ')', updated)
        updated = re.sub(
            r'\^\s*\{([^{}]*)\}',
            lambda m: '^' + (m.group(1).strip() if re.fullmatch(r'[A-Za-z0-9]+', m.group(1).strip()) else f'({m.group(1)})'),
            updated,
        )
        updated = re.sub(
            r'_\s*\{([^{}]*)\}',
            lambda m: '_' + (m.group(1).strip() if re.fullmatch(r'[A-Za-z0-9+-]+', m.group(1).strip()) else f'({m.group(1)})'),
            updated,
        )
        if updated == value:
            break
        value = updated
    value = re.sub(r'\\(?:int|iint|iiint)(?![A-Za-z])', lambda m: {'int': '∫', 'iint': '∬', 'iiint': '∭'}[m.group(0)[1:]], value)
    value = value.replace('\\sum', 'Σ').replace('\\prod', '∏')
    value = re.sub(r'\\[,!;:]', ' ', value)
    value = re.sub(r'\\[A-Za-z]+\s*', ' ', value)
    # OCR often renders an answer blank as "=()/(→)()/(→)·p"; it is not part of the question.
    value = re.sub(r'=\s*(?:\(\s*[^0-9A-Za-z]*\s*\)\s*/\s*\(\s*[^0-9A-Za-z]*\s*\)\s*)+[·.]?\s*[A-Za-z]?\s*$', '=', value)
    value = re.sub(r'=\s*(?:\(\s*\)\s*)+[·.]?\s*[A-Za-z]?\s*$', '=', value)
    value = re.sub(r'=\s*_{2,}\s*$', '=', value)
    return re.sub(r'[{}]', '', value)


def _latex_group_plain(value: str) -> str:
    return value.replace('\\to', '→').replace('\\rightarrow', '→').replace('{', '').replace('}', '').strip()


def classify_subject(text: str) -> tuple[str, float]:
    lowered = text.lower()
    compact = re.sub(r'\s+', '', lowered)
    scores: dict[str, int] = {}
    for subject, keywords in SUBJECT_KEYWORDS.items():
        score = 0
        for keyword, weight in keywords:
            if keyword.lower() in lowered or re.sub(r'\s+', '', keyword.lower()) in compact:
                score += weight
        scores[subject] = score
    # “梯度下降 + f(x)”更像最优化；“神经网络 + 学习率”才归深度学习。
    if "梯度下降" in text and "神经网络" not in text and "损失" not in text:
        scores["optimization"] += 4
    # 裸“极值/驻点/最值”（无约束词）归最优化引擎；带“约束/条件”的留给 calculus
    # 的拉格朗日条件极值——`f(x,y)` 关键词权重不足以承担该消歧。
    if re.search(r'极值|驻点|最[大小]值', text) and not re.search(r'约束|满足|(?<!无)条件', text):
        scores["optimization"] += 9
    # 「单调/凹凸/拐点 + 极值」是函数性态综合大题，function_study 覆盖全部小问。
    if re.search(r'单调|凹凸|拐点|函数性态', text) and re.search(r'极值|驻点|渐近线', text):
        scores["calculus"] += 9
    if (re.search(r'极值|驻点', text) and re.search(r'(?:f|g|h)\s*\(\s*x\s*\)', text)
            and not re.search(r'梯度|学习率|迭代|约束', text)):
        scores['calculus'] = max(scores['calculus'], scores['optimization'] + 1)
    if (re.search(r'最[大小]值', text) and re.search(r'f\s*\(\s*x\s*,\s*y\s*\)', text)
            and re.search(r'-?\d+(?:\.\d+)?\s*(?:<=|≤)\s*[xy]\s*(?:<=|≤)', text)
            and not re.search(r'拉格朗日|等式约束', text)):
        scores['optimization'] = max(scores['optimization'], scores['calculus'] + 1)
    if re.search(
        r"(?:\\?lim|极限)\s*[_^]?\s*[({]?\s*[A-Za-z]\s*(?:\\to|->|→|to|趋于|趋近于)",
        text,
        flags=re.I,
    ):
        scores["calculus"] += 6
    # `[[1,2],[3,4]]` 嵌套字面量几乎只在线性代数题出现；无"矩阵"字样时靠它进科目。
    if re.search(r"\[\s*\[", text):
        scores["linear_algebra"] += 6
    # OCR 断行会把强关键词拆散（"安\n培力"），强词探测用折叠文本。
    if any(re.sub(r"\s+", "", term) in compact for term in _PHYSICS_STRONG) and scores.get("physics", 0) >= 8:
        chosen = "physics"
    elif scores["operating_system"] >= max(scores.values() or [0]) and scores["operating_system"] >= 8:
        chosen = "operating_system"
    elif scores["computer_network"] >= max(scores.values() or [0]) and scores["computer_network"] >= 8:
        chosen = "computer_network"
    elif (scores["computer_organization"] >= max(scores.values() or [0])
          and scores["computer_organization"] >= 8):
        chosen = "computer_organization"
    elif scores["deep_learning"] >= max(scores.values() or [0]) and scores["deep_learning"] > 0:
        chosen = "deep_learning"
    elif scores["linear_algebra"] > 0 and scores["linear_algebra"] >= max(
        scores["algorithm"], scores["calculus"], scores["optimization"]
    ):
        chosen = "linear_algebra"
    elif (scores["algorithm"] > 0 and scores["algorithm"] >= scores["optimization"]
          and scores["algorithm"] >= scores["calculus"]):
        chosen = "algorithm"
    elif scores["calculus"] > 0 and scores["calculus"] >= scores["optimization"]:
        chosen = "calculus"
    elif scores["optimization"] > 0:
        chosen = "optimization"
    elif scores["calculus"] > 0:
        chosen = "calculus"
    else:
        chosen = "unknown"
    top = scores.get(chosen, 0)
    confidence = min(0.95, 0.55 + top / 40) if chosen != "unknown" else 0.3
    runner_up = max((score for subject, score in scores.items() if subject != chosen), default=0)
    if chosen != "unknown" and (top < 2 or (top == runner_up and top < 4)):
        return "unknown", 0.35
    return chosen, round(confidence, 2)


def model_coverage_issues(text: str, model: Mapping[str, Any]) -> list[str]:
    """Cheap source-to-model coverage check; only flags clear under-modelling."""
    issues: list[str] = []
    numbers = list(dict.fromkeys(re.findall(r'(?<![\w.])-?\d+(?:\.\d+)?', text)))
    # 已捕获结构化序列（栈/堆/调度等模型的元素列表）时，题面剩余的裸数字多为
    # 题号、年份、选项标号与计数词（"7 个元素"），不应用"数值全部缺失"判欠建模。
    sequence_keys = ("push_seq", "pop_seq", "ops", "initial_heap", "reference",
                     "processes", "nodes", "edges", "requests", "allocation",
                     "max", "available", "names")
    has_sequence = any(isinstance(model.get(key), list) and model.get(key) for key in sequence_keys)
    if len(numbers) >= 3 and not has_sequence:
        rendered = json.dumps(model, ensure_ascii=False)
        present = 0
        for number in numbers:
            value = float(number)
            candidates = {number, str(int(value)) if value.is_integer() else '', f'{value:g}'}
            if any(candidate and candidate in rendered for candidate in candidates):
                present += 1
        if present == 0:
            issues.append('题干中的数值全部没有进入模型条件')
    formula_segments = re.findall(r'[A-Za-z0-9_)\]}^/\\∫Σ∑+\-*=<>{}\s]{18,}', text)
    if formula_segments:
        longest = max(len(segment.strip()) for segment in formula_segments)
        expressions = [value for key, value in model.items() if isinstance(value, str)]
        longest_model = max((len(value) for value in expressions), default=0)
        if longest >= 24 and longest_model < max(6, longest // 4):
            issues.append('本地模型只使用了题干公式的一小部分')
    subquestions = max(len(_subquestion_parts(text)), len(re.findall(
        r'(?:^|[\n。；;])\s*[（(]\s*[1-9]\s*[）)]|^[①②③④⑤]', text, flags=re.M)))
    if subquestions >= 2 and not model.get('requested_quantities') and not model.get('target_kind') and not model.get('tasks'):
        issues.append('题目包含多个小问，但只建立了一个模型')
    return issues


def _clean_expr(text: str) -> str:
    value = text.strip()
    value = re.sub(r"^[=＝]\s*", "", value)
    value = value.strip(" ：:，,。；;")
    # “函数 y=x^2”“设 f(x)=sinx”里的左侧函数名不属于表达式本身。
    value = re.sub(r"^[fghy]\s*(?:\(\s*[xy](?:\s*,\s*[xy])?\s*\))?\s*[=＝]\s*", "", value)
    value = re.sub(r"(的最小值|的最大值|的最小|的最大|的极值|的值)$", "", value).strip()
    return value


def _extract_function_expression(text: str) -> tuple[str | None, str | None]:
    patterns = [
        re.compile(r"(?:f|g|h|y)\s*\(\s*([xy](?:\s*,\s*[xy])?)\s*\)\s*=\s*([^\n]+)"),
        re.compile(r"(?:目标函数|函数|曲线|抛物线)\s*[:：]?\s*(?:f\s*\(\s*[xy](?:\s*,\s*[xy])?\s*\)\s*=\s*)?([^\n]+)"),
        re.compile(r"(?:f|g|h|y)\s*=\s*([^\n]+)"),
    ]
    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        if pattern.groups == 2:
            variables, raw = match.group(1), match.group(2)
        else:
            variables, raw = "x", match.group(1)
        # 截断到中文条件词，但保留括号内的逗号。
        stop = re.search(
            r"(?:的|，|,|。|；|;|\n|求|其中|初始|起点|学习率|迭代|约束|满足|在点|在\s*[xyzt]\s*=|目标|已知|\s+[A-E]\s*[.、]|$)",
            raw,
        )
        if stop:
            raw = raw[: stop.start()]
        cleaned = _clean_expr(raw)
        if cleaned:
            return cleaned, variables.replace(" ", "")
    return None, None


def _extract_number(text: str, patterns: Sequence[str]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            try:
                value = float(match.group(1).replace("−", "-"))
                if math.isfinite(value):
                    return value
            except (TypeError, ValueError):
                continue
    return None


def _extract_int(text: str, patterns: Sequence[str], default: int | None = None) -> int | None:
    value = _extract_number(text, patterns)
    return int(value) if value is not None else default


def _condition(
    condition_id: str,
    label: str,
    value: Any,
    *,
    kind: str = "number",
    unit: str = "",
    provenance: str = "original",
    source: Mapping[str, Any] | None = None,
    editable: bool = True,
    options: Sequence[str] | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": condition_id,
        "label": label,
        "value": value,
        "kind": kind,
        "unit": unit,
        "provenance": provenance,
        "source": dict(source or {}),
        "editable": editable,
        "options": list(options or []),
        "min": min_value,
        "max": max_value,
        "step": step,
    }
    if note:
        payload["note"] = note
    return payload


def _ambiguity(
    ambiguity_id: str,
    field: str,
    question: str,
    *,
    severity: str = "blocking",
    options: Sequence[Mapping[str, str]] | None = None,
    resolved: bool = False,
    answer: str | None = None,
) -> dict[str, Any]:
    return {
        "id": ambiguity_id,
        "field": field,
        "question": question,
        "severity": severity,
        "options": [dict(item) for item in (options or [])],
        "resolved": resolved,
        "answer": answer,
    }


def _param(
    parameter_id: str,
    label: str,
    kind: str,
    *,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
    options: Sequence[str] | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": parameter_id,
        "label": label,
        "kind": kind,
        "min": min_value,
        "max": max_value,
        "step": step,
        "options": list(options or []),
    }
    if note:
        payload["note"] = note
    return payload


def _add_defaults_conditions(
    model: dict[str, Any],
    conditions: list[dict[str, Any]],
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> None:
    values = overrides.get("condition_values") or {}
    mapping = {item["id"]: item for item in conditions}
    for key, value in values.items():
        if key not in model["defaults"]:
            continue
        try:
            if isinstance(model["defaults"][key], int) and not isinstance(model["defaults"][key], bool):
                parsed: Any = int(round(float(value)))
            elif isinstance(model["defaults"][key], float):
                parsed = float(value)
            else:
                parsed = value
        except (TypeError, ValueError):
            continue
        model["defaults"][key] = parsed
        if key in mapping:
            mapping[key]["value"] = parsed
            mapping[key]["provenance"] = "user_confirmed"
        else:
            conditions.append(
                _condition(
                    key,
                    key,
                    parsed,
                    kind="number",
                    provenance="user_confirmed",
                    source=source,
                    note="学生补充或修正的条件",
                )
            )


# ---------------------------------------------------------------------------
# 微积分
# ---------------------------------------------------------------------------


def _parse_limit(raw: str) -> float | None:
    """解析积分上下限；支持 ``+∞`` / ``\\infty`` / ``inf``，普通值返回浮点数。"""

    text = raw.strip().strip("{}").replace(" ", "").replace("\\infty", "∞").replace("\\inf", "∞")
    text = re.sub(r"∞+", "∞", text)
    lowered = text.lower()
    if lowered in ("∞", "+∞", "inf", "+inf", "oo", "+oo"):
        return math.inf
    if lowered in ("-∞", "-inf", "-oo"):
        return -math.inf
    try:
        return float(text)
    except ValueError:
        return None


def _antiderivative_plot_domain(antiderivative: sp.Expr | None, variable: str) -> list[float]:
    """挑一个能看清原函数形状、又不会被奇点或巨大值拉爆纵轴的显示区间。"""

    if antiderivative is None:
        return [-3.0, 3.0]
    symbol = sp.Symbol(variable, real=True)
    try:
        evaluate = sp.lambdify(symbol, antiderivative, modules=["math"])
    except Exception:  # noqa: BLE001 - 无法数值化时退回默认窗口
        return [-3.0, 3.0]
    for low, high in (
        (-4.0, 4.0), (-3.0, 3.0), (-2.0, 2.0), (-1.5, 1.5), (-1.0, 1.0),
        (0.05, 3.0), (-3.0, -0.05), (0.05, 1.5), (-1.5, -0.05),
    ):
        peak = 0.0
        usable = True
        for index in range(81):
            x_value = low + (high - low) * index / 80
            try:
                y_value = float(evaluate(x_value))
            except Exception:  # noqa: BLE001
                usable = False
                break
            if not math.isfinite(y_value):
                usable = False
                break
            peak = max(peak, abs(y_value))
        if usable and peak <= 40:
            return [low, high]
    return [-1.0, 1.0]


def _parse_integral(text: str) -> dict[str, Any] | None:
    """解析积分式，并区分定积分与不定积分。

    只有显式写出的上下限（``∫_a^b`` / ``∫_{a}^{b}`` / “从 a 到 b”）才按定积分
    处理。``∫x^2 dx`` 中的 ``^`` 是幂，不是积分上限；没有上下限的积分默认按
    “不定积分”识别，除非题目明确写了“定积分”。这样既不会把 ``x^2`` 读成
    “下限 x、上限 2”，也不会给不定积分擅自补上 0 到 1 的区间。
    """

    compact = text.replace("\n", " ")
    compact = re.sub(r"\\,|\\!|\\;|\\ ", " ", compact)
    compact = re.sub(r"\\mathrm\{d\}|\\text\{d\}|\\operatorname\{d\}", "d", compact)
    # OCR 把 ∫ 读成 “{”：后接上下标符号的 { 按积分号处理。
    compact = re.sub(r"\{\s*(?=[_^])", "∫", compact)

    says_indefinite = bool(re.search(r"不定积分|原函数|antiderivative", text, flags=re.I))
    says_definite = bool(
        re.search(r"(?<!不)(?<!in)定积分|(?<!in)definite integral", text, flags=re.I)
    )

    # 1) 显式上下限：LaTeX/Unicode 下标 + 上标。
    matches = list(
        re.finditer(
            r"(?:\\int|∫)\s*(?:_\{?([^{}\s^]+)\}?)\s*(?:\^\{?([^{}\s]+)\}?)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
        )
    )
    # 2) 中文/英文“从 a 到 b”。
    matches += list(
        re.finditer(
            r"(?:\\int|∫)\s*(?:从|from)?\s*([0-9.\-+∞]+)\s*(?:到|至|to)\s*([0-9.\-+∞]+)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    # 3) 纯文本 int_a^b。
    matches += list(
        re.finditer(
            r"\bint\s*_\s*\{?([0-9.\-+]+)\}?\s*\^\s*\{?([0-9.\-+]+)\}?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    # 4) 没有 ∫ 符号、但写了“从 a 到 b 积分”的题目。
    matches += list(
        re.finditer(
            r"(?:积分\s*)?(?:从|from)\s*([0-9.\-+]+)\s*(?:到|至|to)\s*([0-9.\-+∞]+)\s*(?:求积分|求|计算)?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
            flags=re.I,
        )
    )
    for match in matches:
        lower_text, upper_text, body, variable = match.groups()
        if not body.strip():
            continue
        lower = _parse_limit(lower_text)
        upper = _parse_limit(upper_text)
        # 上限与被积函数无空格时贪婪上限会吞进被积函数（`^1x^2dx`→`1x^`、
        # `^+∞∞1/x^2dx`→`+∞∞1/x^`）：找最长可解析为限的前缀，剩余并回被积函数。
        if upper is None:
            for cut in range(len(upper_text) - 1, 0, -1):
                head = _parse_limit(upper_text[:cut])
                if head is not None:
                    upper, body = head, upper_text[cut:] + body
                    upper_text = upper_text[:cut]
                    break
        if lower is None:
            for cut in range(len(lower_text) - 1, 0, -1):
                head = _parse_limit(lower_text[:cut])
                if head is not None:
                    lower, body = head, lower_text[cut:] + body
                    lower_text = lower_text[:cut]
                    break
        payload = {
            "expression": _clean_expr(body),
            "lower": lower,
            "upper": upper,
            "lower_text": lower_text,
            "upper_text": upper_text,
            "variable": variable,
            "indefinite": False,
            "matched": match.group(0),
        }
        if lower is None or upper is None:
            # 上下限是符号/公式时不能擅自代入，交给核对面板处理。
            payload["limits_text"] = f"{lower_text}, {upper_text}"
        return payload

    # 5) 写了 ∫ 但只带一个限（如 ∫_0 x dx）：限不完整，交回核对面板确认区间。
    if re.search(r"(?:\\int|∫)\s*[_^]", compact):
        partial = re.search(
            r"(?:\\int|∫)\s*(?:_\{?[^{}\s]*\}?|\^\{?[^{}\s]*\}?)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])",
            compact,
        )
        if partial and partial.group(1).strip():
            return {
                "expression": _clean_expr(partial.group(1)),
                "lower": None,
                "upper": None,
                "variable": partial.group(2),
                "indefinite": False,
                "matched": partial.group(0),
            }
        return None

    # 6) 没有显式上下限：∫f(x)dx 视为不定积分；“定积分 x^2 dx”仍要求确认区间。
    match = re.search(
        r"(?:\\int|∫)\s*_?\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])", compact
    )
    if match and not match.group(1).strip().lstrip("^_").strip():
        match = None
    if match:
        body = match.group(1).strip()
        # 写成 ∫_0^2 但漏了某个限时，不猜成不定积分。
        indefinite = not says_definite or says_indefinite
    else:
        match = re.search(r"(?:定?积分)\s*(.+?)\s*d\s*([xyzt])(?![A-Za-z])", compact)
        if not match:
            return None
        body = match.group(1).strip()
        indefinite = says_indefinite and not says_definite
    if not body or body.strip("^_") == "":
        return None
    return {
        "expression": _clean_expr(body),
        "lower": None,
        "upper": None,
        "variable": match.group(2),
        "indefinite": indefinite,
        "matched": match.group(0),
    }


def _calculus_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .proof import build_proof_from_text
    proof = build_proof_from_text(text, source, overrides)
    if proof is not None:
        return proof
    from .ode import build_ode_from_text
    ode = build_ode_from_text(text, source, overrides)
    if ode is not None:
        return ode
    from .series import build_series_from_text
    series = build_series_from_text(text, source, overrides)
    if series is not None:
        return series
    from .parameter_limit import build_parameter_limit_from_text
    parameter_limit = build_parameter_limit_from_text(text, source, overrides)
    if parameter_limit is not None:
        return parameter_limit
    from .line_integral_text import build_line_integral_from_text
    line_integral = build_line_integral_from_text(text, source, overrides)
    if line_integral is not None:
        return line_integral
    from .advanced_calc_text import build_advanced_calc_from_text
    advanced = build_advanced_calc_from_text(text, source, overrides)
    if advanced is not None:
        return advanced
    from .calculus_analysis import build_analysis_problem
    analysis = build_analysis_problem(text, source, overrides)
    if analysis is not None:
        return analysis
    from .double_integral import build_double_integral
    double = build_double_integral(text, source, overrides)
    if double is not None:
        return double
    from .exam_math import build_exam_math
    exam = build_exam_math(text, source, overrides)
    if exam is not None:
        return exam
    expression_override = str(overrides.get("expression") or "").strip()
    lower_override = overrides.get("lower")
    upper_override = overrides.get("upper")
    integral = _parse_integral(text)
    function_expr, variables = _extract_function_expression(text)
    indefinite = bool(integral and integral.get("indefinite"))
    kind = "antiderivative" if indefinite else ("integral" if integral else "derivative")
    inverse_requested = bool(overrides.get("inverse_function")) or bool(
        re.search(r"反函数[^\n。；]{0,30}(?:导数|求导|切线|斜率)|(?:导数|求导)[^\n。；]{0,20}反函数", text))
    if kind == "derivative" and inverse_requested:
        kind = "inverse_derivative"
    raw_expr = expression_override or (str(integral.get("expression")) if integral else None) or function_expr
    teaching = False
    improper_upper = False
    upper_tex: str | None = None
    lower: float | None = 0.0
    upper: float | None = 1.0
    ask = ""
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []

    if not raw_expr:
        teaching = True
        kind = "integral"
        raw_expr = "x**2"
        lower, upper = 0.0, 1.0
        ambiguities.append(
            _ambiguity(
                "expression",
                "expression",
                "没有识别到可计算的函数或积分表达式。先核对题目，或使用明确标注的教学示例继续。",
                options=[
                    {"value": "use_example", "label": "使用教学示例 ∫₀¹ x² dx"},
                    {"value": "x**2", "label": "输入表达式，例如 x^2"},
                ],
            )
        )
    elif kind == "antiderivative":
        # 不定积分没有积分区间：不能擅自补 0 到 1，只记录被积函数与积分变量。
        lower, upper = None, None
    elif kind == "integral":
        lower = lower_override if lower_override is not None else integral.get("lower") if integral else None
        upper = upper_override if upper_override is not None else integral.get("upper") if integral else None
        if lower is None or upper is None:
            lower = 0.0 if lower is None else float(lower)
            upper = 1.0 if upper is None else float(upper)
            limit_options = [
                {"value": "0,1", "label": "0 到 1"},
                {"value": "-1,1", "label": "−1 到 1"},
            ]
            observed_limits = f"{lower:g},{upper:g}"
            if observed_limits not in {"0,1", "-1,1"}:
                limit_options.append(
                    {"value": observed_limits, "label": f"{lower:g} 到 {upper:g}（按已读到的值）"}
                )
            ambiguities.append(
                _ambiguity(
                    "limits",
                    "integral_limits",
                    "积分的上下限不够明确。请确认区间后再计算原题答案。",
                    options=limit_options,
                )
            )
        elif math.isinf(upper):
            # 只支持 +∞ 上限：图像与黎曼和需要一个有限截断区间，解析值仍按无穷积分计算。
            if upper > 0 and math.isfinite(lower):
                improper_upper = True
                upper = max(10.0, float(lower) + 8.0)
                upper_tex = r"+\infty"
            else:
                lower, upper = 0.0, 1.0
                ambiguities.append(
                    _ambiguity(
                        "limits",
                        "integral_limits",
                        "积分的无穷方向暂时无法直接图形化。请先确认一个有限展示区间。",
                        options=[
                            {"value": "0,1", "label": "0 到 1"},
                            {"value": "-1,1", "label": "−1 到 1"},
                        ],
                    )
                )
        else:
            lower = float(lower)
            upper = float(upper)
    else:
        lower = 0.0
        upper = 1.0

    variable = overrides.get("variable") or (integral or {}).get("variable") or (variables[:1] if variables else "x") or "x"
    if not re.fullmatch(r"[A-Za-z]", variable):
        variable = "x"
    try:
        parsed = parse_expression(raw_expr, (variable,))
    except ExprError as exc:
        teaching = True
        ambiguities.append(
            _ambiguity(
                "expression_parse",
                "expression",
                f"表达式“{raw_expr[:60]}”暂时无法解析（{exc}）。请核对符号或改写为 x^2、sin(x) 这样的形式。",
                options=[{"value": "use_example", "label": "使用教学示例"}],
            )
        )
        raw_expr = f"{variable}**2"
        parsed = parse_expression(raw_expr, (variable,))
        lower, upper = 0.0, 1.0
        if kind == "antiderivative":
            # 不定积分表达式无法解析时退回教学示例，明确要求学生核对原题。
            kind = "integral"
    else:
        # Original OCR stays in the source dossier; the executable model must
        # never send split function letters or implicit calls to the browser.
        raw_expr = expression_text(parsed)

    if kind == "integral":
        point = None
        # 无穷上限的截断区间较宽，默认分割数提高一点，避免首屏黎曼和显得离谱。
        n = 32 if improper_upper else 8
        upper_latex = upper_tex or f"{upper:g}"
        upper_label = "积分上限 b（图像截断）" if improper_upper else "积分上限 b"
        defaults = {"lower": float(lower), "upper": float(upper), "n": n}
        params = [
            _param("lower", "积分下限 a", "number", step=0.5),
            _param("upper", upper_label, "number", step=0.5),
            _param("n", "分割数 n", "integer", min_value=2, max_value=80, step=1),
        ]
        if improper_upper:
            params[1]["note"] = (
                f"原题上限为 +∞；这里只调整图像与黎曼和的截断范围（当前 {upper:g}）。"
            )
        formulas = [
            {
                "id": "integral",
                "tex": rf"\int_{{{lower:g}}}^{{{upper_latex}}} {to_latex(parsed)}\,\mathrm{{d}}{variable}",
                "plain": raw_expr,
                "role": "教学示例（未识别到原题公式）" if teaching else "识别出的原题公式",
            }
        ]
        conditions.append(
            _condition(
                "expression", "被积函数", raw_expr, kind="expr",
                provenance="teaching" if teaching else "original", source=source,
            )
        )
        conditions.append(
            _condition(
                "lower", "积分下限 a", float(lower), provenance="original" if integral and integral.get("lower") is not None else "supplement",
                source=source, step=0.5,
            )
        )
        if improper_upper:
            conditions.append(
                _condition(
                    "upper",
                    "积分上限 b",
                    "+∞",
                    kind="text",
                    provenance="original",
                    source=source,
                    editable=False,
                    note=f"原题上限为 +∞；图像与黎曼和在 b={upper:g} 处截断展示，解析值按无穷积分计算。",
                )
            )
            ambiguities.append(
                _ambiguity(
                    "improper_upper",
                    "expression",
                    f"原题上限为 +∞；图像与黎曼和在 b={upper:g} 处截断展示，解析值按无穷积分计算。",
                    severity="notice",
                )
            )
        else:
            conditions.append(
                _condition(
                    "upper", "积分上限 b", float(upper), provenance="original" if integral and integral.get("upper") is not None else "supplement",
                    source=source, step=0.5,
                )
            )
        conditions.append(
            _condition(
                "n", "数值分割数 n", n, kind="integer", provenance="supplement",
                source=source, editable=True, min_value=2, max_value=80, step=1,
                note="用于对照数值近似与解析值，不改变原题答案。",
            )
        )
    elif kind == "antiderivative":
        # 不定积分没有上下限：答案是一族原函数 F(x)+C，图形用常数 C 做上下平移。
        antiderivative_expr: str | None = None
        antiderivative_symbolic: sp.Expr | None = None
        if len(raw_expr) <= 200:
            try:
                symbol = sp.Symbol(variable, real=True)
                candidate = sp.integrate(parsed, symbol)
                if not candidate.has(sp.Integral):
                    antiderivative_symbolic = candidate
                    antiderivative_expr = expression_text(candidate)
            except Exception:  # noqa: BLE001 - 符号积分失败时保留被积函数与提示
                antiderivative_expr = None
        defaults = {"c": 0.0}
        params = [
            _param(
                "c", "积分常数 C", "number", min_value=-16, max_value=16, step=0.5,
                note="不定积分给出 F(x)+C；C 只改变曲线上下平移。",
            ),
        ]
        formulas = [
            {
                "id": "antiderivative",
                "tex": rf"\int {to_latex(parsed)}\,\mathrm{{d}}{variable}",
                "plain": raw_expr,
                "role": "识别出的原题公式",
            }
        ]
        conditions.extend(
            [
                _condition("expression", "被积函数", raw_expr, kind="expr", provenance="original", source=source),
                _condition(
                    "c", "积分常数 C", 0.0, provenance="supplement", source=source, step=0.5,
                    note="不定积分表示一族原函数；C 只改变图像上下平移，不改变原题答案。",
                ),
            ]
        )
    else:
        point = _extract_number(
            text,
            (
                r"(?:在|于)\s*[xX]\s*=?\s*(-?\d+(?:\.\d+)?)",
                r"[xX]\s*_?0?\s*=\s*(-?\d+(?:\.\d+)?)",
            ),
        )
        point_supplied = point is not None
        point = 0.0 if point is None else point
        defaults = {"point": float(point), "h": 0.1}
        # 求切线方程 → 答案给直线方程；笼统求导（无研究点）→ 答案给导函数表达式。
        if "切线" in text:
            ask = "tangent_line"
        elif not point_supplied and re.search(r"导数|求导|d\s*y\s*/\s*d\s*x|f\s*'\s*\(?\s*x", text):
            ask = "derivative_expr"
        else:
            ask = ""
        params = [
            _param("point", "研究点 x", "number", step=0.1),
            _param("h", "差商步长 h", "number", min_value=0.001, max_value=2, step=0.001),
        ]
        formulas = [
            {
                "id": "function",
                "tex": f"f({variable})={to_latex(parsed)}",
                "plain": raw_expr,
                "role": "教学示例（未识别到原题公式）" if teaching else "识别出的原题公式",
            }
        ]
        conditions.extend(
            [
                _condition("expression", "函数", raw_expr, kind="expr", provenance="original", source=source),
                _condition(
                    "point", "研究点 x", float(point),
                    provenance="original" if point_supplied else "supplement", source=source, step=0.1,
                ),
                _condition(
                    "h", "差商步长 h", 0.1, provenance="supplement", source=source,
                    min_value=0.001, max_value=2, step=0.001, note="用于观察割线趋近切线。",
                ),
            ]
        )

    if kind == "inverse_derivative":
        for parameter in params:
            if parameter.get("id") == "point":
                parameter["label"] = "反函数输入 x"
                parameter["note"] = "这里 x 是反函数的输入；内核先求 f(x0)=x 的原像，再计算 1/f'(x0)。"
            elif parameter.get("id") == "h":
                parameter["note"] = "仅用于原函数在对应点的差商核对。"
        for condition in conditions:
            if condition.get("id") == "point":
                condition["label"] = "反函数输入值 x"
                condition["note"] = "反函数在 x 处的导数 = 1 / f'(x0)，其中 f(x0)=x。"
            elif condition.get("id") == "expression":
                condition["label"] = "原函数 f(x)"

    if not any(item["id"] == "expression" for item in ambiguities) and teaching:
        ambiguities.append(
            _ambiguity(
                "teaching_model", "expression",
                "当前使用的是教学示例，原题文字与来源仍保留。请确认是否继续。",
                severity="notice", options=[{"value": "use_example", "label": "继续使用教学示例"}],
            )
        )

    model = {
        "engine": (
            "antiderivative_v1"
            if kind == "antiderivative"
            else "riemann_v1"
            if kind == "integral"
            else "tangent_v1"
        ),
        "subject": "calculus",
        "kind": kind,
        "ask": ask,
        "variable": variable,
        "expression": raw_expr,
        "formula_tex": (
            rf"\int {to_latex(parsed)}\,\mathrm{{d}}{variable}=F({variable})+C"
            if kind == "antiderivative"
            else rf"(f^{{-1}})'({variable})" if kind == "inverse_derivative"
            else f"f({variable})={to_latex(parsed)}"
        ),
        "defaults": defaults,
        "params": params,
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算表达式" if teaching else None,
    }
    if kind == "integral" and integral and not teaching:
        lower_raw, upper_raw = integral.get("lower_text"), integral.get("upper_text")
        if lower_raw and upper_raw and "∞" not in f"{lower_raw}{upper_raw}":
            try:
                parse_expression(str(lower_raw), (variable,))
                parse_expression(str(upper_raw), (variable,))
                model["exact_bounds"] = {"lower": str(lower_raw), "upper": str(upper_raw)}
            except Exception:  # noqa: BLE001 - 符号限留给核对面板
                pass
    if kind == "antiderivative":
        model["indefinite"] = True
        model["antiderivative_expression"] = antiderivative_expr
        model["plot_domain"] = _antiderivative_plot_domain(antiderivative_symbolic, variable)
    if kind == "inverse_derivative":
        model["inverse_function"] = True
    if improper_upper:
        model["improper_upper"] = True
        model["original_upper"] = "+∞"
        model["visual_upper"] = float(upper)
    _add_defaults_conditions(model, conditions, text, source, overrides)
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 最优化
# ---------------------------------------------------------------------------


def _optimization_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    raw_expr = str(overrides.get("expression") or "").strip() or None
    variables_text = str(overrides.get("variables") or "")
    extracted_expr, lhs_vars = _extract_function_expression(text)
    if not raw_expr:
        raw_expr = extracted_expr
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    formulas: list[dict[str, Any]] = []

    if not raw_expr:
        teaching = True
        raw_expr = "(x-3)**2"
        lhs_vars = "x"
        ambiguities.append(
            _ambiguity(
                "expression",
                "expression",
                "没有识别到目标函数。请核对题目，或使用明确标注的教学示例继续。",
                options=[
                    {"value": "use_example", "label": "使用教学示例 f(x)=(x−3)²"},
                    {"value": "(x-3)^2", "label": "输入目标函数，例如 (x-3)^2"},
                ],
            )
        )

    variables = [item for item in re.split(r"\s*,\s*", variables_text or lhs_vars or "x") if item]
    if not variables:
        variables = ["x"]
    if "y" in raw_expr and "y" not in variables:
        variables.append("y")
    variables = [v for v in variables if re.fullmatch(r"[xy]", v)]
    if not variables:
        variables = ["x"]

    try:
        parsed = parse_expression(raw_expr, variables)
    except ExprError as exc:
        teaching = True
        ambiguities.append(
            _ambiguity(
                "expression_parse",
                "expression",
                f"目标函数“{raw_expr[:60]}”无法解析（{exc}）。请核对符号或改写为 (x-3)^2。",
                options=[{"value": "use_example", "label": "使用教学示例 f(x)=(x−3)²"}],
            )
        )
        raw_expr = "(x-3)**2"
        variables = ["x"]
        parsed = parse_expression(raw_expr, variables)

    gradients = [sp.diff(parsed, sp.Symbol(var, real=True)) for var in variables]
    gradient_exprs = [str(sp.simplify(item)) for item in gradients]

    def initial_pattern(var: str) -> list[str]:
        return [
            rf"{var}\s*_?\s*0?\s*=\s*(-?\d+(?:\.\d+)?)",
            rf"(?:初始点|起点|初始值)\s*[^0-9\-]{{0,8}}{var}\s*=?\s*(-?\d+(?:\.\d+)?)",
        ]

    initial_values: list[float | None] = []
    for var in variables:
        value = _extract_number(text, initial_pattern(var))
        initial_values.append(value)
    if len(variables) == 1 and initial_values[0] is None:
        # “初始点为 0”也是常见写法。
        initial_values[0] = _extract_number(text, [r"(?:初始点|起点|初始值)\s*(?:为|是|:|=)?\s*(-?\d+(?:\.\d+)?)"])
    lr = _extract_number(text, [r"(?:学习率|步长)\s*(?:为|是|:|=)?\s*(\d+(?:\.\d+)?)"])
    iterations = _extract_int(text, [r"(?:迭代|执行)\s*(?:次数|步数)?\s*(?:为|是|:|=)?\s*(\d{1,3})"])
    # 区间/箱约束，仅对显式一维或二维范围生效；一般不等式会进入提示而不伪造。
    bounds: dict[str, list[float | None]] = {}
    for var in variables:
        range_match = re.search(
            rf"{var}\s*(?:∈|in|属于)\s*[\[\(]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[\]\)]",
            text,
        )
        inequality = re.search(
            rf"(-?\d+(?:\.\d+)?)\s*(<=?|≤)\s*{var}\s*(<=?|≤)\s*(-?\d+(?:\.\d+)?)",
            text,
        )
        if range_match:
            bounds[var] = [float(range_match.group(1)), float(range_match.group(2))]
        elif inequality:
            bounds[var] = [float(inequality.group(1)), float(inequality.group(4))]
            if "<" in (inequality.group(2) + inequality.group(3)):
                ambiguities.append(
                    _ambiguity(
                        f"strict_{var}",
                        "constraint",
                        f"{var} 的约束使用了严格不等式；数值探索按闭区间显示，是否接受这一近似？",
                        severity="notice",
                        options=[{"value": "accept", "label": "按闭区间近似探索"}],
                    )
                )
    if re.search(r"[<>≤≥]", text) and not bounds and "学习率" not in text:
        ambiguities.append(
            _ambiguity(
                "constraint_general",
                "constraint",
                "题目包含一般不等式约束。首版只对明确的箱约束（如 0≤x≤6）做可执行模型；其余约束会保留在来源中，不冒充已满足。",
                severity="notice",
                options=[{"value": "ack", "label": "知道了，先按无约束模型探索"}],
            )
        )

    defaults: dict[str, Any] = {}
    for index, var in enumerate(variables):
        value = initial_values[index]
        origin = value is not None
        defaults[f"{var}0"] = float(0.0 if value is None else value)
        conditions.append(
            _condition(
                f"{var}0", f"初始点 {var}₀", defaults[f"{var}0"],
                provenance="original" if origin else "supplement", source=source, step=0.1,
                note=None if origin else "题目未明确给出，按教学补充值初始化，可修改。",
            )
        )
    defaults["learning_rate"] = float(lr if lr is not None else 0.1)
    defaults["iterations"] = int(iterations if iterations is not None else 30)
    conditions.extend(
        [
            _condition(
                "learning_rate", "学习率 η", defaults["learning_rate"],
                provenance="original" if lr is not None else "supplement", source=source,
                min_value=0.001, max_value=2, step=0.001,
                note=None if lr is not None else "题目未给出学习率，按教学补充值 0.1 初始化。",
            ),
            _condition(
                "iterations", "迭代次数", defaults["iterations"], kind="integer",
                provenance="supplement", source=source, min_value=1, max_value=120, step=1,
                note="用于展示完整轨迹，不改变原题的目标函数。",
            ),
        ]
    )
    conditions.append(
        _condition(
            "expression", "目标函数", raw_expr, kind="expr",
            provenance="teaching" if teaching else "original", source=source,
        )
    )
    if bounds:
        conditions.append(
            _condition(
                "bounds", "箱约束", bounds, kind="json",
                provenance="original", source=source, editable=False,
                note="模型会把迭代点投影到该闭区间，并单独报告约束是否满足。",
            )
        )
        defaults["bounds"] = bounds

    formulas.append(
        {
            "id": "objective",
            "tex": f"\\min_{{{','.join(variables)}}}\\; {to_latex(parsed)}",
            "plain": raw_expr,
            "role": "识别出的目标函数",
        }
    )
    gradients_latex = ", ".join(
        rf"\frac{{\partial f}}{{\partial {var}}}={to_latex(expr)}"
        for var, expr in zip(variables, gradients)
    )
    formulas.append({"id": "gradient", "tex": gradients_latex, "plain": "梯度", "role": "求解器推导"})

    # 画布范围包含初始点与常见临界点，避免轨迹跑出主图。
    domain: dict[str, float] = {}
    for var in variables:
        try:
            critical = sp.solve([sp.diff(parsed, sp.Symbol(var, real=True))], [sp.Symbol(var, real=True)], dict=True)
        except (NotImplementedError, ValueError):
            critical = []
        candidates = [defaults[f"{var}0"]]
        for item in critical[:4]:
            val = safe_float(item.get(sp.Symbol(var, real=True)))
            if val is not None:
                candidates.append(val)
        if var in bounds:
            candidates.extend([val for val in bounds[var] if val is not None])
        low, high = min(candidates), max(candidates)
        if abs(high - low) < 2:
            low -= 2
            high += 2
        pad = max(1.0, (high - low) * 0.35)
        domain[f"{var}_min"] = low - pad
        domain[f"{var}_max"] = high + pad
        domain[f"{var}_critical"] = (low + high) / 2

    model = {
        "engine": "gradient_descent_v1",
        "subject": "optimization",
        "variables": variables,
        "expression": raw_expr,
        "grad_exprs": gradient_exprs,
        "gradient_tex": gradients_latex,
        "objective_tex": f"f({','.join(variables)})={to_latex(parsed)}",
        "defaults": defaults,
        "params": [
            *[
                _param(f"{var}0", f"初始点 {var}₀", "number", step=0.1)
                for var in variables
            ],
            _param("learning_rate", "学习率 η", "number", min_value=0.001, max_value=2, step=0.001),
            _param("iterations", "迭代次数", "integer", min_value=1, max_value=120, step=1),
        ],
        "bounds": bounds,
        "domain": domain,
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算目标函数" if teaching else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 数据结构与算法：BFS
# ---------------------------------------------------------------------------

_NODE = r"[A-Za-z0-9_\u4e00-\u9fa5]{1,10}"

# “边A→B”“结点B—C”这类写法会把量词/角色词粘在节点名前，先剥离再解析。
_GRAPH_ROLE_WORDS = r"(?:有向边|无向边|边|结点|节点|顶点)"


def _normalize_graph_text(text: str) -> str:
    return re.sub(rf"(?<![A-Za-z0-9]){ _GRAPH_ROLE_WORDS}(?=[A-Za-z0-9])", "", text)


def _parse_edges(text: str) -> tuple[list[dict[str, str]], bool]:
    text = _normalize_graph_text(text)
    edges: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    directed = bool(re.search(r"有向|directed|->|→|—>", text))

    def add(left: str, right: str) -> None:
        left, right = left.strip(), right.strip()
        if not left or not right or left == right:
            return
        key = (left, right)
        if key in seen:
            return
        seen.add(key)
        edges.append({"from": left, "to": right})

    for match in re.finditer(rf"({_NODE})\s*(?:->|→|—>|-->)\s*({_NODE})", text):
        add(match.group(1), match.group(2))
    for match in re.finditer(rf"({_NODE})\s*[-–—]\s*({_NODE})", text):
        # 避免把数字范围 0-1 误判为边。
        if re.search(r"\d", match.group(1) + match.group(2)):
            continue
        add(match.group(1), match.group(2))
    for match in re.finditer(rf"(?m)^\s*({_NODE})\s*[:：]\s*([^\n]+)$", text):
        left = match.group(1)
        rest = match.group(2)
        if not re.search(r"[,，、\s]", rest):
            continue
        for token in re.split(r"[,，、\s]+", rest):
            if re.fullmatch(_NODE, token):
                add(left, token)
    return edges, directed


def _algorithm_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .heap import build_heap
    heap = build_heap(text, source, {**dict(overrides.get('condition_values') or {}), **overrides})
    if heap is not None:
        return heap
    if not overrides.get("nodes") and not overrides.get("edges"):
        from .data_structures import build_ds_problem
        ds = build_ds_problem(text, source, overrides)
        if ds is not None:
            return ds
    edges, directed = _parse_edges(text)
    if overrides.get("edges"):
        edges = [dict(item) for item in overrides["edges"]]
    start = str(overrides.get("start") or "").strip() or None
    start_match = None
    if not start:
        plain_text = _normalize_graph_text(text)
        # 节点名可以是英文字母、数字或中文（甲、乙、A、1 等）。起点写法：
        # 起点/源点/出发点（为|是|:）甲；从甲出发/开始；以甲为起点；start=A。
        node_token = r"[A-Za-z0-9_\u4e00-\u9fa5]{1,10}"
        for pattern in (
            rf"(?:起点|起始节点|起始结点|起始顶点|开始节点|开始结点|源点|出发点)\s*(?:编号|代号)?\s*(?:为|是|[:：])?\s*({node_token})",
            rf"从\s*({node_token})\s*(?:出发|开始)",
            rf"以\s*({node_token})\s*(?:为|作为)?\s*(?:起点|源点|起始)",
            rf"\bstart\b\s*[:：=]?\s*({node_token})",
        ):
            start_match = re.search(pattern, plain_text, flags=re.I)
            if start_match:
                break
        if start_match:
            start = start_match.group(1)
    # 识别遍历算法：题目要求深度优先就用 DFS，不能退化为 BFS。
    # \b 在中文与字母之间不成立（中文也是 \w），改用字母断言。
    dfs_requested = bool(re.search(r"深度优先|(?<![A-Za-z])dfs(?![A-Za-z])", text, flags=re.I))
    algorithm = "dfs" if dfs_requested else "bfs"
    algorithm_name = "DFS" if dfs_requested else "BFS"
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    if not edges:
        teaching = True
        edges = [
            {"from": "A", "to": "B"},
            {"from": "A", "to": "C"},
            {"from": "B", "to": "D"},
            {"from": "C", "to": "D"},
            {"from": "D", "to": "E"},
        ]
        ambiguities.append(
            _ambiguity(
                "graph",
                "graph",
                "没有识别到图的边。可先核对图中连接关系，或使用明确标注的教学图继续。",
                options=[{"value": "use_example", "label": "使用教学图 A-B, A-C, B-D, C-D, D-E"}],
            )
        )
    nodes: list[str] = []
    for edge in edges:
        for key in ("from", "to"):
            if edge[key] not in nodes:
                nodes.append(edge[key])
    nodes = nodes[:20]
    if start and start not in nodes:
        # 中文起点捕获可能夹带修饰词（如“图中甲”“该点甲”）：取与节点名一致的结尾。
        suffix_hits = [node for node in nodes if start.endswith(node)]
        if suffix_hits:
            start = max(suffix_hits, key=len)
    if not start or start not in nodes:
        suggested = nodes[0] if nodes else "A"
        start = suggested
        if not teaching:
            ambiguities.append(
                _ambiguity(
                    "start",
                    "start",
                    f"没有明确识别出起点。请选择 {algorithm_name} 的起始节点。",
                    options=[{"value": node, "label": f"从 {node} 开始"} for node in nodes[:6]],
                )
            )
    conditions.extend(
        [
            _condition(
                "graph", "图的边", "；".join(f"{item['from']}→{item['to']}" for item in edges),
                kind="text", provenance="teaching" if teaching else "original", source=source, editable=False,
                note="可在“输入数据”中修改连接关系，修改后属于新情景。",
            ),
            _condition(
                "directed", "有向图", directed, kind="boolean",
                provenance="original" if directed else "inferred", source=source, editable=False,
            ),
            _condition(
                "start", "起点", start, kind="text",
                provenance="original" if start_match else "supplement", source=source,
                options=nodes[:8],
            ),
            _condition(
                "neighbor_order", "邻居顺序", "按节点编号升序（A→B→…）", kind="text",
                provenance="inferred", source=source, editable=False,
                note=f"执行顺序与{'栈' if dfs_requested else '队列'}规则会直接写入轨迹，动画与伪代码读取同一份记录。",
            ),
        ]
    )
    model = {
        "engine": "dfs_v1" if dfs_requested else "bfs_v1",
        "subject": "algorithm",
        "algorithm": algorithm,
        "nodes": [{"id": node, "label": node} for node in nodes],
        "edges": edges,
        "directed": directed,
        "start": start,
        "neighbor_order": "lexicographic_by_id",
        "defaults": {"start": start},
        "params": [_param("start", "起点", "enum", options=nodes[:8])],
        "teaching": teaching,
        "provenance_note": "教学示例：题目未提供可计算的图数据" if teaching else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    rule_tex = (
        r"\text{栈（LIFO）;\;邻居按编号升序;\;走到底再回溯}"
        if dfs_requested
        else r"\text{队列（FIFO）;\;入队即标记已访问;\;邻居按编号升序}"
    )
    rule_plain = (
        "DFS: 邻居按编号升序尝试；沿路径走到底再回溯"
        if dfs_requested
        else "BFS: 队列先进先出；入队时标记访问；邻居按编号升序"
    )
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": [
            {
                "id": f"{algorithm}_rule",
                "tex": rule_tex,
                "plain": rule_plain,
                "role": "算法规则",
            }
        ],
        "recognized": not teaching and not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 深度学习
# ---------------------------------------------------------------------------


def _parse_vector(raw: str) -> list[float] | None:
    try:
        value = ast.literal_eval(raw.replace("，", ",").replace("；", ","))
    except (ValueError, SyntaxError):
        return None
    if not isinstance(value, (list, tuple)) or not value:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _parse_matrix(raw: str) -> list[list[float]] | None:
    try:
        value = ast.literal_eval(raw.replace("，", ",").replace("；", ","))
    except (ValueError, SyntaxError):
        return None
    if not isinstance(value, (list, tuple)) or not value:
        return None
    result: list[list[float]] = []
    for row in value:
        if not isinstance(row, (list, tuple)) or not row:
            return None
        try:
            result.append([float(item) for item in row])
        except (TypeError, ValueError):
            return None
    return result


def _activation(name: str) -> str:
    lowered = name.lower()
    if "relu" in lowered:
        return "relu"
    if "sigmoid" in lowered:
        return "sigmoid"
    return "tanh"


def _deep_learning_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    teaching = False
    ambiguities: list[dict[str, Any]] = []
    conditions: list[dict[str, Any]] = []
    sizes: list[int] | None = None
    size_match = re.search(r"(\d+)\s*[-–—]\s*(\d+)(?:\s*[-–—]\s*(\d+))?", text)
    if size_match:
        sizes = [int(item) for item in size_match.groups() if item]
    if overrides.get("layers"):
        sizes = [int(item) for item in overrides["layers"]]
    if not sizes or len(sizes) < 2 or any(item < 1 or item > 8 for item in sizes):
        sizes = [2, 3, 1]
        ambiguities.append(
            _ambiguity(
                "network_shape",
                "layers",
                "没有识别到完整的网络结构。当前按明确标注的教学网络 2–3–1 展示，可核对后修改。",
                severity="notice",
                options=[{"value": "2-3-1", "label": "使用 2–3–1 教学网络"}],
            )
        )
    activation = _activation(text)
    input_match = re.search(r"(?:x|输入)\s*(?:=|为|:)\s*[\[\(（]\s*([^\]\)）]+)[\]\)）]", text)
    input_values = _parse_vector(input_match.group(1)) if input_match else None
    if input_values is None or len(input_values) != sizes[0]:
        input_values = [0.6, -0.2] if sizes[0] == 2 else [0.5] * sizes[0]
        ambiguities.append(
            _ambiguity(
                "input_vector",
                "input",
                f"题目没有给出与输入维度 {sizes[0]} 匹配的完整输入向量。当前使用教学输入，可修改。",
                severity="notice",
                options=[{"value": "use_example", "label": "使用教学输入"}],
            )
        )
    target = _extract_number(text, [r"(?:目标|标签|真实值|y)\s*(?:=|为|:)\s*(-?\d+(?:\.\d+)?)"])
    target_value = float(target if target is not None else 1.0)
    lr = _extract_number(text, [r"(?:学习率|步长)\s*(?:为|是|:|=)?\s*(\d+(?:\.\d+)?)"])
    epochs = _extract_int(
        text,
        [
            r"(?:epoch|训练轮|轮数|迭代)\s*(?:为|是|:|=)?\s*(\d{1,2})",
            r"训练\s*(\d{1,2})\s*轮",
        ],
        8,
    ) or 8
    weights: list[list[list[float]]] = []
    weight_source = "teaching"
    for index in range(len(sizes) - 1):
        match = re.search(
            rf"W\s*{index + 1}\s*=\s*(\[\[[\s\S]*?\]\])",
            text,
            flags=re.I,
        )
        parsed = _parse_matrix(match.group(1)) if match else None
        if parsed is not None and len(parsed) == sizes[index + 1] and all(len(row) == sizes[index] for row in parsed):
            weights.append(parsed)
            weight_source = "original"
        else:
            weights = []
            break
    if not weights:
        import numpy as np

        rng = np.random.RandomState(42)
        weights = [
            (rng.randn(sizes[index + 1], sizes[index]) * 0.8).round(4).tolist()
            for index in range(len(sizes) - 1)
        ]
        ambiguities.append(
            _ambiguity(
                "weights",
                "weights",
                "题目没有提供完整权重。已生成可复现的小型教学网络，权重来源会明确标注，不与原模型混称。",
                severity="notice",
                options=[{"value": "use_teaching_weights", "label": "使用可复现的教学权重"}],
            )
        )
    biases = [[0.0] * size for size in sizes[1:]]
    layers = [{"size": size, "activation": "input" if index == 0 else ("linear" if index == len(sizes) - 1 else activation)} for index, size in enumerate(sizes)]
    defaults: dict[str, Any] = {
        "learning_rate": float(lr if lr is not None else 0.1),
        "epochs": int(min(30, max(1, epochs))),
    }
    for index, value in enumerate(input_values):
        defaults[f"input_{index + 1}"] = value
    conditions.extend(
        [
            _condition("layers", "网络结构", "–".join(str(item) for item in sizes), provenance="original" if size_match else "teaching", source=source),
            _condition("activation", "隐藏层激活", activation, kind="text", provenance="original" if activation in text.lower() else "teaching", source=source),
            _condition(
                "input", "输入向量 x", input_values, kind="json",
                provenance="original" if input_match else "teaching", source=source,
            ),
            _condition(
                "target", "目标值 y", target_value,
                provenance="original" if target is not None else "teaching", source=source,
            ),
            _condition(
                "weights", "权重来源", "题目提供" if weight_source == "original" else "可复现教学初始化（seed=42）",
                kind="text", provenance="original" if weight_source == "original" else "teaching", source=source,
                editable=False,
            ),
            _condition(
                "learning_rate", "学习率 η", defaults["learning_rate"],
                provenance="original" if lr is not None else "supplement", source=source,
                min_value=0.001, max_value=2, step=0.001,
            ),
            _condition(
                "epochs", "训练轮数", defaults["epochs"], kind="integer",
                provenance="supplement", source=source, min_value=1, max_value=30, step=1,
            ),
        ]
    )
    params = [
        *[
            _param(f"input_{index + 1}", f"输入 x{index + 1}", "number", min_value=-3, max_value=3, step=0.1)
            for index in range(sizes[0])
        ],
        _param("learning_rate", "学习率 η", "number", min_value=0.001, max_value=2, step=0.001),
        _param("epochs", "训练轮数", "integer", min_value=1, max_value=30, step=1),
    ]
    model = {
        "engine": "mlp_v1",
        "subject": "deep_learning",
        "layers": layers,
        "weights": weights,
        "biases": biases,
        "input": input_values,
        "target": [target_value],
        "seed": 42,
        "activation": activation,
        "weight_source": weight_source,
        "defaults": defaults,
        "params": params,
        "teaching": teaching or weight_source != "original" or not size_match,
        "provenance_note": "教学示例：题目未提供完整网络结构或权重" if teaching or weight_source != "original" else None,
    }
    _add_defaults_conditions(model, conditions, text, source, overrides)
    formulas = [
        {
            "id": "network",
            "tex": r"z^{[l]}=W^{[l]}a^{[l-1]}+b^{[l]},\quad a^{[l]}=\sigma(z^{[l]})",
            "plain": "逐层前向：线性变换 + 激活",
            "role": "模型结构",
        },
        {
            "id": "loss",
            "tex": r"\mathcal{L}=\frac{1}{m}\sum_i(\hat y_i-y_i)^2",
            "plain": "均方误差损失",
            "role": "求解器推导",
        },
    ]
    return {
        "model": model,
        "conditions": conditions,
        "ambiguities": ambiguities,
        "formulas": formulas,
        "recognized": not any(item["severity"] == "blocking" and not item["resolved"] for item in ambiguities),
    }


# ---------------------------------------------------------------------------
# 统一构建
# ---------------------------------------------------------------------------


def _answer_overrides(text: str, overrides: dict[str, Any]) -> None:
    # 先应用“条件面板”的普通修正，再应用学生对歧义问题的直接回答；后者优先，
    # 因为核对问题的答案就是学生刚刚做出的明确决定（例如积分区间 0,2）。
    condition_values = overrides.get("condition_values") or {}
    if isinstance(condition_values, Mapping):
        expression = condition_values.get("expression")
        if isinstance(expression, str) and expression.strip():
            overrides["expression"] = expression.strip()
        for key in ("lower", "upper"):
            if key in condition_values:
                try:
                    overrides[key] = float(condition_values[key])
                except (TypeError, ValueError):
                    pass
        for key in ("point", "side", "order", "variable"):
            if key in condition_values and str(condition_values[key]).strip():
                overrides[key] = condition_values[key]
        if isinstance(condition_values.get("start"), str) and condition_values["start"].strip():
            overrides["start"] = condition_values["start"].strip()
        graph_source = condition_values.get("graph_edges")
        if isinstance(graph_source, str) and graph_source.strip():
            parsed, _directed = _parse_edges(graph_source)
            if parsed:
                overrides["edges"] = parsed
        layer_source = condition_values.get("layers")
        if isinstance(layer_source, str):
            sizes = [int(item) for item in re.findall(r"\d+", layer_source)]
            if len(sizes) >= 2:
                overrides["layers"] = sizes

    answers = overrides.get("ambiguity_answers") or {}
    for key, raw in answers.items():
        value = str(raw).strip()
        if not value:
            continue
        if key == "limits":
            parts = re.split(r"\s*[,，;；]\s*", value)
            if len(parts) == 2:
                try:
                    overrides["lower"] = float(parts[0])
                    overrides["upper"] = float(parts[1])
                except ValueError:
                    pass
        elif key in ("expression", "expression_parse"):
            if value != "use_example":
                overrides["expression"] = value
        elif key == "start":
            overrides["start"] = value
        elif key in ("network_shape",):
            sizes = [int(item) for item in re.findall(r"\d+", value)]
            if len(sizes) >= 2:
                overrides["layers"] = sizes
        elif key == "graph":
            parsed, _directed = _parse_edges(value)
            if parsed:
                overrides["edges"] = parsed
    # 后置的 _add_defaults_conditions 仍会读取 condition_values；把已经被明确
    # 回答覆盖的普通字段移除，避免它把学生刚确认的区间/起点改回旧值。
    if isinstance(condition_values, dict):
        if "limits" in answers:
            condition_values.pop("lower", None)
            condition_values.pop("upper", None)
        if "start" in answers:
            condition_values.pop("start", None)
    if str(overrides.get("subject") or "") == "unknown":
        overrides.pop("subject", None)


def _linear_algebra_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .linalg import build_linalg
    return build_linalg(text, source, overrides)


def _operating_system_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .opsys import build_os
    return build_os(text, source, overrides)


def _computer_organization_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .comp_org import build_comp_org
    return build_comp_org(text, source, overrides)


def _computer_network_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .computer_network import build_network
    return build_network(text, source, overrides)


def _physics_model(
    text: str,
    source: Mapping[str, Any],
    overrides: Mapping[str, Any],
) -> dict[str, Any]:
    from .physics import build_physics
    return build_physics(text, source, overrides)


BUILDERS = {
    "calculus": _calculus_model,
    "optimization": _optimization_model,
    "algorithm": _algorithm_model,
    "deep_learning": _deep_learning_model,
    "linear_algebra": _linear_algebra_model,
    "operating_system": _operating_system_model,
    "computer_organization": _computer_organization_model,
    "computer_network": _computer_network_model,
    "physics": _physics_model,
}


def _unknown_model(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    """Keep unsupported questions intact; never substitute an unrelated example."""
    return {
        "model": {"subject": "unknown", "engine": "unsupported_v1", "defaults": {}, "params": [], "teaching": False},
        "conditions": [], "formulas": [], "recognized": False,
        "ambiguities": [_ambiguity(
            "subject", "subject", "暂未识别到可执行的题目类型。请选择类型并核对原题文字、公式和条件后重建。",
            options=[],
        )],
    }


def _title_from(text: str, number: str | None) -> str:
    for line in text.splitlines():
        compact = re.sub(r"\s+", " ", line).strip()
        if len(compact) < 4:
            continue
        compact = NUMBER_MARKER.sub("", compact).strip()
        if len(compact) > 48:
            compact = compact[:47] + "…"
        return f"第 {number} 题 · {compact}" if number else compact
    return "未命名题目"


def build_problem(
    text: str,
    *,
    number: str | None = None,
    pages: Sequence[Mapping[str, Any]] | None = None,
    files: Sequence[Mapping[str, Any]] | None = None,
    subject_hint: str | None = None,
    title_override: str | None = None,
    overrides: Mapping[str, Any] | None = None,
    problem_index: int = 1,
) -> dict[str, Any]:
    """把一道题的原文转成可执行模型、条件、歧义与解答。"""

    override_values: dict[str, Any] = dict(overrides or {})
    _answer_overrides(text, override_values)
    source_pages = list(pages or [])
    ocr_empty = len(text.strip()) < 3 and any(page.get('image_key') for page in source_pages)
    source = _basic_source(source_pages[0]) if source_pages else {"file_id": None, "page": 1, "excerpt": text[:220]}
    method = _page_labels(source_pages, list(files or []))
    model_text = normalize_latex_prose(text)
    from .source_recovery import assess_text_quality
    quality = assess_text_quality(model_text, source_pages)
    if (override_values.get('ambiguity_answers') or {}).get('source_formula_confirmation') == 'confirmed':
        source_quality = quality
        quality = assess_text_quality(model_text, [
            {key: page.get(key) for key in ('file_id', 'page', 'image_key')} for page in source_pages
        ])
        quality.update(human_confirmed=True, source_quality=source_quality)
    has_images = any(page.get('image_key') for page in source_pages)
    if quality['untrusted'] and has_images:
        classified, confidence = 'unknown', 0.2
        subject = 'unknown'
        built = _unknown_model(model_text, source, override_values)
        built['ambiguities'].append(_ambiguity(
            'ocr_quality', 'ocr_quality',
            '识别文字质量不可信，已跳过本地建模；请以原图为准由 AI 重新转写后确认。',
            severity='info',
        ))
        built['recognition_skipped'] = True
    else:
        classified, confidence = classify_subject(text)
        subject = str(override_values.get("subject") or subject_hint or classified)
        if subject not in BUILDERS:
            # 暂未建立执行内核的科目保留科目名，状态按 pending_ai 处理。
            subject = subject if subject == "general" else (classified if classified in BUILDERS else "unknown")
        builder = BUILDERS.get(subject, _unknown_model)
        builder_text = model_text if model_text != text else text
        built = builder(builder_text, source, override_values)
        if (subject == "unknown" or built["model"].get("engine") == "unsupported_v1") and model_text != text:
            normalized_classified, normalized_confidence = classify_subject(model_text)
            normalized_subject = str(override_values.get("subject") or subject_hint or normalized_classified)
            if normalized_subject in BUILDERS:
                normalized = BUILDERS[normalized_subject](model_text, source, override_values)
                if normalized["model"].get("engine") != "unsupported_v1":
                    classified, confidence = normalized_classified, normalized_confidence
                    subject, built = normalized_subject, normalized
    model = built["model"]

    if ocr_empty or any(page.get("requires_formula_confirmation") or page.get('requires_source_review') for page in source_pages):
        built["ambiguities"].append(_ambiguity(
            "source_formula_confirmation", "source_formula",
            "图片或PDF中的公式可能存在识别误差。请对照原稿核对指数、分子分母、根号、极限与区间，必要时修正题目文字后确认。",
            options=[{"value": "confirmed", "label": "已对照原图核对并修正全部公式"}],
        ))

    # 学生已经作答的歧义项：保留答案，不再阻塞。
    answers = override_values.get("ambiguity_answers") or {}
    for item in built["ambiguities"]:
        if item["id"] in answers and str(answers[item["id"]]).strip():
            # New semantic builders consume corrections themselves. If a blocking
            # condition remains, arbitrary text must never turn it into a proof.
            if (
                item["id"].startswith("exam_")
                or item["id"] in (
                    "ds_blocked", "co_kind", "os_kind", "net_kind",
                    "heap_conditions", "subject", "solution", "solution_incomplete",
                )
            ):
                continue
            if item["id"] == "source_formula_confirmation" and answers[item["id"]] != "confirmed":
                continue
            if item['severity'] == 'blocking' and str(answers[item['id']]) not in {
                str(option['value']) for option in item.get('options') or []
            }:
                continue
            item["resolved"] = True
            item["answer"] = str(answers[item["id"]])
    blocking = [item for item in built["ambiguities"] if item["severity"] == "blocking" and not item["resolved"]]
    status = "ready" if not blocking else "needs_review"
    if subject not in BUILDERS:
        status = "pending_ai"
    elif (subject == "computer_network" and model.get("engine") == "net_unknown_v1") or (
            subject == "physics" and model.get("engine") == "physics_unknown_v1"):
        status = "unsupported"
    if quality['untrusted'] and has_images:
        status = "pending_ai"
    if status == "ready" and not override_values.get("subject") and not subject_hint and not model.get("teaching"):
        from .goal_actions import classify_goal_action, unsupported_reason
        action = classify_goal_action(text)
        boundary = unsupported_reason(text, subject=subject, model=model)
        proof_allowed = action == "proof" and model.get("engine") == "proof_v1"
        # 二次曲面识别等"指出/说明"题：space_v1 内核直接给出分类结论，
        # 属于确定任务而非概念辨析，不走 pending_ai。
        concept_answered = (
            model.get("engine") == "space_v1"
            and (model.get("conditions") or {}).get("geometry_kind") == "quadric_surface")
        explains_only = not re.search(
            r'求|计算|解|多少|次数|执行|遍历|调度|置换|出栈|入队|画|模拟|判断|运行', text)
        if boundary and (action in ("concept", "property") and explains_only
                         or action == "proof" and not proof_allowed and explains_only) and not concept_answered:
            status = "pending_ai"
            built["ambiguities"].append(_ambiguity(
                "intent", "intent", boundary, severity="info",
            ))
    if status == 'ready' and not model.get('teaching'):
        coverage = model_coverage_issues(text, model)
        if coverage:
            status = "pending_ai"
            built["ambiguities"].append(_ambiguity(
                "local_coverage", "local_coverage",
                '本地模型覆盖度不足：' + '；'.join(coverage) + '。已交给 AI 重新理解。',
                severity="info",
            ))

    answer_override = str(override_values.get("student_answer") or "").strip()
    if ocr_empty:
        status = 'needs_review'
    built_title = str(built.get("title") or "").strip()
    if title_override:
        title = title_override
    elif built_title:
        title = f"第 {number} 题 · {built_title}" if number else built_title
    else:
        title = _title_from(text, number)
    problem: dict[str, Any] = {
        "problem_id": f"prb_{problem_index}",
        "number": number,
        "title": title,
        "text": text.strip(),
        "subject": subject,
        "subject_label": SUBJECT_LABELS.get(subject, SUBJECT_LABELS["unknown"]),
        "confidence": confidence,
        "status": status,
        "source": {
            "page_from": int(source_pages[0].get("page") or 1) if source_pages else 1,
            "page_to": int(source_pages[-1].get("page") or 1) if source_pages else 1,
            "file_names": sorted({str(page.get("file_id")) for page in source_pages}),
            "label": method,
            "excerpt": re.sub(r"\s+", " ", text).strip()[:260],
        },
        "source_pages": [
            {
                "file_id": page.get("file_id"),
                "page": page.get("page"),
                "image_key": page.get("image_key"),
                "method": page.get("method"),
                "requires_formula_confirmation": bool(page.get("requires_formula_confirmation")),
                **{key: page[key] for key in (
                    'ocr_text', 'math_text', 'native_text', 'ocr_confidence', 'ocr_quality',
                    'requires_source_review', 'math_repaired_text', 'math_display_text',
                ) if key in page},
            }
            for page in source_pages
        ],
        "recognition": {
            "method": method,
            "raw_text": text.strip(),
            "ocr_empty": ocr_empty,
            "conditions": built["conditions"],
            "ambiguities": built["ambiguities"],
            "formulas": built["formulas"],
            "recognized_subject": classified,
            "ai_used": False,
            "quality": quality,
            "local_build_skipped": bool(built.get('recognition_skipped')),
            "model_text": model_text if model_text != text else "",
        },
        "model": model,
    }
    if answer_override:
        problem["recognition"]["reference_answer_text"] = answer_override
    return problem


def build_lab_document(
    *,
    lab_id: str,
    title: str,
    source: Mapping[str, Any],
    now_iso: str,
    files: Sequence[Mapping[str, Any]],
    subject_hint: str | None = None,
    max_problems: int = 12,
) -> dict[str, Any]:
    """拆分、识别并装配完整实验室文档（不含持久化）。"""

    split = split_problems(
        source.get("pages") or [],
        files,
        single_problem=bool(source.get("single_problem")),
    )
    if not split:
        raise RecognitionError("没有可识别的题目")
    if len(split) > max_problems:
        raise RecognitionError(f"拆分后共 {len(split)} 道题/小问，超过 {max_problems} 道上限，请分批提交，避免遗漏小问")
    problems = [
        build_problem(
            item["text"],
            number=item.get("number"),
            pages=item["pages"],
            files=files,
            subject_hint=subject_hint,
            problem_index=index + 1,
        )
        for index, item in enumerate(split)
    ]
    for problem, item in zip(problems, split):
        if item.get('subquestion'):
            _apply_subquestion_context(problem, item['subquestion'])
        _attach_solution(problem)
        problem["states"] = _default_state(problem)
    selected = problems[0]
    return {
        "schema_version": "lab.1",
        "lab_id": lab_id,
        "title": title.strip()[:120] or selected["title"],
        "created_at": now_iso,
        "updated_at": now_iso,
        "revision": 1,
        "source": {
            "files": list(files),
            "pages": list(source.get("pages") or []),
            "method": source.get("method"),
            "citation": _citation(source, files),
        },
        "problems": problems,
        "selected_problem_id": selected["problem_id"],
        "status": selected["status"],
        "subject": selected["subject"],
        "problem_count": len(problems),
        "capabilities": {
            "ai_configured": False,
            "note": "识别与求解均由本地确定性引擎完成；AI 增强只在后端配置明确开启后才会调用。",
        },
    }


def _citation(source: Mapping[str, Any], files: Sequence[Mapping[str, Any]]) -> str:
    names = [str(item.get("name")) for item in files if item.get("role") in ("problem", "courseware")]
    if not names:
        names = [str(item.get("name")) for item in files]
    pages = [int(page.get("page") or 0) for page in source.get("pages") or []]
    page_text = f"第 {min(pages)}–{max(pages)} 页" if pages else "原文"
    return f"{'、'.join(dict.fromkeys(names)) or '粘贴文本'} · {page_text}"


def _default_state(problem: Mapping[str, Any]) -> dict[str, Any]:
    model = problem["model"]
    params = dict(model.get("defaults") or {})
    scenario = {
        "id": "baseline",
        "name": "原题条件",
        "params": dict(params),
        "created_at": None,
        "kind": "baseline",
        "summary": "原题识别条件",
    }
    return {
        "params": params,
        "step": 0,
        "mode": "explore",
        "notes": "",
        "observations": [],
        "events": [],
        "scenarios": [scenario],
        "active_scenario_id": "baseline",
        "attempts": [],
        "evaluated": None,
    }


def select_problem(document: dict[str, Any], problem_id: str) -> dict[str, Any] | None:
    for problem in document.get("problems") or []:
        if problem.get("problem_id") == problem_id:
            return problem
    return None


def rebuild_problem(
    problem: dict[str, Any],
    *,
    files: Sequence[Mapping[str, Any]],
    text: str | None = None,
    subject: str | None = None,
    condition_values: Mapping[str, Any] | None = None,
    ambiguity_answers: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """按学生修正重新编译题目；保留原题文本与学生记录。"""

    overrides = {
        "subject": (subject or problem.get("subject")) if (subject or problem.get("subject")) != 'unknown' else None,
        "condition_values": dict(condition_values or {}),
        "ambiguity_answers": dict(ambiguity_answers or {}),
    }
    text_changed = text is not None and text.strip() != str(problem.get('text') or '').strip()
    rebuilt = build_problem(
        (text if text is not None else problem.get("text") or "").strip(),
        number=problem.get("number"),
        pages=[
            {
                "file_id": item.get("file_id"),
                "page": item.get("page"),
                "image_key": item.get("image_key"),
                "method": item.get("method"),
                "requires_formula_confirmation": bool(item.get("requires_formula_confirmation")),
                **{key: item[key] for key in (
                    'ocr_text', 'math_text', 'native_text', 'ocr_confidence', 'ocr_quality',
                    'requires_source_review', 'math_repaired_text', 'math_display_text',
                ) if key in item},
            }
            for item in problem.get("source_pages") or []
        ],
        files=files,
        subject_hint=None,
        title_override=None if text_changed else problem.get("title"),
        overrides=overrides,
        problem_index=int(str(problem.get("problem_id") or "prb_1").split("_")[-1])
        if str(problem.get("problem_id") or "").split("_")[-1].isdigit()
        else 1,
    )
    rebuilt["problem_id"] = problem["problem_id"]
    if not text_changed:
        rebuilt["title"] = problem.get("title") or rebuilt["title"]
    rebuilt["states"] = problem.get("states") or _default_state(rebuilt)
    # 条件结构可能变化：保留学生记录，但参数回到新的默认值，并新增“修正后”情景。
    state = rebuilt["states"]
    state["params"] = dict(rebuilt["model"].get("defaults") or {})
    state["step"] = 0
    baseline = {
        "id": "baseline",
        "name": "核对后条件",
        "params": dict(state["params"]),
        "created_at": None,
        "kind": "baseline",
        "summary": "学生核对后的原题条件",
    }
    state["scenarios"] = [baseline, *[item for item in state.get("scenarios") or [] if item.get("id") != "baseline"]]
    state["active_scenario_id"] = "baseline"
    if problem.get('subquestion'):
        _apply_subquestion_context(rebuilt, problem['subquestion'])
    _attach_solution(rebuilt)
    return rebuilt


def _attach_solution(problem: dict[str, Any]) -> None:
    """An unreadable formula or unsupported branch must remain reviewable."""
    from .solvers import solve_problem, SolveError
    if problem.get('status') == 'pending_ai' or problem.get('model', {}).get('engine') == 'unsupported_v1':
        problem['solution'] = {'answer': '', 'summary': '等待 AI 理解题目并建立可执行模型。', 'steps': [], 'limitations': []}
        return
    if any(item.get('severity') == 'blocking' and not item.get('resolved')
           for item in problem['recognition']['ambiguities']):
        problem['status'] = 'needs_review'
        problem['solution'] = {'answer': '', 'summary': '先核对原题公式与条件，再计算答案。', 'steps': [], 'limitations': []}
        return
    try:
        problem["solution"] = solve_problem(problem["model"])
        solution = problem["solution"]
        unfinished = (
            solution.get("solution_complete") is False
            or solution.get("solution_status") in ("incomplete", "undetermined", "divergent", "unsupported", "undefined")
        )
        if unfinished:
            problem["status"] = "needs_review"
            reason = (
                solution.get("incomplete_reason")
                or solution.get("reason")
                or solution.get("summary")
                or "当前结果尚未完成，不能自动判分。"
            )
            problem["recognition"]["ambiguities"] = [
                item for item in problem["recognition"]["ambiguities"]
                if item.get("id") != "solution_incomplete"
            ]
            problem["recognition"]["ambiguities"].append(_ambiguity(
                "solution_incomplete", "solution", str(reason), options=[]))
    except (SolveError, ValueError, TypeError, ExprError, ArithmeticError) as exc:
        problem["solution"] = {"answer": "", "summary": "请先核对原题公式、区间或分支。", "steps": [],
                               "limitations": [str(exc)]}
        problem["status"] = "needs_review"
        problem["recognition"]["ambiguities"].append(_ambiguity(
            "solution", "solution", f"当前条件暂时不能求解：{exc}。请修正题目后重新求解。", options=[]))


__all__ = [
    "RecognitionError",
    "SUBJECT_LABELS",
    "build_lab_document",
    "build_problem",
    "classify_subject",
    "rebuild_problem",
    "select_problem",
    "split_problems",
]
