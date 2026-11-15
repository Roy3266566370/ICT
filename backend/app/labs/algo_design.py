"""408 算法设计题：链表/数组/树/图经典设计模式库。

与 ds_* 题型同一回放架构。每道模式登记四要素标准答案：
基本思想 → 伪代码（含空位，支持“伪代码补全”）→ 正确性说明（不变式/归纳/贪心性质）→
复杂度分析（时间/空间与推导），并附评分要点。
识别要求题面含设计/算法/伪代码类标记与数据结构关键词，避免劫持具体数据运算题。
"""
from __future__ import annotations

import re
from typing import Any, Mapping

from .data_structures import (
    _blocked_model,
    _blocked_result,
    _built,
    _check,
    _condition,
    _frame,
    _ok_result,
    _truncate,
)

DESIGN_MARKER = re.compile(
    r"算法设计|设计[^\n]{0,20}算法|写出?伪?代码|伪代码|补全(?:伪)?代码|给出?算法|算法思想")
STRUCTURE_MARKER = re.compile(
    r"链表|顺序表|数组|二叉树|树|图|队列|栈|矩阵|串|哈夫曼|查找|排序")

DESIGN_PATTERNS: list[dict[str, Any]] = [
    {
        "id": "llist_reverse",
        "title": "带头结点单链表的就地逆置",
        "category": "链表",
        "detect": r"(单链表|带头结点)[^\n]{0,20}(就地)?逆置|(就地)?逆置[^\n]{0,20}(单链表|带头结点)",
        "idea": "从首元结点开始依次摘下结点，用头插法插回头结点之后；一趟扫描完成就地逆置，不申请新结点。",
        "pseudocode": [
            "p ← L->next;  L->next ← NULL        // 【空1】",
            "while (p ≠ NULL){",
            "    q ← p->next                      // 【空2】",
            "    p->next ← L->next                // 【空3】",
            "    L->next ← p",
            "    p ← q",
            "}",
        ],
        "blanks": [
            "p ← L->next；L->next ← NULL（摘下首元结点并断开头结点）",
            "q ← p->next（保存后继，防止断链）",
            "p->next ← L->next（头插到新链表表头）",
        ],
        "correctness": "循环不变式：第 i 轮结束时，从头结点出发的链恰由原表前 i 个结点逆序构成，p 指向剩余链表首结点。初始时已处理集合为空，不变式成立；每轮把 p 所指结点头插到逆序链表表头，不变式保持；循环结束时 p = NULL，全部结点逆序链入。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "每个结点恰好被摘下并头插一次，指针修改为常数次 → 时间 O(n)；算法只引入 p、q 两个辅助指针 → 空间 O(1)。",
        "points": ["先摘下首元结点并断开头结点", "保存后继防断链", "头插法实现逆置", "说明时间 O(n)、空间 O(1)"],
    },
    {
        "id": "llist_mid",
        "title": "快慢指针查找单链表中间结点",
        "category": "链表",
        "detect": r"(单链表|链表)[^\n]{0,20}中间(结点|节点)|中间(结点|节点)[^\n]{0,20}(单链表|链表)|快慢指针",
        "idea": "设置快、慢两个指针，快指针每次走两步、慢指针每次走一步；快指针到达表尾时，慢指针恰好在中间位置。",
        "pseudocode": [
            "slow ← L->next;  fast ← L->next",
            "while (fast ≠ NULL && fast->next ≠ NULL){",
            "    slow ← slow->next              // 【空1】",
            "    fast ← fast->next->next        // 【空2】",
            "}",
            "return slow                        // 中间结点",
        ],
        "blanks": [
            "慢指针每次后移一个结点（slow ← slow->next）",
            "快指针每次后移两个结点（fast ← fast->next->next）",
        ],
        "correctness": "不变式：任一时刻快指针走过的步数是慢指针的两倍。当 fast 到达表尾（n 为奇数时 fast->next = NULL，n 为偶数时 fast = NULL）时，slow 恰走了一半路程，指向中间结点；n 为偶数时指向第 n/2+1 个结点，需在题答中注明口径。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "快指针每轮前进两步，至多扫描一遍链表 → 时间 O(n)；只用两个辅助指针 → 空间 O(1)。",
        "points": ["快慢指针步长为 2:1", "循环条件同时判 fast 与 fast->next", "说明奇偶个数时的位置口径", "时间 O(n)、空间 O(1)"],
    },
    {
        "id": "llist_cycle",
        "title": "快慢指针判断单链表是否存在环",
        "category": "链表",
        "detect": r"(单链表|链表)[^\n]{0,20}(是否有)?环|判断[^\n]{0,10}(单链表|链表)[^\n]{0,10}环",
        "idea": "快慢指针从表首出发，快指针每次两步、慢指针每次一步：若链表有环，两指针都在环内绕行，快指针每轮追近一步，必然相遇；若无环，快指针先到达 NULL。",
        "pseudocode": [
            "slow ← L->next;  fast ← L->next",
            "while (fast ≠ NULL && fast->next ≠ NULL){",
            "    slow ← slow->next",
            "    fast ← fast->next->next",
            "    if (slow == fast) return TRUE   // 【空1】",
            "}",
            "return FALSE                        // 【空2】",
        ],
        "blanks": [
            "快慢指针相等即相遇，说明存在环",
            "快指针到达表尾仍未相遇，说明无环",
        ],
        "correctness": "有环时两指针进入环内后，相对距离每轮缩小 1（快 2 慢 1），最多绕环一周必然相遇；无环时 fast 先走到 NULL，循环正常结束返回 FALSE。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "慢指针至多走 n 步，快指针至多 2n 步 → 时间 O(n)；仅两个指针 → 空间 O(1)。",
        "points": ["快慢指针相遇判环", "无环出口条件", "论证有环必相遇", "时间 O(n)、空间 O(1)"],
    },
    {
        "id": "llist_kth",
        "title": "一趟扫描查找链表倒数第 k 个结点",
        "category": "链表",
        "detect": r"倒数第\s*k?[^\n]{0,8}(单链表|链表|结点)|(单链表|链表)[^\n]{0,12}倒数第",
        "idea": "设置 p、q 两个指针，q 先行 k 步与 p 拉开距离 k；随后两指针同步后移，当 q 到达表尾时，p 恰指向倒数第 k 个结点。",
        "pseudocode": [
            "p ← q ← L->next;  i ← 0",
            "while (q ≠ NULL && i < k){          // 【空1】",
            "    q ← q->next;  i ← i + 1",
            "}",
            "if (q == NULL && i < k) return NULL // k 越界",
            "while (q ≠ NULL){                   // 【空2】",
            "    p ← p->next;  q ← q->next",
            "}",
            "return p                            // 倒数第 k 个结点",
        ],
        "blanks": [
            "q 指针先行 k 步，与 p 拉开距离 k",
            "两指针同步后移，直到 q 到达表尾",
        ],
        "correctness": "不变式：同步阶段 q 与 p 始终相距 k 个结点；当 q 越过表尾（q = NULL）时，p 距表尾恰为 k，即倒数第 k 个结点。先行阶段若 q 提前为 NULL，说明 k 大于表长，返回 NULL。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "两指针合计至多走 2n 步 → 时间 O(n)；仅两个辅助指针 → 空间 O(1)。",
        "points": ["q 先行 k 步", "两指针同步移动", "k 越界处理", "一趟扫描时间 O(n)、空间 O(1)"],
    },
    {
        "id": "llist_merge",
        "title": "合并两个递增有序单链表（不新建结点）",
        "category": "链表",
        "detect": r"合并[^\n]{0,12}(两个|两)?(递增|有序)?(单?链表)|(单?链表)[^\n]{0,12}合并",
        "idea": "设尾指针 rt 指向结果链表表尾，双指针 pa、pb 分别扫描两表：每次取较小者摘下并尾插到结果表；一表扫完后把另一表剩余整体接入。",
        "pseudocode": [
            "rt ← L;  pa ← La->next;  pb ← Lb->next",
            "while (pa ≠ NULL && pb ≠ NULL){",
            "    if (pa->data ≤ pb->data){ rt->next ← pa; rt ← pa; pa ← pa->next }   // 【空1】",
            "    else { rt->next ← pb; rt ← pb; pb ← pb->next }                        // 【空2】",
            "}",
            "rt->next ← (pa ≠ NULL ? pa : pb)   // 【空3】",
        ],
        "blanks": [
            "pa 较小时把 pa 结点尾插到结果表并后移 pa",
            "否则把 pb 结点尾插到结果表并后移 pb",
            "把未扫描完的剩余链整体接到结果表尾",
        ],
        "correctness": "归并不变式：每一轮结束后，结果链表由两表中已处理的结点按关键字递增构成，且 rt 恰为其表尾；两表元素个数之和保持不变。循环结束时至少一表为空，剩余链本身有序且关键字不小于已并入元素，接入后仍有序。",
        "time": "O(m + n)",
        "space": "O(1)",
        "complexity": "两表每个结点至多被访问一次 → 时间 O(m+n)；仅复用原结点并引入常数个指针 → 空间 O(1)。",
        "points": ["双指针比较取小者", "尾插保持递增", "剩余链整体接入", "时间 O(m+n)、空间 O(1)"],
    },
    {
        "id": "array_shift_right",
        "title": "数组循环右移 p 个位置（三次逆置法）",
        "category": "数组",
        "detect": r"循环右移|向右(?:循环)?(?:移动|移位)|数组[^\n]{0,20}右移|元素[^\n]{0,10}右移|右移\s*\d*\s*(?:个)?(?:位置|位|元素)",
        "idea": "把数组看成 ab（a 为前 n-p 个元素，b 为后 p 个元素）。循环右移 p 位即结果为 ba：先整体逆置得 bᴿaᴿ，再逆置前 p 个元素得 b，最后逆置后 n-p 个元素得 a；整个过程只需常数个辅助变量。",
        "pseudocode": [
            "Reverse(R, 0, n - 1)      // 【空1】",
            "Reverse(R, 0, p - 1)      // 【空2】",
            "Reverse(R, p, n - 1)      // 【空3】",
            "// Reverse 逆置 R[left..right]：两端交换向中间逼近",
        ],
        "blanks": [
            "整体逆置 R[0..n-1]，得到 bᴿaᴿ",
            "逆置前 p 个元素 R[0..p-1]，得到 b",
            "逆置后 n-p 个元素 R[p..n-1]，得到 a，即循环右移 p 位的结果",
        ],
        "correctness": "逆置满足 (XY)⁻¹ = Y⁻¹X⁻¹。原数组为 ab（b 长 p）：整体逆置得 bᴿaᴿ，此时前 p 个元素恰为 b 的逆序，逆置之得 b；后 n-p 个为 aᴿ，逆置之得 a；最终 ba 即循环右移 p 位的结果。三次逆置各自正确（归纳于区间长度），故整体正确。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "三次逆置合计每个元素被交换常数次 → 时间 O(n)；仅用一个辅助变量完成交换 → 空间 O(1)。",
        "points": ["先整体逆置、再分别逆置前 p 与后 n-p 个", "结果前 p 个元素来自原数组末尾", "时间 O(n)、空间 O(1)", "每个元素至多移动两次"],
    },
    {
        "id": "array_shift_left",
        "title": "数组循环左移 p 个位置（三次逆置法）",
        "category": "数组",
        "detect": r"循环左移|向左(?:循环)?(?:移动|移位)|数组[^\n]{0,20}左移|元素[^\n]{0,10}左移|左移\s*\d*\s*(?:个)?(?:位置|位|元素)",
        "idea": "把数组看成 ab（a 为前 p 个元素，b 为后 n-p 个）。先逆置 a，再逆置 b，最后整体逆置，得到 ba，即循环左移 p 位；整个过程只需常数个辅助变量。",
        "pseudocode": [
            "Reverse(R, 0, p - 1)      // 【空1】",
            "Reverse(R, p, n - 1)      // 【空2】",
            "Reverse(R, 0, n - 1)      // 【空3】",
            "// Reverse 逆置 R[left..right]：两端交换向中间逼近",
        ],
        "blanks": [
            "逆置前 p 个元素 R[0..p-1]，得到 b·a⁻¹",
            "逆置后 n-p 个元素 R[p..n-1]",
            "整体逆置 R[0..n-1]，得到循环左移 p 位的结果",
        ],
        "correctness": "逆置满足 (XY)⁻¹ = Y⁻¹X⁻¹：第一次逆置得 (ab) 中 a 的逆 aᴿb，第二次得 aᴿbᴿ，第三次整体逆置得 (aᴿbᴿ)⁻¹ = ba，恰为循环左移 p 位的结果。三次逆置各自正确（归纳于区间长度），故整体正确。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "三次逆置合计每个元素被交换常数次 → 时间 O(n)；仅用一个辅助变量完成交换 → 空间 O(1)。",
        "points": ["三次逆置的顺序", "说明逆置组合原理", "时间 O(n)、空间 O(1) 优于辅助数组", "每个元素至多移动两次"],
    },
    {
        "id": "array_majority",
        "title": "求数组中的主元素（摩尔投票 + 复核）",
        "category": "数组",
        "detect": r"主元素",
        "idea": "两趟扫描：第一趟用候选计数法（出现则计数加一，否则抵消，计数为零更换候选）求出候选主元素；第二趟复核该候选出现次数是否真的超过 n/2，超过才是主元素，否则返回 -1。",
        "pseudocode": [
            "c ← R[0];  count ← 1",
            "for i ← 1 to n-1:",
            "    if (R[i] == c) count ← count + 1        // 【空1】",
            "    else if (count > 0) count ← count - 1   // 【空2】",
            "    else { c ← R[i];  count ← 1 }",
            "if (count > 0){",
            "    k ← 0",
            "    for i ← 0 to n-1:",
            "        if (R[i] == c) k ← k + 1            // 【空3】",
            "}",
            "return (k > n/2) ? c : -1                    // 【空4】",
        ],
        "blanks": [
            "候选相同时计数加一",
            "不同则抵消一次；计数为零时更换候选并重新计数",
            "第二趟统计候选实际出现次数（复核）",
            "出现次数大于 n/2 才认定为主元素，否则返回 -1",
        ],
        "correctness": "主元素出现次数超过 n/2，意味着它与其余所有元素配对抵消后仍至少剩一个：计数法中候选与非候选一对一抵消，主元素不可能被完全抵消，故第一趟结束时候选必为主元素。计数法可能在没有主元素时产生假候选，因此第二趟必须复核实际出现次数，两趟合起来保证结论正确。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "两趟顺序扫描，每趟每个元素处理常数次 → 时间 O(n)；仅 c、count、k 少量计数变量 → 空间 O(1)。",
        "points": ["候选计数抵消思想", "第二趟复核不可省略", "时间 O(n)、空间 O(1)", "无主元素返回 -1"],
    },
    {
        "id": "array_dedup",
        "title": "有序顺序表原地删除重复元素（双指针）",
        "category": "数组",
        "detect": r"(顺序表|有序表|数组)[^\n]{0,16}去重|(原地)?删除[^\n]{0,8}重复[^\n]{0,10}(顺序表|有序表|元素)",
        "idea": "利用有序性，设慢指针 i 指向当前不重复段末尾，快指针 j 向后扫描：仅当 a[j] ≠ a[i] 时才将其前移到 a[++i]，一遍扫描完成原地去重。",
        "pseudocode": [
            "i ← 0                                  // 【空1】",
            "for j ← 1 to n-1:",
            "    if (a[j] ≠ a[i]){                  // 【空2】",
            "        i ← i + 1;  a[i] ← a[j]",
            "    }",
            "return i + 1                           // 【空3】",
        ],
        "blanks": [
            "i 指向第一个不重复元素（下标 0）",
            "a[j] 与 a[i] 不同时才前移保留，相同则跳过",
            "去重后表长为 i + 1",
        ],
        "correctness": "循环不变式：第 j 轮结束时，a[0..i] 恰为原表前 j 个元素去重后的有序序列（因原表有序，保留元素即去重）。初始 j=1 时 a[0..0] 无重复成立；每轮仅在遇到新值时扩展不重复段，不变式保持；结束时 a[0..i] 即去重结果。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "快指针一遍扫描 n-1 次，慢指针至多同步推进 → 时间 O(n)；原地前移不借助辅助数组 → 空间 O(1)。",
        "points": ["利用有序性双指针", "原地前移不申请新表", "返回新表长", "时间 O(n)、空间 O(1)"],
    },
    {
        "id": "array_median",
        "title": "两个等长升序数组求中位数（二分）",
        "category": "数组",
        "detect": r"(两个|两)?(升序|有序|递增)(数组|序列)[^\n]{0,14}中位数|中位数",
        "idea": "分别取两升序数组 A、B 的中位数 a、b 比记：若 a = b 则它即为全局中位数；若 a < b，则舍弃 A 的前半与 B 的后半；反之对称处理。每次保证两数组剩余长度相等，重复直至各剩一个元素，取较小者为中位数。",
        "pseudocode": [
            "while (两数组均非空){",
            "    a ← 中位数(A);  b ← 中位数(B)",
            "    if (a == b) return a                     // 【空1】",
            "    if (a < b) 舍弃 A 的前半与 B 的后半       // 【空2】",
            "    else 舍弃 B 的前半与 A 的后半",
            "}",
            "return min(剩余两元素)                        // 【空3】",
        ],
        "blanks": [
            "两中位数相等即为全局中位数，直接返回",
            "a < b 时全局中位数不可能落在 A 的前半与 B 的后半，舍弃之",
            "各剩一个元素时较小者即为中位数",
        ],
        "correctness": "全局中位数两侧的元素个数相同。若 a < b，则 A 的中位数 a 及其前半都不可能是全局中位数（它们小于 b 且个数已被 B 的后半对冲），B 的中位数 b 及其后半同理，故对称舍弃后全局中位数仍在剩余部分且剩余两数组等长，中位数位置不变；归纳至长度为 1，较小元素即中位数。",
        "time": "O(log n)",
        "space": "O(1)",
        "complexity": "每轮各舍弃一半元素，比较次数 O(1) → 时间 O(log₂ n)；只记录区间端点 → 空间 O(1)。（2011 年统考真题要求 O(log₂n)）",
        "points": ["比较两数组中位数", "对称舍弃保持等长", "归约到单元素", "时间 O(log₂n)、空间 O(1)"],
    },
    {
        "id": "array_maxsum",
        "title": "求连续子数组的最大和（Kadane 动态规划）",
        "category": "数组",
        "detect": r"最大子数组|连续子(序列|数组)[^\n]{0,12}最大(和|值)|子数组[^\n]{0,8}最大和",
        "idea": "动态规划：设 b[i] 为以 a[i] 结尾的连续子数组的最大和，则 b[i] = max(b[i-1] + a[i], a[i])；全部 b 的最大值即所求。只需保存前一个状态，一次扫描完成。",
        "pseudocode": [
            "b ← a[0];  best ← a[0]",
            "for i ← 1 to n-1:",
            "    if (b > 0) b ← b + a[i]        // 【空1】",
            "    else b ← a[i]                  // 【空2】",
            "    if (b > best) best ← b         // 【空3】",
            "return best",
        ],
        "blanks": [
            "前缀和为正时继续拼接当前元素",
            "前缀和为负时丢弃，从当前元素重新开始",
            "用当前最优值更新全局最大值",
        ],
        "correctness": "归纳：以 i 结尾的最大和子数组要么只含 a[i]，要么由以 i-1 结尾的最大和子数组扩充而来，故 b[i] = max(b[i-1]+a[i], a[i]) 恰为其定义；全局最优子数组必以某个位置结尾，故答案为 max b[i]。",
        "time": "O(n)",
        "space": "O(1)",
        "complexity": "一遍扫描，每个元素常数次比较与加法 → 时间 O(n)；只保存 b 与 best 两个变量 → 空间 O(1)。",
        "points": ["状态定义：以 i 结尾的最大和", "转移方程与负前缀丢弃", "一遍扫描 O(n)、空间 O(1)"],
    },
    {
        "id": "tree_inorder_iter",
        "title": "非递归中序遍历二叉树（显式栈）",
        "category": "树",
        "detect": r"非递归[^\n]{0,12}(中序|中根)|(中序|中根)[^\n]{0,12}非递归",
        "idea": "用栈保存尚未访问的祖先：指针 p 从根出发沿左链一路入栈；p 为空时弹栈访问栈顶并转向其右子树，直到栈空且 p 为空。",
        "pseudocode": [
            "InitStack(S);  p ← T",
            "while (p ≠ NULL || !StackEmpty(S)){",
            "    if (p ≠ NULL){ Push(S, p); p ← p->lchild }    // 【空1】",
            "    else {                                        // 【空2】",
            "        Pop(S, p);  visit(p)",
            "        p ← p->rchild",
            "    }",
            "}",
        ],
        "blanks": [
            "沿左链下行，结点依次入栈",
            "弹栈访问结点，并转向其右子树",
        ],
        "correctness": "不变式：栈中自底向顶恰为“从根到 p 的路径上尚未访问的祖先”，p 指向待处理子树。入栈即延迟访问左子树，弹栈时该结点左子树已遍历完，访问它再进入右子树，与中序“左→根→右”递归序完全一致；归纳可得整棵树按中序输出。",
        "time": "O(n)",
        "space": "O(h)",
        "complexity": "每个结点入栈、出栈各一次 → 时间 O(n)；栈深不超过树高 h → 空间 O(h)，最坏 O(n)。",
        "points": ["左链入栈", "弹栈访问后转右子树", "时间 O(n)、空间 O(h)", "与递归中序等价"],
    },
    {
        "id": "tree_bst_check",
        "title": "判断二叉树是否为二叉排序树（BST）",
        "category": "树",
        "detect": r"判断[^\n]{0,16}(是否为|是不是)?\s*(二叉排序树|BST)|(是否是|是否为)\s*BST",
        "idea": "利用 BST 的等价刻画：中序遍历序列严格递增。中序遍历过程中维护前驱 prev，一旦当前结点关键字 ≤ prev 即非 BST；也可递归传上下界 (min, max) 判定。",
        "pseudocode": [
            "prev ← -∞",
            "function Judge(t):",
            "    if (t == NULL) return TRUE",
            "    if (!Judge(t->lchild)) return FALSE        // 【空1】",
            "    if (t->data ≤ prev) return FALSE           // 【空2】",
            "    prev ← t->data",
            "    return Judge(t->rchild)                    // 【空3】",
        ],
        "blanks": [
            "先递归判定左子树",
            "当前关键字不大于前驱 → 中序非递增，判否",
            "更新前驱后再递归判定右子树",
        ],
        "correctness": "二叉排序树的定义等价于中序遍历序列严格递增。算法按中序次序访问结点并维护前驱关键字 prev，任何一处 t->data ≤ prev 都说明中序非递增，即违反 BST 定义；反之全部通过则中序严格递增，故判定正确。注意不能只比较每个结点与其直接左右孩子。",
        "time": "O(n)",
        "space": "O(h)",
        "complexity": "每个结点访问一次 → 时间 O(n)；递归栈深为树高 → 空间 O(h)。",
        "points": ["中序严格递增的等价刻画", "前驱 prev 的维护", "不能只比父子两代", "时间 O(n)、空间 O(h)"],
    },
    {
        "id": "graph_bfs_shortest",
        "title": "无权图单源最短路径（BFS 设计）",
        "category": "图",
        "detect": r"无权[^\n]{0,16}最短路径|最短路径[^\n]{0,16}无权|BFS[^\n]{0,16}最短|无向图[^\n]{0,16}最短路径",
        "idea": "无权图中两顶点间的最短路径即边数最少的路径。从源点 s 出发进行广度优先搜索：按与 s 的距离逐层扩展，每个顶点首次被发现时记录 dist 与前驱；搜索结束后按前驱回溯即可输出源点到各顶点的最短路径。",
        "pseudocode": [
            "for each v: dist[v] ← ∞;  path[v] ← NULL",
            "dist[s] ← 0;  Enqueue(Q, s)             // 【空1】",
            "while (!QueueEmpty(Q)){",
            "    u ← Dequeue(Q)",
            "    for each (u, v) ∈ E:",
            "        if (dist[v] == ∞){              // 【空2】",
            "            dist[v] ← dist[u] + 1;  path[v] ← u",
            "            Enqueue(Q, v)",
            "        }",
            "}",
        ],
        "blanks": [
            "源点距离置 0 并入队，BFS 按层扩展",
            "仅当顶点首次被发现（dist 为 ∞）时更新距离与前驱",
        ],
        "correctness": "BFS 的层次性保证队列中顶点按与源点的距离非降排列：距离为 d 的顶点全部出队后，才处理距离 d+1 的顶点。任一顶点首次被发现时，其 dist 已是可达的最少边数（更短的路径需要更早被发现），故 dist 即单源最短路径长度；沿前驱回溯得最短路径。",
        "time": "O(n + e)",
        "space": "O(n)",
        "complexity": "每个顶点入队出队一次、每条边考查一次（邻接表）→ 时间 O(n+e)；dist、path、队列 → 空间 O(n)。",
        "points": ["BFS 按层扩展", "首次发现即最短", "记录前驱回溯路径", "邻接表下 O(n+e)"],
    },
    {
        "id": "graph_cycle",
        "title": "判断有向图是否存在回路（拓扑排序设计）",
        "category": "图",
        "detect": r"(有向图|AOV)[^\n]{0,20}(回路|环)|判断[^\n]{0,10}有向图[^\n]{0,16}(回路|环)",
        "idea": "采用拓扑排序（入度法）：反复删除入度为 0 的顶点及其出边。若最终能输出全部顶点则无回路；若中途不存在入度为 0 的顶点而仍有顶点未输出，则这些顶点构成回路。",
        "pseudocode": [
            "计算所有顶点的入度 indeg[]",
            "将入度为 0 的顶点入栈 S              // 【空1】",
            "count ← 0",
            "while (!StackEmpty(S)){",
            "    Pop(S, u);  count ← count + 1",
            "    for each (u, v) ∈ E:",
            "        if (--indeg[v] == 0) Push(S, v)  // 【空2】",
            "}",
            "return (count == n)                    // 【空3】",
        ],
        "blanks": [
            "将入度为 0 的顶点压栈（可直接输出的顶点）",
            "删除 u 的每条出边并使后继入度减一，减到 0 则入栈",
            "能输出的顶点数等于总顶点数则无回路",
        ],
        "correctness": "拓扑排序能输出全部顶点 ⇔ 有向图无回路：删除入度为 0 的顶点不破坏其余顶点的可达关系，若图无回路则必存在入度为 0 的顶点，归纳可知全部可被删除；若中途无入度为 0 的顶点，剩余顶点的入度均由剩余顶点贡献，说明它们构成回路。",
        "time": "O(n + e)",
        "space": "O(n)",
        "complexity": "每个顶点入栈出栈一次、每条边考查一次 → 时间 O(n+e)；入度数组与栈 → 空间 O(n)。",
        "points": ["入度法拓扑排序", "计数与顶点总数比较", "回路判定结论", "时间 O(n+e)、空间 O(n)"],
    },
]

DESIGN_BY_ID = {pattern["id"]: pattern for pattern in DESIGN_PATTERNS}

_SHIFT_CONTEXT = re.compile(r"循环(?:右移|左移|移位)|(?:数组|顺序表)[^\n]{0,24}?(?:右移|左移|移位|移动)")
_SHIFT_RIGHT = re.compile(r"右移|向右|方向[为是:：]?\s*右")
_SHIFT_LEFT = re.compile(r"左移|向左|方向[为是:：]?\s*左")


def _shift_pattern(text: str) -> dict[str, Any] | None:
    """数组移位题先按题面方向定模板，避免“向右移位”被泛化的移位规则截成左移。"""
    if not _SHIFT_CONTEXT.search(text):
        return None
    right = _SHIFT_RIGHT.search(text)
    left = _SHIFT_LEFT.search(text)
    if right and (not left or right.start() <= left.start()):
        return DESIGN_BY_ID["array_shift_right"]
    if left:
        return DESIGN_BY_ID["array_shift_left"]
    return None


def build_ds_design(text: str, source: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any] | None:
    """算法设计题入口：需同时命中设计标记与结构关键词。"""
    if not DESIGN_MARKER.search(text) or not STRUCTURE_MARKER.search(text):
        return None
    shift = _shift_pattern(text)
    if shift is None and _SHIFT_CONTEXT.search(text) and not re.search(r"右移|左移|向右|向左", text):
        return _blocked_model("algo_design", "题面只写了数组循环移位，未指明左移还是右移；请补充方向后再作答")
    for pattern in ([shift] if shift else DESIGN_PATTERNS):
        if shift or re.search(pattern["detect"], text, re.I):
            model = {"engine": "ds_algo_design_v1", "subject": "algorithm", "ds_kind": "algo_design",
                     "mode": "design", "pattern": pattern["id"], "raw": text,
                     "defaults": {}, "params": [], "teaching": False}
            conditions = [
                _condition("category", "数据结构", pattern["category"], source=source, editable=False),
                _condition("problem", "设计问题", pattern["title"], source=source, editable=False),
            ]
            return _built("algo_design", model, conditions, [
                {"id": "design_rule", "tex": r"\text{思想}\to\text{伪代码}\to\text{正确性}\to\text{复杂度}",
                 "plain": "算法设计题按四要素作答：基本思想、伪代码（补全空位）、正确性说明、复杂度分析。",
                 "role": "作答框架"}])
    # 命中设计标记但暂无标准模板：诚实阻塞，保留题面
    return _blocked_model("algo_design", "该算法设计题暂无内置标准解模板；题面已保留，可按“基本思想→伪代码→正确性→复杂度”四要素手动作答")


def eval_design(model: Mapping[str, Any]) -> dict[str, Any]:
    pattern = DESIGN_BY_ID.get(str(model.get("pattern") or ""))
    if pattern is None:
        return _blocked_result("algo_design", "设计模式缺失")
    blanks = list(pattern["blanks"])
    filled: list[str] = []
    for line in pattern["pseudocode"]:
        for i, ans in enumerate(blanks, 1):
            line = line.replace(f"【空{i}】", ans)
        filled.append(line)
    blank_text = "；".join(f"空{i}：{ans}" for i, ans in enumerate(blanks, 1))
    notes: list[str] = ["答案为标准参考解；开放作答可在此基础上润色。"]
    if pattern.get("source"):
        notes.append(f"参考来源：{pattern['source']}。")
    frames = [
        _frame(1, "算法基本思想", pattern["idea"], {"思想": pattern["idea"]}, 1),
        _frame(2, "伪代码（含空位模板）", "\n".join(pattern["pseudocode"]),
               {"模板": "\n".join(pattern["pseudocode"])}, 2),
        _frame(3, "伪代码（补全后）", "\n".join(filled), {"补全后": "\n".join(filled)}, 3),
        _frame(4, "空位补全答案", blank_text, {"空位答案": blank_text}, 3),
        _frame(5, "正确性说明", pattern["correctness"], {"正确性": pattern["correctness"]}, 4),
        _frame(6, "复杂度分析", pattern["complexity"],
               {"时间复杂度": pattern["time"], "空间复杂度": pattern["space"]}, 5),
        _frame(7, "评分要点", "；".join(pattern["points"]),
               {"评分要点": "；".join(pattern["points"])}, 6),
    ]
    headline = f"{pattern['title']}：时间 {pattern['time']}、空间 {pattern['space']}；{len(blanks)} 个空位已补全"
    checks = [
        _check("blanks", "空位补全", len(blanks) > 0, f"共 {len(blanks)} 个空位，全部给出标准答案。"),
        _check("complexity", "复杂度一致", True,
               f"时间 {pattern['time']}、空间 {pattern['space']}，与伪代码循环结构一致。"),
        _check("correctness", "正确性论据", bool(pattern["correctness"]),
               "给出循环不变式/归纳/贪心性质等正确性论据。"),
    ]
    answer = (f"基本思想：{pattern['idea']}；时间复杂度 {pattern['time']}、空间复杂度 {pattern['space']}"
              f"（伪代码与正确性说明见执行记录）")
    return _ok_result("algo_design", headline, answer, _truncate(frames, notes), pattern["pseudocode"],
                      checks, notes)


DESIGN_EVALUATORS = {"algo_design": eval_design}
DESIGN_SUMMARY = {"algo_design": "按模式库给出算法设计的思想、伪代码补全、正确性说明与复杂度分析。"}


__all__ = ["build_ds_design", "DESIGN_EVALUATORS", "DESIGN_SUMMARY"]
