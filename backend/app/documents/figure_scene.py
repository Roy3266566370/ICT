"""Versioned, evidence-backed geometries in source-image pixels."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Provenance = Literal['native', 'pixel', 'vision', 'user_confirmed']
Ident = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_-]{1,64}$')]
Coordinate = Annotated[float, Field(ge=0, le=20000, allow_inf_nan=False)]
Point = tuple[Coordinate, Coordinate]
Text = Annotated[str, StringConstraints(min_length=1, max_length=500)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Frame(Model):
    width: int = Field(gt=0, le=20000)
    height: int = Field(gt=0, le=20000)


class System(Model):
    id: Ident
    origin_px: Point
    unit_px: float = Field(gt=0, le=20000, allow_inf_nan=False)


class Style(Model):
    stroke: str = Field(default='#18233D', pattern=r'^#[0-9a-fA-F]{6}$')
    width: float = Field(default=2, gt=0, le=100, allow_inf_nan=False)


class FigureObject(Model):
    id: Ident
    type: Literal['axis', 'segment', 'vector', 'polyline', 'dashed', 'text']
    points: list[Point] = Field(min_length=1, max_length=32)
    system_id: Ident | None = None
    text: Text | None = None
    style: Style = Field(default_factory=Style)
    provenance: Provenance
    evidence: list[Text] = Field(default_factory=list, max_length=12)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    bbox: tuple[Coordinate, Coordinate, Coordinate, Coordinate] | None = None
    label_id: Ident | None = None
    role: Literal['basis_vector', 'result_vector', 'coordinate_axis', 'guide', 'coordinate_label'] | None = None

    @model_validator(mode='after')
    def validate_geometry(self):
        if self.type == 'text':
            if len(self.points) != 1 or not self.text or not self.text.strip():
                raise ValueError('文字对象需要文字和一个定位点')
        elif self.type == 'polyline':
            if len(self.points) < 2:
                raise ValueError('折线至少需要两个点')
        elif len(self.points) != 2:
            raise ValueError('线对象需要两个端点')
        if any(a == b for a, b in zip(self.points, self.points[1:])):
            raise ValueError('对象包含重叠端点')
        if self.bbox is not None and (self.bbox[0] >= self.bbox[2] or self.bbox[1] >= self.bbox[3]):
            raise ValueError('文字框面积必须为正')
        return self


class Relation(Model):
    kind: Ident
    objects: list[Ident] = Field(min_length=2, max_length=16)


class FigureScene(Model):
    version: Literal[1]
    frame: Frame
    systems: list[System] = Field(default_factory=list, max_length=16)
    objects: list[FigureObject] = Field(default_factory=list, max_length=64)
    warnings: list[Text] = Field(default_factory=list, max_length=24)
    relations: list[Relation] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def validate_references(self):
        systems = {system.id for system in self.systems}
        objects = {item.id: item for item in self.objects}
        if len(systems) != len(self.systems) or len(objects) != len(self.objects):
            raise ValueError('场景标识重复')
        width, height = self.frame.width, self.frame.height
        for system in self.systems:
            if system.origin_px[0] > width or system.origin_px[1] > height:
                raise ValueError('坐标系原点超出裁图')
        labels = set()
        for item in self.objects:
            if item.system_id and item.system_id not in systems:
                raise ValueError('对象引用了不存在的坐标系')
            if any(x > width or y > height for x, y in item.points):
                raise ValueError('对象超出裁图')
            if item.bbox and (item.bbox[2] > width or item.bbox[3] > height):
                raise ValueError('文字框超出裁图')
            if item.label_id:
                target = objects.get(item.label_id)
                if item.type == 'text' or not target or target.type != 'text' or item.label_id in labels:
                    raise ValueError('标签关联无效或重复')
                labels.add(item.label_id)
        if any(not set(relation.objects) <= objects.keys() for relation in self.relations):
            raise ValueError('关系包含无效对象引用')
        return self


def _infer_basis_relations(scene: FigureScene) -> FigureScene:
    """Populate default roles and basis_decompose relations from geometric and OCR evidence."""
    import math

    by_system: dict[str, list[FigureObject]] = {}
    for obj in scene.objects:
        if obj.system_id:
            by_system.setdefault(obj.system_id, []).append(obj)

    vector_systems = [
        sys_id for sys_id, items in by_system.items()
        if sum(1 for item in items if item.type == 'vector' and len(item.points) == 2) >= 3
    ]
    if not vector_systems:
        return scene

    role_updates: dict[str, str] = {}
    relations: list[Relation] = list(scene.relations)
    existing_rel_keys = {(r.kind, tuple(r.objects[:3])) for r in relations}

    for sys_id in vector_systems:
        items = by_system[sys_id]
        for item in items:
            if item.type == 'axis' and not item.role:
                role_updates[item.id] = 'coordinate_axis'
            elif item.type == 'dashed' and not item.role:
                role_updates[item.id] = 'guide'
            elif item.type == 'text' and not item.role:
                role_updates[item.id] = 'coordinate_label'

        vectors = [item for item in items if item.type == 'vector' and len(item.points) == 2]
        guides = [item for item in items if item.type == 'dashed' and len(item.points) == 2]
        texts = [item for item in items if item.type == 'text' and item.text]

        vec_data = []
        for v in vectors:
            (x0, y0), (x1, y1) = v.points[0], v.points[1]
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length >= 12:
                vec_data.append((v, (x0, y0), (x1, y1), (dx, dy), length))

        best = None
        for i, (v1, s1, e1, d1, l1) in enumerate(vec_data):
            for j, (v2, s2, e2, d2, l2) in enumerate(vec_data):
                if i == j or math.dist(s1, s2) > min(l1, l2) * 0.25:
                    continue
                cross = d1[0] * d2[1] - d1[1] * d2[0]
                if abs(cross) < l1 * l2 * 0.2:
                    continue
                for k, (vr, sr, er, dr, lr) in enumerate(vec_data):
                    if k in (i, j) or lr < max(l1, l2) * 0.7 or math.dist(sr, s1) > min(l1, l2) * 0.25:
                        continue
                    c1 = (dr[0] * d2[1] - dr[1] * d2[0]) / cross
                    c2 = (d1[0] * dr[1] - d1[1] * dr[0]) / cross
                    if not (0.35 <= c1 <= 3.5 and 0.35 <= c2 <= 3.5):
                        continue
                    res_x = dr[0] - (c1 * d1[0] + c2 * d2[0])
                    res_y = dr[1] - (c1 * d1[1] + c2 * d2[1])
                    residual = math.hypot(res_x, res_y)
                    if residual > lr * 0.18:
                        continue
                    angle1 = abs(math.degrees(math.atan2(d1[1], d1[0])))
                    angle1 = min(angle1, abs(180 - angle1))
                    cos_angle = abs(d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)
                    score = angle1 + (residual / lr) * 30
                    if best is None or score < best[0]:
                        best = (score, v1, v2, vr, s1, (s1[0] + c1 * d1[0], s1[1] + c1 * d1[1]), cos_angle)

        if best is None:
            continue

        _, v1, v2, vr, origin_pt, corner_pt, cos_angle = best
        role_updates.setdefault(v1.id, 'basis_vector')
        role_updates.setdefault(v2.id, 'basis_vector')
        role_updates.setdefault(vr.id, 'result_vector')

        has_standard_text = any('标准基' in (t.text or '') for t in texts)
        has_oblique_text = any('斜基' in (t.text or '') for t in texts)
        is_oblique_geom = cos_angle > 0.18

        # In a multi-panel comparison figure (e.g. standard basis left vs oblique basis right),
        # keep the standard orthogonal panel static so only the oblique basis panel is bound.
        if len(vector_systems) > 1 and (has_standard_text or (not has_oblique_text and not is_oblique_geom and not guides)):
            continue

        ordered_guides = sorted(
            guides,
            key=lambda g: min(math.dist(g.points[0], origin_pt), math.dist(g.points[1], origin_pt))
            - min(math.dist(g.points[0], corner_pt), math.dist(g.points[1], corner_pt)),
        )
        label_obj = next((t for t in texts if '坐标' in (t.text or '') or '(' in (t.text or '') or '（' in (t.text or '')), texts[0] if texts else None)
        rel_objects = [v1.id, v2.id, vr.id, *(g.id for g in ordered_guides[:2])]
        if label_obj:
            rel_objects.append(label_obj.id)
        key = ('basis_decompose', tuple(rel_objects[:3]))
        if key not in existing_rel_keys:
            existing_rel_keys.add(key)
            relations.append(Relation(kind='basis_decompose', objects=rel_objects))

    updated_objects = [
        obj.model_copy(update={'role': role_updates[obj.id]}) if obj.id in role_updates and not obj.role else obj
        for obj in scene.objects
    ]
    return scene.model_copy(update={'objects': updated_objects, 'relations': relations[:16]})


def make_scene(image, systems, objects, warnings=()):
    frame = Frame(width=image.width, height=image.height)
    accepted = FigureScene(version=1, frame=frame, systems=systems)
    messages = list(warnings)
    for item in objects:
        try:
            accepted = FigureScene(version=1, frame=frame, systems=systems,
                                   objects=[*accepted.objects, FigureObject.model_validate(item)])
        except ValueError as error:
            messages.append(f'{item.get("id", "?")}：{str(error).splitlines()[1][:160]}')
    accepted.warnings = messages[:24]
    return _infer_basis_relations(accepted)
