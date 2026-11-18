# 题目实验室回归数据

- `problems.json`：手写的内核能力用例，不能代表模型建模成功率。
- `provider-cases.json`：2026-11-17 缺陷验收题目，只有题干与预期状态，没有预置模型。
- `provider-recording-2026-11-17.json`：真实云端两步流程返回，使用 JSON 对象模式。
- `provider-schema-recording-2026-11-17.json`：真实云端两步流程返回，启用 JSON Schema 与兼容回退。
- `provider-final-recording-2026-11-17.json`：修正变量名解析后，启用 Schema 的最终十题实测。
- `provider-image-recording-2026-11-17.json`：从生成的中文题目图片读题后返回；OCR 提示刻意不含具体数值。这是图片链路验收，不是用户原图的识别质量评估。

录制中的 `ai_output` 保存服务端收到的模型 JSON（两步流程会合入读题结果），`model_attempts` 保存内核尝试的模型、错误和修正模型。原始模型结构不先改写成标准格式。测试中的报告重建用例明确标注为重建，不冒充原始录制。

历史 Schema 录制还保留了一个错误模型：对数方程先变成多项式，再把定义域写成独立不等式，但没有筛选解集。旧结果含增根；当前回放必须拒绝该模型并进入待核对，不能将它计作正确就绪。最终录制单独验证修复后的行为。

在 `backend` 下运行离线回放，不调用外部模型：

```powershell
python -m pytest tests/test_labs_provider_replay.py tests/test_labs_model_contract.py
```

重新调用真实模型并保存报告：

```powershell
python scripts/eval_strangers.py --fixtures ../fixtures/strangers/provider-cases.json --ai --strict --record ../verify/provider-run.json
```

`--ai` 对每道题调用真实模型，包括带手写 `plan` 的历史用例。统计以 AI 解答附加后的最终状态为准，调用失败计为失败。`expect.answer` 可声明可比较的数学答案，`expect.answer_contains` 用于文本结果断言；离线回放还会独立核对这批计算题的数值、方程组、不等式和完整最值结果。

默认启用 `LLM_JSON_SCHEMA=true`；不支持该协议的端点可关闭。Schema 请求被 HTTP 400 拒绝、或返回无效 JSON 时，在剩余调用预算内用 JSON 对象模式重试一次。语义上不可计算的模型另有一次内核错误反馈修正，两类重试共用整题预算，均不会无限循环。
