"""数据结构模板：栈/队列、冒泡/插入排序。"""

from __future__ import annotations

from ..recognition_types import ConditionSet, MatchDecision, TemplateDescriptor, TemplateParameterSpec
from ..types import InteractionOption, Region, SourceSnapshot
from .base import make_option

STACK_QUEUE = TemplateDescriptor(
    template_id="data_structures.stack_queue",
    version="1.0",
    operator_id="data_structures.stack_queue",
    renderer="stack_queue",
    title="栈与队列",
    categories=("data_structure", "algorithm"),
    description="按明确的初始序列与操作序列单步执行；报告空栈、空队列与容量问题。",
    aliases=("栈", "队列", "stack", "queue", "push", "pop", "enqueue", "dequeue"),
    keywords=("栈", "队列", "stack", "queue", "push", "pop", "enqueue", "dequeue", "入栈", "出栈"),
    formula_patterns=(r"(?:push|pop|enqueue|dequeue)\s*-?\d+",),
    negative_keywords=("排序", "最小二乘", "卷积"),
    required_conditions=("operations",),
    parameter_specs=(
        TemplateParameterSpec(
            name="mode",
            label="结构",
            type="enum",
            required=False,
            default="stack",
            options=["stack", "queue"],
            source_keys=("mode",),
            needs_review_on_default=False,
        ),
        TemplateParameterSpec(
            name="initial",
            label="初始序列",
            type="number_list",
            required=True,
            default=None,
            source_keys=("initial",),
            description="按从左到右的顺序保存。",
        ),
        TemplateParameterSpec(
            name="operations",
            label="操作序列",
            type="string",
            required=True,
            default=None,
            source_keys=("operations",),
            description="分号分隔，如 push 2; pop; enqueue 1。",
        ),
        TemplateParameterSpec(
            name="capacity",
            label="容量",
            type="integer",
            required=False,
            default=8,
            min=1,
            max=64,
            step=1,
            source_keys=("capacity",),
            needs_review_on_default=False,
        ),
    ),
    views=(("table", "单步执行轨迹"), ("metrics", "最终状态与错误"), ("text", "原稿依据")),
    examples=("初始栈 [3,1,4]；操作 push 2; pop", "队列 enqueue 9; dequeue"),
    eval_cases=("stack_basic", "queue_basic", "stack_missing_ops"),
)

SORTING = TemplateDescriptor(
    template_id="data_structures.sorting",
    version="1.0",
    operator_id="data_structures.sorting",
    renderer="sorting",
    title="基础排序",
    categories=("data_structure", "algorithm"),
    description="冒泡/插入排序，最多 32 个元素；比较次数与元素移动次数使用固定口径。",
    aliases=("冒泡排序", "插入排序", "bubble sort", "insertion sort", "排序"),
    keywords=("冒泡", "插入排序", "bubble", "insertion", "排序", "升序", "降序"),
    formula_patterns=(r"\[\s*-?\d+(?:\s*,\s*-?\d+)+\s*\]",),
    negative_keywords=("栈", "队列", "最小二乘"),
    required_conditions=("values", "algorithm"),
    parameter_specs=(
        TemplateParameterSpec(
            name="values",
            label="待排序列表",
            type="number_list",
            required=True,
            default=None,
            source_keys=("values",),
            description="最多 32 个有限数值。",
        ),
        TemplateParameterSpec(
            name="algorithm",
            label="排序算法",
            type="enum",
            required=True,
            default="bubble",
            options=["bubble", "insertion"],
            source_keys=("algorithm",),
            needs_review_on_default=True,
        ),
    ),
    views=(("table", "排序单步"), ("metrics", "比较与移动次数"), ("text", "原稿依据")),
    examples=("对 [5,1,4,2,8] 执行冒泡排序", "输入 [9,3,7,1] 做插入排序"),
    eval_cases=("bubble_basic", "insertion_basic", "sorting_missing_algorithm"),
)


def build_stack_queue(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=STACK_QUEUE,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="用同一份初始序列和操作序列单步执行，空结构与容量问题明确显示。",
    )


def build_sorting(decision: MatchDecision, condition_set: ConditionSet, region: Region, snapshot: SourceSnapshot) -> InteractionOption:
    return make_option(
        descriptor=SORTING,
        decision=decision,
        condition_set=condition_set,
        region=region,
        snapshot=snapshot,
        provider={},
        purpose="展示每一次比较/移动后的列表，比较次数口径固定为元素比较次数。",
    )


TEMPLATES = (STACK_QUEUE, SORTING)
BUILDERS = {
    "data_structures.stack_queue": build_stack_queue,
    "data_structures.sorting": build_sorting,
}

__all__ = ["BUILDERS", "SORTING", "STACK_QUEUE", "TEMPLATES"]
