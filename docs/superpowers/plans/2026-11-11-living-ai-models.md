# Living AI Models Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the current workspace.

**Goal:** 活页根据提取文字调用 AI 自主设计可运行模型，原文保留，模型可发布。

**Architecture:** 复用 PPTAIClient / generate_page_lab / LabCanvas；新增 living.ai 负责上下文、缓存键和块装配，routes_living 负责授权与并发校验。前端采用现有 canvas 块嵌入模型。

**Tech Stack:** FastAPI、SQLAlchemy、React、TypeScript、现有 ViewAST 沙箱；不新增依赖。

**Spec:** ../specs/2026-11-11-living-ai-models-design.md

## Global Constraints

- 原文保留，1–3 块逐个生成；不执行任意 HTML；模型密钥仅在后端。
- 校验所有者及 revision；失败保留已有内容；内容相同复用生成结果。

## Review Focus

- 空文字、删除的锚点：调用前拒绝。
- 模型缺配、非法代码：明确错误，文档不变。
- 生成时并发编辑：409，保留用户编辑。
- 发布、刷新：复用冻结模型，调参不调用 AI。
- 多个模型同页：沙箱独立、仅滚入视口后启动。

## Task 1: 生成与持久化

- [x] 先新增 API 测试：调用生成、保留原文、相同输入缓存、强制替换、拒绝跨会话及过期版本。
- [x] 运行测试确认缺少接口而失败。
- [x] 新增 backend/app/living/ai.py；新增 routes_living.py 请求与生成端点；canvas 数据校验。
- [x] 复用并加固 page_lab.py 的服务端试运行环境；加入代码逃逸与死循环测试。
- [x] 运行相关 pytest 并确认通过。

## Task 2: 编辑器与播放器

- [x] 提取现有 LabCanvas 为可复用导出；新增 LivingAIModel / LivingAIPanel。
- [x] 接入 API 客户端、块渲染、编辑器工具栏及文字块操作；保存最新编辑后再生成。
- [x] 运行 tsc 与生产构建；浏览器验证真实模型生成、调参、刷新和发布。
- [x] 记录验证证据及局限。

执行记录：无 Git 元数据，直接在现有工作区修改。65 条后端测试、9 条前端运行器测试及生产构建通过。真实模型生成并发布 2 个自主设计的实验，见 verify/living-ai-models-result.json。代码审查指出插入菜单并发覆盖问题，已修复并用浏览器暂停请求验证关闭菜单与编辑锁定；复审无重要遗留。

## Task 3: AI 全文挑选适合交互的内容

- [x] 先新增全文候选、尾页覆盖、已有模型排除、长段预算与异常结果测试，确认缺少实现而失败。
- [x] 新增 recommend_models 与 /ai-recommendations，校验来源、归属和 revision，按内容哈希缓存。
- [x] 通用面板打开时自动分析，显示推荐理由、拟操作与观察结果，默认选择前 3 项并传递设计目标；保留手选。
- [x] 材料修改使推荐失效，生成模型不误清除推荐；用固定字段数组解决 JSON 属性顺序引起的误判，并验证回归先失败后通过。
- [x] 浏览器真实筛选 73 段得 8 项，按前 3 项生成模型且 design_goal 全部一致；继续挑选时排除已完成的 3 段，分析剩余 70 段。
- [x] 72 条相关后端测试、12 条前端相关测试与在线/离线构建通过。扩展代码审查无重要问题。
