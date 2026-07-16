# VibeTracker 阶段性开发进度存档

> 2026-07-15 当前产品闭环状态、已实现能力与后续优先级见：
> `docs/PRODUCT_LOOP_AUDIT_2026-07-15.md`。本文件以下内容保留为早期阶段存档。

## 2026-07-16 最新检查点

- 数据库已进入 schema v17；v10 持久保存 Git 历史回填断点，v11 记录 AI 项目资料建议应用快照，v12 持久保存后台任务历史，v13 持久保存 Launch run，v14 删除伪精确百分比，v15 下沉核心领域约束，v16 保存大仓库历史基线，v17 保存项目重新关联前的仓库根目录用于外部图片失效检测。
- `projects.progress` 与 `development_records.progressDelta` 已从正式 schema 和活跃领域 API 删除；新 UI/summary 使用阶段、里程碑、下一步和 `DevelopmentRecord` 命名，旧页面只保留不参与构建的兼容别名。
- 项目状态、AI generation 生命周期、手工记录审核语义、generation run 同项目归属、Git SHA 格式/项目归属/活跃记录唯一性均已有数据库 trigger guard。
- 导入向导可选完整 Git 历史或最近 200/500/1000/2000 条基线；基线只限制首次/重写后的全量回填，之后的新提交仍全部增量同步。
- Windows Launch 增加独立 watchdog：通过仅由主进程持有的 lifetime pipe 识别父进程硬退出，并清理它仍持有句柄的目标进程树；packaged asar cwd 和 PID 复用边界已实测。
- 主进程 Git Scheduler 已完成：due 查询、默认并发 2、指数退避、成功清零、异常退出恢复、退出取消和 renderer 状态广播均已接通。
- 手工同步、AI 同步前扫描、首次导入和自动同步共用 Git Coordinator；同项目并发请求共享扫描，首次导入不会再被 scheduler 重复扫描。
- renderer 已删除五分钟逐项目同步循环，窗口聚焦只刷新数据；没有 renderer 时主进程仍可持续同步。
- 运行中项目禁止 relink，旧 Profile 会在仓库变化后失效，新仓库 Launch 候选可显式采用；重新关联后仍指向旧仓库的封面和开发记录图片会持续提示，用户可替换/移除封面或直接跳转关联记录处理。
- Git 事实页可区分“待处理 / 待审核草稿 / 已处理 / 已忽略”，不再提供会破坏关联语义的操作。
- AI 历史批次可以重新打开、复核 inputHash/规则/设置/输入范围，并按原 SHA、规则和 replaceDraftIds 重试；后台任务重试也复用 generation run。
- Launch 多 Profile 已限制同项目单 runtime；运行中配置锁定，项目卡片控制真实运行 Profile，ready 时同时提供打开与停止。
- 白屏恢复现覆盖静态暗色启动态、preload 缺失、入口加载失败和 renderer 崩溃限次重载，不再依赖 React 已经挂载后才能显示错误。
- production sender/Updater 与本地图片写库边界已收紧；资产 realpath、类型、40 MB 限制、项目根/选择授权和 junction 越界测试已完成。
- AI 中断运行会在下次启动转为可重试失败；连接测试使用未保存参数且无持久化副作用，兼容无 `/models` Provider；输入/响应预算和真实截图候选追溯已完成。
- import/create-empty 状态与标签验证、设置并发写锁已完成。
- LLM Provider registry、AI/Launch 对话框焦点陷阱、项目菜单键盘语义和响应式骨架已补齐；Settings 已拆为“AI 与生成 / 状态与标签 / 存储与更新”三个低噪声分区，高级生成规则默认折叠，支持方向键/Home/End 与 960/1440 窗口。
- 备注/待办内容编辑已完成，开发记录、AI 草稿和 generation run 的图片/SHA 已改为批量 hydration，时间线记录级 N+1 已消除。
- 正式记录图片已完成创建前预览/移除、创建后追加、caption、排序和删除；严格记录归属、路径授权与托管文件清理已接通。
- 托管封面、记录/项目删除和启动恢复现按真实引用修复 ownership；外部图片不会被应用删除。
- `userEditedAt` 已改为只在内容实际变化时写入；`project:get` 已收敛为单项目 summary 并移除无用的 30 条记录预加载。
- 待办完成状态、Launch enabled 和图片多选标记改为严格布尔验证。
- 缩略图、AI 待处理分页/日期范围/字节提示、旧 SHA/记录自动定位、分页请求锁与错误恢复均已完成。
- 自动 Git Scheduler 已进入任务中心并支持取消；导入首次同步失败、Git 检查错误分类和 LLM 设置枚举语义已收紧。
- 迁移故障注入已证明失败回滚、原数据保留和备份可读。
- 大仓库 Git 历史现按批事务落库，完成前不发布半截 reachability；取消、失败和异常退出后从持久 offset 续传，任务中心和项目 UI 展示真实进度。
- Git log 已改为 NUL 分帧协议并覆盖控制字符、特殊文件名、rename/copy、二进制与空提交；AI、Launch 和确认对话框已 Portal 化，修复长列表下操作被路由 transform 或任务中心遮挡。
- 所有 invoke 通道现统一经过运行时返回值校验；项目、Git、记录、AI、设置、Launch 和 Updater 的关键字段会在进入 renderer 前验证，拒绝 `undefined`、非有限数值和循环引用。
- 截图目录迁移已进入统一任务中心，展示真实复制/切换/清理进度；复制阶段支持取消回滚，失败任务可从任务中心重试。
- Electron E2E 已增加旧数据库迁移后查看、编辑和重启保留，完全未配置 LLM，960/1440、基础焦点与 reduced-motion，以及入口加载失败暗色恢复。
- 活动路由默认保持可见，GSAP 仅作为渐进增强；renderer 持续无响应时提供原生等待/重新加载恢复，并受限次重载预算保护。
- 数据库启动现执行 quick check，迁移备份会再次完整性校验；损坏数据库显示独立恢复页，可隔离原库及 WAL/SHM 后恢复可信备份。
- AI 项目资料建议应用会保存 generation run、输入 SHA、应用前快照和实际应用值；运行历史可查看应用次数与最近时间。
- 后台任务历史现进入 SQLite，renderer 启动时主动水合；异常退出遗留的运行任务会转为“已中断”并保留可重试上下文。
- 主进程 Scheduler 已有真实 Electron 回归：renderer 空闲时自动发现新 commit；模拟异常退出留下的增量回填 offset 后，重启会从断点续传并水合旧中断任务。
- Launch 候选发现已从 npm scripts 扩展到 Python/Django/FastAPI/Flask、Rust、Go、.NET、Swift、Java/Maven/Gradle 等常见非 Node 项目，仍只推荐、不自动执行。
- AI 项目资料建议的应用历史现在可以在运行追溯中查看每次应用前后差异、应用时间和对应 Git SHA；应用完成后会即时刷新，不必关闭对话框再重新打开。
- LLM 普通设置与加密 API Key 已使用不含明文密钥的跨文件事务 journal：prepared、config committed、key committed 三个崩溃点均可幂等前滚，暂存损坏时会整体回滚，密钥删除恢复不会复活旧密钥。
- Launch 运行历史已进入 SQLite：stderr/stdout 尾部、错误和最终状态跨重启可见；上次异常退出的 active/停止失败运行会转为 interrupted 诊断，历史 PID 不会伪装成当前 Process Manager 可停止的进程。
- 领域 IPC 输入已改为严格字段白名单，旧 `progress/progressDelta/offset` 和 Launch 服务端只读字段不能再从 renderer 回写；Launch 扫描候选的展示说明会显式剥离后再保存。
- IPC 返回契约已覆盖完整 Project、DevelopmentRecord、GitCommit、Dashboard、AI generation/snapshot、Launch 日志与 nullable 时间；`git:state`、`launch:state`、`task:progress` 三类 push event 也会在主进程广播前校验。
- README 简介候选会按段落提取可读正文，过滤 HTML 容器、Badge、Markdown 图片/导航和代码块；已修正 VoiceServiceDemo 顶部简介的标记噪声，未自动应用任何 AI 项目资料建议。
- 当前验证：两套 TypeScript、Lint、Build 通过，Unit 145/145，Electron E2E 12/12（本次约 1.5 分钟）；NSIS 安装器在 `--publish never` 下成功生成，`win-unpacked` packaged smoke 已验证 schema v17、safeStorage、受控图片协议、watchdog 启停和跨重启持久化。新增 `package:installed-smoke` 已完成隔离的 0.0.9 安装、写入数据、以 electron-updater 的 `--updated` 参数覆盖到 0.1.0、数据保留、快捷方式/注册项验证和静默卸载；所有自动化数据均使用临时目录且零残留。
- 用户提供的临时 OpenAI-compatible Provider 已完成无落盘实测：连接、结构化 JSON、运行时 schema、置信度、恶意 commit 文本隔离、Git SHA 追溯和 inputHash 均通过；API Key 未写入仓库、普通配置或测试日志。
- 真实数据演练已完成：迁移前手工一致性备份以及 v8→v12、v12→v13、v13→v16、v16→v17 自动备份均校验通过；最新自动备份为 `vibetracker-pre-schema-20260716-062204.db`。当前 17 个项目、19 条正式记录、2 条待审核草稿、16 张图片、1165 条 Git 事实和 5 个 Launch Profile 完整保留，`integrity_check=ok`；v17 启动后 Scheduler 正常增量发现 2 条新事实。
- 真实安全存储中的 Provider 已完成异常与成功两条路径：10 提交生成超时会保留失败 run 且不产生草稿；缩小到 3 提交后生成 1 条可追溯待审核草稿，未自动应用项目建议或接受记录。
- 真实 Provider 再次完成连接与 3 SHA 结构化生成；VoiceServiceDemo 新增 1 条待审核草稿。`halo-theme-hydro-minim`、`plugin-alist`、`plugin-links` 三个漏扫的嵌套仓库已通过正式导入 API 入库并分别同步 175、17、200 条 Git 事实；扫描器只保存了可用 Launch 候选，没有执行仓库命令。
- 真实 1440px Electron 窗口已复核项目详情、两条待审核草稿、证据/SHA、操作区和后台任务中心；renderer 无错误、无横向溢出，截图见 `output/playwright/live-goal-audit.png`。
- 后续非阻塞工程收尾已收敛为：在用户允许处理现有未提交旧文件后物理退役已退出路由/编译的兼容页面与 handler，并继续拆薄领域 IPC 编排；联网 Updater 下载只在存在真实、明确允许发布的远端版本后验收，本轮没有发布任何内容。
- 一次并行开发验证误用默认 userData 并触发 schema v4→v8 正式迁移；自动备份、数据数量与 integrity_check 核对结果记录在产品审计账本中，未回滚或写入测试数据。

**存档时间**: 2026-05-30 中午
**项目技术栈**: Electron + Vite + React + TypeScript + TailwindCSS + better-sqlite3

## 🌟 已完成的核心工作

1. **项目骨架与基础设施初始化**
   - 搭建了现代的 Vite + React 前端脚手架，并成功打通了基于 Electron 的多进程架构。
   - 配置了安全的 `contextIsolation: true` IPC 通信桥梁（修复了直接暴漏接口导致的白屏渲染中断问题）。
   - 修复并编译了跨环境 ABI 不一致的 Node.js `better-sqlite3` 底层模块。

2. **数据库与后端逻辑设计建立**
   - 初始化本地 SQLite 数据库，并开启 WAL 模式保证性能体验。
   - 完整建表并实现对应 IPC 业务：`projects`（项目）、`tags`（标签关联）、`noteblocks`（区块化备注）、`todos`（待办事项）。

3. **React 前端界面 100% 还原**
   - **基础路由与 Layout**：实现无缝侧边栏与多窗口路由切换。
   - **Dashboard (仪表板)**：实现了活跃项目列表和**底部对齐垂直柱状图**（动态宽度计算展示：开发中、已完成、已暂停）。
   - **ProjectList (项目列表)**：完成顶部自定义多色彩标签筛选器，接入模糊搜索，响应式呈现附带进度条的项目卡片网格。
   - **TagManagement (标签管理)**：实现了色彩选择与高亮呈现，并能直观看到每个标签受哪些真实项目引用。
   - **ProjectDetail (项目详情页)**：
     - **核心攻克**：重构实现了基于带时间戳管理的**多 Block 区块化项目备注逻辑**。
     - **细节还原**：实现了基础 Todos 复选逻辑和进度条的同步拖拽控制。
   - **Settings (全局设置)**：设计开发静态界面与存储选项入口区。

4. **视觉与 UI 体验升级**
   - 引入降级稳定的 TailwindCSS v3.4.1，编写极简黑色主题和玻璃态基础布局。
   - 针对长视区统一替换上了自定义的半透明 Webkit 滚动条，以规避 Windows 默认滚轮的粗糙视觉。

5. **安全加固、功能闭环与高端 UX 体验重构 (2026-05-30 重磅升级)**
   - **安全与稳定性**：
     - 新增全局 React `ErrorBoundary` 保证渲染崩溃时显示优雅的挽救 UI，避免白屏。
     - 重写了 `preload.ts` 并引入严密的 IPC Channel 白名单通信校验，防止注入漏洞。
     - 屏蔽了生产构建中的 DevTools，增加 Sandbox 和限制最小窗体大小。
     - SQLite 对核心的创建项目、修改项目、提交进度流程增加事务保护，防止异常写入导致数据脏化。
     - 数据库优化添加了 6 个高频查询的查询索引（`projectId`，`tagId`，`status` 等）。
   - **功能闭环**：
     - 补齐了 ProjectDetail 中的 NoteBlocks UI 和 Todos UI，全面提供创建、 inline-edit、完成复选与删除等一整套 SQLite 后端打通的高效交互能力。
     - 修复了标签管理 `TagManagement` 编辑按钮，现支持内联标签名称、调色板改色并同步保存。
     - 项目信息区增加了带“内联二次确认面板”的项目删除功能。
   - **高端 UX 打磨**：
     - 精细设计并重构了所有主要页面（Dashboard, ProjectList, ProjectDetail, Settings, TagManagement）的极简玻璃拟态 `Skeleton` 加载骨架屏。
     - 彻底清除了数据初次拉取时可能出现的 Mock 数据短时闪烁问题（SWR stale-while-revalidate 策略）。
     - 新建了符合暗色奢华风格、支持键盘可访问性的 `ConfirmDialog` 通用磨砂玻璃模态对话框，彻底干掉了浏览器丑陋的原生 `confirm`。
     - **全局大图预览交互系统（全新重磅加入）**：
       - 独立设计开发了基于 React Portal 统一挂载的高档磨砂玻璃拟态大图预览（灯箱）系统，所有上传的图片均可点击调起全屏查看。
       - 实现了**高灵敏度鼠标滚轮无损比例缩放**（范围限制在 0.25x 到 6.0x），采用非被动式（`passive: false`）事件劫持，彻底免疫了缩放时底层网页随之发生多余滚动的缺陷。
       - 实现了基于 Pointer 触控与鼠标绝对坐标定位的**平滑拖拽移动**，利用 `PointerCapture` 机制自动锁焦，当鼠标滑动越过窗口边界时拖拽绝不中断；同时在拖动平移状态下自动关闭 transform 的过渡动画，实现 GPU 级瞬时渲染零延迟。
       - 附带了一体式高级磨砂玻璃悬浮控制栏（展示缩放比、手动放大/缩小按钮、一键复位及关闭），并完美兼任了双击图片一键重置平移缩放、按键盘 `Escape` / 点击空白半透明背景极速退出等全套细节交互。
       - 通过在详情页中首创“双按钮悬浮遮罩设计”（放大预览与星标设为封面独立运行），一举化解了缩略图“点击设为封面”与“点击预览大图”的二义性冲突痛点，体验极其高端、连贯且丝滑。
   - **高级性能与状态缓存**：
     - 引入原生无依赖 of React Context `ProjectStore` 全局数据缓存，消除了频繁切页时重复触发大量 IPC 全量拉取导致卡顿 of 缺点，实现 **100% 页面间导航秒级切换，零闪烁、零白屏**。
     - 为 `SafeImage` 添加了容量上限为 100 张、先进先出自动驱逐的 Local 内存 `LRU Cache`，相同封面或截图再次加载时一瞬间渲染，免去重复本地磁盘读写与 base64 编码耗能。

6. **🐛 深度调试与重大缺陷修复记录 (2026-05-30 紧急修复)**
   - **`start.bat` 一键启动脚本闪退修复**：
     - *缺陷表现*：双击 `start.bat` 瞬间闪退，并报 `'环境...' is not recognized as an internal or external command`。
     - *根本原因*：批处理文件使用不带 BOM 的 UTF-8 编码且包含大段中文，且核心控制流使用多行嵌套 `if (...)` 括号块。由于 CMD 解释器默认使用系统的 OEM（如 GBK）代码页读取该文件，中文字节被误解析为特殊的半角括号 `)` 或控制字符，从而导致括号语法瞬间坍塌。另外，单个 `%` 未转义也会引起崩溃。
     - *终极修复*：将嵌套括号块全部重构为平铺单行 `if goto` 标签跳转逻辑，避开了多行 `if` 解析机制；将单个 `%` 正确改写为 `%%` 转义；最后在 PowerShell 中使用 `-Encoding Default` 将文件物理编码强制转换为系统的 **ANSI (GBK)** 编码，彻底免疫了 CMD 字符集多字节截断闪退。
   - **热力图 aspect-square 循环对齐拉伸 Bug 修复**：
     - *缺陷表现*：热力图区域在特定 Chromium 渲染引擎下产生了极其巨大的灰色方块群，撑爆了卡片，使用户可以一直往下滚。
     - *根本原因*：格子使用 `span` 行内元素，在 Grid 容器（默认为 `align-items: stretch`）中没有显式设置宽度却带有 `aspect-square`，触发了浏览器排版引擎的“高度拉伸 -> 反推宽度拉伸 -> Grid 容器变化 -> 重新拉伸高度”的双向恶性死循环计算。
     - *终极修复*：将 `span` 彻底替换为块级元素 `div` 并显式添加 `w-full` 约束，迫使浏览器先根据列均分宽度单向计算出等高正方形；同时，当活跃提交数据为空时，前置渲染一个精致小巧的“暂无活跃度数据”空状态，消除了空数据时 56 个灰色小方格的多余占位。
   - **热力图阶梯渲染不着色（透明空框）Bug 修复**：
     - *缺陷表现*：在详情页中写入提交进展后，对应的格子没有被染成绿色，而是变成了一个完全透明的黑色空框。
     - *根本原因*：样式表 `src/index.css` 将 `--status-completed` 声明为了 HEX 十六进制值 `#63D693`。在 React 中，有提交的格子被赋予了 Tailwind 动态透明度类名 `bg-status-completed/25`。打包后的 CSS 变成了 `rgb(#63D693 / 0.25)`，这种十六进制斜杠插值在部分渲染引擎中被判定为非法属性，导致整个背景色直接被丢弃（Ignore），从而露出了底部的纯黑卡片底色，呈现为“空框”。
     - *终极修复*：在 `src/index.css` 里显式定义 4 档基于标准原生 `rgba` 语法的静态背景色类（`.bg-status-level-1` 到 `.bg-status-level-4`），在 React 中以静态映射调用；同时将 `span` 改为 `div`、加入 `w-full`，并为详情页热力格子也同步新增了精致灵动的 `hover:scale-110` 悬停微放大动画。
   - **项目详情页自定义下拉菜单点击穿透 Bug 修复**：
     - *缺陷表现*：项目详情页自定义状态下拉菜单展开后（溢出到了卡片下方），虽然视觉上完全可见，但是底部的选项（如“完成”、“归档”等）在用鼠标点击时没有响应，点击事件会直接穿透并被下方“进展时间线”与“提交热力图”等兄弟大卡片拦截。
     - *根本原因*：`overflow: visible` 只是解除了父级卡片的视觉显示截断，但并未改变当前卡片在整个 Grid 布局（兄弟 section 之间）中的 CSS 堆叠上下文（Stacking Context）层级。由于包含时间线、热力图的第二个 section 在 DOM 树中声明靠后，其物理堆叠优先级天然高于第一个包含顶部卡片的 section，导致下方选项被无形拦截。
     - *终极修复*：在 `src/pages/ProjectDetail.tsx` 的第一个外层 section 容器上注入 `relative z-30`，从而给第一个 section 显式建立高优先级的层叠上下文，强行将它的视觉和指针事件（Click 事件等）图层提到最上方，彻底攻克了溢出菜单点击穿透的物理拦截难题。
   - **时间线滚动左侧轴线断开不向下延伸 Bug 修复**：
     - *缺陷表现*：进展时间线长过一屏并产生纵向滚动后，随着内容向下滚动，左侧纵向绿点旁边的连接轴线并没有随之向下走，出现了轴线在中途“戛然而止”断开的怪异视觉表现。
     - *根本原因*：原本的轴线是使用 `before` 伪元素绝对定位渲染在具有 `overflow-y-auto` 的滚动窗口容器 `div` 上。在 CSS 排版中，滚动容器本身的绝对定位伪元素是基于“可视 Viewport”高度（即 `max-h-[540px]`）进行定位的，它无法随内部滚动区的内容（Card 组）高度撑开并滚动，导致滚下去的内容旁边没有轴线。
     - *终极修复*：将原滚动容器重构为“双层结构”——外层 `div` 仅负责 `overflow-y-auto` 视口滚动，内层包装层 `div` 则负责 `relative pl-7` 布局及 `before:absolute` 轴线渲染。因为内层包装层会随多张卡片的高度物理撑开，因此轴线会完美撑满并随卡片一起在视口中滚动延伸，彻底根治了滚动断线的视觉顽疾。

---

## 🚀 下一阶段 (Next Steps)

1. **更深度的大规模测试覆盖**：在保证现有单元测试 100% 通过的情况下，引入组件与主进程的单元测试覆盖。
2. **编译与打包系统 (Build System)**：利用 `electron-builder` 配置最终的 `.exe` 可执行安装包或便携运行程序。

---

> 每一个 vibecoding 项目，都在见证着这个产品走向卓越与健壮！继续加油！
