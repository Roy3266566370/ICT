# 万象（WANXIANG）全功能真实用户模拟测试报告与问题清单

> [!NOTE]
> - **测试环境**：Windows 本地运行（前端 `http://localhost:5173/`，后端 `http://127.0.0.1:8000/`），桌面主测视口 `1440×900`，移动端适配视口 `390×844`。
> - **测试原则**：严格模拟真实用户端到端操作，**未修改任何项目源代码**，仅做完整实测、全量截图与问题归档。
> - **陌生 PPT 素材（均从互联网实时下载，非仓库内本地样例）**：
>   1. `file_example_pptx.pptx`（6 页中文陌生 PPT：《PPT语言生成工具》）
>   2. `microsoft_workshop.pptx`（9 页微软英文含图陌生 PPT：《Introducing NextGen Workshops》）
>   3. `the_art_of_linear_algebra.pptx`（48 页 Gilbert Strang 线性代数图解陌生数学 PPT：《The Art of Linear Algebra》）
> - **截图归档目录**：共整理 **57 张**高清实测截图，全部存放于 `C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/` 并直接嵌入下方各章节，方便逐一对照查看。

---

## 一、测试覆盖总览

| 模块 | 覆盖路由与核心功能 | 整体结论 | 留存截图 |
| --- | --- | --- | --- |
| **1. 首页、全站导航与响应式** | `/` 首屏动态场、§01 新人引导、§02 定象坊精选 3 例、§03 通文册卷帘对比、§04 双子收口、上传弹窗、404 页面、移动端 `390×844` | 视觉基础良好，但存在若干交互与可读性缺陷 | 12 张 |
| **2. 账号系统与个人中心** | `/space` 访客态、`/settings/profile` 未登录态、`/register` 校验/通行证联动/发送 Brevo 邮箱验证码/提交注册、`/login` 校验/显隐/忘记密码/错误登录 | 发送真实邮件验证码成功（HTTP 200），存在校验反馈与 UI 细节问题；已登录态因需真实邮箱查收 6 位验证码未进入 | 8 张 |
| **3. 定象坊与自由画布** | `/workshop` 6 大学科 65 模板、专题重命名、我的作品、公开画廊、`/canvas` 高数/408/办公决策模板、空白画布连线、创建积木、保存、`/work-shares/:id` 分享与 Fork | 核心画布引擎和连线能力强大，但存在路由卡顿、408 算法指标错误、只读分享页滑杆锁死与按钮对比度问题 | 12 张 |
| **4. 通文册与陌生 PPT 全流程** | `/living` 书架、上传 3 份网上陌生 PPT（6页中文 / 9页微软含图 / 48页线代数学）、阅读态/缩放/演示态/自由编辑/插入象砖/插入图表/动态关系公式绑定/板书/原稿对照/AI 交互与本页学习/在线分享 `/p/:id`/离线 HTML 与 `.xsproj` 导出/删除确认 | 3 份陌生 PPT 全部成功转换、编辑、分享与导出；暴露出矢量化入口缺失、背景闪橙、矢量重构文字倒置、控件拥挤等多项真实缺陷 | 25 张 |

---

## 二、全模块实测效果截图展示

### 模块 1：首页（`/`）、全站导航、404 与移动端适配

#### 1.1 首页首屏、引导剧场与交互区块

![01 首页首屏与实时动力学波动场](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/01_home_hero.png)

````carousel
![02 §01 新人引导动态剧场第 1 步（可见标题末字「来。」单字孤行折行）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/02_home_walkthrough_step1.png)
<!-- slide -->
![03 §01 新人引导第 2 步：定象坊波形仪器实时调参](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/03_home_walkthrough_step2.png)
<!-- slide -->
![04 §01 新人引导第 3 步（从第 1 步点「下一步」直接跳过第 2 步至此，且后续步骤与预设按钮点击无响应）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/04_home_walkthrough_step3.png)
````

````carousel
![05 §02 定象坊精选实验 Example 01（斜率场与 RK4 初始态）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/05_home_workshop_labs_ex1.png)
<!-- slide -->
![06 §02 定象坊精选实验调参后（系数 a 调至 1.2，方程与斜率场实时重绘）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/06_home_workshop_labs_interact.png)
<!-- slide -->
![07 §03 通文册 Before/After 卷帘左拖且展开阶数调至 N=9，误差实时更新为 0.0001](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/07_home_living_compare_dragged.png)
````

#### 1.2 底部双子收口、上传弹窗、404 页面与移动端（`390×844`）

![08 §04 工程原则与双子收口（注意左侧 TRACK A 深底卡片的标题「搭一个能亲手推演的活仪器」为黑字，几乎不可见）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/08_home_footer_cta.png)

````carousel
![32 首页点击顶栏「上传 PPT」正常弹出的上传教学材料模态框](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/32_home_upload_modal.png)
<!-- slide -->
![09 404 页面（无全站导航/页脚与排版样式，裸露默认宋体与蓝色下划线链接）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/09_home_404.png)
<!-- slide -->
![10 移动端 390×844 首页首屏（无横向溢出，布局整洁）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/10_home_mobile.png)
<!-- slide -->
![11 移动端 390×844 汉堡菜单展开态（半透明背景轻微透出底层 Hero 文字）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/11_home_mobile_menu.png)
````

---

### 模块 2：账号体系（注册 `/register`、登录 `/login`、个人主页 `/space`、个人设置 `/settings/profile`）

#### 2.1 个人主页与个人设置（访客/未登录态）

````carousel
![12 访客态个人主页 /space（展示清理倒计时、创作印痕与作品星图；注意右下角多余的悬浮「↑ 首页」按钮）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/12_space_guest.png)
<!-- slide -->
![13 未登录态个人设置 /settings/profile（正确拦截表单并引导登录）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/13_settings_guest.png)
````

#### 2.2 用户注册（`/register`）与邮箱验证码全流程实测

````carousel
![14 注册页初始态（准入登记台 + 右侧实时通行证）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/14_register_initial.png)
<!-- slide -->
![15 注册表单校验与通行证联动（用户名 a / 密码不一致无字段错误提示；「身份标签」出现双下拉箭头 ▼ 和 ∨ 重叠；底部仍出现过时文案「题目实验室」与「永久保存尚未开放」）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/15_register_validation.png)
<!-- slide -->
![16 点击「发送验证码」真实请求 HTTP 200 成功，按钮进入 59s 冷却倒计时并提示 5 分钟有效](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/16_register_send_code.png)
<!-- slide -->
![17 提交错误验证码 123456 后返回 HTTP 422，准确提示「验证码不正确，还可尝试 4 次」](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/17_register_submit_error.png)
````

#### 2.3 用户登录（`/login`）

````carousel
![18 登录页初始态（支持用户名/邮箱、密码显隐、记住我、忘记密码提示与通行证翻面）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/18_login_initial.png)
<!-- slide -->
![19 错误凭据登录返回 HTTP 401，正确提示「用户名或密码不正确」且右侧通行证实时截断联动](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/19_login_error.png)
````

---

### 模块 3：定象坊（`/workshop`）、自由画布（`/canvas`）与公开分享（`/work-shares/:shareId`）

#### 3.1 定象坊多学科模板大厅（65 个模板 · 6 大领域）

````carousel
![20 定象坊首屏（含实时内核排字台、65 模板概览与 5 大砖类导航；注意右上「实时检查器」徽章折行）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/20_workshop_lobby_calculus.png)
<!-- slide -->
![21 标本柜「408 专题 · 16」全景沙盘卡片与搜索/专题自定义区](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/21_workshop_lobby_408.png)
<!-- slide -->
![22 标本柜「办公决策 · 8」卡片视图](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/22_workshop_lobby_business.png)
<!-- slide -->
![23 定象坊下方「我的作品」与「公开画廊」区域](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/23_workshop_lobby_gallery.png)
````

#### 3.2 多学科交互模板实测（高数 / 408 CPU 调度 / 办公经营沙盘）

````carousel
![24 高数模板「第 3 章 · 导数应用与局部近似」调参至 x0=1.20 与高频急弯，曲率圆与热图实时重算](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/24_canvas_calculus.png)
<!-- slide -->
![25 408「进程状态与 CPU 调度」双图对照（暴露严重 Bug：RR q=2 平均带权周转竟为 0.27 < 1.0，且左图甘特图仍呈 FCFS、右侧存在重复算法/时间片滑杆）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/25_canvas_408_sched.png)
<!-- slide -->
![26 办公决策「单位经济与敏感性热图」调节变动成本率与固定成本后的实时联动](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/26_canvas_business.png)
````

#### 3.3 空白画布自由搭建、端口连线、创建积木、发布分享与 Fork 改造

````carousel
![27 新建空白画布初始态](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/27_canvas_blank.png)
<!-- slide -->
![28 自由搭建：函数源 2·sin(x) + 滑杆源 0.85 连线驱动函数图像（可见左侧 Y 轴刻度被裁切、标题「滑杆源」被截断为「滑...」）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/28_canvas_custom_wired.png)
<!-- slide -->
![29 「＋ 创建积木」弹窗（支持「AI 帮我造」与「手写规则」及右侧实时沙箱预览）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/29_canvas_block_creator.png)
<!-- slide -->
![30 公开分享页 /work-shares/jDwFHMsiezua_gxZ（虽标注「打开即玩」，但滑杆锁死在 0.85 无法拖动，且卡片仍残留 × 删除按钮与缩放角标）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/30_work_share.png)
<!-- slide -->
![31 点击「在定象坊改造 →」成功 Fork 为可编辑副本「QA实测自建画布 · 改造」，滑杆可正常调至 0.25](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/31_work_fork.png)
````

---

### 模块 4：通文册（`/living`、`/materials/:id/work`、`/p/:shareId`）——3 份网上陌生 PPT 全流程实测

#### 4.1 通文册大厅与陌生 PPT #1：`file_example_pptx.pptx`（6 页中文陌生 PPT）

````carousel
![33 通文册大厅 /living（注意顶部统计在新增象砖与互动页后仍持续显示「0 个交互对象」）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/33_living_home.png)
<!-- slide -->
![34 陌生中文 PPT 第 1 页互动预览态](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/34_cn_ppt_read_p1.png)
<!-- slide -->
![35 陌生中文 PPT 第 2 页（注意最底行项目符号紧贴白边边缘）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/35_cn_ppt_read_p2.png)
<!-- slide -->
![36 点击「▶ 演示」进入演示态（隐藏作者工具栏，键盘翻页/ESC退出正常，但缺少缩放控件）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/36_cn_ppt_present.png)
````

````carousel
![37 陌生中文 PPT 自由编辑态初始画面（8 个对象正常分离；底部页脚文字略微越出白框）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/37_cn_ppt_editor.png)
<!-- slide -->
![38 编辑改字 [QA已编辑] + 拖动对象 + 插入定象坊高数插件并保存（缩窄后插件内部公式截断、布局拥挤）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/38_cn_ppt_editor_interact.png)
<!-- slide -->
![39 互动预览全屏展开定象坊实验态：拖动 x0=1.30 实时算出 κ=0.233, R=4.291](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/39_cn_ppt_experiment.png)
<!-- slide -->
![40 生成在线分享链接横幅 http://localhost:5173/p/yswsdlCjxJ5uAFai](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/40_cn_ppt_share_modal.png)
<!-- slide -->
![41 直接访问公开分享页 /p/yswsdlCjxJ5uAFai（正常翻页与保留修改，但第 2-6 页缩略图标题退化为「第 2 页」等泛化名）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/41_cn_ppt_share_page.png)
````

#### 4.2 陌生 PPT #2：`microsoft_workshop.pptx`（9 页微软英文含图陌生 PPT）

````carousel
![42 微软英文陌生 PPT 第 1 页阅读态](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/42_ms_ppt_read.png)
<!-- slide -->
![43 微软英文陌生 PPT 第 6 页（含右侧人物插画）与顶栏 AI 菜单](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/43_ms_ppt_pic_slide.png)
<!-- slide -->
![44 真实调用 AI 生成第 6 页交互《工作坊流程演示》（可见右上「舞台大屏展示」折行、内嵌演示画布压扁为细条、且将 Logistics 误译为「物流阶段」）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/44_ms_ppt_ai_interact.png)
````

````carousel
![46 刚切入微软 PPT 第 6 页编辑态时整页背景异常变为高饱和纯橙色，且顶部工具栏折行、右下紫色按钮文字被裁切](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/46_ms_ppt_editor_orange_flash_bug.png)
<!-- slide -->
![45 选中分离出的图片对象 Picture 3 后，右侧背景恢复白色，但属性面板/右键/AI圈选均无文档宣称的「矢量化此图」入口](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/45_ms_ppt_editor_pic_no_vectorize.png)
````

#### 4.3 陌生 PPT #3：`the_art_of_linear_algebra.pptx`（48 页 Gilbert Strang 线性代数陌生数学 PPT）与扩展工具

````carousel
![47 48 页线性代数陌生 PPT 约 13 秒完成转换并打开第 1 页（自动标记 2 页互动页）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/47_linalg48_p1.png)
<!-- slide -->
![48 第 15 页矩阵乘法 MM 图示渲染清晰完整](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/48_linalg48_p15_mm.png)
<!-- slide -->
![49 第 43 页 Matrix World 自动互动页（暴露明显重构 Bug：「Gram-Schmidt」上下倒置、「Positive Semidefinite」错位断词、底部线条控制条遮挡圆环图）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/49_linalg48_p43_matrix_world.png)
<!-- slide -->
![50 顶栏「板书」工具实测：钢笔多色、荧光笔高亮、圈选、清屏与退出均正常](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/50_linalg48_whiteboard.png)
````

````carousel
![51 编辑态插入「教学图表」柱状图并在右侧实时修改类别与数值（Rank1=6）即时重绘](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/51_linalg48_insert_chart.png)
<!-- slide -->
![52 动态关系手动绑定表达式 round(n_52.length * 2 + 10) 成功驱动标题更新为「长度联动：823 pt」（右侧下拉框受日文对象名挤压成 4 行）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/52_linalg48_dynamic_relation.png)
<!-- slide -->
![53 编辑态点击「原稿对照」仅在单画布切换为原稿图并禁用控件，并非左右双栏对照（对比可见原稿中 Gram-Schmidt 方向是正的）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/53_linalg48_compare_editor.png)
<!-- slide -->
![54 互动预览态点击「原图对照」同样为单画布替换显示](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/54_linalg48_compare_preview.png)
````

````carousel
![55 顶栏 ✦ AI 下拉菜单（包含「本页学习」与「AI 交互」；「本页学习」触发后持续轮询超 12 秒未返回）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/55_linalg48_ai_menu.png)
<!-- slide -->
![56 返回通文册书架查看 3 份网上陌生 PPT 完整归档（右下角同样残留多余悬浮「↑ 首页」按钮，且卡片无删除入口）](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/56_living_library_3_web_ppts.png)
<!-- slide -->
![57 在个人主页 /space 触发「删除活页」二次确认弹窗，确认后列表实时刷新并成功删除](C:/Users/32665/.gemini/antigravity/brain/e83ff4f0-1ab0-4f5f-9d89-5dd7d2a9efee/screenshots/57_space_delete_dialog.png)
````

---

## 三、完整问题清单（按严重程度分级，未作代码修改）

### P0 · 严重功能与计算正确性缺陷（建议优先修复）

1. **[定象坊 · 408 CPU 调度算法计算错误与视图不同步]**（见截图 `25`）
   - 在 `os01-process-sched` 模板切换到 `RR q=2` 后，指标表中出现 **平均周转 `1.5`、平均带权周转 `0.27`**（带权周转时间 $T / T_s$ 理论上不可能小于 `1.0`），数值计算存在明显逻辑错误。
   - 同时左侧甘特图依然渲染为非抢占式顺序块（`P1×4 → P2×2 → P3×5`），与当前选中 `RR q=2` 及底部结论 `运行 P4` 不一致；右侧控制舱还出现重复的参数滑杆（`算法(0FCFS/1SJF/2SRTF/3RR)` 与 `调度算法`、`时间片回落` 与 `RR 时间片 q`）。
2. **[定象坊 · 从 `/workshop` 首次点击模板进入 `/canvas` 发生 SPA 视图卡死]**
   - 在 `/workshop` 首次点击高数模板卡片后，浏览器地址栏已变更为 `/canvas?template=ch03-derivatives-app`，但页面 DOM 仍停留在定象坊大厅画面，必须手动刷新页面后画布才正常渲染。
3. **[定象坊 · 公开分享页 `/work-shares/:shareId` 无法调参，与产品承诺不符]**（见截图 `30`）
   - 分享页顶栏文案明确写着「发布快照 · 打开即玩」「对象还在动，但不能改」，且滑杆 `<input type="range">` 未设 `disabled`，但实际输入或鼠标拖动滑杆值被完全锁死在 `0.85` 无法交互。
4. **[通文册 · 陌生 PPT 矢量重构存在严重图形/文本还原错误]**（见截图 `46`、`49`）
   - `microsoft_workshop.pptx` 第 6 页在阅读态为浅灰白背景，刚进入「编辑课件」时整页背景异常变为**高饱和纯橙色**，选中图片对象触发重绘后才恢复白色（主题色/背景层渲染竞态）。
   - `the_art_of_linear_algebra.pptx` 第 43 页 `Matrix World` 经矢量重构后，文字 `Gram-Schmidt` 被**上下倒置**渲染，且 `Positive Semidefinite` 出现错误断词换行（`Positive Semidefin / ite`），与原稿 PNG 明显不符。
5. **[首页 · §01 新人引导剧场与 §02 精选实验第 3 个 Tab 交互失效]**（见截图 `04`、`05`）
   - §01 在第 1 步点击「下一步」直接跳过第 2 步进入第 3 步；在第 3 步点击「下一步」、第 4 步标签页以及预览内频率预设按钮（如「高频 ω=4.2」）均无响应。
   - §02 定象坊精选实验中，点击第 3 个标签页「EXAMPLE 03 · 梯度下降与学习率地形」无法激活该面板，始终停留在前序示例。
6. **[通文册 · 文档宣称的「矢量化此图」功能在界面中缺失]**（见截图 `45`）
   - `README.md` 明确描述编辑态选中图片后可使用「矢量化此图」进行校对与应用，但实测在 `microsoft_workshop.pptx` 第 6 页选中分离后的 `Picture 3` 时，右侧图片属性面板、动态关系、右键菜单及 AI 圈选中均未找到任何「矢量化此图」入口。

---

### P1 · 中等功能缺陷与逻辑不一致

7. **[账号注册 · 非法表单输入提交缺少字段级错误提示]**（见截图 `15`）
   - `/register` 表单设置了 `novalidate`，但当用户输入过短用户名（`a`）、非法邮箱（`bad-email`）、过短密码（`123`）和不一致确认密码（`456`）并点击「建立档案」时，字段下方未显示任何红色错误提示（仅密码框下方有强度条），用户不知道为何无法提交。
8. **[账号系统 · 跨页面功能文案矛盾且残留已废弃模块旧名]**（见截图 `12`、`15`、`16`）
   - `/space` 访客横幅提示「**登录永久保存**」，但 `/register` 底部明确提示「**材料与实验仍按当前浏览器会话保存；跨设备同步与永久保存尚未开放**」，二者直接矛盾。
   - `/register` 右侧通行证（`SCOPE: 个人空间 · 题目实验室`）与底部链接（「以访客身份体验题目实验室与示例 →」）仍沿用已废弃重定向的旧名称「题目实验室」与「示例」，未统一为「定象坊 / 通文册」。
9. **[通文册 · `/living` 顶部「交互对象」统计数字始终为 0]**（见截图 `33`、`56`）
   - 在已挂载定象坊插件、添加教学图表、绑定动态关系、且 48 页数学 PPT 自动识别出 2 页 `✦ 互动` 后，`/living` 顶部统计仍长期显示 `0 · 个交互对象`（而工作台左侧缩略图筛选可正确统计）。
10. **[通文册 · 「原稿对照」与预期/文档的左右双栏不一致]**（见截图 `53`、`54`）
    - 编辑态与互动预览态点击「原稿对照 / 原图对照」均仅是在单个中间画布区切换展示原始静态图（且禁用编辑操作），而非 `README.md` 所述的左右双栏并行对照。
11. **[通文册 · 演示态缺少缩放控件]**（见截图 `36`）
    - 进入「▶ 演示」全屏演示态后，未出现 `README.md` 所述的演示顶栏缩放控件（`− / 滑杆 / 百分比 / ＋ / 适应`）。
12. **[通文册 · 在线分享页 `/p/:shareId` 未编辑页缩略图标题丢失]**（见截图 `41`）
    - 分享页中仅被编辑过的第 1 页保留标题，第 2–6 页缩略图文字全部退化为泛化标签「第 2 页」…「第 6 页」，与工作台展示原页标题的行为不一致。
13. **[通文册 · 「本页学习」异步任务长时间卡在「准备中…」]**（见截图 `55`）
    - 在 48 页数学 PPT 第 43 页点击 `✦ AI → 本页学习 → 准备本页学习` 后持续轮询 `/ai-tasks/...`，超过 12 秒无进度提示也未返回结果。
14. **[通文册 · `/living` 书架无删除课件入口，且 `/space` 删除请求伴随一次 `net::ERR_ABORTED`]**（见截图 `56`、`57`）
    - 用户在 `/living` 书架无法直接删除课件，必须跳转到 `/space` 才能找到 `⋯` 删除入口；且确认删除虽最终 `HTTP 204` 成功，但网络层伴随一条被中止的同名 `DELETE` 请求。

---

### P2 · UI 视觉、对比度、排版与交互细节问题

15. **[首页 · TRACK A 卡片深底黑字严重不可读]**（见截图 `08`）
    - TRACK A 深海蓝卡片的 `<h3>` 标题「搭一个能亲手推演的活仪器」使用了深黑色字体，与背景对比度极低，肉眼几乎无法辨认。
16. **[定象坊 · 学科分类 Tab 切换时存在白底白字/黑底深字对比度异常]**
    - 切换学科分类时观察到 `线性代数 · 6` 出现白底白字、`大学物理 · 10` 激活态出现黑底深色字，严重影响可读性。
17. **[全局 · 404 页面完全裸奔无样式，且跨路由跳转未重置滚动条]**（见截图 `09`）
    - `/not-a-real-route-404` 未套用站内导航壳层与 CSS 排版，呈默认宋体与蓝链；且从长页面底部跳转过来时未 `scrollTo(0, 0)`，导致 404 文案落在视口上方，首屏一片空白。
18. **[全局 · `/space` 与 `/living` 出现多余的右下角悬浮「↑ 首页」按钮]**（见截图 `12`、`56`）
    - `App.tsx` 中 `GlobalHomeShortcut` 的排除白名单遗漏了 `/space` 与 `/living`，导致这两个已有顶栏主导航的页面仍在右下角叠加悬浮「↑ 首页」按钮。
19. **[注册页 · 「身份标签（可选）」原生 `<select>` 双下拉箭头重叠]**（见截图 `15`、`16`）
    - 下拉框同时渲染了浏览器原生黑色 `▼` 与组件自定义灰色 `∨`（缺 `appearance: none`）。
20. **[登录页 · 空表单红框错误在用户重新输入后不自动消退]**
    - 空表单提交标红后，用户开始输入内容时错误提示与红框不会即时清除，直到再次提交才刷新。
21. **[定象坊 · 自由画布与只读分享页 UI 细节]**（见截图 `20`、`28`、`30`）
    - 自由画布迷你函数图 Y 轴左侧刻度数字最左 1 位被裁切（如 `2.61833` 显示为 `.61833`）；部分卡片标题截断（`滑杆源` → `滑...`）。
    - 连续从积木库新建多个积木时默认完全叠放在画布正中央，遮挡前一个积木标题栏。
    - 只读分享页 `/work-shares/:shareId` 节点卡片仍保留 `×` 删除按钮与右下角缩放手柄，容易误导读者。
    - 定象坊首屏右侧排字台「实时检查器」红色标签在 `1440×900` 下发生单字折行。
22. **[通文册 · 编辑器、插件盒与 AI 侧栏布局拥挤/遮挡]**（见截图 `35`、`37`、`38`、`44`、`46`、`49`、`52`）
    - 中文陌生 PPT 边缘文本轻微越界或底边裁切（第 1 页页脚跑出白框下方、第 2/3 页末行紧贴底边）。
    - 定象坊插件默认插入尺寸（`760×460`）过大覆盖原页内容，缩小至 `400×250/460` 后内部公式截断、精简滑杆模式出现横向滚动条且不易操作；全屏实验态左侧绘图区仍有冗余内部滚动条。
    - AI 交互侧栏中「舞台大屏展示」「AI 交互 · 第 6 页」单字折行，且生成的《工作坊流程演示》内嵌预览画布被压扁为约 36px 的细条，无法直接预览图形（且英文 `Logistics phase` 被字面误译为「物流阶段」）。
    - 第 43 页互动预览底部「放映线条控制」悬浮条直接遮挡圆环图底边；切换到「编辑课件」时左侧 48 页缩略图栏滚动位置丢失跳回第 1 页，且顶部工具栏折行、右下紫色按钮文字被裁切。
    - 「动态关系」展开手工绑定时，含长名称/日文前缀的目标对象下拉框被挤压成 4 行，表单底部超出视口需内部滚动。
23. **[首页 · 排版与移动端菜单细节]**（见截图 `02`、`11`）
    - 1440px 下 §01 标题末字「来。」单字孤行折行；移动端 `390×844` 展开汉堡菜单时半透明背景略微透出底层 Hero 文字。

---

### 控制台警告与说明（技术观测）

- **全局高频 React 控制台警告**：`ThumbnailRail.tsx:45` 将驼峰属性 `fetchPriority` 直接透传至原生 `<img>` DOM，导致控制台持续输出 `Warning: React does not recognize the 'fetchPriority' prop on a DOM element`（需改为小写 `fetchpriority`）。
- **测试边界说明**：
  - 本次注册测试已真实触达后端 `POST /api/v1/auth/register/code` 并返回 `HTTP 200 OK`（说明 Brevo 事务邮件服务已配置生效），同时验证了错误验证码 `HTTP 422` 剩余尝试次数计数；因测试用示例邮箱 `qa_user_2611@example.com` 无法查收真实 6 位邮件验证码（且为遵循安全规范不绕过认证），**已登录态下的个人资料修改、手机号校验、兴趣标签保存、头像裁剪上传、顶栏账号菜单退出与重登**尚未进入实测。如需进一步验收已登录态，可提供一个测试用账号或临时可收信邮箱后继续补测。
