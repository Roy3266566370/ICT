"""计算机网络题目的识别与确定性求解。

覆盖六组 408 题型，全部产出可逐步回放的确定性轨迹：

- ``architecture``：OSI / TCP-IP 分层、协议与服务、封装/解封装、设备所属层次；
- ``performance``：带宽、吞吐量、发送/传播时延、时延带宽积、三种交换方式；
- ``physical``：编码与调制、码元与比特率、奈奎斯特与香农公式、信道复用；
- ``error_control``：奇偶校验、CRC 生成与校验、海明码构造/检错/纠错；
- ``sliding_window``：停止等待、GBN、选择重传、窗口与序号空间、利用率、丢帧重传；
- ``mac``：ALOHA、CSMA、CSMA/CD、CSMA/CA、最小帧长与二进制指数退避。

约定（信道速率十进制、存储容量二进制、传播速率缺省值等）都会写进结果说明；
条件不足时返回阻塞模型，不编造数据。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

MAX_BITS = 256

KIND_LABELS = {
    "architecture": "网络体系结构",
    "performance": "性能与交换",
    "physical": "物理层",
    "error_control": "差错检测与纠正",
    "sliding_window": "可靠传输与滑动窗口",
    "mac": "介质访问控制",
    "ethernet": "以太网、交换机与 VLAN",
    "ip": "IPv4 与 IPv6",
    "network_layer": "网络层协议与路由",
    "transport": "UDP 与 TCP 基础",
    "tcp_control": "TCP 流量与拥塞控制",
    "application": "应用层与网络综合",
}

ENGINES = {
    "architecture": "net_arch_v1",
    "performance": "net_perf_v1",
    "physical": "net_physical_v1",
    "error_control": "net_error_v1",
    "sliding_window": "net_window_v1",
    "mac": "net_mac_v1",
    "ethernet": "net_ethernet_v1",
    "ip": "net_ip_v1",
    "network_layer": "net_layer_v1",
    "transport": "net_transport_v1",
    "tcp_control": "net_tcp_v1",
    "application": "net_app_v1",
}

PSEUDOCODES = {
    "architecture": [
        "应用数据自上而下逐层封装，每层增加本层首部",
        "到达对端后自下而上解封装，逐层去掉首部并交付上层",
        "协议是同等层之间的通信规则；服务是下层向上层提供的功能",
        "设备按处理的信息层次归类：集线器/中继器、网桥/交换机、路由器、网关",
    ],
    "performance": [
        "发送时延 = 数据位数 / 链路速率",
        "传播时延 = 链路长度 / 信号传播速率",
        "时延带宽积 = 传播时延 × 带宽",
        "电路交换 = 建立时间 + 发送时间 + 传播时延",
        "报文交换按整报文逐段存储转发；分组交换可按分组流水线传输",
    ],
    "physical": [
        "比特率 = 码元速率 × 每个码元携带的比特数",
        "奈奎斯特：C = 2W log2 M（理想无噪声低通信道）",
        "香农：C = W log2(1 + S/N)（有噪声信道）",
        "频分/时分/波分/码分复用分别按频率、时间、波长、正交码划分信道",
    ],
    "error_control": [
        "奇偶校验：统计码字中 1 的个数并补校验位",
        "CRC：数据左移 r 位，按模 2 除以生成多项式，余数作为校验位",
        "CRC 校验：把接收码字模 2 除以生成多项式，余数为 0 则未检出错",
        "海明码：校验位放在 2 的幂位置，按覆盖关系计算校验位",
        "接收端用综合因子定位并纠正单比特错误",
    ],
    "sliding_window": [
        "发送窗口内的帧可以连续发送而不必逐个等待确认",
        "停止等待窗口为 1；GBN 接收窗口为 1；SR 收发窗口可大于 1",
        "GBN 超时回退到丢失帧，重传该帧及其后已发送帧",
        "SR 接收端缓存失序帧，发送端只重传未被确认的帧",
        "序号空间：GBN 需 N ≥ W+1，SR 需 N ≥ 2W",
    ],
    "mac": [
        "ALOHA 随时发送，冲突后随机重发；时隙 ALOHA 只能在时隙起点发送",
        "CSMA 先监听信道：1-坚持、非坚持、p-坚持",
        "CSMA/CD 边发边听，检测到冲突立即停止并退避",
        "最小帧长 Lmin = 2τR，保证发送端在发送完前能检测到冲突",
        "二进制指数退避：第 k 次冲突后从 0…2^min(k,10)−1 个时隙中随机选择",
    ],
    "ethernet": [
        "交换机收到帧后先学习源 MAC 与入端口",
        "查目的 MAC：已知则从对应端口转发，未知/广播则除入端口外泛洪",
        "转发表项有老化时间；源 MAC 迁移时更新端口",
        "冲突域按交换机端口隔离；广播域默认由路由器和 VLAN 隔离",
        "VLAN 通过 802.1Q 标签在一条链路上承载多个广播域",
    ],
    "ip": [
        "IPv4 地址与掩码按位与得到网络地址，广播地址为主机位全 1",
        "CIDR 用前缀长度表示网络；最长前缀匹配选择最具体的路由",
        "分片按 8 字节对齐：片偏移 = 数据起点 / 8，MF 表示后面还有分片",
        "IPv6 地址 8 组 16 位，连续零组可用 :: 压缩且只能出现一次",
        "地址聚合取所有子网的最长公共前缀",
    ],
    "network_layer": [
        "ARP 在同一广播域内用 IP 地址解析 MAC 地址",
        "DHCP 通过 Discover/Offer/Request/ACK 分配地址与网关、DNS",
        "ICMP 报告差错与探测：ping 用 Echo，traceroute 用 TTL 超时",
        "NAT 在私有地址与公网地址之间转换 IP/端口并维护映射表",
        "RIP 是距离向量，OSPF 是链路状态，BGP 是路径向量",
    ],
    "transport": [
        "传输层用端口号复用/分用：套接字 = IP 地址 + 端口号",
        "UDP 首部 8 字节，无连接、不保证可靠；TCP 首部最小 20 字节",
        "TCP 序号按字节编号；SYN/FIN 各消耗一个序号",
        "三次握手同步序号并确认双向通信；四次挥手分别关闭两个方向",
        "TIME_WAIT 等待 2MSL，确保最后 ACK 可重传并清除旧报文",
    ],
    "tcp_control": [
        "发送窗口 = min(接收窗口, 拥塞窗口)",
        "慢启动：cwnd 每 RTT 翻倍，直到 ssthresh",
        "拥塞避免：cwnd 每 RTT 增加约 1 MSS",
        "超时：ssthresh = cwnd/2，cwnd 回到 1 MSS 并重新慢启动",
        "3 个重复 ACK：快重传丢失报文，快恢复把 cwnd 降到 ssthresh",
    ],
    "application": [
        "DNS 递归/迭代查询把域名解析为 IP 地址",
        "HTTP 非持久连接每个对象重新建立 TCP；持久连接复用 TCP",
        "网页获取时间按 TCP 握手、HTTP 请求/响应 RTT 与传输时间累加",
        "FTP 控制与数据连接分离；电子邮件用 SMTP 发送、POP3/IMAP 读取",
        "输入 URL 后依次经历 DHCP/ARP、DNS、TCP 握手、HTTP 请求与渲染",
    ],
}


# ---------------------------------------------------------------------------
# 公共工具
# ---------------------------------------------------------------------------

def _fmt(value: float | int | None, digits: int = 8) -> str:
    if value is None:
        return "—"
    number = float(value)
    if not math.isfinite(number):
        return "∞" if number > 0 else ("−∞" if number < 0 else "NaN")
    if number == int(number) and abs(number) < 1e15:
        return str(int(number))
    return f"{number:.{digits}g}"


def _frame(store: list[dict[str, Any]], action: str, label: str, detail: str,
           line: int | None = None, **values: Any) -> None:
    payload = {"index": len(store), "action": action, "label": label, "detail": detail, "values": values}
    if line is not None:
        payload["pseudocodeLine"] = line
    store.append(payload)


def _check(check_id: str, label: str, passed: bool, detail: str, *, warn: bool = False) -> dict[str, Any]:
    return {"id": check_id, "label": label, "status": "pass" if passed else ("warn" if warn else "fail"),
            "detail": detail}


def _ok(kind: str, answer: str, frames: list[dict[str, Any]], pseudocode: list[str], *,
        checks: list[dict[str, Any]] | None = None, notes: list[str] | None = None,
        answer_value: float | None = None, answer_order: list[str] | None = None,
        metrics: list[dict[str, Any]] | None = None, stats: Mapping[str, Any] | None = None,
        stop_reason: str = "done") -> dict[str, Any]:
    items = [{"id": "answer", "label": "结论", "value": answer}]
    items.extend(metrics or [])
    if answer_value is not None:
        items.append({"id": "value", "label": "数值", "value": _fmt(answer_value)})
    for index, frame in enumerate(frames):
        frame["index"] = index
    return {
        "subject": "computer_network", "engine": ENGINES[kind], "net_kind": kind, "status": "ok",
        "headline": answer, "answer": answer, "answer_value": answer_value if answer_value is not None else None,
        "answer_order": answer_order, "metrics": items, "checks": checks or [], "notes": notes or [],
        "trace": frames, "frames": frames, "pseudocode": pseudocode, "stats": dict(stats or {}),
        "stop_reason": stop_reason,
    }


def _blocked(kind: str, reason: str) -> dict[str, Any]:
    return {"subject": "computer_network", "engine": ENGINES.get(kind, "net_unknown_v1"),
            "net_kind": kind, "status": "blocked", "reason": reason, "headline": reason,
            "answer": "", "answer_value": None, "answer_order": None, "metrics": [], "checks": [],
            "notes": [], "trace": [], "frames": [], "pseudocode": PSEUDOCODES.get(kind, []), "stats": {}}


def _condition(cid: str, label: str, value: Any, *, source: Mapping[str, Any] | None = None,
               kind: str = "text", editable: bool = False, note: str | None = None) -> dict[str, Any]:
    return {"id": cid, "label": label, "value": value, "kind": kind, "unit": "",
            "provenance": "original", "source": dict(source or {}), "editable": editable,
            "options": [], "min": None, "max": None, "step": None, "note": note}


def _ambiguity(cid: str, question: str, options: list[dict[str, str]]) -> dict[str, Any]:
    return {"id": cid, "field": "net_kind", "question": question,
            "severity": "blocking", "options": options, "resolved": False, "answer": None}


_NUM = r"([0-9]+(?:\.[0-9]+)?(?:\s*[×xX*]\s*10\s*\^?\s*-?\s*\d+|[eE]\s*-?\s*\d+)?)"


def _number(token: str) -> float:
    token = token.replace(" ", "").replace("−", "-")
    scientific = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)[×xX*]10\^?(-?\d+)", token)
    if scientific:
        return float(scientific.group(1)) * (10 ** int(scientific.group(2)))
    return float(token)


def _section(text: str, start: str, stop: str) -> str:
    match = re.search(start, text, re.I)
    if not match:
        return ""
    chunk = text[match.end():]
    end = re.search(stop, chunk, re.I)
    return chunk[:end.start()] if end else chunk


def _number_after(text: str, labels: str, unit: str = "") -> float | None:
    match = re.search(rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*({unit})?",
                      text, re.I)
    return _number(match.group(1)) if match else None


def _time_seconds(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|需要|约需|=|:|：)?\s*{_NUM}\s*"
        r"(ps|ns|us|μs|ms|s|纳秒|微秒|毫秒|秒|分钟)", text, re.I)
    if not match:
        return None
    factors = {"ps": 1e-12, "ns": 1e-9, "us": 1e-6, "μs": 1e-6, "ms": 1e-3,
               "s": 1.0, "纳秒": 1e-9, "微秒": 1e-6, "毫秒": 1e-3, "秒": 1.0, "分钟": 60.0}
    return _number(match.group(1)) * factors[match.group(2).lower()]


def _fmt_time(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    if abs(seconds) < 1e-6:
        return f"{_fmt(seconds * 1e9)} ns"
    if abs(seconds) < 1e-3:
        return f"{_fmt(seconds * 1e6)} μs"
    if abs(seconds) < 1:
        return f"{_fmt(seconds * 1e3)} ms"
    return f"{_fmt(seconds)} s"


def _rate_value(number: float, unit: str) -> float:
    is_byte = "B" in unit or "字节" in unit
    lower = unit.lower()
    factor = 1.0
    if lower.startswith("k"):
        factor = 1e3 if not is_byte else 1024.0
    elif lower.startswith("m"):
        factor = 1e6 if not is_byte else 1024.0 ** 2
    elif lower.startswith("g"):
        factor = 1e9 if not is_byte else 1024.0 ** 3
    return number * factor * (8 if is_byte else 1)


def _rate_bps(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*"
        r"(Kbps|Mbps|Gbps|bps|Kb/s|Mb/s|Gb/s|KB/s|MB/s|GB/s|B/s|bit/s|b/s|比特/秒|字节/秒)",
        text, re.I)
    return _rate_value(_number(match.group(1)), match.group(2)) if match else None


def _any_rate_bps(text: str) -> float | None:
    match = re.search(
        rf"{_NUM}\s*(Kbps|Mbps|Gbps|bps|Kb/s|Mb/s|Gb/s|KB/s|MB/s|GB/s|B/s|bit/s|b/s|比特/秒|字节/秒)",
        text, re.I)
    return _rate_value(_number(match.group(1)), match.group(2)) if match else None


def _size_bits(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*"
        r"(Kbit|Mbit|Gbit|Kb|Mb|Gb|KB|MB|GB|bytes?|bits?|bit|B|b|字节|比特|位)",
        text, re.I)
    if not match:
        return None
    number = _number(match.group(1))
    unit = match.group(2)
    is_byte = "B" in unit or "byte" in unit.lower() or "字节" in unit
    lower = unit.lower()
    factor = 1.0
    if lower.startswith("k"):
        factor = 1024.0 if is_byte else 1e3
    elif lower.startswith("m"):
        factor = 1024.0 ** 2 if is_byte else 1e6
    elif lower.startswith("g"):
        factor = 1024.0 ** 3 if is_byte else 1e9
    return number * factor * (8 if is_byte else 1)


def _bits_token(text: str, minimum: int = 4) -> str | None:
    candidates = re.findall(
        r"(?<![0-9A-Za-z])[01](?:[\s_]?[01]){%d,255}(?![0-9A-Za-z])" % (minimum - 1), text)
    if not candidates:
        return None
    token = max(candidates, key=lambda item: len(re.sub(r"[\s_]", "", item)))
    return re.sub(r"[\s_]", "", token)


def _bits_after(text: str, labels: str, minimum: int = 3) -> str | None:
    match = re.search(
        rf"(?:{labels})[^\n。；]{{0,24}}?((?:[01][\s_]?){{{minimum},}})", text, re.I)
    if not match:
        return None
    bits = re.sub(r"[\s_]", "", match.group(1))
    return bits if len(bits) >= minimum else None


def _percent(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*(%)?", text, re.I)
    if not match:
        return None
    value = float(match.group(1))
    return value / 100 if match.group(2) == "%" or value > 1 else value


def _meters(text: str, labels: str) -> float | None:
    match = re.search(rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*(km|m|千米|米|公里)",
                      text, re.I)
    if not match:
        return None
    value = _number(match.group(1))
    return value * (1000 if match.group(2).lower() in ("km", "千米", "公里") else 1)


def _speed_mps(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*(m/s|km/s|米/秒|千米/秒|公里/秒)",
        text, re.I)
    if not match:
        return None
    value = _number(match.group(1))
    return value * (1000 if "k" in match.group(2).lower() or "千" in match.group(2) or "公里" in match.group(2) else 1)


def _freq_hz(text: str, labels: str) -> float | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|大约|=|:|：)?\s*{_NUM}\s*(Hz|kHz|MHz|GHz|赫兹|千赫|兆赫|吉赫)",
        text, re.I)
    if not match:
        return None
    value = _number(match.group(1))
    factors = {"hz": 1.0, "khz": 1e3, "mhz": 1e6, "ghz": 1e9,
               "赫兹": 1.0, "千赫": 1e3, "兆赫": 1e6, "吉赫": 1e9}
    return value * factors[match.group(2).lower()]


def _int_after(text: str, labels: str) -> int | None:
    match = re.search(rf"(?:{labels})\s*(?:为|是|约|=|:|：)?\s*(\d+)", text, re.I)
    return int(match.group(1)) if match else None


def _fmt_rate(bps: float | None) -> str:
    if bps is None:
        return "—"
    if abs(bps) >= 1e9:
        return f"{_fmt(bps / 1e9)} Gbps"
    if abs(bps) >= 1e6:
        return f"{_fmt(bps / 1e6)} Mbps"
    if abs(bps) >= 1e3:
        return f"{_fmt(bps / 1e3)} kbps"
    return f"{_fmt(bps)} bps"


def _fmt_hz(hz: float | None) -> str:
    if hz is None:
        return "—"
    if abs(hz) >= 1e9:
        return f"{_fmt(hz / 1e9)} GHz"
    if abs(hz) >= 1e6:
        return f"{_fmt(hz / 1e6)} MHz"
    if abs(hz) >= 1e3:
        return f"{_fmt(hz / 1e3)} kHz"
    return f"{_fmt(hz)} Hz"


def _fmt_size_bits(bits: float | None) -> str:
    if bits is None:
        return "—"
    if bits % 8 == 0:
        return f"{_fmt(bits / 8)} B（{_fmt(bits)} bit）"
    return f"{_fmt(bits)} bit"


# ---------------------------------------------------------------------------
# 1) 网络体系结构
# ---------------------------------------------------------------------------

OSI_LAYERS = ["应用层", "表示层", "会话层", "传输层", "网络层", "数据链路层", "物理层"]
TCPIP_LAYERS = ["应用层", "传输层", "网际层", "网络接口层"]


def _eval_architecture(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}

    if re.search(r"OSI|七层|体系结构|分层|TCP\s*/\s*IP|TCP/IP", text, re.I):
        detail = ("OSI 七层自下而上为：物理层、数据链路层、网络层、传输层、会话层、表示层、应用层。"
                  "TCP/IP 四层为：网络接口层、网际层、传输层、应用层。"
                  "TCP/IP 的应用层对应 OSI 的应用/表示/会话层，网络接口层对应 OSI 的数据链路/物理层。")
        _frame(frames, "layers", "OSI 与 TCP/IP 分层", detail, 1,
               layers=OSI_LAYERS, tcpip=TCPIP_LAYERS,
               对应="TCP/IP 应用层 = OSI 应用+表示+会话；网络接口层 = 数据链路+物理")
        answer_bits.append("OSI 七层：物理、数据链路、网络、传输、会话、表示、应用；TCP/IP 四层：网络接口、网际、传输、应用")
        stats["osi_layers"] = OSI_LAYERS
        stats["tcpip_layers"] = TCPIP_LAYERS

    if re.search(r"协议|服务", text) and re.search(r"区别|关系|协议与服务|服务", text):
        detail = ("协议是同等层实体之间的通信规则，由语法、语义和时序组成；"
                  "服务是下层通过层间接口向上层提供的功能，协议是服务的实现手段。"
                  "服务有面向连接/无连接之分，协议对上层是透明的。")
        _frame(frames, "protocol", "协议与服务的区别", detail, 2,
               协议="同等层之间的规则", 服务="下层向上层提供的功能",
               关系="协议实现服务；服务通过原语使用")
        answer_bits.append("协议是同等层之间的规则，服务是下层向上层提供的功能；协议实现服务")
        stats["protocol_service"] = True

    if re.search(r"封装|解封装|经过各层|各层.*变化|报文.*变化|数据.*封装", text):
        pdu_rows = [
            ("应用层", "报文 / 用户数据", "形成应用数据"),
            ("传输层", "报文段（TCP）/ 用户数据报（UDP）", "增加源/目的端口、序号等首部"),
            ("网络层", "分组 / 数据报", "增加源/目的 IP 地址等首部"),
            ("数据链路层", "帧", "增加 MAC 首部和帧尾（FCS）"),
            ("物理层", "比特流", "编码为信号在线路上传输"),
        ]
        for offset, (layer, pdu, change) in enumerate(pdu_rows, 1):
            _frame(frames, "encapsulate", f"{layer}：{pdu}",
                   f"发送端在{layer}把{change}；接收端按相反顺序解封装。", 3,
                   层=layer, PDU=pdu, 变化=change, 方向="发送封装 / 接收解封装")
        answer_bits.append("封装自上而下逐层加首部：报文→报文段→分组→帧→比特；解封装反向逐层去首部")
        stats["encapsulation"] = [{"layer": layer, "pdu": pdu, "change": change}
                                  for layer, pdu, change in pdu_rows]

    device_rows: list[tuple[str, str]] = []
    if re.search(r"中继器|集线器|hub|repeater", text, re.I):
        device_rows.append(("中继器 / 集线器", "物理层"))
    if re.search(r"网桥|交换机|bridge|switch", text, re.I):
        device_rows.append(("网桥 / 二层交换机", "数据链路层"))
    if re.search(r"三层交换机", text):
        device_rows.append(("三层交换机", "网络层"))
    if re.search(r"路由器|router", text, re.I):
        device_rows.append(("路由器", "网络层"))
    if re.search(r"网关|gateway", text, re.I):
        device_rows.append(("网关", "高层（应用层及以上）"))
    if device_rows:
        detail = "；".join(f"{name}工作在{layer}" for name, layer in device_rows)
        _frame(frames, "devices", "网络设备所属层次", detail, 4,
               devices=[f"{name}：{layer}" for name, layer in device_rows])
        answer_bits.append(detail)
        stats["devices"] = device_rows

    if not frames:
        detail = ("网络体系结构把通信功能划分为若干层：OSI 为七层，TCP/IP 为四层。"
                  "每层向上层提供服务，同层之间按协议通信；发送时逐层封装，接收时逐层解封装。")
        _frame(frames, "overview", "网络体系结构总览", detail, 1,
               layers=OSI_LAYERS, tcpip=TCPIP_LAYERS)
        answer_bits.append(detail)

    answer = "；".join(dict.fromkeys(answer_bits))
    return _ok("architecture", answer, frames, PSEUDOCODES["architecture"],
               notes=["设备层次按常见教材口径；三层交换机同时具有网络层转发能力。",
                      "封装说明不涉及具体首部长度，若题目给出首部字节数需要另行计算。"],
               stats=stats)


# ---------------------------------------------------------------------------
# 2) 性能与交换
# ---------------------------------------------------------------------------

def _propagation_delay(text: str) -> tuple[float | None, bool]:
    direct = _time_seconds(text, r"传播时延|传播延迟|单程传播时延")
    if direct is not None:
        return direct, False
    distance = _meters(text, r"链路长度|链路长|线路长度|线路长|总线长度|总线长|电缆长度|电缆长|距离")
    if distance is None:
        return None, False
    speed = _speed_mps(text, r"信号传播速率|电磁波传播速度|传播速率|传播速度")
    assumed = speed is None
    return distance / (speed or 2e8), assumed


def _parse_links(text: str) -> int:
    for pattern in (r"经过\s*(\d+)\s*段链路", r"(\d+)\s*段链路", r"经过\s*(\d+)\s*条链路",
                    r"(\d+)\s*条链路"):
        match = re.search(pattern, text)
        if match:
            return max(1, int(match.group(1)))
    match = re.search(r"经过\s*(\d+)\s*个路由器", text)
    if match:
        return max(1, int(match.group(1)) + 1)
    match = re.search(r"经过\s*(\d+)\s*个(?:节点|结点)", text)
    if match:
        return max(1, int(match.group(1)) - 1)
    return 1


def _eval_performance(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    modes = [mode for mode, pattern in (
        ("电路交换", r"电路交换"), ("报文交换", r"报文交换"), ("分组交换", r"分组交换"))
        if re.search(pattern, text)]
    rate = _rate_bps(text, r"链路带宽|带宽|数据传输速率|数据率|发送速率|传输速率|链路速率|速率")
    data_bits = _size_bits(text, r"数据(?:大小|量|长度)?|报文(?:长度|大小|长)?|分组(?:长度|大小|长)?|"
                                 r"帧(?:长度|大小|长)?|消息(?:长度|大小|长)?|文件(?:大小|长度)|发送")
    transmission = _time_seconds(text, r"发送时延|传输时延|发送时间|帧发送时间")
    if transmission is None and rate and data_bits:
        transmission = data_bits / rate
    propagation, assumed_speed = _propagation_delay(text)
    process_delay = _time_seconds(text, r"处理时延|排队时延")
    total_delay = None
    delay_block = (not modes or bool(re.search(r"发送时延|时延带宽积", text)))
    ignore_propagation = bool(re.search(r"忽略[^\n。；]{0,8}传播|传播时延忽略|传播时延不计|不计传播时延", text))
    if delay_block and transmission is not None:
        if re.search(r"总时延|端到端时延", text) and propagation is None and not ignore_propagation:
            raise ValueError("计算总时延还需要传播时延（或链路长度与传播速率）；若传播时延可忽略请注明")
        total_delay = (transmission or 0.0) + (propagation or 0.0) + (process_delay or 0.0)
        detail = (f"发送时延 = {_fmt_size_bits(data_bits)} / {_fmt_rate(rate)} = {_fmt_time(transmission)}；"
                  f"传播时延 = {_fmt_time(propagation)}。")
        if process_delay is not None:
            detail += f"处理/排队时延 = {_fmt_time(process_delay)}。"
        detail += f"总时延 = {_fmt_time(total_delay)}。"
        if assumed_speed:
            detail += " 题面未给出传播速率，按 2×10^8 m/s 计算。"
        _frame(frames, "delay", "发送时延与传播时延", detail, 1,
               发送时延=_fmt_time(transmission), 传播时延=_fmt_time(propagation),
               总时延=_fmt_time(total_delay), 传播速率="2×10^8 m/s（缺省）" if assumed_speed else "题面给出")
        answer_bits.append(f"发送时延 {_fmt_time(transmission)} + 传播时延 {_fmt_time(propagation)}"
                           + (f" + 处理时延 {_fmt_time(process_delay)}" if process_delay is not None else "")
                           + f" = 总时延 {_fmt_time(total_delay)}")
        stats["delay"] = {"transmission_s": transmission, "propagation_s": propagation,
                          "process_s": process_delay, "total_s": total_delay,
                          "assumed_speed": assumed_speed}
        if re.search(r"时延带宽积", text) is None:
            if re.search(r"发送时延", text) and not re.search(r"总时延|传播时延", text):
                answer_value = (transmission or 0.0) * 1e3
            elif re.search(r"传播时延", text) and not re.search(r"总时延|发送时延", text):
                answer_value = (propagation or 0.0) * 1e3
            elif total_delay is not None and re.search(r"总时延|时延", text):
                answer_value = total_delay * 1e3
    elif delay_block and propagation is not None and re.search(r"传播时延", text) and not re.search(r"时延带宽积", text):
        if re.search(r"总时延|端到端时延", text) and not ignore_propagation:
            raise ValueError("计算总时延还需要发送时延（数据量与链路速率）")
        _frame(frames, "delay", "传播时延",
               f"传播时延 = {_fmt_time(propagation)}" + ("（传播速率缺省为 2×10^8 m/s）" if assumed_speed else "") + "。", 1,
               传播时延=_fmt_time(propagation), 传播速率="2×10^8 m/s（缺省）" if assumed_speed else "题面给出")
        answer_bits.append(f"传播时延 = {_fmt_time(propagation)}")
        stats["delay"] = {"propagation_s": propagation, "assumed_speed": assumed_speed}
        answer_value = propagation * 1e3

    if re.search(r"时延带宽积|带宽时延积", text):
        product_given = _size_bits(text, r"时延带宽积|带宽时延积")
        if product_given is not None and rate is not None and propagation is None:
            propagation = product_given / rate
            _frame(frames, "bandwidth_delay", "由时延带宽积求传播时延",
                   f"传播时延 = 时延带宽积 / 带宽 = {_fmt(product_given)} bit / {_fmt_rate(rate)} "
                   f"= {_fmt_time(propagation)}。", 2,
                   时延带宽积=f"{_fmt(product_given)} bit", 带宽=_fmt_rate(rate),
                   传播时延=_fmt_time(propagation))
            answer_bits.append(f"传播时延 = {_fmt_time(propagation)}")
            stats["delay"] = {"propagation_s": propagation}
            answer_value = propagation * 1e3
        elif product_given is not None and propagation is not None and rate is None:
            rate = product_given / propagation
            _frame(frames, "bandwidth_delay", "由时延带宽积求带宽",
                   f"带宽 = 时延带宽积 / 传播时延 = {_fmt(product_given)} bit / {_fmt_time(propagation)} "
                   f"= {_fmt_rate(rate)}。", 2,
                   时延带宽积=f"{_fmt(product_given)} bit", 传播时延=_fmt_time(propagation),
                   带宽=_fmt_rate(rate))
            answer_bits.append(f"带宽 = {_fmt_rate(rate)}")
            stats["delay_bandwidth_bits"] = product_given
            answer_value = rate
        elif propagation is not None and rate is not None:
            product = propagation * rate
            _frame(frames, "bandwidth_delay", "时延带宽积",
                   f"时延带宽积 = 传播时延 {_fmt_time(propagation)} × 带宽 {_fmt_rate(rate)} = {_fmt(product)} bit。", 2,
                   传播时延=_fmt_time(propagation), 带宽=_fmt_rate(rate), 时延带宽积=f"{_fmt(product)} bit")
            answer_bits.append(f"时延带宽积 = {_fmt(product)} bit")
            stats["delay_bandwidth_bits"] = product
            answer_value = product
        elif rate is not None and re.search(r"RTT|往返时延", text, re.I):
            rtt = _time_seconds(text, r"RTT|往返时延|往返时间")
            if rtt is not None:
                product = rtt / 2 * rate
                _frame(frames, "bandwidth_delay", "时延带宽积",
                       f"用往返时延的一半作为单向传播时延：{_fmt_time(rtt / 2)} × {_fmt_rate(rate)} = {_fmt(product)} bit。", 2,
                       往返时延=_fmt_time(rtt), 时延带宽积=f"{_fmt(product)} bit")
                answer_bits.append(f"时延带宽积 = {_fmt(product)} bit（按 RTT/2）")
                answer_value = product

    if re.search(r"吞吐量", text):
        throughput = None
        total_time = _time_seconds(text, r"用时|总时间|传输时间|耗时")
        if data_bits and total_time:
            throughput = data_bits / total_time
        if throughput is None:
            throughput = _rate_bps(text, r"吞吐量|实际吞吐量|有效吞吐量")
        rate_list_section = re.search(r"(?:链路)?带宽分别为([^\n。；]+)", text)
        if throughput is None and rate_list_section:
            rates = []
            for number, unit in re.findall(
                    r"([0-9]+(?:\.[0-9]+)?)\s*(Kbps|Mbps|Gbps|kbps|mbps|gbps|bps|KB/s|MB/s|GB/s|B/s)",
                    rate_list_section.group(1), re.I):
                rate_text = f"带宽 {number}{unit}"
                parsed = _rate_bps(rate_text, r"带宽")
                if parsed:
                    rates.append(parsed)
            if rates:
                throughput = min(rates)
                _frame(frames, "throughput", "吞吐量取瓶颈带宽",
                       f"各段带宽为 {', '.join(_fmt_rate(value) for value in rates)}；"
                       f"端到端吞吐量不超过最小带宽 {_fmt_rate(throughput)}。", 3,
                       各段带宽=" / ".join(_fmt_rate(value) for value in rates),
                       吞吐量=_fmt_rate(throughput))
                answer_bits.append(f"吞吐量 = {_fmt_rate(throughput)}（取瓶颈带宽）")
                stats["throughput_bps"] = throughput
                answer_value = throughput
        if throughput is not None:
            _frame(frames, "throughput", "吞吐量",
                   f"吞吐量 = 发送数据 {_fmt_size_bits(data_bits)} / 用时 {_fmt_time(total_time)} = {_fmt_rate(throughput)}。", 3,
                   发送数据=_fmt_size_bits(data_bits), 用时=_fmt_time(total_time), 吞吐量=_fmt_rate(throughput))
            answer_bits.append(f"吞吐量 = {_fmt_rate(throughput)}")
            stats["throughput_bps"] = throughput
            answer_value = throughput
        utilization = _percent(text, r"利用率")
        if utilization is None and rate and throughput:
            utilization = throughput / rate
        if utilization is not None and rate:
            if throughput is None:
                throughput = utilization * rate
                _frame(frames, "throughput", "吞吐量",
                       f"吞吐量 = 利用率 × 带宽 = {_fmt(utilization * 100)}% × {_fmt_rate(rate)} = "
                       f"{_fmt_rate(throughput)}。", 3,
                       利用率=f"{_fmt(utilization * 100)}%", 带宽=_fmt_rate(rate), 吞吐量=_fmt_rate(throughput))
                answer_bits.append(f"吞吐量 = {_fmt_rate(throughput)}")
                stats["throughput_bps"] = throughput
            _frame(frames, "utilization", "信道利用率",
                   f"利用率 = 吞吐量 / 带宽 = {_fmt(utilization * 100)}%。", 3,
                   利用率=f"{_fmt(utilization * 100)}%", 带宽=_fmt_rate(rate))
            answer_bits.append(f"信道利用率 {_fmt(utilization * 100)}%")
            answer_value = utilization * 100
            if re.search(r"(?:求|计算)[^\n。；]{0,8}吞吐量|吞吐量为多少|吞吐量是多少", text):
                answer_value = throughput

    message_bits = _size_bits(text, r"报文(?:长度|大小|长)?|消息(?:长度|大小|长)?|数据(?:大小|长度)?|文件(?:大小|长度)")
    packet_bits = _size_bits(text, r"分组(?:长度|大小|长)?|包长|每个分组")
    packet_count_match = re.search(r"(?:分成|分为|共)\s*(\d+)\s*个?(?:分组|包)", text)
    packet_count = int(packet_count_match.group(1)) if packet_count_match else None
    if packet_bits is None and message_bits and packet_count:
        packet_bits = message_bits / packet_count
    if message_bits is None and packet_bits and packet_count:
        message_bits = packet_bits * packet_count
    setup = _time_seconds(text, r"建立时间|连接建立时间|呼叫建立时间")
    links = _parse_links(text)
    switching: dict[str, float] = {}
    if "分组交换" in modes and packet_bits is None and rate and message_bits:
        raise ValueError("分组交换计算需要给出分组长度，或给出报文长度与分组数")
    if modes and rate and message_bits:
        prop = propagation or 0.0
        circuit = (setup or 0.0) + message_bits / rate + links * prop
        message = links * (message_bits / rate + prop)
        packet = message_bits / rate + max(0, links - 1) * ((packet_bits or message_bits) / rate) + links * prop
        switching = {"电路交换": circuit, "报文交换": message, "分组交换": packet}
        chosen = [mode for mode in modes if mode in switching]
        for mode in chosen:
            _frame(frames, "switching", f"{mode}总时延",
                   f"{mode}：共 {links} 段链路，时延 = {_fmt_time(switching[mode])}。", 4,
                   交换方式=mode, 链路数=str(links), 总时延=_fmt_time(switching[mode]))
        summary = "；".join(f"{mode} {_fmt_time(switching[mode])}" for mode in chosen)
        answer_bits.append(summary)
        stats["switching"] = {"links": links, **{mode: value for mode, value in switching.items()}}
        if len(chosen) == 1:
            answer_value = switching[chosen[0]] * 1e3
        elif chosen:
            best = min(chosen, key=lambda item: switching[item])
            answer_bits.append(f"{best}时延最小")

    if re.search(r"电路交换|报文交换|分组交换", text) and not switching:
        detail = ("电路交换先建立连接，再连续发送数据，传输期间独占链路；"
                  "报文交换把整个报文逐段存储转发；分组交换把报文分组后逐段存储转发，可流水线传输。"
                  "在忽略处理/排队时延时，分组交换通常比报文交换时延小。")
        _frame(frames, "switching_concept", "三种交换方式", detail, 4,
               电路交换="建立连接 + 连续传输", 报文交换="整报文存储转发", 分组交换="分组存储转发/流水线")
        answer_bits.append("电路交换先建立连接；报文交换整报文存储转发；分组交换按分组存储转发并可流水线")

    if not frames:
        detail = ("带宽是链路最高传输速率；吞吐量是实际端到端速率；"
                  "发送时延 = 数据位数/速率，传播时延 = 距离/传播速率；"
                  "时延带宽积 = 传播时延 × 带宽，表示链路中容纳的比特数。")
        _frame(frames, "concept", "性能指标", detail, 1,
               带宽="bps", 吞吐量="实际速率", 发送时延="L/R", 传播时延="d/v",
               时延带宽积="传播时延×带宽")
        answer_bits.append(detail)

    answer = "；".join(dict.fromkeys(answer_bits))
    metrics = []
    if "delay" in stats:
        if "total_s" in stats["delay"]:
            metrics.append({"id": "total_delay", "label": "总时延", "value": _fmt_time(stats["delay"]["total_s"])})
        elif "propagation_s" in stats["delay"]:
            metrics.append({"id": "propagation", "label": "传播时延",
                            "value": _fmt_time(stats["delay"]["propagation_s"])})
    if "throughput_bps" in stats:
        metrics.append({"id": "throughput", "label": "吞吐量", "value": _fmt_rate(stats["throughput_bps"])})
    if "delay_bandwidth_bits" in stats:
        metrics.append({"id": "product", "label": "时延带宽积", "value": f"{_fmt(stats['delay_bandwidth_bits'])} bit"})
    return _ok("performance", answer, frames, PSEUDOCODES["performance"],
               checks=[_check("units", "单位换算", True, "速率按十进制 k/M/G，存储容量按 1024 换算；传播速率缺省值已注明。")],
               notes=["默认忽略处理时延和排队时延，除非题面单独给出。",
                      "传播速率未给出时按 2×10^8 m/s 计算，并在结果中标注。",
                      "交换方式计算假设各段链路速率相同，报文/分组在各段按存储转发处理。"],
               answer_value=answer_value, metrics=metrics, stats=stats)


# ---------------------------------------------------------------------------
# 3) 物理层
# ---------------------------------------------------------------------------

def _parse_levels(text: str) -> int | None:
    match = re.search(r"(\d+)\s*种(?:不同)?(?:码元|电平|相位|状态|信号)", text)
    if match:
        return int(match.group(1))
    match = re.search(r"(\d+)\s*(?:QAM|PSK|FSK|ASK)", text, re.I)
    if match:
        return int(match.group(1))
    match = re.search(r"M\s*=\s*(\d+)", text)
    return int(match.group(1)) if match else None


def _parse_snr(text: str) -> float | None:
    match = re.search(r"信噪比\s*(?:为|是|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)\s*dB", text, re.I)
    if match:
        return 10 ** (float(match.group(1)) / 10)
    match = re.search(r"S\s*/\s*N\s*(?:=|为|是)?\s*([0-9]+(?:\.[0-9]+)?)", text, re.I)
    if match:
        return float(match.group(1))
    match = re.search(r"信噪比\s*(?:为|是|=|:|：)?\s*([0-9]+(?:\.[0-9]+)?)", text, re.I)
    return float(match.group(1)) if match else None


def _eval_physical(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    symbol_rate = _number_after(text, r"码元速率|波特率|symbol\s*rate|baud", r"Baud|波特|码元/s|码元/秒|symbol/s")
    bit_rate = _rate_bps(text, r"比特率|数据率|信息速率|bit\s*rate")
    levels = _parse_levels(text)
    if levels is None and re.search(r"QPSK", text, re.I):
        levels = 4
    if levels is None and re.search(r"BPSK", text, re.I):
        levels = 2
    bits_per_symbol = _int_after(text, r"每个码元(?:携带|表示|可表示)?")
    if bits_per_symbol is None and levels:
        bits_per_symbol = int(round(math.log2(levels))) if levels > 1 and (levels & (levels - 1)) == 0 else None
    if bits_per_symbol is not None and symbol_rate:
        bit_rate = symbol_rate * bits_per_symbol
        _frame(frames, "symbol", "码元速率与比特率",
               f"每个码元携带 {bits_per_symbol} bit；比特率 = {_fmt(symbol_rate)} × {bits_per_symbol} = "
               f"{_fmt(bit_rate)} bps。", 1,
               码元速率=f"{_fmt(symbol_rate)} Baud", 每码元比特=str(bits_per_symbol),
               比特率=_fmt_rate(bit_rate))
        answer_bits.append(f"比特率 = {_fmt_rate(bit_rate)}")
        answer_value = bit_rate
    elif bit_rate and symbol_rate:
        bits_per_symbol = bit_rate / symbol_rate
        _frame(frames, "symbol", "码元与比特",
               f"比特率 / 码元速率 = {_fmt_rate(bit_rate)} / {_fmt(symbol_rate)} Baud = "
               f"{_fmt(bits_per_symbol)} bit/码元。", 1,
               比特率=_fmt_rate(bit_rate), 码元速率=f"{_fmt(symbol_rate)} Baud",
               每码元比特=_fmt(bits_per_symbol))
        answer_bits.append(f"每个码元携带 {_fmt(bits_per_symbol)} bit")
        answer_value = bits_per_symbol
    elif bit_rate and bits_per_symbol:
        symbol_rate = bit_rate / bits_per_symbol
        _frame(frames, "symbol", "由比特率求波特率",
               f"波特率 = 比特率 / 每码元比特数 = {_fmt_rate(bit_rate)} / {bits_per_symbol} "
               f"= {_fmt(symbol_rate)} Baud。", 1,
               比特率=_fmt_rate(bit_rate), 每码元比特=str(bits_per_symbol),
               波特率=f"{_fmt(symbol_rate)} Baud")
        answer_bits.append(f"波特率 = {_fmt(symbol_rate)} Baud")
        answer_value = symbol_rate
    elif levels:
        _frame(frames, "levels", "码元种类",
               f"{levels} 种码元可表示 {_fmt(math.log2(levels))} bit/码元（需为 2 的幂）；"
               "若题目给出波特率，再用比特率 = 波特率 × log2(M) 计算。", 1,
               码元种类=str(levels), 每码元比特=_fmt(math.log2(levels)))
        answer_bits.append(f"{levels} 种码元对应 {_fmt(math.log2(levels))} bit/码元")

    bandwidth = _freq_hz(text, r"带宽|信道带宽|频率带宽|W")
    nyquist = None
    shannon = None
    if bandwidth and levels:
        nyquist = 2 * bandwidth * math.log2(levels)
        _frame(frames, "nyquist", "奈奎斯特公式",
               f"理想无噪声低通信道：C = 2W log2 M = 2×{_fmt_hz(bandwidth)}×log2({levels}) "
               f"= {_fmt_rate(nyquist)}。", 2,
               带宽=_fmt_hz(bandwidth), 码元种类=str(levels), 最大数据率=_fmt_rate(nyquist))
        answer_bits.append(f"奈奎斯特最大数据率 = {_fmt_rate(nyquist)}")
        answer_value = nyquist
        stats["nyquist_bps"] = nyquist
    snr = _parse_snr(text)
    if bandwidth and snr is not None:
        shannon = bandwidth * math.log2(1 + snr)
        _frame(frames, "shannon", "香农公式",
               f"有噪声信道：C = W log2(1+S/N) = {_fmt_hz(bandwidth)}×log2(1+{_fmt(snr)}) "
               f"= {_fmt_rate(shannon)}。", 3,
               带宽=_fmt_hz(bandwidth), 信噪比=_fmt(snr), 最大数据率=_fmt_rate(shannon))
        answer_bits.append(f"香农最大数据率 = {_fmt_rate(shannon)}")
        answer_value = shannon
        stats["shannon_bps"] = shannon
    if nyquist is not None and shannon is not None:
        answer_bits.append(f"两者同时给出时，实际可达到的数据率不超过 {_fmt_rate(min(nyquist, shannon))}")
        answer_value = min(nyquist, shannon)

    if re.search(r"曼彻斯特|差分曼彻斯特|NRZ|不归零|归零|ASK|FSK|PSK|QAM|调制|编码", text, re.I):
        encodings = []
        if re.search(r"曼彻斯特", text):
            encodings.append("曼彻斯特：每比特中间有跳变；波特率通常为比特率的 2 倍")
        if re.search(r"差分曼彻斯特", text):
            encodings.append("差分曼彻斯特：每比特中间有跳变，比特值由起始处是否跳变决定")
        if re.search(r"NRZ|不归零", text, re.I):
            encodings.append("NRZ：电平在整个比特时间内保持不变")
        if re.search(r"ASK|FSK|PSK|QAM", text, re.I):
            encodings.append("ASK/FSK/PSK/QAM 分别用幅度/频率/相位/幅度相位组合承载比特")
        if encodings:
            _frame(frames, "encoding", "编码与调制",
                   "；".join(encodings) + "。编码把比特映射为电平/码元，调制把基带信号搬到载波。", 1,
                   encodings=encodings)
            answer_bits.append("；".join(encodings))
        if re.search(r"曼彻斯特", text) and re.search(r"波特率|码元速率", text):
            if bit_rate and symbol_rate is None:
                symbol_rate = 2 * bit_rate
                _frame(frames, "manchester", "曼彻斯特波特率",
                       f"曼彻斯特每比特中间都有跳变，波特率 = 2×比特率 = {_fmt(symbol_rate)} Baud。", 1,
                       比特率=_fmt_rate(bit_rate), 波特率=f"{_fmt(symbol_rate)} Baud")
                answer_bits.append(f"曼彻斯特波特率 = {_fmt(symbol_rate)} Baud")
                answer_value = symbol_rate
            elif symbol_rate and bit_rate is None:
                bit_rate = symbol_rate / 2
                _frame(frames, "manchester", "曼彻斯特比特率",
                       f"曼彻斯特波特率是比特率的 2 倍，比特率 = {_fmt_rate(bit_rate)}。", 1,
                       波特率=f"{_fmt(symbol_rate)} Baud", 比特率=_fmt_rate(bit_rate))
                answer_bits.append(f"曼彻斯特比特率 = {_fmt_rate(bit_rate)}")
                answer_value = bit_rate

    if re.search(r"复用|FDM|TDM|WDM|CDM|频分|时分|波分|码分", text, re.I):
        channel_match = re.search(
            r"(?:复用|划分)\s*(\d+)\s*(?:路|个)信道|(\d+)\s*路\s*(?:TDM|FDM|WDM|CDM|时分|频分|波分|码分)?\s*复用|"
            r"(?:TDM|FDM|WDM|CDM)\s*(\d+)\s*路", text, re.I)
        channels = int(next(group for group in channel_match.groups() if group)) if channel_match else None
        total_rate = _rate_bps(text, r"总(?:速率|带宽)|复用后(?:速率|带宽)")
        channel_rate = _rate_bps(text, r"每路(?:速率|带宽)|每个信道(?:速率|带宽)")
        if channels and total_rate:
            each = total_rate / channels
            _frame(frames, "mux", "时分/频分复用",
                   f"总速率 {_fmt_rate(total_rate)} 分给 {channels} 路，每路约 {_fmt_rate(each)}。", 4,
                   复用路数=str(channels), 总速率=_fmt_rate(total_rate), 每路速率=_fmt_rate(each))
            answer_bits.append(f"{channels} 路复用，每路 {_fmt_rate(each)}")
            answer_value = each
        elif channels and channel_rate:
            total_rate = channels * channel_rate
            _frame(frames, "mux", "由每路速率求总速率",
                   f"{channels} 路 × 每路 {_fmt_rate(channel_rate)} = 总速率 {_fmt_rate(total_rate)}。", 4,
                   复用路数=str(channels), 每路速率=_fmt_rate(channel_rate), 总速率=_fmt_rate(total_rate))
            answer_bits.append(f"总速率 = {_fmt_rate(total_rate)}")
            answer_value = total_rate
        else:
            _frame(frames, "mux", "信道复用方式",
                   "频分复用按频率划分；时分复用按时间片轮流；波分复用按不同波长；"
                   "码分复用用相互正交的码序列区分用户。", 4,
                   FDM="频率", TDM="时间片", WDM="波长", CDM="正交码")
            answer_bits.append("FDM 分频率、TDM 分时间片、WDM 分波长、CDM 用正交码")

    if not frames:
        detail = ("比特率 = 码元速率 × 每码元比特数；奈奎斯特给出理想无噪声上限 C=2Wlog2M；"
                  "香农给出有噪声上限 C=Wlog2(1+S/N)。编码/调制与复用方式需要按题面进一步指定。")
        _frame(frames, "concept", "物理层基本关系", detail, 1,
               比特率="码元速率×bits/symbol", 奈奎斯特="2Wlog2M", 香农="Wlog2(1+S/N)")
        answer_bits.append(detail)

    answer = "；".join(dict.fromkeys(answer_bits))
    metrics = []
    if "nyquist_bps" in stats:
        metrics.append({"id": "nyquist", "label": "奈奎斯特上限", "value": _fmt_rate(stats["nyquist_bps"])})
    if "shannon_bps" in stats:
        metrics.append({"id": "shannon", "label": "香农上限", "value": _fmt_rate(stats["shannon_bps"])})
    return _ok("physical", answer, frames, PSEUDOCODES["physical"],
               checks=[_check("formula", "公式适用范围", True,
                              "奈奎斯特适用于理想无噪声低通信道；香农适用于有噪声信道。")],
               notes=["波特率单位为 Baud；M 种码元需满足 log2 M 为整数。",
                      "曼彻斯特编码的波特率与比特率关系按常见教材口径说明。",
                      "复用计算未计帧头、保护间隔等额外开销。"],
               answer_value=answer_value, metrics=metrics, stats=stats)


# ---------------------------------------------------------------------------
# 4) 差错检测与纠正
# ---------------------------------------------------------------------------

def _parity_type(text: str) -> str | None:
    if re.search(r"偶校验|偶校验位|even\s*parity", text, re.I):
        return "even"
    if re.search(r"奇校验|奇校验位|odd\s*parity", text, re.I):
        return "odd"
    return None


def _data_bits(text: str) -> str | None:
    data = _bits_after(text, r"数据(?:位|比特|码|序列)?|信息位|信息码|信息序列|原始数据|"
                             r"待发送(?:数据|序列)?|发送(?:数据|比特|序列)")
    if data:
        return data
    return _bits_token(text)


def _received_bits(text: str) -> str | None:
    return _bits_after(text, r"接收(?:到)?(?:的)?(?:码字|数据|比特流)|收到(?:的)?(?:码字|数据)|"
                             r"接收码字|接收端收到")


def _parse_polynomial(text: str) -> str | None:
    match = re.search(
        r"(?:生成多项式|生成式|G\s*\(x\)\s*=|除数|除式)\s*(?:为|是|=|:|：)?\s*([^\n。；，,]+)",
        text, re.I)
    if not match:
        return None
    expr = match.group(1).strip()
    compact = re.sub(r"[\s_]", "", expr)
    if compact and re.fullmatch(r"[01]+", compact) and len(compact) >= 2:
        return compact
    max_degree = 0
    degrees: set[int] = set()
    for power in re.findall(r"x\s*(?:\^\s*(\d+))?", expr, re.I):
        degree = int(power) if power else 1
        degrees.add(degree)
        max_degree = max(max_degree, degree)
    if re.search(r"(?<![xX\d])1(?![xX\d])", expr):
        degrees.add(0)
    if not degrees:
        return None
    return "".join("1" if degree in degrees else "0"
                   for degree in range(max_degree, -1, -1))


def _crc_divide(data: str, generator: str) -> tuple[str, list[dict[str, Any]]]:
    width = len(generator) - 1
    work = list(data + "0" * width)
    steps: list[dict[str, Any]] = []
    for index in range(len(data)):
        if work[index] != "1":
            continue
        before = "".join(work)
        for offset, bit in enumerate(generator):
            work[index + offset] = str(int(work[index + offset]) ^ int(bit))
        steps.append({"index": index, "before": before, "after": "".join(work)})
    remainder = "".join(work[-width:]) if width else ""
    return remainder, steps


def _hamming_layout(data: str, parity: str) -> dict[str, Any]:
    n = len(data)
    r = 1
    while (1 << r) < n + r + 1:
        r += 1
    total = n + r
    if total > MAX_BITS:
        raise ValueError(f"海明码长度超过 {MAX_BITS} 位，首版仅支持较短数据")
    parity_positions = [1 << index for index in range(r)]
    data_positions = [position for position in range(1, total + 1) if position not in parity_positions]
    bits = ["0"] * (total + 1)
    for position, bit in zip(data_positions, data):
        bits[position] = bit
    coverages: dict[int, list[int]] = {}
    for position in parity_positions:
        coverage = [index for index in range(1, total + 1) if index & position]
        coverages[position] = coverage
        parity_value = 0
        for index in coverage:
            if index != position:
                parity_value ^= int(bits[index])
        if parity == "odd":
            parity_value ^= 1
        bits[position] = str(parity_value)
    codeword = "".join(bits[1:])
    return {"r": r, "total": total, "parity_positions": parity_positions,
            "data_positions": data_positions, "bits": bits, "coverages": coverages,
            "codeword": codeword}


def _hamming_syndrome(received: str, parity: str, parity_positions: list[int]) -> int:
    syndrome = 0
    for position in parity_positions:
        value = 0
        for index in range(1, len(received) + 1):
            if index & position:
                value ^= int(received[index - 1])
        if parity == "odd":
            value ^= 1
        if value:
            syndrome += position
    return syndrome


def _eval_error_control(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None
    answer_order: list[str] | None = None

    concept_question = bool(re.search(r"说明|简述|原理|如何|作用|特点|区别|过程|是什么", text))
    if re.search(r"海明|汉明|Hamming", text, re.I):
        parity = _parity_type(text) or "even"
        data = _data_bits(text)
        distance_match = re.search(r"(?:海明|汉明)距离\s*(?:为|是|=|:)?\s*(\d+)|最小(?:海明|汉明)距离\s*(\d+)", text)
        distance = int(next(group for group in distance_match.groups() if group)) if distance_match else None
        if not data:
            if distance is not None:
                detect = distance - 1
                correct = (distance - 1) // 2
                _frame(frames, "distance", "海明距离与纠错能力",
                       f"最小海明距离 d={distance}：可检测 {detect} 位错误，可纠正 {correct} 位错误。", 1,
                       最小海明距离=str(distance), 检错能力=f"{detect} 位", 纠错能力=f"{correct} 位")
                answer = f"最小海明距离 {distance}：可检测 {detect} 位错误，可纠正 {correct} 位错误"
                return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                           notes=["检错能力 d−1，纠错能力 floor((d−1)/2)。"],
                           stats={"hamming_distance": distance})
            if concept_question:
                _frame(frames, "concept", "海明码构造与校验",
                       "海明码把校验位放在 1、2、4、8…等 2 的幂位置，每个校验位覆盖位置编号中对应二进制位为 1 的位。"
                       "接收端按同样覆盖关系计算综合因子；非零值就是出错位号，可翻转该位纠正。", 1,
                       校验位位置="1,2,4,8,…", 综合因子="出错位号")
                answer = "海明码校验位在 2 的幂位置，按覆盖关系计算；综合因子给出出错位号并可纠正单比特错误。"
                return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                           notes=["构造海明码需要给出数据位和奇偶校验类型。"],
                           stats={"concept": True})
            raise ValueError("海明码题需要给出数据位，例如“数据 1011，采用偶校验构造海明码”")
        layout = _hamming_layout(data, parity)
        _frame(frames, "layout", "海明码位置分配",
               f"数据 {len(data)} 位，需要 r={layout['r']} 个校验位，码长 {layout['total']}。"
               f"校验位在位置 {', '.join(map(str, layout['parity_positions']))}，其余位置依次填入数据。", 1,
               数据=data, 校验位位置=", ".join(map(str, layout["parity_positions"])),
               数据位置=", ".join(map(str, layout["data_positions"])), 码长=str(layout["total"]))
        for position in layout["parity_positions"]:
            coverage = layout["coverages"][position]
            _frame(frames, "parity", f"计算 p{position}",
                   f"p{position} 覆盖位置 {', '.join(map(str, coverage))}；按"
                   f"{'偶' if parity == 'even' else '奇'}校验得到 p{position}={layout['bits'][position]}。", 2,
                   校验位=f"p{position}", 覆盖位置=", ".join(map(str, coverage)),
                   校验值=layout["bits"][position], 校验方式="偶校验" if parity == "even" else "奇校验")
        codeword = layout["codeword"]
        _frame(frames, "codeword", "生成海明码",
               f"按位置 1…{layout['total']} 排列得到码字 {codeword}。", 3,
               码字=codeword, 数据=data, 校验方式="偶校验" if parity == "even" else "奇校验")
        answer_bits.append(f"海明码为 {codeword}（{layout['r']} 个校验位，{layout['total']} 位）")
        answer_order = [codeword]
        stats["hamming"] = {"data": data, "r": layout["r"], "total": layout["total"],
                            "codeword": codeword, "parity": parity}

        received = _received_bits(text)
        error_match = re.search(r"第\s*(\d+)\s*位(?:出错|错误|发生错误|翻转)", text)
        if received is None and error_match:
            position = int(error_match.group(1))
            if not 1 <= position <= len(codeword):
                raise ValueError(f"错误位 {position} 超出码长 {len(codeword)}")
            received = "".join(
                str(1 - int(bit)) if index + 1 == position else bit for index, bit in enumerate(codeword))
        if received is not None:
            if len(received) != layout["total"]:
                raise ValueError(f"接收码字应为 {layout['total']} 位，题面给出 {len(received)} 位")
            syndrome = _hamming_syndrome(received, parity, layout["parity_positions"])
            corrected = received
            verdict = "无错误"
            if syndrome:
                if syndrome <= layout["total"]:
                    corrected = "".join(
                        str(1 - int(bit)) if index + 1 == syndrome else bit
                        for index, bit in enumerate(received))
                    verdict = f"检测到错误，第 {syndrome} 位出错并已纠正"
                else:
                    verdict = f"综合因子 {syndrome} 超出码长，属于不可纠正的多位错误"
            _frame(frames, "syndrome", "检错与纠错",
                   f"接收码字 {received}，综合因子 S={syndrome}；{verdict}。纠正后码字 {corrected}。", 4,
                   接收码字=received, 综合因子=str(syndrome), 纠正结果=corrected, 判断=verdict)
            answer_bits.append(f"接收 {received}，综合因子 {syndrome}：{verdict}")
            stats["hamming"]["received"] = received
            stats["hamming"]["syndrome"] = syndrome
            stats["hamming"]["corrected"] = corrected

        if distance is not None:
            detect = distance - 1
            correct = (distance - 1) // 2
            _frame(frames, "distance", "海明距离与纠错能力",
                   f"最小海明距离 d={distance}：可检测 {detect} 位错误，可纠正 {correct} 位错误。", 5,
                   最小海明距离=str(distance), 检错能力=f"{detect} 位", 纠错能力=f"{correct} 位")
            answer_bits.append(f"最小距离 {distance}：检 {detect} 位、纠 {correct} 位")
        answer = "；".join(dict.fromkeys(answer_bits))
        return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                   checks=[_check("syndrome", "综合因子定位", True,
                                  "偶/奇校验下的综合因子按覆盖位置异或得到；单比特错误对应出错位号。")],
                   notes=["海明码按校验位在 2 的幂位置、数据按其余位置顺序填入。",
                          "题面未说明奇偶校验类型时按偶校验处理，并在结果中标注。",
                          "简单海明码只保证纠正 1 位错误；多位错误可能无法定位。"],
                   answer_order=answer_order, answer_value=answer_value, stats=stats)

    if re.search(r"CRC|循环冗余|生成多项式|模2除法|模 2 除法", text, re.I):
        data = _data_bits(text)
        generator = _parse_polynomial(text)
        if not data or not generator or len(generator) < 2:
            if concept_question:
                _frame(frames, "concept", "CRC 生成与校验",
                       "CRC 把数据看作多项式，左移 r 位（r 为生成多项式阶数）后按模 2 除以生成多项式；"
                       "余数作为 r 位校验位附在数据后。接收端用同一生成多项式再除一次，余数为 0 表示未检出错。", 1,
                       生成="数据左移 r 位后模 2 除", 校验="接收码字除以生成多项式看余数")
                answer = "CRC 用模 2 除法生成余数作为校验位；接收端余数为 0 表示未检出错。"
                return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                           notes=["构造 CRC 需要给出数据位和生成多项式。"],
                           stats={"concept": True})
            if not data:
                raise ValueError("CRC 题需要给出数据位，例如“数据 1011001，生成多项式 x^4+x+1”")
            raise ValueError("CRC 题需要给出生成多项式，例如 G(x)=x^4+x+1 或 10011")
        remainder, steps = _crc_divide(data, generator)
        _frame(frames, "params", "CRC 参数",
               f"数据 {data}，生成多项式对应位串 {generator}，阶 r={len(generator) - 1}；"
               f"在数据后补 {len(generator) - 1} 个 0 做模 2 除法。", 1,
               数据=data, 生成多项式=generator, 校验位长度=str(len(generator) - 1))
        for offset, step in enumerate(steps[:12], 1):
            _frame(frames, "divide", f"第 {offset} 次异或",
                   f"当前被除数 {step['before']}，用 {generator} 对齐最高位 1 做异或，得到 {step['after']}。", 2,
                   被除数=step["before"], 生成多项式=generator, 异或结果=step["after"])
        codeword = data + remainder
        _frame(frames, "codeword", "CRC 余数与发送码字",
               f"余数 R={remainder or '0'}；发送码字 = 数据 + 余数 = {codeword}。", 3,
               余数=remainder or "0", 发送码字=codeword)
        answer_bits.append(f"CRC 余数 {remainder or '0'}，发送码字 {codeword}")
        answer_order = [codeword]
        stats["crc"] = {"data": data, "generator": generator, "remainder": remainder,
                        "codeword": codeword}
        received = _received_bits(text)
        if received is None and re.search(r"接收码字|收到", text):
            received = _bits_token(text)
        if received and len(received) >= len(generator):
            check_remainder, check_steps = _crc_divide(received, generator)
            ok = set(check_remainder) <= {"0"} or check_remainder == ""
            _frame(frames, "check", "CRC 校验",
                   f"接收码字 {received} 模 2 除以 {generator}，余数为 {check_remainder or '0'}；"
                   f"{'未检出错' if ok else '检出错'}。", 5,
                   接收码字=received, 校验余数=check_remainder or "0", 判断="未检出错" if ok else "检出错")
            answer_bits.append(f"接收端余数 {check_remainder or '0'}：{'未检出错' if ok else '检出错'}")
            stats["crc"]["received"] = received
            stats["crc"]["check_remainder"] = check_remainder
        answer = "；".join(dict.fromkeys(answer_bits))
        return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                   checks=[_check("crc_zero", "发送码字可被生成多项式整除", True,
                                  "发送码字由数据与余数拼接得到，再除生成多项式余数应为 0。")],
                   notes=["CRC 使用模 2 除法，异或不产生进位；余数长度为生成多项式阶数。",
                          "题面给出接收码字时按同一生成多项式再除一次，余数为 0 表示未检出错。",
                          "CRC 能检测错误但不保证纠正；多位错误仍可能漏检。"],
                   answer_order=answer_order, stats=stats)

    if re.search(r"奇偶校验|奇校验|偶校验|parity", text, re.I):
        parity = _parity_type(text)
        data = _data_bits(text)
        if data is None or parity is None:
            if concept_question:
                _frame(frames, "concept", "奇偶校验",
                       "偶校验让码字中 1 的个数为偶数，奇校验让 1 的个数为奇数；发送端据此补一位校验位。"
                       "接收端重新统计 1 的个数，可检测奇数位错误，但不能定位错误位置。", 1,
                       偶校验="1 的个数为偶数", 奇校验="1 的个数为奇数", 能力="检奇数位错误，不能定位")
                answer = "偶校验保证 1 的个数为偶数，奇校验保证为奇数；简单奇偶校验只能检测奇数位错误，不能定位。"
                return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                           notes=["计算校验位需要给出数据位和奇偶校验类型。"],
                           stats={"concept": True})
            if data is None:
                raise ValueError("奇偶校验题需要给出数据位，例如“数据 1011，采用偶校验”")
            raise ValueError("奇偶校验题需要说明采用奇校验还是偶校验")
        ones = data.count("1")
        parity_bit = str(ones % 2) if parity == "even" else str(1 - ones % 2)
        prepend = bool(re.search(r"校验位.*(?:最高位|最左边|前面|高位)", text))
        codeword = parity_bit + data if prepend else data + parity_bit
        _frame(frames, "parity", "奇偶校验位",
               f"数据 {data} 中 1 的个数为 {ones}；按{'偶' if parity == 'even' else '奇'}校验，"
               f"校验位为 {parity_bit}，码字为 {codeword}。", 1,
               数据=data, 一的个数=str(ones), 校验位=parity_bit, 码字=codeword,
               校验方式="偶校验" if parity == "even" else "奇校验")
        answer_bits.append(f"{'偶' if parity == 'even' else '奇'}校验：校验位 {parity_bit}，码字 {codeword}")
        stats["parity"] = {"data": data, "parity": parity, "parity_bit": parity_bit,
                           "codeword": codeword, "prepend": prepend}
        if re.search(r"校验位", text) and not re.search(r"接收|收到", text):
            answer_value = float(parity_bit)
        received = _received_bits(text)
        if received:
            ones_received = received.count("1")
            ok = (ones_received % 2 == 0) if parity == "even" else (ones_received % 2 == 1)
            _frame(frames, "check", "接收端校验",
                   f"接收码字 {received} 中 1 的个数为 {ones_received}，"
                   f"{'满足' if ok else '不满足'}{'偶' if parity == 'even' else '奇'}校验；"
                   f"{'未检出错误' if ok else '检出错误'}。", 2,
                   接收码字=received, 一的个数=str(ones_received), 判断="无错" if ok else "检出错")
            answer_bits.append(f"接收 {received}：{'未检出错误' if ok else '检出错误'}")
            stats["parity"]["received"] = received
            stats["parity"]["error"] = not ok
        answer = "；".join(dict.fromkeys(answer_bits))
        return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                   checks=[_check("parity", "奇偶校验规则", True,
                                  "偶校验使码字中 1 的个数为偶数；奇校验使 1 的个数为奇数。")],
                   notes=["简单奇偶校验只能检测奇数位错误，不能定位错误位；偶数位错误可能漏检。",
                          "校验位默认追加在数据末尾；若题面要求放在最高位，按题面处理。"],
                   answer_order=[codeword], answer_value=answer_value, stats=stats)

    if concept_question or re.search(r"差错|检错|纠错|校验", text):
        _frame(frames, "concept", "差错检测与纠正方法",
               "奇偶校验增加 1 位校验位，能检测奇数位错误但不能定位；"
               "CRC 用生成多项式做模 2 除法，检错能力强；"
               "海明码把校验位放在 2 的幂位置，可定位并纠正单比特错误。"
               "检错码只判断是否出错，纠错码还要定位错误位。", 1,
               奇偶校验="1 位校验，检奇数位错误", CRC="模2除法，检错", 海明码="综合因子定位/纠错")
        answer = "奇偶校验检奇数位错误；CRC 用模 2 除法检错；海明码用校验位覆盖关系定位并纠正单比特错误。"
        return _ok("error_control", answer, frames, PSEUDOCODES["error_control"],
                   notes=["具体计算需要给出数据位、校验类型或生成多项式。"],
                   stats={"concept": True})
    raise ValueError("差错检测题需要指定奇偶校验、CRC 生成多项式或海明码条件")


# ---------------------------------------------------------------------------
# 5) 可靠传输与滑动窗口
# ---------------------------------------------------------------------------

def _window_protocols(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for key, pattern in (
        ("stop", r"停止等待|停等|stop-and-wait|stop\s*and\s*wait|alternating"),
        ("gbn", r"GBN|回退N|回退\s*N|go-back-n|后退N|后退\s*N"),
        ("sr", r"选择重传|SR协议|SR\s*协议|(?<![A-Za-z])SR(?![A-Za-z])|selective\s*repeat|选择性重传"),
    ):
        match = re.search(pattern, text, re.I)
        if match:
            found.append((match.start(), key))
    return [key for _, key in sorted(found)]


def _seq_bits(text: str) -> int | None:
    direct = re.search(r"序号(?:字段|编号)?\s*(?:为|是|占|有)?\s*(\d+)\s*位", text)
    if direct:
        return int(direct.group(1))
    direct = re.search(r"(\d+)\s*位序号", text)
    if direct:
        return int(direct.group(1))
    direct = re.search(r"2\s*\^\s*(\d+)\s*(?:个)?序号", text)
    if direct:
        return int(direct.group(1))
    direct = re.search(r"n\s*=\s*(\d+)", text)
    return int(direct.group(1)) if direct else None


def _window_trace(protocol: str, total: int, window: int, lost: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    last = min(total - 1, lost + window - 1)
    sent = list(range(lost, last + 1))
    frames: list[dict[str, Any]] = []
    _frame(frames, "window", "丢帧前的窗口",
           f"假设序号小于 {lost} 的帧均已确认；发送窗口为 [{lost}, {last}]，"
           f"接收端期待序号 {lost}。", 4,
           发送窗口=f"[{lost}, {last}]", 接收窗口=f"[{lost}, {last}]" if protocol == "sr" else f"[{lost}, {lost}]",
           base=str(lost), nextseq=str(last + 1), 丢帧=str(lost))
    if protocol == "stop":
        _frame(frames, "lost", "数据帧丢失",
               f"帧 {lost} 丢失；发送端停在 [{lost}, {lost}]，超时后重传同一帧。", 4,
               发送窗口=f"[{lost}, {lost}]", 接收窗口=f"[{lost}, {lost}]", 丢帧=str(lost),
               重传=[str(lost)])
        _frame(frames, "recover", "重传恢复",
               f"重传帧 {lost} 后收到确认，窗口前移到 {last + 1}。", 4,
               发送窗口=f"[{last + 1}, {last + 1}]", 接收窗口=f"[{last + 1}, {last + 1}]",
               base=str(last + 1), nextseq=str(last + 1))
        return frames, {"retransmissions": [lost], "count": 1}
    if protocol == "gbn":
        _frame(frames, "lost", "GBN：后续帧被丢弃",
               f"帧 {lost} 丢失；接收端丢弃 {lost + 1}…{last}，重复确认 {lost - 1}。"
               f"发送端超时后回退到 {lost}，重传 [{lost}, {last}]。", 4,
               发送窗口=f"[{lost}, {last}]", 接收窗口=f"[{lost}, {lost}]", 丢帧=str(lost),
               重传=[str(value) for value in sent])
        _frame(frames, "recover", "GBN：按序恢复",
               f"接收端按序接收重传帧 {lost}…{last}，确认 {last}；发送窗口前移到 {last + 1}。", 4,
               发送窗口=f"[{last + 1}, {last + 1}]", 接收窗口=f"[{last + 1}, {last + 1}]",
               base=str(last + 1), nextseq=str(last + 1))
        return frames, {"retransmissions": sent, "count": len(sent)}
    _frame(frames, "lost", "SR：缓存后续帧",
           f"帧 {lost} 丢失；接收端缓存 {lost + 1}…{last} 并逐个确认，"
           f"发送端只对未确认的帧 {lost} 超时重传。", 4,
           发送窗口=f"[{lost}, {last}]", 接收窗口=f"[{lost}, {last}]", 丢帧=str(lost),
           重传=[str(lost)], 缓存=[str(value) for value in sent[1:]])
    _frame(frames, "recover", "SR：补齐丢失帧",
           f"重传帧 {lost} 后，接收端交付缓存帧 {lost + 1}…{last}，窗口前移到 {last + 1}。", 4,
           发送窗口=f"[{last + 1}, {last + 1}]", 接收窗口=f"[{last + 1}, {last + 1}]",
           base=str(last + 1), nextseq=str(last + 1))
    return frames, {"retransmissions": [lost], "count": 1}


def _eval_sliding_window(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None
    protocols = _window_protocols(text)
    protocol = protocols[0] if protocols else None
    protocol_label = {"stop": "停止等待", "gbn": "GBN 回退 N", "sr": "SR 选择重传"}
    window = _int_after(text, r"发送窗口(?:大小|尺寸)?|窗口大小|发送窗口")
    if window is None:
        window_match = re.search(
            r"(?:发送窗口|窗口(?:大小|尺寸)?)(?:和接收窗口)?(?:均|都)?\s*(?:为|是|=|:|：)?\s*(\d+)", text)
        window = int(window_match.group(1)) if window_match else None
    recv_window = _int_after(text, r"接收窗口(?:大小|尺寸)?")
    seq_space = _int_after(text, r"序号空间|序号总数")
    bits = _seq_bits(text)
    if seq_space is None and bits is not None:
        seq_space = 1 << bits
    if protocol == "sr" and window is None and recv_window is not None:
        window = recv_window
    if protocol is None and (window or recv_window):
        protocol = "gbn"
        protocols = ["gbn"]
        answer_bits.append("题面没有明确协议，按 GBN 处理")
    max_window = None
    if protocol:
        stats["protocol"] = protocol
        if protocol == "stop":
            max_window = 1
        elif protocol == "gbn":
            max_window = (seq_space - 1) if seq_space else (1 << bits) - 1 if bits else None
        else:
            max_window = seq_space // 2 if seq_space else (1 << (bits - 1)) if bits else None
        if protocol == "stop":
            detail = "停止等待：发送窗口和接收窗口均为 1；用 0/1 两个序号交替即可。"
        elif protocol == "gbn":
            detail = ("GBN：发送窗口 W 内可连续发送；接收窗口为 1。"
                      "若序号空间为 N，必须满足 W ≤ N−1。")
        else:
            detail = ("SR：发送窗口与接收窗口都可以大于 1；接收端缓存失序帧。"
                      "若序号空间为 N，必须满足 W ≤ N/2。")
        receive_shown = recv_window if recv_window is not None else (
            1 if protocol in ("stop", "gbn") else (window if window is not None else None))
        _frame(frames, "protocol", f"{protocol_label[protocol]} 窗口规则", detail, 1,
               协议=protocol_label[protocol], 发送窗口=str(window) if window else "未给出",
               接收窗口=str(receive_shown) if receive_shown is not None else "未给出",
               序号空间=str(seq_space) if seq_space else "未给出")
        answer_bits.append(detail)
        if window is not None and windows_invalid(protocol, window, seq_space):
            answer_bits.append(f"给出的窗口 {window} 超出序号空间约束")
        if protocol == "gbn" and recv_window is not None and recv_window != 1:
            answer_bits.append("GBN 接收窗口必须为 1")
        if protocol == "stop" and (window not in (None, 1) or recv_window not in (None, 1)):
            answer_bits.append("停止等待的发送/接收窗口都必须为 1")
        if protocol == "sr" and window is not None and recv_window is not None and window != recv_window:
            answer_bits.append("SR 的发送窗口与接收窗口通常取相同大小")
        if max_window is not None:
            answer_bits.append(f"{protocol_label[protocol]} 的最大窗口为 {max_window}"
                               + (f"（序号空间 {seq_space}）" if seq_space else ""))
            if re.search(r"最大窗口|窗口最大|最多.*窗口", text):
                answer_value = float(max_window)
        if bits is None and protocol is not None:
            if protocol == "stop":
                bits = 1
            elif window is not None:
                required_space = window + 1 if protocol == "gbn" else 2 * window
                bits = int(math.ceil(math.log2(required_space)))
            elif seq_space is not None:
                bits = int(math.ceil(math.log2(seq_space)))
        if bits is not None:
            minimum_space = 1 << bits
            answer_bits.append(f"序号字段至少 {bits} 位，最小序号空间 {minimum_space}")
            if (re.search(r"序号.*位|至少几位|序号空间", text)
                    and not re.search(r"最大窗口|窗口最大|最多.*窗口", text)):
                answer_value = float(bits)
        if len(protocols) > 1:
            compare = ("GBN 接收窗口为 1，丢失帧后回退重传；SR 接收窗口为 W，可缓存失序帧并只重传丢失帧。"
                       "相同窗口下 SR 重传开销更小，但接收端需要更多缓存和逐帧确认。")
            _frame(frames, "compare", "GBN 与 SR 对照", compare, 1,
                   协议对照="GBN：W≤N−1，接收窗口1；SR：W≤N/2，接收窗口W")
            answer_bits.append(compare)
    elif seq_space is not None:
        bits = int(math.ceil(math.log2(seq_space)))
        _frame(frames, "sequence", "序号空间与位数",
               f"序号空间 {seq_space} 需要至少 {bits} 位二进制序号（2^{bits}={1 << bits}）。", 1,
               序号空间=str(seq_space), 最少位数=str(bits))
        answer_bits.append(f"序号空间 {seq_space} 至少需要 {bits} 位序号")
        if re.search(r"序号.*位|至少几位|序号空间", text):
            answer_value = float(bits)

    frame_time = _time_seconds(text, r"帧发送时间|发送一帧(?:的)?时间|帧传输时间|T_frame|发送时延")
    rate = _rate_bps(text, r"链路带宽|链路速率|带宽|数据率|传输速率|速率")
    data_bits = _size_bits(text, r"帧(?:长度|大小|长)?|数据(?:长度|大小)?|分组(?:长度|大小|长)?")
    if frame_time is None and rate and data_bits:
        frame_time = data_bits / rate
    rtt = _time_seconds(text, r"RTT|往返时延|往返时间")
    propagation = _time_seconds(text, r"单程传播时延|传播时延")
    if rtt is None and propagation is not None:
        rtt = 2 * propagation
    if re.search(r"利用率|信道利用率|效率", text):
        if frame_time is None or rtt is None:
            if re.search(r"求|计算|多少|为多少", text):
                raise ValueError("计算信道利用率需要帧发送时间（或帧长与速率）以及 RTT/传播时延")
        else:
            util_window = window if window is not None else (
                1 if protocol == "stop" else max_window)
            if protocol != "stop" and util_window is None:
                if re.search(r"求|计算|多少|为多少", text):
                    raise ValueError("GBN/SR 利用率需要发送窗口大小")
            else:
                util_window = util_window or 1
                if protocol == "stop":
                    utilization = frame_time / (frame_time + rtt)
                else:
                    utilization = min(1.0, util_window * frame_time / (frame_time + rtt))
                _frame(frames, "utilization", "信道利用率",
                       f"帧发送时间 {_fmt_time(frame_time)}，RTT {_fmt_time(rtt)}；"
                       f"利用率 = {'T/(T+RTT)' if protocol == 'stop' else 'min(1, W×T/(T+RTT))'} "
                       f"= {_fmt(utilization * 100)}%。", 5,
                       帧发送时间=_fmt_time(frame_time), RTT=_fmt_time(rtt),
                       窗口=str(util_window), 利用率=f"{_fmt(utilization * 100)}%")
                answer_bits.append(f"信道利用率 {_fmt(utilization * 100)}%")
                stats["utilization"] = utilization
                answer_value = utilization * 100

    total_frames_match = re.search(r"共\s*(\d+)\s*(?:个)?帧|发送\s*(\d+)\s*帧", text)
    total_frames = int(next(group for group in total_frames_match.groups() if group)) if total_frames_match else None
    lost_match = re.search(r"第\s*(\d+)\s*帧(?:丢失|出错|损坏)|(\d+)\s*号帧(?:丢失|出错|损坏)", text)
    lost = int(next(group for group in lost_match.groups() if group)) if lost_match else None
    if lost is not None and total_frames and protocol:
        if window is None and seq_space:
            window = max(1, seq_space - 1 if protocol == "gbn" else seq_space // 2)
        if window is None:
            raise ValueError("演示丢帧与窗口变化需要发送窗口大小")
        if not 0 <= lost < total_frames:
            raise ValueError(f"丢失帧序号 {lost} 超出总帧数 {total_frames}")
        trace, trace_stats = _window_trace(protocol, total_frames, window, lost)
        frames.extend(trace)
        answer_bits.append(f"帧 {lost} 丢失：{protocol_label[protocol]} 机制下重传 {trace_stats['count']} 帧")
        stats.update(trace_stats)
        if re.search(r"重传.*几帧|重传多少|重传帧数", text):
            answer_value = float(trace_stats["count"])
    elif re.search(r"丢帧|重传|窗口变化", text):
        if protocol == "stop":
            detail = "停止等待：发送帧后窗口停在 1 个未确认帧；超时重传同一帧，收到 ACK 后才能发送下一帧。"
        elif protocol == "sr":
            detail = "SR：发送窗口内的帧可连续发送；丢失帧被单独重传，后续已缓存帧不重传。"
        else:
            detail = "GBN：接收窗口只有 1；某帧丢失后，其后的帧即使到达也被丢弃，超时后从丢失帧开始全部重传。"
        _frame(frames, "loss_concept", "丢帧与重传规则", detail, 4,
               协议=protocol_label.get(protocol or "gbn", "滑动窗口"), 接收窗口="1" if protocol != "sr" else "W")
        answer_bits.append(detail)

    if not frames:
        detail = ("停止等待发送窗口为 1；GBN 接收窗口为 1，发送窗口 W 满足 W≤2^n−1；"
                  "SR 收发窗口可大于 1，需满足 2W≤2^n。超时后 GBN 回退重传，SR 只重传未确认帧。")
        _frame(frames, "concept", "滑动窗口协议", detail, 1,
               停止等待="W=1", GBN="W≤2^n−1", SR="2W≤2^n")
        answer_bits.append(detail)

    answer = "；".join(dict.fromkeys(answer_bits))
    metrics = []
    if "utilization" in stats:
        metrics.append({"id": "utilization", "label": "信道利用率", "value": f"{_fmt(stats['utilization'] * 100)}%"})
    return _ok("sliding_window", answer, frames, PSEUDOCODES["sliding_window"],
               checks=[_check("window_bound", "窗口与序号空间约束", True,
                              "GBN：W≤N−1；SR：W≤N/2；停止等待：W=1。")],
               notes=["窗口变化演示假设只有一个数据帧丢失、ACK 不丢失，且序号从 0 开始。",
                      "信道利用率忽略处理时延与 ACK 发送时间；GBN/SR 使用窗口完全利用的稳态公式。",
                      "序号位数按 2 的幂序号空间计算。"],
               answer_value=answer_value, metrics=metrics, stats=stats)


# ---------------------------------------------------------------------------
# 6) 介质访问控制
# ---------------------------------------------------------------------------

def _eval_mac(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    if re.search(r"ALOHA", text, re.I):
        slotted = bool(re.search(r"时隙\s*ALOHA|分槽\s*ALOHA|slotted", text, re.I))
        load = _number_after(text, r"G|网络负载|提供负载|负载")
        if load is not None:
            efficiency = load * math.exp(-load if slotted else -2 * load)
            _frame(frames, "aloha", f"{'时隙' if slotted else '纯'} ALOHA 吞吐率",
                   f"G={_fmt(load)}，S = G×e^{'-G' if slotted else '-2G'} = {_fmt(efficiency * 100)}%。", 1,
                   ALOHA="时隙" if slotted else "纯", G=_fmt(load), 吞吐率=f"{_fmt(efficiency * 100)}%")
            answer_bits.append(f"{'时隙' if slotted else '纯'} ALOHA 在 G={_fmt(load)} 时吞吐率 {_fmt(efficiency * 100)}%")
            answer_value = efficiency * 100
            stats["aloha"] = {"slotted": slotted, "G": load, "S": efficiency}
        else:
            max_eff = 1 / math.e if slotted else 1 / (2 * math.e)
            _frame(frames, "aloha", f"{'时隙' if slotted else '纯'} ALOHA",
                   f"吞吐率公式 S={'G e^(−G)' if slotted else 'G e^(−2G)'}；"
                   f"最大值在 G={1 if slotted else 0.5} 处取得，约 {_fmt(max_eff * 100)}%。", 1,
                   公式="G e^(−G)" if slotted else "G e^(−2G)", 最大吞吐率=f"{_fmt(max_eff * 100)}%")
            answer_bits.append(f"{'时隙' if slotted else '纯'} ALOHA 最大吞吐率约 {_fmt(max_eff * 100)}%")
            if re.search(r"最大吞吐率|最高", text):
                answer_value = max_eff * 100

    if re.search(r"CSMA\s*/\s*CD|CSMA/CD|冲突检测|以太网|最小帧", text, re.I):
        rate = _rate_bps(text, r"链路带宽|链路速率|数据率|传输速率|速率") or _any_rate_bps(text)
        one_way = _time_seconds(text, r"单程传播时延|传播时延")
        if one_way is None:
            distance = _meters(text, r"总线长度|电缆长度|链路长度|距离")
            speed = _speed_mps(text, r"信号传播速率|传播速率|电磁波速度")
            if distance and speed:
                one_way = distance / speed
        contention = _time_seconds(text, r"争用期|冲突窗口|冲突检测时间")
        given_frame = _size_bits(text, r"最小帧长")
        if rate and given_frame and contention is None and one_way is None and re.search(r"争用期|冲突窗口|争用时间", text):
            contention = given_frame / rate
            _frame(frames, "contention", "由最小帧长求争用期",
                   f"争用期 2τ = Lmin / R = {_fmt(given_frame)} bit / {_fmt_rate(rate)} = "
                   f"{_fmt_time(contention)}；单程传播时延 τ={_fmt_time(contention / 2)}。", 2,
                   最小帧长=f"{_fmt(given_frame)} bit", 速率=_fmt_rate(rate),
                   争用期=_fmt_time(contention), 单程传播时延=_fmt_time(contention / 2))
            answer_bits.append(f"争用期 2τ = {_fmt_time(contention)}")
            stats["csma_cd"] = {"tau_s": contention / 2, "rate_bps": rate,
                                "min_bits": given_frame, "contention_s": contention}
            answer_value = contention * 1e3
        if rate and (one_way or contention) and "csma_cd" not in stats:
            tau = one_way if one_way is not None else (contention or 0.0) / 2
            minimum_bits = 2 * tau * rate
            _frame(frames, "min_frame", "CSMA/CD 最小帧长",
                   f"单程传播时延 τ={_fmt_time(tau)}，速率 {_fmt_rate(rate)}；"
                   f"Lmin = 2τR = {_fmt(minimum_bits)} bit = {_fmt(minimum_bits / 8)} B。", 2,
                   单程传播时延=_fmt_time(tau), 速率=_fmt_rate(rate),
                   最小帧长=f"{_fmt(minimum_bits)} bit", 最小帧长字节=f"{_fmt(minimum_bits / 8)} B")
            answer_bits.append(f"最小帧长 {_fmt(minimum_bits)} bit（{_fmt(minimum_bits / 8)} B）")
            stats["csma_cd"] = {"tau_s": tau, "rate_bps": rate, "min_bits": minimum_bits}
            if re.search(r"字节|B\b", text):
                answer_value = minimum_bits / 8
            else:
                answer_value = minimum_bits
        elif "csma_cd" not in stats and re.search(r"最小帧长", text):
            _frame(frames, "min_frame", "CSMA/CD 最小帧长公式",
                   "Lmin = 2τR：帧发送时间必须不小于往返传播时延 2τ，发送端才能检测到冲突。"
                   "经典以太网在 10Mbps、争用期 51.2μs 时最小帧长为 512bit=64B。", 2,
                   公式="Lmin = 2τR", 经典值="64 B")
            answer_bits.append("Lmin=2τR；经典以太网最小帧长 64B")

    backoff_match = re.search(r"第\s*(\d+)\s*次冲突|冲突\s*(\d+)\s*次|k\s*=\s*(\d+)", text)
    if backoff_match and re.search(r"退避|冲突|时隙|二进制指数", text):
        collisions = int(next(group for group in backoff_match.groups() if group))
        capped = min(collisions, 10)
        slots = 1 << capped
        maximum = slots - 1
        slot_time = _time_seconds(text, r"时间片|时隙|slot\s*time|争用期")
        rate = _rate_bps(text, r"链路带宽|链路速率|速率|数据率") or _any_rate_bps(text)
        if slot_time is None and rate:
            slot_time = 512 / rate
        detail = (f"第 {collisions} 次冲突后 k=min({collisions},10)={capped}，"
                  f"从 0…{maximum} 共 {slots} 个时隙中随机选择")
        if slot_time is not None:
            detail += f"；每个时隙 {_fmt_time(slot_time)}，最大等待 {_fmt_time(maximum * slot_time)}。"
        _frame(frames, "backoff", "二进制指数退避", detail, 3,
               冲突次数=str(collisions), k=str(capped), 可选时隙=f"0…{maximum}",
               最大时隙数=str(maximum),
               最大等待=_fmt_time(maximum * slot_time) if slot_time is not None else "未给出")
        answer_bits.append(f"第 {collisions} 次冲突后从 0…{maximum} 个时隙中随机退避"
                           + (f"，最大等待 {_fmt_time(maximum * slot_time)}" if slot_time is not None else ""))
        stats["backoff"] = {"collisions": collisions, "k": capped, "max_slot": maximum,
                            "slot_time_s": slot_time}
        if re.search(r"时间|ms|μs|等待", text):
            answer_value = maximum * slot_time * 1e3 if slot_time is not None else None
        else:
            answer_value = float(maximum)

    if re.search(r"CSMA\s*/\s*CA|CSMA/CA|冲突避免", text, re.I):
        detail = ("CSMA/CA 用于无线网络：先监听，空闲后等待 IFS 并进入随机退避；"
                  "接收端成功收到后返回 ACK。由于无线端难以边发边听，不能用 CSMA/CD 的冲突检测，"
                  "而用确认、RTS/CTS 和退避避免冲突。")
        _frame(frames, "csma_ca", "CSMA/CA", detail, 5,
               机制="监听 + IFS + 退避 + ACK", 可选="RTS/CTS", 特点="避免冲突而非检测")
        answer_bits.append("CSMA/CA 用 IFS、随机退避、ACK（可选 RTS/CTS）避免冲突，不能边发边听检测冲突")

    if re.search(r"1-坚持|非坚持|p-坚持|CSMA协议|载波监听", text):
        detail = ("1-坚持 CSMA：忙则持续监听，空闲立即发送；非坚持 CSMA：忙则随机等待后再监听；"
                  "p-坚持 CSMA：空闲时以概率 p 发送、1−p 推迟到下一时隙。")
        _frame(frames, "csma", "CSMA 坚持策略", detail, 1,
               一坚持="空闲立即发", 非坚持="随机等待", p坚持="概率 p 发送")
        answer_bits.append("1-坚持空闲立即发送；非坚持随机等待；p-坚持以概率 p 发送")

    if not frames:
        detail = ("ALOHA 不监听直接发送；CSMA 先监听再发送；CSMA/CD 边发边听并检测冲突，"
                  "最小帧长 Lmin=2τR；CSMA/CA 用退避、ACK 和可选的 RTS/CTS 避免冲突。")
        _frame(frames, "concept", "介质访问控制总览", detail, 1,
               ALOHA="直接发送", CSMA="先听后发", CSMA_CD="边发边听", CSMA_CA="避碰+确认")
        answer_bits.append(detail)

    answer = "；".join(dict.fromkeys(answer_bits))
    metrics = []
    if "csma_cd" in stats:
        metrics.append({"id": "min_frame", "label": "最小帧长",
                        "value": f"{_fmt(stats['csma_cd']['min_bits'])} bit"})
    return _ok("mac", answer, frames, PSEUDOCODES["mac"],
               checks=[_check("window", "最小帧长条件", True,
                              "Lmin=2τR 保证发送时间覆盖冲突窗口 2τ。")],
               notes=["ALOHA 吞吐率按无限用户泊松到达模型；纯 ALOHA 最大约 18.4%，时隙 ALOHA 约 36.8%。",
                      "以太网退避时 k 最多取 10，之后保持 1023 个时隙的上限。",
                      "最小帧长计算中的 τ 为单程传播时延，2τ 为争用期。"],
               answer_value=answer_value, metrics=metrics, stats=stats)


# ---------------------------------------------------------------------------
# 第二波通用工具：IPv4 / IPv6 / MAC / 窗口
# ---------------------------------------------------------------------------

def _ipv4_to_int(value: str) -> int:
    parts = value.split(".")
    if len(parts) != 4 or any(not part.isdigit() or not 0 <= int(part) <= 255 for part in parts):
        raise ValueError(f"无效 IPv4 地址：{value}")
    return sum(int(part) << (24 - 8 * index) for index, part in enumerate(parts))


def _int_to_ipv4(value: int) -> str:
    value &= 0xFFFFFFFF
    return ".".join(str((value >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def _prefix_from_mask(mask: str) -> int:
    if re.fullmatch(r"\d{1,2}", mask):
        prefix = int(mask)
        if not 0 <= prefix <= 32:
            raise ValueError("掩码前缀需在 0–32 之间")
        return prefix
    value = _ipv4_to_int(mask)
    bits = f"{value:032b}"
    if "01" in bits:
        raise ValueError("子网掩码必须是连续的 1 后接连续的 0")
    return bits.count("1")


def _mask_int(prefix: int) -> int:
    return (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF if prefix else 0


def _ipv4_candidates(text: str) -> list[tuple[int, int | None, str]]:
    result = []
    for match in re.finditer(r"(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?:/(\d{1,2}))?(?![\d.])", text):
        try:
            value = _ipv4_to_int(match.group(1))
        except ValueError:
            continue
        prefix = int(match.group(2)) if match.group(2) else None
        if prefix is not None and not 0 <= prefix <= 32:
            continue
        result.append((value, prefix, match.group(0)))
    return result


def _find_mask_prefix(text: str, explicit_prefix: int | None) -> int | None:
    if explicit_prefix is not None:
        return explicit_prefix
    match = re.search(r"(?:子网掩码|掩码)\s*(?:为|是|=|:|：)?\s*"
                      r"((?:\d{1,3}\.){3}\d{1,3}|/\s*\d{1,2}|\d{1,2})", text)
    if match:
        token = match.group(1).lstrip("/").strip()
        return _prefix_from_mask(token)
    match = re.search(r"/(\d{1,2})", text)
    return int(match.group(1)) if match else None


def _ipv4_network(prefix: int) -> tuple[int, int, int]:
    mask = _mask_int(prefix)
    return mask, 0, 0xFFFFFFFF ^ mask


def _ipv6_expand(address: str) -> list[int]:
    address = address.strip().lower()
    if not re.fullmatch(r"[0-9a-f:]+", address):
        raise ValueError(f"无效 IPv6 地址：{address}")
    if address.count("::") > 1:
        raise ValueError("IPv6 地址中 :: 只能出现一次")
    if "::" in address:
        left_text, right_text = address.split("::")
        left = [group for group in left_text.split(":") if group]
        right = [group for group in right_text.split(":") if group]
        missing = 8 - len(left) - len(right)
        if missing < 1:
            raise ValueError("IPv6 地址组数不正确")
        groups = left + ["0"] * missing + right
    else:
        groups = address.split(":")
    if len(groups) != 8 or any(not re.fullmatch(r"[0-9a-f]{1,4}", group) for group in groups):
        raise ValueError("IPv6 地址应包含 8 组 16 位十六进制数")
    return [int(group, 16) for group in groups]


def _ipv6_compress(groups: list[int]) -> str:
    tokens = [f"{group:x}" for group in groups]
    best_start = -1
    best_len = 0
    index = 0
    while index < len(groups):
        if groups[index] == 0:
            end = index
            while end < len(groups) and groups[end] == 0:
                end += 1
            if end - index > best_len:
                best_start, best_len = index, end - index
            index = end
        else:
            index += 1
    if best_len < 2:
        return ":".join(tokens)
    left = ":".join(tokens[:best_start])
    right = ":".join(tokens[best_start + best_len:])
    return f"{left}::{right}" if left and right else f"{left or ''}::{right or ''}"


def _ipv6_tokens(text: str) -> list[str]:
    result = []
    for match in re.finditer(r"(?<![:0-9a-f])(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?![:0-9a-f])", text, re.I):
        token = match.group(0)
        if token.count(":") >= 2 and token not in result:
            try:
                _ipv6_expand(token)
            except ValueError:
                continue
            result.append(token)
    return result


def _mss_number(text: str, labels: str) -> tuple[float, str] | None:
    match = re.search(
        rf"(?:{labels})\s*(?:为|是|约|=|:|：)?\s*{_NUM}\s*(MSS|KB|kB|字节|B|个报文段|个 MSS)?",
        text, re.I)
    if not match:
        return None
    value = _number(match.group(1))
    unit = match.group(2) or "MSS"
    if unit.upper() in ("KB", "K") or unit in ("kB", "字节", "B"):
        return value, unit
    return value, "MSS"


def _normalize_mac(token: str) -> str:
    compact = re.sub(r"[^0-9A-Fa-f]", "", token)
    if len(compact) == 12:
        return ":".join(compact[index:index + 2].upper() for index in range(0, 12, 2))
    return token.strip()


# ---------------------------------------------------------------------------
# 7) 以太网、交换机与 VLAN
# ---------------------------------------------------------------------------

def _eval_ethernet(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    if re.search(r"MAC\s*帧|帧格式|前导码|FCS|帧检验序列", text, re.I):
        _frame(frames, "mac_frame", "以太网 MAC 帧格式",
               "前导码 7B + SFD 1B；目的 MAC 6B、源 MAC 6B、类型/长度 2B、数据 46–1500B、FCS 4B。"
               "不含前导码时最小帧长 64B、最大 1518B。", 1,
               前导码="7B + SFD 1B", 目的MAC="6B", 源MAC="6B", 类型长度="2B",
               数据="46–1500B", FCS="4B", 最小帧长="64B")
        answer_bits.append("MAC 帧包含目的/源 MAC、类型/长度、数据和 FCS；最小 64B、最大 1518B")
        stats["mac_frame"] = True

    ports: dict[str, int] = {}
    for left, port in re.findall(
            r"([A-Za-z][A-Za-z0-9_]*)\s*(?:连接|接在|位于|对应)\s*(?:交换机)?\s*(?:端口|接口)\s*(\d+)", text):
        ports[left] = int(port)
    for port, left in re.findall(
            r"(?:端口|接口)\s*(\d+)\s*(?:连接|接|对应)\s*([A-Za-z][A-Za-z0-9_]*)", text):
        ports[left] = int(port)
    event_hits: list[tuple[int, str, str]] = []
    for match in re.finditer(
            r"([A-Za-z][A-Za-z0-9_]*)\s*(?:→|->|发送(?:帧)?给|向|回复|应答|发给)\s*([A-Za-z][A-Za-z0-9_]*)",
            text):
        event_hits.append((match.start(), match.group(1), match.group(2)))
    for match in re.finditer(r"([A-Za-z][A-Za-z0-9_]*)\s*(?:发送|发出)(?:一个)?广播帧?", text):
        event_hits.append((match.start(), match.group(1), "广播"))
    events: list[tuple[str, str]] = []
    for _, source, dest in sorted(event_hits):
        if (source, dest) not in events:
            events.append((source, dest))
    if events and not ports:
        match = re.search(r"([A-Za-z][A-Za-z0-9_]*)\s*(?:从|由)\s*(?:端口|接口)\s*(\d+)", text)
        if match:
            ports[match.group(1)] = int(match.group(2))

    if events and ports and all(source in ports for source, _ in events):
        table: dict[str, int] = {}
        known_ports = sorted(set(ports.values()))
        for number, (source, dest) in enumerate(events, 1):
            ingress = ports[source]
            if table.get(source) != ingress:
                table[source] = ingress
                _frame(frames, "learn", f"学习 {source} → 端口 {ingress}",
                       f"帧 {number} 从端口 {ingress} 进入；交换机把源 MAC {source} 与入端口 {ingress} 写入转发表。", 2,
                       源=source, 入端口=str(ingress), 转发表=dict(table))
            dest_port = table.get(dest)
            broadcast = dest in ("广播", "broadcast") or dest.lower().startswith("ff:")
            if broadcast:
                flood = [port for port in known_ports if port != ingress]
                _frame(frames, "flood", f"帧 {number}：广播泛洪",
                       f"目的地址为广播，交换机向除入端口 {ingress} 外的 {', '.join(map(str, flood)) or '无'} 端口泛洪。", 3,
                       目的="广播", 泛洪端口=", ".join(map(str, flood)), 转发表=dict(table))
                answer_bits.append(f"广播帧从端口 {ingress} 进入，泛洪到 {flood}")
            elif dest_port is None:
                flood = [port for port in known_ports if port != ingress]
                _frame(frames, "flood", f"帧 {number}：目的 {dest} 未知，泛洪",
                       f"转发表没有 {dest}，交换机向除端口 {ingress} 外的 {', '.join(map(str, flood)) or '无'} 端口泛洪。", 3,
                       目的=dest, 泛洪端口=", ".join(map(str, flood)), 转发表=dict(table))
                answer_bits.append(f"目的 {dest} 未知，泛洪到 {flood}")
            elif dest_port == ingress:
                _frame(frames, "filter", f"帧 {number}：目的 {dest} 在同端口，过滤",
                       f"目的 MAC {dest} 对应端口 {ingress}，与入端口相同，交换机不转发。", 3,
                       目的=dest, 目的端口=str(dest_port), 转发表=dict(table))
                answer_bits.append(f"目的 {dest} 与源同端口，过滤")
            else:
                _frame(frames, "forward", f"帧 {number}：转发到端口 {dest_port}",
                       f"转发表已学习 {dest} → 端口 {dest_port}，只从该端口转发。", 3,
                       目的=dest, 目的端口=str(dest_port), 转发表=dict(table))
                answer_bits.append(f"目的 {dest} 已知，转发到端口 {dest_port}")
        stats["forwarding_table"] = dict(table)
        answer_bits.append("最终转发表：" + "，".join(f"{mac}→端口{port}" for mac, port in sorted(table.items())))
        if re.search(r"转发表.*(?:几|多少)|表项.*(?:几|多少)", text):
            answer_value = float(len(table))

    if re.search(r"冲突域|广播域|集线器|hub|路由器|VLAN", text, re.I):
        _frame(frames, "domains", "冲突域与广播域",
               "集线器所有端口在同一个冲突域；交换机每个端口是一个独立冲突域；"
               "路由器和 VLAN 隔离广播域；默认一个交换机（不划分 VLAN）是一个广播域。", 4,
               冲突域="交换机每端口一个", 广播域="路由器/VLAN 隔离", VLAN="隔离广播域")
        answer_bits.append("集线器不隔离冲突域；交换机每端口一个冲突域；路由器/VLAN 隔离广播域")

    if re.search(r"VLAN|802\.1Q|虚拟局域网", text, re.I):
        _frame(frames, "vlan", "VLAN 与 802.1Q",
               "VLAN 把一个物理交换机划分成多个逻辑广播域；Access 端口属于一个 VLAN，"
               "Trunk 端口用 802.1Q 标签承载多个 VLAN（TPID 0x8100，VID 12 位）。", 5,
               VLAN="逻辑广播域", Access="单 VLAN", Trunk="多 VLAN 标签", 标签="802.1Q 4B")
        answer_bits.append("VLAN 用逻辑划分隔离广播域；Trunk 通过 802.1Q 标签承载多个 VLAN")

    if not frames:
        _frame(frames, "concept", "交换机自学习",
               "交换机收到帧先学习源 MAC 与端口；目的 MAC 已知则定向转发，未知或广播则除入端口外泛洪。"
               "冲突域按端口隔离，广播域由路由器和 VLAN 隔离。", 1,
               学习="源 MAC → 入端口", 转发="已知定向/未知泛洪", 广播域="路由器/VLAN")
        answer_bits.append("交换机学习源 MAC 与端口；已知目的定向转发，未知/广播泛洪")

    answer = "；".join(dict.fromkeys(answer_bits))
    return _ok("ethernet", answer, frames, PSEUDOCODES["ethernet"],
               checks=[_check("learning", "源 MAC 学习先于转发", True,
                              "交换机先记录源 MAC 与入端口，再查目的 MAC。")],
               notes=["转发表按简化模型无老化时间；实际交换表项会老化。",
                      "MAC 帧长度不含前导码；VLAN 标签会使最大帧长增加 4B。"],
               answer_value=answer_value, stats=stats)


# ---------------------------------------------------------------------------
# 8) IPv4 与 IPv6
# ---------------------------------------------------------------------------

def _subnet_hosts(prefix: int) -> int:
    if prefix == 32:
        return 1
    if prefix == 31:
        return 2
    return (1 << (32 - prefix)) - 2


def _format_ipv4_range(network: int, prefix: int) -> dict[str, Any]:
    mask = _mask_int(prefix)
    broadcast = network | (0xFFFFFFFF ^ mask)
    first = network + (1 if prefix <= 30 else 0)
    last = broadcast - (1 if prefix <= 30 else 0)
    return {"network": _int_to_ipv4(network), "broadcast": _int_to_ipv4(broadcast),
            "first": _int_to_ipv4(first), "last": _int_to_ipv4(last),
            "hosts": _subnet_hosts(prefix), "mask": _int_to_ipv4(mask), "prefix": prefix}


def _eval_ip(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None
    answer_order: list[str] | None = None

    if re.search(r"分片|片偏移|MF|DF|MTU", text, re.I) and re.search(r"总长度|数据报长度|MTU", text, re.I):
        total_bits = _size_bits(text, r"IP\s*数据报(?:总长度|长度)|数据报(?:总长度|长度)|总长度")
        mtu_bits = _size_bits(text, r"MTU|最大传送单元")
        header_bits = _size_bits(text, r"(?:IP\s*)?首部(?:长度)?") or 20 * 8
        if total_bits is None or mtu_bits is None:
            raise ValueError("IP 分片需要给出数据报总长度和 MTU")
        total, mtu, header = total_bits / 8, mtu_bits / 8, header_bits / 8
        if total <= mtu:
            answer = f"数据报长度 {_fmt(total)} B ≤ MTU {_fmt(mtu)} B，不需要分片"
            _frame(frames, "no_fragment", "无需分片", answer, 1,
                   总长度=f"{_fmt(total)} B", MTU=f"{_fmt(mtu)} B")
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["MTU 包含 IP 首部。"], stats={"fragments": 1})
        if re.search(r"DF\s*=\s*1|不分片", text, re.I):
            answer = "DF=1 且数据报超过 MTU，路由器应丢弃并返回 ICMP 差错"
            _frame(frames, "df_drop", "禁止分片", answer, 2, DF="1", MTU=f"{_fmt(mtu)} B")
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["DF 置 1 时不能分片，超长数据报被丢弃。"], stats={"dropped": True})
        max_data = int((mtu - header) // 8) * 8
        if max_data <= 0:
            raise ValueError("MTU 必须大于 IP 首部长度")
        payload = int(total - header)
        fragments = []
        offset = 0
        while offset < payload:
            data = min(max_data, payload - offset)
            fragments.append({"data": data, "length": data + header, "offset": offset // 8,
                              "mf": 1 if offset + data < payload else 0})
            offset += data
        for index, fragment in enumerate(fragments, 1):
            _frame(frames, "fragment", f"分片 {index}",
                   f"数据长度 {_fmt(fragment['data'])} B，总长度 {_fmt(fragment['length'])} B，"
                   f"片偏移 {fragment['offset']}（8B 单位），MF={fragment['mf']}。", 2,
                   分片=str(index), 数据长度=f"{_fmt(fragment['data'])} B",
                   总长度=f"{_fmt(fragment['length'])} B", 片偏移=str(fragment["offset"]),
                   MF=str(fragment["mf"]))
        answer_bits.append(f"分为 {len(fragments)} 片：" + "；".join(
            f"偏移 {fragment['offset']}、MF={fragment['mf']}" for fragment in fragments))
        answer_order = [str(fragment["offset"]) for fragment in fragments]
        stats["fragments"] = fragments
        if re.search(r"几片|分为几|分片数|几个分片", text):
            answer_value = float(len(fragments))
        return _ok("ip", "；".join(answer_bits), frames, PSEUDOCODES["ip"],
                   checks=[_check("align", "分片按 8 字节对齐", True,
                                  "除最后一片外，各片数据长度都是 8 的倍数。")],
                   notes=["片偏移以 8 字节为单位；MF=1 表示后面还有分片。",
                          "默认 IP 首部 20B；题面给出首部长度时以题面为准。"],
                   answer_value=answer_value, answer_order=answer_order, stats=stats)

    ipv6_tokens = _ipv6_tokens(text)
    if ipv6_tokens:
        for token in ipv6_tokens[:2]:
            groups = _ipv6_expand(token)
            expanded = ":".join(f"{group:04x}" for group in groups)
            compressed = _ipv6_compress(groups)
            _frame(frames, "ipv6", "IPv6 地址展开与压缩",
                   f"{token} → 完整形式 {expanded}，压缩形式 {compressed}。", 1,
                   原地址=token, 完整形式=expanded, 压缩形式=compressed)
            answer_bits.append(f"{token} 的完整形式 {expanded}，压缩形式 {compressed}")
        if re.search(r"首部|40\s*B|扩展首部|分片", text, re.I):
            _frame(frames, "ipv6_header", "IPv6 首部",
                   "IPv6 固定首部 40B，取消首部校验和；路由器不分片，分片由源主机完成；"
                   "扩展首部通过 Next Header 链式连接。", 2,
                   固定首部="40B", 分片="源主机", 校验和="取消")
            answer_bits.append("IPv6 固定首部 40B，取消首部校验和，路由器不分片")
        return _ok("ip", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["ip"],
                   notes=["IPv6 的 :: 只能出现一次，压缩最长连续零组。",
                          "十六进制字母大小写不影响地址值。"],
                   stats={"ipv6": [token for token in ipv6_tokens]})

    destination_match = re.search(r"(?:目的地址|目的\s*IP|到达)\s*(?:为|是|=|:|：)?\s*((?:\d{1,3}\.){3}\d{1,3})", text)
    routes = re.findall(
        r"((?:\d{1,3}\.){3}\d{1,3}/\d{1,2})\s*(?:→|->|下一跳|via|经)\s*([A-Za-z0-9_.\-]+)", text)
    if destination_match and routes and re.search(r"最长前缀|转发|路由表|匹配", text):
        destination = _ipv4_to_int(destination_match.group(1))
        best = None
        for cidr, next_hop in routes:
            try:
                network_text, prefix_text = cidr.split("/")
                network = _ipv4_to_int(network_text)
                prefix = int(prefix_text)
            except (ValueError, IndexError):
                continue
            if 0 <= prefix <= 32 and destination & _mask_int(prefix) == network & _mask_int(prefix):
                if best is None or prefix > best[1]:
                    best = (cidr, prefix, next_hop)
        if best:
            _frame(frames, "lpm", "最长前缀匹配",
                   f"目的地址 {destination_match.group(1)} 命中 {best[0]}，下一跳 {best[2]}；"
                   "在所有匹配前缀中选择前缀最长的一项。", 2,
                   目的地址=destination_match.group(1), 命中前缀=best[0], 下一跳=best[2])
            answer = f"最长前缀 {best[0]}，下一跳 {best[2]}"
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["最长前缀匹配只看目的地址与前缀，不看管理距离。"],
                       answer_order=[best[0], best[2]], stats={"route": best})
        answer = f"目的地址 {destination_match.group(1)} 没有匹配的路由"
        _frame(frames, "lpm", "无匹配路由", answer, 2, 目的地址=destination_match.group(1))
        return _ok("ip", answer, frames, PSEUDOCODES["ip"], notes=["默认路由 0.0.0.0/0 可兜底。"])

    candidates = _ipv4_candidates(text)
    if candidates:
        address, explicit_prefix, raw = candidates[0]
        prefix = _find_mask_prefix(text, explicit_prefix)
        requirements = [
            (name, int(count)) for name, count in re.findall(
                r"([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z_]*?)\s*(?:需要|要|分配)?\s*(\d+)\s*台",
                text)
            if int(count) > 0
        ]
        if re.search(r"VLSM|可变长子网|可变长度子网", text, re.I) and prefix is not None and requirements:
            current = address & _mask_int(prefix)
            block_end = current + (1 << (32 - prefix))
            allocations = []
            for name, hosts in sorted(requirements, key=lambda item: item[1], reverse=True):
                host_bits = max(1, int(math.ceil(math.log2(hosts + 2))))
                size = 1 << host_bits
                current = (current + size - 1) & ~(size - 1)
                if current + size > block_end:
                    raise ValueError("VLSM 主机需求超出给定地址块容量")
                subnet = _format_ipv4_range(current, 32 - host_bits)
                allocations.append((name, hosts, subnet))
                current += size
            for name, hosts, subnet in allocations:
                _frame(frames, "vlsm", f"{name}：{hosts} 台主机",
                       f"分配 {subnet['network']}/{subnet['prefix']}，掩码 {subnet['mask']}，"
                       f"可用范围 {subnet['first']}–{subnet['last']}。", 2,
                       部门=name, 需求=f"{hosts} 台", 子网=f"{subnet['network']}/{subnet['prefix']}",
                       掩码=subnet["mask"], 可用范围=f"{subnet['first']}–{subnet['last']}")
            answer = "；".join(f"{name}: {subnet['network']}/{subnet['prefix']}" for name, _, subnet in allocations)
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["VLSM 按需求从大到小分配，并保证每个子网块起始地址对齐。",
                              "主机数需求按 2^h−2 可用地址计算。"],
                       stats={"vlsm": [{"name": name, "hosts": hosts, **subnet}
                                       for name, hosts, subnet in allocations]})
        if re.search(r"聚合|汇总|合并", text) and len(candidates) >= 2 and all(item[1] is not None for item in candidates):
            blocks = []
            for value, block_prefix, _ in candidates:
                block_mask = _mask_int(block_prefix or 0)
                network = value & block_mask
                blocks.append((network, network | (0xFFFFFFFF ^ block_mask)))
            low = min(block[0] for block in blocks)
            high = max(block[1] for block in blocks)
            common = 32 - (low ^ high).bit_length()
            aggregate = low & _mask_int(common)
            _frame(frames, "aggregate", "地址聚合",
                   f"所有子网从 {_int_to_ipv4(low)} 到 {_int_to_ipv4(high)}，"
                   f"最长公共前缀为 /{common}，聚合为 {_int_to_ipv4(aggregate)}/{common}。", 2,
                   聚合地址=f"{_int_to_ipv4(aggregate)}/{common}",
                   起始=_int_to_ipv4(low), 结束=_int_to_ipv4(high))
            answer = f"聚合地址 {_int_to_ipv4(aggregate)}/{common}"
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["聚合地址覆盖从最小网络地址到最大广播地址的整个区间。"],
                       answer_order=[f"{_int_to_ipv4(aggregate)}/{common}"])

        if prefix is None:
            answer = "IPv4 子网题需要给出前缀长度或子网掩码，例如 192.168.1.0/24"
            _frame(frames, "missing_prefix", "缺少掩码", answer, 1, 地址=raw)
            return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                       notes=["未给出掩码时不推断地址类别。"], stats={"address": raw})

        new_prefix = prefix
        subnet_count = None
        subnet_match = re.search(r"划分为\s*(\d+)\s*个子网|需要\s*(\d+)\s*个子网", text)
        if subnet_match:
            requested = int(next(group for group in subnet_match.groups() if group))
            borrow = int(math.ceil(math.log2(requested)))
            new_prefix = prefix + borrow
            subnet_count = 1 << borrow
        host_match = re.search(r"每个子网[^\d]{0,8}(\d+)\s*台主机|每子网[^\d]{0,8}(\d+)\s*台", text)
        if host_match:
            requested_hosts = int(next(group for group in host_match.groups() if group))
            host_bits = int(math.ceil(math.log2(requested_hosts + 2)))
            new_prefix = 32 - host_bits
            subnet_count = 1 << (new_prefix - prefix) if new_prefix >= prefix else 0
        if new_prefix > 32 or new_prefix < prefix:
            raise ValueError("子网划分后的前缀长度不合法")

        base_network = address & _mask_int(prefix)
        base = _format_ipv4_range(base_network, prefix)
        _frame(frames, "subnet", "IPv4 子网计算",
               f"地址 {raw}，掩码 /{prefix}（{base['mask']}）；网络地址 {base['network']}，"
               f"广播地址 {base['broadcast']}，可用主机 {base['first']}–{base['last']}，"
               f"可用主机数 {base['hosts']}。", 1,
               地址=raw, 前缀=f"/{prefix}", 掩码=base["mask"], 网络地址=base["network"],
               广播地址=base["broadcast"], 可用范围=f"{base['first']}–{base['last']}",
               可用主机数=str(base["hosts"]))
        answer_bits.append(f"网络地址 {base['network']}，广播地址 {base['broadcast']}，"
                           f"可用主机 {base['hosts']} 台")
        if new_prefix != prefix:
            block = 1 << (32 - new_prefix)
            rows = []
            for index in range(min(subnet_count or 0, 16)):
                row = _format_ipv4_range(base_network + index * block, new_prefix)
                rows.append(row)
                _frame(frames, "subnet_item", f"子网 {index + 1}",
                       f"{row['network']}/{new_prefix}，广播 {row['broadcast']}，"
                       f"可用 {row['first']}–{row['last']}（{row['hosts']} 台）。", 2,
                       子网=f"{row['network']}/{new_prefix}", 广播=row["broadcast"],
                       可用范围=f"{row['first']}–{row['last']}", 主机数=str(row["hosts"]))
            answer_bits.append(f"划分为 {subnet_count} 个 /{new_prefix} 子网，"
                               f"每子网 {_subnet_hosts(new_prefix)} 台可用主机")
            stats["subnets"] = rows
            if re.search(r"几个子网|子网数", text):
                answer_value = float(subnet_count or 0)
            elif re.search(r"每个子网.*主机|每子网.*主机", text):
                answer_value = float(_subnet_hosts(new_prefix))
            elif re.search(r"子网掩码|掩码|前缀", text) and not re.search(r"主机|可用地址", text):
                answer_value = float(new_prefix)
        else:
            if re.search(r"主机数|多少台主机|可用主机", text):
                answer_value = float(base["hosts"])
            elif re.search(r"子网数|几个子网", text):
                answer_value = 1.0
        stats["subnet"] = base
        answer = "；".join(dict.fromkeys(answer_bits))
        return _ok("ip", answer, frames, PSEUDOCODES["ip"],
                   checks=[_check("network", "网络地址按位与", True,
                                  "网络地址 = IP 地址 & 子网掩码；广播地址 = 网络地址 | 主机位全 1。")],
                   notes=["可用主机数按 2^h−2 计算；/31 按点对点 2 个地址、/32 按单主机处理。",
                          "子网列表最多展示 16 个。"],
                   answer_value=answer_value, stats=stats)

    _frame(frames, "concept", "IPv4/IPv6 基础",
           "IPv4 地址 32 位，用掩码/CIDR 划分子网；最长前缀匹配选择最具体路由；"
           "分片按 8 字节对齐；IPv6 地址 128 位，用 :: 压缩连续零组。", 1,
           IPv4="32 位", IPv6="128 位", 分片="8B 对齐", 压缩=":: 最长零组")
    return _ok("ip", "IPv4 子网、分片、最长前缀和 IPv6 地址压缩规则如上", frames, PSEUDOCODES["ip"],
               notes=["具体计算需要给出 IPv4/IPv6 地址、掩码、MTU 或路由表。"])


# ---------------------------------------------------------------------------
# 9) 网络层协议与路由
# ---------------------------------------------------------------------------

def _eval_network_layer(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}

    if re.search(r"ARP", text, re.I):
        _frame(frames, "arp", "ARP 地址解析",
               "同一广播域内，主机先查 ARP 高速缓存；未命中则广播 ARP 请求（目标 IP，谁有请回答），"
               "目标主机单播 ARP 响应自己的 MAC；请求方写入 ARP 缓存。", 1,
               请求="广播", 响应="单播", 缓存="IP→MAC")
        answer_bits.append("ARP 通过广播请求、单播响应把同网段 IP 解析为 MAC，并写入 ARP 缓存")
    if re.search(r"DHCP", text, re.I):
        _frame(frames, "dhcp", "DHCP 地址分配",
               "DHCP 使用 Discover（广播）→ Offer → Request（广播）→ ACK 四个报文；"
               "服务器分配 IP、子网掩码、默认网关和 DNS。客户端使用 UDP 68，服务器使用 UDP 67。", 2,
               过程="Discover/Offer/Request/ACK", 客户端端口="68", 服务器端口="67")
        answer_bits.append("DHCP 通过 Discover/Offer/Request/ACK 分配 IP、掩码、网关和 DNS")
    if re.search(r"ICMP|ping|traceroute|目的不可达|超时", text, re.I):
        _frame(frames, "icmp", "ICMP 差错与探测",
               "ICMP 封装在 IP 中；ping 使用 Echo Request/Reply，traceroute 利用逐跳 TTL 超时；"
               "路由器可用目的不可达、超时、重定向等差错报文反馈问题。", 3,
               ping="Echo", traceroute="TTL 超时", 差错="不可达/超时")
        answer_bits.append("ICMP 用于差错报告和探测：ping 用 Echo，traceroute 用 TTL 超时")
    if re.search(r"NAT|网络地址转换|私有地址", text, re.I):
        _frame(frames, "nat", "NAT 地址转换",
               "NAT 在私有地址与公网地址之间转换 IP 和端口，并维护映射表；"
               "NAPT 用端口区分多个内网主机，外部主动连接需要端口映射。", 4,
               转换="私有 IP:端口 ↔ 公网 IP:端口", 关键="映射表", 作用="缓解 IPv4 地址不足")
        answer_bits.append("NAT/NAPT 转换私有与公网地址/端口并维护映射表")
        inside = re.search(r"(?:内网|私有|内部)\s*(?:地址)?\s*((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?", text)
        public = re.search(r"(?:公网|外部|全局)\s*(?:地址)?\s*((?:\d{1,3}\.){3}\d{1,3})", text)
        if inside and public:
            _frame(frames, "nat_map", "NAT 映射示例",
                   f"{inside.group(1)}{':' + inside.group(2) if inside.group(2) else ''} ↔ "
                   f"{public.group(1)}{':' + inside.group(2) if inside.group(2) else ''}。", 4,
                   内部=inside.group(0), 公网=public.group(0))
            answer_bits.append(f"NAT 映射 {inside.group(1)} ↔ {public.group(1)}")

    routing = []
    if re.search(r"RIP|距离向量|Bellman|贝尔曼", text, re.I):
        routing.append("RIP 是距离向量协议：周期交换整张距离向量，使用跳数，最大有效跳数 15，16 表示不可达，UDP 520。")
        _frame(frames, "rip", "RIP 距离向量",
               routing[-1] + " 收到邻居向量后按 Bellman-Ford 更新：新距离 = 邻居距离 + 链路开销。", 5,
               类型="距离向量", 度量="跳数", 不可达="16", 传输="UDP 520")
        answer_bits.append(routing[-1])
    if re.search(r"OSPF|链路状态|Dijkstra|LSA", text, re.I):
        routing.append("OSPF 是链路状态协议：泛洪 LSA 建立全网拓扑，每台路由器用 Dijkstra 计算最短路径树，支持区域划分，直接封装在 IP 中（协议号 89）。")
        _frame(frames, "ospf", "OSPF 链路状态",
               routing[-1], 5,
               类型="链路状态", 算法="Dijkstra", 区域="Area 0 骨干", 协议号="89")
        answer_bits.append(routing[-1])
    if re.search(r"BGP|路径向量|自治系统|AS-PATH", text, re.I):
        routing.append("BGP 是自治系统之间的路径向量协议：交换 AS-PATH 等属性，基于 TCP 179，选择无环且策略最优的路径。")
        _frame(frames, "bgp", "BGP 路径向量",
               routing[-1], 6,
               类型="路径向量", 关键="AS-PATH", 传输="TCP 179", 场景="AS 之间")
        answer_bits.append(routing[-1])
    if re.search(r"路由表|转发表|距离向量|链路状态", text, re.I) and not routing:
        _frame(frames, "routing", "路由表与算法",
               "路由表按目的网络/前缀记录下一跳和度量；距离向量用邻居信息迭代，链路状态先建拓扑再算最短路。"
               "实际转发时选最长前缀匹配。", 5,
               路由表="目的网络/前缀 + 下一跳 + 度量", 距离向量="邻居迭代", 链路状态="Dijkstra")
        answer_bits.append("路由表记录目的网络、下一跳和度量；距离向量迭代，链路状态用 Dijkstra")

    if re.search(r"距离向量|RIP", text, re.I) and re.search(r"路由表|更新", text) and re.search(r"发来|邻居", text):
        table_section = _section(text, r"路由表", r"邻居|发来|距离向量|求")
        current: dict[str, tuple[int, str]] = {}
        for dest, cost, next_hop in re.findall(
                r"([A-Za-z0-9_.:/\-]+)\s+(?:距离|开销|代价|metric)?\s*(\d+)"
                r"(?:\s+(?:下一跳|经由|via)?\s*([A-Za-z0-9_]+|直连))?", table_section, re.I):
            if dest.lower() in ("路由表", "距离", "开销", "下一跳"):
                continue
            current[dest] = (int(cost), next_hop or "直连")
        neighbor_match = re.search(r"邻居\s*([A-Za-z0-9_]+)\s*(?:发来|通告)", text)
        neighbor = neighbor_match.group(1) if neighbor_match else "邻居"
        vector_section = _section(text, r"发来|通告", r"链路|求|更新|。")
        vector = {dest: int(cost) for dest, cost in re.findall(
            r"([A-Za-z0-9_.:/\-]+)\s*(?:距离|开销|代价|:)?\s*(\d+)", vector_section)
            if dest.lower() not in ("距离向量", "距离", "开销")}
        link_cost = _number_after(text, r"链路开销|链路代价|链路成本|cost")
        if current and vector and link_cost is not None:
            updated = dict(current)
            changes = []
            for dest, cost in vector.items():
                candidate = cost + int(link_cost)
                old = updated.get(dest)
                if old is None or candidate < old[0] or old[1] == neighbor:
                    if old is None or candidate != old[0] or old[1] != neighbor:
                        changes.append((dest, old, (candidate, neighbor)))
                    updated[dest] = (candidate, neighbor)
            _frame(frames, "dv_current", "当前路由表",
                   "；".join(f"{dest} 距离 {cost} 下一跳 {next_hop}" for dest, (cost, next_hop) in sorted(current.items())), 5,
                   路由表={dest: {"距离": cost, "下一跳": next_hop} for dest, (cost, next_hop) in current.items()})
            _frame(frames, "dv_vector", f"{neighbor} 发来的距离向量",
                   "；".join(f"{dest} {cost}" for dest, cost in sorted(vector.items()))
                   + f"；链路开销 {_fmt(link_cost)}。", 5,
                   邻居=neighbor, 距离向量=dict(vector), 链路开销=_fmt(link_cost))
            _frame(frames, "dv_update", "更新后的路由表",
                   "；".join(f"{dest} 距离 {cost} 下一跳 {next_hop}" for dest, (cost, next_hop) in sorted(updated.items())), 5,
                   路由表={dest: {"距离": cost, "下一跳": next_hop} for dest, (cost, next_hop) in updated.items()},
                   变化=len(changes))
            answer_bits.append("更新后路由表：" + "；".join(
                f"{dest} {cost} {next_hop}" for dest, (cost, next_hop) in sorted(updated.items())))
            if re.search(r"几条|几个.*更新|变化", text):
                return _ok("network_layer", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["network_layer"],
                           notes=["距离向量更新按 Bellman-Ford：候选距离 = 邻居距离 + 链路开销。",
                                  "若下一跳就是该邻居，即使距离变大也按邻居的新向量更新。"],
                           answer_value=float(len(changes)),
                           answer_order=[dest for dest, _, _ in changes],
                           stats={"current": current, "vector": vector, "updated": updated})
            return _ok("network_layer", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["network_layer"],
                       notes=["距离向量更新按 Bellman-Ford：候选距离 = 邻居距离 + 链路开销。",
                              "若下一跳就是该邻居，即使距离变大也按邻居的新向量更新。"],
                       answer_order=[dest for dest, _, _ in changes],
                       stats={"current": current, "vector": vector, "updated": updated})

    if not frames:
        _frame(frames, "concept", "网络层协议",
               "ARP 解析同网段 MAC；DHCP 分配地址；ICMP 报告差错；NAT 转换地址；"
               "RIP 距离向量、OSPF 链路状态、BGP 路径向量。", 1,
               ARP="IP→MAC", DHCP="地址分配", ICMP="差错/探测", NAT="地址转换",
               路由="RIP/OSPF/BGP")
        answer_bits.append("ARP、DHCP、ICMP、NAT 与 RIP/OSPF/BGP 的基本作用如上")

    return _ok("network_layer", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["network_layer"],
               notes=["具体路由表更新需要给出当前表、邻居向量和链路开销；未给出时只讲算法规则。",
                      "RIP/OSPF/BGP 的管理距离、计时器等实现细节按教材口径可能不同。"],
               stats=stats)


# ---------------------------------------------------------------------------
# 10) UDP 与 TCP 基础
# ---------------------------------------------------------------------------

_SERVICE_PORTS = {20: "FTP 数据", 21: "FTP 控制", 22: "SSH", 23: "Telnet", 25: "SMTP",
                  53: "DNS", 67: "DHCP 服务器", 68: "DHCP 客户端", 80: "HTTP",
                  110: "POP3", 143: "IMAP", 443: "HTTPS"}


def _eval_transport(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    client_isn = None
    server_isn = None
    for label, pattern in (("client", r"(?:客户端|主机\s*A|发送方)[^\n。；]{0,12}(?:初始序号|ISN)\s*(?:为|是|=|:)?\s*(\d+)"),
                           ("server", r"(?:服务器|主机\s*B|接收方)[^\n。；]{0,12}(?:初始序号|ISN)\s*(?:为|是|=|:)?\s*(\d+)")):
        match = re.search(pattern, text, re.I)
        if match:
            if label == "client":
                client_isn = int(match.group(1))
            else:
                server_isn = int(match.group(1))

    if re.search(r"三次握手|SYN|建立连接", text, re.I):
        c = str(client_isn) if client_isn is not None else "x"
        s = str(server_isn) if server_isn is not None else "y"
        c_next = str(client_isn + 1) if client_isn is not None else "x+1"
        s_next = str(server_isn + 1) if server_isn is not None else "y+1"
        _frame(frames, "syn", "第一次握手：客户端 → 服务器 SYN",
               f"SYN=1，seq={c}；SYN 消耗一个序号。", 1, 报文="SYN", seq=c, ack="—", 状态="SYN_SENT")
        _frame(frames, "synack", "第二次握手：服务器 → 客户端 SYN+ACK",
               f"SYN=1，ACK=1，seq={s}，ack={c_next}；服务器进入 SYN_RCVD。", 2,
               报文="SYN+ACK", seq=s, ack=c_next, 状态="SYN_RCVD")
        _frame(frames, "ack", "第三次握手：客户端 → 服务器 ACK",
               f"ACK=1，seq={c_next}，ack={s_next}；双方进入 ESTABLISHED。", 3,
               报文="ACK", seq=c_next, ack=s_next, 状态="ESTABLISHED")
        answer_bits.append(f"三次握手：SYN seq={c}；SYN+ACK seq={s} ack={c_next}；ACK seq={c_next} ack={s_next}")
        if client_isn is not None and server_isn is not None:
            if re.search(r"确认号|ack", text, re.I):
                answer_value = float(server_isn + 1)
            elif re.search(r"第三次.*序号|下一个序号", text):
                answer_value = float(client_isn + 1)
        stats["handshake"] = {"client_isn": client_isn, "server_isn": server_isn}

    if re.search(r"四次挥手|连接释放|FIN|TIME_WAIT|半关闭", text, re.I):
        c = str(client_isn) if client_isn is not None else "x"
        s = str(server_isn) if server_isn is not None else "y"
        _frame(frames, "fin1", "第一次挥手：客户端 FIN",
               f"FIN=1，seq={c}；客户端进入 FIN_WAIT_1。", 4, 报文="FIN", seq=c, 状态="FIN_WAIT_1")
        _frame(frames, "finack", "第二次挥手：服务器 ACK",
               f"ACK=1，ack={c}+1；服务器进入 CLOSE_WAIT，客户端进入 FIN_WAIT_2。", 4,
               报文="ACK", ack=f"{c}+1", 状态="FIN_WAIT_2 / CLOSE_WAIT")
        _frame(frames, "fin2", "第三次挥手：服务器 FIN",
               f"服务器发送 FIN=1，seq={s}；服务器进入 LAST_ACK。", 4,
               报文="FIN", seq=s, 状态="LAST_ACK")
        _frame(frames, "ack2", "第四次挥手：客户端 ACK",
               f"ACK=1，ack={s}+1；客户端进入 TIME_WAIT，等待 2MSL 后 CLOSED。", 4,
               报文="ACK", ack=f"{s}+1", 状态="TIME_WAIT")
        answer_bits.append("四次挥手：FIN→ACK→FIN→ACK；主动关闭方进入 TIME_WAIT 并等待 2MSL")
        stats["release"] = True

    sequence = _int_after(text, r"初始序号|ISN|序号(?:为|是)?")
    data_length = _int_after(text, r"(?:发送|携带|数据长度|数据)[^\n。；]{0,6}(\d+)\s*字节|数据长度")
    if sequence is None:
        match = re.search(r"seq\s*=\s*(\d+)", text, re.I)
        sequence = int(match.group(1)) if match else None
    if data_length is None:
        match = re.search(r"(\d+)\s*字节(?:的)?数据", text)
        data_length = int(match.group(1)) if match else None
    if sequence is not None and data_length is not None and not re.search(r"三次握手|四次挥手", text):
        next_seq = sequence + data_length
        if re.search(r"\bSYN\b", text, re.I):
            next_seq += 1
        if re.search(r"\bFIN\b", text, re.I):
            next_seq += 1
        _frame(frames, "seq", "TCP 序号推进",
               f"初始序号 {sequence}，数据 {data_length} 字节"
               + ("，SYN 再消耗 1 个序号" if re.search(r"\bSYN\b", text, re.I) else "")
               + ("，FIN 再消耗 1 个序号" if re.search(r"\bFIN\b", text, re.I) else "")
               + f"；下一个序号为 {next_seq}。", 2,
               初始序号=str(sequence), 数据长度=f"{data_length} B", 下一个序号=str(next_seq))
        answer_bits.append(f"下一个 TCP 序号为 {next_seq}")
        if re.search(r"确认号", text):
            answer_bits.append(f"确认号 = {next_seq}")
        answer_value = float(next_seq)
        stats["sequence"] = {"initial": sequence, "data": data_length, "next": next_seq}

    ports = [int(value) for value in re.findall(r"端口号?\s*(?:为|是|=|:|：)?\s*(\d{1,5})", text)]
    if ports:
        rows = []
        for port in ports[:8]:
            if port <= 1023:
                category = "熟知端口"
            elif port <= 49151:
                category = "登记端口"
            else:
                category = "动态/私有端口"
            if not 0 <= port <= 65535:
                raise ValueError(f"端口 {port} 超出 0–65535")
            rows.append({"port": port, "category": category, "service": _SERVICE_PORTS.get(port, "")})
            _frame(frames, "port", f"端口 {port}",
                   f"{port} 属于{category}" + (f"，常见服务：{_SERVICE_PORTS[port]}。" if port in _SERVICE_PORTS else "。"), 3,
                   端口=str(port), 类别=category, 服务=_SERVICE_PORTS.get(port, "未登记"))
        answer_bits.append("；".join(
            f"{row['port']} {row['category']}" + (f"（{row['service']}）" if row["service"] else "") for row in rows))
        stats["ports"] = rows
        if re.search(r"熟知端口|动态端口|登记端口|哪一类", text):
            answer_value = float(rows[0]["port"])

    if re.search(r"TCP\s*首部|UDP\s*首部|首部格式|校验和", text, re.I):
        if re.search(r"UDP", text, re.I):
            _frame(frames, "udp_header", "UDP 首部",
                   "UDP 首部 8B：源端口 2B、目的端口 2B、长度 2B、校验和 2B。校验和覆盖伪首部、UDP 首部和数据。", 4,
                   长度="8B", 字段="源端口/目的端口/长度/校验和", 校验和="伪首部+首部+数据")
            answer_bits.append("UDP 首部 8B，校验和覆盖伪首部、首部和数据")
        if re.search(r"TCP", text, re.I):
            _frame(frames, "tcp_header", "TCP 首部",
                   "TCP 首部最小 20B：源/目的端口各 2B，序号/确认号各 4B，数据偏移 4bit，"
                   "标志位 SYN/ACK/FIN/RST/PSH/URG，窗口 2B，校验和 2B，紧急指针 2B。", 4,
                   最小长度="20B", 关键字段="序号/确认号/标志/窗口/校验和", 校验和="伪首部+首部+数据")
            answer_bits.append("TCP 首部最小 20B，包含序号、确认号、标志、窗口和校验和")
        _frame(frames, "checksum", "传输层校验和",
               "发送端把校验和字段置 0，对伪首部+首部+数据按 16 位反码求和，结果取反写入；"
               "接收端再求和，结果全 1 表示无错。奇数字节末尾补 0。", 4,
               方法="16 位反码和取反", 伪首部="源/目的 IP + 协议 + 长度", 奇数字节="补 0")

    if re.search(r"TCP.*UDP|UDP.*TCP", text, re.I) and re.search(r"区别|比较|面向连接|可靠", text, re.I):
        _frame(frames, "compare", "TCP 与 UDP 对比",
               "TCP 面向连接、可靠、字节流、首部 20B，有序号/确认/窗口/重传；"
               "UDP 无连接、不可靠、报文边界、首部 8B，适合实时和简单查询。", 5,
               TCP="面向连接/可靠/20B", UDP="无连接/不可靠/8B")
        answer_bits.append("TCP 面向连接可靠、首部 20B；UDP 无连接不可靠、首部 8B")

    if not frames:
        _frame(frames, "concept", "传输层基础",
               "传输层用端口复用/分用；TCP 序号按字节编号，SYN/FIN 各占一个序号；"
               "三次握手建立连接，四次挥手释放连接。", 1,
               复用="IP+端口", 序号="按字节", 握手="SYN/SYN+ACK/ACK")
        answer_bits.append("端口复用/分用；TCP 序号按字节编号；三次握手/四次挥手")

    return _ok("transport", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["transport"],
               checks=[_check("seq", "序号消耗规则", True,
                              "SYN、FIN 各消耗一个序号；普通数据按字节数推进。")],
               notes=["TCP 首部选项未展开时按最小 20B 计。",
                      "握手/挥手的序号值在题面给出 ISN 时按实际值，否则用 x/y 表示。"],
               answer_value=answer_value, stats=stats)


# ---------------------------------------------------------------------------
# 11) TCP 流量与拥塞控制
# ---------------------------------------------------------------------------

def _eval_tcp_control(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    mss_bytes = _size_bits(text, r"MSS|最大报文段长度")
    mss_bytes = mss_bytes / 8 if mss_bytes else None
    initial_raw = _mss_number(text, r"初始拥塞窗口|cwnd\s*初值|初始\s*cwnd|拥塞窗口初值")
    if initial_raw is None:
        initial_raw = _mss_number(text, r"当前拥塞窗口|拥塞窗口|cwnd")
    ssthresh_raw = _mss_number(text, r"ssthresh|慢启动门限|慢开始门限")
    rwnd_raw = _mss_number(text, r"接收窗口|rwnd|通告窗口")

    def to_mss(raw: tuple[float, str] | None) -> float | None:
        if raw is None:
            return None
        value, unit = raw
        if unit == "MSS":
            return value
        if mss_bytes:
            if unit in ("KB", "kB", "K"):
                return value * 1024 / mss_bytes
            if unit in ("B", "字节"):
                return value / mss_bytes
        return value

    initial = to_mss(initial_raw)
    ssthresh = to_mss(ssthresh_raw)
    rwnd = to_mss(rwnd_raw)
    rounds_match = re.search(r"经过\s*(\d+)\s*个?\s*(?:RTT|轮)|(\d+)\s*个?\s*RTT\s*后|"
                             r"第\s*(\d+)\s*个?\s*(?:RTT|轮)", text, re.I)
    rounds = int(next(group for group in rounds_match.groups() if group)) if rounds_match else None
    timeout_match = re.search(r"第\s*(\d+)\s*个?\s*RTT[^\n。；]{0,8}(?:超时|丢失|重传)", text)
    dup_match = re.search(r"第\s*(\d+)\s*个?\s*RTT[^\n。；]{0,10}(?:3|三)\s*个?\s*(?:重复)?\s*ACK", text, re.I)
    loss_round = int(timeout_match.group(1)) if timeout_match else (int(dup_match.group(1)) if dup_match else None)
    loss_type = "timeout" if timeout_match else ("fast" if dup_match else None)
    if loss_round is not None and rounds is None:
        rounds = loss_round

    if initial is not None and rounds:
        cwnd = initial
        limit = ssthresh if ssthresh is not None else math.inf
        timeline = []
        _frame(frames, "initial", "初始拥塞窗口",
               f"cwnd={_fmt(cwnd)} MSS" + (f"，ssthresh={_fmt(limit)} MSS" if ssthresh is not None else "，未给出 ssthresh") + "。", 1,
               轮次="0", cwnd=_fmt(cwnd), ssthresh=_fmt(limit) if ssthresh is not None else "未给出",
               阶段="初始")
        for round_index in range(1, rounds + 1):
            phase = "慢启动" if cwnd < limit else "拥塞避免"
            if loss_round == round_index and loss_type:
                before = cwnd
                new_ssthresh = max(math.floor(cwnd / 2), 2)
                if loss_type == "timeout":
                    cwnd = 1
                    detail = (f"第 {round_index} 个 RTT 超时：ssthresh=max({_fmt(before)}/2,2)="
                              f"{_fmt(new_ssthresh)} MSS，cwnd 回到 1 MSS，重新慢启动。")
                else:
                    cwnd = new_ssthresh
                    detail = (f"第 {round_index} 个 RTT 收到 3 个重复 ACK：快重传丢失报文，"
                              f"快恢复使 ssthresh=cwnd/2={_fmt(new_ssthresh)}，cwnd 降到 ssthresh。")
                limit = new_ssthresh
                _frame(frames, "loss", f"第 {round_index} 轮：{'超时' if loss_type == 'timeout' else '快重传'}",
                       detail, 4, 轮次=str(round_index), cwnd=_fmt(cwnd), ssthresh=_fmt(limit),
                       阶段="超时恢复" if loss_type == "timeout" else "快恢复")
            else:
                if cwnd < limit:
                    cwnd *= 2
                    stage = "慢启动"
                else:
                    cwnd += 1
                    stage = "拥塞避免"
                _frame(frames, "round", f"第 {round_index} 个 RTT",
                       f"{stage}：cwnd 从 {_fmt(cwnd / 2 if stage == '慢启动' else cwnd - 1)} "
                       f"变为 {_fmt(cwnd)} MSS；ssthresh={_fmt(limit) if ssthresh is not None else '未给出'}。", 2,
                       轮次=str(round_index), cwnd=_fmt(cwnd),
                       ssthresh=_fmt(limit) if ssthresh is not None else "未给出", 阶段=stage)
            timeline.append({"round": round_index, "cwnd": cwnd, "ssthresh": limit if ssthresh is not None else None})
        answer_bits.append(f"第 {rounds} 个 RTT 后 cwnd={_fmt(cwnd)} MSS"
                           + (f"，ssthresh={_fmt(limit)} MSS" if ssthresh is not None else ""))
        stats["timeline"] = timeline
        stats["final_cwnd"] = cwnd
        if re.search(r"cwnd|拥塞窗口", text):
            answer_value = cwnd
        if re.search(r"ssthresh|慢启动门限", text) and not re.search(r"cwnd|拥塞窗口", text):
            answer_value = limit if ssthresh is not None else None

    if rwnd is not None:
        cwnd_for_window = initial if initial is not None else None
        send_window = min(rwnd, cwnd_for_window) if cwnd_for_window is not None else rwnd
        _frame(frames, "flow", "接收窗口与发送窗口",
               f"接收窗口 rwnd={_fmt(rwnd)} MSS"
               + (f"，拥塞窗口 cwnd={_fmt(cwnd_for_window)} MSS" if cwnd_for_window is not None else "")
               + f"；发送窗口 = min(rwnd, cwnd) = {_fmt(send_window)} MSS。", 3,
               接收窗口=f"{_fmt(rwnd)} MSS",
               拥塞窗口=f"{_fmt(cwnd_for_window)} MSS" if cwnd_for_window is not None else "未给出",
               发送窗口=f"{_fmt(send_window)} MSS")
        answer_bits.append(f"发送窗口 = {_fmt(send_window)} MSS")
        stats["send_window"] = send_window
        if re.search(r"发送窗口", text) and rounds is None:
            answer_value = send_window

    if re.search(r"RTO|超时重传|RTT", text, re.I) and initial is None:
        _frame(frames, "rto", "RTO 与超时重传",
               "RTO 由 RTT 估计：RTTs=(1−α)RTTs+α×样本，RTTd=(1−β)RTTd+β|样本−RTTs|，"
               "RTO=RTTs+4×RTTd；超时后 RTO 指数退避，Karn 算法对重传样本不更新 RTT。", 5,
               公式="RTO=RTTs+4×RTTd", 超时="指数退避", 重传样本="Karn 不采样")
        answer_bits.append("RTO=RTTs+4×RTTd；超时后指数退避，Karn 算法避免重传样本歧义")

    if not frames:
        _frame(frames, "concept", "TCP 拥塞控制",
               "慢启动 cwnd 每 RTT 翻倍；到达 ssthresh 后进入拥塞避免，每 RTT 约加 1 MSS；"
               "超时令 ssthresh=cwnd/2、cwnd=1；3 个重复 ACK 触发快重传/快恢复。", 1,
               慢启动="cwnd×2", 拥塞避免="+1 MSS", 超时="cwnd=1", 快恢复="cwnd=ssthresh")
        answer_bits.append("慢启动翻倍、拥塞避免加 1；超时回到 1，快恢复降到 ssthresh")

    return _ok("tcp_control", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["tcp_control"],
               checks=[_check("window", "发送窗口取较小值", True,
                              "发送窗口 = min(接收窗口, 拥塞窗口)。")],
               notes=["慢启动按每 RTT 翻倍、拥塞避免按每 RTT +1 MSS 的教材口径。",
                      "3 个重复 ACK 的快恢复采用 Reno 简化口径：ssthresh=cwnd/2，cwnd=ssthresh。",
                      "未给出 MSS 时窗口数值按 MSS 为单位处理。"],
               answer_value=answer_value, stats=stats)


# ---------------------------------------------------------------------------
# 12) 应用层与网络综合
# ---------------------------------------------------------------------------

def _eval_application(text: str) -> dict[str, Any]:
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    stats: dict[str, Any] = {}
    answer_value: float | None = None

    if re.search(r"DNS|域名解析|递归查询|迭代查询", text, re.I):
        _frame(frames, "dns", "DNS 查询",
               "递归查询由本地 DNS 代查到底并返回最终结果；迭代查询由本地 DNS 依次询问根、顶级域和权威服务器。"
               "DNS 默认 UDP 53，响应过大或区域传送用 TCP；记录类型包括 A/AAAA/CNAME/MX/NS。", 1,
               递归="本地 DNS 代查", 迭代="逐级询问", 端口="UDP 53", 记录="A/AAAA/CNAME/MX")
        answer_bits.append("DNS 递归由本地 DNS 代查，迭代逐级询问根/TLD/权威；默认 UDP 53")

    objects_match = re.search(r"(\d+)\s*个(?:对象|资源|图片|文件|小文件)", text)
    html_plus = re.search(r"(?:一个|1\s*个)\s*HTML[^\n。；]{0,12}(\d+)\s*个(?:对象|图片|资源)", text, re.I)
    rtt = _time_seconds(text, r"RTT|往返时延|往返时间")
    if (objects_match or html_plus) and rtt is not None:
        objects = int(objects_match.group(1)) if objects_match else int(html_plus.group(1)) + 1
        non_persistent = bool(re.search(r"非持久|非长连接|不使用持久", text, re.I))
        persistent = not non_persistent and bool(re.search(r"持久连接|keep-alive|长连接", text, re.I))
        no_pipeline = bool(re.search(r"不使用流水线|无流水线|非流水线|没有流水线", text, re.I))
        pipelined = not no_pipeline and bool(re.search(r"流水线|pipelining", text, re.I))
        if persistent and pipelined:
            total = 2 * rtt
            mode = "持久连接 + 流水线"
            detail = f"TCP 握手 1 RTT + 所有 HTTP 请求/响应 1 RTT = 2 RTT。"
        elif persistent:
            total = (objects + 1) * rtt
            mode = "持久连接（非流水线）"
            detail = f"TCP 握手 1 RTT + {objects} 个对象逐个请求/响应 {objects} RTT = {objects + 1} RTT。"
        else:
            total = 2 * objects * rtt
            mode = "非持久连接"
            detail = f"每个对象需要 TCP 握手 1 RTT + HTTP 请求/响应 1 RTT；{objects} 个对象共 {2 * objects} RTT。"
        _frame(frames, "http_time", "网页获取时间",
               f"{mode}，{objects} 个对象，RTT={_fmt_time(rtt)}；{detail}总时间 {_fmt_time(total)}。", 3,
               模式=mode, 对象数=str(objects), RTT=_fmt_time(rtt), 总时间=_fmt_time(total))
        answer_bits.append(f"{mode}：{_fmt_time(total)}")
        answer_value = total * 1e3
        stats["http"] = {"objects": objects, "rtt_s": rtt, "persistent": persistent,
                         "pipelined": pipelined, "total_s": total}

    if re.search(r"HTTP|网页", text, re.I) and not objects_match and not html_plus:
        _frame(frames, "http", "HTTP 连接方式",
               "非持久连接：每个对象重新建立 TCP，每个对象约 2RTT；"
               "持久连接非流水线：TCP 建一次，每个对象约 1RTT；"
               "持久连接流水线：TCP 建一次，所有请求可连续发送，约 2RTT 加传输时间。", 2,
               非持久="2RTT/对象", 持久非流水线="1RTT/对象", 持久流水线="约 2RTT/页")
        answer_bits.append("HTTP 非持久连接每对象约 2RTT；持久非流水线每对象约 1RTT；流水线约 2RTT 取整页")

    if re.search(r"FTP|文件传输协议", text, re.I):
        _frame(frames, "ftp", "FTP",
               "FTP 使用两条 TCP 连接：控制连接 21 端口长期保持，数据连接 20（主动）或临时端口（被动）；"
               "控制信息带外传输，数据连接按需建立。", 2,
               控制连接="TCP 21", 数据连接="TCP 20/临时", 特点="控制与数据分离")
        answer_bits.append("FTP 控制连接 21 长期保持，数据连接 20/临时端口按需建立")

    if re.search(r"电子邮件|SMTP|POP3|IMAP|邮件", text, re.I):
        _frame(frames, "email", "电子邮件协议",
               "发送用 SMTP（推送，TCP 25）；读取用 POP3（TCP 110）或 IMAP（TCP 143）；"
               "MIME 扩展非 ASCII 内容，邮件经过 UA→MTA→MDA→收件人。", 2,
               发送="SMTP 25", 读取="POP3 110 / IMAP 143", 扩展="MIME")
        answer_bits.append("SMTP 25 发送，POP3 110/IMAP 143 读取，MIME 扩展内容")

    if re.search(r"输入网址|输入\s*URL|从输入.*到.*页面|页面显示|浏览器", text, re.I):
        steps = [
            ("URL 解析", "浏览器解析协议、域名、端口和路径。", 1),
            ("DHCP/ARP", "若本机无 IP 用 DHCP 获取地址；若网关 MAC 未知用 ARP 解析。", 1),
            ("DNS", "把域名解析为服务器 IP，可能使用缓存和递归/迭代查询。", 2),
            ("TCP 握手", "与服务器建立 TCP 连接，三次握手同步序号。", 3),
            ("HTTP 请求/响应", "发送 HTTP 请求并接收 HTML、CSS、JS、图片等资源。", 4),
            ("渲染", "浏览器解析 HTML/CSS/JS 并显示页面。", 5),
        ]
        for label, detail, line in steps:
            _frame(frames, "url", label, detail, line, 步骤=label, 说明=detail)
        answer_bits.append("输入网址后：URL 解析 → DHCP/ARP → DNS → TCP 握手 → HTTP 请求/响应 → 浏览器渲染")

    if not frames:
        _frame(frames, "concept", "应用层协议",
               "DNS 解析域名；HTTP 传输 Web 资源；FTP 分离控制/数据连接；"
               "电子邮件用 SMTP 发送、POP3/IMAP 读取；输入 URL 后综合 DHCP/ARP/DNS/TCP/HTTP 完成页面获取。", 1,
               应用="DNS/HTTP/FTP/SMTP", 综合="DHCP/ARP/DNS/TCP/HTTP")
        answer_bits.append("DNS、HTTP、FTP、SMTP/POP3/IMAP 与 URL 获取页面的综合流程如上")

    return _ok("application", "；".join(dict.fromkeys(answer_bits)), frames, PSEUDOCODES["application"],
               checks=[_check("layers", "协议层次对应", True,
                              "DNS/HTTP/FTP/SMTP 属于应用层，依赖 TCP/UDP 传输。")],
               notes=["HTTP 时间未计数据传输时间、DNS 时间和页面渲染时间，除非题面单独给出。",
                      "非持久连接默认按串行处理；并行连接会改变总时间。",
                      "DNS 可能使用缓存，实际查询次数会减少。"],
               answer_value=answer_value, stats=stats)


def _detect_kind(text: str) -> str | None:
    low = text.lower()
    if re.search(r"dns|http|ftp|smtp|pop3|imap|url|网址|网页|页面显示|浏览器|域名|电子邮件|邮件|"
                 r"非持久连接|持久连接", low, re.I):
        return "application"
    if re.search(r"拥塞窗口|拥塞控制|慢启动|拥塞避免|快重传|快恢复|cwnd|ssthresh|超时重传|"
                 r"(?:tcp|传输控制协议)[^\n。；]{0,24}(?:发送窗口|接收窗口|流量控制)|"
                 r"(?:发送窗口|接收窗口)[^\n。；]{0,24}(?:tcp|传输控制协议)", low, re.I):
        return "tcp_control"
    if re.search(r"mac\s*帧|mac\s*地址表|mac\s*表|交换机|自学习|转发表|vlan|802\.1q|冲突域|广播域|泛洪|以太网帧|广播帧|"
                 r"(?:端口|接口)\s*\d+\s*(?:连接|接|对应)\s*[a-z]|[a-z][a-z0-9_]*\s*(?:连接|接在)\s*(?:端口|接口)\s*\d+",
                 low, re.I):
        return "ethernet"
    if re.search(r"tcp(?!\s*/\s*ip)|udp|端口|三次握手|四次挥手|time_wait|syn|fin|确认号|传输层|"
                 r"tcp\s*首部|udp\s*首部", low, re.I):
        return "transport"
    if re.search(r"ipv4|ipv6|子网|掩码|cidr|vlsm|网络地址|广播地址|地址聚合|聚合|汇总|最长前缀|分片|片偏移|mtu|"
                 r"ip\s*地址|子网划分", low, re.I):
        return "ip"
    if re.search(r"arp|dhcp|icmp|nat|路由表|距离向量|链路状态|rip|ospf|bgp|自治系统|路径向量", low, re.I):
        return "network_layer"
    if re.search(r"crc|循环冗余|生成多项式|模\s*2\s*除法|海明|汉明|奇偶校验|奇校验|偶校验|校验位|"
                 r"差错检测|差错控制|检错|纠错", low, re.I):
        return "error_control"
    if re.search(r"aloha|csma|载波监听|冲突检测|冲突避免|退避|最小帧长|二进制指数|介质访问", low, re.I):
        return "mac"
    if re.search(r"滑动窗口|停止等待|停等|gbn|go-back-n|回退\s*n|选择重传|sr\s*协议|"
                 r"(?<![a-z])sr(?![a-z])|发送窗口|接收窗口|序号空间|确认帧|重传", low, re.I):
        return "sliding_window"
    if re.search(r"编码|调制|曼彻斯特|差分曼彻斯特|nrz|码元|波特率|比特率|奈奎斯特|香农|"
                 r"信道容量|信噪比|复用|频分|时分|波分|码分|qam|ask|fsk|psk", low, re.I):
        return "physical"
    if re.search(r"带宽|吞吐量|发送时延|传播时延|传输时延|时延带宽积|带宽时延积|电路交换|报文交换|分组交换|rtt|"
                 r"信道利用率|利用率", low, re.I):
        return "performance"
    if re.search(r"osi|tcp\s*/\s*ip|tcp/ip|体系结构|封装|解封装|协议|服务|分层|应用层|传输层|网络层|"
                 r"数据链路层|物理层|会话层|表示层|路由器|交换机|集线器|网关|网桥|中继器", low, re.I):
        return "architecture"
    return None


def _infer_kind(text: str, merged: Mapping[str, Any]) -> str | None:
    explicit = str(merged.get("net_kind") or "").strip()
    if explicit in KIND_LABELS:
        return explicit
    return _detect_kind(text)


def build_network(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    merged = {**dict(overrides.get("condition_values") or {}),
              **dict(overrides.get("ambiguity_answers") or {}),
              **dict(overrides or {})}
    kind = _infer_kind(text, merged)
    if kind is None:
        model = {"engine": "net_unknown_v1", "subject": "computer_network", "net_kind": None,
                 "raw": text, "defaults": {}, "params": [], "teaching": False}
        return {"model": model, "conditions": [], "formulas": [], "recognized": False,
                "ambiguities": [_ambiguity(
                    "net_kind",
                    "已识别为计算机网络内容，但没有确定题型：请选择体系结构、性能、物理层、差错检测、"
                    "滑动窗口、介质访问、以太网/交换机、IPv4/IPv6、网络层路由、TCP/UDP、拥塞控制或应用层的具体条件。",
                    options=[{"value": key, "label": label} for key, label in KIND_LABELS.items()])]}
    model = {"engine": ENGINES[kind], "subject": "computer_network", "net_kind": kind,
             "raw": text, "defaults": {}, "params": [], "teaching": False}
    formulas = {
        "architecture": [{"id": "layer", "tex": r"\text{OSI 七层；TCP/IP 四层}",
                          "plain": "协议是同等层规则，服务是下层向上层提供的功能。", "role": "体系结构"}],
        "performance": [{"id": "delay", "tex": r"T_{\text{send}}=L/R,\quad T_{\text{prop}}=d/v",
                         "plain": "时延带宽积 = 传播时延 × 带宽。", "role": "性能指标"}],
        "physical": [{"id": "nyquist", "tex": r"C=2W\log_2 M",
                      "plain": "奈奎斯特为理想无噪声上限；香农为有噪声上限。", "role": "信道容量"}],
        "error_control": [{"id": "crc", "tex": r"\text{CRC：模2除法取余}",
                           "plain": "奇偶校验、CRC 与海明码分别用于检错/纠错。", "role": "差错控制"}],
        "sliding_window": [{"id": "window", "tex": r"\text{GBN：}W\le N-1,\quad \text{SR：}W\le N/2",
                            "plain": "停止等待、GBN、SR 的窗口与序号空间约束。", "role": "可靠传输"}],
        "mac": [{"id": "minframe", "tex": r"L_{\min}=2\tau R",
                 "plain": "CSMA/CD 最小帧长与二进制指数退避。", "role": "介质访问"}],
        "ethernet": [{"id": "learning", "tex": r"\text{源 MAC → 入端口；目的已知定向，未知泛洪}",
                      "plain": "交换机自学习与转发表；VLAN 隔离广播域。", "role": "交换"}],
        "ip": [{"id": "subnet", "tex": r"\text{网络地址}=IP\ \&\ 掩码",
                "plain": "子网、CIDR、最长前缀、分片和 IPv6 压缩规则。", "role": "网络层地址"}],
        "network_layer": [{"id": "routing", "tex": r"RIP:\ DV,\quad OSPF:\ LS,\quad BGP:\ path\ vector",
                           "plain": "ARP/DHCP/ICMP/NAT 与三类路由协议。", "role": "网络层协议"}],
        "transport": [{"id": "seq", "tex": r"\text{下一序号}=seq+数据字节数+SYN/FIN",
                       "plain": "端口复用、TCP 序号/确认号与握手挥手。", "role": "传输层"}],
        "tcp_control": [{"id": "cwnd", "tex": r"cwnd:\ 快启动\times2,\ 拥塞避免+1",
                         "plain": "发送窗口 = min(rwnd, cwnd)；丢失后更新 ssthresh 与 cwnd。", "role": "拥塞控制"}],
        "application": [{"id": "http", "tex": r"T_{\text{非持久}}=2nRTT,\quad T_{\text{持久流水线}}=2RTT",
                         "plain": "DNS、HTTP、FTP、邮件与 URL 获取页面流程。", "role": "应用层"}],
    }[kind]
    return {"model": model,
            "conditions": [_condition("net_kind", "题型", KIND_LABELS[kind], source=source)],
            "formulas": formulas, "ambiguities": [], "recognized": True}


def evaluate_network(model: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    kind = str(model.get("net_kind") or "")
    text = str(model.get("raw") or "")
    try:
        if kind == "architecture":
            return _eval_architecture(text)
        if kind == "performance":
            return _eval_performance(text)
        if kind == "physical":
            return _eval_physical(text)
        if kind == "error_control":
            return _eval_error_control(text)
        if kind == "sliding_window":
            return _eval_sliding_window(text)
        if kind == "mac":
            return _eval_mac(text)
        if kind == "ethernet":
            return _eval_ethernet(text)
        if kind == "ip":
            return _eval_ip(text)
        if kind == "network_layer":
            return _eval_network_layer(text)
        if kind == "transport":
            return _eval_transport(text)
        if kind == "tcp_control":
            return _eval_tcp_control(text)
        if kind == "application":
            return _eval_application(text)
    except ValueError as exc:
        return _blocked(kind, str(exc))
    return _blocked(kind or "architecture", "未确定计算机网络题型，无法执行")


def solve_network(model: Mapping[str, Any]) -> dict[str, Any]:
    result = evaluate_network(model, model.get("defaults") or {})
    if result.get("status") != "ok":
        raise ValueError(result.get("reason") or "该计算机网络题目的条件不足")
    try:
        model["net_result"] = result  # type: ignore[index]
    except TypeError:
        pass
    frames = result["trace"]
    steps = [{"id": f"net_{frame['index']}", "title": frame["label"], "detail": frame["detail"]}
             for frame in frames[:12]]
    summary = {
        "architecture": "按 OSI/TCP-IP 分层、协议与服务、封装关系和设备层次推导。",
        "performance": "按发送/传播时延、带宽吞吐量与交换方式的时间公式推导。",
        "physical": "按码元/比特率、奈奎斯特/香农公式与复用方式推导。",
        "error_control": "按奇偶校验、CRC 模 2 除法或海明码覆盖关系推导。",
        "sliding_window": "按停止等待/GBN/SR 的窗口、序号空间、利用率与重传规则推导。",
        "mac": "按 ALOHA、CSMA/CD、CSMA/CA、最小帧长与退避规则推导。",
        "ethernet": "按交换机自学习、转发表、泛洪、冲突域/广播域与 VLAN 规则推导。",
        "ip": "按 IPv4 子网/CIDR、最长前缀、分片和 IPv6 地址规则推导。",
        "network_layer": "按 ARP/DHCP/ICMP/NAT 与 RIP/OSPF/BGP 的路由规则推导。",
        "transport": "按端口复用、TCP 序号/确认、握手挥手与校验和规则推导。",
        "tcp_control": "按 cwnd/ssthresh、慢启动、拥塞避免、快重传与接收窗口推导。",
        "application": "按 DNS、HTTP、FTP、电子邮件与 URL 获取页面流程推导。",
    }.get(result.get("net_kind", ""), "按计算机网络确定性规则推导。")
    return {"summary": summary, "answer": result["answer"], "answer_value": result.get("answer_value"),
            "answer_order": result.get("answer_order"), "answer_sequence": result.get("answer_order"),
            "steps": steps, "conditions": ["题目数据来自题面识别；可在条件面板中查看题型。"],
            "limitations": result.get("notes") or []}


def windows_invalid(protocol: str, window: int, seq_space: int | None) -> bool:
    if seq_space is None:
        return False
    if protocol == "stop":
        return window != 1
    if protocol == "gbn":
        return window > seq_space - 1
    if protocol == "sr":
        return window > seq_space // 2
    return False


__all__ = ["KIND_LABELS", "build_network", "evaluate_network", "solve_network"]

