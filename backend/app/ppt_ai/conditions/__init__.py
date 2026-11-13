"""结构化条件层：区域 → ConditionSet → 模板核验。"""

from .extract import extract_conditions, merge_condition_sets
from .validate import ConditionValidation, condition_summary, validate_template_conditions

__all__ = [
    "ConditionValidation",
    "condition_summary",
    "extract_conditions",
    "merge_condition_sets",
    "validate_template_conditions",
]
