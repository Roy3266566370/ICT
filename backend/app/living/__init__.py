"""万象活页（Living Page）：任意文件 → "保真层 + 激活层"块序列。

- ``blockify``：抽取结果 → 保真块（页图/文本/公式/章节），转换无失败态；
- ``enrich``：在保真块上生成激活建议（题目→实验块、展示公式→公式块）；
- ``model``：块联合校验 + 建议物化（``accept`` 时保真块被替换，``source`` 链保留）；
- ``store``：文档装配、公开快照、资产白名单。

数据表在 ``db.models``：``living_pages`` / ``living_shares`` / ``living_progress``。
"""
