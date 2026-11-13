from types import SimpleNamespace
import pytest

from app.labs import ai_solve


class Client:
    settings = SimpleNamespace(llm_model="test-ai")
    def __init__(self, model=None, **extra):
        self.data = {"interpretation": "把两种商品的数量条件列为方程", "conditions": ["2x+y=11", "x+y=7"],
                     "missing_conditions": [], "model": model or {"kind": "equations", "variables": ["x", "y"],
                     "equations": ["2*x+y=11", "x+y=7"], "target": "x"},
                     "answer": "A", "answer_choices": ["A"],
                     "steps": [{"title": "列方程", "detail": "相减得到数量"}], **extra}
    def generate_json(self, *args, **kwargs):
        return SimpleNamespace(data=self.data)


def problem(text="两种商品的数量满足2x+y=11，x+y=7，求x。A. 3 B. 4 C. 5 D. 6"):
    return {"text": text, "recognition": {"ambiguities": []}, "problem_id": "p1"}


def test_ai_model_is_computed_by_kernel_not_ai_answer():
    result = ai_solve.solve_with_ai(problem(), client=Client())
    assert result["verification"] == "kernel"
    assert result["answer_choices"] == ["B"]
    assert result["computation"]["exact"] == "4"
    assert result["checkable"] is True
    assert ai_solve.check_ai_answer({"ai_solution": result}, "B")["correct"] is True
    assert ai_solve.check_ai_answer({"ai_solution": result}, "A")["correct"] is False


def test_word_equation_positive_domain_and_target():
    result = ai_solve.compute_plan({"kind": "equations", "variables": ["x"],
        "equations": ["x^2=9"], "domains": {"x": "positive"}, "target": "x"})
    assert result["exact"] == "3"
    assert result["checks"][0]["status"] == "pass"


def test_general_equation_all_roots_are_required():
    result = ai_solve.solve_with_ai(problem("求方程x^2-3x+2=0的全部实根"),
        client=Client({"kind": "equations", "variables": ["x"], "equations": ["x^2-3*x+2=0"]}))
    assert result["verification"] == "kernel"
    assert ai_solve.check_ai_answer({"ai_solution": result}, "1,2")["correct"]
    assert not ai_solve.check_ai_answer({"ai_solution": result}, "1")["correct"]


def test_concept_choice_falls_back_to_explicit_ai_reference():
    result = ai_solve.solve_with_ai(problem("下列属于稳定排序的是？A. 归并排序 B. 堆排序 C. 快速排序 D. 选择排序"),
                                   client=Client({"kind": "none"}, answer="A，归并排序可以保持相等元素的相对次序"))
    assert result["verification"] == "ai_reference"
    assert result["checkable"] is False
    assert "归并" in result["answer"]
    with pytest.raises(ValueError):
        ai_solve.check_ai_answer({"ai_solution": result}, "A")


def test_missing_conditions_never_turn_into_verified_answer():
    result = ai_solve.solve_with_ai(problem(), client=Client(missing_conditions=["还缺少每件商品价格"]))
    assert result["verification"] == "needs_review"
    assert not result["checkable"]


def test_unsafe_model_does_not_execute_and_has_ai_fallback():
    result = ai_solve.solve_with_ai(problem("计算结果"), client=Client({"kind": "evaluate", "variables": ["x"],
        "expression": "__import__('os').system('echo unsafe')"}, answer="请先核对表达式"))
    assert result["verification"] == "ai_reference"
    assert not result["checkable"]


def test_unreviewed_ocr_formula_cannot_be_graded_as_verified():
    p = problem()
    p["recognition"]["ambiguities"] = [{"id": "source_formula_confirmation", "severity": "blocking", "resolved": False}]
    result = ai_solve.solve_with_ai(p, client=Client())
    assert result["verification"] == "needs_review"
    assert not result["checkable"]


def test_direct_mode_preserves_ai_answer_even_when_math_kernel_available():
    result = ai_solve.solve_with_ai(problem(), mode="direct", client=Client(answer="B，x=4"))
    assert result["verification"] == "ai_reference"
    assert result["answer"] == "B，x=4"


def test_identity_equation_is_not_reported_as_no_solution():
    result = ai_solve.solve_with_ai(problem("求方程x=x的解"),
        client=Client({"kind": "equations", "variables": ["x"], "equations": ["x=x"]}, answer="全体实数"))
    assert result["verification"] == "ai_reference"
    assert not result["checkable"]


def test_duplicate_option_values_are_not_silently_graded_as_single_choice():
    result = ai_solve.solve_with_ai(problem("计算2+2，单选 A. 4 B. 4 C. 5 D. 6"),
        client=Client({"kind": "evaluate", "expression": "2+2"}))
    assert result["verification"] == "kernel"
    assert not result["checkable"]


def test_decimal_word_model_does_not_discard_root_on_float_residual():
    result = ai_solve.compute_plan({"kind": "equations", "variables": ["x"],
        "equations": ["x-0.8*x=30"], "target": "x", "domains": {"x": "positive"}})
    assert result["exact"] == "150"


@pytest.mark.parametrize("equation", ["x^2/x=0", "sqrt(x)^2=-1", "x*x^(-1)*x=0", "x%x=x", "x//x*x=0"])
def test_cancellation_of_domain_constraints_cannot_produce_verified_root(equation):
    result = ai_solve.solve_with_ai(problem("请解方程" + equation),
        client=Client({"kind": "equations", "variables": ["x"], "equations": [equation]}, answer="需要检查定义域"))
    assert result["verification"] == "ai_reference"
    assert not result["checkable"]


def test_fractional_constant_coefficients_remain_supported():
    assert ai_solve.compute_plan({"kind": "equations", "variables": ["x"], "equations": ["x/2=3"]})["exact"] == "6"


def test_ai_can_supply_double_integral_conditions_to_real_kernel():
    model = {'kind':'double_integral', 'integrand':'(x-y+1)^2', 'outer_variable':'x',
             'outer_bounds':['0','1'], 'inner_bounds':['x^2','sqrt(x)']}
    result = ai_solve.solve_with_ai(problem('求两条抛物线夹成区域内的二重积分'),
                                   client=Client(model, answer='AI给出的错误参考值=1/3'))
    assert result['verification'] == 'kernel'
    assert result['answer'] == '71/210'
    assert result['computation']['interactive_model']['task'] == 'double_integral'
    assert ai_solve.check_ai_answer({'ai_solution': result}, '71/210')['correct']


def test_ai_double_integral_does_not_invent_missing_bounds():
    result = ai_solve.solve_with_ai(problem('计算区域内二重积分'),
        client=Client({'kind':'double_integral', 'integrand':'x+y', 'inner_bounds':['0','x']}))
    assert result['verification'] == 'ai_reference'
    assert not result['checkable']


def test_ai_existing_kernel_also_returns_model_for_canvas():
    result = ai_solve.solve_with_ai(problem('求给定函数的累积量'),
        client=Client({'kind':'existing', 'canonical_text':'求定积分 ∫_0^1 x^2 dx'}))
    assert result['verification'] == 'kernel'
    assert result['computation']['interactive_model']['subject'] == 'calculus'


def test_ai_double_integral_symbolic_constant_result_remains_checkable():
    result = ai_solve.solve_with_ai(problem('对单位正方形积分 e*(x+y)'),client=Client({
        'kind':'double_integral','integrand':'e*(x+y)','outer_bounds':['0','1'],'inner_bounds':['0','1']}))
    assert result['verification']=='kernel'
    assert ai_solve.check_ai_answer({'ai_solution':result}, 'e')['correct']


def test_ai_extracts_conditions_without_having_to_supply_the_answer():
    result=ai_solve.solve_with_ai(problem('每行数字为矩阵元素，请求其行列式'),client=Client({
        'kind':'kernel','task':'determinant','conditions':{'matrix_a':[[2,1],[1,-1]]}},answer=''))
    assert result['verification']=='kernel'
    assert result['computation']['interactive_model']['la_kind']=='determinant'
    assert result['computation']['expected']['evaluation']['det']==pytest.approx(-3)


def test_kernel_missing_conditions_return_readable_review_questions():
    result=ai_solve.solve_with_ai(problem('按轮转方法调度这些进程'),client=Client({
        'kind':'kernel','task':'cpu_schedule','conditions':{'algorithm':'rr','processes':[{'id':'P','arrival':0,'burst':2}]}}))
    assert result['verification']=='needs_review'
    assert result['missing_conditions']
    assert not result['checkable']


def test_unmapped_constraints_never_get_silently_ignored_by_kernel():
    result=ai_solve.solve_with_ai(problem('对一般约束下的函数求极值'),client=Client({
        'kind':'kernel','task':'optimization','conditions':{'expression':'x^2+y^2','variables':['x','y'],'goal':'extrema','bounds':{}}},
        unmapped_conditions=['x+y>=1']))
    assert result['verification']=='needs_review'
    assert not result['computation']


def test_ai_receives_supported_task_catalog_and_local_gaps():
    class CatalogClient(Client):
        def generate_json(self,*args,**kwargs):
            payload=args[1]
            assert 'bfs' in payload['kernel_tasks'] and 'matrix_a' in payload['kernel_tasks']['inverse']['required']
            return super().generate_json(*args,**kwargs)
    result=ai_solve.solve_with_ai(problem('请按连接关系逐层访问节点'),client=CatalogClient({
        'kind':'kernel','task':'bfs','conditions':{'nodes':['A','B'],'edges':[{'from':'A','to':'B'}],
            'start':'A','directed':False,'neighbor_order':'lexicographic_by_id'}}))
    assert result['verification']=='kernel'
