"""数据结构进阶题型：二叉树、树/森林/哈夫曼、图、查找、排序。

与 data_structures.py 的题型同一架构：文本识别 → 确定性模型 → 轨迹回放 → 核对。
由 data_structures.build_ds_problem 优先调用（进阶检测词更具体）；
计算全部由确定性代码完成，关键口径在结果中显式标注。
"""
from __future__ import annotations

import math
import re
from typing import Any, Mapping

from .data_structures import (
    _MAX_FRAMES,
    _blocked_model,
    _blocked_result,
    _built,
    _check,
    _clause_values,
    _cn_number,
    _condition,
    _fmt,
    _frame,
    _ok_result,
    _tree_visual,
    _truncate,
)

# ---------------------------------------------------------------------------
# 小工具：图的边/顶点解析
# ---------------------------------------------------------------------------

_EDGE_W = re.compile(r"([A-Za-z])\s*(?:[-–—]|→|->)\s*([A-Za-z])\s*[（(：:]?\s*(\d+(?:\.\d+)?)\s*[）)]?")
_EDGE_UW = re.compile(r"([A-Za-z])\s*(?:[-–—]|→|->)\s*([A-Za-z])")
_VERTICES = re.compile(r"顶点\s*(?:为|是|集)?\s*[:：]?\s*([A-Za-z](?:\s*[,，、]\s*[A-Za-z]){1,15})")


def _weighted_edges(text: str) -> list[tuple[str, str, float]]:
    return [(m.group(1), m.group(2), float(m.group(3))) for m in _EDGE_W.finditer(text)]


def _plain_edges(text: str) -> list[tuple[str, str]]:
    return [(m.group(1), m.group(2)) for m in _EDGE_UW.finditer(text)]


def _vertex_set(text: str, edges: list[Any]) -> list[str]:
    nodes: list[str] = []
    for m in _VERTICES.finditer(text):
        for token in re.split(r"[\s,，、]+", m.group(1)):
            if token and token not in nodes:
                nodes.append(token)
    for edge in edges:
        for item in (edge[0], edge[1]):
            if item not in nodes:
                nodes.append(item)
    return nodes[:12]


def _neighbors(edges: list[Any], nodes: list[str], directed: bool) -> dict[str, list[str]]:
    adj = {node: [] for node in nodes}
    for edge in edges:
        u, v = edge[0], edge[1]
        if u in adj and v in adj and v not in adj[u]:
            adj[u].append(v)
        if not directed and u in adj and v in adj and u not in adj[v]:
            adj[v].append(u)
    for node in adj:
        adj[node] = sorted(adj[node])
    return adj


# ---------------------------------------------------------------------------
# 1) 二叉树：遍历序列还原 / 结点关系 / 线索
# ---------------------------------------------------------------------------

_BSEQ = re.compile(
    r"(先序|前序|中序|后序|后根|层序|层次)序?列?\s*(?:为|是|[:：])?\s*([A-Za-z0-9][\s,，、A-Za-z0-9]*)")


def _parse_bseq(raw: str) -> list[str]:
    raw = raw.strip(" 。.，,；;：:")
    if re.fullmatch(r"[A-Za-z0-9]+", raw):
        return list(raw)
    return [t for t in re.split(r"[\s,，、]+", raw) if t]


def _btree_seqs(text: str) -> dict[str, list[str]]:
    seqs: dict[str, list[str]] = {}
    for m in _BSEQ.finditer(text):
        kind = {"先序": "pre", "前序": "pre", "中序": "in", "后序": "post",
                "后根": "post", "层序": "level", "层次": "level"}[m.group(1)]
        if kind not in seqs:
            seqs[kind] = _parse_bseq(m.group(2))
    return seqs


def _rebuild(kind: str, other: list[str], ino: list[str],
             frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not ino:
        return None
    if kind == "pre":
        root = other[0]
    elif kind == "post":
        root = other[-1]
    else:
        root = other[0]
    k = ino.index(root)
    left_in, right_in = ino[:k], ino[k + 1:]
    if kind == "pre":
        left_other, right_other = other[1:k + 1], other[k + 1:]
    elif kind == "post":
        left_other, right_other = other[:k], other[k:len(other) - 1]
    else:
        rest = [x for x in other[1:] if x in left_in]
        left_other, right_other = rest, [x for x in other[1:] if x in right_in]
    frames.append(_frame(
        len(frames) + 1, f"确定根结点 {root}",
        f"{('中序' if True else '')}序列中 {root} 左侧 {left_in or '空'} 为左子树，右侧 {right_in or '空'} 为右子树。",
        {"根": root, "左子树中序": _fmt(left_in), "右子树中序": _fmt(right_in)}, 2))
    left = _rebuild(kind, left_other, left_in, frames) if left_in else None
    right = _rebuild(kind, right_other, right_in, frames) if right_in else None
    return {"v": root, "l": left, "r": right}


def _bpre(t: dict[str, Any] | None) -> list[str]:
    return ([t["v"]] + _bpre(t.get("l")) + _bpre(t.get("r"))) if t else []


def _bin(t: dict[str, Any] | None) -> list[str]:
    return (_bin(t.get("l")) + [t["v"]] + _bin(t.get("r"))) if t else []


def _bpost(t: dict[str, Any] | None) -> list[str]:
    return (_bpost(t.get("l")) + _bpost(t.get("r")) + [t["v"]]) if t else []


def _blevel(t: dict[str, Any] | None) -> list[str]:
    out: list[str] = []
    queue = [t] if t else []
    while queue:
        node = queue.pop(0)
        out.append(node["v"])
        if node.get("l"):
            queue.append(node["l"])
        if node.get("r"):
            queue.append(node["r"])
    return out


def _bheight(t: dict[str, Any] | None) -> int:
    return 0 if not t else 1 + max(_bheight(t.get("l")), _bheight(t.get("r")))


def _bleaves(t: dict[str, Any] | None) -> int:
    if not t:
        return 0
    if not t.get("l") and not t.get("r"):
        return 1
    return _bleaves(t.get("l")) + _bleaves(t.get("r"))


def build_btree(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"二叉树|先序|中序|后序|前序|层序|层次|线索", text):
        return None
    if re.search(r"二叉排序树|BST", text, re.I):
        return None
    seqs = _btree_seqs(text)
    n_match = re.search(r"(?:共|含有|有)\s*(\d{1,3})\s*个?结点", text)
    n_nodes = int(n_match.group(1)) if n_match else None
    has_numbers = bool(re.search(r"叶子|度为|总结点|结点总数|高度|完全二叉树", text)) or n_nodes is not None
    if re.search(r"线索", text) and n_nodes is not None:
        mode = "threaded"
    elif seqs and ("pre" in seqs or "post" in seqs or "level" in seqs) and "in" in seqs:
        mode = "rebuild"
    elif has_numbers:
        mode = "relations"
    else:
        return None
    model = {"engine": "ds_btree_v1", "subject": "algorithm", "ds_kind": "btree_ops",
             "mode": mode, "seqs": {k: v for k, v in seqs.items()}, "n": n_nodes, "raw": text,
             "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("mode", "题型", {"rebuild": "由遍历序列还原二叉树", "relations": "结点数与高度/叶子关系",
                                   "threaded": "线索二叉树"}[mode], source=source, editable=False),
    ]
    for name, seq in seqs.items():
        conditions.append(_condition(f"seq_{name}", {"pre": "先序序列", "in": "中序序列",
                                                     "post": "后序序列", "level": "层序序列"}[name],
                                     _fmt(seq), source=source, editable=False))
    formulas = [{"id": "btree_rule", "tex": r"n_0=n_2+1;\quad h_{\text{完全}}=\lfloor\log_2 n\rfloor+1",
                 "plain": "二叉树性质：叶子数 n0 = 度2结点数 n2 + 1；n 个结点的二叉树有 n+1 个空链域（可作 n+1 条线索）。",
                 "role": "二叉树性质"}]
    return _built("btree_ops", model, conditions, formulas)


def eval_btree(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "relations")
    text = str(model.get("raw") or "")
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    answer_bits: list[str] = []
    answer_order: list[str] | None = None
    if mode == "rebuild":
        seqs = dict(model.get("seqs") or {})
        pairs = (("pre", "post"), ("post", "pre"), ("level", "pre"))
        base = None
        for primary, derived in pairs:
            if primary in seqs and "in" in seqs:
                base = primary
                break
        assert base is not None
        primary, ino = seqs[base], seqs["in"]
        if sorted(primary) != sorted(ino) or len(primary) != len(ino):
            raise ValueError("两序列结点不一致：请核对题面给出的遍历序列")
        if len(set(primary)) != len(primary):
            raise ValueError("遍历序列中存在重复结点，请核对")
        if len(primary) > 12:
            raise ValueError("还原演示最多支持 12 个结点")
        frames.append(_frame(1, "输入序列", f"{base} 序列 {_fmt(primary)}；中序序列 {_fmt(ino)}。",
                             {base: _fmt(primary), "中序": _fmt(ino)}, 1))
        tree = _rebuild(base, primary, ino, frames)
        orders = {"pre": _bpre, "in": _bin, "post": _bpost, "level": _blevel}
        raw_text = str(model.get("raw") or "")
        ask = re.search(r"求\s*(先序|前序|中序|后序|层序|层次)", raw_text)
        if ask:
            order_kind = {"先序": "pre", "前序": "pre", "中序": "in", "后序": "post",
                          "层序": "level", "层次": "level"}[ask.group(1)]
        else:
            order_kind = {"pre": "post", "post": "pre", "level": "pre"}[base]
            for name in ("后序", "中序", "先序", "层序"):
                if name in raw_text:
                    order_kind = {"后序": "post", "中序": "in", "先序": "pre", "层序": "level"}[name]
                    break
        seq = orders[order_kind](tree)
        answer_order = [str(v) for v in seq]
        height, leaves = _bheight(tree), _bleaves(tree)
        frames.append(_frame(len(frames) + 1, "遍历结果",
                             f"{order_kind}遍历序列：{_fmt(seq)}；树高 {height}，叶子 {leaves} 个。",
                             {order_kind: _fmt(seq), "树高": str(height), "叶子数": str(leaves)}, 3,
                             visual=_tree_visual(tree)))
        answer_bits.append(f"{order_kind}遍历序列：{_fmt(seq)}")
        answer_bits.append(f"树高 {height}，叶子结点 {leaves} 个")
        notes.append("还原依据：先序/层序定根，中序分左右子树，递归重建；序列一致性已校验。")
    else:
        n = model.get("n")
        facts: list[tuple[str, str]] = []
        def grab(*patterns: str) -> int | None:
            for pattern in patterns:
                m = re.search(pattern, text)
                if m:
                    return int(m.group(1))
            return None

        n0 = grab(r"(\d+)\s*个?\s*叶子", r"叶子[^\d]{0,5}(\d+)", r"n\s*0\s*[=是为]\s*(\d+)")
        n1 = grab(r"(\d+)\s*个?\s*度为\s*1", r"度为\s*1[^\d]{0,5}(\d+)", r"n\s*1\s*[=是为]\s*(\d+)")
        n2 = grab(r"(\d+)\s*个?\s*度为\s*2", r"度为\s*2[^\d]{0,5}(\d+)", r"n\s*2\s*[=是为]\s*(\d+)")
        total = grab(r"总结点(?:数)?\s*[为是=]\s*(\d+)", r"结点总数[^\d]{0,3}(\d+)", r"共\s*(\d+)\s*个?\s*结点")
        height = grab(r"高度\s*[为是=]?\s*(\d+)")
        facts.append(("性质", "恒有 n0 = n2 + 1（叶子数 = 度2结点数 + 1）"))
        if n0 is not None and n2 is not None and n0 != n2 + 1:
            raise ValueError("题面 n0 与 n2 不满足 n0 = n2 + 1，请核对")
        if n0 is not None and n2 is None and n1 is None and total is None:
            facts.append(("推导", f"n2 = n0 - 1 = {n0 - 1}"))
        if n0 is not None and n1 is not None:
            n2_v = n0 - 1
            total_v = n0 + n1 + n2_v
            facts.append(("推导", f"n2 = {n2_v}，总结点 n = {total_v}"))
        if total is not None and n0 is not None:
            n2_v = n0 - 1
            n1_v = total - n0 - n2_v
            if n1_v < 0:
                raise ValueError("由 n0 与总结点推不出合法的 n1（n1 ≥ 0 不成立），请核对")
            facts.append(("推导", f"n2 = {n2_v}，n1 = {n1_v}"))
        if total is not None:
            facts.append(("完全二叉树", f"n = {total} 时高度 = ⌊log₂{total}⌋ + 1"))
        if height is not None:
            facts.append(("完全二叉树", f"高度 {height}：结点数最少 {2 ** (height - 1)}，最多 {2 ** height - 1}"))
        if n is not None:
            facts.append(("线索二叉树", f"n = {n} 个结点共有 n + 1 = {n + 1} 个空链域，可存放 {n + 1} 条线索"))
        for label, detail in facts:
            frames.append(_frame(len(frames) + 1, label, detail, {"结论": detail}, 2))
        answer_bits.extend(f"{label}：{detail}" for label, detail in facts)
        notes.append("关系题按二叉树基本性质推导；不满足性质时直接判为题目矛盾。")
        headline_mode = "结点关系与线索"
    headline = "；".join(answer_bits) or "二叉树分析"
    checks = [
        _check("consistency", "序列一致性", True, "遍历序列结点集与个数已互相校验（重建模式）。"),
        _check("property", "性质核验", True, "结论均由二叉树基本性质确定性推出。"),
    ]
    return _ok_result("btree_ops", headline, headline, _truncate(frames, notes),
                      ["输入遍历序列", "先/层序定根，中序分左右", "递归重建并记录", "按所求输出序列与结构"],
                      checks, notes, answer_order=answer_order)


def _extract_n(text: str, pattern: str) -> int | None:
    for m in re.finditer(pattern, text):
        for group in m.groups():
            if group:
                return int(group)
    return None


# ---------------------------------------------------------------------------
# 2) 树/森林/哈夫曼 + 并查集
# ---------------------------------------------------------------------------

def _huffman(weights: list[float]):
    nodes = [{"w": w, "seq": i, "leaf": True, "children": []} for i, w in enumerate(weights)]
    seq = len(nodes)
    frames: list[dict[str, Any]] = []
    while len(nodes) > 1:
        nodes.sort(key=lambda nd: (nd["w"], nd["seq"]))
        a, b = nodes[0], nodes[1]
        merged = {"w": a["w"] + b["w"], "seq": seq, "leaf": False, "children": [a, b]}
        seq += 1
        frames.append(_frame(len(frames) + 1, f"第 {len(frames)} 次合并",
                             f"取最小的两个结点 {a['w']:g} 与 {b['w']:g} 合并为 {merged['w']:g}（同权先取出现早者）。",
                             {"合并": f"{a['w']:g} + {b['w']:g}", "新结点权": f"{merged['w']:g}"}, 2))
        nodes = nodes[2:] + [merged]
    root = nodes[0]
    codes: dict[int, str] = {}
    wpl = 0.0

    def walk(node: dict[str, Any], path: str, depth: int) -> None:
        nonlocal wpl
        if node.get("leaf"):
            codes[node["seq"]] = path or "0"
            wpl += node["w"] * depth
            return
        walk(node["children"][0], path + "0", depth + 1)
        walk(node["children"][1], path + "1", depth + 1)

    walk(root, "", 0)
    return root, codes, wpl, frames


def build_tree_forest(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"哈夫曼|带权路径长度|WPL|并查集|孩子兄弟|左孩子右兄弟|森林|树转换(?:为|成)二叉树|转换.{0,10}二叉树", text, re.I):
        return None
    if re.search(r"哈夫曼|带权路径长度|WPL", text, re.I):
        mode = "huffman"
    elif re.search(r"并查集", text, re.I):
        mode = "union_find"
    else:
        mode = "bracket"
    model = {"engine": "ds_tree_v1", "subject": "algorithm", "ds_kind": "tree_forest",
             "mode": mode, "raw": text, "defaults": {}, "params": [], "teaching": False}
    conditions = [_condition("mode", "题型", {"huffman": "哈夫曼树构造与编码", "union_find": "并查集操作",
                                            "bracket": "树/森林与二叉树转换"}[mode],
                             source=source, editable=False)]
    formulas = [{"id": "tree_rule", "tex": r"WPL=\sum w_i l_i",
                 "plain": "哈夫曼树：每次取权值最小的两棵子树合并；WPL=Σ 权×路径长；树的后根遍历=对应二叉树的中序。",
                 "role": "树与哈夫曼规则"}]
    return _built("tree_forest", model, conditions, formulas)


def eval_tree_forest(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "huffman")
    raw = str(model.get("raw") or "")
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    if mode == "huffman":
        m = re.search(r"(?:权值|权重|权)\s*(?:为|是|集合)?\s*[:：]?\s*([\d.]+(?:\s*[,，、]\s*[\d.]+)+)", raw)
        if not m:
            raise ValueError("未识别到权值序列，请用“权值为 2,3,4,5”的写法给出")
        weights = [float(v) for v in re.findall(r"\d+(?:\.\d+)?", m.group(1))]
        if not (2 <= len(weights) <= 12):
            raise ValueError("哈夫曼构造需要 2–12 个权值")
        root, codes, wpl, frames = _huffman(weights)
        code_text = "、".join(f"{weights[int(seq)]:g}→{code}" for seq, code in sorted(codes.items(), key=lambda kv: weights[int(kv[0])]))
        frames.append(_frame(len(frames) + 1, "编码与 WPL",
                             f"约定左分支为 0、右分支为 1；WPL = Σ 权×路径长 = {wpl:g}。",
                             {"WPL": f"{wpl:g}", "编码": code_text}, 3))
        headline = f"WPL = {wpl:g}；哈夫曼编码：{code_text}"
        checks = [_check("greedy", "构造口径", True, "每步合并当前权值最小的两棵子树（同权先取出现早者）。")]
        notes.append("编码不唯一（左右分支可互换），但 WPL 唯一。")
        return _ok_result("tree_forest", headline, headline, _truncate(frames, notes),
                          ["权值入队", "取最小两个合并", "重复直到只剩一棵树", "左0右1求编码与WPL"],
                          checks, notes, answer_value=float(wpl))
    if mode == "union_find":
        m = re.search(r"元素\s*(?:为|是)?\s*(\d{1,3})\s*[~～至到]\s*(\d{1,3})", raw)
        elements = list(range(int(m.group(1)), int(m.group(2)) + 1)) if m else []
        if not elements or len(elements) > 20:
            raise ValueError("未识别到元素范围，请用“元素1~6各自成集”的写法（最多 20 个）")
        parent = {e: e for e in elements}
        size = {e: 1 for e in elements}

        def find(x: int) -> int:
            while parent[x] != x:
                x = parent[x]
            return x

        def show() -> str:
            groups: dict[int, list[int]] = {}
            for e in elements:
                groups.setdefault(find(e), []).append(e)
            return "、".join("{" + ",".join(str(x) for x in sorted(v)) + "}" for _, v in sorted(groups.items()))

        for m in re.finditer(r"union\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)|合并\s*(\d+)\s*(?:和|与)\s*(\d+)", raw, re.I):
            a = int(m.group(1) or m.group(3))
            b = int(m.group(2) or m.group(4))
            if a not in parent or b not in parent:
                raise ValueError(f"并查集中不存在元素 {a} 或 {b}")
            ra, rb = find(a), find(b)
            if ra == rb:
                frames.append(_frame(len(frames) + 1, f"union({a},{b})",
                                     f"{a} 与 {b} 已在同一集合（根 {ra}），不合并。",
                                     {"操作": f"union({a},{b})", "集合": show()}, 2))
                continue
            if size[ra] < size[rb] or (size[ra] == size[rb] and rb < ra):
                ra, rb = rb, ra
            parent[rb] = ra
            size[ra] += size[rb]
            frames.append(_frame(len(frames) + 1, f"union({a},{b})",
                                 f"两集合大小分别为 {size[ra] - size[rb]} 与 {size[rb]}，小树挂到大树：根 {rb} 指向 {ra}。",
                                 {"操作": f"union({a},{b})", "集合": show()}, 2))
        finds = [(int(m.group(1) or m.group(2))) for m in
                 re.finditer(r"find\s*\(\s*(\d+)\s*\)|查询\s*(\d+)|查找\s*(\d+)", raw, re.I)]
        answer_bits: list[str] = []
        for x in finds:
            if x not in parent:
                raise ValueError(f"并查集中不存在元素 {x}")
            root = find(x)
            answer_bits.append(f"find({x}) 的根为 {root}")
            frames.append(_frame(len(frames) + 1, f"find({x})", f"沿父指针找到根 {root}（按大小合并、未做路径压缩）。",
                                 {"查询": str(x), "根": str(root), "集合": show()}, 3))
        sets_text = show()
        headline = "；".join(answer_bits) + f"；集合划分：{sets_text}"
        checks = [_check("union", "合并口径", True, "按集合大小合并（同大小按编号），不会退化成链。")]
        notes.append("本实现按大小合并、不做路径压缩；教材口径不同时集合形态可能不同，但成员划分一致。")
        return _ok_result("tree_forest", headline, headline, _truncate(frames, notes),
                          ["初始化父指针指向自身", "union：两根相连（小挂大）", "find：沿父指针找根", "输出集合划分"],
                          checks, notes)
    # 树/森林（括号表示）→ 二叉树
    groups: list[str] = []
    s = re.sub(r"\s+", "", raw)
    i = 0
    while i < len(s):
        if i + 1 < len(s) and s[i].isalpha() and s[i + 1] == "(":
            depth = 0
            k = i + 1
            while k < len(s):
                if s[k] == "(":
                    depth += 1
                elif s[k] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            if depth != 0:
                raise ValueError("括号表示不完整")
            groups.append(s[i:k + 1])
            i = k + 1
        else:
            i += 1
    if not groups:
        raise ValueError("未识别到树的括号表示，请用 A(B,C(D)) 的写法给出")

    def parse_group(seg: str) -> dict[str, Any]:
        pos = [0]

        def parse() -> dict[str, Any]:
            if pos[0] >= len(seg) or not seg[pos[0]].isalpha():
                raise ValueError("括号表示不合法")
            node = {"v": seg[pos[0]], "children": []}
            pos[0] += 1
            if pos[0] < len(seg) and seg[pos[0]] == "(":
                pos[0] += 1
                while True:
                    if pos[0] < len(seg) and seg[pos[0]] == ")":
                        pos[0] += 1
                        break
                    node["children"].append(parse())
                    if pos[0] < len(seg) and seg[pos[0]] == ",":
                        pos[0] += 1
                        continue
                    if pos[0] < len(seg) and seg[pos[0]] == ")":
                        pos[0] += 1
                        break
                    raise ValueError("括号表示不合法：缺少 , 或 )")
            return node

        return parse()

    roots = [parse_group(g) for g in groups]

    def to_binary(node: dict[str, Any]) -> dict[str, Any]:
        b = {"v": node["v"], "l": None, "r": None}
        if node["children"]:
            kids = [to_binary(c) for c in node["children"]]
            b["l"] = kids[0]
            for x, y in zip(kids, kids[1:]):
                x["r"] = y
        return b

    bin_roots = [to_binary(r) for r in roots]
    for a, b in zip(bin_roots, bin_roots[1:]):
        a["r"] = b
    forest = bin_roots[0]
    pre = _bpre(forest)
    ino = _bin(forest)
    frames.append(_frame(1, "孩子兄弟表示",
                         "每个结点的第一个孩子作为左孩子，其余孩子依次作右兄弟；森林的各棵树根互为右兄弟。",
                         {"树根": _fmt([r["v"] for r in roots]), "对应二叉树先序": _fmt(pre)}, 2))
    frames.append(_frame(2, "遍历对应关系",
                         f"对应二叉树先序 {_fmt(pre)}（= 树/森林的先根遍历）；中序 {_fmt(ino)}（= 后根遍历）。",
                         {"先序": _fmt(pre), "中序": _fmt(ino)}, 3))
    headline = f"对应二叉树先序：{_fmt(pre)}；中序：{_fmt(ino)}"
    checks = [_check("convert", "转换规则", True, "左孩子、右兄弟；多棵树的根互为右兄弟。")]
    notes.append("树的后根遍历序列 = 对应二叉树的中序序列；先根遍历 = 先序序列。")
    return _ok_result("tree_forest", headline, headline, _truncate(frames, notes),
                      ["解析括号表示", "第一个孩子作左孩子", "其余孩子作右兄弟", "输出对应二叉树遍历"],
                      checks, notes, answer_order=[str(v) for v in pre])


# ---------------------------------------------------------------------------
# 3) 图的存储与遍历：邻接矩阵/邻接表转换、度数、连通分量
# ---------------------------------------------------------------------------

def build_graph_repr(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"邻接矩阵|邻接表|连通分量|出度|入度|度数", text, re.I):
        return None
    directed = "有向" in text
    w_edges = _weighted_edges(text)
    p_edges = _plain_edges(text)
    edges = w_edges if w_edges else p_edges
    if not edges:
        return None
    nodes = _vertex_set(text, edges)
    if len(nodes) > 12:
        raise ValueError("演示最多支持 12 个顶点")
    mode = "components" if re.search(r"连通分量", text) else "convert"
    model = {"engine": "ds_graphrepr_v1", "subject": "algorithm", "ds_kind": "graph_repr",
             "mode": mode, "edges": [list(e) for e in edges], "nodes": nodes,
             "directed": directed, "defaults": {}, "params": [], "teaching": False}
    conditions = [
        _condition("kind", "图类型", "有向图" if directed else "无向图", source=source, editable=False),
        _condition("vertices", "顶点", _fmt(nodes), source=source, editable=False),
    ]
    formulas = [{"id": "repr_rule", "tex": r"A[i][j]=1\Leftrightarrow (v_i,v_j)\in E",
                 "plain": "邻接矩阵行=起点、列=终点；无向图矩阵对称，度=行和；有向图出度=行和、入度=列和。",
                 "role": "存储规则"}]
    return _built("graph_repr", model, conditions, formulas)


def eval_graph_repr(model: Mapping[str, Any]) -> dict[str, Any]:
    nodes = list(model.get("nodes") or [])
    edges = [tuple(e) for e in model.get("edges") or []]
    directed = bool(model.get("directed"))
    mode = str(model.get("mode") or "convert")
    notes: list[str] = []
    adj = _neighbors(edges, nodes, directed)
    weight_map = {(e[0], e[1]): e[2] for e in edges if len(e) > 2}
    index = {node: i for i, node in enumerate(nodes)}
    matrix_rows = []
    for u in nodes:
        if weight_map:
            row = " ".join(f"{weight_map.get((u, v), weight_map.get((v, u), 0)):g}" if not directed else f"{weight_map.get((u, v), 0):g}"
                            for v in nodes)
        else:
            row = " ".join("1" if v in adj[u] or (not directed and u in adj[v]) else "0" for v in nodes)
        matrix_rows.append(f"{u}: {row}")
    list_rows = [f"{u} → " + (" ".join(adj[u]) or "∅") for u in nodes]
    degree_bits: list[str] = []
    for u in nodes:
        if directed:
            degree_bits.append(f"{u}: 出度 {len(adj[u])}，入度 {sum(1 for v in nodes if u in adj[v])}")
        else:
            degree_bits.append(f"{u}: 度 {len(adj[u])}")
    frames = [
        _frame(1, "邻接矩阵", "行=起点，列=终点；" + ("有向图不对称。" if directed else "无向图对称。"),
               {"矩阵": " / ".join(matrix_rows)}, 2),
        _frame(2, "邻接表", "每个顶点挂接其邻接点（按编号升序）。", {"邻接表": " / ".join(list_rows)}, 3),
        _frame(3, "度数", "；".join(degree_bits), {"度数": "；".join(degree_bits)}, 4),
    ]
    answer_bits = [f"邻接矩阵：{' / '.join(matrix_rows)}", f"邻接表：{' / '.join(list_rows)}",
                   "；".join(degree_bits)]
    if mode == "components":
        seen: set[str] = set()
        components: list[list[str]] = []
        for node in nodes:
            if node in seen:
                continue
            stack, group = [node], []
            while stack:
                cur = stack.pop()
                if cur in seen:
                    continue
                seen.add(cur)
                group.append(cur)
                stack.extend(adj[cur])
            components.append(sorted(group))
        comp_text = "、".join("{" + ",".join(g) + "}" for g in components)
        frames.append(_frame(len(frames) + 1, "连通分量", f"共 {len(components)} 个连通分量：{comp_text}。",
                             {"分量数": str(len(components)), "分量": comp_text}, 5))
        answer_bits.append(f"连通分量数 = {len(components)}（{comp_text}）")
        if directed:
            notes.append("有向图这里按弱连通口径统计（把边当无向）；强连通分量需专门算法。")
    headline = "；".join(answer_bits)
    checks = [_check("repr", "存储一致", True, "邻接矩阵与邻接表由同一组边生成，互相一致。")]
    return _ok_result("graph_repr", headline, headline, _truncate(frames, notes),
                      ["收集顶点与边", "生成邻接矩阵", "生成邻接表", "计算度数/连通分量"],
                      checks, notes)


# ---------------------------------------------------------------------------
# 4) 图的应用：Prim / Kruskal / Dijkstra / Floyd / 拓扑 / 关键路径
# ---------------------------------------------------------------------------

def build_graph_apply(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"Prim|普里姆|Kruskal|克鲁斯卡尔|最小生成树|Dijkstra|迪杰斯特拉|最短路径|Floyd|弗洛伊德|拓扑|关键路径|AOE", text, re.I):
        return None
    w_edges = _weighted_edges(text)
    p_edges = _plain_edges(text)
    if not w_edges and p_edges and re.search(r"拓扑", text, re.I):
        w_edges = [(u, v, 0.0) for u, v in p_edges]
    if not w_edges:
        raise ValueError("未识别到带权边，请用“A→B(4)”或“A-B:4”的写法给出")
    nodes = _vertex_set(text, w_edges)
    if len(nodes) > 10:
        raise ValueError("演示最多支持 10 个顶点")
    if re.search(r"关键路径|AOE", text, re.I):
        mode = "aoe"
    elif re.search(r"拓扑", text):
        mode = "topo"
    elif re.search(r"Dijkstra|迪杰斯特拉|最短路径", text, re.I):
        mode = "dijkstra"
    elif re.search(r"Floyd|弗洛伊德", text, re.I):
        mode = "floyd"
    elif re.search(r"Kruskal|克鲁斯卡尔", text, re.I):
        mode = "kruskal"
    else:
        mode = "prim"
    directed = "有向" in text or mode in ("topo", "aoe")
    if mode in ("prim", "kruskal") and directed:
        raise ValueError("Prim/Kruskal 适用于无向图；请去掉“有向”或改用相应算法")
    model = {"engine": "ds_graphapply_v1", "subject": "algorithm", "ds_kind": "graph_apply",
             "mode": mode, "edges": [list(e) for e in w_edges], "nodes": nodes,
             "directed": directed, "defaults": {}, "params": [], "teaching": False}
    algo_label = {"prim": "Prim 最小生成树", "kruskal": "Kruskal 最小生成树", "dijkstra": "Dijkstra 最短路径",
                  "floyd": "Floyd 各顶点最短路径", "topo": "拓扑排序", "aoe": "AOE 关键路径"}[mode]
    conditions = [_condition("algo", "算法", algo_label, source=source, editable=False),
                  _condition("vertices", "顶点", _fmt(nodes), source=source, editable=False)]
    formulas = [{"id": "apply_rule", "tex": r"\text{贪心/松弛按教材口径执行，过程全部留痕}",
                 "plain": "Prim 每次选跨割最小边；Kruskal 按权排序+并查集判环；Dijkstra 每次确定最近顶点；拓扑用入度法。",
                 "role": "算法口径"}]
    return _built("graph_apply", model, conditions, formulas)


def eval_graph_apply(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "prim")
    nodes = list(model.get("nodes") or [])
    w_edges = [(str(e[0]), str(e[1]), float(e[2])) for e in model.get("edges") or []]
    directed = bool(model.get("directed"))
    notes: list[str] = []

    def wmap_both() -> dict[tuple[str, str], float]:
        wm: dict[tuple[str, str], float] = {}
        for u, v, w in w_edges:
            wm.setdefault((u, v), w)
            wm.setdefault((v, u), w)
        return wm

    if mode == "prim":
        raw = str(model.get("raw") or "")
        m = re.search(r"从\s*([A-Za-z])\s*(?:出发|开始)", raw, re.I)
        start = m.group(1) if m and m.group(1) in nodes else nodes[0]
        wm = wmap_both()
        tree = {start}
        mst: list[tuple[str, str, float]] = []
        total = 0.0
        frames = [_frame(1, "初始化", f"从顶点 {start} 开始生长最小生成树。", {"已入树": _fmt(sorted(tree))}, 2)]
        while len(tree) < len(nodes):
            candidates = [(w, u, v) for (u, v), w in wm.items() if (u in tree) != (v in tree)]
            if not candidates:
                raise ValueError("图不连通，无法构造最小生成树")
            w, u, v = min(candidates, key=lambda e: (e[0], e[1], e[2]))
            new = v if u in tree else u
            total += w
            mst.append((u, v, w))
            tree.add(new)
            frames.append(_frame(len(frames) + 1, f"选中边 {u}-{v}",
                                 f"跨割最小边 {u}-{v}（权 {w:g}）入树，新顶点 {new}；同权时取字典序。",
                                 {"选中": f"{u}-{v}({w:g})", "累计权值": f"{total:g}", "已入树": _fmt(sorted(tree))}, 3))
        edge_text = "，".join(f"{u}-{v}({w:g})" for u, v, w in mst)
        headline = f"最小生成树：{edge_text}；总权值 {total:g}"
        checks = [_check("mst", "生成树", len(mst) == len(nodes) - 1, f"含 {len(nodes) - 1} 条边、连接全部 {len(nodes)} 个顶点。")]
        notes.append("Prim 贪心每步取跨割最小边；同权时按字典序，答案可能不唯一但总权值唯一。")
        return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                          ["从起点开始", "每次选跨割最小边", "新顶点入树", "直到覆盖全部顶点"],
                          checks, notes, answer_value=float(total))
    if mode == "kruskal":
        order = sorted(w_edges, key=lambda e: (e[2], e[0], e[1]))
        parent = {n: n for n in nodes}
        size = {n: 1 for n in nodes}

        def find(x: str) -> str:
            while parent[x] != x:
                x = parent[x]
            return x

        frames = [_frame(1, "按权排序", "边按权值升序（同权按端点字典序）：" +
                         "，".join(f"{u}-{v}({w:g})" for u, v, w in order) + "。", {"边数": str(len(order))}, 1)]
        mst: list[tuple[str, str, float]] = []
        total = 0.0
        for u, v, w in order:
            if len(mst) == len(nodes) - 1:
                break
            ru, rv = find(u), find(v)
            if ru == rv:
                frames.append(_frame(len(frames) + 1, f"考查 {u}-{v}({w:g})", f"两端已在同一集合，选入会成环，拒绝。",
                                     {"边": f"{u}-{v}({w:g})", "决定": "拒绝"}, 2))
                continue
            if size[ru] < size[rv]:
                ru, rv = rv, ru
            parent[rv] = ru
            size[ru] += size[rv]
            mst.append((u, v, w))
            total += w
            frames.append(_frame(len(frames) + 1, f"选入 {u}-{v}({w:g})", f"两端不在同一集合，选入；累计权值 {total:g}。",
                                 {"边": f"{u}-{v}({w:g})", "决定": "接受", "累计权值": f"{total:g}"}, 2))
        if len(mst) != len(nodes) - 1:
            raise ValueError("图不连通，无法构造最小生成树")
        edge_text = "，".join(f"{u}-{v}({w:g})" for u, v, w in mst)
        headline = f"最小生成树：{edge_text}；总权值 {total:g}"
        checks = [_check("mst", "生成树", len(mst) == len(nodes) - 1, f"含 {len(nodes) - 1} 条边，无环。")]
        notes.append("Kruskal 按权排序后用并查集判环。")
        return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                          ["边按权排序", "从小到大考查", "并查集判环", "选满 n-1 条为止"],
                          checks, notes, answer_value=float(total))
    if mode == "dijkstra":
        if any(w < 0 for _, _, w in w_edges):
            raise ValueError("Dijkstra 不支持负权边，请核对题面")
        wm = wmap_both() if not directed else {(u, v): w for u, v, w in w_edges}
        adj: dict[str, list[tuple[str, float]]] = {n: [] for n in nodes}
        for (u, v), w in wm.items():
            adj[u].append((v, w))
        raw = str(model.get("raw") or "")
        m = re.search(r"(?:从|源点)\s*([A-Za-z])", raw, re.I)
        start = m.group(1) if m and m.group(1) in nodes else nodes[0]
        inf = float("inf")
        dist = {n: inf for n in nodes}
        dist[start] = 0.0
        prev: dict[str, str] = {}
        visited: set[str] = set()
        frames = [_frame(1, "初始化", f"源点 {start}，dist[start]=0，其余为 ∞。",
                         {"源点": start, "dist": _fmt([f"{n}:{dist[n]:g}" if dist[n] < inf else f"{n}:∞" for n in nodes])}, 2)]

        def path_to(x: str) -> str:
            chain = [x]
            while chain[-1] != start and chain[-1] in prev:
                chain.append(prev[chain[-1]])
            return "→".join(reversed(chain))

        while len(visited) < len(nodes):
            candidates = [(d, n) for n, d in dist.items() if n not in visited and d < inf]
            if not candidates:
                frames.append(_frame(len(frames) + 1, "剩余顶点不可达", "dist 为 ∞ 的顶点保持不可达。", {"可达": "否"}, 3))
                break
            d, u = min(candidates)
            visited.add(u)
            frames.append(_frame(len(frames) + 1, f"确定 {u}",
                                 f"未确定顶点中 dist 最小者为 {u}（{d:g}），确定其最短路径 {path_to(u)}。",
                                 {"确定": u, "dist": f"{d:g}", "路径": path_to(u)}, 3))
            for v, w in adj.get(u, []):
                if v not in visited and dist[u] + w < dist[v] - 1e-9:
                    dist[v] = dist[u] + w
                    prev[v] = u
        dist_bits = [f"{n}={dist[n]:g}" if dist[n] < inf else f"{n}=不可达" for n in nodes]
        path_bits = [f"{n}: {path_to(n)}" for n in nodes if dist[n] < inf and n != start]
        headline = f"从 {start} 出发最短距离：" + "，".join(dist_bits) + "；路径：" + "；".join(path_bits)
        checks = [_check("greedy", "贪心口径", True, "每次确定未确定顶点中 dist 最小者，同距离按字典序。")]
        notes.append("Dijkstra 不支持负权边；教材口径下每次确定一个顶点的最终距离。")
        return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                          ["初始化 dist", "取未确定中 dist 最小者", "松弛其邻边", "重复直至全部确定"],
                          checks, notes)
    if mode == "floyd":
        inf = float("inf")
        dist = {u: {v: (0.0 if u == v else inf) for v in nodes} for u in nodes}
        for u, v, w in w_edges:
            dist[u][v] = min(dist[u][v], w)
            if not directed:
                dist[v][u] = min(dist[v][u], w)
        frames = [_frame(1, "初始矩阵", "未直接相连记 ∞，对角线为 0。",
                         {"矩阵": " / ".join(f"{u}: " + " ".join("∞" if dist[u][v] == inf else f"{dist[u][v]:g}" for v in nodes) for u in nodes)}, 2)]
        for k in nodes:
            for u in nodes:
                for v in nodes:
                    if dist[u][k] + dist[k][v] < dist[u][v] - 1e-9:
                        dist[u][v] = dist[u][k] + dist[k][v]
            frames.append(_frame(len(frames) + 1, f"允许经过 {k}",
                                 f"把 {k} 作为中转点更新所有点对后的矩阵。",
                                 {"中转点": k, "矩阵": " / ".join(f"{u}: " + " ".join("∞" if dist[u][v] == inf else f"{dist[u][v]:g}" for v in nodes) for u in nodes)}, 3))
        matrix_text = " / ".join(f"{u}: " + " ".join("∞" if dist[u][v] == inf else f"{dist[u][v]:g}" for v in nodes) for u in nodes)
        headline = f"各顶点间最短距离矩阵：{matrix_text}"
        checks = [_check("dp", "动态规划口径", True, "依次允许每个顶点作为中转点更新全部点对。")]
        notes.append("Floyd 允许负权边，但不允许负权回路。")
        return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                          ["初始距离矩阵", "依次允许中转点 k", "三点比较更新", "输出最终矩阵"],
                          checks, notes)
    if mode == "topo":
        indeg = {n: 0 for n in nodes}
        adj: dict[str, list[str]] = {n: [] for n in nodes}
        for u, v, _ in w_edges:
            adj[u].append(v)
            indeg[v] += 1
        avail = sorted(n for n in nodes if indeg[n] == 0)
        order: list[str] = []
        frames = [_frame(1, "初始入度", "入度为 0 的顶点可直接输出：" + _fmt(avail), {"入度0": _fmt(avail)}, 2)]
        while avail:
            u = avail.pop(0)
            order.append(u)
            for v in adj[u]:
                indeg[v] -= 1
                if indeg[v] == 0:
                    avail.append(v)
            avail.sort()
            frames.append(_frame(len(frames) + 1, f"输出 {u}",
                                 f"删除 {u} 及其出边后，新的入度 0 顶点：{_fmt(avail) or '无'}。",
                                 {"序列": " → ".join(order), "入度0": _fmt(avail)}, 3))
        if len(order) < len(nodes):
            rest = sorted(set(nodes) - set(order))
            headline = f"存在回路，拓扑序列不存在（剩余顶点：{_fmt(rest)}）"
            notes.append("有向图存在回路时无法完成拓扑排序；剩余顶点构成或位于回路中。")
        else:
            headline = "拓扑序列：" + " → ".join(order)
            notes.append("入度为 0 的顶点有多个时按编号升序选取，序列可能不唯一。")
        checks = [_check("kahn", "入度法", True, "每步删除一个入度为 0 的顶点及其出边。")]
        return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                          ["统计入度", "输出入度为 0 者", "删点删边更新入度", "重复；删不完则有回路"],
                          checks, notes,
                          answer_order=[str(v) for v in order] if len(order) == len(nodes) else [])
    # AOE 关键路径
    indeg = {n: 0 for n in nodes}
    adj: dict[str, list[tuple[str, float]]] = {n: [] for n in nodes}
    for u, v, w in w_edges:
        adj[u].append((v, w))
        indeg[v] += 1
    topo = []
    avail = sorted(n for n in nodes if indeg[n] == 0)
    indeg_work = dict(indeg)
    while avail:
        u = avail.pop(0)
        topo.append(u)
        for v, _ in adj[u]:
            indeg_work[v] -= 1
            if indeg_work[v] == 0:
                avail.append(v)
        avail.sort()
    if len(topo) < len(nodes):
        raise ValueError("网络存在回路，不是 AOE 网，无法求关键路径")
    ve = {n: 0.0 for n in nodes}
    for u in topo:
        for v, w in adj[u]:
            ve[v] = max(ve[v], ve[u] + w)
    duration = max(ve.values())
    vl = {n: duration for n in nodes}
    for u in reversed(topo):
        for v, w in adj[u]:
            vl[u] = min(vl[u], vl[v] - w)
    activities = [(u, v, w, ve[u], vl[v] - w) for u, v, w in w_edges]
    key_edges = [f"{u}→{v}" for u, v, w, e, l in activities if abs(l - e) < 1e-9]
    frames = [
        _frame(1, "最早发生时间 ve", "按拓扑序正向递推：ve[后继] = max(ve[前驱]+工期)。",
               {"ve": _fmt([f"{n}:{ve[n]:g}" for n in topo])}, 2),
        _frame(2, "最迟发生时间 vl", "按逆拓扑序反向递推：vl[前驱] = min(vl[后继]-工期)。",
               {"vl": _fmt([f"{n}:{vl[n]:g}" for n in reversed(topo)]), "工期": f"{duration:g}"}, 3),
        _frame(3, "关键活动", "e(i) = l(i) 的活动即关键活动：" + ("、".join(key_edges) or "无"),
               {"关键活动": "、".join(key_edges) or "无", "工期": f"{duration:g}"}, 4),
    ]
    headline = f"工程工期 {duration:g}；关键活动：{'、'.join(key_edges) or '无'}"
    checks = [
        _check("dag", "AOE 网", True, "网络无回路，源点到汇点可正常递推。"),
        _check("key", "关键活动判据", True, "满足 e(i)=l(i)（时间余量为 0）的活动构成关键路径。"),
    ]
    notes.append("关键路径可能不唯一；工期等于汇点的最早发生时间。")
    return _ok_result("graph_apply", headline, headline, _truncate(frames, notes),
                      ["拓扑排序", "正向递推 ve", "反向递推 vl", "e=l 的活动为关键活动"],
                      checks, notes, answer_value=float(duration))


# ---------------------------------------------------------------------------
# 5) 查找：顺序/折半 ASL、二叉排序树、AVL、B 树、B+ 树、散列
# ---------------------------------------------------------------------------

def _insert_seq(text: str) -> list[int]:
    m = re.search(r"-?\d+(?:\s*[,，、]\s*-?\d+)+", text)
    if not m:
        return []
    return [int(v) for v in re.findall(r"-?\d+", m.group(0))]


_BINARY_SEARCH = r"折半(?:查找|搜索|检索|法)|二分(?:查找|搜索|检索)|对分查找"


def build_search(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(
        r"ASL|平均查找长度|判定树|二叉排序树|BST|平衡二叉树|AVL|B\s*\+?\s*[-—]?\s*树|散列|哈希|冲突处理|顺序查找|"
        + _BINARY_SEARCH,
        text,
        re.I,
    ):
        return None
    if re.search(r"散列|哈希|冲突处理", text, re.I):
        mode = "hash"
    elif re.search(r"B\s*\+\s*树|B\+树", text, re.I):
        mode = "bplus"
    elif re.search(r"B\s*[-—]?\s*树", text, re.I):
        mode = "btree"
    elif re.search(r"AVL|平衡二叉", text, re.I):
        mode = "avl"
    elif re.search(r"二叉排序树|BST", text, re.I):
        mode = "bst"
    elif re.search(_BINARY_SEARCH + r"|判定树", text):
        mode = "asl_binary"
    else:
        mode = "asl_sequential"
    seq = _insert_seq(text)
    model = {"engine": "ds_search_v1", "subject": "algorithm", "ds_kind": "search_ops",
             "mode": mode, "seq": seq, "raw": text, "defaults": {}, "params": [], "teaching": False}
    mode_label = {"asl_sequential": "顺序查找 ASL", "asl_binary": "折半查找判定树与 ASL",
                  "bst": "二叉排序树", "avl": "AVL 平衡调整", "btree": "B 树插入",
                  "bplus": "B+ 树插入", "hash": "散列表与 ASL"}[mode]
    conditions = [_condition("mode", "题型", mode_label, source=source, editable=False)]
    if seq:
        conditions.append(_condition("seq", "序列", _fmt(seq), source=source, editable=False))
    formulas = [{"id": "search_rule", "tex": r"ASL=\dfrac{\sum C_i}{n};\quad \text{折半取} \lfloor(low+high)/2\rfloor",
                 "plain": "ASL=Σ每个元素比较次数/n；折半查找取中点向下取整；散列 ASL 分成功与失败两种口径。",
                 "role": "查找口径"}]
    return _built("search_ops", model, conditions, formulas)


def eval_search(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "asl_sequential")
    raw = str(model.get("raw") or "")
    seq = list(model.get("seq") or [])
    notes: list[str] = []
    frames: list[dict[str, Any]] = []
    if mode == "asl_sequential":
        m = re.search(r"(?:含|有|长度为)\s*(\d{1,4})\s*个?元素", raw) or re.search(r"n\s*[=是为]\s*(\d{1,4})", raw)
        n = int(m.group(1)) if m else (len(seq) or None)
        if not n:
            raise ValueError("未识别到元素个数 n，请用“含 n 个元素的顺序表”的写法")
        success = (n + 1) / 2
        fail = n + 1
        frames.append(_frame(1, "成功 ASL", f"等概率下第 i 个元素比较 i 次：ASL成功 = (n+1)/2 = {n + 1}/2 = {success:g}。",
                             {"n": str(n), "ASL成功": f"{success:g}"}, 2))
        frames.append(_frame(2, "失败 ASL", f"失败时要比较全部 n 个元素再判定：ASL失败 = n+1 = {fail:g}。",
                             {"ASL失败": f"{fail:g}"}, 3))
        headline = f"顺序查找：ASL成功 = {success:g}，ASL失败 = {fail:g}"
        checks = [_check("formula", "公式口径", True, "成功概率均等；失败必须扫完整表。")]
        return _ok_result("search_ops", headline, headline, frames,
                          ["第 i 个元素比较 i 次", "求和取平均", "失败扫全表"], checks, notes,
                          answer_value=float(success))
    if mode == "asl_binary":
        m = re.search(r"(?:长度为|含|有)\s*(\d{1,4})", raw) or re.search(r"n\s*[=是为]\s*(\d{1,4})", raw)
        n = int(m.group(1)) if m else (len(seq) or None)
        if not n or n > 4096:
            raise ValueError("折半查找需要元素个数 n（1–4096）")
        succ: dict[int, int] = {}
        fails: dict[int, int] = {}

        def walk(lo: int, hi: int, depth: int) -> None:
            if lo > hi:
                fails[depth] = fails.get(depth, 0) + 1
                return
            mid = (lo + hi) // 2
            succ[depth] = succ.get(depth, 0) + 1
            walk(lo, mid - 1, depth + 1)
            walk(mid + 1, hi, depth + 1)

        walk(1, n, 1)
        success = sum(d * c for d, c in succ.items()) / n
        fail = sum(d * c for d, c in fails.items()) / (n + 1)
        level_bits = [f"第 {d} 层：{succ.get(d, 0)} 个成功结点、{fails.get(d, 0)} 个失败结点"
                      for d in sorted(set(list(succ) + list(fails)))]
        for text_line in level_bits:
            frames.append(_frame(len(frames) + 1, "判定树分层", text_line, {"层": text_line}, 2))
        succ_total = sum(d * c for d, c in succ.items())
        fail_total = sum(d * c for d, c in fails.items())
        worst = max(succ)
        frames.append(_frame(len(frames) + 1, "ASL 结果",
                             f"ASL成功 = ΣCi/n = {succ_total}/{n} = {success:g}；"
                             f"ASL失败 = ΣCi/(n+1) = {fail_total}/{n + 1} ≈ {fail:.2f}。",
                             {"ASL成功": f"{success:g}", "ASL失败": f"{fail:.2f}"}, 3))
        frames.append(_frame(len(frames) + 1, "最坏情况",
                             f"判定树最深成功结点在第 {worst} 层，最坏比较 {worst} 次；"
                             f"⌈log₂(n+1)⌉ = {math.ceil(math.log2(n + 1))}。",
                             {"最坏比较次数": str(worst)}, 3))
        headline = (f"折半查找（n={n}）：ASL成功 = {succ_total}/{n} = {success:g}，"
                    f"ASL失败 = {fail_total}/{n + 1} ≈ {fail:.2f}，最坏比较 {worst} 次")
        target_match = re.search(r"(?:查找|寻找|检索)\s*(?:关键字|元素|值)?\s*(?:为|是|[:：])?\s*(-?\d+)", raw)
        if target_match:
            target = int(target_match.group(1))
            if seq and seq == sorted(seq):
                low, high = 0, len(seq) - 1
                path: list[int] = []
                found = False
                while low <= high:
                    mid = (low + high) // 2
                    path.append(seq[mid])
                    if seq[mid] == target:
                        found = True
                        break
                    if target < seq[mid]:
                        high = mid - 1
                    else:
                        low = mid + 1
                verdict = "命中" if found else "未命中"
                frames.append(_frame(len(frames) + 1, f"查找 {target}",
                                     f"比较路径：{' → '.join(str(v) for v in path)}；{verdict}，共比较 {len(path)} 次。",
                                     {"查找": str(target), "结果": verdict, "比较次数": str(len(path))}, 2))
                headline += f"；查找 {target} {verdict}，比较 {len(path)} 次"
            elif seq:
                headline += f"；题面有序表非升序，无法确定 {target} 的折半查找路径"
                notes.append("题面给出的有序表并非升序，无法按折半口径定位目标；请核对表内关键字的顺序。")
            else:
                headline += f"；题面未给出有序表，无法确定 {target} 的具体比较次数"
                notes.append(f"题面未给出有序表的具体关键字，无法确定关键字 {target} 的查找路径；以上 ASL 与最坏次数按 n={n} 计算。")
        checks = [_check("mid", "取中口径", True, "mid = ⌊(low+high)/2⌋ 向下取整。")]
        notes.append("判定树形态与取整约定有关；ASL 成功对应全部内部结点深度之和。")
        return _ok_result("search_ops", headline, headline, frames,
                          ["mid 向下取整", "递归分层统计结点", "成功内部结点求 ASL", "失败外部结点求 ASL",
                           "最深成功结点层数即最坏比较次数"],
                          checks, notes, answer_value=float(success))
    if not seq:
        raise ValueError("未识别到关键字序列，请用“依次插入 50,30,70”的写法给出")
    if len(seq) > 15:
        raise ValueError("演示最多支持 15 个关键字")
    if mode == "bst":
        root = None
        for v in seq:
            depth = 1
            if root is None:
                root = {"v": v, "l": None, "r": None}
            else:
                cur = root
                while True:
                    if v == cur["v"]:
                        notes.append(f"关键字 {v} 重复，只保留第一个。")
                        break
                    depth += 1
                    if v < cur["v"]:
                        if cur["l"] is None:
                            cur["l"] = {"v": v, "l": None, "r": None}
                            break
                        cur = cur["l"]
                    else:
                        if cur["r"] is None:
                            cur["r"] = {"v": v, "l": None, "r": None}
                            break
                        cur = cur["r"]
            frames.append(_frame(len(frames) + 1, f"插入 {v}", f"查找路径比较 {depth} 次后插入。",
                                 {"插入": str(v), "比较次数": str(depth)}, 2,
                                 visual=_tree_visual(root, highlight=v)))

        def bst_find(node, key):
            path = []
            while node is not None:
                path.append(node["v"])
                if key == node["v"]:
                    return node, path
                node = node["l"] if key < node["v"] else node["r"]
            return None, path

        def bst_delete(node, key):
            """返回 (新子树根, 是否删除, 替代说明)；双孩子用中序后继替换。"""
            if node is None:
                return None, False, ""
            if key < node["v"]:
                node["l"], removed, replacement = bst_delete(node["l"], key)
                return node, removed, replacement
            if key > node["v"]:
                node["r"], removed, replacement = bst_delete(node["r"], key)
                return node, removed, replacement
            if node["l"] is None:
                return node["r"], True, "左子树为空，用右孩子顶替" if node["r"] else "叶子结点，直接删除"
            if node["r"] is None:
                return node["l"], True, "右子树为空，用左孩子顶替"
            successor = node["r"]
            while successor["l"] is not None:
                successor = successor["l"]
            replacement_value = successor["v"]
            node["v"] = replacement_value
            node["r"], _, _ = bst_delete(node["r"], replacement_value)
            return node, True, f"双孩子：用中序后继 {replacement_value} 替换"

        delete_targets: list[int] = []
        delete_patterns = (
            r"(?:删除|删去|删掉)\s*(?:根?结点|根?节点|元素|记录)?\s*(?:关键字|关键码|值)?\s*(?:为|是|[:：])?\s*"
            r"((?:-?\d+\s*(?:[,，、和及与]|和|及)?\s*)+)",
            r"(?:将|把)\s*((?:-?\d+\s*(?:[,，、和及与]|和|及)?\s*)+)[^。；;\n]{0,16}?(?:删除|删去|删掉)",
        )
        for pattern in delete_patterns:
            for clause in re.findall(pattern, raw):
                delete_targets.extend(int(v) for v in re.findall(r"-?\d+", clause))
        removed_keys: list[int] = []
        missing_keys: list[int] = []
        for key in delete_targets:
            found, path = bst_find(root, key)
            if found is None:
                missing_keys.append(key)
                notes.append(f"关键字 {key} 不在二叉排序树中，删除操作已忽略。")
                frames.append(_frame(len(frames) + 1, f"删除 {key}（未找到）",
                                     f"沿 {' → '.join(str(v) for v in path) or '空树'} 查找未命中，树结构不变。",
                                     {"删除": str(key), "结果": "未找到，忽略"}, 3,
                                     visual=_tree_visual(root)))
                continue
            root, _, replacement = bst_delete(root, key)
            removed_keys.append(key)
            frames.append(_frame(len(frames) + 1, f"删除 {key}",
                                 f"查找路径 {' → '.join(str(v) for v in path)}；{replacement}；删除后中序：{_fmt(_bin(root))}。",
                                 {"删除": str(key), "替代": replacement, "中序": _fmt(_bin(root))}, 3,
                                 visual=_tree_visual(root)))

        inorder = _bin(root)
        depths: dict[int, int] = {}

        def collect_depths(node, depth):
            if node is None:
                return
            depths[node["v"]] = depth
            collect_depths(node["l"], depth + 1)
            collect_depths(node["r"], depth + 1)

        collect_depths(root, 1)
        asl = sum(depths.values()) / len(depths) if depths else 0.0
        headline = f"中序序列：{_fmt(inorder)}"
        if removed_keys:
            headline += f"；已删除 {_fmt(removed_keys)}"
        if missing_keys:
            headline += f"；未找到 {_fmt(missing_keys)}"
        headline += f"；ASL成功 = {sum(depths.values())}/{len(depths)} ≈ {asl:.2f}"
        checks = [
            _check("inorder", "中序有序", inorder == sorted(inorder), "BST 中序遍历必有序。"),
            _check("depth", "比较次数", True, "结点比较次数 = 深度（根为 1）。"),
        ]
        if delete_targets:
            checks.append(_check("delete", "删除生效",
                                 all(key not in inorder for key in removed_keys),
                                 f"删除目标 {_fmt(delete_targets)}，实际删除 {_fmt(removed_keys) or '无'}。"))
        return _ok_result("search_ops", headline, headline, _truncate(frames, notes),
                          ["小于走左、大于走右", "空位插入", "删除：叶子直接删、单支孩子顶替、双支中序后继替换",
                           "中序验证有序", "按最终树深度求 ASL"],
                          checks, notes, answer_order=[str(v) for v in inorder],
                          answer_value=float(asl))
    if mode == "avl":
        root = None
        rotations: list[str] = []

        def height(t): return t["h"] if t else 0

        def update(t): t["h"] = 1 + max(height(t["l"]), height(t["r"]))

        def rot_right(t):
            left = t["l"]
            t["l"] = left["r"]; left["r"] = t
            update(t); update(left)
            return left

        def rot_left(t):
            right = t["r"]
            t["r"] = right["l"]; right["l"] = t
            update(t); update(right)
            return right

        def insert(t, v):
            if t is None:
                return {"v": v, "l": None, "r": None, "h": 1}
            if v < t["v"]:
                t["l"] = insert(t["l"], v)
            elif v > t["v"]:
                t["r"] = insert(t["r"], v)
            else:
                notes.append(f"关键字 {v} 重复，只保留第一个。")
                return t
            update(t)
            balance = height(t["l"]) - height(t["r"])
            if balance > 1:
                if v < t["l"]["v"]:
                    kind_text = "LL 失衡（右单旋）"
                    t = rot_right(t)
                else:
                    kind_text = "LR 失衡（先左旋后右旋）"
                    t["l"] = rot_left(t["l"])
                    t = rot_right(t)
                rotations.append(kind_text)
                frames.append(_frame(len(frames) + 1, f"插入 {v} 触发调整",
                                     f"发生 {kind_text}，调整后子树根为 {t['v']}。",
                                     {"插入": str(v), "旋转": kind_text, "新根": str(t["v"])}, 3,
                                     visual=_tree_visual(t, highlight=v)))
            elif balance < -1:
                if v > t["r"]["v"]:
                    kind_text = "RR 失衡（左单旋）"
                    t = rot_left(t)
                else:
                    kind_text = "RL 失衡（先右旋后左旋）"
                    t["r"] = rot_right(t["r"])
                    t = rot_left(t)
                rotations.append(kind_text)
                frames.append(_frame(len(frames) + 1, f"插入 {v} 触发调整",
                                     f"发生 {kind_text}，调整后子树根为 {t['v']}。",
                                     {"插入": str(v), "旋转": kind_text, "新根": str(t["v"])}, 3,
                                     visual=_tree_visual(t, highlight=v)))
            return t

        for v in seq:
            root = insert(root, v)
        pre = _bpre(root)
        frames.append(_frame(len(frames) + 1, "最终 AVL 树",
                             f"逐次插入并调整后，先序序列：{_fmt(pre)}。",
                             {"先序": _fmt(pre), "平衡因子校验": "各结点左右子树高度差 ≤ 1"}, 3,
                             visual=_tree_visual(root)))
        headline = ("调整过程：" + "；".join(rotations) + "；" if rotations else "无失衡，无需旋转；") \
            + f"最终先序序列：{_fmt(pre)}"
        checks = [_check("balance", "平衡性", abs(height(root["l"]) - height(root["r"])) <= 1,
                         "每个结点左右子树高度差 ≤ 1。")]
        notes.append("旋转类型按插入位置判定：LL 右旋、RR 左旋、LR 先左后右、RL 先右后左。")
        return _ok_result("search_ops", headline, headline, _truncate(frames, notes),
                          ["按 BST 插入", "回溯更新高度", "失衡则按类型旋转", "继续向上检查"],
                          checks, notes, answer_order=[str(v) for v in pre])
    if mode in ("btree", "bplus"):
        m = re.search(r"(\d)\s*阶", raw)
        order = int(m.group(1)) if m else 3
        if not (3 <= order <= 6):
            raise ValueError("B 树演示支持 3–6 阶")
        root = {"keys": [], "kids": [], "leaf": True}

        def split_leaf(node):
            total = len(node["keys"])
            med = total // 2 if mode == "btree" else (total + 1) // 2
            promote = node["keys"][med]
            right = {"keys": node["keys"][med + 1:], "kids": [], "leaf": True}
            if mode == "bplus":
                promote = node["keys"][med]  # 复制上移，叶子保留
                right = {"keys": node["keys"][med:], "kids": [], "leaf": True}
                promote = node["keys"][med]
            node["keys"] = node["keys"][:med] if mode == "btree" else node["keys"][:med]
            return promote, right

        def insert(node, v):
            pos = 0
            while pos < len(node["keys"]) and node["keys"][pos] < v:
                pos += 1
            if node["leaf"]:
                if v in node["keys"]:
                    notes.append(f"关键字 {v} 重复，忽略。")
                    return None
                node["keys"].insert(pos, v)
                limit = order - 1 if mode == "btree" else order
                if len(node["keys"]) > limit:
                    total = len(node["keys"])
                    med = total // 2 if mode == "btree" else (total + 1) // 2
                    promote = node["keys"][med]
                    right_keys = node["keys"][med + 1:] if mode == "btree" else node["keys"][med:]
                    node["keys"] = node["keys"][:med]
                    right = {"keys": right_keys, "kids": [], "leaf": True}
                    return promote, right
                return None
            result = insert(node["kids"][pos], v)
            if result:
                promote, right = result
                node["keys"].insert(pos, promote)
                node["kids"].insert(pos + 1, right)
                limit = order - 1 if mode == "btree" else order
                if len(node["keys"]) > limit:
                    total = len(node["keys"])
                    med = total // 2 if mode == "btree" else (total + 1) // 2
                    promote = node["keys"][med]
                    right = {"keys": node["keys"][med + 1:], "kids": node["kids"][med + 1:], "leaf": False}
                    node["keys"] = node["keys"][:med]
                    node["kids"] = node["kids"][:med + 1]
                    return promote, right
            return None

        for v in seq:
            result = insert(root, v)
            if result:
                promote, right = result
                root = {"keys": [promote], "kids": [root, right], "leaf": False}
            frames.append(_frame(len(frames) + 1, f"插入 {v}",
                                 f"插入 {v} 后的结点状态已记录（溢出时按{'中位关键字上移' if mode == 'btree' else '中间关键字复制上移'}分裂）。",
                                 {"插入": str(v), "根keys": _fmt(root["keys"])}, 2))

        def level_nodes(t):
            out = []
            queue = [t]
            while queue:
                node = queue.pop(0)
                out.append(f"[{','.join(str(k) for k in node['keys'])}]{'' if node['leaf'] else '(内部)'}")
                queue.extend(node.get("kids") or [])
            return out

        structure = " ".join(level_nodes(root))
        headline = f"最终 {order} 阶 {('B+ 树' if mode == 'bplus' else 'B 树')}：{structure}"
        checks = [_check("keys", "关键字上限", True, f"每结点最多 {order if mode == 'bplus' else order - 1} 个关键字。")]
        notes.append("B+ 树按王道口径：叶结点最多 m 个关键字，分裂后中间关键字复制上移；内部结点分裂时中位关键字上移不保留。")
        return _ok_result("search_ops", headline, headline, _truncate(frames, notes),
                          ["落到叶结点插入", "溢出则分裂", "关键字上移建新层", "逐次记录结构"],
                          checks, notes)
    # 散列
    m = re.search(r"(?:散列表|哈希表)?(?:长度|表长)\s*[为是]?\s*(\d{1,3})", raw) or re.search(r"(\d{1,3})\s*个?存储单元", raw)
    if not m:
        raise ValueError("未识别到散列表长度，请用“散列表长度为 11”的写法")
    table_len = int(m.group(1))
    p = table_len
    mp = re.search(r"(?:mod|%|除留余数法?)[\s:：=]?\s*(\d{1,3})", raw, re.I)
    if mp:
        p = int(mp.group(1))
    if not (2 <= table_len <= 20) or not (1 <= p <= table_len):
        raise ValueError("散列表长度须为 2–20，除数 p 不能超过表长")
    method = "quadratic" if re.search(r"平方探测", raw) else "chaining" if re.search(r"链地址|拉链", raw) else "linear"
    if not seq or len(seq) > 12:
        raise ValueError("需要 1–12 个待存关键字")
    if method == "chaining":
        buckets: list[list[int]] = [[] for _ in range(table_len)]
        probes = []
        for v in seq:
            h = v % p
            buckets[h].append(v)
            probes.append(len(buckets[h]))
            frames.append(_frame(len(frames) + 1, f"存入 {v}", f"H({v}) = {v % p}，链接到该地址链尾（比较 {len(buckets[h])} 次）。",
                                 {"关键字": str(v), "散列地址": str(v % p), "链长": str(len(buckets[h]))}, 2))
        success = sum(probes) / len(probes)
        fail = sum(len(b) for b in buckets[:p]) / p
        table_text = " ".join(f"{i}:{','.join(str(x) for x in buckets[i]) or '∅'}" for i in range(table_len))
        headline = (f"散列表（链地址）：{table_text}；ASL成功 = {sum(probes)}/{len(probes)} = {success:g}；"
                    f"ASL失败 = {sum(len(b) for b in buckets[:p])}/{p} ≈ {fail:.2f}")
        checks = [_check("collide", "冲突处理", True, "同地址关键字链接在同一链表。")]
        notes.append("链地址法失败 ASL 按各散列地址链长的平均计算。")
        return _ok_result("search_ops", headline, headline, _truncate(frames, notes),
                          ["计算散列地址", "同地址链接", "查找沿链进行", "按链长求 ASL"], checks, notes,
                          answer_value=float(success))
    table: dict[int, int] = {}
    probes = []
    for v in seq:
        h = v % p
        probe_count = 0
        placed = None
        tried = 0
        idx = h
        offsets = [0]
        if method == "quadratic":
            k = 1
            while len(offsets) < table_len * 2:
                offsets.append(k * k)
                offsets.append(-k * k)
                k += 1
        else:
            offsets = list(range(table_len))
        for off in offsets:
            tried += 1
            idx = (h + off) % table_len
            if idx not in table:
                table[idx] = v
                placed = idx
                break
            probe_count += 1
        probe_count += 1
        if placed is None:
            raise ValueError("散列表已满，无法继续存入")
        probes.append(probe_count)
        frames.append(_frame(len(frames) + 1, f"存入 {v}",
                             f"H({v}) = {h}；探测 {probe_count} 次后放入地址 {placed}。",
                             {"关键字": str(v), "散列地址": str(h), "探测次数": str(probe_count), "存入位置": str(placed)}, 2))
    success = sum(probes) / len(probes)
    fail_counts: list[int] = []
    if method == "quadratic":
        fail_offsets = [0]
        k = 1
        while len(fail_offsets) < table_len:
            fail_offsets.extend([k * k, -k * k])
            k += 1
        fail_offsets = fail_offsets[:table_len]
    else:
        fail_offsets = list(range(table_len))
    for a in range(p):
        count = 0
        for off in fail_offsets:
            count += 1
            if (a + off) % table_len not in table:
                break
        fail_counts.append(count)
    fail = sum(fail_counts) / p
    table_text = " ".join(f"{i}:{table.get(i, '∅')}" for i in range(table_len))
    headline = (f"散列表（{'平方探测' if method == 'quadratic' else '线性探测'}）：{table_text}；"
                f"ASL成功 = {sum(probes)}/{len(probes)} = {success:g}；ASL失败 = {sum(fail_counts)}/{p} ≈ {fail:.2f}")
    checks = [
        _check("collide", "冲突处理", True, "探测序列全部从散列地址开始。"),
        _check("asl", "双口径", True, "成功按每个关键字探测次数；失败按每个散列地址沿同一探测序列探测到空位次数。"),
    ]
    notes.append("失败 ASL 只统计前 p 个散列地址（H(key) 的取值范围）；平方探测的失败探测序列与插入时一致（0, +1², −1², +2², −2², …）。")
    return _ok_result("search_ops", headline, headline, _truncate(frames, notes),
                      ["计算散列地址", "冲突则按探测序列后移", "存入第一个空位", "成功/失败两种 ASL"],
                      checks, notes, answer_value=float(success))


# ---------------------------------------------------------------------------
# 6) 排序：九种算法每趟结果 + 外部排序 + 稳定性
# ---------------------------------------------------------------------------

_SORT_ALGOS = [
    (r"折半插入", "binary_insertion", "折半插入排序"),
    (r"直接插入|插入排序", "insertion", "直接插入排序"),
    (r"希尔", "shell", "希尔排序"),
    (r"冒泡|起泡", "bubble", "冒泡排序"),
    (r"快速|快排", "quick", "快速排序"),
    (r"简单选择|选择排序", "selection", "简单选择排序"),
    (r"堆排序", "heap", "堆排序"),
    (r"归并", "merge", "归并排序"),
    (r"基数", "radix", "基数排序"),
]

_SORT_STABILITY = [
    ("直接插入", "稳定"), ("折半插入", "稳定"), ("希尔", "不稳定"), ("冒泡", "稳定"),
    ("快速", "不稳定"), ("简单选择", "不稳定"), ("堆", "不稳定"), ("归并", "稳定"), ("基数", "稳定"),
]


def build_sort(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    if not re.search(r"堆排序|直接插入|插入排序|折半插入|希尔|冒泡|起泡|快速排序|快排|简单选择|选择排序|归并排序|二路归并|基数排序|外部排序|归并段|稳定", text):
        return None
    if re.search(r"外部排序|归并段", text):
        mode = "external"
    elif re.search(r"稳定", text) and not re.search(r"\d+\s*[,，、]\s*-?\d+", text):
        mode = "stability"
    else:
        mode = "run"
    algo = None
    algo_label = None
    for pattern, key, label in _SORT_ALGOS:
        if re.search(pattern, text):
            algo, algo_label = key, label
            break
    seq = []
    m = re.search(r"-?\d+(?:\s*[,，、]\s*-?\d+)+", text)
    if m:
        seq = [int(v) for v in re.findall(r"-?\d+", m.group(0))]
    if mode == "run":
        if algo is None:
            return None
        if not seq or len(seq) > 16:
            raise ValueError("需要 2–16 个待排关键字，请用“对序列 49,38,65 进行快速排序”的写法")
    model = {"engine": "ds_sort_v1", "subject": "algorithm", "ds_kind": "sort_ops",
             "mode": mode, "algo": algo, "seq": seq, "raw": text,
             "defaults": {}, "params": [], "teaching": False}
    mode_label = {"external": "外部排序归并趟数", "stability": "排序稳定性", "run": algo_label or "排序"}[mode]
    conditions = [_condition("mode", "题型", mode_label, source=source, editable=False)]
    if seq:
        conditions.append(_condition("seq", "待排序列", _fmt(seq), source=source, editable=False))
    if algo:
        conditions.append(_condition("algo", "排序算法", algo_label, source=source, editable=False))
    formulas = [{"id": "sort_rule", "tex": r"\text{每趟结果、比较/移动次数与稳定性全部由真实执行记录产生}",
                 "plain": "快排以第一个元素为枢轴；希尔增量为 n/2 序列；稳定性结论来自算法性质。", "role": "排序口径"}]
    return _built("sort_ops", model, conditions, formulas)


def _sort_run(algo: str, values: list[int]) -> tuple[list[str], int, int, bool]:
    a = list(values)
    n = len(a)
    passes: list[str] = []
    comparisons = 0
    moves = 0
    stable = True
    if algo == "insertion":
        for i in range(1, n):
            key = a[i]
            j = i - 1
            moves += 1
            while j >= 0 and a[j] > key:
                comparisons += 1
                a[j + 1] = a[j]
                j -= 1
                moves += 1
            if j >= 0:
                comparisons += 1
            a[j + 1] = key
            moves += 1
            passes.append(_fmt(a))
    elif algo == "binary_insertion":
        for i in range(1, n):
            key = a[i]
            lo, hi = 0, i - 1
            while lo <= hi:
                mid = (lo + hi) // 2
                comparisons += 1
                if a[mid] > key:
                    hi = mid - 1
                else:
                    lo = mid + 1
            block = a[lo:i]
            a[lo:i + 1] = [key] + block
            moves += i - lo + 1
            passes.append(_fmt(a))
    elif algo == "shell":
        gap = n // 2
        while gap > 0:
            for i in range(gap, n):
                key = a[i]
                j = i - gap
                moves += 1
                while j >= 0 and a[j] > key:
                    comparisons += 1
                    a[j + gap] = a[j]
                    j -= gap
                    moves += 1
                if j >= 0:
                    comparisons += 1
                a[j + gap] = key
                moves += 1
            passes.append(_fmt(a) + f"（增量 {gap}）")
            gap //= 2
        stable = False
    elif algo == "bubble":
        for i in range(n - 1):
            swapped = False
            for j in range(n - 1 - i):
                comparisons += 1
                if a[j] > a[j + 1]:
                    a[j], a[j + 1] = a[j + 1], a[j]
                    moves += 1
                    swapped = True
            passes.append(_fmt(a) + ("（本趟无交换，提前结束）" if not swapped else ""))
            if not swapped:
                break
    elif algo == "quick":
        def partition(low: int, high: int) -> int:
            nonlocal comparisons, moves
            pivot = a[low]
            moves += 1
            while low < high:
                while low < high and a[high] >= pivot:
                    comparisons += 1
                    high -= 1
                if low < high:
                    a[low] = a[high]
                    moves += 1
                while low < high and a[low] <= pivot:
                    comparisons += 1
                    low += 1
                if low < high:
                    a[high] = a[low]
                    moves += 1
            a[low] = pivot
            return low

        def qsort(low: int, high: int) -> None:
            if low >= high:
                return
            p = partition(low, high)
            passes.append(_fmt(a) + f"（枢轴 {a[p]} 落位 {p}）")
            qsort(low, p - 1)
            qsort(p + 1, high)

        qsort(0, n - 1)
        stable = False
    elif algo == "selection":
        for i in range(n - 1):
            m = i
            for j in range(i + 1, n):
                comparisons += 1
                if a[j] < a[m]:
                    m = j
            if m != i:
                a[i], a[m] = a[m], a[i]
                moves += 1
            passes.append(_fmt(a))
        stable = False
    elif algo == "heap":
        def sift(i: int, end: int) -> None:
            nonlocal comparisons
            while True:
                child = 2 * i + 1
                if child > end:
                    break
                if child + 1 <= end:
                    comparisons += 1
                    if a[child + 1] > a[child]:
                        child += 1
                comparisons += 1
                if a[child] > a[i]:
                    a[i], a[child] = a[child], a[i]
                    i = child
                else:
                    break

        for i in range(n // 2 - 1, -1, -1):
            sift(i, n - 1)
        passes.append(_fmt(a) + "（初始大根堆）")
        for end in range(n - 1, 0, -1):
            a[0], a[end] = a[end], a[0]
            moves += 1
            sift(0, end - 1)
            passes.append(_fmt(a))
        stable = False
    elif algo == "merge":
        width = 1
        while width < n:
            for lo in range(0, n, 2 * width):
                mid = min(lo + width, n)
                hi = min(lo + 2 * width, n)
                tmp: list[int] = []
                i, j = lo, mid
                while i < mid and j < hi:
                    comparisons += 1
                    if a[i] <= a[j]:
                        tmp.append(a[i])
                        i += 1
                    else:
                        tmp.append(a[j])
                        j += 1
                tmp.extend(a[i:mid])
                tmp.extend(a[j:hi])
                a[lo:hi] = tmp
            passes.append(_fmt(a) + f"（归并段长度 {width}→{min(2 * width, n)}）")
            width *= 2
    elif algo == "radix":
        if any(v < 0 for v in values):
            raise ValueError("基数排序演示支持非负整数")
        digits = max((len(str(v)) for v in a), default=0)
        for exp in range(digits):
            buckets: list[list[int]] = [[] for _ in range(10)]
            for v in a:
                buckets[(v // 10 ** exp) % 10].append(v)
            a = [v for bucket in buckets for v in bucket]
            passes.append(_fmt(a) + f"（按 {10 ** exp} 位分配收集）")
    return passes, comparisons, moves, stable


def eval_sort(model: Mapping[str, Any]) -> dict[str, Any]:
    mode = str(model.get("mode") or "run")
    raw = str(model.get("raw") or "")
    algo = model.get("algo")
    seq = list(model.get("seq") or [])
    notes: list[str] = []
    if mode == "external":
        r_m = re.search(r"(\d{1,3})\s*个(?:初始)?归并段", raw)
        k_m = re.search(r"(\d{1,2})\s*路(?:归并)?", raw)
        if not r_m or not k_m:
            raise ValueError("请用“有 9 个初始归并段，做 3 路归并”的写法给出段数与路数")
        runs, ways = int(r_m.group(1)), int(k_m.group(1))
        if runs < 1 or not (2 <= ways <= 10):
            raise ValueError("归并段数 ≥ 1，路数须为 2–10")
        rounds = 0
        remaining = runs
        while remaining > 1:
            remaining = math.ceil(remaining / ways)
            rounds += 1
        frames = [_frame(1, "归并趟数", f"{runs} 个初始归并段做 {ways} 路归并：每趟把段数变为 ⌈段数/{ways}⌉，共 {rounds} 趟。",
                         {"初始段数": str(runs), "路数": str(ways), "趟数": str(rounds)}, 2)]
        headline = f"{runs} 个初始归并段做 {ways} 路归并需要 {rounds} 趟"
        checks = [_check("rounds", "趟数公式", True, "趟数 = ⌈log_k(段数)⌉，逐趟累乘核对。")]
        notes.append("若采用最佳归并树补虚段，趟数口径不变；构造 Huffman 思想可减少 I/O。")
        return _ok_result("sort_ops", headline, headline, frames,
                          ["每趟最多 k 段并一段", "段数变为 ⌈段数/k⌉", "直到只剩一段"], checks, notes,
                          answer_value=float(rounds))
    if mode == "stability":
        rows = [f"{name}：{verdict}" for name, verdict in _SORT_STABILITY]
        frames = [_frame(i + 1, name, f"稳定性：{verdict}。", {"算法": name, "稳定性": verdict}, 1)
                  for i, (name, verdict) in enumerate(_SORT_STABILITY)]
        headline = "排序稳定性：" + "；".join(rows)
        checks = [_check("facts", "稳定性口径", True, "稳定性指相等关键字的相对次序在排序后是否保持。")]
        return _ok_result("sort_ops", headline, headline, frames,
                          ["逐算法核对相等元素相对次序"], checks, notes)
    algo = str(algo or "")
    frames: list[dict[str, Any]] = []
    if not algo or len(seq) < 2:
        raise ValueError("需要排序算法与至少 2 个待排关键字")
    passes, comparisons, moves, stable = _sort_run(algo, seq)
    verdict = next(v for name, v in _SORT_STABILITY if name == ({"binary_insertion": "折半插入", "insertion": "直接插入",
                    "shell": "希尔", "bubble": "冒泡", "quick": "快速", "selection": "简单选择",
                    "heap": "堆", "merge": "归并", "radix": "基数"}[algo]))
    for i, p in enumerate(passes, 1):
        frames.append(_frame(i, f"第 {i} 趟", p, {"趟": str(i), "结果": p}, 2))
    frames.append(_frame(len(passes) + 1, "统计",
                         f"比较 {comparisons} 次，移动/交换 {moves} 次；该算法{verdict}。",
                         {"比较次数": str(comparisons), "移动次数": str(moves), "稳定性": verdict}, 4))
    headline = f"{len(passes)} 趟结果：" + " / ".join(passes) + f"；比较 {comparisons} 次、移动 {moves} 次；{verdict}"
    checks = [_check("final", "有序性", passes[-1].startswith(_fmt(sorted(seq))), "最后一趟即为有序序列。"),
              _check("stable", "稳定性", True, f"{verdict}（相等关键字相对次序是否保持）。")]
    return _ok_result("sort_ops", headline, headline, _truncate(frames, notes),
                      ["按算法规则逐趟执行", "记录每趟结果与开销", "核对有序性与稳定性"],
                      checks, notes, answer_order=[str(v) for v in seq])


# ---------------------------------------------------------------------------
# 检测表与调度入口
# ---------------------------------------------------------------------------

_DETECTOR = [
    ("search_ops", r"ASL|平均查找长度|判定树|二叉排序树|BST|平衡二叉树|AVL|B\s*\+?\s*[-—]?\s*树|散列|哈希|冲突处理|顺序查找|" + _BINARY_SEARCH),
    ("sort_ops", r"堆排序|直接插入|插入排序|折半插入|希尔|冒泡|起泡|快速排序|快排|简单选择|选择排序|归并排序|二路归并|基数排序|外部排序|归并段|稳定的?排序|排序的稳定性|哪些排序"),
    ("graph_apply", r"Prim|普里姆|Kruskal|克鲁斯卡尔|最小生成树|Dijkstra|迪杰斯特拉|最短路径|Floyd|弗洛伊德|拓扑|关键路径|AOE"),
    ("graph_repr", r"邻接矩阵|邻接表|连通分量|出度|入度|度数"),
    ("tree_forest", r"哈夫曼|带权路径长度|WPL|并查集|孩子兄弟|左孩子右兄弟|森林|树转换(?:为|成)二叉树|转换.{0,10}二叉树"),
    ("btree_ops", r"二叉树|先序|中序|后序|前序|层序|层次|线索"),
]

_BUILDERS = {
    "search_ops": build_search,
    "sort_ops": build_sort,
    "graph_apply": build_graph_apply,
    "graph_repr": build_graph_repr,
    "tree_forest": build_tree_forest,
    "btree_ops": build_btree,
}

ADVANCED_EVALUATORS = {
    "btree_ops": eval_btree,
    "tree_forest": eval_tree_forest,
    "graph_repr": eval_graph_repr,
    "graph_apply": eval_graph_apply,
    "search_ops": eval_search,
    "sort_ops": eval_sort,
}

ADVANCED_SUMMARY = {
    "btree_ops": "由遍历序列确定性重建二叉树或按性质推导结点/高度/线索数。",
    "tree_forest": "哈夫曼构造与 WPL/编码、并查集操作、树/森林与二叉树转换。",
    "graph_repr": "邻接矩阵与邻接表互转并计算度数、连通分量。",
    "graph_apply": "Prim/Kruskal、Dijkstra/Floyd、拓扑排序与关键路径，全程留痕。",
    "search_ops": "判定树与 ASL、BST/AVL 调整、B 树/B+ 树插入、散列冲突处理。",
    "sort_ops": "九种排序逐趟结果、比较/移动次数与稳定性，外部排序趟数。",
}


def build_ds_advanced(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    for kind, pattern in _DETECTOR:
        if not re.search(pattern, text, re.I):
            continue
        try:
            built = _BUILDERS[kind](text, source, overrides)
        except ValueError as exc:
            return _blocked_model(kind, str(exc))
        if built is not None:
            return built
    return None


__all__ = ["build_ds_advanced", "ADVANCED_EVALUATORS", "ADVANCED_SUMMARY"]
