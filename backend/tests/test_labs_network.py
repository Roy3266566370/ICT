"""计算机网络六组题型的确定性识别与求解。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, build_problem
from app.labs.solvers import solve_problem


def _problem(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "computer_network", (text, problem["subject"], problem["model"])
    _attach_solution(problem)
    assert problem["solution"].get("answer"), problem["solution"]
    return problem


def test_architecture_layers_encapsulation_and_devices():
    problem = _problem(
        "说明 OSI 七层模型和 TCP/IP 四层模型的对应关系，数据封装经过各层有什么变化，路由器工作在哪一层？")
    result = problem["model"]["net_result"]
    assert problem["model"]["net_kind"] == "architecture"
    assert result["stats"]["osi_layers"][0] == "应用层"
    assert "路由器工作在网络层" in problem["solution"]["answer"]
    assert "报文→报文段→分组→帧→比特" in problem["solution"]["answer"]


def test_performance_delay_and_delay_bandwidth_product():
    delay = _problem(
        "链路带宽为 100Mbps，发送 1000B 的数据，链路长 1000km，"
        "信号传播速率为 2×10^8 m/s，求发送时延、传播时延和总时延。")
    assert delay["solution"]["answer_value"] == pytest.approx(5.08)
    product = _problem("链路带宽为 100Mbps，传播时延为 2ms，求时延带宽积。")
    assert product["solution"]["answer_value"] == pytest.approx(200000.0)


def test_performance_switching_comparison():
    problem = _problem(
        "报文长 1000B，链路带宽 10Mbps，经过 3 段链路，每段传播时延 1ms，"
        "分组长 100B，求电路交换、报文交换和分组交换的总时延。")
    stats = problem["model"]["net_result"]["stats"]["switching"]
    assert stats["电路交换"] == pytest.approx(0.0038)
    assert stats["报文交换"] == pytest.approx(0.0054)
    assert stats["分组交换"] == pytest.approx(0.00396)
    assert "电路交换时延最小" in problem["solution"]["answer"]


def test_physical_bit_rate_nyquist_shannon_and_multiplexing():
    qam = _problem("采用 16QAM，波特率为 2400 Baud，求比特率。")
    assert qam["solution"]["answer_value"] == pytest.approx(9600)
    nyquist = _problem("某信道带宽为 4kHz，采用 16 种码元，求奈奎斯特最大数据率。")
    assert nyquist["solution"]["answer_value"] == pytest.approx(32000)
    shannon = _problem("某信道带宽为 3kHz，信噪比为 30dB，求香农最大数据率。")
    assert shannon["solution"]["answer_value"] == pytest.approx(3000 * 9.9668, rel=1e-3)
    tdm = _problem("4 路 TDM 复用，总速率为 8Mbps，求每路速率。")
    assert tdm["solution"]["answer_value"] == pytest.approx(2_000_000)


def test_parity_crc_and_hamming():
    parity = _problem("数据为 1011，采用奇校验，求校验位。")
    assert parity["solution"]["answer_value"] == pytest.approx(0)
    assert "码字 10110" in parity["solution"]["answer"]
    crc = _problem("数据为 1011001，生成多项式为 x^4+x+1，求 CRC 余数和发送码字。")
    assert crc["model"]["net_result"]["stats"]["crc"]["remainder"] == "1010"
    assert "10110011010" in crc["solution"]["answer"]
    hamming = _problem("数据为 1011，采用偶校验，求海明码。")
    assert hamming["model"]["net_result"]["stats"]["hamming"]["codeword"] == "0110011"
    check = _problem("数据为 1011，采用偶校验，求海明码。接收码字为 0110111，求综合因子和纠正结果。")
    assert check["model"]["net_result"]["stats"]["hamming"]["syndrome"] == 5
    assert "第 5 位出错" in check["solution"]["answer"]


def test_sliding_window_bounds_utilization_and_retransmission():
    gbn = _problem("采用 GBN，序号字段为 3 位，发送窗口最大为多少？")
    assert gbn["solution"]["answer_value"] == pytest.approx(7)
    sr = _problem("采用 SR，序号字段为 3 位，发送窗口最大为多少？")
    assert sr["solution"]["answer_value"] == pytest.approx(4)
    stop = _problem("采用停止等待，帧长 1000B，链路速率 10Mbps，RTT 为 10ms，求信道利用率。")
    assert stop["solution"]["answer_value"] == pytest.approx(100 * 0.8 / 10.8)
    trace = _problem("采用 GBN，发送窗口为 4，共 8 帧，第 2 帧丢失，说明窗口如何变化，重传几帧？")
    assert trace["model"]["net_result"]["stats"]["retransmissions"] == [2, 3, 4, 5]
    assert trace["solution"]["answer_value"] == pytest.approx(4)


def test_inverse_network_relations():
    crc = _problem("信息码为 1100，生成多项式为 x^3+x+1，求 CRC 校验码。")
    assert "1100010" in crc["solution"]["answer"]
    bits = _problem("采用 SR，发送窗口为 4，接收窗口为 4，序号至少几位？")
    assert bits["solution"]["answer_value"] == pytest.approx(3)
    baud = _problem("比特率为 9600bps，采用 16 种码元，求波特率。")
    assert baud["solution"]["answer_value"] == pytest.approx(2400)
    product = _problem("带宽 100Mbps，时延带宽积为 200000bit，求传播时延。")
    assert product["solution"]["answer_value"] == pytest.approx(2.0)
    contention = _problem("已知以太网最小帧长为 512bit，链路速率 10Mbps，求争用期。")
    assert contention["solution"]["answer_value"] == pytest.approx(0.0512)


def test_mac_aloha_min_frame_and_backoff():
    aloha = _problem("纯 ALOHA，G=0.5，求吞吐率。")
    assert aloha["solution"]["answer_value"] == pytest.approx(18.393972, rel=1e-5)
    frame = _problem("采用 CSMA/CD，链路速率 10Mbps，单程传播时延 25.6μs，求最小帧长。")
    assert frame["model"]["net_result"]["stats"]["csma_cd"]["min_bits"] == pytest.approx(512)
    backoff = _problem("第 3 次冲突后，10Mbps 以太网，求最大退避时间和可选时隙数。")
    assert backoff["model"]["net_result"]["stats"]["backoff"]["max_slot"] == 7
    assert backoff["solution"]["answer_value"] == pytest.approx(0.3584)


def test_network_concepts_and_utilization_route():
    parity = _problem("说明奇偶校验的原理和检错能力。")
    assert "只能检测奇数位错误" in parity["solution"]["answer"]
    crc = _problem("说明 CRC 的生成与校验过程。")
    assert "模 2 除法" in crc["solution"]["answer"]
    distance = _problem("最小海明距离为 4，检错纠错能力是多少？")
    assert "可检测 3 位错误" in distance["solution"]["answer"]
    utilization = _problem("带宽 100Mbps，吞吐量 80Mbps，求信道利用率。")
    assert utilization["model"]["net_kind"] == "performance"
    assert utilization["solution"]["answer_value"] == pytest.approx(80.0)


def test_pure_device_question_is_architecture():
    problem = _problem("路由器工作在哪一层？")
    assert problem["model"]["net_kind"] == "architecture"
    assert "网络层" in problem["solution"]["answer"]


def test_ethernet_switching_learning_and_vlan():
    problem = _problem(
        "交换机端口1连接A，端口2连接B，端口3连接C。A发送帧给B，B回复A，A发送广播帧，求转发表变化。")
    result = problem["model"]["net_result"]
    assert problem["model"]["net_kind"] == "ethernet"
    assert result["stats"]["forwarding_table"] == {"A": 1, "B": 2}
    assert "目的 B 未知" in problem["solution"]["answer"]
    vlan = _problem("VLAN 和 Trunk 端口如何隔离广播域？")
    assert "802.1Q" in vlan["solution"]["answer"]


def test_ipv4_subnet_fragmentation_and_longest_prefix():
    subnet = _problem("将 192.168.1.0/24 划分为 4 个子网，每个子网多少台可用主机？")
    result = subnet["model"]["net_result"]
    assert result["stats"]["subnet"]["network"] == "192.168.1.0"
    assert result["stats"]["subnet"]["broadcast"] == "192.168.1.255"
    assert subnet["solution"]["answer_value"] == pytest.approx(62)
    fragment = _problem("IP 数据报总长度为 4000B，MTU 为 1500B，首部 20B，求分片结果。")
    fragments = fragment["model"]["net_result"]["stats"]["fragments"]
    assert [item["offset"] for item in fragments] == [0, 185, 370]
    assert [item["mf"] for item in fragments] == [1, 1, 0]
    lpm = _problem(
        "路由表：10.0.0.0/8 → R1；10.1.0.0/16 → R2；10.1.2.0/24 → R3。"
        "目的地址 10.1.2.5，求最长前缀匹配。")
    assert "10.1.2.0/24" in lpm["solution"]["answer"] and "R3" in lpm["solution"]["answer"]
    aggregate = _problem("把 192.168.0.0/24 和 192.168.1.0/24 聚合。")
    assert "192.168.0.0/23" in aggregate["solution"]["answer"]


def test_ipv6_compression_and_expansion():
    problem = _problem("IPv6 地址 2001:0db8:0000:0000:0000:0000:0000:0001 如何压缩？")
    assert "2001:db8::1" in problem["solution"]["answer"]
    expanded = _problem("IPv6 地址 2001:db8::1 的完整形式是什么？")
    assert "2001:0db8:0000:0000:0000:0000:0000:0001" in expanded["solution"]["answer"]


def test_network_layer_protocols_and_distance_vector_update():
    concepts = _problem("说明 ARP、DHCP、ICMP、NAT 的作用。")
    answer = concepts["solution"]["answer"]
    assert "ARP" in answer and "DHCP" in answer and "ICMP" in answer and "NAT" in answer
    update = _problem(
        "R1的路由表为：N1 1 直连；N2 3 R2；N3 5 R3。"
        "邻居R2发来的距离向量为：N1 2；N2 1；N4 2。"
        "R1到R2的链路开销为1，求更新后的路由表。")
    stats = update["model"]["net_result"]["stats"]["updated"]
    assert stats["N2"] == (2, "R2")
    assert stats["N4"] == (3, "R2")
    assert stats["N1"] == (1, "直连")


def test_transport_ports_sequence_and_handshake():
    ports = _problem("端口80、端口50000分别属于哪类端口？")
    assert "熟知端口" in ports["solution"]["answer"] and "动态/私有端口" in ports["solution"]["answer"]
    sequence = _problem("TCP 初始序号为1000，发送500字节数据，求下一个序号和确认号。")
    assert sequence["solution"]["answer_value"] == pytest.approx(1500)
    handshake = _problem("客户端初始序号为1000，服务器初始序号为2000，描述三次握手。")
    assert "seq=1000" in handshake["solution"]["answer"]
    assert "ack=2001" in handshake["solution"]["answer"]


def test_tcp_congestion_control_and_send_window():
    timeline = _problem(
        "TCP 初始拥塞窗口为1 MSS，ssthresh为8 MSS，经过6个RTT，"
        "第4个RTT发生超时，求最终cwnd和ssthresh。")
    stats = timeline["model"]["net_result"]["stats"]
    assert stats["final_cwnd"] == pytest.approx(4)
    flow = _problem("接收窗口为10 MSS，拥塞窗口为4 MSS，求发送窗口。")
    assert flow["solution"]["answer_value"] == pytest.approx(4)
    fast = _problem(
        "TCP 初始拥塞窗口为8 MSS，ssthresh为8 MSS，第2个RTT收到3个重复ACK，求之后cwnd。")
    assert fast["model"]["net_result"]["stats"]["final_cwnd"] in (4, 8)


def test_application_http_dns_and_url_pipeline():
    non_persistent = _problem("网页有4个对象，RTT为10ms，采用非持久连接，求获取网页时间。")
    assert non_persistent["solution"]["answer_value"] == pytest.approx(80)
    pipelined = _problem("网页有4个对象，RTT为10ms，采用持久连接并使用流水线，求获取网页时间。")
    assert pipelined["solution"]["answer_value"] == pytest.approx(20)
    dns = _problem("说明 DNS 递归查询和迭代查询的区别。")
    assert "递归" in dns["solution"]["answer"] and "迭代" in dns["solution"]["answer"]
    url = _problem("输入网址后到页面显示经过哪些协议？")
    assert "DNS" in url["solution"]["answer"] and "HTTP" in url["solution"]["answer"]


def test_missing_network_subkind_blocks_honestly():
    problem = build_problem("计算机网络有哪些应用？")
    assert problem["subject"] == "computer_network"
    assert problem["model"].get("net_kind") is None
    assert problem["status"] == "unsupported"


def test_network_result_embeds_for_replay():
    problem = _problem("数据为 1011，采用偶校验，求海明码。")
    assert problem["model"]["net_result"]["engine"] == "net_error_v1"
    assert solve_problem(problem["model"])["answer"] == problem["solution"]["answer"]


def test_408_nyquist_composite_qam_levels():
    """2009-34：相位×振幅复合 QAM 应推导为 16 个码元电平。"""
    problem = _problem(
        "在无噪声情况下，若某通信链路的带宽为3kHz，采用4个相位，每个相位具有4种振幅的QAM调制技术，"
        "则该通信链路的最大数据传输速率是？")
    assert problem["model"]["net_kind"] == "physical"
    assert problem["solution"]["answer_value"] == pytest.approx(24000)


def test_408_gbn_cumulative_ack_retransmission():
    """2009-35：GBN 累积确认——只收到 0、2、3 号帧确认即重发 4~7。"""
    problem = _problem(
        "数据链路层采用后退N帧（GBN）协议，发送方已经发送了编号为0~7的帧。"
        "当计时器超时时，若发送方只收到0、2、3号帧的确认，则发送方需要重发的帧数是？")
    result = problem["model"]["net_result"]
    assert result["stats"]["retransmissions"] == [4, 5, 6, 7]
    assert problem["solution"]["answer_value"] == pytest.approx(4)


def test_408_csmacd_frame_delta_distance():
    """2009-37：最小帧长减少 800bit → 最远站点距离减少 80m。"""
    problem = _problem(
        "在一个采用CSMA/CD协议的网络中，传输介质是一根完整的电缆，传输速率为1Gbps，"
        "电缆中的信号传播速度是200 000km/s。若最小数据帧长度减少800比特，"
        "则最远的两个站点之间的距离至少需要？")
    result = problem["model"]["net_result"]
    assert result["stats"]["csma_cd"]["delta_m"] == pytest.approx(-80)
    assert problem["solution"]["answer_value"] == pytest.approx(80)


def test_408_subnet_explicit_mask_fixed_length():
    """2010-37：/24 母网 + 独立 .248 掩码 → 32 个 /29 子网、每子网 6 台可用。"""
    problem = _problem(
        "某网络的IP地址空间为192.168.5.0/24，采用定长子网划分，子网掩码为255.255.255.248，"
        "则该网络中的最大子网个数、每个子网内的最大可分配IP地址个数分别为？")
    result = problem["model"]["net_result"]
    assert result["stats"]["subnets"][0]["network"] == "192.168.5.0"
    assert result["stats"]["subnets"][0]["hosts"] == 6
    assert "32 个 /29 子网" in problem["solution"]["answer"]
    assert "6 台可用主机" in problem["solution"]["answer"]
    assert problem["solution"]["answer_value"] == pytest.approx(32)


def test_408_tcp_multi_segment_ack():
    """2009-38：两段 TCP（300B+500B，首段序号 200）→ 累积确认号 1000。"""
    problem = _problem(
        "主机甲向主机乙发送两个连续的TCP段，分别包含300字节和500字节的有效载荷，"
        "第一个段的序列号为200，主机乙正确接收到两个段后，发送给主机甲的确认序列号是？")
    result = problem["model"]["net_result"]
    assert result["stats"]["segments"]["ack"] == 1000
    assert problem["solution"]["answer_value"] == pytest.approx(1000)


def test_408_tcp_timeout_restart_slow_start():
    """2009-39：cwnd=16KB 超时 → ssthresh=8、cwnd=1；4 个成功 RTT 后 cwnd=9KB。"""
    problem = _problem(
        "一个TCP连接总是以1KB的最大段长发送TCP段，发送方有足够多的数据要发送。"
        "当拥塞窗口为16KB时发生了超时，如果接下来的4个RTT时间内TCP段的传输都是成功的，"
        "那么当第4个RTT时间内发送的所有TCP段都得到肯定应答时，拥塞窗口大小是？")
    result = problem["model"]["net_result"]
    assert result["stats"]["final_cwnd"] == pytest.approx(9)
    assert "9 KB" in problem["solution"]["answer"]
    assert problem["solution"]["answer_value"] == pytest.approx(9)
