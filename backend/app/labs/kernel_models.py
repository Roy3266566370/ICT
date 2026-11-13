"""Declarative task inputs compiled by existing kernels, never by AI-written code."""
from __future__ import annotations

import copy
import json
import math
import re
from typing import Mapping

FIELD_LABELS = dict(expression='函数表达式',variable='积分或求导变量',lower='下限',upper='上限',point='求导点',
    implicit_expression='隐式曲线方程',point_x='研究点横坐标',point_y='研究点纵坐标',integrand='被积函数',
    outer_variable='外层积分变量',outer_bounds='外层积分区间',inner_bounds='内层上下边界',
    variables='变量',goal='求解目标',bounds='变量范围',initial_point='初始点',learning_rate='学习率',iterations='迭代次数',
    nodes='节点',edges='连接关系',start='起点',directed='是否有向',neighbor_order='邻居访问顺序',
    initial_heap='初始堆数组',heap_type='堆类型',deletion_count='删除次数',matrix_a='矩阵 A',matrix_b='矩阵 B',
    vector_b='右端向量 b',op='矩阵运算',scalar='数乘系数',processes='进程表',algorithm='算法',quantum='时间片',
    reference='页面访问序列',frames='物理块数',requests='磁道请求序列',head='磁头起点',max_track='最大磁道号',
    direction='移动方向',return_cost='回扫计费规则',names='进程名称',allocation='已分配资源',max='最大资源需求',
    available='可用资源',request='资源请求',layers='网络层数与维度',activations='激活函数',weights='权重',biases='偏置',
    input='输入向量',target='目标向量',epochs='训练轮数',region_kind='区域类型',rotation_axis='旋转轴',
    id='进程名称',arrival='到达时间',burst='执行时间',priority='优先级',side='考察方向',order='阶数',pieces='分片区域',polar='极坐标区域',swap_order='换序要求',constraint='等式约束',equation='微分方程',initial_conditions='初值条件',independent_variable='自变量',dependent_variable='未知函数',target_kind='组合量类型',target_point='组合量求值点',target_lower='组合量下限',target_upper='组合量上限',term='级数通项',coefficient='幂级数系数',index_start='起始指标',center='展开中心',curve='参数曲线',t_bounds='参数区间',surface='参数曲面',uv_bounds='曲面参数区间',field='向量场/被积函数',region='空间区域',surface_z='曲面 z(x,y)',geometry_kind='空间几何类型',plane='平面',line_point='直线点',line_direction='直线方向',plane2='第二个平面',proof_kind='证明类型',left='左式',right='右式',relation='关系符号',steps='证明步骤',statement='命题陈述')


class ModelConditionsError(ValueError):
    def __init__(self, missing_conditions):
        self.missing_conditions = [FIELD_LABELS.get(v,v) for v in missing_conditions]
        super().__init__('需要补充建模条件：'+'；'.join(self.missing_conditions))


def _spec(label, subject, required, optional=''):
    return dict(label=label, subject=subject, required=required.split(), optional=optional.split())


TASKS = {
    'integral':_spec('定积分','calculus','expression variable lower upper'),
    'antiderivative':_spec('不定积分','calculus','expression variable'),
    'derivative':_spec('导数与切线','calculus','expression variable point'),
    'geometric_area':_spec('曲线与坐标轴围成面积','calculus','expression lower upper region_kind'),
    'rotation_volume':_spec('绕坐标轴的旋转体积','calculus','expression lower upper region_kind rotation_axis'),
    'implicit_normal':_spec('隐函数法线','calculus','implicit_expression point_x','point_y'),
    'double_integral':_spec('二重积分区域','calculus','integrand','outer_variable outer_bounds inner_bounds pieces polar swap_order region_text'),
    'limit':_spec('函数极限','calculus','expression variable point','side'),
    'taylor':_spec('泰勒展开','calculus','expression variable point order'),
    'higher_derivative':_spec('高阶导数','calculus','expression variable order','point'),
    'function_study':_spec('函数区间研究','calculus','expression variable','lower upper'),
    'constrained_extrema':_spec('等式约束极值','optimization','expression variables constraint'),
    'ode':_spec('常微分方程','calculus','equation','initial_conditions independent_variable dependent_variable target_kind target_point target_lower target_upper'),
    'series_convergence':_spec('数项级数敛散性','calculus','term','index_start'),
    'power_series':_spec('幂级数','calculus','goal','coefficient expression center index_start order'),
    'fourier_series':_spec('傅里叶级数','calculus','expression lower upper','order variable'),
    'triple_integral':_spec('三重积分','calculus','integrand region'),
    'line_integral':_spec('曲线积分','calculus','curve t_bounds kind field'),
    'surface_integral':_spec('曲面积分','calculus','surface uv_bounds kind field'),
    'green':_spec('Green公式','calculus','field region'),
    'gauss':_spec('Gauss公式','calculus','field region'),
    'stokes':_spec('Stokes公式','calculus','field surface_z region'),
    'space_geometry':_spec('空间解析几何','calculus','geometry_kind', 'point plane line_point line_direction plane2'),
    'proof':_spec('证明与存在性','calculus','proof_kind','expression lower upper left right relation point steps statement'),
    'optimization':_spec('极值与梯度下降','optimization','expression variables goal bounds','initial_point learning_rate iterations'),
    'bfs':_spec('广度优先遍历','algorithm','nodes edges start directed neighbor_order'),
    'heap':_spec('堆顶删除与插入建堆','algorithm','initial_heap heap_type','operation deletion_count count_comparisons'),
    'heap_compare':_spec('堆操作关键字比较次数','algorithm','initial_heap heap_type operation','deletion_count count_comparisons'),
    'binary_search_count':_spec('折半查找最坏比较次数','algorithm','n'),
    'linear_system':_spec('线性方程组','linear_algebra','matrix_a vector_b'),
    'determinant':_spec('行列式','linear_algebra','matrix_a'),
    'inverse':_spec('逆矩阵','linear_algebra','matrix_a'),
    'matmul':_spec('矩阵运算','linear_algebra','matrix_a op','matrix_b scalar'),
    'cpu_schedule':_spec('CPU调度','operating_system','processes algorithm','quantum'),
    'page_replace':_spec('页面置换','operating_system','reference frames algorithm','initial_frames'),
    'disk_schedule':_spec('磁盘调度','operating_system','requests head algorithm','max_track direction return_cost'),
    'banker':_spec('银行家算法','operating_system','names allocation max available','request'),
    'neural_training':_spec('小型全连接网络训练','deep_learning','layers activations weights biases input target learning_rate epochs'),
}


def task_catalog():
    return {key:{**copy.deepcopy(spec), 'notes':{
        'optimization':'goal=extrema|gradient_descent；bounds为x/y的闭区间字典，无约束时为{}。gradient_descent必须给initial_point、learning_rate、iterations。',
        'cpu_schedule':'algorithm=fcfs|sjf|srtf|rr|priority；processes中每行是id,arrival,burst；priority算法还需priority，rr还需quantum。',
        'disk_schedule':'algorithm=fcfs|sstf|scan|cscan|look|clook；扫描类需direction=up|down；scan/cscan还需max_track；循环扫描需return_cost=count|skip。',
        'matmul':'op=mul|add|sub|scalar；前三种需matrix_b，数乘需scalar。',
        'neural_training':'layers是2至4层、每层1至8维；weights与biases必须完整，隐藏层激活一致，输出层linear；MSE训练。',
        'bfs':'nodes为节点名数组；edges为from/to数组，directed为布尔值，neighbor_order仅lexicographic_by_id。',
        'heap':'operation=delete|insert；delete需要deletion_count，insert把initial_heap当作依次插入序列（从空堆开始上滤）；count_comparisons=true时输出关键字比较次数。',
        'heap_compare':'operation=delete|insert；按固定口径统计关键字比较次数：删除时孩子比较加父子比较，插入时每次父节点比较计一次。',
        'binary_search_count':'n为有序表元素个数（1至10^9）；固定 mid=⌊(low+high)/2⌋ 向下取整，最坏比较次数=⌊log2 n⌋+1，不适用于其他取整约定。',
        'page_replace':'reference为页面访问序列；initial_frames为已调入内存的页面（按从早到晚排列），省略时初始为空；数量不能超过frames且不能重复。',
        'geometric_area':'region_kind=between_axis|vertical_inequality；仅支持曲线与x轴。',
        'rotation_volume':'region_kind=between_axis|vertical_inequality；rotation_axis仅x。',
        'double_integral':'单片用outer_variable/outer_bounds/inner_bounds；分片用pieces（外层区间不重叠）；极坐标用polar{theta_bounds,r_bounds}。被积函数可为常见非多项式，swap_order=true时要求可验证换序。',
        'limit':'side=both|left|right；point可为有限数或oo/-oo表示无穷远；发散到±∞与左右不一致会分别返回。',
        'taylor':'point为有限展开点，order为1至10的整数；输出系数、多项式与余项阶，展开点无有限极限时拒绝。',
        'higher_derivative':'order为1至10的整数；point可选，用于在该点取值。当前只支持显式函数的普通高阶导数。',
        'function_study':'lower与upper可选且必须成对；省略时按实定义域研究。周期临界点族会明确标为未完成。',
        'constrained_extrema':'二元单个等式约束 g(x,y)=0；variables固定为["x","y"]；输出拉格朗日乘数、实驻点与加边Hessian分类。',
        "ode":"1至3阶常微分方程；initial_conditions为y(0)=1、y'(0)=2等字符串数组；target_kind=value|area|integral|volume_x可选。",
        'series_convergence':'term为n的通项；index_start默认1；输出绝对收敛、条件收敛或发散。',
        'power_series':'goal=radius|sum|expand；radius/sum需要coefficient，expand需要expression与order；端点单独判断。',
        'fourier_series':'expression为x的函数；lower/upper为有限周期区间；order为1至12。',
        'triple_integral':'region.kind=box|z_simple|cylindrical|spherical；柱/球坐标自动乘Jacobian。',
        'line_integral':'curve=[x(t),y(t),z(t)]；kind=scalar|vector；vector时field=[P,Q,R]。',
        'surface_integral':'surface=[x(u,v),y(u,v),z(u,v)]；kind=scalar|flux；flux时field=[P,Q,R]。',
        'green':'field=[P,Q]；region={x:[a,b],y:[y0(x),y1(x)]}；边界逆时针。',
        'gauss':'field=[P,Q,R]；region={kind:"box",x:[a,b],y:[c,d],z:[e,f]}；外法向。',
        'stokes':'field=[P,Q,R]；surface_z为z(x,y)，region={x:[a,b],y:[c,d]}；向上法向。',
        'space_geometry':'geometry_kind=point_plane_distance|point_line_distance|line_plane_intersection|plane_plane_angle；按类型提供point、plane、line_point等。',
        'proof':'proof_kind=ivt_root|rolle|mvt|monotone_inequality|counterexample|steps；只认证模板条件与局部等式，未认证证明不判分。',
    }.get(key,'所有必需条件均须来自原题；矩阵、向量使用JSON数组，数学表达式使用显式乘号。')}
            for key,spec in TASKS.items()}


def _require(c, fields):
    missing = [key for key in fields if key not in c or c[key] is None or c[key] == '']
    if missing:
        raise ModelConditionsError(missing)


def _number(value, *, integer=False, minimum=None, maximum=1e6):
    if type(value) not in (int,float) or not math.isfinite(value) or abs(value)>maximum:
        raise ValueError('数值条件必须是计算范围内的有限数值')
    if integer and int(value) != value:
        raise ValueError('该条件必须是整数')
    if minimum is not None and value < minimum:
        raise ValueError('数值条件小于允许范围')
    return value


def _vector(value, limit=80):
    if not isinstance(value,list) or not 1<=len(value)<=limit:
        raise ValueError('向量或序列缺失、为空或超过大小限制')
    for item in value:
        _number(item)


def _matrix(value):
    if not isinstance(value,list) or not 1<=len(value)<=8:
        raise ValueError('矩阵需为八行以内的二维数值数组')
    for row in value:
        _vector(row,8)
    if len({len(row) for row in value}) != 1:
        raise ValueError('矩阵各行长度必须一致')


def _choice(value, choices):
    if value not in choices:
        raise ValueError('该任务不支持此条件值：'+str(value)[:80])


def _names(value):
    if not isinstance(value,list) or not 1<=len(value)<=20 or any(
        not isinstance(v,str) or not re.fullmatch(r'[\w\-]{1,24}',v) for v in value) or len(set(value))!=len(value):
        raise ValueError('名称须为不重复的短节点或进程名')


def _validate_double_integral(c):
    if 'region_text' in c:
        if set(c) != {'region_text', 'integrand'} or not isinstance(c['region_text'], str) or not 1 <= len(c['region_text']) <= 12000:
            raise ValueError('原始区域模式仅接收完整区域文字和被积函数，不能混用猜测积分限')
        if not isinstance(c['integrand'], str) or not 1 <= len(c['integrand']) <= 600:
            raise ValueError('被积函数必须是600字以内数学表达式')
        return
    _require(c, ['integrand'])
    allowed = {'integrand','outer_variable','outer_bounds','inner_bounds','pieces','polar','swap_order'}
    extra = set(c) - allowed
    if extra:
        raise ValueError('存在该内核不能消费的条件：' + ', '.join(sorted(extra)))
    if not isinstance(c['integrand'], str) or not 1 <= len(c['integrand']) <= 600:
        raise ValueError('被积函数必须是600字以内数学表达式')
    if 'outer_variable' in c:
        _choice(c['outer_variable'], ('x', 'y'))
    if 'swap_order' in c and type(c['swap_order']) is not bool:
        raise ValueError('换序要求必须是布尔值')
    if 'polar' in c:
        if 'pieces' in c:
            raise ValueError('极坐标与分片区域不能同时使用')
        if any(key in c for key in ('outer_variable', 'outer_bounds', 'inner_bounds')):
            raise ValueError('极坐标模式不能混用直角坐标积分限')
        if c.get('swap_order'):
            raise ValueError('极坐标区域不适用直角坐标换序')
        polar = c['polar']
        if not isinstance(polar, dict) or set(polar) != {'theta_bounds', 'r_bounds'}:
            raise ValueError('极坐标区域必须且只能包含 theta_bounds 和 r_bounds')
        for key in ('theta_bounds', 'r_bounds'):
            pair = polar[key]
            if not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(v, str) for v in pair):
                raise ValueError(f'{key} 必须是两个字符串')
        return
    if 'pieces' in c:
        if 'outer_bounds' in c or 'inner_bounds' in c:
            raise ValueError('分片模式不能混用单片积分限')
        pieces = c['pieces']
        if not isinstance(pieces, list) or not 1 <= len(pieces) <= 20:
            raise ValueError('分片区域需要 1 至 20 个有限子区域')
        for item in pieces:
            if not isinstance(item, dict) or set(item) != {'outer_bounds', 'inner_bounds'}:
                raise ValueError('每个分片只能包含 outer_bounds 和 inner_bounds')
            for key in ('outer_bounds', 'inner_bounds'):
                pair = item[key]
                if not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(v, str) for v in pair):
                    raise ValueError('分片边界必须是由两个字符串组成的数组')
        return
    _require(c, ['outer_variable', 'outer_bounds', 'inner_bounds'])
    for key in ('outer_bounds', 'inner_bounds'):
        pair = c[key]
        if not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(v, str) for v in pair):
            raise ValueError(f'{key} 必须是由两个字符串组成的数组')


def _validate(task, c):
    spec=TASKS[task]
    if task == 'double_integral':
        _validate_double_integral(c)
        return
    if task in ('triple_integral','line_integral','surface_integral','green','gauss','stokes','space_geometry','proof'):
        _require(c, spec['required'])
        extra = set(c) - set(spec['required']) - set(spec['optional'])
        if extra:
            raise ValueError('存在该内核不能消费的条件：' + ', '.join(sorted(extra)))
        return
    _require(c,spec['required'])
    extra=set(c)-set(spec['required'])-set(spec['optional'])
    if extra:
        raise ValueError('存在该内核不能消费的条件：'+', '.join(sorted(extra)))
    for key in ('matrix_a','matrix_b','allocation','max'):
        if key in c: _matrix(c[key])
    for key in ('vector_b','available','requests','initial_heap','input','target','initial_point'):
        if key in c: _vector(c[key])
    for key in ('point','point_x','point_y','head','max_track','learning_rate','scalar','quantum'):
        if key in c:
            if key == 'point' and task == 'limit':
                continue
            _number(c[key])
    for key,limit in (('frames',8),('epochs',30),('iterations',120),('deletion_count',80)):
        if key in c: _number(c[key],integer=True,minimum=0 if key=='deletion_count' else 1,maximum=limit)
    if 'order' in c:
        _number(c['order'],integer=True,minimum=1,maximum=10)
    for key in ('expression','implicit_expression','integrand'):
        if key in c and (not isinstance(c[key],str) or not 1<=len(c[key])<=600):
            raise ValueError('表达式必须是600字以内的数学字符串')
    if 'variable' in c: _choice(c['variable'],('x','y','t','z'))
    if 'region_kind' in c: _choice(c['region_kind'],('between_axis','vertical_inequality'))
    if 'rotation_axis' in c: _choice(c['rotation_axis'],('x',))
    if 'heap_type' in c: _choice(c['heap_type'],('min','max'))
    if task == 'limit':
        _choice(c.get('side','both'),('both','left','right'))
        point = c['point']
        if isinstance(point,str):
            normalized = point.strip().replace('＋','+').replace('−','-').replace(' ', '')
            if normalized not in ('oo','+oo','inf','+inf','∞','+∞','-oo','-inf','-∞'):
                raise ValueError('极限点必须是有限数或 ±∞')
        else:
            _number(point)
    if task == 'function_study':
        has_lower, has_upper = 'lower' in c, 'upper' in c
        if has_lower != has_upper:
            raise ValueError('研究区间的上下限必须同时给出或同时省略')
        if has_lower:
            _number(c['lower']); _number(c['upper'])
            if c['lower'] >= c['upper']:
                raise ValueError('研究区间的下限必须小于上限')
    if task=='matmul':
        _choice(c['op'],('mul','add','sub','scalar'))
        _require(c,['scalar'] if c['op']=='scalar' else ['matrix_b'])
        if c['op']=='scalar' and 'matrix_b' in c:
            raise ValueError('数乘任务不能忽略额外的矩阵B')
    if task=='series_convergence':
        if not isinstance(c['term'], str) or not 1 <= len(c['term']) <= 600:
            raise ValueError('级数通项必须是600字以内的字符串')
        if 'index_start' in c:
            _number(c['index_start'], integer=True, minimum=0, maximum=100)
    if task=='power_series':
        _choice(c.get('goal'), ('radius','sum','expand'))
        if c.get('goal') in ('radius','sum'):
            if not isinstance(c.get('coefficient'), str) or not 1 <= len(c['coefficient']) <= 600:
                raise ValueError('幂级数系数必须是600字以内的字符串')
        else:
            if not isinstance(c.get('expression'), str) or not 1 <= len(c['expression']) <= 600:
                raise ValueError('幂级数展开需要函数表达式')
            if 'order' not in c:
                raise ValueError('幂级数展开需要阶数')
        if 'center' in c and not isinstance(c['center'], str):
            c['center'] = str(c['center'])
        if 'index_start' in c:
            _number(c['index_start'], integer=True, minimum=0, maximum=100)
    if task=='fourier_series':
        if not all(isinstance(c.get(key), str) for key in ('expression','lower','upper')):
            raise ValueError('傅里叶级数需要函数表达式和有限区间')
        if 'order' in c:
            _number(c['order'], integer=True, minimum=1, maximum=12)
    if task=='ode':
        if not isinstance(c['equation'], str) or not 1 <= len(c['equation']) <= 600:
            raise ValueError('微分方程必须是600字以内的字符串')
        _choice(c.get('independent_variable','x'), ('x','t'))
        _choice(c.get('dependent_variable','y'), ('y',))
        if 'initial_conditions' in c:
            if not isinstance(c['initial_conditions'], list) or len(c['initial_conditions']) > 6 or any(not isinstance(v,str) for v in c['initial_conditions']):
                raise ValueError('初值条件必须是最多6条字符串')
        _choice(c.get('target_kind','none'), ('none','value','area','integral','volume_x'))
    if task=='constrained_extrema':
        if c['variables'] != ['x','y']:
            raise ValueError('等式约束极值当前只支持 x、y 两个变量')
        if not isinstance(c['constraint'], str) or not 1 <= len(c['constraint']) <= 600:
            raise ValueError('等式约束必须是600字以内的字符串')
        if any(symbol in c['constraint'] for symbol in ('<=', '>=', '≤', '≥', '<', '>')):
            raise ValueError('当前只支持等式约束，不支持不等式约束')
    if task=='optimization':
        _choice(c['goal'],('extrema','gradient_descent'))
        if c['variables'] not in (['x'],['y'],['x','y']): raise ValueError('优化仅支持x/y的一维或二维目标')
        if not isinstance(c['bounds'],dict) or set(c['bounds'])-set(c['variables']): raise ValueError('约束只能是已声明变量的闭区间')
        for pair in c['bounds'].values():
            _vector(pair,2)
            if len(pair)!=2 or pair[0]>=pair[1]: raise ValueError('闭区间上下界不正确')
        if c['goal']=='gradient_descent': _require(c,['initial_point','learning_rate','iterations'])
        if 'initial_point' in c and len(c['initial_point'])!=len(c['variables']): raise ValueError('初始点与变量维数不一致')
    if task=='bfs':
        _names(c['nodes'])
        if type(c['directed']) is not bool or c['start'] not in c['nodes']: raise ValueError('请确认图的方向和有效起点')
        _choice(c['neighbor_order'],('lexicographic_by_id',))
        if not isinstance(c['edges'],list) or len(c['edges'])>80: raise ValueError('边集合格式或大小不正确')
        for edge in c['edges']:
            if not isinstance(edge,dict) or set(edge)!={'from','to'} or any(v not in c['nodes'] for v in edge.values()):
                raise ValueError('边的端点必须属于节点集合')
    if task in ('heap','heap_compare'):
        operation=c.get('operation','delete')
        _choice(operation,('delete','insert'))
        if operation=='delete':
            _require(c,['deletion_count'])
        elif 'deletion_count' in c:
            raise ValueError('插入建堆不接受删除次数')
        if 'count_comparisons' in c and type(c['count_comparisons']) is not bool:
            raise ValueError('比较次数选项必须是布尔值')
    if task=='binary_search_count':
        _number(c['n'],integer=True,minimum=1,maximum=10**9)
    if task=='cpu_schedule':
        _choice(c['algorithm'],('fcfs','sjf','srtf','rr','priority'))
        if c['algorithm']=='rr': _require(c,['quantum'])
        if 'quantum' in c and c['quantum']<=0: raise ValueError('时间片必须大于零')
        if not isinstance(c['processes'],list) or not 1<=len(c['processes'])<=12: raise ValueError('进程表大小不正确')
        _names([p.get('id') for p in c['processes'] if isinstance(p,dict)])
        for p in c['processes']:
            if not isinstance(p,dict) or set(p)-{'id','arrival','burst','priority'}: raise ValueError('进程表字段不正确')
            _require(p,['id','arrival','burst']+(['priority'] if c['algorithm']=='priority' else []))
            _number(p['arrival'],minimum=0)
            _number(p['burst'],minimum=1e-9)
            if 'priority' in p: _number(p['priority'])
    if task=='page_replace':
        _choice(c['algorithm'],('fifo','lru','opt'))
        if not isinstance(c['reference'],list) or not 1<=len(c['reference'])<=80 or any(
            not isinstance(v,(str,int)) or isinstance(v,bool) or len(str(v))>24 for v in c['reference']): raise ValueError('页面访问序列格式不正确')
        if 'initial_frames' in c:
            initial=c['initial_frames']
            if not isinstance(initial,list) or len(initial)>8 or any(
                not isinstance(v,(str,int)) or isinstance(v,bool) or len(str(v))>24 for v in initial):
                raise ValueError('初始驻留页面格式不正确')
            if len({str(v) for v in initial})!=len(initial):
                raise ValueError('初始驻留页面不能重复')
            if len(initial)>c['frames']:
                raise ValueError('初始驻留页面数不能超过物理块数')
    if task=='disk_schedule':
        _choice(c['algorithm'],('fcfs','sstf','scan','cscan','look','clook'))
        if c['algorithm'] in ('scan','cscan'): _require(c,['max_track'])
        if c['algorithm'] in ('scan','cscan','look','clook'): _require(c,['direction'])
        if c['algorithm'] in ('cscan','clook'): _require(c,['return_cost'])
        if 'direction' in c: _choice(c['direction'],('up','down'))
        if 'return_cost' in c: _choice(c['return_cost'],('count','skip'))
    if task=='banker':
        _names(c['names'])
        if len(c['names'])!=len(c['allocation']): raise ValueError('进程名称与资源矩阵行数不一致')
        if 'request' in c:
            r=c['request']
            if not isinstance(r,dict) or set(r)!={'process','vector'} or r['process'] not in c['names']: raise ValueError('资源请求进程不正确')
            _vector(r['vector'],8)
        counts=[*c['available'],*[v for row in c['allocation'] for v in row],*[v for row in c['max'] for v in row]]
        if 'request' in c: counts.extend(c['request']['vector'])
        for value in counts: _number(value,integer=True,minimum=0)
    if task=='neural_training':
        sizes=c['layers']
        if not isinstance(sizes,list) or not 2<=len(sizes)<=4: raise ValueError('网络仅支持二至四层')
        for size in sizes: _number(size,integer=True,minimum=1,maximum=8)
        acts=c['activations']
        if not isinstance(acts,list) or len(acts)!=len(sizes)-1 or acts[-1]!='linear' or len(set(acts[:-1]))>1:
            raise ValueError('当前内核要求隐藏层使用同一种激活，输出层为linear')
        for act in acts: _choice(act,('linear','relu','sigmoid','tanh'))
        if not isinstance(c['weights'],list) or not isinstance(c['biases'],list) or len(c['weights'])!=len(sizes)-1 or len(c['biases'])!=len(sizes)-1:
            raise ValueError('网络权重或偏置的层数不正确')
        for i,w in enumerate(c['weights']):
            _matrix(w); _vector(c['biases'][i],8)
            if len(w)!=sizes[i+1] or len(w[0])!=sizes[i] or len(c['biases'][i])!=sizes[i+1]: raise ValueError('网络权重或偏置维度不正确')
        if len(c['input'])!=sizes[0] or len(c['target'])!=sizes[-1]: raise ValueError('网络输入或目标维度不正确')
    if 'learning_rate' in c and c['learning_rate']<=0: raise ValueError('学习率必须大于零')


def compile_kernel_problem(plan: Mapping):
    from .recognize import build_problem, _attach_solution
    from .expr import expression_text, parse_expression, safe_float
    from .exam_math import _condition
    task=plan.get('task')
    if not isinstance(task,str) or task not in TASKS:
        raise ValueError('当前没有该题型的计算与可视化内核')
    c=plan.get('conditions')
    if not isinstance(c,dict) or len(json.dumps(c,allow_nan=False))>15000:
        raise ValueError('建模条件必须是大小受限的JSON对象')
    c=copy.deepcopy(c)
    if task=='implicit_normal' and isinstance(c.get('implicit_expression'), str) and '=' in c['implicit_expression']:
        parts=c['implicit_expression'].split('=')
        if len(parts)!=2 or not all(p.strip() for p in parts):
            raise ValueError('隐式曲线方程必须只有一个等号')
        c['implicit_expression']=f'({parts[0]})-({parts[1]})'
    _validate(task,c)
    if task=='constrained_extrema':
        from .constrained import build_constrained_problem
        from .recognize import _attach_solution
        p=build_constrained_problem(c)
        p['model']['modeling_task']=task
        _attach_solution(p)
        if p['status']!='ready' or not p['solution'].get('answer'):
            raise ModelConditionsError([p['solution'].get('summary') or '当前等式约束极值无法完整求解'])
        return p
    if task=='ode':
        from .ode import build_ode_problem
        from .recognize import _attach_solution
        p=build_ode_problem(c)
        p['model']['modeling_task']=task
        _attach_solution(p)
        if p['status']!='ready' or not p['solution'].get('answer'):
            raise ModelConditionsError([p['solution'].get('summary') or '当前微分方程无法完整求解'])
        return p
    if task == 'proof':
        from .proof import build_proof_problem
        from .recognize import _attach_solution
        _choice(c.get('proof_kind'), ('ivt_root','rolle','mvt','monotone_inequality','counterexample','steps'))
        p=build_proof_problem(c)
        p['model']['modeling_task']=task
        _attach_solution(p)
        if p['status']!='ready' or not p['solution'].get('answer'):
            raise ModelConditionsError([p['solution'].get('summary') or '当前证明尝试未认证或条件不成立'])
        return p
    if task == 'binary_search_count':
        from .binary_search import build_binary_search_problem
        p=build_binary_search_problem(c)
        p['model']['modeling_task']=task
        return p
    if task in ('triple_integral','line_integral','surface_integral','green','gauss','stokes','space_geometry'):
        from .space import build_space_problem
        from .recognize import _attach_solution
        p=build_space_problem(task,c)
        p['model']['modeling_task']=task
        _attach_solution(p)
        if p['status']!='ready' or not p['solution'].get('answer'):
            raise ModelConditionsError([p['solution'].get('summary') or '当前空间任务无法完整求解'])
        return p
    if task in ('series_convergence','power_series','fourier_series'):
        from . import series as series_kernel
        from .recognize import _attach_solution
        builder = {'series_convergence':series_kernel.build_series_problem,
                   'power_series':series_kernel.build_power_series_problem,
                   'fourier_series':series_kernel.build_fourier_problem}[task]
        p=builder(c)
        p['model']['modeling_task']=task
        _attach_solution(p)
        if p['status']!='ready' or not p['solution'].get('answer'):
            raise ModelConditionsError([p['solution'].get('summary') or '当前级数任务无法完整求解'])
        return p
    def scalar(value):
        raw=str(value)
        expression=parse_expression(raw,('x',))
        if expression.free_symbols or safe_float(expression) is None: raise ValueError('区间端点必须是有限实数')
        return expression_text(expression)
    subject=TASKS[task]['subject']
    text=TASKS[task]['label']
    overrides={**c}
    if task in ('limit','taylor','higher_derivative','function_study'):
        overrides['calculus_kind']=task
        overrides.setdefault('side','both')
    if task in ('integral','antiderivative','derivative'):
        v=c['variable']; f=c['expression']
        if task=='integral':
            a,b=scalar(c['lower']),scalar(c['upper'])
            text=f'计算定积分 ∫_{{{a}}}^{{{b}}} {f} d{v}'
            overrides.update(lower=float(parse_expression(a)),upper=float(parse_expression(b)))
        elif task=='antiderivative': text=f'计算不定积分 ∫ {f} d{v}'
        else: text=f'求函数 f({v})={f} 在 {v}={c["point"]} 处的导数'
        overrides.update(condition_values={k:c[k] for k in ('point',) if k in c})
    elif task in ('geometric_area','rotation_volume'):
        a,b=scalar(c['lower']),scalar(c['upper'])
        region=f'0<=y<={c["expression"]}' if c['region_kind']=='vertical_inequality' else f'y={c["expression"]}'
        text=f'D={{{region},{a}<=x<={b}}}，'+('求与x轴之间的面积。' if task=='geometric_area' else '求绕x轴旋转的体积。')
    elif task=='implicit_normal':
        text=f'曲线 {c["implicit_expression"]}=0 在 x={c["point_x"]} 处的法线斜率'
        overrides.update(point=c['point_x'])
    elif task=='double_integral':
        text='二重积分 ' + c.get('region_text', '')
        overrides.pop('region_text', None)
    elif task=='optimization':
        text=f'求函数 f({",".join(c["variables"])})={c["expression"]} 的极值。'
        overrides['variables']=','.join(c['variables'])
        overrides['condition_values']={k:c[k] for k in ('learning_rate','iterations') if k in c}
        overrides['condition_values'].update({f'{v}0':q for v,q in zip(c['variables'],c.get('initial_point',[]))})
    elif task=='bfs': text=('有向图' if c['directed'] else '无向图')+' BFS'
    elif task in ('heap','heap_compare'):
        overrides['operation']=c.get('operation','delete')
        if task=='heap_compare': overrides['count_comparisons']=True
    elif task in ('linear_system','determinant','inverse','matmul'): overrides['la_kind']=task
    elif task in ('cpu_schedule','page_replace','disk_schedule','banker'):
        overrides['os_kind']=task
        if task=='disk_schedule' and 'max_track' not in c:
            overrides['max_track']=max([c['head'],*c['requests']])
        if task=='banker' and 'request' in c:
            overrides['request']={**c['request'],'process':f'P{c["names"].index(c["request"]["process"])}'}
    elif task=='neural_training':
        # Use the house builder for controls, then replace all numerical network inputs.
        text='神经网络 '+'-'.join(str(v) for v in c['layers'])
        text+=f' 输入={c["input"]} 目标={c["target"][0]} 学习率={c["learning_rate"]} 训练{c["epochs"]}轮 '
        text+=' '.join(f'W{i+1}={json.dumps(w)}' for i,w in enumerate(c['weights']))
    p=build_problem(text,subject_hint=subject,overrides=overrides)
    model=p['model']
    if task=='integral':
        model['exact_bounds']={'lower':a,'upper':b}
    if task=='optimization':
        model.update(goal=c['goal'],bounds=c['bounds'])
        model['defaults']['bounds']=c['bounds']
        for v in c['variables']:
            values=[model['defaults'][f'{v}0'],*c['bounds'].get(v,[])]
            model['domain'][f'{v}_min']=min(model['domain'][f'{v}_min'],min(values)-1)
            model['domain'][f'{v}_max']=max(model['domain'][f'{v}_max'],max(values)+1)
        for item in p['recognition']['conditions']:
            if item['id'] in overrides['condition_values']:
                item.update(value=overrides['condition_values'][item['id']],provenance='original',note=None)
    if task=='bfs':
        model.update(nodes=[{'id':n,'label':n} for n in c['nodes']],edges=c['edges'],directed=c['directed'],
                     start=c['start'],defaults={'start':c['start']},teaching=False,provenance_note=None)
        model['params'][0]['options']=c['nodes']
        p['recognition']['conditions']=[]
        p['recognition']['ambiguities']=[]
        p['status']='ready'
    if task=='banker': model.update(names=c['names'],request=c.get('request'))
    if task in ('heap','heap_compare'):
        model['operation']=c.get('operation','delete')
        model['defaults']['operation']=model['operation']
        if task=='heap_compare':
            model['count_comparisons']=True
            model['defaults']['count_comparisons']=True
    if task=='disk_schedule':
        if 'return_cost' in c: model['defaults']['return_cost']=c['return_cost']
        if 'max_track' not in c:
            for item in p['recognition']['conditions']:
                if item['id']=='max_track': item.update(provenance='supplement',note='仅作为可视化坐标范围，不参与该算法的边界回扫')
    if task=='neural_training':
        model.update(layers=[{'size':size,'activation':'input' if i==0 else c['activations'][i-1]} for i,size in enumerate(c['layers'])],
                     weights=c['weights'],biases=c['biases'],input=c['input'],target=c['target'],
                     activation=c['activations'][0],weight_source='original',teaching=False,provenance_note=None)
        model['defaults'].update(learning_rate=c['learning_rate'],epochs=c['epochs'],
                                 **{f'input_{i+1}':v for i,v in enumerate(c['input'])})
        p['recognition']['ambiguities']=[]
        for item in p['recognition']['conditions']:
            if item['id'] in c: item.update(value=c[item['id']],provenance='original',note=None)
            if item['id']=='activation': item.update(value=model['activation'],provenance='original',note=None)
    if p['status']!='ready' or model.get('teaching'):
        raise ModelConditionsError([a['question'] for a in p['recognition']['ambiguities'] if a['severity']=='blocking'] or ['当前条件无法建立原题模型'])
    # Keep the complete typed input visible, including inputs the legacy builders only display indirectly.
    for key,value in c.items():
        if not any(v['id']==key for v in p['recognition']['conditions']):
            p['recognition']['conditions'].append(_condition(key,key,value,{},kind='json' if isinstance(value,(list,dict)) else 'text'))
    if task=='optimization' and c['goal']=='gradient_descent':
        p['solution']={'answer':'等待内核迭代','steps':[]}
    else:
        _attach_solution(p)
    if task=='heap_compare':
        from .heap import evaluate_heap
        outcome=evaluate_heap(model, model.get('defaults') or {})
        if outcome.get('status')!='ok' or 'compare_count' not in outcome:
            raise ModelConditionsError(['当前堆操作无法给出确定的关键字比较次数'])
        p['solution']['answer']=f"{outcome['answer']}；共 {outcome['compare_count']} 次关键字比较"
    if p['status']!='ready' or not p['solution'].get('answer'):
        raise ModelConditionsError([p['solution'].get('summary') or '当前条件无法求解'])
    p['model']['modeling_task']=task
    return p
