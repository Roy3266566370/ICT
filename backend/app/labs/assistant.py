"""把确定性执行记录翻译成按当前步骤可核对的教学讲解。

本地导师是默认路径：不联网也能回答"为什么往这个方向走""下一步是什么""当前队列
是什么"。只有在后端显式开启模型增强时，才把同一份计算摘要发送给模型；失败自动
回退，数值永远以执行记录为准。
"""

from __future__ import annotations

import json
import math
import re
import sympy as sp
from typing import Any, Mapping, Sequence

from .ai import LabAI, LabAIUnavailable
from .expr import number_text, parse_expression, safe_float
from .solvers import evaluate_problem, solve_problem


def _fmt(value: object, digits: int = 5) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return number_text(float(value), digits)
    if value is None:
        return "—"
    return str(value)


def _frame(evaluation: Mapping[str, Any], step: int) -> tuple[int, Mapping[str, Any] | None]:
    frames = evaluation.get("trace") or []
    if not frames:
        return 0, None
    index = max(0, min(int(step), len(frames) - 1))
    return index, frames[index]


def _trace_brief(evaluation: Mapping[str, Any], limit: int = 12) -> list[dict[str, Any]]:
    frames = evaluation.get("trace") or []
    brief: list[dict[str, Any]] = []
    for frame in frames[max(0, len(frames) - limit):]:
        brief.append(
            {
                "index": frame.get("index"),
                "label": frame.get("label"),
                "detail": frame.get("detail"),
                "values": frame.get("values"),
            }
        )
    return brief


def _concept_hint(evaluation: Mapping[str, Any]) -> tuple[str, str, str]:
    subject = evaluation.get("subject")
    if evaluation.get("algorithm") == "heap":
        return ("先看当前堆数组、刚删除的元素和高亮的父子节点。",
                "删除堆顶后由末尾元素补根，再与优先孩子比较并向下筛选；相同孩子优先选左侧。",
                "只有恢复父子堆序才算完成一次删除；筛选中的临时状态可能不满足堆序。")
    if evaluation.get('task') == 'implicit_normal':
        return ('先代入研究点，确认其位于曲线上且分支明确。',
                '对 F(x,y)=0 隐式求导：切线斜率为 -Fx/Fy，法线方向是梯度 (Fx,Fy)。',
                '法线斜率为 Fy/Fx；Fx=0 时法线竖直，斜率不存在。')
    if evaluation.get('task') in ('geometric_area', 'area_volume'):
        return ('先核对区域边界与所有小问：几何面积和旋转体积是两个不同结果。',
                '几何面积在零点处分段取绝对值；绕 x 轴体积使用圆盘面积 πf(x)² 积分。',
                '原题若积分到无穷，图中只显示有限截断，解析结果仍按完整区间计算。')
    if subject == "optimization":
        return (
            "先看当前位置的梯度符号：正梯度表示函数沿正方向上升，负梯度表示沿负方向上升。梯度下降总沿负梯度移动。",
            "更新公式是 x_{k+1}=x_k-η∇f(x_k)；学习率决定每一步走多远，而不是改变方向。",
            "把当前梯度乘以学习率，得到这一步的位移；然后核对新位置的目标值与梯度范数是否变小。",
        )
    if subject == "calculus":
        return (
            "先确认图形阴影的面积、矩形分割方式和当前 n，再比较黎曼和与解析值。",
            "定积分是分割、取点、求和后取极限；数值近似依赖 n 与采样点，解析值由原函数相减得到。",
            "增大 n 观察误差下降；若误差不按预期下降，检查区间、被积函数或在区间内是否有无定义点。",
        )
    if subject == "algorithm":
        if evaluation.get("algorithm") == "dfs":
            return (
                "先看当前栈、已访问集合和栈顶节点；下一步动作只会来自这三者的状态。",
                "DFS 沿一条路径走到底再回溯；邻居按节点编号升序尝试，栈顶决定下一步访问谁。",
                "栈顶节点的邻居全部处理完才弹出回溯；访问顺序只在首次到达节点时记录。",
            )
        return (
            "先看队列、已访问集合和当前节点；下一步动作只会来自这三者的状态。",
            "BFS 用先进先出队列按层扩展；节点在入队时就标记为已访问，避免同一层重复入队。",
            "处理的邻居按节点编号升序排列；逐个判断是否已访问，再决定入队或跳过。",
        )
    if subject == "physics":
        return (
            "先画示意图并标出已知量与单位；力学题定正方向，光学题画法线与光路，近代题先把 nm 与 eV 换算清楚。",
            "按题型选规律：牛顿题做受力分解，功与能题比较能量收支，动量题先定正方向；波动光学用光程差与相位，几何光学用折射或薄透镜公式，近代用光子能量或衰变律。",
            "最后核对单位、方向与物理范围（角度、折射率、半衰期、波长与能量），并检查全反射、不能发生光电效应等边界结论。",
        )
    if subject == "linear_algebra":
        return (
            "先看当前主元所在的行与列、增广列的分隔线，以及这一步行变换的对象。",
            "高斯消元每列选一个非零主元，用倍加变换消元；换行只影响行列式符号，不影响方程解。",
            "最后一步要核对：方程组看残差，逆矩阵看 A·A⁻¹ 是否等于 I，行列式看换行次数。",
        )
    if subject == "computer_organization":
        return (
            "先看题面约定的位宽、码制（原码/反码/补码/移码）和当前步骤的输入；同一组位串在不同解释下真值不同。",
            "性能题统一用 T = 指令数 × CPI / 主频；数据表示按位权与码制规则；浮点数按 IEEE 754 字段拆分。",
            "最后核对单位、符号位、溢出来源与标志位；位串题可用画布中的位格逐位检查。",
        )
    if subject == "computer_network":
        kind = evaluation.get("net_kind")
        if kind == "architecture":
            return (
                "先按 OSI 或 TCP/IP 分层定位当前对象：应用、传输、网络、数据链路还是物理层。",
                "发送时逐层封装、接收时逐层解封装；设备按它处理的信息层次归类。",
                "协议是同等层之间的规则，服务是下层向上层提供的功能；不要把两者混为一谈。",
            )
        if kind == "performance":
            return (
                "先分清发送时延、传播时延和处理/排队时延：发送时延看数据量与速率，传播时延看距离与信号速度。",
                "时延带宽积 = 传播时延 × 带宽，单位是 bit；吞吐量取端到端瓶颈速率。",
                "比较交换方式时，电路交换先建立连接，报文交换整报文存储转发，分组交换按分组存储转发并可流水线。",
            )
        if kind == "physical":
            return (
                "先分清码元速率（Baud）和比特率（bps）：比特率 = 码元速率 × 每码元比特数。",
                "奈奎斯特用于理想无噪声低通信道，香农用于有噪声信道；同时给出时取较小上限。",
                "复用方式按频率、时间、波长或正交码划分信道，注意题目是否要求扣除保护间隔。",
            )
        if kind == "error_control":
            return (
                "先判断是奇偶校验、CRC 还是海明码：三种方法的校验位位置和检错能力不同。",
                "CRC 用模 2 除法，数据左移 r 位后除以生成多项式，余数就是校验位。",
                "海明码的校验位放在 2 的幂位置；接收端用综合因子定位单比特错误。",
            )
        if kind == "sliding_window":
            return (
                "先确认协议：停止等待、GBN 还是 SR；再检查发送/接收窗口与序号空间约束。",
                "GBN 接收窗口为 1，超时回退重传；SR 可缓存失序帧，只重传丢失帧。",
                "信道利用率用帧发送时间与 RTT 比较；窗口足够大时利用率饱和到 1。",
            )
        if kind == "mac":
            return (
                "先判断是 ALOHA、CSMA、CSMA/CD 还是 CSMA/CA：是否监听、是否边发边听、是否用 ACK。",
                "CSMA/CD 最小帧长 Lmin=2τR，争用期是往返传播时延 2τ。",
                "二进制指数退避：第 k 次冲突后从 0…2^min(k,10)−1 个时隙中随机选择。",
            )
        if kind == "ethernet":
            return (
                "交换机先学习源 MAC 与入端口，再查目的 MAC：已知定向转发，未知/广播除入端口外泛洪。",
                "每个交换机端口是一个冲突域；默认一个交换机是一个广播域，路由器和 VLAN 隔离广播域。",
                "VLAN 用逻辑划分隔离广播域；Trunk 端口通过 802.1Q 标签承载多个 VLAN。",
            )
        if kind == "ip":
            return (
                "IPv4 先写掩码：网络地址 = IP & 掩码，广播地址 = 主机位全 1，可用主机数 = 2^h−2。",
                "CIDR/VLSM 按需求从大到小分配；最长前缀匹配选择前缀最长且能匹配目的地址的路由。",
                "分片按 8 字节对齐，片偏移 = 数据起点 / 8；IPv6 用 :: 压缩最长连续零组。",
            )
        if kind == "network_layer":
            return (
                "先判断协议：ARP 解析 MAC、DHCP 分配地址、ICMP 报告差错、NAT 转换地址/端口。",
                "距离向量用 Bellman-Ford 迭代，链路状态用 Dijkstra，BGP 使用 AS-PATH 路径向量。",
                "更新路由表时先算候选距离 = 邻居距离 + 链路开销，再与当前路由比较。",
            )
        if kind == "transport":
            return (
                "先确认端口和协议：TCP/UDP 通过目的端口分用，套接字 = IP + 端口。",
                "TCP 序号按字节编号，SYN/FIN 各消耗一个序号；三次握手同步双方 ISN。",
                "四次挥手分别关闭两个方向，主动关闭方最后进入 TIME_WAIT 等待 2MSL。",
            )
        if kind == "tcp_control":
            return (
                "发送窗口 = min(接收窗口, 拥塞窗口)；窗口限制来自接收端和网络两侧。",
                "慢启动 cwnd 每 RTT 翻倍，到达 ssthresh 后进入拥塞避免，每 RTT 约加 1 MSS。",
                "超时令 ssthresh=cwnd/2、cwnd=1；3 个重复 ACK 触发快重传/快恢复。",
            )
        if kind == "application":
            return (
                "DNS 把域名解析为 IP；HTTP 非持久连接每个对象重新建 TCP，持久连接复用 TCP。",
                "网页获取时间按 TCP 握手、HTTP 请求/响应 RTT 和传输时间逐项累加。",
                "FTP 控制/数据连接分离；SMTP 发送邮件，POP3/IMAP 读取；URL 获取页面要综合 DHCP/ARP/DNS/TCP/HTTP。",
            )
        return (
            "先确认题目属于体系结构、性能、物理层、差错控制、滑动窗口、介质访问、以太网、IP、路由、传输层、拥塞控制还是应用层。",
            "每类题都有固定的确定性公式；先写公式，再代入题面给出的单位和数据。",
            "最后核对单位、传播速率、窗口约束和是否忽略处理/排队时延。",
        )
    if subject == "operating_system":
        kind = evaluation.get("os_kind")
        if kind == "page_replace":
            return (
                "先看当前访问的页面是否已在物理块中：在就是命中，不在就是缺页。",
                "FIFO 换出最早装入的页面，LRU 换出最近最久未使用的，OPT 换出未来最晚才会再用的；只有 FIFO 可能出现 Belady 异常。",
                "缺页时先看有没有空闲块；没有就按算法选被置换页面，再核对缺页次数是否与访问次数、命中次数守恒。",
            )
        if kind == "disk_schedule":
            return (
                "先看磁头当前位置、还没服务的请求，以及移动方向。",
                "FCFS 按到达顺序，SSTF 每次选最近的，SCAN 类沿一个方向服务到末端再换向；C-SCAN / C-LOOK 回程不服务请求。",
                "总移动距离 = 相邻两次磁头位置之差的绝对值之和；注意 SCAN 要走到磁盘末端，LOOK 只走到最远的请求。",
            )
        if kind == "banker":
            return (
                "先看 Work（可用资源）和每个进程的 Need：找 Need 不超过 Work 的进程。",
                "银行家算法的安全性检查：假定该进程运行完毕，把它的 Allocation 归还给 Work，再找下一个；全部能完成就是安全序列。",
                "有资源请求时，先检查 Request ≤ Need 与 Request ≤ Available，再试分配并重新做安全性检查，不安全就撤销。",
            )
        if kind == "os_basics":
            return (
                "先判断当前处于用户态还是内核态：特权指令和内核资源只能在内核态访问。",
                "进入内核态的入口是系统调用、中断和异常；陷阱/陷入是有意的同步异常，常用作系统调用。",
                "再核对返回路径：内核处理完成后恢复现场并返回用户态。",
            )
        if kind == "process_thread":
            return (
                "先看进程当前状态和触发事件：创建、调度、等待、唤醒、终止分别改变哪些状态。",
                "只有定义好的状态转换合法，例如运行→阻塞、阻塞→就绪；就绪不能直接变阻塞。",
                "进程是资源分配单位，线程是 CPU 调度单位；同进程线程共享地址空间和文件，栈/PC/寄存器独立。",
            )
        if kind == "sync":
            return (
                "先列出每个信号量的初值和含义：mutex=1，empty=缓冲区数，full=0。",
                "P 使 S 减一，S<0 时阻塞；V 使 S 加一，S≤0 时唤醒一个等待进程。",
                "检查 P 的顺序和成对性，尤其生产者—消费者中 P(empty/full) 必须在 P(mutex) 之前。",
            )
        if kind == "deadlock":
            return (
                "先检查四个必要条件：互斥、占有并等待、非抢占、循环等待。",
                "资源分配图有环不一定是死锁（多实例资源），单实例图有环即可判定可能死锁。",
                "避免用银行家算法检查安全性；预防是破坏必要条件；检测后可撤销进程、抢占资源或回滚。",
            )
        if kind == "memory_alloc":
            return (
                "先按算法扫描空闲区：首次取第一个足够大，最佳取最小足够大，最坏取最大，邻近从上一次位置继续。",
                "分配后切分空闲区，回收时合并相邻空闲区；动态分区会产生外部碎片。",
                "内存利用率 = 已分配/总内存；核对空闲区总和与请求是否守恒。",
            )
        if kind == "tlb":
            return (
                "先把虚拟地址拆成 VPN 与页内偏移，再用 VPN 查 TLB：命中直接得到页框号。",
                "TLB 缺失才逐级访问页表；单级页表 1 次、两级页表 2 次，命中时页表访问次数为 0。",
                "EAT = 命中率×(TLB+内存) + 缺失率×(TLB+页表级数×页表访问+内存)，再按缺页率叠加缺页处理时间。",
            )
        if kind == "file_dir":
            return (
                "权限位按文件主、同组、其他三组 rwx 解释；先看题目问哪一类用户、哪种操作。",
                "绝对路径从根目录开始、相对路径从当前目录开始，逐级读取目录项；目录项给出 inode 号，再读 inode。",
                "open 建立文件描述符→打开文件表→inode 关联；read/write 不再查目录；硬链接共享 inode，软链接保存目标路径。",
            )
        if kind == "file_alloc":
            return (
                "先看分配方式：连续分配记录起始块与长度；链接分配沿指针；索引分配查索引块；FAT 集中存放链接指针。",
                "多级索引先算每块可存指针数 P = 盘块大小 / 指针大小，再算直接块 + P + P² + P³。",
                "访盘次数：直接地址 1 次；一级间接 1 个索引块 + 1 个数据块；位示图 0 表示空闲。",
            )
        if kind == "device_mgmt":
            return (
                "磁盘访问时间 = 寻道时间 + 平均旋转延迟 + 传输时间；平均旋转延迟是半圈，30/转速 秒。",
                "单缓冲每块时间按 max(C,T)+M，双缓冲按 max(C+M,T)；注意 T、M、C 各代表哪一段。",
                "假脱机用输入井/输出井把独占设备虚拟成共享设备；设备分配用 SDT/DCT/COCT/CHCT 并检查安全性。",
            )
        return (
            "先看甘特图当前这一段：是哪个进程在运行，就绪队列里还有谁。",
            "FCFS 看到达顺序，SJF 看服务时间，SRTF 看剩余时间并允许抢占，RR 按时间片轮流，优先级调度看优先级数。",
            "周转 = 完成 − 到达，等待 = 周转 − 服务；先找各进程的完成时刻，再求平均值并核对服务时间守恒。",
        )
    return (
        "先看当前损失、输出和梯度范数，再比较与上一轮的变化。",
        "前向传播保存每层 z 与 a；反向传播从输出层按链式法则把误差传回各层。",
        "检查当前层的输入输出形状，按 W←W−η∇W 更新后重新计算损失。",
    )


def _next_step_view(evaluation: Mapping[str, Any], step: int) -> Mapping[str, Any] | None:
    frames = evaluation.get("trace") or []
    if step + 1 < len(frames):
        return frames[step + 1]
    return None


def _why_move(evaluation: Mapping[str, Any], step: int) -> str:
    frames = evaluation.get("trace") or []
    index, frame = _frame(evaluation, step)
    if not frame:
        return "当前还没有执行记录。先点击“下一步”或播放，让求解器产生轨迹。"
    if evaluation.get("subject") == "optimization":
        trajectory = evaluation.get("trajectory") or []
        if index < len(trajectory):
            current = trajectory[index]
            gradient = current.get("gradient") or []
            point = current.get("point") or []
            grad_text = ", ".join(_fmt(item) for item in gradient)
            first_gradient = gradient[0] if gradient else 0.0
            if first_gradient > 0:
                direction = "梯度为正，说明沿正方向函数值上升；更新朝负方向移动"
            elif first_gradient < 0:
                direction = "梯度为负，说明沿正方向函数值下降；更新朝正方向（负梯度）移动"
            else:
                direction = "梯度分量为 0，这个方向上的更新会停止"
            lr = (evaluation.get("params") or {}).get("learning_rate")
            step_size = None
            if gradient and lr is not None:
                step_size = abs(float(gradient[0]) * float(lr))
            previous = trajectory[index - 1] if index > 0 else None
            previous_text = (
                f"上一步位于 {previous.get('point')}；" if previous else "这是初始点；"
            )
            next_text = ""
            if index + 1 < len(trajectory):
                next_text = f"按当前规则，下一步会到达 {trajectory[index + 1].get('point')}。"
            return (
                f"当前是第 {index} 步：{previous_text}位置 {point}，梯度为 ({grad_text})，"
                f"目标值 f={_fmt(current.get('f'))}。{direction}。"
                f"学习率 η={_fmt(lr)}，本次位移约为 {_fmt(step_size)}。{next_text}"
            )
    if evaluation.get("subject") == "calculus" and frame.get("values"):
        values = frame["values"]
        return (
            f"当前停在 {frame.get('label')}：{frame.get('detail')}。"
            f"这一帧的分割数 n={values.get('n')}，黎曼和 {_fmt(values.get('sum'))}，"
            f"与解析值的误差 {_fmt(values.get('error'))}。改变 n 是观察“求和趋近积分”的直接方式。"
        )
    if evaluation.get("subject") == "algorithm":
        return (
            f"当前是“{frame.get('label')}”。队列为 [{', '.join(frame.get('queue') or [])}]，"
            f"已访问 {{{', '.join(frame.get('visited') or [])}}}。{frame.get('detail')}"
        )
    if evaluation.get("subject") == "deep_learning":
        values = frame.get("values") or {}
        return (
            f"当前是 {frame.get('label')}：损失 {_fmt(values.get('loss'))}，"
            f"权重范数 {_fmt(values.get('weight_norm'))}，本轮梯度范数 {_fmt(values.get('grad_norm'))}。"
            "损失下降说明沿负梯度更新有效；若损失上升，优先检查学习率是否过大。"
        )
    if evaluation.get("subject") == "linear_algebra":
        values = frame.get("values") or {}
        det = values.get("det")
        solution = [item for item in (values.get("solution") or []) if item is not None]
        extra = ""
        if det is not None:
            extra += f"累计主元乘积 {_fmt(det)}。"
        if solution:
            extra += f"已求出的分量：{', '.join(_fmt(item) for item in solution)}。"
        if values.get("op_label"):
            extra += f"本步运算：{values['op_label']}。"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    if evaluation.get("subject") == "operating_system":
        values = frame.get("values") or {}
        extra = ""
        if evaluation.get("os_kind") == "cpu_schedule":
            extra = f"当前时刻 {_fmt(values.get('time'))}，就绪队列 [{', '.join(values.get('ready') or [])}]。"
        elif evaluation.get("os_kind") == "page_replace":
            extra = f"物理块 {values.get('frames')}，累计缺页 {values.get('faults')} 次。"
        elif evaluation.get("os_kind") == "disk_schedule":
            extra = f"磁头在 {_fmt(values.get('head'))}，累计移动 {_fmt(values.get('total'))}。"
        elif evaluation.get("os_kind") == "banker":
            extra = f"当前 Work = {values.get('work')}。"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    if evaluation.get("subject") == "computer_organization":
        values = frame.get("values") or {}
        extra = ""
        for key in ("结果", "结果位串", "当前位串", "输出", "编码", "真值", "执行时间(s)"):
            if key in values:
                extra += f"{key}：{values[key]}；"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    if evaluation.get("subject") == "computer_network":
        values = frame.get("values") or {}
        extra = ""
        for key in ("总时延", "吞吐量", "时延带宽积", "最大数据率", "码字", "余数", "发送窗口",
                    "接收窗口", "发送码字", "最小帧长", "可选时隙", "利用率", "网络地址",
                    "广播地址", "片偏移", "下一跳", "cwnd", "ssthresh", "总时间", "转发表"):
            if key in values:
                extra += f"{key}：{values[key]}；"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    return str(frame.get("detail") or "当前步骤没有额外说明。")


def _solution_text(problem: Mapping[str, Any], evaluation: Mapping[str, Any]) -> str:
    solution = problem.get("solution") or {}
    lines = [str(solution.get("summary") or "完整讲解如下。")]
    answer = solution.get("answer")
    if answer:
        lines.append(f"原题结论：{answer}")
    for index, step in enumerate(solution.get("steps") or [], start=1):
        title = step.get("title") or f"第 {index} 步"
        detail = step.get("detail") or ""
        lines.append(f"{index}. {title}：{detail}")
    if solution.get("global_note"):
        lines.append(str(solution["global_note"]))
    if solution.get("limitations"):
        lines.append("边界：" + "；".join(str(item) for item in solution["limitations"]))
    return "\n".join(lines)


def _answer_for(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    question: str,
    mode: str,
    step: int,
    selected: Mapping[str, Any] | None,
    hint_level: int | None,
) -> str:
    subject = str(evaluation.get("subject") or "")
    index, frame = _frame(evaluation, step)
    solution = problem.get("solution") or {}
    lower = question.lower()
    if hint_level in (1, 2, 3):
        observation, concept, action = _concept_hint(evaluation)
        return [observation, concept, action][hint_level - 1] + _follow_up(mode)

    if not question.strip():
        if mode == "solution":
            return _solution_text(problem, evaluation)
        if mode == "guided":
            return _guided_prompt(evaluation, step) + _follow_up(mode)
        return _current_view(evaluation, step, frame) + _follow_up(mode)

    if any(word in question for word in ("答案", "结果", "原题", "最终")):
        text = f"原题结论：{solution.get('answer') or '暂未得到唯一结论'}。"
        steps = solution.get("steps") or []
        if steps:
            text += "\n依据：" + "；".join(str(item.get("title")) for item in steps[:4]) + "。"
        if solution.get("global_note"):
            text += "\n" + str(solution["global_note"])
        return text + _follow_up(mode)
    if evaluation.get("task") == "limit" and any(
        word in question for word in ("极限", "左右", "逼近", "趋近", "参数", "为什么")
    ):
        model = problem.get("model") or {}
        limit = evaluation.get("limit") or {}
        left = limit.get("left") or {}
        right = limit.get("right") or {}
        both = limit.get("value") or {}
        if model.get("modeling_task") == "parameter_limit":
            parameter = str(model.get("parameter") or "a")
            return (
                f"含参极限先求双侧极限，得到 {model.get('parameter_limit_left') or parameter}；"
                f"再令它等于题给极限 {model.get('target_value')}，解出 {parameter}={model.get('parameter_value')}，"
                f"最后代回原式复核。当前函数左极限 {left.get('text') or '未求出'}、"
                f"右极限 {right.get('text') or '未求出'}，双侧结论 {both.get('text') or '未求出'}。"
            ) + _follow_up(mode)
        return (
            f"当前极限点 {limit.get('point')}：左极限 {left.get('text') or '不适用'}，"
            f"右极限 {right.get('text') or '不适用'}，双侧结论 {both.get('text') or '未求出'}。"
            "数值逼近只用于核对，不能替代符号极限。"
        ) + _follow_up(mode)
    if evaluation.get("algorithm") == "heap":
        current = f"当前“{frame.get('label')}”：数组 {frame.get('array')}，已删除 {frame.get('deleted')}。" if frame else "尚无执行记录。"
        next_frame = _next_step_view(evaluation, index)
        next_text = f"下一步：{next_frame.get('label')}，{next_frame.get('detail')}。" if next_frame else "指定次数的删除已经完成。"
        return current + "\n删除堆顶会让末尾元素移到根，可能破坏堆序，需与优先孩子交换并继续向下筛选。\n" + next_text + _follow_up(mode)
    if evaluation.get('task') == 'implicit_normal':
        return f"原题法线：{solution.get('answer')}。\n" + _concept_hint(evaluation)[1] + '\n' + _concept_hint(evaluation)[2] + _follow_up(mode)
    if any(word in question for word in ("为什么", "为何", "方向", "移动", "梯度")) and subject == "optimization":
        return _why_move(evaluation, step) + _follow_up(mode)
    if any(word in question for word in ("下一步", "接下来", "怎么走", "如何继续")):
        next_frame = _next_step_view(evaluation, step)
        if next_frame is None:
            return "当前已经是执行记录的最后一步。可以回到开头单步回看，或修改参数建立对照情景。" + _follow_up(mode)
        return f"下一步：{next_frame.get('label')}。{next_frame.get('detail')}。" + _follow_up(mode)
    if any(word in question for word in ("收敛", "停止", "终止", "结束")):
        if subject == "optimization":
            return (
                f"本次执行的停止原因是：{evaluation.get('stop_reason')}。"
                f"当前梯度范数为 {_fmt((evaluation.get('current') or {}).get('grad_norm'))}。"
                "停止原因只说明这一次执行；是否全局最优需要另看驻点与凸性核对。"
            ) + _follow_up(mode)
        return f"执行记录的最后一步是：{'、'.join(item.get('label', '') for item in (evaluation.get('trace') or [])[-2:])}。" + _follow_up(mode)
    if any(word in question for word in ("约束", "可行", "满足")):
        relevant = [item for item in evaluation.get("checks") or [] if item.get("id") in ("constraints", "coverage", "shape")]
        if relevant:
            return "\n".join(f"{item.get('label')}：{item.get('status')}，{item.get('detail')}" for item in relevant) + _follow_up(mode)
        return "这个模型没有单独的可执行约束。原题中的不等式仍保留在条件与来源面板里，请核对后再解释结果。" + _follow_up(mode)
    if any(word in question for word in ("维度", "形状", "张量", "梯度", "反向", "损失")):
        if subject == "deep_learning":
            layers = evaluation.get("layers") or []
            shapes = [len(item.get("a") or []) for item in layers]
            return (
                f"当前网络各层激活维度为 {shapes}，损失为 {_fmt((evaluation.get('metrics') or [{}])[0].get('value'))}。"
                f"反向传播先算输出层误差，再逐层乘权重转置与激活导数；"
                f"梯度核对结果：{next((item.get('detail') for item in evaluation.get('checks') or [] if item.get('id') == 'gradient'), '未计算')}"
            ) + _follow_up(mode)
    if any(word in question for word in ("队列", "顺序", "已访问", "bfs", "dfs", "栈", "层")) and subject == "algorithm":
        if frame:
            is_dfs = evaluation.get("algorithm") == "dfs" and "stack" in frame
            structure = f"栈 [{', '.join(frame.get('stack') or [])}]" if is_dfs else f"队列 [{', '.join(frame.get('queue') or [])}]"
            order_word = "访问顺序" if is_dfs else "出队顺序"
            return (
                f"当前 {frame.get('label')}：{structure}，"
                f"已访问 {{{', '.join(frame.get('visited') or [])}}}，{order_word} {' → '.join(frame.get('order') or [])}。"
                f"{frame.get('detail')}"
            ) + _follow_up(mode)
    if selected and (selected.get("label") or selected.get("id")):
        return _explain_selected(selected, problem, evaluation) + _follow_up(mode)
    if mode == "solution":
        return _solution_text(problem, evaluation) + _follow_up(mode)
    return _current_view(evaluation, step, frame) + "\n\n" + _guided_prompt(evaluation, step) + _follow_up(mode)


def _current_view(evaluation: Mapping[str, Any], step: int, frame: Mapping[str, Any] | None) -> str:
    metrics = evaluation.get("metrics") or []
    metric_text = "；".join(f"{item.get('label')} {item.get('value')}" for item in metrics[:3])
    if frame:
        return f"当前停在“{frame.get('label')}”（第 {step} 个记录）。{frame.get('detail')}\n核心读数：{metric_text}。"
    return f"模型已就绪。核心读数：{metric_text}。"


def _guided_prompt(evaluation: Mapping[str, Any], step: int) -> str:
    subject = evaluation.get("subject")
    if evaluation.get('algorithm') == 'heap':
        return '先预测：根节点需要与哪个孩子交换？再单步核对，直到堆序恢复。'
    if evaluation.get('task') == 'implicit_normal':
        return '先确认研究点，再比较梯度方向与图中法线方向。'
    if subject == "optimization":
        return "先预测：下一步位置会比当前更接近驻点吗？再点击“下一步”核对。"
    if subject == "calculus":
        return "先观察：当前 n 的矩形总面积与曲线下面积差在哪一侧？再增大 n 验证。"
    if subject == "algorithm":
        if evaluation.get("algorithm") == "dfs":
            return "先预测：下一个被访问的节点是谁？在右侧提交预测，再单步核对。"
        return "先预测：下一个出队的节点是谁？在右侧提交预测，再单步核对。"
    if subject == "linear_algebra":
        return "先预测：这一列的主元在哪一行？消元后该行第一个非零元素会变成几？再单步核对。"
    if subject == "operating_system":
        kind = evaluation.get("os_kind")
        if kind == "page_replace":
            return "先预测：下一次访问是命中还是缺页？缺页时会换出哪个页面？再单步核对。"
        if kind == "disk_schedule":
            return "先预测：磁头下一步会去哪个磁道？这一步会移动多远？再单步核对。"
        if kind == "banker":
            return "先预测：当前 Work 能满足哪个进程的 Need？它完成后 Work 会变成多少？再单步核对。"
        if kind in ("os_basics", "process_thread", "sync", "deadlock", "memory_alloc"):
            return "先预测：当前状态/信号量/空闲区按题面规则下一步会如何变化？再单步核对。"
        if kind == "tlb":
            return "先预测：这次访问是 TLB 命中还是缺失？会访问几次页表？再单步核对。"
        if kind == "file_dir":
            return "先预测：当前权限位/路径查找会得到什么结论？再单步核对。"
        if kind == "file_alloc":
            return "先预测：下一个块落在直接区、几级间接或 FAT 的哪个位置？再单步核对。"
        if kind == "device_mgmt":
            return "先预测：这一步是寻道、旋转还是传输？时间如何累加？再单步核对。"
        return "先预测：这一段结束时哪个进程会被选中运行？甘特图上它会占多长？再单步核对。"
    if subject == "computer_organization":
        return "先预测：当前位串/字段按题面约定会得到什么结果？再单步核对公式、码制与标志位。"
    if subject == "computer_network":
        kind = evaluation.get("net_kind")
        if kind == "architecture":
            return "先预测：当前对象属于哪一层？封装后应增加哪类首部？再单步核对。"
        if kind == "performance":
            return "先预测：这个时间/积量应由哪两个量相乘或相除得到？再单步核对单位。"
        if kind == "physical":
            return "先预测：码元速率、比特率、信道容量之间该用哪个公式？再单步核对。"
        if kind == "error_control":
            return "先预测：校验位应该是 0 还是 1？接收端余数/综合因子会是多少？再单步核对。"
        if kind == "sliding_window":
            return "先预测：当前窗口的起点和终点在哪里？丢失帧会触发哪种重传？再单步核对。"
        if kind == "mac":
            return "先预测：这次退避可选哪些时隙？最小帧长由哪个争用期决定？再单步核对。"
        if kind == "ethernet":
            return "先预测：这个源 MAC 会学到哪个端口？目的未知时哪些端口会收到帧？"
        if kind == "ip":
            return "先预测：网络地址、广播地址或分片偏移应如何计算？再核对掩码和 8 字节对齐。"
        if kind == "network_layer":
            return "先预测：候选路由的距离是多少？是否会替换当前下一跳？再单步核对。"
        if kind == "transport":
            return "先预测：这个序号/确认号会推进到哪里？当前处于握手还是挥手状态？"
        if kind == "tcp_control":
            return "先预测：这一轮是慢启动还是拥塞避免？丢失后 cwnd 与 ssthresh 会变成多少？"
        if kind == "application":
            return "先预测：这一步需要几次 RTT 或哪种协议？再按 DNS/HTTP/邮件流程核对。"
        return "先预测：这一步按照哪条网络公式或协议规则得到什么结果？再单步核对。"
    return "先观察：损失在下降、停滞还是振荡？再改变学习率建立对照。"


def _follow_up(mode: str) -> str:
    if mode == "guided":
        return "\n\n你可以先写下自己的判断，再让我按层级给提示。"
    if mode == "solution":
        return "\n\n如果其中一步不清楚，可以选中公式或直接追问。"
    return ""


def _explain_selected(selected: Mapping[str, Any], problem: Mapping[str, Any], evaluation: Mapping[str, Any]) -> str:
    label = str(selected.get("label") or selected.get("id") or "所选内容")
    selected_id = str(selected.get("id") or "")
    conditions = (problem.get("recognition") or {}).get("conditions") or []
    for item in conditions:
        if item.get("id") == selected_id:
            provenance = item.get("provenance")
            note = item.get("note") or ""
            return (
                f"“{label}”当前取值为 {item.get('value')}。来源：{provenance}。{note}"
                "它是当前模型的一项输入；修改它会进入新的探索情景，原题答案仍保留。"
            )
    formulas = (problem.get("recognition") or {}).get("formulas") or []
    for item in formulas:
        if item.get("id") == selected_id:
            return f"“{label}”是识别出的表达式：{item.get('plain')}。图形、轨迹与答案读取同一模型。"
    return f"“{label}”是当前实验的一部分；它的数值已包含在步骤记录中：{evaluation.get('headline')}。"


def _compact_context(problem: Mapping[str, Any], evaluation: Mapping[str, Any], step: int) -> dict[str, Any]:
    solution = problem.get("solution") or {}
    index, frame = _frame(evaluation, step)
    return {
        "subject": evaluation.get("subject"),
        "problem_text": str(problem.get("text") or "")[:1200],
        "solution": {
            "summary": solution.get("summary"),
            "answer": solution.get("answer"),
            "steps": [
                {"title": item.get("title"), "detail": item.get("detail")}
                for item in (solution.get("steps") or [])[:6]
            ],
            "limitations": solution.get("limitations"),
        },
        "step": index,
        "frame": {
            "label": frame.get("label"),
            "detail": frame.get("detail"),
            "values": frame.get("values"),
            "queue": frame.get("queue"),
            "visited": frame.get("visited"),
        }
        if frame
        else None,
        "metrics": (evaluation.get("metrics") or [])[:5],
        "checks": (evaluation.get("checks") or [])[:5],
        "stop_reason": evaluation.get("stop_reason"),
        "trace_brief": _trace_brief(evaluation),
    }


def ask(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    *,
    question: str,
    mode: str,
    step: int,
    selected: Mapping[str, Any] | None = None,
    hint_level: int | None = None,
    use_ai: bool = False,
    ai: LabAI | None = None,
) -> dict[str, Any]:
    local_answer = _answer_for(problem, evaluation, question, mode, step, selected, hint_level)
    context = _compact_context(problem, evaluation, step)
    result: dict[str, Any] = {
        "answer": local_answer,
        "local": True,
        "context": context,
        "selected": selected,
    }
    if not use_ai:
        return result
    provider = ai or LabAI()
    if not provider.available():
        result["notice"] = "模型增强未开启，已使用本地导师讲解。"
        return result
    system = (
        "你是题目交互实验室的导师。只能使用用户消息中的计算记录解释，不要编造新的数值、"
        "定理或题目条件。回答用中文，先给结论，再给依据；数值保留计算记录中的精度。"
        "如果记录不足以回答，明确说明缺少什么，并建议学生查看哪一步。"
    )
    user = json.dumps(
        {
            "question": question,
            "mode": mode,
            "hint_level": hint_level,
            "selected": selected,
            "computed": context,
        },
        ensure_ascii=False,
    )
    try:
        completed = provider.complete(system=system, user=user)
    except LabAIUnavailable as exc:
        logger.info("题目实验室模型增强回退：%s", exc)
        result["notice"] = f"模型增强不可用（{exc}），已使用本地导师讲解。"
        return result
    result.update(
        {
            "answer": completed.text,
            "local": False,
            "provider": completed.provider,
            "model": completed.model,
            "notice": "模型增强回答；所有数值仍以左侧执行记录为准。",
        }
    )
    return result


def _parse_number(text: str) -> float | None:
    value = text.strip().replace("−", "-").replace(",", " ").replace("，", " ")
    fraction = re.search(r"(-?\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", value)
    if fraction:
        denominator = float(fraction.group(2))
        if denominator != 0:
            return float(fraction.group(1)) / denominator
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", value)
    if not match:
        return None
    try:
        parsed = float(match.group(0))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _numbers(text: str) -> list[float]:
    result: list[float] = []
    for match in re.finditer(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", text.replace("−", "-")):
        try:
            value = float(match.group(0))
        except ValueError:
            continue
        if math.isfinite(value):
            result.append(value)
    return result


def _scalar_answers(raw: str) -> list[float]:
    """Parse exact scalar expressions, keeping commas inside functions intact."""
    text = raw.strip().replace('，', ',').replace('；', ',').replace(';', ',')
    if text.startswith('[') and text.endswith(']'):
        text = text[1:-1]
    if text.startswith('(') and text.endswith(')'):
        depth = 0
        for i, char in enumerate(text):
            depth += (char == '(') - (char == ')')
            if depth == 0:
                if i == len(text) - 1:
                    text = text[1:-1]
                break
    parts, start, depth = [], 0, 0
    for i, char in enumerate(text):
        depth += (char == '(') - (char == ')')
        if char == ',' and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    if len(parts) > 16:
        return []
    values = []
    for part in parts:
        try:
            expr = parse_expression(part.strip().replace('E', 'e'), ('x',))
            value = safe_float(expr)
        except (ValueError, TypeError, ArithmeticError):
            return []
        if expr.free_symbols or value is None:
            return []
        values.append(value)
    return values


def _exam_attempt(problem: Mapping[str, Any], answer: str, field: str) -> dict[str, Any] | None:
    model, solution = problem.get('model') or {}, problem.get('solution') or {}
    task = model.get('task')
    detail, correct = '', False
    if model.get('engine') == 'heap_v1':
        choice = solution.get('answer_choice')
        wanted = [float(item) for item in solution.get('answer_order') or []]
        values = _scalar_answers(answer)
        correct = (bool(choice) and answer.strip().upper() == str(choice).upper()) or (
            len(values) == len(wanted) and bool(wanted) and values == wanted)
        if not wanted and answer.strip() in ('空堆', '[]', 'empty'):
            correct = True
        detail = '删除后的堆数组与逐步下滤记录一致。' if correct else f"请按堆的层序数组核对，原题结果为 {solution.get('answer')}。"
    elif task in ('geometric_area', 'area_volume', 'implicit_normal'):
        quantities = solution.get('quantities') or []
        if field in ('area', 'volume'):
            quantities = [q for q in quantities if q['id'] == field]
        wanted = [float(q['value']) for q in quantities]
        if task == 'implicit_normal':
            if model.get('vertical_normal'):
                correct = answer.strip() in ('不存在', '斜率不存在', '垂直', '竖直', 'undefined')
                detail = '法线为竖直直线，斜率不存在。'
            else:
                wanted = [float(solution['answer_value'])]
        if not detail:
            values = _scalar_answers(answer)
            correct = bool(wanted) and len(values) == len(wanted) and all(abs(a-b) <= max(1e-5,abs(b)*0.001) for a,b in zip(values,wanted))
            detail = '已逐项核对全部填写结果，与原题解析值一致。' if correct else f"请按题目要求逐项填写，原题结论：{solution.get('answer') or '尚未确认'}。"
    elif solution.get('stationary_points') and field in ('stationary_minimum', 'point'):
        values = _scalar_answers(answer)
        names = model.get('variables') or []
        if len(names) == 1 and len(values) == 1:
            minima = [
                item for item in solution.get('stationary_points') or []
                if item.get('classification') == 'minimum'
            ]
            targets = []
            for item in minima:
                try:
                    targets.append(float(sp.sympify((item.get('coordinates') or [None])[0])))
                except (TypeError, ValueError):
                    continue
            correct = any(
                abs(values[0] - target) <= max(1e-4, abs(target) * 0.01)
                for target in targets
            )
            detail = (
                '该坐标是对应极小值点；全部驻点分类请查看完整讲解。' if correct else
                '该坐标未落在当前已分类的极小值点上；请核对一阶、二阶导数或不可导点判别。'
            )
        else:
            try:
                expression = parse_expression(str(model['expression']), names)
                symbols = [sp.Symbol(name, real=True) for name in names]
                substitutions = dict(zip(symbols, values))
                if len(values) == len(symbols):
                    gradients = [safe_float(sp.diff(expression, symbol).subs(substitutions)) for symbol in symbols]
                    hessian = sp.hessian(expression, symbols).subs(substitutions)
                    correct = all(v is not None and abs(v) < 1e-4 for v in gradients) and hessian.is_positive_definite is True
            except (ValueError, TypeError, ArithmeticError):
                correct = False
            detail = ('该坐标是极小值点；本次仅核对一个点，全部周期族与鞍点分类请查看完整讲解。' if correct else
                      '该坐标未通过驻点与极小值判别，请核对梯度和 Hessian；鞍点不属于极小值点。')
    else:
        return None
    return {'correct': correct, 'expected': str(solution.get('answer') or ''), 'actual': answer,
            'field': field, 'kind': 'numeric',
            'feedback': ('判断：正确。\n' if correct else '判断：还需要核对。\n') + detail}


def _analysis_attempt(
    problem: Mapping[str, Any], answer: str, field: str
) -> dict[str, Any] | None:
    model = problem.get("model") or {}
    solution = problem.get("solution") or {}
    kind = model.get("analysis_kind") or model.get("task")
    if kind == "function_study":
        return {
            "correct": False, "expected": str(solution.get("answer") or ""), "actual": answer.strip(),
            "field": field or "analysis", "kind": "symbolic",
            "feedback": "区间研究题暂不自动判分；请逐项对照完整讲解中的单调区间、凹凸区间、极值、拐点与渐近线。",
        }
    if kind not in ("limit", "taylor", "higher_derivative"):
        return None
    actual = answer.strip()
    variable = str(model.get("variable") or "x")
    correct = False
    detail = ""
    expected = str(solution.get("answer") or "")
    if kind == "limit":
        status = str(solution.get("limit_status") or "")
        if status == "finite":
            value = solution.get("answer_value")
            student = _parse_number(actual)
            correct = (
                student is not None and value is not None
                and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            )
            detail = (
                f"极限值与符号单侧极限一致（{_fmt(float(value))}）。"
                if correct else f"该点极限为 {_fmt(float(value)) if value is not None else '未求出'}；请核对左右极限。"
            )
        elif status in ("does_not_exist", "infinite"):
            correct = bool(re.search(r"不存在|发散|无穷|∞|无极限", actual))
            detail = (
                "该题极限不存在或发散到无穷；不能只写一个有限数值。"
                if correct else "请区分有限极限、发散到 ±∞ 与左右极限不同导致的不存在。"
            )
        else:
            return None
    elif kind == "taylor":
        expected_polynomial = str(solution.get("polynomial") or "").strip()
        if not expected_polynomial:
            return None
        student_text = re.sub(r"^[^=]*=", "", actual).strip()
        student_text = re.sub(r"\s*\+?\s*[oO]\s*\(.*\)\s*$", "", student_text)
        try:
            student_expr = parse_expression(student_text, (variable,))
            target_expr = parse_expression(expected_polynomial.replace("^", "**"), (variable,))
            correct = sp.simplify(student_expr - target_expr) == 0
        except Exception:  # noqa: BLE001
            correct = False
        detail = (
            "泰勒多项式与符号展开一致。"
            if correct else "请按 (x-x₀) 的幂写出完整多项式，并保留题目要求的阶数。"
        )
    else:
        value = solution.get("derivative_value")
        if value is not None:
            student = _parse_number(actual)
            correct = student is not None and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            detail = (
                f"高阶导数值与符号求导一致（{_fmt(float(value))}）。"
                if correct else f"该点 {solution.get('derivative_order')} 阶导数为 {_fmt(float(value))}。"
            )
        else:
            expected_expression = str(solution.get("derivative_expression") or "").strip()
            if not expected_expression:
                return None
            try:
                student_expr = parse_expression(re.sub(r"^[^=]*=", "", actual).strip(), (variable,))
                target_expr = parse_expression(expected_expression.replace("^", "**"), (variable,))
                correct = sp.simplify(student_expr - target_expr) == 0
            except Exception:  # noqa: BLE001
                correct = False
            detail = (
                "高阶导数表达式与符号求导一致。"
                if correct else "请核对求导阶数，并用显式表达式写出高阶导数。"
            )
    return {
        "correct": correct,
        "expected": expected,
        "actual": actual,
        "field": field or "analysis",
        "kind": "symbolic",
        "feedback": ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail,
    }


def _antiderivative_attempt(
    problem: Mapping[str, Any], answer: str, field: str
) -> dict[str, Any] | None:
    """不定积分按“原函数族”核对：忽略常数 C，比较求导后是否回到被积函数。"""

    model = problem.get("model") or {}
    if model.get("kind") != "antiderivative":
        return None
    variable = str(model.get("variable") or "x")
    answer_text = answer.strip()
    expected = str((problem.get("solution") or {}).get("answer") or "")
    expected = expected or f"F({variable})=…+C"
    detail = ""
    correct = False
    if answer_text:
        candidate_text = (
            answer_text.replace("＋", "+")
            .replace("−", "-")
            .replace("²", "^2")
            .replace("³", "^3")
            .replace("⁴", "^4")
            .replace(" ", "")
        )
        candidate_text = re.sub(r"^[A-Za-z]\s*(?:\([^)]*\))?\s*=", "", candidate_text)
        candidate_text = re.sub(r"[+-]\s*[cC]\s*$", "", candidate_text)
        try:
            student = parse_expression(candidate_text, (variable,))
            target = parse_expression(str(model.get("expression") or ""), (variable,))
            symbol = sp.Symbol(variable, real=True)
            correct = sp.simplify(sp.diff(student, symbol) - target) == 0
            detail = (
                "把你写的式子求导，正好得到被积函数；常数 C 不影响求导结果，可以省略。"
                if correct
                else f"把你写的式子求导后没有回到被积函数；原题答案是一族原函数：{expected}。"
            )
        except Exception:  # noqa: BLE001 - 学生写法无法解析时给出可操作提示
            detail = "暂时无法解析这个原函数写法；可写成 x^3/3+C、sin(x)+C 这样的形式（C 可省略）。"
    else:
        detail = "请填写原函数，例如 x^3/3+C；只写数值无法表示不定积分的答案。"
    return {
        "correct": correct,
        "expected": expected,
        "actual": answer_text,
        "field": field or "antiderivative",
        "kind": "antiderivative",
        "feedback": ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail,
    }


def check_attempt(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    *,
    answer: str,
    field: str = "",
    kind: str = "numeric",
) -> dict[str, Any]:
    subject = str(problem.get("subject") or "")
    solution = problem.get("solution") or {}
    if not solution.get("answer") and problem.get("model"):
        try:
            solution = solve_problem(problem["model"])
        except Exception:  # noqa: BLE001 - 保留检查入口，反馈缺少结论
            solution = {}
    actual = answer.strip()
    if (problem.get("model") or {}).get("task") == "proof":
        return {
            "correct": False, "expected": str(solution.get("answer") or solution.get("summary") or ""),
            "actual": actual, "field": field or "proof", "kind": "proof",
            "feedback": "证明题不自动判分：请对照证明义务清单、证书条件或反例逐项核对；局部等式通过不等于整体证明成立。",
        }
    solution_status = str(solution.get("solution_status") or "")
    if solution_status in ("incomplete", "undetermined", "divergent", "unsupported", "undefined") or solution.get("solution_complete") is False:
        return {
            "correct": False,
            "expected": str(solution.get("answer") or ""),
            "actual": actual,
            "field": field or "numeric",
            "kind": kind,
            "feedback": "当前原题结论尚未完整求出或积分发散，不能自动判分；请先按完整讲解核对敛散性、驻点完整性与分类。",
        }
    if kind != 'draft':
        special = _exam_attempt(problem, actual, field)
        if special is not None:
            return special

    antiderivative = _antiderivative_attempt(problem, actual, field)
    if antiderivative is not None:
        return antiderivative

    analysis = _analysis_attempt(problem, actual, field)
    if analysis is not None:
        return analysis

    if kind == "draft":
        expected_text = str(solution.get("answer") or "")
        if subject == "algorithm" and evaluation.get("ds_kind") == "algo_design":
            return {
                "correct": False,
                "expected": expected_text,
                "actual": actual[:600],
                "field": field or "draft",
                "kind": kind,
                "feedback": ("判断：已收到作答。算法设计题为开放性题目，系统不做自动判分；"
                             "请对照“基本思想、伪代码（空位补全）、正确性说明、复杂度分析”四要素与"
                             "执行记录中的评分要点自评。"),
            }
        if subject == "algorithm":
            wanted = [str(item).upper() for item in solution.get("answer_order") or []]
            tokens = [token.upper() for token in re.findall(r"[A-Za-z0-9_一-龥]+", actual)]
            found = bool(wanted) and any(tokens[start:start + len(wanted)] == wanted for start in range(max(0, len(tokens) - len(wanted) + 1)))
            if not wanted:
                answer_value = solution.get("answer_value")
                found = answer_value is not None and any(
                    abs(candidate - float(answer_value)) <= max(1e-4, abs(float(answer_value)) * 0.01)
                    for candidate in _numbers(actual))
            return {
                "correct": bool(found),
                "expected": expected_text,
                "actual": actual[:600],
                "field": field or "draft",
                "kind": kind,
                "feedback": (
                    "判断：正确。草稿中找到了与执行结果一致的内容。"
                    if found
                    else "判断：还需要核对。草稿中未找到与执行结果一致的完整序列或数值；可对照完整讲解的执行记录。"
                ),
            }
        if subject == "operating_system" and solution.get("answer_sequence") and problem.get("model", {}).get("os_kind") == "banker":
            from .opsys import check_banker_sequence
            tokens = re.findall(r"[Pp]\d+", actual)
            valid, note = check_banker_sequence(problem["model"], tokens) if tokens else (False, "草稿中没有找到进程序列。")
            return {
                "correct": valid, "expected": expected_text, "actual": actual[:600], "field": field or "draft", "kind": kind,
                "feedback": ("判断：正确。" if valid else "判断：还需要核对。") + note,
            }
        expected_numbers: list[float] = []
        if subject == "optimization":
            expected_numbers.extend(float(item) for item in solution.get("answer_point") or [])
            if solution.get("answer_value") is not None:
                expected_numbers.append(float(solution["answer_value"]))
        elif subject == "deep_learning":
            losses = evaluation.get("loss_history") or []
            if losses:
                expected_numbers.append(float(losses[-1]))
        elif solution.get("answer_value") is not None:
            expected_numbers.append(float(solution["answer_value"]))
        candidates = _numbers(actual)
        matched = [
            expected
            for expected in expected_numbers
            if any(abs(candidate - expected) <= max(1e-4, abs(expected) * 0.01) for candidate in candidates)
        ]
        correct = bool(expected_numbers) and len(matched) == len(expected_numbers)
        if correct:
            feedback = (
                "判断：正确。草稿中找到了与原题解析结果一致的数值。"
                "这是数值核对，不替代步骤证明；可继续在完整讲解中逐步对照。"
            )
        else:
            missing = [item for item in expected_numbers if item not in matched]
            feedback = (
                "判断：还需要核对。草稿中未找到"
                + ("：" + "、".join(_fmt(item) for item in missing) if missing else "与原题一致的最终数值")
                + "。如果草稿只写了过程，请在“提交我的尝试”中填写最终数值。"
            )
        return {
            "correct": correct,
            "expected": expected_text,
            "actual": actual[:600],
            "field": field or "draft",
            "kind": kind,
            "feedback": feedback,
        }
    correct = False
    expected = ""
    detail = ""
    if subject == "algorithm" and problem.get("model", {}).get("ds_kind") == "algo_design":
        return {
            "correct": False,
            "expected": str(solution.get("answer") or ""),
            "actual": actual[:600],
            "field": field or "attempt",
            "kind": kind,
            "feedback": ("算法设计题为开放作答，系统不自动判分；请对照基本思想、伪代码（空位补全）、"
                         "正确性说明、复杂度分析四要素与参考答案自评。"),
            "detail": "开放作答不判分，按四要素自评。",
        }
    if subject == "algorithm":
        wanted = [str(item).upper() for item in solution.get("answer_order") or []]
        expected = " → ".join(solution.get("answer_order") or [])
        is_dfs = problem.get("model", {}).get("algorithm") == "dfs"
        if wanted:
            tokens = re.findall(r"[A-Za-z0-9_\u4e00-\u9fa5]+", actual.upper())
            correct = tokens == wanted
            detail = (
                "顺序与原题执行轨迹一致。" if correct else
                f"你的顺序是 {' → '.join(tokens) or '空'}；原题轨迹是 {expected or '未计算'}。"
                + (
                    "DFS 的访问顺序在首次到达节点时记录；回溯不重复计入。"
                    if is_dfs
                    else "BFS 的入队与出队顺序是两种不同记录，这里核对的是出队顺序。"
                )
            )
        else:
            answer_value = solution.get("answer_value")
            student = _parse_number(actual)
            expected = str(answer_value) if answer_value is not None else expected
            if student is None or answer_value is None:
                correct = False
                detail = "请填写与执行结果一致的数值（次数、地址等）。"
            else:
                tolerance = max(1e-6, abs(float(answer_value)) * 0.01)
                correct = abs(student - float(answer_value)) <= tolerance
                detail = ("数值与执行结果一致。" if correct
                          else f"你填的 {student} 与执行结果 {answer_value} 不一致。")
    elif subject == "deep_learning":
        losses = evaluation.get("loss_history") or []
        target_value = losses[-1] if losses else None
        expected = _fmt(target_value, 8)
        student = _parse_number(actual)
        if student is None or target_value is None:
            detail = "请填写当前训练轮结束后的 MSE 数值。"
        else:
            tolerance = max(1e-7, abs(float(target_value)) * 0.08)
            correct = abs(student - float(target_value)) <= tolerance
            detail = (
                f"你的损失 {_fmt(student)} 与执行记录一致（容差 8%）。"
                if correct
                else f"你的损失 {_fmt(student)} 与执行记录 {_fmt(target_value)} 的差为 {_fmt(abs(student - float(target_value)))}。"
                "可展开最后一层的中间值核对。"
            )
    elif subject == "optimization":
        point = solution.get("answer_point")
        value = solution.get("answer_value")
        expected = solution.get("answer") or ""
        if field == "value" or (field == "" and point is None):
            student = _parse_number(actual)
            correct = student is not None and value is not None and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            detail = (
                f"最优值与符号解一致（{_fmt(value, 8)}）。" if correct else
                f"目标函数最优值为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。"
            )
        else:
            student = _numbers(actual)
            wanted = [float(item) for item in point or []]
            correct = len(student) == len(wanted) and all(
                abs(student[index] - wanted[index]) <= max(1e-4, abs(wanted[index]) * 0.01)
                for index in range(len(wanted))
            )
            detail = (
                f"最优点与原题符号解一致（{wanted}）。" if correct else
                f"原题驻点为 {wanted}；你填写的是 {student}。注意：数值轨迹的终点不一定正好等于驻点。"
            )
    elif subject == "operating_system":
        expected = solution.get("answer") or ""
        model = problem.get("model") or {}
        if model.get("os_kind") == "banker":
            from .opsys import check_banker_sequence
            tokens = re.findall(r"[Pp]\d+", actual)
            correct, detail = check_banker_sequence(model, tokens) if tokens else (False, "请按完成顺序写出进程，例如 P1 → P3 → P4 → P0 → P2。")
            expected = " → ".join(solution.get("answer_sequence") or []) or expected
        elif (solution.get("answer_value") is None
              and (model.get("os_kind") in ("tlb", "file_dir", "file_alloc", "device_mgmt")
                   or (model.get("os_kind") == "page_replace" and not model.get("reference")))):
            return {
                "correct": False, "expected": expected_text, "actual": actual[:600],
                "field": field or "draft", "kind": kind,
                "feedback": ("判断：该题型为文字结论或存在多种教材口径，系统不自动判分；"
                             "请对照完整讲解中的条件、公式与结论逐条自评。"),
                "detail": "文字结论不自动判分，按完整讲解逐条核对。",
            }
        else:
            value = solution.get("answer_value")
            student = _parse_number(actual)
            unit = {"cpu_schedule": "平均等待时间", "page_replace": "缺页次数", "disk_schedule": "磁头总移动距离",
                    "tlb": "有效访问时间(ns)", "file_alloc": "块数或访盘次数",
                    "device_mgmt": "磁盘访问时间(ms)"}.get(model.get("os_kind"), "结果")
            if student is None or value is None:
                detail = f"请填写{unit}的数值（支持 8/3、2.6667 这样的写法）。"
            else:
                tolerance = max(1e-5, abs(float(value)) * 0.01)
                correct = abs(student - float(value)) <= tolerance
                detail = (
                    f"{unit}与执行记录一致（容差 1%）。" if correct else
                    f"执行记录得到{unit} {_fmt(value, 8)}；你填写的是 {_fmt(student)}。可回到轨迹逐步核对。"
                )
    elif subject == "physics":
        expected = str(solution.get("answer") or "")
        values = [float(item) for item in (solution.get("answer_values") or []) if isinstance(item, (int, float))]
        if not values and solution.get("answer_value") is not None:
            values = [float(solution["answer_value"])]
        student = _parse_number(actual)
        if student is None or not values:
            detail = "请填写一个数值结果（可填条纹间距、折射角、波长、遏止电压、半衰期等关键结果之一）。"
        else:
            correct_value = next((value for value in values if abs(student - value) <= max(1e-5, abs(value) * 0.01)), None)
            correct = correct_value is not None
            detail = (
                f"与内核关键结果之一一致（{_fmt(correct_value)}）。" if correct_value is not None else
                f"内核关键结果包括：{', '.join(_fmt(value) for value in values[:6])}；你填写的是 {_fmt(student)}。"
            )
    elif subject == "computer_organization":
        expected = str(solution.get("answer") or "")
        value = solution.get("answer_value")
        order = [str(item) for item in solution.get("answer_order") or []]
        compact_actual = re.sub(r"[\s_，,]+", "", actual).lower()
        compact_expected = re.sub(r"[\s_，,]+", "", expected).lower()
        matched_order = any(compact_actual == re.sub(r"[\s_，,]+", "", item).lower() for item in order)
        student = _parse_number(actual)
        numeric_ok = (student is not None and value is not None
                      and abs(student - float(value)) <= max(1e-8, abs(float(value)) * 0.01))
        text_ok = bool(compact_actual) and (compact_actual in compact_expected or matched_order)
        correct = bool(numeric_ok or text_ok)
        if correct:
            detail = "答案与确定性执行记录一致（数值或编码位串均可）。"
        else:
            detail = (f"执行记录结论：{expected[:220]}。你填写的是：{actual[:160]}。"
                      "数值题可填结果数值；位串题请填写对应编码，例如 11011010。")
    elif subject == "computer_network":
        expected = str(solution.get("answer") or "")
        value = solution.get("answer_value")
        order = [str(item) for item in solution.get("answer_order") or []]
        compact_actual = re.sub(r"[\s_，,]+", "", actual).lower()
        compact_expected = re.sub(r"[\s_，,]+", "", expected).lower()
        matched_order = any(compact_actual == re.sub(r"[\s_，,]+", "", item).lower() for item in order)
        student = _parse_number(actual)
        numeric_ok = (student is not None and value is not None
                      and abs(student - float(value)) <= max(1e-8, abs(float(value)) * 0.01))
        text_ok = bool(compact_actual) and (compact_actual in compact_expected or matched_order)
        if value is None and not order:
            return {
                "correct": False, "expected": expected_text, "actual": actual[:600],
                "field": field or "draft", "kind": kind,
                "feedback": ("判断：该网络题为文字结论或含多种口径，系统不自动判分；"
                             "请对照完整讲解中的公式、单位与结论逐条自评。"),
                "detail": "文字结论不自动判分，按完整讲解逐条核对。",
            }
        correct = bool(numeric_ok or text_ok)
        if correct:
            detail = "答案与确定性执行记录一致（数值或位串均可）。"
        else:
            detail = (f"执行记录结论：{expected[:240]}。你填写的是：{actual[:160]}。"
                      "数值题可填结果数值；编码/码字题请填写对应位串。")
    elif subject == "linear_algebra":
        expected = solution.get("answer") or ""
        wanted_vector = [float(item) for item in solution.get("answer_vector") or []]
        value = solution.get("answer_value")
        if wanted_vector:
            student = _numbers(actual)
            correct = len(student) == len(wanted_vector) and all(
                abs(student[index] - wanted_vector[index]) <= max(1e-4, abs(wanted_vector[index]) * 0.01)
                for index in range(len(wanted_vector))
            )
            detail = (
                "分量顺序与数值均与消元结果一致。" if correct else
                f"期望 {len(wanted_vector)} 个分量，按行/变量顺序填写；你写的是 {student}。"
            )
        else:
            student = _parse_number(actual)
            if student is None or value is None:
                detail = "请填写一个数值（支持 8/3、2.6667 这样的写法）。"
            else:
                tolerance = max(1e-5, abs(float(value)) * 0.01)
                correct = abs(student - float(value)) <= tolerance
                detail = (
                    f"与消元结果一致（容差 1%）。" if correct else
                    f"消元结果为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。"
                    "可回到轨迹核对换行次数与主元乘积。"
                )
    else:
        value = solution.get("answer_value")
        expected = solution.get("answer") or ""
        student = _parse_number(actual)
        if student is None or value is None:
            detail = "请填写一个数值（支持 8/3、2.6667 这样的写法）。"
        else:
            tolerance = max(1e-5, abs(float(value)) * 0.01)
            correct = abs(student - float(value)) <= tolerance
            detail = (
                f"与解析结果一致（容差 1%）。" if correct else
                f"解析值为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。可回到“完整讲解”核对原函数与上下限。"
            )
    feedback = ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail
    return {
        "correct": correct,
        "expected": expected,
        "actual": actual,
        "field": field or ("order" if subject == "algorithm" else "numeric"),
        "kind": kind,
        "feedback": feedback,
    }


def evaluate_for_context(problem: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    return evaluate_problem(problem.get("model") or {}, params)


__all__ = ["ask", "check_attempt", "evaluate_for_context"]
