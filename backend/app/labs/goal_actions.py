"""Classify what the question asks before routing to a computation kernel.

Concept, proof and property questions are rejected with a task-support reason.
They must never be forced into an execution kernel or reported as missing data.
Classification stays conservative: anything unrecognized falls through to the
existing numeric/simulation routing.
"""
from __future__ import annotations

import re

_NEGATED_CLAUSE = re.compile(r'不需要|不用|无需|不必|不求|不研究')

_CONCEPT = (
    r'哪些(?:事件|组件|部件|因素|概念|定义)',
    r'(?:进程|程序)调度(?:程序)?(?:执行|需要)',
    r'调度需要使用',
    r'概念|定义(?!域|区间)|区别|联系|作用|功能|特点|含义|术语',
)

_PROPERTY = (
    r'哪些[^。？?]{0,16}(?:一定成立|不一定成立|可能成立|一定不成立|不可能|必然成立|正确|错误)',
    r'下列(?:说法|关系|叙述)[^。？?]{0,12}(?:正确|错误|成立|不可能)',
    r'以下(?:说法|关系|叙述)[^。？?]{0,12}(?:正确|错误|成立|不可能)',
)

_PROOF = (r'证明|求证|试证',)

_SIMULATE = (r'模拟|执行过程|画出|跟踪|逐步|每一步',)

_COUNT = (r'多少次|次数|计数|几(?:次|个|页|趟)',)


def strip_negated(text: str) -> str:
    # A negated clause states what is NOT required; it must not trigger a rule.
    return '，'.join(clause for clause in re.split(r'[，,。;；]', text)
                    if not _NEGATED_CLAUSE.search(clause))


def classify_goal_action(question: str) -> str:
    text = strip_negated(question or '')
    if any(re.search(pattern, text) for pattern in _PROOF):
        return 'proof'
    if any(re.search(pattern, text) for pattern in _PROPERTY):
        return 'property'
    if any(re.search(pattern, text) for pattern in _CONCEPT):
        return 'concept'
    if any(re.search(pattern, text) for pattern in _COUNT):
        return 'count'
    if any(re.search(pattern, text) for pattern in _SIMULATE):
        return 'simulate'
    return 'numeric'


def task_limit(text: str) -> str:
    """Known kernel limits, not missing source data. No substitute computation."""
    text = strip_negated(text)
    # 哈夫曼/散列已由 ds_advanced 内核支持（哈夫曼构造/编码、散列冲突处理与 ASL）。
    # 循环/递归复杂度已由 ds_analysis 内核支持；仅拒绝无法解析结构的一般程序复杂度分析。
    if '时间复杂度' in text and not re.search(r'循环|递归|for\s*\(|while\s*\(|T\s*\(\s*n\s*\)', text, re.I):
        return '当前内核不支持一般程序或操作的时间复杂度分析。'
    if '偏导' in text:
        return '当前声明式任务未支持隐式多元偏导数，不能替换为单变量求导。'
    if '渐近线' in text or '凹凸' in text:
        return '当前函数研究任务不能完整覆盖凹凸与渐近线目标。'
    if '最短路径' in text and re.search(r'哪些.*一定|一定能', text):
        return '这是算法性质辨析，当前遍历内核只支持给定图的执行，不需要补造节点和边。'
    if '反常积分' in text and re.search(r'正无穷|负无穷|无穷大', text):
        return '当前声明式积分任务仅接受有限端点，不能截断无穷区间。'
    if re.search(r'执行态.*阻塞态|运行态.*阻塞态|调度需要使用', text):
        return '这是操作系统概念辨析，当前执行内核不支持；不需要补充进程运行表。'
    if '弧长' in text:
        return '当前题目内核不支持弧长目标，不能只返回微分方程解。'
    if re.search(r'y\s*\^?[23]|隐函数|由方程', text) and ("y''" in text or '二阶导数' in text) and '微分方程' not in text:
        return '当前高阶导数任务只支持显式函数，不能以隐函数一阶导数或法线替代。'
    return ''


def unsupported_reason(question: str) -> str:
    action = classify_goal_action(question)
    if action == 'concept':
        return '这是概念辨析题，当前执行内核只做数值计算与模拟，不能替代概念判断；原题条件并未缺失。'
    if action == 'property':
        return '这是算法或数据结构的性质判断题，当前内核只支持给定实例的执行，不能证明一般性质；原题条件并未缺失。'
    if action == 'proof':
        return '这是证明题，当前内核没有形式化证明能力；原题条件并未缺失。'
    return task_limit(question)
