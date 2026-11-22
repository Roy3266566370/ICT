# 阶段4：原位流程图与AI动态演示框

按照用户已给的阶段4清单实施，延续横向SceneDocument及阶段2/3的编辑/放映/保存机制。

1. SceneNode新增diagram和demo，分别内嵌现有DiagramDoc及完整PageLab；增量保存、复制、撤销、渲染、离线构建同步支持。新增图框通过画布拖出，已有图框可移动、缩放与旋转。
2. DiagramCanvas增加透明嵌入模式，复用React Flow节点拖动、上下游高亮与单步顺序；边线使用flow速度。支持简短文字和受校验的AI本页流程图生成。
3. PageLab时间轴定义为duration_s及严格有序stops(t,label)，render(input)接收t和step。公开参数白名单控制观众滑块。后端校验时间点/边界和程序输出，前端仍通过opaque iframe+Worker执行、ViewAST校验。
4. 演示节点直接在图框内播放/暂停/单步/拖参数，播放在步骤点暂停；编辑器可根据本页生成、重新生成、改默认值与公开参数。模型响应迟到时不覆盖已删除/换页/锁定对象。
5. 本页参数变化仅是演示状态；教师保存才写回SceneDocument。未知程序、非法结构、失败生成不能损坏原图框或原课件。
6. 用原始样例P02和P23真实生成并插入两类节点，验证全屏当前页交互、保存刷新、再编辑/再生成、框尺寸与公开参数；记录真实模型调用与浏览器截图，模拟测试不算真实生成成功。

分工：后端PageLab协议、前端两类节点播放器并行实现；主线程完成场景校验/接口/编辑器和总体验收。阶段5 HTML工程重新导入不在本轮范围。

## 实施与实际验收结果

- SceneNode 的 diagram/demo 已接入类型、数据校验、增量保存、复制撤销、编辑画布和 DeckPlayer；离线 runtime 也成功构建。
- 编辑器新增拖框插入、位置/宽高/角度属性；流程文字解析与本页 AI 流程图；演示生成/重新生成、默认值、公开参数；观众操作保留为本地演示状态。
- PageLab .2 使用 t/step、检查点、播放暂停/下一步/进度；旧无时间轴实验保留兼容。服务端执行时间和参数边界校验，拒绝只改变进度字幕的伪动画。生成前先保存当前页面；迟到响应不覆盖删除、锁定或内容已变更的目标。
- 独立审查发现并修复：右栏默认值被旧滑杆状态覆盖、纯进度文字被判定为动画、旧实验 t/step 参数被覆盖。
- 浏览器发现并修复：图更新丢失 React Flow measured 尺寸造成节点隐形；节点点击冒泡造成放映翻页。真实模型截断后，将结构化生成显式设为 thinking=False；随后演示生成约 6–7 秒、流程图约 4–6 秒。

使用原始样例已上传材料 `mat_bb923172fd5d46d09014a3decf552719` 的 P02/P23；未裁剪、改写或伪造源 PPT。原文件和材料 source.pptx 的 SHA256 均为 `d04563a81c17e62e91971977e911cad5eb1ad26d0fcd2e8f7b7a4ad2393ff837`。本轮无需再次整份上传。

实际浏览器测试 `frontend/e2e/classic-inline-systems.spec.ts` 不拦截或伪造模型响应，覆盖：两页拖出两类框、文字流程图、P02 真实 AI 知识地图、两页真实 AI 时间轴演示、默认值同步、公开参数筛选、播放/暂停/下一步、保存刷新、全屏上下游高亮/流程单步/演示计算变化、观众拖参、一键重置及查看原图；再打开 P23 拖动和缩放框、真实重新生成（cached=false）、关闭观众调参后刷新验证禁用且仍可播放，最后恢复调参。

最终完整浏览器验收：1 passed，35.8秒。之前独立的完整浏览器验收也通过（20.9秒）。生成结果、重新生成结果随测试附件留存。

验证命令与结果：

- `npm test`：724 passed，0 failed。
- `npm run build`：TypeScript、Vite 生产包和单文件离线 runtime 全部成功。
- `python -m pytest tests/test_inline_systems.py tests/test_page_lab_timeline.py tests/test_living_ai.py tests/test_free_document.py -q`：最终55 passed。
- 同时包含阶段2/3数学图、向量、OCR、几何识别的后端回归：134 passed。
- `git diff --check`：源代码通过；生成的 runtime.js 内第三方模板字符串有尾部空白，未手工改变其字符串内容。

稳定验收产物：`verify/stage4/p02-editor.png`、`p23-editor.png`、`p02-fullscreen.png`、`p23-fullscreen.png`、`p02-p23-scenes.json`。原有 `p02-lab.json`/`p23-lab.json` 是最初真实模型探测结果；最终保存的图形和程序以 `p02-p23-scenes.json` 为准。完整HTML工程备份与重导入留阶段5。
