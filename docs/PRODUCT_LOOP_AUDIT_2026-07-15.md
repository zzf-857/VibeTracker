# VibeTracker 产品闭环审计与迭代账本

更新时间：2026-07-16（Asia/Shanghai）

## 当前结论

VibeTracker 当前是可运行的“本地项目中枢 Beta”。真实 Electron 流程已经能够串行完成：

> 导入本地项目 → 扫描 Git → AI 生成可追溯草稿 → 用户审核 → 增量同步 → 确认启动 → 查看日志 → 停止或删除

本轮已完成会直接影响用户操作、数据语义或用户文件安全的优先项：

- 设置页状态创建、编辑、删除和排序已全部切换到领域 API，不再调用 preload 已拒绝的旧通道。
- 截图目录迁移已改为专用领域服务：只迁移 VibeTracker 明确创建并登记的 `managed_assets`，采用复制校验、数据库事务、失败反向恢复和启动续跑日志；外部原图不会因位于截图目录下而自动成为托管资产。
- Git 提交已从“最近列表”升级为可消费队列：支持待处理、已读、已处理和忽略；手工记录可关联真实 SHA，AI 接受会自动完成提交，拒绝与拒绝并忽略语义分离。
- Schema v7 把草稿或正式记录与 Git tracking 的不变量下沉到数据库：草稿占用的 SHA 始终保持 pending 但不可重复消费，正式记录关联的 SHA 始终为 handled 并保留 `handledByRecordId`；迁移会修复旧的矛盾状态。
- Git 事实页现在显式展示“待审核草稿”和“已处理”，只能跳转到关联记录，不再允许错误恢复、忽略或重复归档。
- 项目历史生成的 AI 规则已在未手工保存时直接参与生成；AI 返回给审核界面的草稿也已限定为当次 generation run。
- Schema v8 将 AI generation run 升级为可恢复运行记录：保存成功、失败、取消状态，以及 SHA、规则版本、规则/设置/输入快照、错误和原替换范围；历史批次可以重新打开、复核并按原范围重试。
- Launch 多 Profile 已收口：同项目只允许一个托管 runtime，项目卡片优先控制真实运行 Profile，运行中配置锁定，ready 状态同时提供打开和停止。
- 白屏恢复已覆盖 React 挂载前、preload 失败、入口加载失败和 renderer 崩溃：HTML 自带暗色启动态，主进程提供可重试诊断页，崩溃重载具有次数上限，避免反复崩溃循环。
- production sender、导航和 Updater IPC 已限定到应用自身 `dist/index.html`；项目封面和开发记录图片写库前使用 realpath、类型、大小、项目根、托管引用或短期选择授权校验，仓库 symlink/junction 不能越界授权。
- AI generation run 启动恢复会把上次异常退出留下的 `running` 批次转为可重试失败；连接测试直接使用当前未保存参数且不写配置，并兼容没有 `/models` 的 Provider。
- LLM 输入和 HTTP 响应分别增加 2 MB 与 4 MB 上限；真实仓库截图候选进入输入，`assetNotes.path` 必须引用本次候选。
- 设置写入已串行化，截图目录迁移与 LLM 设置并发保存不会互相覆盖；import/create-empty 会拒绝不存在的状态和标签。
- Schema v10 已完成持久 Git 调度与历史回填语义：除失败次数和重试时间外，固定 HEAD、generation、offset、总量和断点均写入数据库；每批独立事务落库，完成前不会切换可达历史。
- 手工同步、AI 同步前扫描、首次导入和自动同步现在共用同一个 Git Coordinator；同项目请求共享一次扫描，并继续与 relink/Launch/删除共用项目锁。
- 主进程 Git Scheduler 不依赖 renderer，按 due 状态调度，默认并发上限为 2，失败指数退避；退出时停止领取新项目并取消正在执行的 scheduled Git 命令。
- renderer 已移除五分钟逐项目执行循环，改为监听主进程 `git:state` 刷新；窗口聚焦只刷新数据，不再成为同步前提。
- 运行中的项目禁止 relink，避免旧 cwd 进程与新仓库状态分裂；LLM Provider registry、AI/Launch 对话框焦点陷阱和项目菜单键盘语义已补齐。
- 正式开发记录图片已形成完整闭环：创建前预览/移除，创建后追加、caption、排序与删除；主进程严格验证正式记录、记录归属和图片路径。
- 托管封面和记录图片现按真实引用即时归属；替换封面、删除记录/项目或启动恢复时，都能修复陈旧 ownership 并且只清理无引用的应用托管文件。
- `userEditedAt` 只在标题、内容或其他可编辑字段实际变化时写入；`project:get` 改为单项目 summary，不再预加载新详情页不使用的 30 条时间线。
- 待办完成状态、Launch enabled 和图片多选标记已改为严格布尔验证，不再将字符串 `"false"` 误解为 `true`。
- 本地图片缩略图链路已完成：受控协议支持尺寸白名单、文件版本失效、并发去重和有界 LRU；画廊、导入候选和开发记录使用缩略图，点击预览恢复原图。
- AI 待处理输入已从固定最早 50 条升级为带总量、日期范围和稳定游标的分页选择；界面支持继续加载、全选已加载范围、单次 200 条保护和近似输入字节提示。
- Git/记录深链接会自动连续加载到目标；“加载更早”增加请求去重、loading、失败详情、重试和重复追加保护。
- 自动 Git Scheduler 已进入统一任务中心，自动任务可见、可取消并展示完成或失败；Scheduler 改为窗口创建后启动，避免早期 renderer 事件丢失。
- 导入现在区分“项目创建成功但首次 Git 同步失败”，不会再显示矛盾的纯成功提示；Git timeout、权限和 dubious ownership 也不会再被误判为普通非 Git 目录。
- 领域分页、时间、状态排序和旧进度数值改为严格数字校验；LLM 设置会拒绝非法枚举和未知字段，不再静默忽略。
- 迁移测试新增故障注入，已证明迁移中途失败会回滚 DDL、保留原数据，并生成可读取且 integrity_check 通过的备份。
- Git log 已改为 NUL 分帧协议，commit message、正文、Tab、换行、旧控制字符、rename/copy、二进制文件和特殊文件名均作为数据解析。
- AI、Launch 与通用确认对话框已通过 Portal 脱离带 transform 的路由容器；长列表滚动后 header、关闭和底部审核操作不会再被页面滚动或任务中心遮挡。
- 领域 invoke 返回现统一经过通道级运行时校验；关键项目、Git、记录、设置、AI、Launch 和 Updater shape 在进入 renderer 前验证，并拒绝 `undefined`、非有限数值和循环引用。
- 截图目录迁移现通过统一后台任务展示真实阶段与进度；复制阶段可取消并回滚，失败任务保留可重试入口。
- Schema v11 为每次 AI 项目资料建议应用保存 generation run、输入 SHA、应用前快照、实际应用值和应用时间；运行历史可查询应用次数。
- Schema v12 持久化后台任务历史；renderer 启动会水合最近任务，异常退出遗留的 running 任务会转为可重试的“已中断”。
- 活动路由不再以 `opacity: 0` 作为默认状态；GSAP 动画失败、被打断或挂起时会强制恢复可见。renderer 持续无响应时会显示原生恢复选择。
- 数据库启动前后执行 quick check，迁移备份再次执行 integrity check；损坏数据库会进入独立恢复页，隔离原库及 sidecar 后恢复通过校验的备份。
- 主进程 Scheduler 已通过真实 Electron 仓库验证：renderer 空闲期间新增 commit 会被自动发现；异常退出留下的增量 backfill offset 会在重启后续传并恢复任务中心状态。
- Launch 候选发现已覆盖 npm scripts、Python/Django/FastAPI/Flask、Cargo、Go、.NET、Swift、Maven 和 Gradle 等常见结构，扫描器仍只生成候选而不会执行。
- AI 项目资料建议的应用追溯已补全：运行详情可展开查看每次应用的前后字段、时间和完整 Git SHA 范围，应用成功后即时刷新当前 generation run。
- Schema v14 正式删除 `projects.progress` 与 `development_records.progressDelta`；活跃类型、summary 和 UI 已统一使用 DevelopmentRecord、阶段、里程碑和下一步。
- Schema v15 增加项目状态、generation run 生命周期、手工记录审核、generation run 同项目归属、Git SHA 格式/项目归属/活跃记录唯一性等数据库 guard；AI 草稿替换会先在同一事务释放旧草稿，再写新草稿。
- Schema v16 保存可选 Git 历史基线；导入向导支持完整历史或最近 200/500/1000/2000 条，后续新增提交不受基线限制并继续增量同步。
- Schema v17 保存项目重新关联前的仓库根目录；详情页会检测仍指向旧仓库的外部封面/开发记录图片，托管图片与当前仓库图片不会误报，用户可替换/移除封面或跳转关联记录处理。
- Settings 已拆为“AI 与生成 / 状态与标签 / 存储与更新”三个分区；高级生成与日志规则默认折叠，状态颜色不再常驻展示整排色块，并补齐方向键/Home/End、960/1440 无横向溢出回归。
- Windows Launch watchdog 通过 lifetime pipe 处理父进程硬退出，清理自己仍持有的目标进程树；正常停止仍由 Process Manager 等待真实 exit/close。
- LLM 设置页只提交可写字段，不再把只读 `hasApiKey` 回传；真实保存按钮已进入 Electron 核心 E2E。
- NSIS 安装器已生成；隔离 `win-unpacked` packaged smoke 已通过 schema、safeStorage、受控图片协议、watchdog 启停和重启持久化。`package:installed-smoke` 进一步验证 0.0.9→0.1.0 的真实安装和 `--updated` 覆盖升级、数据保留、快捷方式、卸载注册项、静默卸载以及零临时残留。
- 领域 IPC 输入已采用字段白名单，未知项目/记录/分页/Launch 字段会被拒绝；Project、DevelopmentRecord、GitCommit、Dashboard、AI generation/snapshot 和 Launch 日志已按完整嵌套结构验证。
- `git:state`、`launch:state` 与 `task:progress` push event 在广播前执行运行时校验；Launch 扫描候选的展示说明不会进入正式 Profile。
- README 简介候选改为提取前两段正文并过滤 HTML、Badge、Markdown 图片/导航和代码块，导入后的项目头部不再展示标记残片。

当前没有已知会阻止核心 happy path 的 P0。普通仓库与大仓库的导入、Git、AI 审核、持续同步和 Launch 已形成真实闭环；数据语义、历史基线、父进程死亡清理、数据库约束、packaged/installed 资源、安全存储、relink 图片提示与领域 IPC 契约也已接通。剩余内容是已退出运行路径的旧代码/兼容壳物理退役和领域 IPC 文件拆薄，不构成用户逻辑断点；联网 Updater 下载需要真实远端版本，而本轮明确不发布。

## 2026-07-16 最新验证基线

- 前端 TypeScript：通过。
- Electron TypeScript：通过。
- `npm run lint`：通过。
- `npm run test:unit`：145/145 通过。
- `npm run build`：通过。
- `npm run dev`：使用临时 userData，Vite、Electron 主进程、preload 和 renderer 正常启动。
- Electron E2E：12/12 通过，本次复跑约 1.5 分钟。
- Windows 打包在 `--publish never` 下通过；隔离 packaged smoke 验证 schema v17、safeStorage、`vibe-asset`、watchdog Launch/停止和重启持久化。
- `npm run package:installed-smoke`：0.0.9 安装、隔离数据写入、`--updated` 覆盖到 0.1.0、schema/data 保留、快捷方式与卸载注册项、静默卸载和零残留全部通过。
- 临时 OpenAI-compatible Provider 无落盘实测：连接、结构化生成、schema、置信度、提示注入隔离、SHA 追溯和 64 位 inputHash 全部通过。

Electron E2E 当前覆盖：

- 应用加载、preload、主导航和非白屏。
- 旧数据库迁移后项目、开发记录、图片、标签、备注和待办可查看、编辑并跨重启保留。
- 完全未配置 LLM 时，Git 导入、手工空项目和手工开发记录仍可使用。
- 960px/1440px 基础页面、三个 Settings 分区、键盘切换、默认折叠高级规则、导入对话框焦点恢复与 reduced-motion。
- 状态创建、修改、删除；标签创建、修改、删除。
- 截图目录迁移任务进入任务中心并完成。
- 后台任务历史跨重启水合，运行中任务恢复为可重试中断状态。
- Launch 失败日志跨重启保留，异常退出运行恢复为不可误停止的 interrupted 诊断状态。
- 损坏数据库显示恢复页，隔离原库后从完整性校验通过的备份恢复。
- renderer 持续无响应后自动重载并恢复为可见路由。
- 主进程 Scheduler 在 renderer 空闲时自动发现真实新提交并更新任务中心。
- 异常退出留下的增量回填 offset 在重启后继续，旧运行任务水合为中断状态。
- preload 拒绝旧状态、旧设置和任意本地路径打开通道。
- 原生导入向导、Git 初次同步和重复同步幂等。
- 本地 OpenAI-compatible Provider、AI 生成、编辑审核和正式记录。
- 使用当前未保存的 Base URL/Model/API Key 测试连接，且失败或成功都不会提前持久化设置。
- 项目/记录/分页未知字段与 Launch 服务端只读字段在真实 IPC 层被拒绝，三类 push event 具备独立契约测试。
- 历史建议 AI 规则确实进入当次模型请求。
- AI generation run 的输入哈希、SHA、无密钥设置快照、重新打开、失败记录和按原范围重试。
- 草稿占用 SHA 在 Git 事实页显示“待审核草稿”，且无法写入手工记录或恢复 pending。
- 草稿接受后同一 SHA 显示“已处理”，且不再提供“恢复待处理”。
- Git 提交忽略、恢复待处理、手工记录关联 SHA，以及待处理队列归零。
- 备注、待办创建、完成和删除。
- 备注与待办内容编辑，以及非布尔待办完成状态拦截。
- 正式记录图片追加、caption 编辑、排序、删除、托管文件物理清理与外部项目图片保留。
- 仓库 relink 后旧封面/开发记录图片提示、封面移除、关联记录跳转与引用清理后提示消失。
- Launch 保存、首次确认、日志、启动、卡片操作和停止；多 Profile 互斥、运行配置投影、运行中禁止保存、ready 同时打开/停止。
- 重复导入拦截；删除运行中项目并清理 runtime。
- 未授权外部图片写库拦截、项目仓库内图片合法持久化，以及 import/create-empty 的无效状态/标签拦截。
- React 挂载后移除静态启动态；入口加载失败时显示暗色恢复页而不是空白窗口。

自动化回归与开发启动验证仍全部使用临时 userData。真实数据只发生过两次有记录的迁移/演练：

- 早期并行验证曾误用默认 userData，触发 schema v4→v8 迁移；自动备份为 `C:\Users\admin\AppData\Roaming\VibeTracker\vibetracker-pre-schema-20260715-214452.db`，迁移前后均为 7 个项目、19 条开发记录、16 张图片，`integrity_check=ok`。
- 2026-07-16 经用户明确授权导入指定本地项目。操作前额外创建并校验 `C:\Users\admin\AppData\Roaming\VibeTracker\vibetracker-pre-bulk-import-20260716-041051.db`，应用迁移器生成 v8→v12 自动备份 `vibetracker-pre-schema-20260716-041300.db`，加载 Launch 历史版本时再生成 v12→v13 自动备份 `vibetracker-pre-schema-20260716-043213.db`。最终旧 7 个项目、19 条正式记录和 16 张图片全部保留；新增 7 个项目、补关联 EasyGet/AISubtitle、保留已有非 Git LANToolkit，共形成 14 个项目、769 条 Git 事实和 1 条待审核 AI 草稿，`integrity_check=ok`。
- 2026-07-16 最新构建正常关闭旧窗口后自动执行 v13→v16；备份 `C:\Users\admin\AppData\Roaming\VibeTracker\vibetracker-pre-schema-20260716-051350.db` 已生成。迁移后为 14 个项目、19 条正式记录、1 条草稿、16 张图片和 771 条 Git 事实，两列伪百分比已移除，16 个领域 guard 生效，`integrity_check=ok`。
- 真实安全存储中的临时 Provider 只用于能力验证：一次 10 提交生成超时被保存为失败 run，没有草稿；缩小到 3 提交后生成 1 条带完整 SHA 与 64 位 inputHash 的待审核草稿。未自动接受记录，也未应用项目资料建议；普通 config 和 SQLite 中不含明文 API Key。
- 2026-07-16 补扫指定目录中的三个嵌套仓库：`halo-theme-hydro-minim`、`plugin-alist`、`plugin-links` 通过正式导入 API 分别同步 175、17、200 条 Git 事实；当前真实库为 17 个项目、19 条正式记录、2 条待审核草稿、16 张图片和 1163 条 Git 事实，`integrity_check=ok`。安全存储中的 Provider 再次完成真实连接及 3 SHA 草稿生成，未接受草稿或应用项目资料建议。
- 2026-07-16 正常关闭旧窗口后执行 v16→v17；自动备份 `C:\Users\admin\AppData\Roaming\VibeTracker\vibetracker-pre-schema-20260716-062204.db` 已生成。迁移后仍为 17 个项目、19 条正式记录、2 条待审核草稿、16 张图片、1163 条 Git 事实和 5 个 Launch Profile，`integrity_check=ok`；安全存储中的 Provider 随后再次通过真实连接测试。

## 已完成能力

### 数据语义与迁移

- [x] Git commit、开发记录和 AI 草稿使用独立表与独立语义。
- [x] 旧 `project_commits` 迁移为 `manual + accepted`，保留开发记录和图片路径。
- [x] 开发记录保存 source、reviewStatus、Git SHA、provider、model、promptVersion、inputHash、generationRunId、confidence、evidence 和完整时间字段。
- [x] Schema v1-v17 具备顺序版本、迁移前一致性备份、统一事务和失败回滚。
- [x] 正式 schema 删除项目/开发记录伪百分比；阶段、里程碑和下一步替代不可证实的完成度。
- [x] 项目状态、generation 生命周期、记录来源/审核、generation 归属和记录/Git 关联具备数据库级 guard。
- [x] 旧应用数据库迁移处理 WAL、双备份、源变化检测和临时目录清理。

### 项目导入与 Git

- [x] 原生目录选择器、canonical path、目录存在性、Git 状态和重复导入验证。
- [x] 展示名称、分支、HEAD、detached HEAD、提交数、最近提交、remote、技术栈、README、启动和图片候选。
- [x] 支持非 Git、空仓库、detached HEAD、Git 不可用和路径失效。
- [x] Git 使用 `execFile` 与参数数组，并设置超时和输出大小限制。
- [x] 分批读取完整历史，扫描固定到开始时捕获的 immutable HEAD SHA。
- [x] Schema v10 持久保存回填 generation、anchor、offset 和 total；每批事务落库，取消、失败和异常退出可续传。
- [x] 回填完成前保持旧 reachability，完成后原子发布新历史；项目卡片、详情和任务中心展示真实进度与断点。
- [x] Git 日志使用 NUL 分帧与 `-z --numstat`，覆盖控制字符、换行、Tab、rename/copy、二进制与特殊文件名。
- [x] `(projectId, sha)` 唯一；重复扫描幂等。
- [x] force-push、rebase 和分支切换使用 reachability generation，旧事实保留但不再进入当前列表或 AI 输入。
- [x] sync 与 relink 共用项目级锁。
- [x] Git 和开发记录时间线使用复合游标分页。
- [x] Git commit tracking 支持 pending/handled/ignored、seenAt 和处理记录追溯。
- [x] active draft/accepted 记录与 tracking 具备数据库级不变量，迁移会修复旧的矛盾状态。
- [x] 主进程持久 Git 调度、due 查询、并发上限、失败退避、成功清零、异常退出恢复和 renderer 状态广播。
- [x] 首次导入和手工/自动同步共用 Coordinator，同项目并发请求不会重复扫描。
- [x] 首次/重写全量扫描可使用最近 N 条历史基线，之后的新提交继续完整增量同步；详情明确展示截断范围。
- [x] Git 事实页可区分可消费 pending、草稿占用和正式记录处理，并可跳转关联记录。
- [x] Dashboard 只展示真正待处理的 Git 提交，不再把最近历史永久称作新提交。
- [x] 手工记录可聚合并关联真实 Git SHA；删除对应记录会将提交恢复为待处理。

### AI 草稿与审核

- [x] OpenAI-compatible API、连接测试和 safeStorage API Key。
- [x] 普通 LLM 设置与加密 Key 使用不含明文密钥的事务 journal；三个持久阶段可前滚，暂存损坏可回滚，删除密钥可恢复。
- [x] 默认不发送源码或 diff；Git 文本和文件名按不可信数据处理。
- [x] 结构化 JSON、运行时 schema、置信度、证据和真实 SHA 校验。
- [x] 生成前展示并允许选择提交、文件和 stat 范围。
- [x] 草稿支持编辑、接受、拒绝和事务性重新生成。
- [x] 项目名称、简介、阶段、标签和技术栈建议必须由用户明确应用。
- [x] 每次项目资料建议应用保存并展示应用前后差异、应用时间和关联 Git SHA。
- [x] 项目 AI 规则结构化、可编辑、可版本化。
- [x] 未保存的历史建议规则与设置页展示使用同一套有效规则，会直接参与生成。
- [x] AI 审核对话框只显示当次 generation run 创建的草稿。
- [x] generation run 支持 list/get/reopen，成功、失败和取消状态均可追溯。
- [x] 应用启动时将异常退出遗留的 running generation run 标记为可重试的中断失败。
- [x] generation run 保存规则版本、规则快照、无密钥设置快照、输入快照、错误和原替换范围。
- [x] 重新生成与后台任务重试复用原始 SHA、规则、Provider 设置和 replaceDraftIds；API Key 仍只从系统安全存储读取。
- [x] 正式 AI 记录可查看 provider/model/promptVersion/inputHash/证据和 Git SHA。
- [x] 未配置 LLM 时导入、同步、手工项目和手工记录仍可使用。
- [x] 连接测试使用当前未保存参数，不提前写配置，并在 `/models` 不可用时回退到最小聊天请求。
- [x] LLM 输入与响应具有字节预算；仓库截图候选进入模型输入且输出路径必须匹配真实候选。
- [x] 待处理 AI 输入支持总量、日期范围、稳定游标分页、继续加载和近似字节预估，不再被固定首批 50 条阻塞。

### Launch 与 Process Manager

- [x] Launch Profile 支持 executable、args[]、cwd、env、ready URL/port、enabled 和 validated。
- [x] 扫描器只推荐，不自动执行。
- [x] 首次执行或配置变化后展示实际命令并确认。
- [x] 使用 `spawn` 与参数数组，`shell: false`；Windows npm 转为 node + npm-cli。
- [x] 支持 starting/running/ready/failed/stopped、日志、重复启动保护、打开和停止。
- [x] stop/stopAll/stopProject 等待真实 exit/close；强杀失败可重试。
- [x] 删除 Profile、删除项目、应用退出和更新安装都会确认托管进程退出。
- [x] 卡片启动按钮不触发卡片跳转，启动能力独立于项目阶段。
- [x] import、Launch 操作与项目删除共享项目生命周期锁，同项目只允许一个运行 Profile。
- [x] 运行中配置字段、保存和删除被锁定；Profile 切换不会串写其他 runtime 状态。
- [x] 项目 summary 优先投影真实 live runtime；ready 且有 URL 时卡片同时提供打开和停止。
- [x] Launch run、失败摘要与有界日志持久化；重启后只恢复诊断状态，不把历史 PID 当作当前可控进程。
- [x] Windows watchdog 通过父进程 lifetime pipe 在硬退出后清理持有的目标进程树；packaged asar 路径已验证。

### UI 与工程底座

- [x] 画廊页头导入、单行工具栏和 `auto-fill/minmax` 网格。
- [x] 详情拆为概览、开发记录、备注与待办、项目设置。
- [x] Dashboard 改为行动中心，不再重复完整画廊。
- [x] 主导航精简为首页、项目、设置；状态和标签并入设置。
- [x] Settings 使用三个低噪声分区，高级规则默认折叠；960/1440、方向键/Home/End 与横向溢出均有 Electron 回归。
- [x] relink 旧仓库根目录持久化；外部封面/开发记录图片提示、替换/移除与记录跳转闭环已有数据库和 Electron 回归。
- [x] `lang="zh-CN"`、reduced-motion、焦点样式、部分焦点陷阱和 ARIA。
- [x] Git、AI、Launch、Assets、Database 已拆为独立主进程服务。
- [x] 项目列表和 Dashboard 使用 summary API。
- [x] 本地图片使用受控 `vibe-asset` 协议，不再默认 Base64 常驻。
- [x] 托管资产删除失败会保留可重试记录。
- [x] 截图目录只迁移明确托管资产，支持失败补偿和启动恢复。
- [x] Toast、后台任务进度、取消、重试和错误详情。
- [x] 自动 Git Scheduler 进入统一任务中心并可按项目取消；任务状态与 Git 状态使用同一主进程事件来源。
- [x] AI 对话框上层可访问后台任务中心，生成期间的取消入口不再被遮挡。
- [x] Dashboard 手动重试 Git 后同时刷新全局项目 store，画廊卡片不再保留旧状态。
- [x] 备注和待办支持内容编辑、保存、取消与失败保留，并已纳入 Electron E2E。
- [x] 开发记录、AI 草稿和 generation run 使用批量 hydration，消除每条记录分别查询图片/SHA 的 N+1。
- [x] BrowserWindow 使用暗色底色，主页加载失败会显示可诊断失败页，未知路由自动返回首页。
- [x] HTML 静态暗色启动态、preload 缺失诊断、renderer 崩溃限次重载和暗色恢复页。
- [x] 设置文件写入串行化，截图目录与 LLM 设置并发更新不会丢失。
- [x] Git/记录深链接自动加载到目标；分页请求具备锁、错误、重试和去重追加。
- [x] 导入部分成功语义、Git 检查错误分类和设置枚举校验已收紧。
- [x] CI 和 Release workflow 已加入 lint、unit、build/E2E 门禁。

## 当前未闭合项

### P1：发布前异常闭环

- [x] **Launch 硬崩溃孤儿进程处理**：Windows watchdog 与 packaged 启停均已验证；历史 PID 仍只作诊断，不用于重启后停止。
- [x] **超大仓库历史基线**：支持最近 N 条基线并展示覆盖边界，增量同步不截断。
- [x] **安装/升级 smoke**：隔离 NSIS 0.0.9→0.1.0 已按 electron-updater 使用的 `--updated` 模式完成覆盖升级，项目/开发记录/schema v17 保留；快捷方式、卸载注册项、静默卸载和零残留均已验证。联网检查/下载等待真实远端版本且不在“不发布”授权范围内。

### P2：数据语义与工程收尾

- [ ] 活跃代码和正式 schema 已废弃 ProjectCommit/progress/progressDelta；仍需物理删除已退出构建的旧详情页、旧 handler，以及只为该页面保留的 `ProjectCommit`/旧表兼容壳。
- [x] `projects.status`、`development_records.generationRunId` 和开发记录/Git SHA 归属已有数据库等价约束。
- [ ] 删除已退出路由/编译的旧 handler、旧详情页和旧类型代码；继续把约 1200 行的领域 IPC 编排按 Project/Git/AI/Launch/Assets 拆薄。
- [x] 复杂 AI run、Dashboard、Launch 日志和 push event 已采用完整嵌套校验；renderer 输入统一拒绝未知字段，返回契约保留向后兼容的附加数据库列但强制所有领域字段类型与枚举。
- [x] Settings 信息架构与视觉降噪完成，三个分区在 960/1440 窗口均无横向溢出。
- [x] 仓库 relink 后，仍引用旧仓库文件的封面/外部图片具备持续失效提示和用户清理入口。
- [ ] 补截图迁移 UI 故障的 Electron 场景；硬崩溃 Launch、packaged sender/resource protocol、真实安装升级、未配置 LLM、Scheduler、旧库迁移、白屏恢复、响应式和核心 import/delete/Launch 流程已有自动化回归。

## 下一实施批次

1. 用户允许处理现有未提交旧文件后，物理删除已退出路由/编译的旧 IPC handler、旧详情页和仅供旧页面使用的兼容类型/表壳。
2. 继续拆薄领域 IPC，降低单文件编排体积。
3. 有真实远端版本且获得发布授权后，补联网 Updater 检查、下载和签名链路验收。

## 工作区约束

- 当前工作区包含大量用户未提交改动，持续保留并兼容。
- 禁止 reset、checkout 或覆盖无关修改。
- 不提交、不推送、不发布，除非用户另行要求。
- 所有数据库和 Electron 流程测试使用临时目录。
- 不使用任何 Superpowers skill 或项目内 `.superpowers` 内容作为执行流程。
