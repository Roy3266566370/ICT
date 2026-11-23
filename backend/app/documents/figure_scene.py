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
    return accepted
