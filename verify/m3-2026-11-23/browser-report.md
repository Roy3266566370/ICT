# M3 浏览器验收

2026-11-23 在 Windows 上运行 Playwright 和本机 Chrome 158.0.8127.37。前端为 Vite 生产构建，后端为本机 Uvicorn、Python 3.11.9、PowerPoint COM 16.0.20625.20108 和独立临时 SQLite。`LLM_PROVIDER` 和 `LIVING_FIGURE_VISION_PROVIDER` 均设为 `none`。各样本使用新上传材料和首次识别，Playwright 单 worker 顺序执行。

| 样本 | 上传到可编辑 | 点击到预览 | 上传到首次预览 |
| --- | ---: | ---: | ---: |
| `auto-vector-arrows.pptx` 第 2 页嵌图 | 38.824 秒 | 3.973 秒 | 42.840 秒 |
| 原始换基 PNG | 12.689 秒 | 2.947 秒 | 15.672 秒 |
| 压缩换基 JPEG | 14.657 秒 | 2.955 秒 | 17.654 秒 |
| 由换基 PNG 生成的单页 PDF | 17.617 秒 | 3.969 秒 | 21.623 秒 |

上传计时从文件选择开始，到编辑器显示可选图片为止。预览计时从操作「矢量化此图」开始，到候选结果可见为止。全程包含选择对象、运行交互脚本和浏览器渲染。PPTX 首轮完整流程超过 25 秒，PNG、JPEG 和 PDF 低于 25 秒。四个样本点击到预览均超过 2 秒。

PPTX 第 1 页保留原生线条。第 2 页上传后保留原图；按需识别显示 15 个候选，其中 11 个可应用，4 个以琥珀色虚线显示供校对。应用按钮一次接管全部可应用对象，校对预览为只读，应用后可用普通编辑工具移动对象。 [校对叠图](pptx-figure-overlay.png) · [应用后](pptx-figure-applied.png)

应用后浏览器成功载入独立清底 PNG，图示校对开关可显示原图。一次撤销恢复原图并移除本批对象，随后验证撤销保存、重做、回到演示、刷新和拖动线条端点。 [撤销后](pptx-figure-undone.png) · [刷新并拖动后](pptx-figure-reloaded.png)

直接上传 PNG 和 JPEG 后，图片保留原来的位置锁，仍可打开矢量化预览。按上传素材补偿 Office 放大后，PNG 预览有 13 个候选，JPEG 预览有 14 个候选，均可应用。两个用例还验证了预览前的文档未生成矢量、手动添加箭头、端点手柄与撤销。 [PNG 预览](basis-alternate.png-overlay.png) · [JPEG 预览](basis-compressed.jpg-overlay.png)

PDF 使用 Pillow 从 `basis-alternate.png` 生成单页文件后实际上传。初始检测没有找到几何对象，同份 OCR 结果映射到长边 900 像素的检测图后得到 14 个候选，其中 13 个可应用，另 1 个供校对。浏览器用例还验证了预览中的手动入口可添加箭头、显示端点手柄和撤销。 [PDF 预览](basis-generated.pdf-overlay.png)
