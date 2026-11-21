# -*- coding: utf-8 -*-
block = '''

def test_round7_linalg_kinds():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # `|a b;c d|` 行列式竖线记法此前不解析矩阵 → 落 determinant 但 matrix_a 缺失
        ('计算行列式|1 2;3 4|的值。（6分）', 'determinant', 'det(A) = -2'),
        ('计算三阶行列式|1 2 3;0 1 4;5 6 0|。（8分）', 'determinant', 'det(A) = 1'),
        ('求行列式|2 1 0;1 2 1;0 1 2|的值。（8分）', 'determinant', 'det(A) = 4'),
        # 奇异矩阵行列式：det=0 是合法答案，之前直接抛"矩阵奇异"
        ('判断矩阵A=[[1,2],[2,4]]是否可逆。（8分）', 'determinant', 'det(A) = 0'),
        # 数乘：无"数乘/倍"字样的 `3A` 此前误判为乘法缺 B
        ('设A=[[1,2],[3,4]]，求3A。（6分）', 'matmul', 'kA = [3, 6; 9, 12]'),
        # 非方阵乘法
        ('设A=[[1,2,3],[4,5,6]]，B=[[1,0],[0,1],[1,1]]，求AB。（8分）', 'matmul', 'A·B = [4, 5; 10, 11]'),
    ]
    for text, kind, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model'].get('la_kind') == kind, (text, p['model'].get('la_kind'))
        assert expected in (p['solution'].get('answer') or ''), (text, p['solution'].get('answer'))


def test_round7_linalg_eigen_honest_block():
    """特征值暂无本地内核：必须诚实阻塞，不能静默给无关答案。"""
    from app.labs.recognize import build_problem, _attach_solution
    p = build_problem('求矩阵A=[[2,1],[1,2]]的特征值。（8分）')
    _attach_solution(p)
    assert p['model'].get('la_kind') == 'eigen'
    assert p.get('status') in ('needs_review', 'pending_ai')
    assert 'det(A)' not in (p.get('solution') or {}).get('answer', '')
'''
open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf-8').write(block)
print('appended')
