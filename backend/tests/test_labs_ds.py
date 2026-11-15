"""数据结构题型内核测试：六大模块的识别、执行轨迹与结论。"""
from __future__ import annotations

from app.labs.data_structures import evaluate_ds
from app.labs.recognize import _attach_solution, build_problem


def _solve(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "algorithm", (text, problem["subject"])
    assert problem["model"].get("engine", "").startswith("ds_"), (text, problem["model"].get("engine"))
    assert problem["model"].get("ds_result") is None
    _attach_solution(problem)
    return problem


# ---------------------------------------------------------------------------
# 顺序表与链表
# ---------------------------------------------------------------------------


def test_list_insert_counts_moves():
    problem = _solve("顺序表(1,2,3,4,5)，在第2个位置插入9。")
    solution = problem["solution"]
    assert "移动 4 次" in solution["answer"]
    assert solution["answer_order"] == ["1", "9", "2", "3", "4", "5"]
    evaluation = evaluate_ds(problem["model"], {})
    assert evaluation["status"] == "ok"
    assert len(evaluation["frames"]) >= 2


def test_list_merge_sorted():
    problem = _solve("有序表(1,3,5)和(2,4,6)合并。")
    assert problem["solution"]["answer_order"] == ["1", "2", "3", "4", "5", "6"]


def test_list_dedupe():
    problem = _solve("对有序表(1,1,2,3,3)去重。")
    assert problem["solution"]["answer_order"] == ["1", "2", "3"]


# ---------------------------------------------------------------------------
# 栈
# ---------------------------------------------------------------------------


def test_pop_sequence_legality():
    problem = _solve("入栈序列为1,2,3,4,5，出栈序列为4,3,5,2,1，判断它是否为合法出栈序列。")
    assert "合法" in problem["solution"]["answer"]
    assert "不合法" not in problem["solution"]["answer"]
    problem2 = _solve("入栈序列为1,2,3,4,5，出栈序列为3,1,2,4,5，判断它是否为合法出栈序列。")
    assert "不合法" in problem2["solution"]["answer"]
    # 非法序列同样要给出可回放的执行记录
    evaluation = evaluate_ds(problem2["model"], {})
    assert evaluation["status"] == "ok" and evaluation["frames"]


def test_stack_ops_simulation():
    problem = _solve("依次入栈1,2,3，然后出栈两次，再入栈4。")
    solution = problem["solution"]
    assert solution["answer_order"] == ["3", "2"]
    assert "1, 4" in solution["answer"]


def test_brackets_matching():
    problem = _solve("判断{[()]}是否括号匹配。")
    assert "完全匹配" in problem["solution"]["answer"]
    problem2 = _solve("判断([)]是否括号匹配。")
    assert "不匹配" in problem2["solution"]["answer"]


def test_expression_convert_and_value():
    problem = _solve("将表达式 (1+2)*3 转换为后缀表达式。")
    assert "1 2 + 3 *" in problem["solution"]["answer"]
    assert problem["solution"]["answer_value"] == 9
    problem2 = _solve("后缀表达式为 3 4 + 2 *，求它的值。")
    assert problem2["solution"]["answer_value"] == 14


def test_recursion_fact_and_fib():
    problem = _solve("递归计算fact(4)的调用过程与调用次数。")
    assert problem["solution"]["answer_value"] == 4
    assert "= 24" in problem["solution"]["answer"]
    problem2 = _solve("递归计算fib(5)的调用过程与调用次数。")
    assert problem2["solution"]["answer_value"] == 9
    assert "fib(5) = 5" in problem2["solution"]["answer"]


# ---------------------------------------------------------------------------
# 队列
# ---------------------------------------------------------------------------


def test_queue_circular_full_and_length():
    problem = _solve("循环队列容量为4，依次入队1,2,3，再入队4。")
    solution = problem["solution"]
    assert "队满" in solution["answer"]          # 牺牲一格：容量 4 只能存 3 个
    assert "长度 3" in solution["answer"]
    problem2 = _solve("循环队列容量为5，依次入队1,2,3，再出队两次，再入队4。")
    assert "出队序列 1, 2" in problem2["solution"]["answer"]
    assert "长度 2" in problem2["solution"]["answer"]


def test_deque_output_sequences():
    problem = _solve("输入受限的双端队列，依次输入1,2,3,4，能否得到输出序列4,3,2,1？")
    assert "合法" in problem["solution"]["answer"]
    problem2 = _solve("输出受限的双端队列，依次输入1,2,3,4，能否得到输出序列4,1,3,2？")
    assert "不合法" in problem2["solution"]["answer"]


def test_stack_queue_mutual_sim():
    problem = _solve("用两个栈实现队列：入队1，入队2，出队，入队3，出队。")
    assert problem["solution"]["answer_order"] == ["1", "2"]
    problem2 = _solve("用两个队列实现栈：入栈1，入栈2，出栈。")
    assert problem2["solution"]["answer_order"] == ["2"]


# ---------------------------------------------------------------------------
# 数组与特殊矩阵
# ---------------------------------------------------------------------------


def test_array_address_row_major():
    problem = _solve("数组A[0..5][0..7]按行优先存储，每个元素占4字节，首地址1000，求A[2][3]的地址。")
    assert problem["solution"]["answer_value"] == 1076


def test_matrix_storage_symmetric():
    problem = _solve("对称矩阵n=4压缩存储，求a[3][2]的下标。")
    assert "k = 5" in problem["solution"]["answer"]
    assert "10 个" in problem["solution"]["answer"]


def test_sparse_matrix_triples():
    problem = _solve("稀疏矩阵((0,5,0),(0,0,2),(1,0,0))的三元组表示。")
    answer = problem["solution"]["answer"]
    assert "(1, 2, 5)" in answer and "(2, 3, 2)" in answer and "(3, 1, 1)" in answer
    assert "(3, 3, 3)" in answer  # 表头 (3, 3, 3)


# ---------------------------------------------------------------------------
# 串与模式匹配
# ---------------------------------------------------------------------------


def test_string_match_naive_and_kmp():
    problem = _solve("主串S=ababcabcacbab，模式串T=abcac，求KMP的next数组与比较次数。")
    solution = problem["solution"]
    # 手工核验（教材 1 起口径，T=abcac）：朴素 16 次比较、KMP 12 次、匹配位置 6；
    # next = 0 1 1 1 2；nextval = 0 1 1 0 2。
    assert "朴素匹配：比较 16 次" in solution["answer"]
    assert "KMP：比较 12 次" in solution["answer"]
    assert "匹配位置 6" in solution["answer"]
    evaluation = evaluate_ds(problem["model"], {})
    tables = next(frame["values"] for frame in evaluation["frames"] if "next" in frame["values"])
    assert tables["next"] == "0 1 1 1 2"
    assert tables["nextval"] == "0 1 1 0 2"


# ---------------------------------------------------------------------------
# 算法分析
# ---------------------------------------------------------------------------


def test_analysis_loop_count_and_complexity():
    problem = _solve("外层 i 从 1 到 n，内层 j 从 1 到 i，n=4，求语句执行次数与时间复杂度。")
    solution = problem["solution"]
    assert solution["answer_value"] == 10          # 1+2+3+4
    assert "O(n^2)" in solution["answer"]


def test_analysis_recursion_master_theorem():
    problem = _solve("递归算法满足T(n)=2T(n/2)+n，求时间复杂度。")
    assert "O(n log n)" in problem["solution"]["answer"]


# ---------------------------------------------------------------------------
# 识别兜底：强关键词但数据不全 → 可核对的 blocked，而不是误判成图题
# ---------------------------------------------------------------------------


def test_blocked_model_for_incomplete_input():
    problem = build_problem("判断出栈序列是否为合法出栈序列。")
    assert problem["status"] in ("needs_review", "unsupported")
    assert problem["model"].get("engine", "").startswith("ds_")
    _attach_solution(problem)
    assert problem["solution"]["answer"] == ""


def test_bfs_graph_question_not_hijacked():
    problem = build_problem("对有向图进行广度优先遍历（BFS），边：A→B，A→C，B→D。从A开始，写出访问顺序。")
    assert problem["model"].get("engine") == "bfs_v1"


# ---------------------------------------------------------------------------
# 修复回归：循环分析步长/顺序结构/对数复杂度、tag 队列、小数表达式、地址缺条件、矩阵边界
# ---------------------------------------------------------------------------


def test_analysis_loop_with_step_two():
    problem = _solve("for(i=1;i<=n;i+=2) 循环体执行多少次？n=6。")
    assert problem["solution"]["answer_value"] == 3      # i = 1, 3, 5
    assert "O(n)" in problem["solution"]["answer"]


def test_analysis_sequential_loops():
    problem = _solve("两个依次执行的循环：i 从 1 到 n；j 从 1 到 n，n=4，求语句执行次数与时间复杂度。")
    assert problem["solution"]["answer_value"] == 8      # 4 + 4，不是相乘
    answer = problem["solution"]["answer"]
    assert "O(n)" in answer and "n^2" not in answer


def test_analysis_nested_log_loops():
    problem = _solve("for(i=1;i<=n;i*=2) for(j=1;j<=n;j*=2)，n=8，求语句执行次数与时间复杂度。")
    assert problem["solution"]["answer_value"] == 16     # (log2(8)+1)²
    assert "O(log^2 n)" in problem["solution"]["answer"]


def test_queue_tag_full_length_is_capacity():
    problem = _solve("循环队列容量为4，使用tag标志区分队空与队满，依次入队1,2,3,4。")
    answer = problem["solution"]["answer"]
    assert "长度 4" in answer                              # tag 口径不牺牲存储单元
    assert "队满，被拒绝" not in answer


def test_expression_decimal_not_truncated():
    problem = _solve("将表达式 1.5+2 转换为后缀表达式。")
    solution = problem["solution"]
    assert "1.5 2 +" in solution["answer"]
    assert solution["answer_value"] == 3.5


def test_address_missing_condition_blocks_cleanly():
    problem = build_problem("数组A[0..5][0..7]按行优先存储，首地址1000，求A[2][3]的地址。")
    assert problem["model"].get("engine") == "ds_array_address_v1"
    assert problem["status"] == "needs_review"
    _attach_solution(problem)
    assert problem["solution"]["answer"] == ""

    problem2 = build_problem("数组A[0..5][0..7]按行优先存储，每个元素占4字节，求A[2][3]的地址。")
    assert problem2["model"].get("engine") == "ds_array_address_v1"
    assert problem2["status"] == "needs_review"


def test_matrix_zero_based_bounds():
    problem = _solve("四阶对称矩阵下标从0开始压缩存储，求a[3][2]的下标。")
    assert "k = 8" in problem["solution"]["answer"]       # (4,3) 行优先序列第 9 个，数组 0 起


def test_matrix_column_major_symmetric():
    problem = _solve("四阶对称矩阵按列优先存储下三角，求a[3][2]的下标。")
    assert "k = 6" in problem["solution"]["answer"]       # 按列累计：(1,1),(2,1),(3,1),(4,1),(2,2),(3,2)
