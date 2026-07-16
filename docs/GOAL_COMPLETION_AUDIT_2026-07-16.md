# VibeTracker 本地项目中枢 Goal 完成性审计

审计时间：2026-07-16（Asia/Shanghai）

## 结论

原始核心闭环已经由真实 Electron、真实 Git 仓库、真实安全存储 Provider、真实用户数据库和隔离 Windows 安装包共同证明：

> 导入本地项目 → 扫描 Git → AI 生成可追溯草稿 → 用户审核 → 持续增量同步 → 确认并启动演示 → 查看日志/打开/停止

没有把设计稿、空壳、Mock 或单一 happy-path 单测当作完成证据。自动化数据库和 Electron 流程均使用临时目录；真实数据库只执行了有自动备份的版本迁移和用户明确要求的项目导入。全程未使用 Superpowers skill，也未读取项目内 `.superpowers` 作为执行流程。

## Phase 1：数据语义、迁移、IPC 安全和服务层

- Git 事实位于 `git_commits`，开发记录/AI 草稿位于 `development_records`；`source`、`reviewStatus`、provider/model/promptVersion/inputHash、时间、证据和 SHA 关联均已落库。
- 旧 `project_commits` 数据迁移为 `manual + accepted`，正式运行路径不再使用伪 Git commit 语义。
- Schema v1-v17 使用顺序版本、迁移前一致性备份、统一事务和失败回滚；v14 删除正式 schema 中的 `progress/progressDelta`，v17 保存 relink 旧仓库根目录。
- preload 只暴露领域 API；sender、输入、完整嵌套返回以及 `git:state`、`launch:state`、`task:progress` push event 均执行运行时校验。
- Git、Database、Assets、LLM、Launch、Settings、Tasks 已是独立主进程服务；旧 `electron/ipcHandlers.ts` 被 Electron TypeScript 明确排除。
- 证据：`tests/databaseMigrations.test.ts`、`tests/databaseService.test.ts`、`tests/ipcResponseValidation.test.ts`、`tests/validation.test.ts`、旧库 Electron E2E 与真实 v16→v17 迁移。

## Phase 2：本地项目导入与 Git 增量同步

- 原生目录选择器后由主进程验证 canonical path、存在性、Git 状态和重复导入。
- 扫描返回名称、分支/HEAD、最近提交/数量、remote、技术栈、README、Launch 和图片候选；支持非 Git、空仓库、detached HEAD、路径失效和 Git 不可用。
- Git 只通过 `execFile`/参数数组读取 message、作者、时间、文件名和 stat，具备超时、输出上限、NUL 分帧、批量回填、持久游标和 reachability generation。
- `(projectId, sha)` 唯一，重复同步幂等；首次完整历史可选择最近 N 条基线，后续增量不受基线截断。
- 证据：`tests/gitService.test.ts`、`tests/gitRepository.test.ts`、`tests/gitSyncScheduler.test.ts`、核心/无 LLM/Scheduler Electron E2E；真实库 1165 条 Git 事实，其中 v17 启动后由 Scheduler 正常增量发现 2 条。

## Phase 3：LLM 设置、项目规则、草稿生成与审核

- OpenAI-compatible Provider 支持 Base URL、Model、默认语言、日志粒度、风格、排除路径和自定义规则。
- API Key 仅存于 Electron `safeStorage` 加密文件；普通 `config.json` 和 SQLite 不含明文字段，跨文件事务可从崩溃阶段恢复。
- 项目 AI 规则结构化、可编辑、可版本化；生成前展示提交/文件范围，默认不发送源码或完整 diff。
- 模型只接收被标记为不可信数据的 Git/README/文件信息；返回 JSON 经过 schema、真实 SHA、候选资源和输入/响应字节预算校验。
- 草稿支持编辑、接受、拒绝、重新生成和历史 run 重开；项目资料建议必须由用户明确应用并保存应用前后快照。
- 证据：`tests/llmService.test.ts`、`tests/settingsService.test.ts`、`tests/databaseService.test.ts`、核心/无 LLM Electron E2E；真实 Provider 连接及 3 SHA 生成，真实库保留 2 条待审核草稿且未静默接受。

## Phase 4：Launch Profile 与 Process Manager

- Launch Profile 使用 executable、args[]、cwd、env、ready URL/port、enabled/validated，不依赖项目生命周期状态名称。
- 扫描器只推荐；首次运行或配置变化后展示实际命令并确认。
- Process Manager 支持 starting/running/ready/failed/stopped、日志、重复启动保护、打开、停止、同项目单 runtime 和应用退出清理。
- Windows watchdog 通过父进程 lifetime pipe 处理主进程硬退出；停止和强杀失败均保持可见、可重试状态。
- 卡片/详情启动按钮不会触发卡片跳转，ready 时同时提供打开和停止。
- 证据：`tests/launchService.test.ts`、`tests/launchWatchdog.test.ts`、核心/Launch 历史 Electron E2E、packaged watchdog smoke。

## Phase 5：画廊、详情、Dashboard 和设置重构

- 画廊使用页头导入、单行搜索/筛选/排序和 `auto-fill/minmax` 网格；卡片只保留核心信息与独立启动操作。
- 详情拆为概览、开发记录、备注与待办、项目设置；顶部保留 AI 同步、启动、更多。
- Dashboard 是 Git/草稿/待办/可启动项目/异常行动中心，不重复完整画廊。
- 主导航仅首页、项目、设置；Settings 分为 AI 与生成、状态与标签、存储与更新，高级规则默认折叠。
- `lang="zh-CN"`、焦点可见性、对话框焦点管理、键盘标签切换、ARIA 和 reduced-motion 已覆盖；960/1440 无横向溢出。
- 证据：核心与 `responsive-accessibility` Electron E2E，以及真实 1440px 项目/详情检查。

## Phase 6：查询、图片、资产、任务、回归与 Windows 安装

- 项目列表/Dashboard 使用 summary 查询；开发记录、草稿、generation run 图片/SHA 使用批量 hydration；Git/记录时间线使用复合游标分页。
- 本地图片通过受控 `vibe-asset` 协议和有界缩略图缓存；路径需项目根、持久引用或短期选择授权，junction 不能越界。
- 托管资产在封面替换、记录/项目删除和启动恢复时按真实引用清理；失败保留可重试记录，外部原图不删除。
- Toast/后台任务支持持久历史、进度、取消、重试和错误详情；截图目录迁移只移动登记的托管资产并支持失败补偿。
- relink 后旧仓库封面/记录图片持续提示，可移除/替换封面或跳转记录；引用清理后提示消失。
- `package:installed-smoke` 已验证 0.0.9 安装、隔离数据写入、electron-updater `--updated` 覆盖到 0.1.0、schema/data 保留、快捷方式/注册项、静默卸载和零残留。
- 证据：Assets/Database/Thumbnail/Task/Settings 单元测试、核心 Electron E2E、packaged smoke 和 installed NSIS smoke。

## 最终门禁与真实状态

- `npm run lint`：通过。
- `npm run test:unit`：145/145 通过。
- `npm run build`：通过。
- `npm run test:e2e:run`：12/12 通过，本次约 1.5 分钟。
- `node scripts/smoke-packaged.mjs`：通过。
- `node scripts/smoke-installed.mjs`：0.0.9→0.1.0 安装升级卸载通过，零残留。
- 开发 Electron 和 `win-unpacked` 均可正常启动，不白屏。
- 真实数据库：schema v17、17 个项目、19 条正式记录、2 条草稿、16 张图片、1165 条 Git 事实、5 个 Launch Profile，`integrity_check=ok`。
- v16→v17 自动备份：`C:\Users\admin\AppData\Roaming\VibeTracker\vibetracker-pre-schema-20260716-062204.db`。
- 无提交、无推送、无发布。

## 明确延期但不影响核心闭环

1. `src/pages/ProjectDetail.tsx` 与 `electron/ipcHandlers.ts` 是已退出路由/编译的用户未提交旧文件。当前运行没有依赖；为遵守“禁止覆盖或删除用户改动”，未物理删除。
2. `electron/domainIpc.ts` 仍可继续按领域 registrar 拆薄，但 Git/AI/Launch/Assets/Database 的业务实现已经位于独立服务，不再堆入旧 handler；这是可维护性收尾，不是用户逻辑断点。
3. 在线 Updater 的远端检查、下载和签名链需要真实发布版本；用户明确要求不发布，因此只验证了 updater 实际采用的 NSIS `--updated` 安装路径，没有向外部发布或下载。
4. 截图目录迁移的正向 Electron UI 与失败/取消服务测试已覆盖；独立的“失败弹窗”Electron 场景可继续补充，但不影响现有数据补偿与重试语义。
