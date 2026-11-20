"""408 手动题目输入、建模与确定性求解回归测试。"""

from __future__ import annotations

import pytest

from app.labs.assistant import ask, check_attempt
from app.labs.recognize import _attach_solution, build_problem, rebuild_problem
from app.labs.solvers import evaluate_problem
from test_labs_api import app, owner  # noqa: F401 - 复用 API 测试夹具


def _solve_text(text: str, *, subject: str | None = None) -> dict:
    problem = build_problem(text, subject_hint=subject)
    _attach_solution(problem)
    return problem


def test_check_attempt_does_not_crash_on_text_conclusion_408_models():
    """OS 与计网文字结论/不可自动数值判分题型提交 attempt 时不得抛 UnboundLocalError。"""

    cases = [
        ("operating_system", "当前目录为 /home/user，读取文件 docs/report.txt，需要读取几次目录和 inode？"),
        ("operating_system", "说明快表（TLB）在虚实地址转换中的作用，命中与缺失时分别访问几次页表？"),
        ("operating_system", "说明缺页中断的处理流程，并解释工作集模型与抖动的关系。"),
        ("computer_network", "说明 OSI 七层模型和 TCP/IP 四层模型的对应关系，路由器工作在哪一层？"),
        ("computer_network", "IPv6 地址 2001:0db8:0000:0000:0000:0000:0000:0001 如何压缩？"),
        ("computer_network", "输入网址后到页面显示经过哪些协议？"),
    ]
    for subject, text in cases:
        problem = _solve_text(text, subject=subject)
        evaluation = evaluate_problem(problem["model"], {})
        for kind in ("numeric", "text"):
            result = check_attempt(problem, evaluation, answer="测试回答", field="text", kind=kind)
            assert isinstance(result["feedback"], str) and result["feedback"]


def test_assistant_algorithm_prompts_match_dfs_heap_and_ds_kinds():
    """非 BFS 算法题（DFS / ds_*）的问答与引导不得错误显示队列为 [] 或 BFS 出队话术。"""

    dfs = _solve_text("对无向图进行深度优先遍历，边 A-B, A-C, B-D，从 A 出发。", subject="algorithm")
    dfs_ev = evaluate_problem(dfs["model"], {})
    why_dfs = ask(dfs, dfs_ev, question="为什么沿着这个分支深入？", mode="guided", step=1)["answer"]
    guided_dfs = ask(dfs, dfs_ev, question="", mode="guided", step=1)["answer"]
    assert "栈为" in why_dfs and "队列为" not in why_dfs
    assert "下一个被访问的节点" in guided_dfs and "出队" not in guided_dfs

    ds_list = _solve_text("顺序表 [1, 2, 3, 4, 5] 在第 2 个位置插入元素 9。", subject="algorithm")
    ds_ev = evaluate_problem(ds_list["model"], {})
    why_ds = ask(ds_list, ds_ev, question="当前顺序表怎么变？", mode="guided", step=1)["answer"]
    assert "队列为 []" not in why_ds
    assert "出队" not in why_ds
    why_ds2 = ask(ds_list, ds_ev, question="为什么要移动元素？", mode="explore", step=1)["answer"]
    assert "队列为 []" not in why_ds2

    wrong_ds = check_attempt(ds_list, ds_ev, answer="1 2 3 4 5 9", field="order", kind="order")
    assert not wrong_ds["correct"]
    assert "BFS 的入队与出队顺序" not in wrong_ds["feedback"]


def test_comp_org_manual_variants_and_floating_decode():
    """覆盖组成原理括号负数、IEEE 754 编解码、交叉存储时间、TLB 无 Cache、多路器与总线周期。"""

    fixed = _solve_text("8位补码计算 (-5) - 125，判断是否溢出，写出CF、ZF、SF、OF。", subject="computer_organization")
    assert fixed["model"]["co_kind"] == "fixed_point"
    assert "OF=1" in fixed["solution"]["answer"]

    float_enc = _solve_text("将十进制数 -12.375 转换为 IEEE 754 单精度浮点数十六进制表示。", subject="computer_organization")
    assert float_enc["model"]["co_kind"] == "floating"
    assert "0xC1460000" in float_enc["solution"]["answer"]

    float_dec = _solve_text("将 IEEE 754 单精度浮点数 0x41200000 转换为十进制真值。", subject="computer_organization")
    assert float_dec["model"]["co_kind"] == "floating"
    assert float_dec["solution"]["answer_value"] == pytest.approx(10.0)
    assert float_dec["recognition"]["quality"]["untrusted"] is False

    float_h = _solve_text("将单精度浮点数 41200000H 解码为十进制。", subject="computer_organization")
    assert float_h["solution"]["answer_value"] == pytest.approx(10.0)

    mux = _solve_text("4选1多路选择器输入 D0=1, D1=4, D2=7, D3=9，选择信号 S=2，输出是什么？", subject="computer_organization")
    assert mux["solution"]["answer_value"] == pytest.approx(7.0)

    interleave = _solve_text(
        "4体低位交叉编址主存，存取周期 T=100ns，总线传输周期 τ=25ns，连续读取4个字的时间是多少？",
        subject="computer_organization",
    )
    assert interleave["solution"]["answer_value"] == pytest.approx(175.0)

    vm_tlb = _solve_text(
        "页大小4KB，32位虚地址，TLB命中率98%，TLB时间1ns，内存时间50ns，一级页表，求平均访问时间。",
        subject="computer_organization",
    )
    assert vm_tlb["solution"]["answer_value"] == pytest.approx(52.0)

    pipe = _solve_text(
        "5段流水线执行20条指令，遇到3个时钟周期的数据冒险停顿，时钟周期1ns，求总执行时间。",
        subject="computer_organization",
    )
    assert pipe["solution"]["answer_value"] == pytest.approx(27.0)

    bus = _solve_text(
        "总线时钟频率100MHz，总线宽度64位，每2个时钟周期传输一次数据，求总线带宽。",
        subject="computer_organization",
    )
    assert "400 MB/s" in bus["solution"]["answer"]


def test_data_structures_brackets_infix_eval_sparse_and_kmp_next():
    """覆盖 DS 括号距离放宽、中缀转后缀求值优先级、方括号稀疏矩阵、仅模式串求 next/nextval。"""

    brackets = _solve_text("判断括号序列 {[()()]} 是否匹配。", subject="algorithm")
    assert brackets["model"]["ds_kind"] == "brackets"
    assert "完全匹配" in brackets["solution"]["answer"]

    expr = _solve_text("将中缀表达式 (1 + 2) * 3 转换为后缀表达式并求值。", subject="algorithm")
    assert expr["model"]["ds_kind"] == "expression"
    assert expr["model"]["mode"] == "convert"
    assert expr["solution"]["answer_value"] == pytest.approx(9.0)

    expr_vars = _solve_text(
        "将中缀表达式 A + B * (C - D) / E 转换为后缀表达式；如果涉及求值也请说明规则。",
        subject="algorithm",
    )
    assert expr_vars["status"] == "ready"
    assert "A B C D - * E / +" in expr_vars["solution"]["answer"]

    sparse = _solve_text("稀疏矩阵 [[0,0,3],[0,5,0],[1,0,0]] 转置后的三元组表示。", subject="algorithm")
    assert sparse["model"]["ds_kind"] == "sparse"
    assert "(1, 3, 3)" in sparse["solution"]["answer"]

    kmp_next = _solve_text("求模式串 T='abaabcac' 的 next 数组和 nextval 数组。", subject="algorithm")
    assert kmp_next["model"]["ds_kind"] == "string_match"
    assert "0 1 1 2 2 3 1 2" in kmp_next["solution"]["answer"]
    assert "0 1 0 2 1 3 0 2" in kmp_next["solution"]["answer"]


def test_computer_network_hamming_decode_crc_receive_and_missing_delay():
    """覆盖计网接收海明码纠错、仅接收 CRC 直接验余、缺参时延阻塞与体系结构分层识别。"""

    ham_ok = _solve_text("收到海明码 1010101（偶校验），判断是否有单比特错误并纠错。", subject="computer_network")
    assert ham_ok["model"]["net_result"]["stats"]["hamming"]["syndrome"] == 0
    assert ham_ok["model"]["net_result"]["stats"]["hamming"]["data"] == "1101"

    ham_err = _solve_text("收到海明码 1010001（偶校验），判断是否有单比特错误并纠错。", subject="computer_network")
    assert ham_err["model"]["net_result"]["stats"]["hamming"]["syndrome"] == 5
    assert ham_err["model"]["net_result"]["stats"]["hamming"]["corrected"] == "1010101"

    crc_bad = _solve_text("接收端收到数据 10110011011，生成多项式 x^4+x+1，检验是否出错。", subject="computer_network")
    crc_stats = crc_bad["model"]["net_result"]["stats"]["crc"]
    assert crc_stats["check_remainder"] == "0001"
    assert crc_stats["ok"] is False

    missing_delay = _solve_text("求链路的发送时延和传播时延。", subject="computer_network")
    assert missing_delay["status"] == "needs_review"

    arch = _solve_text(
        "数据从应用层发送到物理层依次加上哪些首部？集线器和交换机分别工作在哪一层？",
        subject="computer_network",
    )
    assert arch["model"]["net_kind"] == "architecture"


def test_ambiguity_answers_cannot_bypass_blocked_408_and_single_problem_preserves_subquestions(owner):
    """阻塞型 408 ambiguity 不能被任意回答直接放行；single_problem 不应按小问编号拆题。"""

    from test_labs_api import _headers, _session

    blocked = _solve_text("顺序表插入元素9。", subject="algorithm")
    assert blocked["status"] == "needs_review"
    rebuilt = rebuild_problem(blocked, files=[], ambiguity_answers={"ds_blocked": "随便填一下"})
    _attach_solution(rebuilt)
    assert rebuilt["status"] == "needs_review"

    text = "对无向图进行BFS遍历，边A-B, B-C, C-D，从A出发。\n1. 写出访问顺序。\n2. 说明队列变化。"
    headers = _headers(_session(owner))
    resp = owner.post(
        "/api/v1/labs/text",
        headers=headers,
        json={
            "title": "手动 BFS 分问测试",
            "text": text,
            "subject": "algorithm",
            "single_problem": True,
        },
    )
    assert resp.status_code == 201, resp.text
    doc = resp.json()["data"]
    assert doc["problem_count"] == 1
    assert doc["problems"][0]["status"] == "ready"
    assert doc["problems"][0]["solution"]["answer_order"] == ["A", "B", "C", "D"]


def test_generic_os_text_models_editable_flag_and_attempt_feedback():
    """通用 OS 文本题的 os_kind 不可误编辑，且 check_attempt 应返回文字自评提示而非索要数值。"""

    cases = [
        "区分用户态与内核态的主要职责，并列出进入内核态的三类典型入口。",
        "给出进程状态转换序列：创建→就绪→运行→阻塞→就绪→运行→终止，判断各步是否合法并说明变化。",
        "信号量S初值为2，依次执行 P(S),P(S),P(S),V(S)，求S的值和等待进程数。",
        "进程 P1 占用资源 R1 并请求 R2，P2 占用资源 R2 并请求 R1，用资源分配图判断是否可能死锁及必要条件。",
        "空闲分区链依次为 [100, 500, 200, 300]，进程申请 120，比较首次适应与最佳适应的结果差异。",
    ]
    for text in cases:
        problem = _solve_text(text, subject="operating_system")
        os_kind_cond = next(c for c in problem["recognition"]["conditions"] if c["id"] == "os_kind")
        assert os_kind_cond["editable"] is False
        evaluation = evaluate_problem(problem["model"], {})
        res = check_attempt(problem, evaluation, answer="自拟文字答案", field="text", kind="text")
        assert res["correct"] is False
        assert "请填写结果的数值" not in res["feedback"]
        assert "系统不自动判分" in res["feedback"]


def test_ds_and_page_replace_review_condition_overrides():
    """ReviewDialog 新增放开的条件字段在 rebuild_problem 中应生效并重算结果。"""

    expr_prob = _solve_text("求中缀表达式 (1+2)*3 的后缀表达式及计算结果。", subject="algorithm")
    expr_rebuilt = rebuild_problem(expr_prob, files=[], condition_values={"expr": "3+4*2"})
    _attach_solution(expr_rebuilt)
    assert expr_rebuilt["solution"]["answer_value"] == 11

    arr_prob = _solve_text("数组A[0..5][0..7]按行优先存储，每个元素占4字节，首地址1000，求A[2][3]的地址。", subject="algorithm")
    arr_rebuilt = rebuild_problem(arr_prob, files=[], condition_values={"base": 2000, "size": 8})
    _attach_solution(arr_rebuilt)
    assert arr_rebuilt["solution"]["answer_value"] == 2152

    str_prob = _solve_text("主串S='ababcabcacbab'，模式串T='abcac'，求KMP匹配位置和next数组。", subject="algorithm")
    str_rebuilt = rebuild_problem(str_prob, files=[], condition_values={"s": "abcabc", "t": "cab"})
    _attach_solution(str_rebuilt)
    assert "3" in str_rebuilt["solution"]["answer"]

    page_prob = _solve_text("页面访问序列 1,2,3,4,1,2,5,1,2,3,4,5，物理块数 3，工作集窗口 4。", subject="operating_system")
    page_rebuilt = rebuild_problem(page_prob, files=[], condition_values={"frames": 4, "window": 5})
    _attach_solution(page_rebuilt)
    assert page_rebuilt["model"]["defaults"]["frames"] == 4
    assert page_rebuilt["model"]["defaults"]["window"] == 5
