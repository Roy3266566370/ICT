"""计算机组成原理：五组题型的识别、确定性求解与回放数据。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, build_problem
from test_labs_api import app, owner  # noqa: F401 - 复用 API 测试夹具


def _solve(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "computer_organization", (text, problem["subject"], problem["model"])
    assert str(problem["model"].get("engine", "")).startswith("co_"), problem["model"]
    _attach_solution(problem)
    return problem


# ---------------------------------------------------------------------------
# 计算机性能
# ---------------------------------------------------------------------------


def test_cpu_execution_time():
    problem = _solve("某CPU主频为2GHz，CPI为4，执行1000000条指令，求CPU执行时间。")
    assert problem["model"]["co_kind"] == "performance"
    assert problem["solution"]["answer_value"] == pytest.approx(0.002)
    assert "0.002" in problem["solution"]["answer"]
    assert "500" in problem["solution"]["answer"]  # MIPS


def test_reverse_performance_questions():
    instructions = _solve("某CPU主频为1GHz，CPI=2，执行时间2ms，求指令数。")
    assert "指令数 = 1000000" in instructions["solution"]["answer"]
    timing = _solve("时钟周期为0.5ns，CPI=4，执行2×10^6条指令，求CPU执行时间。")
    assert "0.004" in timing["solution"]["answer"]


def test_speedup_between_two_machines():
    problem = _solve("机器A主频2GHz、CPI=2；机器B主频4GHz、CPI=1，执行同一程序，求加速比。")
    assert problem["solution"]["answer_value"] == pytest.approx(4.0)
    assert "加速比" in problem["solution"]["answer"]


# ---------------------------------------------------------------------------
# 数据表示
# ---------------------------------------------------------------------------


def test_base_conversion_with_subscript():
    problem = _solve("将 (1011)₂ 转换为十进制。")
    assert problem["model"]["co_kind"] == "data_repr"
    assert "11" in problem["solution"]["answer"]
    assert problem["solution"]["answer_value"] == pytest.approx(11)
    fractional = _solve("将十进制 10.625 转为二进制。")
    assert "1010.101" in fractional["solution"]["answer"]


def test_machine_codes_and_sign_extension():
    problem = _solve("求 -37 的8位原码、反码、补码和移码。")
    answer = problem["solution"]["answer"]
    assert "1010 0101" in answer       # 原码
    assert "1101 1010" in answer       # 反码
    assert "1101 1011" in answer       # 补码
    assert "0101 1011" in answer       # 移码
    extension = _solve("将8位补码 10011010 符号扩展到16位。")
    assert "1111111110011010" in extension["solution"]["answer"]


def test_signed_and_unsigned_interpretation():
    problem = _solve("8位补码 11111101 的真值。")
    assert "-3" in problem["solution"]["answer"]
    assert "无符号" in problem["solution"]["answer"] or "125" in problem["solution"]["answer"]
    unsigned = _solve("8位无符号数 255 转换为有符号数。")
    assert "-1" in unsigned["solution"]["answer"]
    signed = _solve("8位有符号数 -1 转换为无符号数。")
    assert "255" in signed["solution"]["answer"]


# ---------------------------------------------------------------------------
# 定点运算
# ---------------------------------------------------------------------------


def test_twos_complement_addition_and_overflow_flag():
    normal = _solve("8位补码计算 5 + (-3)，判断溢出。")
    assert "= 2" in normal["solution"]["answer"]
    assert "无溢出" in normal["solution"]["answer"]
    overflow = _solve("8位补码计算 127 + 1，判断溢出。")
    assert "发生溢出" in overflow["solution"]["answer"]
    assert "OF=1" in overflow["solution"]["answer"]


def test_logical_shift_and_flags():
    problem = _solve("将8位补码 10011010 逻辑右移2位。")
    assert "0010 0110" in problem["solution"]["answer"]
    assert problem["solution"]["answer_value"] == pytest.approx(38)


def test_unsigned_multiplication_and_restoring_division():
    multiply = _solve("用原码一位乘计算 8位无符号数 13×11。")
    assert multiply["solution"]["answer_value"] == pytest.approx(143)
    assert "10001111" in multiply["solution"]["answer"]
    divide = _solve("用恢复余数除法计算 8位无符号数 13÷5。")
    assert "商 = 2" in divide["solution"]["answer"] and "余数 = 3" in divide["solution"]["answer"]
    assert "00000010" in divide["solution"]["answer"]


# ---------------------------------------------------------------------------
# 浮点数
# ---------------------------------------------------------------------------


def test_ieee754_encode_decode_and_add():
    encoded = _solve("将 -12.375 表示为 IEEE 754 单精度浮点数。")
    assert "0xC1460000" in encoded["solution"]["answer"]
    decoded = _solve("IEEE 754 单精度 0xC1480000 的真值。")
    assert "-12.5" in decoded["solution"]["answer"]
    added = _solve("IEEE 754 单精度浮点数 1.5 与 2.25 相加。")
    assert "3.75" in added["solution"]["answer"]
    assert "0x40700000" in added["solution"]["answer"]


def test_float_overflow_and_underflow():
    overflow = _solve("IEEE 754 单精度浮点数 3.4e38 与 3.4e38 相加。")
    assert "上溢" in overflow["solution"]["answer"] and "∞" in overflow["solution"]["answer"]
    underflow = _solve("IEEE 754 单精度浮点数 1e-46 与 1e-46 相加。")
    assert "下溢" in underflow["solution"]["answer"]


def test_ieee754_range_and_precision():
    problem = _solve("IEEE 754 单精度浮点数的表示范围与精度。")
    answer = problem["solution"]["answer"]
    assert "3.402823466e+38" in answer
    assert "1.175494351e-38" in answer
    assert "1.192092896e-07" in answer  # 机器 epsilon = 2^-23


# ---------------------------------------------------------------------------
# 运算器与数据通路
# ---------------------------------------------------------------------------


def test_alu_register_transfer_and_mux():
    alu = _solve("8位ALU执行加法，A=5，B=3，求结果和标志。")
    assert "结果 00001000" in alu["solution"]["answer"]
    assert "Zero=0" in alu["solution"]["answer"]
    reg = _solve("寄存器R1=5,R2=3,R3=0，执行 R3 ← R1 + R2，结果是什么？")
    assert "R3=8(00001000)" in reg["solution"]["answer"]
    mux = _solve("多路选择器输入 D0=1010, D1=1100, D2=0110, D3=1001，选择信号 S1S0=10，输出是什么？")
    assert "D2" in mux["solution"]["answer"] and "0110" in mux["solution"]["answer"]


# ---------------------------------------------------------------------------
# 识别与阻塞
# ---------------------------------------------------------------------------


def test_computer_organization_subject_and_unknown_kind():
    problem = build_problem("计算机组成原理题：说明指令周期。")
    assert problem["subject"] == "computer_organization"
    assert problem["status"] == "needs_review"
    assert problem["model"].get("co_kind") is None


def test_missing_operands_blocks_without_fabrication():
    problem = build_problem("8位补码计算两个数之和，判断溢出。")
    assert problem["subject"] == "computer_organization"
    _attach_solution(problem)
    assert not problem["solution"].get("answer")
    register = build_problem("寄存器传送 R3 ← R1 + R2，结果是什么？")
    assert register["subject"] == "computer_organization"
    _attach_solution(register)
    assert not register["solution"].get("answer")


# ---------------------------------------------------------------------------
# 主存、Cache、虚拟存储、指令、控制器、流水线、总线与 I/O
# ---------------------------------------------------------------------------


def test_main_memory_capacity_and_chip_extension():
    capacity = _solve("某存储器有16根地址线，8根数据线，按字节编址，起始地址0000H，求容量和地址范围。")
    assert "65536 B" in capacity["solution"]["answer"]
    assert "FFFFH" in capacity["solution"]["answer"]
    chips = _solve("用1K×4位芯片组成4K×8位存储器，需要多少芯片，地址线如何分配？")
    answer = chips["solution"]["answer"]
    assert "8 片" in answer and "字扩展 4 组" in answer and "位扩展 2 组" in answer
    assert "片选 2 根" in answer
    interleave = _solve("4体交叉存储器，字长32位，存取周期80ns，总线传送周期20ns，求带宽。")
    assert "140 ns" in interleave["solution"]["answer"]
    assert "0.914" in interleave["solution"]["answer"]


def test_cache_address_fields_and_amat():
    fields = _solve("主存地址32位，Cache容量64KB，块大小64B，4路组相联，求tag、index、offset位数。")
    answer = fields["solution"]["answer"]
    assert "tag 18 位" in answer and "index 8 位" in answer and "offset 6 位" in answer
    amat = _solve("Cache命中率95%，命中时间1ns，缺失代价20ns，求平均访问时间。")
    assert amat["solution"]["answer_value"] == pytest.approx(2.0)


def test_virtual_address_translation_and_tlb_timing():
    split = _solve("页大小4KB，虚拟地址32位，物理地址28位，求VPN和offset位数。")
    answer = split["solution"]["answer"]
    assert "offset 12 位" in answer and "VPN 20 位" in answer and "页框号 16 位" in answer
    translated = _solve("页大小4KB，虚拟地址32位，页表：虚页 0x2 -> 页框 0x5，访问虚拟地址0x00002010，求物理地址。")
    assert "5010H" in translated["solution"]["answer"]
    timing = _solve("Cache命中率95%，Cache访问时间2ns，主存访问时间20ns，TLB命中率98%，TLB访问时间1ns，页表访问时间5ns，顺序访问，求平均访问时间。")
    assert timing["solution"]["answer_value"] == pytest.approx(4.1)


def test_instruction_opcode_extension_addressing_and_c_expression():
    opcode = _solve("某指令操作码4位，求最多有多少条指令。")
    assert opcode["solution"]["answer_value"] == pytest.approx(16)
    extension = _solve("指令字长16位，操作码4位，地址码4位，三地址指令有12条，二地址指令最多有多少条？")
    assert extension["solution"]["answer_value"] == pytest.approx(48)
    addressing = _solve("采用基址寻址，基址寄存器R1=2000H，偏移量16，求有效地址。")
    assert "8208" in addressing["solution"]["answer"]
    mapping = _solve("ADD R1,R2,R3 对应什么C表达式？")
    assert "R1 = R2 + R3" in mapping["solution"]["answer"]


def test_cpu_control_cycles_and_microprogram_store():
    cycles = _solve("某指令取指2周期、执行3周期，CPU时钟周期2ns，执行100条指令，求执行时间。")
    assert cycles["solution"]["answer_value"] == pytest.approx(1000)
    micro = _solve("某微程序控制器有64条微指令，微指令字长32位，求控制存储器容量。")
    assert micro["solution"]["answer_value"] == pytest.approx(2048)


def test_pipeline_cycles_speedup_and_stalls():
    base = _solve("5段流水线执行100条指令，时钟周期2ns，求总周期、加速比和吞吐率。")
    assert "104 个周期" in base["solution"]["answer"]
    assert base["solution"]["answer_value"] == pytest.approx(104)
    stalled = _solve("5段流水线执行100条指令，时钟周期2ns，停顿10周期，求总周期和加速比。")
    assert "114 个周期" in stalled["solution"]["answer"]


def test_bus_bandwidth_dma_interrupt_and_priority():
    bus = _solve("总线宽度32位，总线频率100MHz，每个总线周期传送1次，求带宽。")
    assert "400 MB/s" in bus["solution"]["answer"]
    dma = _solve("DMA方式传送1MB数据，块大小1KB，DMA初始化需要10个周期，时钟周期10ns，求CPU时间开销。")
    assert dma["solution"]["answer_value"] == pytest.approx(100)
    interrupt = _solve("中断方式传送1MB数据，块大小1KB，每次中断需要20个周期，时钟周期10ns，求CPU时间开销。")
    assert interrupt["solution"]["answer_value"] == pytest.approx(204800)
    priority = _solve("设备优先级分别为1、3、2，求中断服务顺序和最大嵌套层数。")
    assert "设备2 → 设备3 → 设备1" in priority["solution"]["answer"]


def test_text_lab_persists_computer_organization_result(owner):
    from test_labs_api import _headers, _session

    headers = _headers(_session(owner))
    response = owner.post("/api/v1/labs/text", headers=headers, json={
        "text": "某CPU主频为2GHz，CPI为4，执行1000000条指令，求CPU执行时间。",
        "orchestrate": True,
    })
    assert response.status_code == 201, response.text
    document = response.json()["data"]
    problem = document["problems"][0]
    assert problem["subject"] == "computer_organization"
    assert problem["model"]["engine"] == "co_perf_v1"
    assert problem["model"]["co_result"]["co_kind"] == "performance"
    assert problem["solution"]["answer_value"] == pytest.approx(0.002)
    assert "orchestration" not in document


def test_real_408_co_exam_questions_ocr_and_modeling():
    """回归：4 道考研 408 组成原理真题（含 OCR 常见残缺括号、科学计数法、混合题干）均应本地准确求解。"""

    # 1. 2023-12 CPU 性能（OCR 漏掉末尾右括号、上标压平为 5×105）
    q1_ocr = (
        "12．若机器 M 的主频为1.5GHz，在 M上执行程序 P的指令条数为 5×105，P\n"
        "的平均CPI为1.2，则P在 M上的指令执行速度和用户CPU时间分别为（\n"
        "A. 0.8 GIPS, 0.4 ms  B. 0.8 GIPS, 0.4 μs  C. 1.25 GIPS, 0.4 ms  D. 1.25 GIPS, 0.4 μs"
    )
    p1 = _solve(q1_ocr)
    assert p1["recognition"]["quality"]["untrusted"] is False
    assert p1["status"] == "ready"
    assert p1["model"]["co_kind"] == "performance"
    assert p1["solution"]["answer_value"] == pytest.approx(0.0004)
    assert "1.25 GIPS" in p1["solution"]["answer"] and "0.4 ms" in p1["solution"]["answer"]

    # 2. 2016-45 Cache 组相联与块号映射（含虚存、TLB 全相联干扰项及 OCR 跨行断词“组\n相联”）
    q2_ocr = (
        "45．某计算机采用页式虚拟存储管理方式，虚拟地址为32位，物理地址为24位，页大小为8KB；"
        "TLB采用全相联映射；Cache数据区大小为64KB，按2路组\n相联方式组织，主存块大小为64B。\n"
        "（1）求物理地址中标记（Tag）、组号（Index）、块内偏移（Offset）的位数各是多少？\n"
        "（2）将块号为 4099 的主存块装入到 Cache 中时，所映射的 Cache 组号是多少？"
    )
    p2 = _solve(q2_ocr)
    assert p2["status"] == "ready"
    assert p2["model"]["co_kind"] == "cache"
    ans2 = p2["solution"]["answer"]
    assert "tag 9 位" in ans2 and "index 9 位" in ans2 and "offset 6 位" in ans2
    assert "组号 3" in ans2

    # 3. 2018-18 流水线最短时钟周期（各功能部件耗时 + 流水段寄存器延时）
    q3_ocr = (
        "18．若某计算机最复杂指令的执行需要完成5个子功能，分别由功能部件 A~E 实现，"
        "各功能部件所需时间分别为 80ps、50ps、50ps、70ps 和 50ps，采用流水线方式执行指令，"
        "流水段寄存器延时为 20ps，则 CPU 时钟周期至少为（）。\n"
        "A. 60ps  B. 70ps  C. 80ps  D. 100ps"
    )
    p3 = _solve(q3_ocr)
    assert p3["status"] == "ready"
    assert p3["model"]["co_kind"] == "pipeline"
    assert p3["solution"]["answer_value"] == pytest.approx(100.0)
    assert "100 ps" in p3["solution"]["answer"]

    # 4. 2009-21 总线带宽（并行传输 4 字节 + 1 总线周期占 2 时钟周期 + 10MHz）
    q4_ocr = (
        "21．假设某系统总线在一个总线周期中并行传输 4 字节信息，一个总线周期占用 2 个时钟周期，"
        "总线时钟频率为 10MHz，则总线带宽是（）。\n"
        "A. 10MB/s  B. 20MB/s  C. 40MB/s  D. 80MB/s"
    )
    p4 = _solve(q4_ocr)
    assert p4["status"] == "ready"
    assert p4["model"]["co_kind"] == "bus_io"
    assert p4["solution"]["answer_value"] == pytest.approx(20e6)
    assert "20 MB/s" in p4["solution"]["answer"]
