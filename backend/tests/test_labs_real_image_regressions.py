"""Regressions found while uploading real 2025 kaoyan screenshots."""
from app.labs.extract import _looks_like_formula
from app.labs.recognize import _attach_solution, build_problem, normalize_latex_prose
from app.labs.source_recovery import assess_text_quality
from app.labs.staged_understanding import candidate_tasks


def test_one_sided_limit_from_formula_ocr_builds_and_solves():
    text = ('11. 1 ln \\operatorname*lim_{x→0^+}(x^x-1)/( ln x· ln (1-x))'
            '=()/(\\longrightarrow)()/(\\longrightarrow)·p')
    problem = build_problem(text, number='11')
    assert problem['model']['task'] == 'limit'
    assert problem['model']['side'] == 'right'
    assert problem['model']['expression'] == '(x^x - 1)/(ln(x)*ln(1 - x))'
    assert not problem['recognition']['ambiguities']
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert '-1' in problem['solution']['answer']


def test_limit_answer_blank_is_not_question_text():
    text = ('11. 1 ln \\operatorname*lim_{x→0^+}(x^x-1)/( ln x· ln (1-x))'
            '=()/(\\longrightarrow)()/(\\longrightarrow)·p')
    normalized = normalize_latex_prose(text)
    assert 'longrightarrow' not in normalized
    assert normalized.rstrip().endswith('=')
    assert '()/' not in normalized


def test_line_integral_text_builder_solves_reversed_graph_curve():
    text = ('14.已知有向曲线L是沿抛物线y=1-x²从点(1,0)到点(-1,0)的一段，则曲线积分\n'
            '(y + cos x)dx + (2x + cos y)dy =')
    problem = build_problem(text, number='14')
    assert problem['model']['task'] == 'line_integral'
    assert problem['model']['conditions']['orientation'] == 'reverse'
    assert problem['model']['conditions']['t_bounds'] == ['-1', '1']
    _attach_solution(problem)
    assert problem['status'] == 'ready'
    assert problem['solution']['answer'] == '4/3 - 2*sin(1)'


def test_line_and_surface_integral_candidates_use_kernel_task_names():
    line = candidate_tasks({'question': '计算曲线积分 ∫_L P dx+Q dy', 'conditions': []})
    assert line == ['line_integral']
    surface = candidate_tasks({'question': '计算曲面积分 ∬_Σ z dS', 'conditions': []})
    assert surface == ['surface_integral']
    green = candidate_tasks({'question': '用格林公式计算', 'conditions': []})
    assert 'green' in green and 'line_integral' in green
    all_tasks = line + surface + green
    assert 'curve_surface_integral' not in all_tasks


def test_plain_integral_sign_routes_to_integral_task():
    assert candidate_tasks({'question': '计算 ∫_0^1 1/(x+1) dx', 'conditions': []}) == ['integral']


def test_pde_precondition_is_not_higher_derivative_request():
    tasks = candidate_tasks({
        'question': ('已知函数f(u)在区间(0,+∞)内具有2阶导数，g(x,y)=f(x/y)，'
                     '若x^2 ∂²g/∂x² + xy ∂²g/∂x∂y + y^2 ∂²g/∂y²=1，求f(u)'),
        'conditions': [],
    })
    assert 'higher_derivative' not in tasks


def test_fullwidth_exam_label_does_not_look_like_broken_formula_parens():
    quality = assess_text_quality('17．（本题满分10分)\n1\n计算 dx.\no(x+1)(x²-2x+2)',
                                  [{'image_key': 'f1_p1'}])
    assert quality['untrusted'] is False


def test_formula_ocr_fragment_soup_is_rejected():
    soup = (r'\begin{array}{c}{{17.~~(\overline{{{\lambda}}}\times^{\frac{1}{2}'
            r'\tilde{\vert3}\tilde{\nu}_{1}\tilde{\nu}_{2}^{12}\tilde{\nu}_{3}^{2}}}}}')
    assert _looks_like_formula(soup) is False


def test_condition_panel_expression_alone_keeps_one_sided_limit():
    from app.labs.recognize import rebuild_problem
    text = (r'11. |·\operatorname*lim_{x→0^+}(x^x-1)/( ln x· ln (1-x))'
            r'=()/(\longrightarrow).')
    problem = build_problem(text, number='11')
    rebuilt = rebuild_problem(
        problem, files=[], text=text, subject='calculus',
        condition_values={'expression': '(x^x - 1)/(log(x)*log(1 - x))',
                          'side': 'right', 'point': 0},
        ambiguity_answers={'source_formula_confirmation': 'confirmed'},
    )
    assert rebuilt['status'] == 'ready'
    assert rebuilt['model']['side'] == 'right'
    assert rebuilt['model']['limit_point_value'] == 0.0
    assert '-1' in rebuilt['solution']['answer']


def test_condition_panel_without_side_still_reads_one_sided_text():
    from app.labs.recognize import rebuild_problem
    text = (r'11. |·\operatorname*lim_{x→0^+}(x^x-1)/( ln x· ln (1-x))'
            r'=()/(\longrightarrow).')
    problem = build_problem(text, number='11')
    rebuilt = rebuild_problem(
        problem, files=[], text=text, subject='calculus',
        condition_values={'expression': '(x^x - 1)/(log(x)*log(1 - x))', 'point': 0},
        ambiguity_answers={'source_formula_confirmation': 'confirmed'},
    )
    assert rebuilt['status'] == 'ready'
    assert rebuilt['model']['side'] == 'right'
    assert '-1' in rebuilt['solution']['answer']


def test_ai_transcription_can_be_completed_by_local_kernel():
    from app.labs.ai_solve import _adopt_local_rebuild
    problem = {
        'text': '计算∫₀¹ 1/[(x+1)(x²-2x+2)]dx', 'number': '17', 'problem_id': 'prb_1',
        'title': '第 17 题', 'subject': 'calculus', 'subject_label': '微积分',
        'source_pages': [{'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
                          'requires_formula_confirmation': True}],
        'recognition': {'ambiguities': [], 'conditions': []},
    }
    result = {'limitations': []}
    assert _adopt_local_rebuild(problem, result) is True
    assert problem['model']['engine'] == 'riemann_v1'
    assert problem['solution']['answer']
    assert problem['status'] == 'needs_review'
    assert result['local_rebuild']['engine'] == 'riemann_v1'


def test_unparsed_ai_transcription_is_not_adopted():
    from app.labs.ai_solve import _adopt_local_rebuild
    problem = {
        'text': '已知函数f(u)在区间(0,+∞)内具有2阶导数，g(x,y)=f(x/y)，'
                '若x^2 ∂²g/∂x² + xy ∂²g/∂x∂y + y^2 ∂²g/∂y²=1，求f(u)',
        'number': '18', 'problem_id': 'prb_1', 'title': '第 18 题',
        'subject': 'calculus', 'subject_label': '微积分',
        'source_pages': [{'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1',
                          'requires_formula_confirmation': True}],
        'recognition': {'ambiguities': [], 'conditions': []},
    }
    assert _adopt_local_rebuild(problem, {'limitations': []}) is False


def test_integral_keeps_exact_integer_bounds_after_unicode_ocr():
    from app.labs.solvers import solve_problem
    text = normalize_latex_prose('计算∫₀¹ 1/[(x+1)(x²-2x+2)]dx')
    problem = build_problem(text, number='17')
    assert problem['model']['exact_bounds'] == {'lower': '0', 'upper': '1'}
    solution = solve_problem(problem['model'])
    assert solution['exact'] == '3*log(2)/10 + pi/10'


def test_q18_ocr_text_does_not_build_bogus_higher_derivative():
    text = (
        '18．（本题满分10分）\n'
        '已知函数f(u)在区间(0,+∞o)内具有 2 阶导数，记g(x,y)=f 若g(x,y)满足\n'
        '0²g g =1, 且 g(x,y)= l, ==,求f(u). 2\n'
        'Ox2 + Xy +y (x,x)\n'
        'OxOy Ov Ox x'
    )
    problem = build_problem(text, number='18')
    assert problem['model'].get('task') != 'higher_derivative'
    assert problem['model']['engine'] == 'unsupported_v1' or problem['model'].get('teaching') is True


def test_limit_kernel_accepts_finite_string_point_and_rejects_side_suffix():
    import pytest
    from app.labs.kernel_models import compile_kernel_problem
    compiled = compile_kernel_problem({
        'task': 'limit',
        'conditions': {
            'expression': '(x^x - 1)/(log(x)*log(1 - x))',
            'variable': 'x',
            'point': '0',
            'side': 'right',
        },
    })
    assert compiled['status'] == 'ready'
    assert compiled['solution']['exact'] == '-1'

    with pytest.raises(ValueError, match='极限点必须是有限数或 ±∞'):
        compile_kernel_problem({
            'task': 'limit',
            'conditions': {
                'expression': '1/x',
                'variable': 'x',
                'point': '0^+',
                'side': 'right',
            },
        })


def test_reference_attach_is_idempotent_and_clears_unsolved_local_model():
    from app.labs.ai_solve import attach_interactive_model
    problem = {
        'text': '18. PDE 问题',
        'status': 'needs_review',
        'subject': 'calculus',
        'model': {'engine': 'analysis_v1', 'task': 'higher_derivative', 'teaching': False},
        'solution': {'answer': '', 'steps': []},
        'recognition': {'ambiguities': []},
        'source_pages': [{'file_id': 'f1', 'page': 1, 'image_key': 'f1_p1'}],
    }
    result = {
        'question': '18. PDE 问题（完整转写）',
        'verification': 'ai_reference',
        'proposed_model': {'kind': 'none'},
        'answer': 'f(u) = 1/2*(ln u)^2 + 2*ln u + 1',
        'reference_answer': 'f(u) = 1/2*(ln u)^2 + 2*ln u + 1',
        'steps': [],
        'limitations': ['该题暂未建立可独立计算的模型，以下为 AI 参考解答，不自动判分'],
        'trace': [],
    }
    attach_interactive_model(problem, result)
    assert problem['status'] == 'reference'
    assert problem['model']['engine'] == 'unsupported_v1'
    attach_interactive_model(problem, result)
    assert len([t for t in result['trace'] if t.get('stage') == 'attach']) == 1


def test_juxtaposed_lnx_and_latex_display_use_ln_notation():
    from app.labs.expr import expression_text, parse_expression, to_latex
    for raw in [
        '(x^x-1)/(lnx*ln(1-x))',
        '(x^x-1)/(ln x * ln(1-x))',
        '(x^x-1)/( ln x ln (1-x))',
    ]:
        parsed = parse_expression(raw, ('x',))
        assert expression_text(parsed) == '(x^x - 1)/(ln(x)*ln(1 - x))'
        tex = to_latex(parsed)
        assert r'\ln' in tex and r'\log' not in tex

    problem = build_problem(r'\lim_{x\to 0^+} \frac{x^x-1}{\lnx\cdot\ln(1-x)}=')
    assert problem['model']['expression'] == '(x^x - 1)/(ln(x)*ln(1 - x))'
    assert r'\ln' in problem['model']['formula_tex']
    assert r'\log' not in problem['model']['formula_tex']
    _attach_solution(problem)
    assert problem['solution']['exact'] == '-1'
