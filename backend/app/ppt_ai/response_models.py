"""Shape checks before the existing semantic validators and sandbox checks."""
from typing import Literal

from pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr, model_validator

from ..structured_llm import JsonObject

Number = StrictInt | StrictFloat


class ProgramPayload(JsonObject):
    program: StrictStr = Field(min_length=1)


class PageLabParameter(BaseModel):
    id: StrictStr
    label: StrictStr
    min: Number
    max: Number
    step: Number
    default: Number
    unit: StrictStr = ''


class TimelineStop(BaseModel):
    t: Number
    label: StrictStr


class Timeline(BaseModel):
    duration_s: Number
    stops: list[TimelineStop] = Field(min_length=2, max_length=12)


class PageLabPayload(ProgramPayload):
    title: StrictStr
    summary: StrictStr
    params: list[PageLabParameter] = Field(min_length=1, max_length=6)
    timeline: Timeline
    public_params: list[StrictStr] = Field(default_factory=list)
    explain: list[StrictStr] = Field(default_factory=list)


class PlanPayload(JsonObject):
    options: list[dict]


class MatchPayload(JsonObject):
    regions: list[dict]


class DiagramPayload(JsonObject):
    nodes: list[dict]
    edges: list[dict]


class QuestionPayload(JsonObject):
    question: StrictStr = Field(min_length=1)
    conditions: list = Field(default_factory=list)
    subquestions: list[StrictStr] = Field(default_factory=list)


class LabModelPayload(JsonObject):
    model: dict
    question: StrictStr | None = None
    answer: StrictStr | None = None


class ChartSeries(BaseModel):
    name: StrictStr
    values: list[Number]


class ChartDataExtract(JsonObject):
    is_chart: StrictBool
    title: StrictStr | None = None
    chart_type: Literal['COLUMN_CLUSTERED', 'BAR_CLUSTERED', 'LINE', 'PIE', 'AREA', 'XY_SCATTER'] | None = None
    categories: list[StrictStr] | None = None
    series: list[ChartSeries] | None = None
    confidence: Number | None = None

    @model_validator(mode='after')
    def check_chart(self):
        if self.is_chart:
            if not self.chart_type or self.confidence is None or not 0 <= self.confidence <= 1:
                raise ValueError('图表需要 chart_type 和 0~1 的 confidence')
            if not self.categories or not 2 <= len(self.categories) <= 40 or not self.series or not 1 <= len(self.series) <= 8:
                raise ValueError('图表需要 2~40 个分类及 1~8 个系列')
            if any(len(entry.values) != len(self.categories) for entry in self.series):
                raise ValueError('series.values 长度必须与 categories 一致')
        return self


RESPONSE_MODELS = {
    'page_lab': PageLabPayload,
    'generated_view': ProgramPayload,
    'plan_refine': PlanPayload,
    'match_propose': MatchPayload,
    'inline_diagram': DiagramPayload,
    'lab_read_question': QuestionPayload,
    'lab_model_question': LabModelPayload,
    'lab_repair_model': LabModelPayload,
    'lab_understand_and_solve': LabModelPayload,
}
