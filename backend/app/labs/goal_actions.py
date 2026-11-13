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
    if '哈夫曼' in text or '散列表' in text or '散列函数' in text:
        return '当前内核未支持哈夫曼编码或散列表操作，不能将它改成堆删除或线性方程组。'
    if '堆' in text and '插入' in text:
        return '当前堆内核仅支持删除回放，不支持逐个插入建堆；原题条件并未缺失。'
    if '堆' in text and re.search(r'比较次数|比较.*多少次', text):
        return '当前堆内核未提供指定实现的关键字比较计数，不能用最终堆替代所求。'
    if '时间复杂度' in text:
        return '当前内核不支持一般程序或操作的时间复杂度分析。'
    if '偏导' in text:
        return '当前声明式任务未支持隐式多元偏导数，不能替换为单变量求导。'
    if '渐近线' in text or '凹凸' in text:
        return '当前函数研究任务不能完整覆盖凹凸与渐近线目标。'
    if '折半查找' in text and '比较次数' in text:
        return '当前内核没有折半查找最坏比较次数任务，原题不是缺少具体数组。'
    if '最短路径' in text and re.search(r'哪些.*一定|一定能', text):
        return '这是算法性质辨析，当前BFS内核只支持给定图的执行，不需要补造节点和边。'
    if '反常积分' in text and re.search(r'正无穷|负无穷|无穷大', text):
        return '当前声明式积分任务仅接受有限端点，不能截断无穷区间。'
    if re.search(r'执行态.*阻塞态|运行态.*阻塞态|调度需要使用', text):
        return '这是操作系统概念辨析，当前执行内核不支持；不需要补充进程运行表。'
    if re.search(r'LRU|页面|页框', text, re.I) and re.search(r'已调入内存|初始(?:状态)?(?:非空|不为空)', text):
        return '原题给定非空初态，当前页面内核仅支持空初态；不能丢弃初始页面。'
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
