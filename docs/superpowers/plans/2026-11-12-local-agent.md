# Local understanding Agent Implementation Plan
> Execute inline using superpowers:executing-plans.
Goal: 原图理解四项输出，声明式内核计算与交互。
Architecture: 实验室专用 Ollama 适配器，复用 API 和内核。
Spec: ../specs/2026-11-12-local-understanding-agent-design.md
Constraints: 不执行模型代码，不外传图片，不伪造条件，不允许模型决定答案正确。
Review focus: 来源越权；截断；缺条件；模型自报答案；未确认时判分。
- [x] 添加适配器边界测试并观察失败。
- [x] 实现 local_agent.py：来源读取、受限 JSON 契约、一次修复、内核交接。
- [x] 接入 settings、ai-solve、缓存、启动脚本；保留旧文档。
- [x] 四项输出前端展示及待确认交互状态。
- [x] 相关测试、类型检查、真实 1.png 上传与调参、浏览器验证。
Ruling: 当前不是 Git 仓库，相关文件已备份 verify/local-agent-2026-11-12/before.zip；不初始化仓库或复制权重。

Completed: 105 related backend tests; TypeScript build check; 4 frontend auto-trigger tests. Actual browser upload 1.png -> local Ollama -> region transcript -> existing deterministic region derivation -> 71/210 -> independent mpmath quadrature -> pending-source trial -> original-image confirmation -> answer check -> n=40 and slice adjustment persisted. Reviewer identified confirmation preservation, schema shapes and context budget; all addressed with checks.
Ruling: 2B cannot reliably derive bounds. Added raw region protocol to existing double-integral compiler, using its existing supported-region derivation; unsupported regions are rejected, not guessed. Non-sample test y^4<=x,x^2<=y gives area 7/15.
Ruling: conservative UTF-8 text/schema and image-patch preflight uses 32768 context; over-budget input explicitly rejected. No silent text truncation.
