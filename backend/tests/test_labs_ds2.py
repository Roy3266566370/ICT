"""数据结构进阶题型：二叉树、树/森林/哈夫曼、图、查找、排序。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, build_problem


def _solve(text: str):
    problem = build_problem(text)
    assert problem["subject"] == "algorithm", (text, problem["subject"])
    assert problem["model"].get("engine", "").startswith("ds_"), (text, problem["model"].get("engine"))
    _attach_solution(problem)
    return problem


# ---------------------------------------------------------------------------
# 二叉树
# ---------------------------------------------------------------------------


def test_btree_rebuild_from_pre_and_in():
    problem = _solve("已知二叉树先序序列 ABDECF，中序序列 DBEACF，求后序遍历序列。")
    solution = problem["solution"]
    assert solution["answer_order"] == ["D", "E", "B", "F", "C", "A"]
    assert "树高 3" in solution["answer"]


def test_btree_relations():
    problem = _solve("某二叉树共有5个叶子结点和3个度为1的结点，求总结点数与度为2的结点数。")
    answer = problem["solution"]["answer"]
    assert "12" in answer and "4" in answer


def test_btree_threaded():
    problem = _solve("含有10个结点的二叉树采用中序线索化，能形成的线索数有多少？")
    assert "11" in problem["solution"]["answer"]


# ---------------------------------------------------------------------------
# 树/森林/哈夫曼/并查集
# ---------------------------------------------------------------------------


def test_huffman_wpl_and_codes():
    problem = _solve("给定权值 1,2,4,6 构造哈夫曼树，求带权路径长度 WPL 与编码。")
    solution = problem["solution"]
    # 最优哈夫曼树：((1,2)→3, 3+4=7, 7+6=13)，WPL = Σ 内部结点权 = 23。
    assert solution["answer_value"] == pytest.approx(23.0)
    assert "编码" in solution["answer"]


def test_union_find_ops():
    problem = _solve("并查集：元素1~6各自成集，依次执行union(1,2)、union(3,4)、union(2,4)，求find(2)的根。")
    answer = problem["solution"]["answer"]
    assert "find(2) 的根为 1" in answer
    assert "{1,2,3,4}" in answer


def test_tree_to_binary_conversion():
    problem = _solve("将树 A(B,C(D)) 转换为对应的二叉树，给出对应二叉树的先序与中序序列。")
    answer = problem["solution"]["answer"]
    assert "A, B, C, D" in answer    # 先序 = 先根遍历
    assert "B, D, C, A" in answer    # 中序 = 后根遍历


# ---------------------------------------------------------------------------
# 图
# ---------------------------------------------------------------------------


def test_graph_representation_and_degrees():
    problem = _solve("无向图G顶点为A、B、C、D，边A-B、A-C、B-D。给出邻接矩阵与邻接表，并求各顶点的度。")
    answer = problem["solution"]["answer"]
    assert "邻接矩阵" in answer and "邻接表" in answer
    assert "度 2" in answer


def test_graph_components():
    problem = _solve("无向图顶点为A、B、C、D、E，边A-B、B-C、D-E，求连通分量个数。")
    assert "连通分量数 = 2" in problem["solution"]["answer"]


def test_prim_mst():
    problem = _solve("无向图顶点A、B、C、D，边A-B(1)、A-C(3)、B-C(2)、B-D(4)、C-D(5)，从A出发用Prim算法求最小生成树。")
    assert problem["solution"]["answer_value"] == pytest.approx(7.0)
    assert "A-B(1)" in problem["solution"]["answer"]


def test_kruskal_mst():
    problem = _solve("无向图顶点A、B、C、D，边A-B(1)、A-C(3)、B-C(2)、B-D(4)、C-D(5)，用Kruskal算法求最小生成树。")
    assert problem["solution"]["answer_value"] == pytest.approx(7.0)


def test_dijkstra_shortest_paths():
    problem = _solve("有向图顶点A、B、C、D，边A→B(1)、A→C(3)、B→C(2)、B→D(4)、C→D(5)，从A出发用Dijkstra求最短路径。")
    answer = problem["solution"]["answer"]
    assert "B=1" in answer and "C=3" in answer and "D=5" in answer


def test_floyd_shortest_matrix():
    problem = _solve("有向图顶点A、B、C，边A→B(1)、B→C(2)，用Floyd算法求各顶点间的最短距离。")
    assert "3" in problem["solution"]["answer"]     # A→C 经 B 距离 3


def test_topological_order():
    problem = _solve("有向图顶点A、B、C、D，边A→B、A→C、B→D、C→D，求拓扑排序序列。")
    assert problem["solution"]["answer_order"] == ["A", "B", "C", "D"]


def test_aoe_critical_path():
    problem = _solve("AOE网：有向图顶点A、B、C、D，边A→B(3)、A→C(2)、B→D(4)、C→D(2)，求关键路径与工期。")
    answer = problem["solution"]["answer"]
    assert "工期 7" in answer
    assert "A→B" in answer and "B→D" in answer


# ---------------------------------------------------------------------------
# 查找
# ---------------------------------------------------------------------------


def test_sequential_search_asl():
    problem = _solve("对含8个元素的顺序表进行顺序查找，求成功与失败的平均查找长度ASL。")
    answer = problem["solution"]["answer"]
    assert "4.5" in answer and "9" in answer


def test_binary_search_judgement_tree_asl():
    problem = _solve("对长度为11的有序表进行折半查找，画出判定树并求成功与失败的ASL。")
    answer = problem["solution"]["answer"]
    assert "33/11" in answer
    assert "56/12" in answer


def test_bst_build_and_asl():
    problem = _solve("依次插入50,30,70,20,40,60,80构造二叉排序树，求中序序列与ASL。")
    solution = problem["solution"]
    assert solution["answer_order"] == ["20", "30", "40", "50", "60", "70", "80"]
    assert "17/7" in solution["answer"]


def test_bst_delete_keyword_removes_node():
    problem = _solve("依次插入50,30,70,20,40,60,80构造二叉排序树，插入后删除30，求中序序列。")
    solution = problem["solution"]
    assert solution["answer_order"] == ["20", "40", "50", "60", "70", "80"]
    assert "已删除 30" in solution["answer"]
    assert any("删除 30" in str(frame.get("title", "")) for frame in solution["steps"])
    assert all("30" != value for value in solution["answer_order"])
    frames = problem["model"]["ds_result"]["frames"]
    assert any(frame.get("visual", {}).get("type") == "tree" for frame in frames)


def test_binary_search_without_asl_keywords_recognized():
    problem = _solve("对长度为11的有序表进行折半查找，最坏情况下需要比较几次？")
    assert problem["model"]["mode"] == "asl_binary"
    answer = problem["solution"]["answer"]
    assert "33/11" in answer
    assert "最坏比较 4 次" in answer


def test_binary_search_target_comparison_path():
    problem = _solve("有序表为5,13,19,21,37,56,64,75,80,88,92，用折半查找关键字21，需要比较几次？")
    answer = problem["solution"]["answer"]
    assert "查找 21 命中，比较 3 次" in answer


def test_binary_insertion_sort_not_hijacked_by_search():
    problem = _solve("对序列49,38,65,97,76,13,27进行折半插入排序，给出每趟结果。")
    assert problem["model"]["engine"] == "ds_sort_v1"


def test_quadratic_probing_failure_asl():
    problem = _solve("散列表长度为7，散列函数H(key)=key mod 7，用平方探测处理冲突，依次存入0,1,2,3，求成功与失败的ASL。")
    answer = problem["solution"]["answer"]
    assert "ASL失败 = 16/7" in answer


def test_avl_rotation():
    problem = _solve("依次插入3,2,1构造AVL平衡二叉树，指出旋转类型。")
    answer = problem["solution"]["answer"]
    assert "LL" in answer
    assert "2, 1, 3" in answer


def test_btree_insert_split():
    problem = _solve("3阶B树，依次插入1,2,3,4,5，给出最终结构。")
    assert "[2,4]" in problem["solution"]["answer"]


def test_bplus_insert_split():
    problem = _solve("3阶B+树，依次插入1,2,3,4,5,6，给出最终结构。")
    answer = problem["solution"]["answer"]
    # 叶结点最多 m=3 个关键字：插入 6 时 [3,4,5,6] 溢出，左 ⌈(m+1)/2⌉=[3,4]、右 [5,6]，5 复制上移 → 内部 [3,5]。
    assert "[1,2]" in answer and "[3,4]" in answer and "[5,6]" in answer
    assert "[3,5]" in answer


def test_hash_linear_probing_asl():
    problem = _solve("散列表长度为7，散列函数H(key)=key mod 7，用线性探测处理冲突，依次存入15,22,29,8，求成功与失败的ASL。")
    answer = problem["solution"]["answer"]
    assert "2.5" in answer
    assert "17/7" in answer


# ---------------------------------------------------------------------------
# 排序
# ---------------------------------------------------------------------------


def test_quick_sort_passes():
    problem = _solve("对序列49,38,65,97,76,13,27进行快速排序，给出每趟结果。")
    answer = problem["solution"]["answer"]
    # 教材（枢轴取首元素）第一趟：27, 38, 13, 49, 76, 97, 65
    assert "27, 38, 13, 49, 76, 97, 65" in answer
    assert "13, 27, 38, 49, 65, 76, 97" in answer


def test_heap_sort_unstable():
    problem = _solve("对序列49,38,65,97,76,13,27进行堆排序，给出每趟结果。")
    answer = problem["solution"]["answer"]
    assert "13, 27, 38, 49, 65, 76, 97" in answer
    assert "不稳定" in answer


def test_radix_sort_passes():
    problem = _solve("对序列23,12,45,33,21进行基数排序，给出每趟结果。")
    assert "12, 21, 23, 33, 45" in problem["solution"]["answer"]


def test_external_merge_rounds():
    problem = _solve("外部排序：有9个初始归并段，做3路归并，需要几趟？")
    assert problem["solution"]["answer_value"] == 2.0


def test_sort_stability_facts():
    problem = _solve("哪些排序方法是稳定的？")
    answer = problem["solution"]["answer"]
    assert "归并：稳定" in answer
    assert "快速：不稳定" in answer
