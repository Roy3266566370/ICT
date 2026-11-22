"""Bounded, data-only math scenes shared by editor and presentation."""
import math


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('数学图参数须为范围内的有限数值')


def matrix2(value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError('须为二阶矩阵')
    for row in value:
        point2(row)


def point2(value):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError('须为二维向量')
    for n in value: number(n, -100, 100)


def validate_matrix_ocr(value):
    if not isinstance(value, dict) or set(value)-{'matrices', 'operation', 'operands', 'result'}:
        raise ValueError('矩阵识别配置不合法')
    matrices = value.get('matrices')
    if not isinstance(matrices, list) or not 1 <= len(matrices) <= 6:
        raise ValueError('矩阵数量不合法')
    for matrix in matrices:
        if not isinstance(matrix, dict) or set(matrix) != {'values', 'cells'}:
            raise ValueError('矩阵识别缺少数值或单元格坐标')
        rows, cells = matrix['values'], matrix['cells']
        if not isinstance(rows, list) or not 1 <= len(rows) <= 6:
            raise ValueError('矩阵行数不合法')
        if not isinstance(rows[0], list) or not 1 <= len(rows[0]) <= 6:
            raise ValueError('矩阵列数不合法')
        cols = len(rows[0])
        for row in rows:
            if not isinstance(row, list) or len(row) != cols: raise ValueError('矩阵行长度不一致')
            for n in row: number(n, -100, 100)
        if not isinstance(cells, list) or len(cells) != len(rows)*cols:
            raise ValueError('识别数字坐标不完整')
        seen = set()
        for cell in cells:
            if not isinstance(cell, dict) or set(cell) != {'row', 'col', 'bbox'}:
                raise ValueError('单元格坐标不合法')
            r, c, box = cell['row'], cell['col'], cell['bbox']
            if type(r) is not int or type(c) is not int or not 0 <= r < len(rows) or not 0 <= c < cols or (r, c) in seen:
                raise ValueError('单元格索引不合法')
            seen.add((r, c))
            if not isinstance(box, list) or len(box) != 4: raise ValueError('单元格范围不合法')
            for n in box: number(n, 0, 1)
            if box[2] <= 0 or box[3] <= 0 or box[0]+box[2] > 1.001 or box[1]+box[3] > 1.001:
                raise ValueError('单元格范围越界')
    if value.get('operation') is not None:
        indexes, result = value.get('operands'), value.get('result')
        if (value['operation'] != 'add' or not isinstance(indexes, list) or len(indexes) != 2
                or any(type(i) is not int or not 0 <= i < len(matrices) for i in indexes)
                or type(result) is not int or not 0 <= result < len(matrices)
                or len(set(indexes+[result])) != 3):
            raise ValueError('矩阵运算关系不合法')
        a, b = (matrices[i]['values'] for i in indexes)
        out = matrices[result]['values']
        if len(a) != len(b) or len(a) != len(out) or len(a[0]) != len(b[0]) or len(a[0]) != len(out[0]):
            raise ValueError('矩阵加法维度不匹配')
        if any(abs(a[r][c]+b[r][c]-out[r][c]) > 1e-6 for r in range(len(a)) for c in range(len(a[0]))):
            raise ValueError('识别的矩阵加法结果不一致')
    elif 'operands' in value or 'result' in value:
        raise ValueError('缺少矩阵运算类型')


def validate_math_scene(value):
    fields = {'view_box', 'matrix', 'vector', 'show_grid', 'show_circle', 'radius',
              'progress', 'animation_step', 'viewer_parameters'}
    optional = {'template', 'vectors', 'polygon', 'comparison_matrix', 'basis', 'steps', 'matrix_source'}
    if not isinstance(value, dict) or not fields <= set(value) or set(value)-fields-optional:
        raise ValueError('数学图配置不完整或包含未知字段')
    box = value['view_box']
    if not isinstance(box, dict) or set(box) != {'x', 'y'}:
        raise ValueError('坐标范围不合法')
    for axis in box.values():
        if not isinstance(axis, list) or len(axis) != 2:
            raise ValueError('坐标范围不合法')
        for n in axis: number(n, -100, 100)
        if axis[1] - axis[0] < .1: raise ValueError('坐标范围为空')
    matrix = value['matrix']
    if not isinstance(matrix, list) or len(matrix) != 2:
        raise ValueError('须为二阶矩阵')
    for row in [*matrix, value['vector']]:
        if not isinstance(row, list) or len(row) != 2:
            raise ValueError('须为二维向量或二阶矩阵')
        for n in row: number(n, -100, 100)
    for key in ('show_grid', 'show_circle'):
        if type(value[key]) is not bool: raise ValueError('数学图开关类型不合法')
    number(value['radius'], .1, 100)
    number(value['progress'], 0, 1)
    number(value['animation_step'], .001, .2)
    allowed = value['viewer_parameters']
    if (not isinstance(allowed, list) or len(allowed) > 5
            or any(k not in ('matrix', 'vector', 'progress', 'radius', 'style') for k in allowed)
            or len(set(allowed)) != len(allowed)):
        raise ValueError('观众可编辑参数不合法')
    if 'template' in value and value['template'] not in ('matrix_vector', 'circle_ellipse', 'det_area', 'basis_change', 'composition', 'svd'):
        raise ValueError('数学图类型不合法')
    for key, low, high in (('vectors', 1, 12), ('polygon', 3, 32)):
        if key in value:
            if not isinstance(value[key], list) or not low <= len(value[key]) <= high:
                raise ValueError('数学图点数不合法')
            for point in value[key]: point2(point)
    for key in ('comparison_matrix', 'basis'):
        if key in value: matrix2(value[key])
    if 'basis' in value:
        a, b = value['basis']
        if abs(a[0]*b[1]-a[1]*b[0]) < 1e-6: raise ValueError('新基必须可逆')
    if 'steps' in value:
        if not isinstance(value['steps'], list) or not 2 <= len(value['steps']) <= 6:
            raise ValueError('动画步骤数量不合法')
        for step in value['steps']:
            if (not isinstance(step, dict) or set(step) != {'label', 'matrix'}
                    or not isinstance(step['label'], str) or not 1 <= len(step['label']) <= 80):
                raise ValueError('动画步骤不合法')
            matrix2(step['matrix'])
    if 'matrix_source' in value:
        source = value['matrix_source']
        if (not isinstance(source, dict) or set(source) != {'node_id', 'matrix_index'}
                or not isinstance(source['node_id'], str) or not 1 <= len(source['node_id']) <= 96
                or type(source['matrix_index']) is not int or not 0 <= source['matrix_index'] < 6):
            raise ValueError('矩阵来源不合法')
