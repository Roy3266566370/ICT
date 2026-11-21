# -*- coding: utf-8 -*-
block = '''

def test_round6_space_geometry():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # 曲面切平面与法线
        ('求曲面z=x^2+y^2在点(1,1,2)处的切平面方程与法线方程。（10分）',
         '切平面 2*x + 2*y - z - 2 = 0'),
        # 二次曲面识别（指出/说明概念措辞但内核直接分类）
        ('指出二次曲面x^2/4+y^2/9-z^2=1的名称并说明其类型。（8分）', '单叶双曲面'),
        # 点到平面距离
        ('求点P(1,2,3)到平面x+2y-2z+5=0的距离。（6分）', '点到平面距离 4/3'),
        # 点到直线距离（对称式直线解析）
        ('求点P(1,0,2)到直线x/1=y/1=z/0的距离。（8分）', '3*sqrt(2)/2'),
        # 直线与平面交点（隐式分母1的连等式）
        ('求直线x-1=y=z与平面x+y+z=3的交点及夹角。（10分）', '交点 (5/3, 2/3, 2/3)'),
        # 两平面夹角（第二平面无前缀）
        ('求两平面x+y+z=1与x-y=0的夹角。（6分）', '夹角 pi/2'),
        # 直线在平面上的投影
        ('求直线(x-1)/1=y/1=z/1在平面x+y+z=3上的投影方程。（10分）', '投影'),
    ]
    for text, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model']['engine'] == 'space_v1', (text, p['model'].get('engine'))
        assert p['model']['task'] == 'space_geometry'
        assert expected in p['solution']['answer'], (text, p['solution'].get('answer'))


def test_round6_space_geometry_vectors():
    from app.labs.recognize import build_problem, _attach_solution

    cases = [
        # 向量运算
        ('设a=(1,2,3)，b=(4,5,6)，求a·b、a×b及a与b的夹角。（8分）', 'a·b=32'),
        # 向量积与体积
        ('设a=(1,0,0)，b=(0,1,0)，c=(0,0,1)，求以a,b,c为棱的平行六面体体积。（6分）', '体积 1/6'),
        # 两点确定直线
        ('求过点A(1,2,3)与B(4,5,6)的直线方程。（6分）', '方向向量 (3, 3, 3)'),
        # 点向式直线
        ('求过点(1,0,2)且方向向量为(3,-1,2)的直线方程。（6分）', '方向向量 (3, -1, 2)'),
        # 三点确定平面
        ('求过点(1,0,0)，(0,1,0)与(0,0,1)的平面方程。（8分）', 'x + y + z - 1 = 0'),
        # 两直线位置关系
        ('判断直线x/1=y/0=z/0与x/0=y/1=z/0的位置关系。（8分）', '相交'),
    ]
    for text, expected in cases:
        p = build_problem(text)
        _attach_solution(p)
        assert p['model']['engine'] == 'space_v1', (text, p['model'].get('engine'))
        assert expected in p['solution']['answer'], (text, p['solution'].get('answer'))
'''
open(r'E:\代码\ICT\backend\tests\test_labs_p5_space.py', 'a', encoding='utf-8').write(block)
print('appended')
