"""把确定性执行记录翻译成按当前步骤可核对的教学讲解。

本地导师是默认路径：不联网也能回答"为什么往这个方向走""下一步是什么""当前队列
是什么"。只有在后端显式开启模型增强时，才把同一份计算摘要发送给模型；失败自动
回退，数值永远以执行记录为准。
"""

from __future__ import annotations

import json
import math
import re
import sympy as sp
from typing import Any, Mapping, Sequence

from .ai import LabAI, LabAIUnavailable
from .expr import number_text, parse_expression, safe_float
from .solvers import evaluate_problem, solve_problem


def _fmt(value: object, digits: int = 5) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return number_text(float(value), digits)
    if value is None:
        return "—"
    return str(value)


def _frame(evaluation: Mapping[str, Any], step: int) -> tuple[int, Mapping[str, Any] | None]:
    frames = evaluation.get("trace") or []
    if not frames:
        return 0, None
    index = max(0, min(int(step), len(frames) - 1))
    return index, frames[index]


def _trace_brief(evaluation: Mapping[str, Any], limit: int = 12) -> list[dict[str, Any]]:
    frames = evaluation.get("trace") or []
    brief: list[dict[str, Any]] = []
    for frame in frames[max(0, len(frames) - limit):]:
        brief.append(
            {
                "index": frame.get("index"),
                "label": frame.get("label"),
                "detail": frame.get("detail"),
                "values": frame.get("values"),
            }
        )
    return brief


def _concept_hint(evaluation: Mapping[str, Any]) -> tuple[str, str, str]:
    subject = evaluation.get("subject")
    if evaluation.get("algorithm") == "heap":
        return ("先看当前堆数组、刚删除的元素和高亮的父子节点。",
                "删除堆顶后由末尾元素补根，再与优先孩子比较并向下筛选；相同孩子优先选左侧。",
                "只有恢复父子堆序才算完成一次删除；筛选中的临时状态可能不满足堆序。")
    if evaluation.get('task') == 'implicit_normal':
        return ('先代入研究点，确认其位于曲线上且分支明确。',
                '对 F(x,y)=0 隐式求导：切线斜率为 -Fx/Fy，法线方向是梯度 (Fx,Fy)。',
                '法线斜率为 Fy/Fx；Fx=0 时法线竖直，斜率不存在。')
    if evaluation.get('task') in ('geometric_area', 'area_volume'):
        return ('先核对区域边界与所有小问：几何面积和旋转体积是两个不同结果。',
                '几何面积在零点处分段取绝对值；绕 x 轴体积使用圆盘面积 πf(x)² 积分。',
                '原题若积分到无穷，图中只显示有限截断，解析结果仍按完整区间计算。')
    if subject == "optimization":
        return (
            "先看当前位置的梯度符号：正梯度表示函数沿正方向上升，负梯度表示沿负方向上升。梯度下降总沿负梯度移动。",
            "更新公式是 x_{k+1}=x_k-η∇f(x_k)；学习率决定每一步走多远，而不是改变方向。",
            "把当前梯度乘以学习率，得到这一步的位移；然后核对新位置的目标值与梯度范数是否变小。",
        )
    if subject == "calculus":
        return (
            "先确认图形阴影的面积、矩形分割方式和当前 n，再比较黎曼和与解析值。",
            "定积分是分割、取点、求和后取极限；数值近似依赖 n 与采样点，解析值由原函数相减得到。",
            "增大 n 观察误差下降；若误差不按预期下降，检查区间、被积函数或在区间内是否有无定义点。",
        )
    if subject == "algorithm":
        return (
            "先看队列、已访问集合和当前节点；下一步动作只会来自这三者的状态。",
            "BFS 用先进先出队列按层扩展；节点在入队时就标记为已访问，避免同一层重复入队。",
            "处理的邻居按节点编号升序排列；逐个判断是否已访问，再决定入队或跳过。",
        )
    if subject == "linear_algebra":
        return (
            "先看当前主元所在的行与列、增广列的分隔线，以及这一步行变换的对象。",
            "高斯消元每列选一个非零主元，用倍加变换消元；换行只影响行列式符号，不影响方程解。",
            "最后一步要核对：方程组看残差，逆矩阵看 A·A⁻¹ 是否等于 I，行列式看换行次数。",
        )
    if subject == "operating_system":
        kind = evaluation.get("os_kind")
        if kind == "page_replace":
            return (
                "先看当前访问的页面是否已在物理块中：在就是命中，不在就是缺页。",
                "FIFO 换出最早装入的页面，LRU 换出最近最久未使用的，OPT 换出未来最晚才会再用的；只有 FIFO 可能出现 Belady 异常。",
                "缺页时先看有没有空闲块；没有就按算法选被置换页面，再核对缺页次数是否与访问次数、命中次数守恒。",
            )
        if kind == "disk_schedule":
            return (
                "先看磁头当前位置、还没服务的请求，以及移动方向。",
                "FCFS 按到达顺序，SSTF 每次选最近的，SCAN 类沿一个方向服务到末端再换向；C-SCAN / C-LOOK 回程不服务请求。",
                "总移动距离 = 相邻两次磁头位置之差的绝对值之和；注意 SCAN 要走到磁盘末端，LOOK 只走到最远的请求。",
            )
        if kind == "banker":
            return (
                "先看 Work（可用资源）和每个进程的 Need：找 Need 不超过 Work 的进程。",
                "银行家算法的安全性检查：假定该进程运行完毕，把它的 Allocation 归还给 Work，再找下一个；全部能完成就是安全序列。",
                "有资源请求时，先检查 Request ≤ Need 与 Request ≤ Available，再试分配并重新做安全性检查，不安全就撤销。",
            )
        return (
            "先看甘特图当前这一段：是哪个进程在运行，就绪队列里还有谁。",
            "FCFS 看到达顺序，SJF 看服务时间，SRTF 看剩余时间并允许抢占，RR 按时间片轮流，优先级调度看优先级数。",
            "周转 = 完成 − 到达，等待 = 周转 − 服务；先找各进程的完成时刻，再求平均值并核对服务时间守恒。",
        )
    return (
        "先看当前损失、输出和梯度范数，再比较与上一轮的变化。",
        "前向传播保存每层 z 与 a；反向传播从输出层按链式法则把误差传回各层。",
        "检查当前层的输入输出形状，按 W←W−η∇W 更新后重新计算损失。",
    )


def _next_step_view(evaluation: Mapping[str, Any], step: int) -> Mapping[str, Any] | None:
    frames = evaluation.get("trace") or []
    if step + 1 < len(frames):
        return frames[step + 1]
    return None


def _why_move(evaluation: Mapping[str, Any], step: int) -> str:
    frames = evaluation.get("trace") or []
    index, frame = _frame(evaluation, step)
    if not frame:
        return "当前还没有执行记录。先点击“下一步”或播放，让求解器产生轨迹。"
    if evaluation.get("subject") == "optimization":
        trajectory = evaluation.get("trajectory") or []
        if index < len(trajectory):
            current = trajectory[index]
            gradient = current.get("gradient") or []
            point = current.get("point") or []
            grad_text = ", ".join(_fmt(item) for item in gradient)
            first_gradient = gradient[0] if gradient else 0.0
            if first_gradient > 0:
                direction = "梯度为正，说明沿正方向函数值上升；更新朝负方向移动"
            elif first_gradient < 0:
                direction = "梯度为负，说明沿正方向函数值下降；更新朝正方向（负梯度）移动"
            else:
                direction = "梯度分量为 0，这个方向上的更新会停止"
            lr = (evaluation.get("params") or {}).get("learning_rate")
            step_size = None
            if gradient and lr is not None:
                step_size = abs(float(gradient[0]) * float(lr))
            previous = trajectory[index - 1] if index > 0 else None
            previous_text = (
                f"上一步位于 {previous.get('point')}；" if previous else "这是初始点；"
            )
            next_text = ""
            if index + 1 < len(trajectory):
                next_text = f"按当前规则，下一步会到达 {trajectory[index + 1].get('point')}。"
            return (
                f"当前是第 {index} 步：{previous_text}位置 {point}，梯度为 ({grad_text})，"
                f"目标值 f={_fmt(current.get('f'))}。{direction}。"
                f"学习率 η={_fmt(lr)}，本次位移约为 {_fmt(step_size)}。{next_text}"
            )
    if evaluation.get("subject") == "calculus" and frame.get("values"):
        values = frame["values"]
        return (
            f"当前停在 {frame.get('label')}：{frame.get('detail')}。"
            f"这一帧的分割数 n={values.get('n')}，黎曼和 {_fmt(values.get('sum'))}，"
            f"与解析值的误差 {_fmt(values.get('error'))}。改变 n 是观察“求和趋近积分”的直接方式。"
        )
    if evaluation.get("subject") == "algorithm":
        return (
            f"当前是“{frame.get('label')}”。队列为 [{', '.join(frame.get('queue') or [])}]，"
            f"已访问 {{{', '.join(frame.get('visited') or [])}}}。{frame.get('detail')}"
        )
    if evaluation.get("subject") == "deep_learning":
        values = frame.get("values") or {}
        return (
            f"当前是 {frame.get('label')}：损失 {_fmt(values.get('loss'))}，"
            f"权重范数 {_fmt(values.get('weight_norm'))}，本轮梯度范数 {_fmt(values.get('grad_norm'))}。"
            "损失下降说明沿负梯度更新有效；若损失上升，优先检查学习率是否过大。"
        )
    if evaluation.get("subject") == "linear_algebra":
        values = frame.get("values") or {}
        det = values.get("det")
        solution = [item for item in (values.get("solution") or []) if item is not None]
        extra = ""
        if det is not None:
            extra += f"累计主元乘积 {_fmt(det)}。"
        if solution:
            extra += f"已求出的分量：{', '.join(_fmt(item) for item in solution)}。"
        if values.get("op_label"):
            extra += f"本步运算：{values['op_label']}。"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    if evaluation.get("subject") == "operating_system":
        values = frame.get("values") or {}
        extra = ""
        if evaluation.get("os_kind") == "cpu_schedule":
            extra = f"当前时刻 {_fmt(values.get('time'))}，就绪队列 [{', '.join(values.get('ready') or [])}]。"
        elif evaluation.get("os_kind") == "page_replace":
            extra = f"物理块 {values.get('frames')}，累计缺页 {values.get('faults')} 次。"
        elif evaluation.get("os_kind") == "disk_schedule":
            extra = f"磁头在 {_fmt(values.get('head'))}，累计移动 {_fmt(values.get('total'))}。"
        elif evaluation.get("os_kind") == "banker":
            extra = f"当前 Work = {values.get('work')}。"
        return f"当前是“{frame.get('label')}”。{frame.get('detail')}{extra}"
    return str(frame.get("detail") or "当前步骤没有额外说明。")


def _solution_text(problem: Mapping[str, Any], evaluation: Mapping[str, Any]) -> str:
    solution = problem.get("solution") or {}
    lines = [str(solution.get("summary") or "完整讲解如下。")]
    answer = solution.get("answer")
    if answer:
        lines.append(f"原题结论：{answer}")
    for index, step in enumerate(solution.get("steps") or [], start=1):
        title = step.get("title") or f"第 {index} 步"
        detail = step.get("detail") or ""
        lines.append(f"{index}. {title}：{detail}")
    if solution.get("global_note"):
        lines.append(str(solution["global_note"]))
    if solution.get("limitations"):
        lines.append("边界：" + "；".join(str(item) for item in solution["limitations"]))
    return "\n".join(lines)


def _answer_for(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    question: str,
    mode: str,
    step: int,
    selected: Mapping[str, Any] | None,
    hint_level: int | None,
) -> str:
    subject = str(evaluation.get("subject") or "")
    index, frame = _frame(evaluation, step)
    solution = problem.get("solution") or {}
    lower = question.lower()
    if hint_level in (1, 2, 3):
        observation, concept, action = _concept_hint(evaluation)
        return [observation, concept, action][hint_level - 1] + _follow_up(mode)

    if not question.strip():
        if mode == "solution":
            return _solution_text(problem, evaluation)
        if mode == "guided":
            return _guided_prompt(evaluation, step) + _follow_up(mode)
        return _current_view(evaluation, step, frame) + _follow_up(mode)

    if any(word in question for word in ("答案", "结果", "原题", "最终")):
        text = f"原题结论：{solution.get('answer') or '暂未得到唯一结论'}。"
        steps = solution.get("steps") or []
        if steps:
            text += "\n依据：" + "；".join(str(item.get("title")) for item in steps[:4]) + "。"
        if solution.get("global_note"):
            text += "\n" + str(solution["global_note"])
        return text + _follow_up(mode)
    if evaluation.get("algorithm") == "heap":
        current = f"当前“{frame.get('label')}”：数组 {frame.get('array')}，已删除 {frame.get('deleted')}。" if frame else "尚无执行记录。"
        next_frame = _next_step_view(evaluation, index)
        next_text = f"下一步：{next_frame.get('label')}，{next_frame.get('detail')}。" if next_frame else "指定次数的删除已经完成。"
        return current + "\n删除堆顶会让末尾元素移到根，可能破坏堆序，需与优先孩子交换并继续向下筛选。\n" + next_text + _follow_up(mode)
    if evaluation.get('task') == 'implicit_normal':
        return f"原题法线：{solution.get('answer')}。\n" + _concept_hint(evaluation)[1] + '\n' + _concept_hint(evaluation)[2] + _follow_up(mode)
    if any(word in question for word in ("为什么", "为何", "方向", "移动", "梯度")) and subject == "optimization":
        return _why_move(evaluation, step) + _follow_up(mode)
    if any(word in question for word in ("下一步", "接下来", "怎么走", "如何继续")):
        next_frame = _next_step_view(evaluation, step)
        if next_frame is None:
            return "当前已经是执行记录的最后一步。可以回到开头单步回看，或修改参数建立对照情景。" + _follow_up(mode)
        return f"下一步：{next_frame.get('label')}。{next_frame.get('detail')}。" + _follow_up(mode)
    if any(word in question for word in ("收敛", "停止", "终止", "结束")):
        if subject == "optimization":
            return (
                f"本次执行的停止原因是：{evaluation.get('stop_reason')}。"
                f"当前梯度范数为 {_fmt((evaluation.get('current') or {}).get('grad_norm'))}。"
                "停止原因只说明这一次执行；是否全局最优需要另看驻点与凸性核对。"
            ) + _follow_up(mode)
        return f"执行记录的最后一步是：{'、'.join(item.get('label', '') for item in (evaluation.get('trace') or [])[-2:])}。" + _follow_up(mode)
    if any(word in question for word in ("约束", "可行", "满足")):
        relevant = [item for item in evaluation.get("checks") or [] if item.get("id") in ("constraints", "coverage", "shape")]
        if relevant:
            return "\n".join(f"{item.get('label')}：{item.get('status')}，{item.get('detail')}" for item in relevant) + _follow_up(mode)
        return "这个模型没有单独的可执行约束。原题中的不等式仍保留在条件与来源面板里，请核对后再解释结果。" + _follow_up(mode)
    if any(word in question for word in ("维度", "形状", "张量", "梯度", "反向", "损失")):
        if subject == "deep_learning":
            layers = evaluation.get("layers") or []
            shapes = [len(item.get("a") or []) for item in layers]
            return (
                f"当前网络各层激活维度为 {shapes}，损失为 {_fmt((evaluation.get('metrics') or [{}])[0].get('value'))}。"
                f"反向传播先算输出层误差，再逐层乘权重转置与激活导数；"
                f"梯度核对结果：{next((item.get('detail') for item in evaluation.get('checks') or [] if item.get('id') == 'gradient'), '未计算')}"
            ) + _follow_up(mode)
    if any(word in question for word in ("队列", "顺序", "已访问", "bfs", "层")) and subject == "algorithm":
        if frame:
            return (
                f"当前 {frame.get('label')}：队列 [{', '.join(frame.get('queue') or [])}]，"
                f"已访问 {{{', '.join(frame.get('visited') or [])}}}，出队顺序 {' → '.join(frame.get('order') or [])}。"
                f"{frame.get('detail')}"
            ) + _follow_up(mode)
    if selected and (selected.get("label") or selected.get("id")):
        return _explain_selected(selected, problem, evaluation) + _follow_up(mode)
    if mode == "solution":
        return _solution_text(problem, evaluation) + _follow_up(mode)
    return _current_view(evaluation, step, frame) + "\n\n" + _guided_prompt(evaluation, step) + _follow_up(mode)


def _current_view(evaluation: Mapping[str, Any], step: int, frame: Mapping[str, Any] | None) -> str:
    metrics = evaluation.get("metrics") or []
    metric_text = "；".join(f"{item.get('label')} {item.get('value')}" for item in metrics[:3])
    if frame:
        return f"当前停在“{frame.get('label')}”（第 {step} 个记录）。{frame.get('detail')}\n核心读数：{metric_text}。"
    return f"模型已就绪。核心读数：{metric_text}。"


def _guided_prompt(evaluation: Mapping[str, Any], step: int) -> str:
    subject = evaluation.get("subject")
    if evaluation.get('algorithm') == 'heap':
        return '先预测：根节点需要与哪个孩子交换？再单步核对，直到堆序恢复。'
    if evaluation.get('task') == 'implicit_normal':
        return '先确认研究点，再比较梯度方向与图中法线方向。'
    if subject == "optimization":
        return "先预测：下一步位置会比当前更接近驻点吗？再点击“下一步”核对。"
    if subject == "calculus":
        return "先观察：当前 n 的矩形总面积与曲线下面积差在哪一侧？再增大 n 验证。"
    if subject == "algorithm":
        return "先预测：下一个出队的节点是谁？在右侧提交预测，再单步核对。"
    if subject == "linear_algebra":
        return "先预测：这一列的主元在哪一行？消元后该行第一个非零元素会变成几？再单步核对。"
    if subject == "operating_system":
        kind = evaluation.get("os_kind")
        if kind == "page_replace":
            return "先预测：下一次访问是命中还是缺页？缺页时会换出哪个页面？再单步核对。"
        if kind == "disk_schedule":
            return "先预测：磁头下一步会去哪个磁道？这一步会移动多远？再单步核对。"
        if kind == "banker":
            return "先预测：当前 Work 能满足哪个进程的 Need？它完成后 Work 会变成多少？再单步核对。"
        return "先预测：这一段结束时哪个进程会被选中运行？甘特图上它会占多长？再单步核对。"
    return "先观察：损失在下降、停滞还是振荡？再改变学习率建立对照。"


def _follow_up(mode: str) -> str:
    if mode == "guided":
        return "\n\n你可以先写下自己的判断，再让我按层级给提示。"
    if mode == "solution":
        return "\n\n如果其中一步不清楚，可以选中公式或直接追问。"
    return ""


def _explain_selected(selected: Mapping[str, Any], problem: Mapping[str, Any], evaluation: Mapping[str, Any]) -> str:
    label = str(selected.get("label") or selected.get("id") or "所选内容")
    selected_id = str(selected.get("id") or "")
    conditions = (problem.get("recognition") or {}).get("conditions") or []
    for item in conditions:
        if item.get("id") == selected_id:
            provenance = item.get("provenance")
            note = item.get("note") or ""
            return (
                f"“{label}”当前取值为 {item.get('value')}。来源：{provenance}。{note}"
                "它是当前模型的一项输入；修改它会进入新的探索情景，原题答案仍保留。"
            )
    formulas = (problem.get("recognition") or {}).get("formulas") or []
    for item in formulas:
        if item.get("id") == selected_id:
            return f"“{label}”是识别出的表达式：{item.get('plain')}。图形、轨迹与答案读取同一模型。"
    return f"“{label}”是当前实验的一部分；它的数值已包含在步骤记录中：{evaluation.get('headline')}。"


def _compact_context(problem: Mapping[str, Any], evaluation: Mapping[str, Any], step: int) -> dict[str, Any]:
    solution = problem.get("solution") or {}
    index, frame = _frame(evaluation, step)
    return {
        "subject": evaluation.get("subject"),
        "problem_text": str(problem.get("text") or "")[:1200],
        "solution": {
            "summary": solution.get("summary"),
            "answer": solution.get("answer"),
            "steps": [
                {"title": item.get("title"), "detail": item.get("detail")}
                for item in (solution.get("steps") or [])[:6]
            ],
            "limitations": solution.get("limitations"),
        },
        "step": index,
        "frame": {
            "label": frame.get("label"),
            "detail": frame.get("detail"),
            "values": frame.get("values"),
            "queue": frame.get("queue"),
            "visited": frame.get("visited"),
        }
        if frame
        else None,
        "metrics": (evaluation.get("metrics") or [])[:5],
        "checks": (evaluation.get("checks") or [])[:5],
        "stop_reason": evaluation.get("stop_reason"),
        "trace_brief": _trace_brief(evaluation),
    }


def ask(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    *,
    question: str,
    mode: str,
    step: int,
    selected: Mapping[str, Any] | None = None,
    hint_level: int | None = None,
    use_ai: bool = False,
    ai: LabAI | None = None,
) -> dict[str, Any]:
    local_answer = _answer_for(problem, evaluation, question, mode, step, selected, hint_level)
    context = _compact_context(problem, evaluation, step)
    result: dict[str, Any] = {
        "answer": local_answer,
        "local": True,
        "context": context,
        "selected": selected,
    }
    if not use_ai:
        return result
    provider = ai or LabAI()
    if not provider.available():
        result["notice"] = "模型增强未开启，已使用本地导师讲解。"
        return result
    system = (
        "你是题目交互实验室的导师。只能使用用户消息中的计算记录解释，不要编造新的数值、"
        "定理或题目条件。回答用中文，先给结论，再给依据；数值保留计算记录中的精度。"
        "如果记录不足以回答，明确说明缺少什么，并建议学生查看哪一步。"
    )
    user = json.dumps(
        {
            "question": question,
            "mode": mode,
            "hint_level": hint_level,
            "selected": selected,
            "computed": context,
        },
        ensure_ascii=False,
    )
    try:
        completed = provider.complete(system=system, user=user)
    except LabAIUnavailable as exc:
        logger.info("题目实验室模型增强回退：%s", exc)
        result["notice"] = f"模型增强不可用（{exc}），已使用本地导师讲解。"
        return result
    result.update(
        {
            "answer": completed.text,
            "local": False,
            "provider": completed.provider,
            "model": completed.model,
            "notice": "模型增强回答；所有数值仍以左侧执行记录为准。",
        }
    )
    return result


def _parse_number(text: str) -> float | None:
    value = text.strip().replace("−", "-").replace(",", " ").replace("，", " ")
    fraction = re.search(r"(-?\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", value)
    if fraction:
        denominator = float(fraction.group(2))
        if denominator != 0:
            return float(fraction.group(1)) / denominator
    match = re.search(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", value)
    if not match:
        return None
    try:
        parsed = float(match.group(0))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _numbers(text: str) -> list[float]:
    result: list[float] = []
    for match in re.finditer(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", text.replace("−", "-")):
        try:
            value = float(match.group(0))
        except ValueError:
            continue
        if math.isfinite(value):
            result.append(value)
    return result


def _scalar_answers(raw: str) -> list[float]:
    """Parse exact scalar expressions, keeping commas inside functions intact."""
    text = raw.strip().replace('，', ',').replace('；', ',').replace(';', ',')
    if text.startswith('[') and text.endswith(']'):
        text = text[1:-1]
    if text.startswith('(') and text.endswith(')'):
        depth = 0
        for i, char in enumerate(text):
            depth += (char == '(') - (char == ')')
            if depth == 0:
                if i == len(text) - 1:
                    text = text[1:-1]
                break
    parts, start, depth = [], 0, 0
    for i, char in enumerate(text):
        depth += (char == '(') - (char == ')')
        if char == ',' and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    if len(parts) > 16:
        return []
    values = []
    for part in parts:
        try:
            expr = parse_expression(part.strip().replace('E', 'e'), ('x',))
            value = safe_float(expr)
        except (ValueError, TypeError, ArithmeticError):
            return []
        if expr.free_symbols or value is None:
            return []
        values.append(value)
    return values


def _exam_attempt(problem: Mapping[str, Any], answer: str, field: str) -> dict[str, Any] | None:
    model, solution = problem.get('model') or {}, problem.get('solution') or {}
    task = model.get('task')
    detail, correct = '', False
    if model.get('engine') == 'heap_v1':
        choice = solution.get('answer_choice')
        wanted = [float(item) for item in solution.get('answer_order') or []]
        values = _scalar_answers(answer)
        correct = (bool(choice) and answer.strip().upper() == str(choice).upper()) or (
            len(values) == len(wanted) and bool(wanted) and values == wanted)
        if not wanted and answer.strip() in ('空堆', '[]', 'empty'):
            correct = True
        detail = '删除后的堆数组与逐步下滤记录一致。' if correct else f"请按堆的层序数组核对，原题结果为 {solution.get('answer')}。"
    elif task in ('geometric_area', 'area_volume', 'implicit_normal'):
        quantities = solution.get('quantities') or []
        if field in ('area', 'volume'):
            quantities = [q for q in quantities if q['id'] == field]
        wanted = [float(q['value']) for q in quantities]
        if task == 'implicit_normal':
            if model.get('vertical_normal'):
                correct = answer.strip() in ('不存在', '斜率不存在', '垂直', '竖直', 'undefined')
                detail = '法线为竖直直线，斜率不存在。'
            else:
                wanted = [float(solution['answer_value'])]
        if not detail:
            values = _scalar_answers(answer)
            correct = bool(wanted) and len(values) == len(wanted) and all(abs(a-b) <= max(1e-5,abs(b)*0.001) for a,b in zip(values,wanted))
            detail = '已逐项核对全部填写结果，与原题解析值一致。' if correct else f"请按题目要求逐项填写，原题结论：{solution.get('answer') or '尚未确认'}。"
    elif solution.get('stationary_points') and field in ('stationary_minimum', 'point'):
        values = _scalar_answers(answer)
        names = model.get('variables') or []
        if len(names) == 1 and len(values) == 1:
            minima = [
                item for item in solution.get('stationary_points') or []
                if item.get('classification') == 'minimum'
            ]
            targets = []
            for item in minima:
                try:
                    targets.append(float(sp.sympify((item.get('coordinates') or [None])[0])))
                except (TypeError, ValueError):
                    continue
            correct = any(
                abs(values[0] - target) <= max(1e-4, abs(target) * 0.01)
                for target in targets
            )
            detail = (
                '该坐标是对应极小值点；全部驻点分类请查看完整讲解。' if correct else
                '该坐标未落在当前已分类的极小值点上；请核对一阶、二阶导数或不可导点判别。'
            )
        else:
            try:
                expression = parse_expression(str(model['expression']), names)
                symbols = [sp.Symbol(name, real=True) for name in names]
                substitutions = dict(zip(symbols, values))
                if len(values) == len(symbols):
                    gradients = [safe_float(sp.diff(expression, symbol).subs(substitutions)) for symbol in symbols]
                    hessian = sp.hessian(expression, symbols).subs(substitutions)
                    correct = all(v is not None and abs(v) < 1e-4 for v in gradients) and hessian.is_positive_definite is True
            except (ValueError, TypeError, ArithmeticError):
                correct = False
            detail = ('该坐标是极小值点；本次仅核对一个点，全部周期族与鞍点分类请查看完整讲解。' if correct else
                      '该坐标未通过驻点与极小值判别，请核对梯度和 Hessian；鞍点不属于极小值点。')
    else:
        return None
    return {'correct': correct, 'expected': str(solution.get('answer') or ''), 'actual': answer,
            'field': field, 'kind': 'numeric',
            'feedback': ('判断：正确。\n' if correct else '判断：还需要核对。\n') + detail}


def _analysis_attempt(
    problem: Mapping[str, Any], answer: str, field: str
) -> dict[str, Any] | None:
    model = problem.get("model") or {}
    solution = problem.get("solution") or {}
    kind = model.get("analysis_kind") or model.get("task")
    if kind == "function_study":
        return {
            "correct": False, "expected": str(solution.get("answer") or ""), "actual": answer.strip(),
            "field": field or "analysis", "kind": "symbolic",
            "feedback": "区间研究题暂不自动判分；请逐项对照完整讲解中的单调区间、凹凸区间、极值、拐点与渐近线。",
        }
    if kind not in ("limit", "taylor", "higher_derivative"):
        return None
    actual = answer.strip()
    variable = str(model.get("variable") or "x")
    correct = False
    detail = ""
    expected = str(solution.get("answer") or "")
    if kind == "limit":
        status = str(solution.get("limit_status") or "")
        if status == "finite":
            value = solution.get("answer_value")
            student = _parse_number(actual)
            correct = (
                student is not None and value is not None
                and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            )
            detail = (
                f"极限值与符号单侧极限一致（{_fmt(float(value))}）。"
                if correct else f"该点极限为 {_fmt(float(value)) if value is not None else '未求出'}；请核对左右极限。"
            )
        elif status in ("does_not_exist", "infinite"):
            correct = bool(re.search(r"不存在|发散|无穷|∞|无极限", actual))
            detail = (
                "该题极限不存在或发散到无穷；不能只写一个有限数值。"
                if correct else "请区分有限极限、发散到 ±∞ 与左右极限不同导致的不存在。"
            )
        else:
            return None
    elif kind == "taylor":
        expected_polynomial = str(solution.get("polynomial") or "").strip()
        if not expected_polynomial:
            return None
        student_text = re.sub(r"^[^=]*=", "", actual).strip()
        student_text = re.sub(r"\s*\+?\s*[oO]\s*\(.*\)\s*$", "", student_text)
        try:
            student_expr = parse_expression(student_text, (variable,))
            target_expr = parse_expression(expected_polynomial.replace("^", "**"), (variable,))
            correct = sp.simplify(student_expr - target_expr) == 0
        except Exception:  # noqa: BLE001
            correct = False
        detail = (
            "泰勒多项式与符号展开一致。"
            if correct else "请按 (x-x₀) 的幂写出完整多项式，并保留题目要求的阶数。"
        )
    else:
        value = solution.get("derivative_value")
        if value is not None:
            student = _parse_number(actual)
            correct = student is not None and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            detail = (
                f"高阶导数值与符号求导一致（{_fmt(float(value))}）。"
                if correct else f"该点 {solution.get('derivative_order')} 阶导数为 {_fmt(float(value))}。"
            )
        else:
            expected_expression = str(solution.get("derivative_expression") or "").strip()
            if not expected_expression:
                return None
            try:
                student_expr = parse_expression(re.sub(r"^[^=]*=", "", actual).strip(), (variable,))
                target_expr = parse_expression(expected_expression.replace("^", "**"), (variable,))
                correct = sp.simplify(student_expr - target_expr) == 0
            except Exception:  # noqa: BLE001
                correct = False
            detail = (
                "高阶导数表达式与符号求导一致。"
                if correct else "请核对求导阶数，并用显式表达式写出高阶导数。"
            )
    return {
        "correct": correct,
        "expected": expected,
        "actual": actual,
        "field": field or "analysis",
        "kind": "symbolic",
        "feedback": ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail,
    }


def _antiderivative_attempt(
    problem: Mapping[str, Any], answer: str, field: str
) -> dict[str, Any] | None:
    """不定积分按“原函数族”核对：忽略常数 C，比较求导后是否回到被积函数。"""

    model = problem.get("model") or {}
    if model.get("kind") != "antiderivative":
        return None
    variable = str(model.get("variable") or "x")
    answer_text = answer.strip()
    expected = str((problem.get("solution") or {}).get("answer") or "")
    expected = expected or f"F({variable})=…+C"
    detail = ""
    correct = False
    if answer_text:
        candidate_text = (
            answer_text.replace("＋", "+")
            .replace("−", "-")
            .replace("²", "^2")
            .replace("³", "^3")
            .replace("⁴", "^4")
            .replace(" ", "")
        )
        candidate_text = re.sub(r"^[A-Za-z]\s*(?:\([^)]*\))?\s*=", "", candidate_text)
        candidate_text = re.sub(r"[+-]\s*[cC]\s*$", "", candidate_text)
        try:
            student = parse_expression(candidate_text, (variable,))
            target = parse_expression(str(model.get("expression") or ""), (variable,))
            symbol = sp.Symbol(variable, real=True)
            correct = sp.simplify(sp.diff(student, symbol) - target) == 0
            detail = (
                "把你写的式子求导，正好得到被积函数；常数 C 不影响求导结果，可以省略。"
                if correct
                else f"把你写的式子求导后没有回到被积函数；原题答案是一族原函数：{expected}。"
            )
        except Exception:  # noqa: BLE001 - 学生写法无法解析时给出可操作提示
            detail = "暂时无法解析这个原函数写法；可写成 x^3/3+C、sin(x)+C 这样的形式（C 可省略）。"
    else:
        detail = "请填写原函数，例如 x^3/3+C；只写数值无法表示不定积分的答案。"
    return {
        "correct": correct,
        "expected": expected,
        "actual": answer_text,
        "field": field or "antiderivative",
        "kind": "antiderivative",
        "feedback": ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail,
    }


def check_attempt(
    problem: Mapping[str, Any],
    evaluation: Mapping[str, Any],
    *,
    answer: str,
    field: str = "",
    kind: str = "numeric",
) -> dict[str, Any]:
    subject = str(problem.get("subject") or "")
    solution = problem.get("solution") or {}
    if not solution.get("answer") and problem.get("model"):
        try:
            solution = solve_problem(problem["model"])
        except Exception:  # noqa: BLE001 - 保留检查入口，反馈缺少结论
            solution = {}
    actual = answer.strip()
    if (problem.get("model") or {}).get("task") == "proof":
        return {
            "correct": False, "expected": str(solution.get("answer") or solution.get("summary") or ""),
            "actual": actual, "field": field or "proof", "kind": "proof",
            "feedback": "证明题不自动判分：请对照证明义务清单、证书条件或反例逐项核对；局部等式通过不等于整体证明成立。",
        }
    solution_status = str(solution.get("solution_status") or "")
    if solution_status in ("incomplete", "undetermined", "divergent", "unsupported", "undefined") or solution.get("solution_complete") is False:
        return {
            "correct": False,
            "expected": str(solution.get("answer") or ""),
            "actual": actual,
            "field": field or "numeric",
            "kind": kind,
            "feedback": "当前原题结论尚未完整求出或积分发散，不能自动判分；请先按完整讲解核对敛散性、驻点完整性与分类。",
        }
    if kind != 'draft':
        special = _exam_attempt(problem, actual, field)
        if special is not None:
            return special

    antiderivative = _antiderivative_attempt(problem, actual, field)
    if antiderivative is not None:
        return antiderivative

    analysis = _analysis_attempt(problem, actual, field)
    if analysis is not None:
        return analysis

    if kind == "draft":
        expected_text = str(solution.get("answer") or "")
        if subject == "algorithm":
            wanted = [str(item).upper() for item in solution.get("answer_order") or []]
            tokens = [token.upper() for token in re.findall(r"[A-Za-z0-9_一-龥]+", actual)]
            found = any(tokens[start:start + len(wanted)] == wanted for start in range(max(0, len(tokens) - len(wanted) + 1)))
            return {
                "correct": bool(found),
                "expected": expected_text,
                "actual": actual[:600],
                "field": field or "draft",
                "kind": kind,
                "feedback": (
                    "判断：正确。草稿中找到完整的 BFS 出队顺序。"
                    if found
                    else "判断：还需要核对。草稿中没有找到完整的出队顺序；可对照完整讲解的队列记录。"
                ),
            }
        if subject == "operating_system" and solution.get("answer_sequence") and problem.get("model", {}).get("os_kind") == "banker":
            from .opsys import check_banker_sequence
            tokens = re.findall(r"[Pp]\d+", actual)
            valid, note = check_banker_sequence(problem["model"], tokens) if tokens else (False, "草稿中没有找到进程序列。")
            return {
                "correct": valid, "expected": expected_text, "actual": actual[:600], "field": field or "draft", "kind": kind,
                "feedback": ("判断：正确。" if valid else "判断：还需要核对。") + note,
            }
        expected_numbers: list[float] = []
        if subject == "optimization":
            expected_numbers.extend(float(item) for item in solution.get("answer_point") or [])
            if solution.get("answer_value") is not None:
                expected_numbers.append(float(solution["answer_value"]))
        elif subject == "deep_learning":
            losses = evaluation.get("loss_history") or []
            if losses:
                expected_numbers.append(float(losses[-1]))
        elif solution.get("answer_value") is not None:
            expected_numbers.append(float(solution["answer_value"]))
        candidates = _numbers(actual)
        matched = [
            expected
            for expected in expected_numbers
            if any(abs(candidate - expected) <= max(1e-4, abs(expected) * 0.01) for candidate in candidates)
        ]
        correct = bool(expected_numbers) and len(matched) == len(expected_numbers)
        if correct:
            feedback = (
                "判断：正确。草稿中找到了与原题解析结果一致的数值。"
                "这是数值核对，不替代步骤证明；可继续在完整讲解中逐步对照。"
            )
        else:
            missing = [item for item in expected_numbers if item not in matched]
            feedback = (
                "判断：还需要核对。草稿中未找到"
                + ("：" + "、".join(_fmt(item) for item in missing) if missing else "与原题一致的最终数值")
                + "。如果草稿只写了过程，请在“提交我的尝试”中填写最终数值。"
            )
        return {
            "correct": correct,
            "expected": expected_text,
            "actual": actual[:600],
            "field": field or "draft",
            "kind": kind,
            "feedback": feedback,
        }
    correct = False
    expected = ""
    detail = ""
    if subject == "algorithm":
        expected = " → ".join(solution.get("answer_order") or [])
        tokens = re.findall(r"[A-Za-z0-9_\u4e00-\u9fa5]+", actual.upper())
        wanted = [str(item).upper() for item in solution.get("answer_order") or []]
        correct = tokens == wanted
        detail = (
            "顺序与原题执行轨迹一致。" if correct else
            f"你的顺序是 {' → '.join(tokens) or '空'}；原题轨迹是 {expected or '未计算'}。"
            "BFS 的入队与出队顺序是两种不同记录，这里核对的是出队顺序。"
        )
    elif subject == "deep_learning":
        losses = evaluation.get("loss_history") or []
        target_value = losses[-1] if losses else None
        expected = _fmt(target_value, 8)
        student = _parse_number(actual)
        if student is None or target_value is None:
            detail = "请填写当前训练轮结束后的 MSE 数值。"
        else:
            tolerance = max(1e-7, abs(float(target_value)) * 0.08)
            correct = abs(student - float(target_value)) <= tolerance
            detail = (
                f"你的损失 {_fmt(student)} 与执行记录一致（容差 8%）。"
                if correct
                else f"你的损失 {_fmt(student)} 与执行记录 {_fmt(target_value)} 的差为 {_fmt(abs(student - float(target_value)))}。"
                "可展开最后一层的中间值核对。"
            )
    elif subject == "optimization":
        point = solution.get("answer_point")
        value = solution.get("answer_value")
        expected = solution.get("answer") or ""
        if field == "value" or (field == "" and point is None):
            student = _parse_number(actual)
            correct = student is not None and value is not None and abs(student - float(value)) <= max(1e-5, abs(float(value)) * 0.01)
            detail = (
                f"最优值与符号解一致（{_fmt(value, 8)}）。" if correct else
                f"目标函数最优值为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。"
            )
        else:
            student = _numbers(actual)
            wanted = [float(item) for item in point or []]
            correct = len(student) == len(wanted) and all(
                abs(student[index] - wanted[index]) <= max(1e-4, abs(wanted[index]) * 0.01)
                for index in range(len(wanted))
            )
            detail = (
                f"最优点与原题符号解一致（{wanted}）。" if correct else
                f"原题驻点为 {wanted}；你填写的是 {student}。注意：数值轨迹的终点不一定正好等于驻点。"
            )
    elif subject == "operating_system":
        expected = solution.get("answer") or ""
        model = problem.get("model") or {}
        if model.get("os_kind") == "banker":
            from .opsys import check_banker_sequence
            tokens = re.findall(r"[Pp]\d+", actual)
            correct, detail = check_banker_sequence(model, tokens) if tokens else (False, "请按完成顺序写出进程，例如 P1 → P3 → P4 → P0 → P2。")
            expected = " → ".join(solution.get("answer_sequence") or []) or expected
        else:
            value = solution.get("answer_value")
            student = _parse_number(actual)
            unit = {"cpu_schedule": "平均等待时间", "page_replace": "缺页次数", "disk_schedule": "磁头总移动距离"}.get(
                model.get("os_kind"), "结果")
            if student is None or value is None:
                detail = f"请填写{unit}的数值（支持 8/3、2.6667 这样的写法）。"
            else:
                tolerance = max(1e-5, abs(float(value)) * 0.01)
                correct = abs(student - float(value)) <= tolerance
                detail = (
                    f"{unit}与执行记录一致（容差 1%）。" if correct else
                    f"执行记录得到{unit} {_fmt(value, 8)}；你填写的是 {_fmt(student)}。可回到轨迹逐步核对。"
                )
    elif subject == "linear_algebra":
        expected = solution.get("answer") or ""
        wanted_vector = [float(item) for item in solution.get("answer_vector") or []]
        value = solution.get("answer_value")
        if wanted_vector:
            student = _numbers(actual)
            correct = len(student) == len(wanted_vector) and all(
                abs(student[index] - wanted_vector[index]) <= max(1e-4, abs(wanted_vector[index]) * 0.01)
                for index in range(len(wanted_vector))
            )
            detail = (
                "分量顺序与数值均与消元结果一致。" if correct else
                f"期望 {len(wanted_vector)} 个分量，按行/变量顺序填写；你写的是 {student}。"
            )
        else:
            student = _parse_number(actual)
            if student is None or value is None:
                detail = "请填写一个数值（支持 8/3、2.6667 这样的写法）。"
            else:
                tolerance = max(1e-5, abs(float(value)) * 0.01)
                correct = abs(student - float(value)) <= tolerance
                detail = (
                    f"与消元结果一致（容差 1%）。" if correct else
                    f"消元结果为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。"
                    "可回到轨迹核对换行次数与主元乘积。"
                )
    else:
        value = solution.get("answer_value")
        expected = solution.get("answer") or ""
        student = _parse_number(actual)
        if student is None or value is None:
            detail = "请填写一个数值（支持 8/3、2.6667 这样的写法）。"
        else:
            tolerance = max(1e-5, abs(float(value)) * 0.01)
            correct = abs(student - float(value)) <= tolerance
            detail = (
                f"与解析结果一致（容差 1%）。" if correct else
                f"解析值为 {_fmt(value, 8)}；你填写的是 {_fmt(student)}。可回到“完整讲解”核对原函数与上下限。"
            )
    feedback = ("判断：正确。\n" if correct else "判断：还需要核对。\n") + detail
    return {
        "correct": correct,
        "expected": expected,
        "actual": actual,
        "field": field or ("order" if subject == "algorithm" else "numeric"),
        "kind": kind,
        "feedback": feedback,
    }


def evaluate_for_context(problem: Mapping[str, Any], params: Mapping[str, Any]) -> dict[str, Any]:
    return evaluate_problem(problem.get("model") or {}, params)


__all__ = ["ask", "check_attempt", "evaluate_for_context"]
