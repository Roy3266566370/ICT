"""混合匹配：规则召回、词汇语义召回、受限模型建议与程序裁决。"""

from .pipeline import build_template_options, match_conditions, run_hybrid_matching
from .proposal import propose_matches
from .recall import recall_candidates
from .resolver import resolve_match

__all__ = [
    "build_template_options",
    "match_conditions",
    "propose_matches",
    "recall_candidates",
    "resolve_match",
    "run_hybrid_matching",
]
