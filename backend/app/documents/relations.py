"""Declarative scene-node relations and whitelist expression validation (M4)."""
from __future__ import annotations

import ast
import math
import re
from typing import Annotated, Any, Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Ident = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_-]{1,96}$')]
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=240)]
ExprText = Annotated[str, StringConstraints(min_length=1, max_length=400)]
RelationProvenance = Literal['auto', 'user', 'legacy']
GuideAnchor = Literal['start', 'end', 'center']

SOURCE_PROPERTIES = (
    'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'length', 'angle',
    'x', 'y', 'width', 'height', 'rotation', 'opacity',
)
TARGET_PROPERTIES = (
    'length', 'angle', 'x', 'y', 'width', 'height', 'rotation', 'opacity',
    'text', 'x1', 'y1', 'x2', 'y2',
)
RelationSourceProperty = Literal[
    'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'length', 'angle',
    'x', 'y', 'width', 'height', 'rotation', 'opacity',
]
RelationTargetProperty = Literal[
    'length', 'angle', 'x', 'y', 'width', 'height', 'rotation', 'opacity',
    'text', 'x1', 'y1', 'x2', 'y2',
]

VIEWER_PARAMETERS = (
    'geometry', 'style', 'flow',
    'start', 'end', 'length', 'angle', 'color', 'line_style', 'stroke_width',
)

ALLOWED_FUNCTIONS: dict[str, tuple[int, int]] = {
    'abs': (1, 1),
    'min': (1, 16),
    'max': (1, 16),
    'sqrt': (1, 1),
    'pow': (2, 2),
    'round': (1, 1),
    'floor': (1, 1),
    'ceil': (1, 1),
    'sin': (1, 1),
    'cos': (1, 1),
    'tan': (1, 1),
    'asin': (1, 1),
    'acos': (1, 1),
    'atan2': (2, 2),
    'log': (1, 1),
    'exp': (1, 1),
}

_DOT_PROP_RE = re.compile(
    r'\b([A-Za-z_][A-Za-z0-9_]*)\.(' + '|'.join(SOURCE_PROPERTIES) + r')\b'
)
_ALIAS_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
MAX_RELATIONS_PER_PAGE = 32


def validate_relation_expression(
    expression: str,
    bindings: dict[str, ExprBindingSource] | None = None,
) -> set[str]:
    """Validate an expression against the safe whitelist grammar and return referenced node IDs."""
    if not isinstance(expression, str) or not expression.strip():
        raise ValueError('关系表达式不能为空')
    if len(expression) > 400:
        raise ValueError('关系表达式超过长度上限')
    if '__' in expression:
        raise ValueError('关系表达式包含禁止标识符')

    referenced_nodes: set[str] = set()
    implicit_aliases: dict[str, str] = {}

    def _replace_dot(match: re.Match[str]) -> str:
        node_id, prop = match.group(1), match.group(2)
        alias = f'{node_id}_{prop}'
        implicit_aliases[alias] = node_id
        return alias

    normalized = _DOT_PROP_RE.sub(_replace_dot, expression)
    # Translate JS logical/ternary tokens into Python AST-checkable equivalents is unnecessary
    # if we reject arbitrary Python constructs; translate && / || for AST validation when present.
    py_candidate = re.sub(r'&&', ' and ', normalized)
    py_candidate = re.sub(r'\|\|', ' or ', py_candidate)
    if '!' in py_candidate:
        py_candidate = re.sub(r'!(?!=)', ' not ', py_candidate)

    try:
        tree = ast.parse(py_candidate, mode='eval')
    except SyntaxError as exc:
        col = exc.offset or 1
        raise ValueError(f'第 {col} 列：关系表达式语法错误') from exc

    allowed_nodes = (
        ast.Expression, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp,
        ast.Call, ast.Constant, ast.Name, ast.Load,
        ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow,
        ast.UAdd, ast.USub, ast.Not, ast.And, ast.Or,
        ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE,
    )
    binding_map = bindings or {}
    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            raise ValueError('关系表达式包含不允许的语法结构')
        if isinstance(node, ast.Constant):
            if type(node.value) not in (int, float, str, bool):
                raise ValueError('关系表达式常量类型不合法')
            if isinstance(node.value, float) and not math.isfinite(node.value):
                raise ValueError('关系表达式包含非有限数值')
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.keywords:
                raise ValueError('关系表达式仅允许调用白名单数学函数')
            fn_name = node.func.id
            sig = ALLOWED_FUNCTIONS.get(fn_name)
            if sig is None:
                raise ValueError(f'未知函数 {fn_name}')
            if not (sig[0] <= len(node.args) <= sig[1]):
                raise ValueError(f'函数 {fn_name} 参数个数不合法')
        elif isinstance(node, ast.Name):
            name = node.id
            if name in ALLOWED_FUNCTIONS:
                continue
            if name in binding_map:
                referenced_nodes.add(binding_map[name].nodeId)
            elif name in implicit_aliases:
                referenced_nodes.add(implicit_aliases[name])
            else:
                # Check suffix pattern <nodeId>_<prop>
                matched = False
                for prop in SOURCE_PROPERTIES:
                    suffix = f'_{prop}'
                    if name.endswith(suffix) and len(name) > len(suffix):
                        referenced_nodes.add(name[:-len(suffix)])
                        matched = True
                        break
                if not matched:
                    raise ValueError(f'未知变量或属性引用：{name}')
    return referenced_nodes


class _Base(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ExprBindingSource(_Base):
    nodeId: Ident
    property: RelationSourceProperty


class GuideEndpoint(_Base):
    nodeId: Ident
    anchor: GuideAnchor = 'end'


class BasisDecomposeRelation(_Base):
    id: Ident
    kind: Literal['basis_decompose']
    name: ShortText | None = None
    enabled: bool = True
    provenance: RelationProvenance = 'auto'
    firstId: Ident
    secondId: Ident
    resultId: Ident
    guideIds: list[Ident] = Field(default_factory=list, max_length=4)
    labelId: Ident | None = None
    labelTemplate: ShortText | None = None
    degenerateText: ShortText | None = None
    title: tuple[float, float] | None = None
    fontSize: float | None = Field(default=None, gt=0, le=200, allow_inf_nan=False)

    @model_validator(mode='after')
    def _check_ids(self):
        core = {self.firstId, self.secondId, self.resultId}
        if len(core) != 3:
            raise ValueError('换基关系的两个基向量与目标向量必须互不相同')
        if len(set(self.guideIds)) != len(self.guideIds):
            raise ValueError('辅助线标识不能重复')
        if core & set(self.guideIds):
            raise ValueError('辅助线不能与基向量或目标向量相同')
        if self.labelId and (self.labelId in core or self.labelId in self.guideIds):
            raise ValueError('坐标文字节点不能与向量或辅助线节点相同')
        if self.title is not None and not all(math.isfinite(v) and -20000 <= v <= 20000 for v in self.title):
            raise ValueError('标题坐标超出范围')
        return self


class LinearComboRelation(_Base):
    id: Ident
    kind: Literal['linear_combo']
    name: ShortText | None = None
    enabled: bool = True
    provenance: RelationProvenance = 'user'
    firstId: Ident
    secondId: Ident
    targetId: Ident
    a: float | ExprText
    b: float | ExprText
    guideIds: list[Ident] = Field(default_factory=list, max_length=4)

    @model_validator(mode='after')
    def _check_combo(self):
        if len({self.firstId, self.secondId, self.targetId}) != 3:
            raise ValueError('线性组合的基向量与目标向量必须互不相同')
        for coeff in (self.a, self.b):
            if isinstance(coeff, (int, float)):
                if not math.isfinite(coeff) or abs(coeff) > 10000:
                    raise ValueError('线性组合系数必须为有限数值')
            else:
                refs = validate_relation_expression(coeff)
                if self.targetId in refs:
                    raise ValueError('线性组合系数表达式不能自引用目标向量')
        return self


class GuideBindRelation(_Base):
    id: Ident
    kind: Literal['guide_bind']
    name: ShortText | None = None
    enabled: bool = True
    provenance: RelationProvenance = 'user'
    targetId: Ident
    from_: GuideEndpoint = Field(alias='from')
    to: GuideEndpoint

    model_config = ConfigDict(extra='forbid', populate_by_name=True)

    @model_validator(mode='after')
    def _check_endpoints(self):
        if self.targetId in (self.from_.nodeId, self.to.nodeId):
            raise ValueError('辅助线绑定不能引用自身作为端点来源')
        if self.from_.nodeId == self.to.nodeId and self.from_.anchor == self.to.anchor:
            raise ValueError('辅助线起止绑定不能指向同一锚点')
        return self


class ExprRelation(_Base):
    id: Ident
    kind: Literal['expr']
    name: ShortText | None = None
    enabled: bool = True
    provenance: RelationProvenance = 'user'
    targetId: Ident
    targetProperty: RelationTargetProperty
    expression: ExprText
    bindings: dict[str, ExprBindingSource] = Field(default_factory=dict)
    formatTemplate: ShortText | None = None
    precision: int = Field(default=2, ge=0, le=6)

    @model_validator(mode='after')
    def _check_expr(self):
        if len(self.bindings) > 16:
            raise ValueError('单条表达式绑定变量不能超过 16 个')
        for alias in self.bindings:
            if not _ALIAS_RE.fullmatch(alias) or alias in ALLOWED_FUNCTIONS:
                raise ValueError(f'绑定变量名不合法：{alias}')
        refs = validate_relation_expression(self.expression, self.bindings)
        if self.targetId in refs:
            raise ValueError('表达式关系不能自引用目标节点')
        return self


SceneRelationModel = Annotated[
    BasisDecomposeRelation | LinearComboRelation | GuideBindRelation | ExprRelation,
    Field(discriminator='kind'),
]


def _relation_edges(item: BasisDecomposeRelation | LinearComboRelation | GuideBindRelation | ExprRelation) -> tuple[set[str], set[str]]:
    if isinstance(item, BasisDecomposeRelation):
        inputs = {item.firstId, item.secondId, item.resultId}
        outputs = set(item.guideIds) | ({item.labelId} if item.labelId else set())
        return inputs, outputs
    if isinstance(item, LinearComboRelation):
        inputs = {item.firstId, item.secondId}
        for coeff in (item.a, item.b):
            if isinstance(coeff, str):
                inputs |= validate_relation_expression(coeff)
        outputs = {item.targetId, *item.guideIds}
        return inputs, outputs
    if isinstance(item, GuideBindRelation):
        return {item.from_.nodeId, self.to.nodeId if False else item.to.nodeId}, {item.targetId}
    refs = validate_relation_expression(item.expression, item.bindings)
    return refs, {item.targetId}


def validate_page_relations(
    raw_relations: Sequence[Any],
    nodes: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Validate a page's relations list, checking duplicates, node references, and dependency cycles."""
    if not isinstance(raw_relations, Sequence) or isinstance(raw_relations, (str, bytes)):
        raise ValueError('页面关系列表格式不合法')
    if len(raw_relations) > MAX_RELATIONS_PER_PAGE:
        raise ValueError(f'单页关系数量不能超过 {MAX_RELATIONS_PER_PAGE} 条')

    from pydantic import TypeAdapter
    adapter = TypeAdapter(SceneRelationModel)

    parsed: list[BasisDecomposeRelation | LinearComboRelation | GuideBindRelation | ExprRelation] = []
    seen_ids: set[str] = set()
    for raw in raw_relations:
        item = adapter.validate_python(raw)
        if item.id in seen_ids:
            raise ValueError(f'关系标识重复：{item.id}')
        seen_ids.add(item.id)
        parsed.append(item)

    if nodes is not None:
        known_ids = {str(n['id']) for n in nodes if isinstance(n, dict) and not n.get('deleted') and 'id' in n}
        for item in parsed:
            inputs, outputs = _relation_edges(item)
            missing = (inputs | outputs) - known_ids
            if missing:
                raise ValueError(f'关系 {item.id} 引用了不存在的节点：{sorted(missing)[0]}')

    # Check dependency cycles across enabled relations
    producers: dict[str, list[str]] = {}
    io_map: dict[str, tuple[set[str], set[str]]] = {}
    for item in parsed:
        if not item.enabled:
            continue
        inputs, outputs = _relation_edges(item)
        io_map[item.id] = (inputs, outputs)
        for out_node in outputs:
            producers.setdefault(out_node, []).append(item.id)

    adj: dict[str, set[str]] = {rel_id: set() for rel_id in io_map}
    for rel_id, (inputs, _) in io_map.items():
        for in_node in inputs:
            for upstream_rel in producers.get(in_node, ()):
                adj[rel_id].add(upstream_rel)

    state: dict[str, int] = {}  # 0/unset: unvisited, 1: visiting, 2: visited

    def _dfs(rel_id: str) -> bool:
        state[rel_id] = 1
        for dep in adj.get(rel_id, ()):
            dep_state = state.get(dep, 0)
            if dep_state == 1 or (dep_state == 0 and _dfs(dep)):
                return True
        state[rel_id] = 2
        return False

    for rel_id in adj:
        if state.get(rel_id, 0) == 0 and _dfs(rel_id):
            raise ValueError('关系之间存在循环依赖')

    return [item.model_dump(mode='json', by_alias=True, exclude_none=True) for item in parsed]
