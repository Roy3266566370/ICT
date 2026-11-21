"""Render six real 408 computer-network questions as PNG screenshots."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.dirname(os.path.abspath(__file__))
FONT = ImageFont.truetype("msyh.ttc", 27)
FONT_S = ImageFont.truetype("msyh.ttc", 23)

QUESTIONS = [
    (
        "cn1_physical.png",
        [
            ("2009年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("34. 在无噪声情况下，若某通信链路的带宽为3kHz，采用4个相位，", FONT, (20, 20, 20)),
            ("    每个相位具有4种振幅的QAM调制技术，则该通信链路的最大数", FONT, (20, 20, 20)),
            ("    据传输速率是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 12kbps    B. 24kbps    C. 48kbps    D. 96kbps", FONT, (20, 20, 20)),
        ],
    ),
    (
        "cn2_gbn.png",
        [
            ("2009年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("35. 数据链路层采用后退N帧（GBN）协议，发送方已经发送了编号", FONT, (20, 20, 20)),
            ("    为0~7的帧。当计时器超时时，若发送方只收到0、2、3号帧的确", FONT, (20, 20, 20)),
            ("    认，则发送方需要重发的帧数是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 2         B. 3         C. 4         D. 5", FONT, (20, 20, 20)),
        ],
    ),
    (
        "cn3_csmacd.png",
        [
            ("2009年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("37. 在一个采用CSMA/CD协议的网络中，传输介质是一根完整的电", FONT, (20, 20, 20)),
            ("    缆，传输速率为1Gbps，电缆中的信号传播速度是200 000km/s。", FONT, (20, 20, 20)),
            ("    若最小数据帧长度减少800比特，则最远的两个站点之间的距离", FONT, (20, 20, 20)),
            ("    至少需要（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 增加160m  B. 增加80m  C. 减少160m  D. 减少80m", FONT, (20, 20, 20)),
        ],
    ),
    (
        "cn4_subnet.png",
        [
            ("2010年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("37. 某网络的IP地址空间为192.168.5.0/24，采用定长子网划分，", FONT, (20, 20, 20)),
            ("    子网掩码为255.255.255.248，则该网络中的最大子网个数、每", FONT, (20, 20, 20)),
            ("    个子网内的最大可分配地址个数分别是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 32、8     B. 32、6     C. 8、32     D. 8、30", FONT, (20, 20, 20)),
        ],
    ),
    (
        "cn5_tcp_seq.png",
        [
            ("2009年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("38. 主机甲和主机乙间已建立一个TCP连接，主机甲向主机乙发送", FONT, (20, 20, 20)),
            ("    了两个连续的TCP段，分别包含300字节和500字节的有效载荷，", FONT, (20, 20, 20)),
            ("    第一个段的序列号为200，主机乙正确接收到两个段后，发送给", FONT, (20, 20, 20)),
            ("    主机甲的确认序列号是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 500       B. 700       C. 800       D. 1000", FONT, (20, 20, 20)),
        ],
    ),
    (
        "cn6_congestion.png",
        [
            ("2009年408统考真题  计算机网络", FONT_S, (90, 90, 90)),
            ("39. 一个TCP连接总是以1KB的最大段发送TCP段，发送方有足够多", FONT, (20, 20, 20)),
            ("    的数据要发送。当拥塞窗口为16KB时发生了超时，如果接下来", FONT, (20, 20, 20)),
            ("    的4个RTT（往返时间）时间内的TCP段的传输都是成功的，那么", FONT, (20, 20, 20)),
            ("    当第4个RTT时间内发送的所有TCP段都得到肯定应答时，拥塞", FONT, (20, 20, 20)),
            ("    窗口大小是（ ）。", FONT, (20, 20, 20)),
            ("", FONT, (20, 20, 20)),
            ("    A. 7KB       B. 8KB       C. 9KB       D. 16KB", FONT, (20, 20, 20)),
        ],
    ),
]


def render(name: str, lines: list[tuple[str, object, tuple[int, int, int]]]) -> str:
    pad_x, pad_y, line_h = 48, 40, 50
    w, h = 1180, pad_y * 2 + line_h * len(lines) + 20
    img = Image.new("RGB", (w, h), (252, 252, 250))
    d = ImageDraw.Draw(img)
    y = pad_y
    for text, font, color in lines:
        d.text((pad_x, y), text, font=font, fill=color)
        y += line_h
    path = os.path.join(OUT, name)
    img.save(path)
    return path


for fname, lines in QUESTIONS:
    print(render(fname, lines))
