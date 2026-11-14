"""Structured details for line/surface integrals and Green/Gauss/Stokes results."""
from __future__ import annotations

import sympy as sp

from .expr import to_latex


def _expr_vec_latex(items) -> str:
    return r'\left(' + ','.join(to_latex(item) for item in items) + r'\right)'


def _integral_details(kind: str, label: str, facts: list[dict], equations: list[dict],
                      orientation: str, notes: list[str]) -> dict:
    return {'kind': kind, 'label': label, 'facts': facts, 'equations': equations,
            'orientation': orientation, 'notes': notes}


def line_integral_details(result) -> dict:
    exprs = result['expressions']
    curve_latex = (rf'\mathbf r(t)={_expr_vec_latex(exprs)},\quad t\in'
                   rf'\left[{to_latex(result["a"])},{to_latex(result["b"])}\right]')
    integral_latex = (rf'\int_{{{to_latex(result["a"])}}}^{{{to_latex(result["b"])}}}'
                      rf'{to_latex(result["integrand"])}\,dt')
    if result['kind'] == 'scalar':
        label = '第一类曲线积分（对弧长）'
        facts = [
            {'label': '积分曲线', 'latex': curve_latex},
            {'label': '弧长元', 'latex': rf'ds={to_latex(result["speed"])}\,dt'},
            {'label': '化为定积分', 'latex': to_latex(result['integrand'])},
            {'label': '积分值', 'latex': to_latex(result['exact'])},
            {'label': '独立数值复核', 'latex': to_latex(sp.N(result['numeric'], 12))},
        ]
    else:
        label = '第二类曲线积分（对坐标）'
        facts = [
            {'label': '积分曲线', 'latex': curve_latex},
            {'label': '定向', 'text': result['orientation']},
            {'label': '参数导数', 'latex': _expr_vec_latex(result['derivatives'])},
            {'label': '化为定积分', 'latex': to_latex(result['integrand'])},
            {'label': '积分值', 'latex': to_latex(result['exact'])},
            {'label': '独立数值复核', 'latex': to_latex(sp.N(result['numeric'], 12))},
        ]
    return _integral_details(
        'line_integral_' + result['kind'], label, facts,
        [{'label': '化为定积分', 'latex': integral_latex}], result['orientation'],
        ['参数曲线需连续可微，且 r\'(t) 不能恒为零；第二类曲线积分沿参数增大方向取正向，反向时整体变号。'])


def surface_integral_details(result) -> dict:
    if result['surface_mode'] == 'graph':
        surface_latex = rf'z={to_latex(result["surface_z"])},\quad (x,y)\in D'
        parameters = [{'label': '投影区域',
                       'latex': r'D:\ a\le x\le b,\ y_0(x)\le y\le y_1(x)'}]
    else:
        surface_latex = rf'\mathbf r(u,v)={_expr_vec_latex(result["expressions"])}'
        parameters = [{'label': '参数区间',
                       'latex': rf'u\in\left[{to_latex(result["u_bounds"][0])},'
                                rf'{to_latex(result["u_bounds"][1])}\right],\ '
                                rf'v\in\left[{to_latex(result["v_bounds"][0])},'
                                rf'{to_latex(result["v_bounds"][1])}\right]'}]
    normal_latex = _expr_vec_latex(result['normal'])
    coverage_note = ('参数曲面按参数域积分；若同一几何曲面被重复覆盖（例如圆柱参数角度从 0 到 4π），'
                     '结果按覆盖次数累计，不等同于底层几何曲面的面积。')
    if result['surface_mode'] == 'parametric':
        parameters.append({'label': '积分口径', 'text': '按参数域积分（重复覆盖按覆盖次数计）'})
    if result['kind'] == 'scalar':
        label = '第一类曲面积分（对面积）'
        ds_latex = (r'dS=\sqrt{1+z_x^2+z_y^2}\,dxdy'
                    if result['surface_mode'] == 'graph'
                    else r'dS=|\mathbf r_u\times\mathbf r_v|\,dudv')
        facts = [{'label': '曲面', 'latex': surface_latex}, *parameters,
                 {'label': '面积元', 'latex': ds_latex},
                 {'label': '化为二重积分', 'latex': to_latex(result['integrand'])},
                 {'label': '积分值', 'latex': to_latex(result['exact'])},
                 {'label': '独立数值复核', 'latex': to_latex(sp.N(result['numeric'], 12))}]
    else:
        label = '第二类曲面积分（通量）'
        facts = [{'label': '曲面', 'latex': surface_latex}, *parameters,
                 {'label': '法向量', 'latex': normal_latex},
                 {'label': '定向', 'text': result['orientation']},
                 {'label': '化为二重积分', 'latex': to_latex(result['integrand'])},
                 {'label': '积分值', 'latex': to_latex(result['exact'])},
                 {'label': '独立数值复核', 'latex': to_latex(sp.N(result['numeric'], 12))}]
    notes = ['曲面需在参数域或投影域上正则，法向量不能恒为零；通量方向由显式曲面的上/下侧或参数曲面的 r_u×r_v 正/反向确定。']
    if result['surface_mode'] == 'parametric':
        notes.append(coverage_note)
    return _integral_details(
        'surface_integral_' + result['kind'], label, facts,
        [{'label': '化为二重积分', 'latex': to_latex(result['integrand'])}],
        result['orientation'], notes)


def green_details(result) -> dict:
    facts = [
        {'label': '区域', 'latex': r'D:\ a\le x\le b,\ y_0(x)\le y\le y_1(x)'},
        {'label': '边界定向', 'text': result['orientation']},
        {'label': '边界积分', 'latex': to_latex(result['line_value'])},
        {'label': '二重积分', 'latex': to_latex(result['exact'])},
        {'label': '两条路径差', 'latex': to_latex(sp.simplify(result['exact'] - result['line_value']))},
    ]
    equations = [{'label': 'Green 公式',
                  'latex': r'\oint_{\partial D}P\,dx+Q\,dy=\iint_D\left(\frac{\partial Q}{\partial x}-\frac{\partial P}{\partial y}\right)dxdy'}]
    return _integral_details('green', 'Green 公式（边界积分与二重积分互验）', facts, equations,
                             result['orientation'],
                             ['区域为 x 型简单区域；正向为逆时针，负向为顺时针。边界分段方向与区域定向必须一致。'])


def gauss_details(result) -> dict:
    facts = [
        {'label': '区域', 'latex': r'V:\ a\le x\le b,\ c\le y\le d,\ e\le z\le g'},
        {'label': '散度', 'latex': to_latex(result['divergence'])},
        {'label': '闭合曲面通量', 'latex': to_latex(result['surface_value'])},
        {'label': '散度体积分', 'latex': to_latex(result['exact'])},
        {'label': '两条路径差', 'latex': to_latex(sp.simplify(result['exact'] - result['surface_value']))},
    ]
    equations = [{'label': 'Gauss 公式',
                  'latex': r'\oiint_{S}\mathbf F\cdot\mathbf n\,dS=\iiint_V \nabla\cdot\mathbf F\,dV'}]
    return _integral_details('gauss', 'Gauss 公式（通量与散度体积分互验）', facts, equations,
                             '外法向',
                             ['当前只支持长方体区域和外法向；散度与通量分别计算后互验。'])


def stokes_details(result) -> dict:
    facts = [
        {'label': '曲面', 'latex': rf'z={to_latex(result["surface_z"])},\quad (x,y)\in[a,b]\times[c,d]'},
        {'label': '曲面定向', 'text': result['orientation']},
        {'label': '旋度', 'latex': _expr_vec_latex(result['curl'])},
        {'label': '边界环路积分', 'latex': to_latex(result['line_value'])},
        {'label': '旋度通量', 'latex': to_latex(result['exact'])},
        {'label': '两条路径差', 'latex': to_latex(sp.simplify(result['exact'] - result['line_value']))},
    ]
    equations = [{'label': 'Stokes 公式',
                  'latex': r'\oint_{\Gamma}\mathbf F\cdot d\mathbf r=\iint_S(\nabla\times\mathbf F)\cdot\mathbf n\,dS'}]
    return _integral_details('stokes', 'Stokes 公式（环路积分与旋度通量互验）', facts, equations,
                             result['orientation'],
                             ['当前支持 z=z(x,y) 在矩形投影上的曲面；上侧对应边界逆时针，换下侧时两侧同时变号。'])


__all__ = ['gauss_details', 'green_details', 'line_integral_details',
           'stokes_details', 'surface_integral_details']
