# 变更日志

本插件按 [语义化版本](https://semver.org/lang/zh-CN/) 发版。每个版本写清**改了什么、为什么、影响谁**；
未发版的改动记在「未发布」里，发版时整段挪到对应版本号下。

版本号规则（这个插件自己的约定）：

- `PATCH`（0.5.x）修行为错误、补边界、改文档措辞——接口不变，换上去就行。
- `MINOR`（0.x.0）加功能、加工具、加面板入口、加文件格式字段——旧看板仍能读。
- `MAJOR` 只在看板文件格式或工具签名不兼容时用；目前还没到 1.0，破坏性改动按 MINOR 走并在条目标注「不兼容」。

---

## 未发布

（暂无）

---

## 0.5.3 — 2026-11-24

### 每个会话一份面板状态（修「切会话右栏不更新」）

- **问题**：右栏面板的状态（`src/client.js` 的 `store`）是模块级单例，一份服务所有会话。
  切会话时只靠「先清空再按新会话读」撑着：上一块板会先闪一下，两个会话并排显示时两块板互相覆盖。
- **竞品怎么做**：`dsh-mattpocock-skills-deck` 的 `lib/client.js:22768` 是
  `storeOf(sid)` → `stores[sid] || makeStore(sid)`，`useStore(sid)` 只订阅这一个会话的 store。
  它不清 store（会话关掉也不回收），cwd 也从会话 store 里取，不指望宿主反查。
- **现在**：同样形状——`makeStore()` 造一份状态、`storeOf(sid)` 按会话号缓存、`useStore(sid)` 按会话订阅；
  组件从 `props.st` 拿自己那份，`set` 挂在这份上，所以两边各自刷新、互不覆盖。
  `src/host.js` 依旧接受面板发来的 `cwd`，拿不到才回退。
- **边界**：`stores` 无上界（一个会话一份，一张板才几 KB）；真要回收，等会话关闭事件再加。
- **测试**：`test/client.test.mjs`「两个会话并排，各自的板和草稿互不覆盖」——两个会话的板各读各的、
  切回来不丢、请求各带各的 `sessionId`、草稿不串。

## 0.5.2 — 2026-11-24

- 面板跟着会话走：会话号三路兜底（tab 的 `sessionId` → `props.scope.sessionId` → `useSessions(x => x.current)`），
  `cwd` 从会话 store 的 `byId[sid].cwd` 同帧取出，不再等下一轮渲染反查。
- 所有宿主请求带上 `{sessionId, cwd}`，宿主不必再猜项目目录（插件 ctx 里没有 `sessions` 服务时猜错就是别人的板）。
- 切会话先清板再读，避免新会话闪出上一个项目的卡。
- `scripts/preview.mjs`：`PSP_PROJ=<目录>` 直接画真项目那块板；版本号徽标改为从 `package.json` 读。

## 0.5.1 — 2026-11-24

- **修**：工具把卡写进 `~/.dsh/pstack-board/unbound`。宿主的工具执行上下文里没有 `cwd`、也没有 `sessionId`
  （`dsh-tools/lib/pipeline.js` 的执行描述对象只有 `agent`/`toolSet`/…），原来按 `exec.cwd` 取必然落空。
  现在按 `args.dir` → `exec.agent.session.header.cwd` → `workspaceOf(...)` 兜底上溯。
- 顺带修 `src/tools.js` 里 `apply(ctx) {  const tools = ...` 的花括号粘连（会让整条工具行起不来）。
- `pstack_board` 认项目、认会话，看板里补上真实项目历史卡与在办项。

## 0.5.0 — 2026-11-24

- **闭环**：认领 → 干活 → `done`/`drop`（必须带一句结论）→ 可重新起票。
  - 新增 `finishCard` / `reopenCard` / `claimCard`（`src/board.js`）：结束 = 改状态 + 写 `## 结论` + 往地图
    「已经定了」/「不做什么」写回指针，三件事绑一起。
  - 新路由 `boardAct`（`claim` / `done` / `drop` / `reopen` / `release`），返回刷新后的整块板与 `touched`。
  - `boardMove` 拒绝把卡直接改成 `done`/`dropped`：没有结论的「结束」等于没做。
  - 面板加收尾编辑器（结论必填）、已结束的卡给「重开」、动作后建议同帧重算、看板 4 秒对盘。
  - 工具 `pstack_board` 支持 `done` / `drop` / `reopen`，`description` 写成生命周期协议。

## 0.4.0 — 2026-11-23

- 面板默认落在**看板**：进来先看到「这个项目要干什么」，58 个技能清单退成二级入口。
- 看板页自带「这几件事要用的技能」区块，只列建议里点得到的那些。

## 0.3.0 — 2026-11-23

- 项目绑定与初始化：从会话 cwd 上溯项目根，`pstack_init` 写 `.pstack/board/`、`.pstack/README.md`、
  `AGENTS.md` 里的「项目看板」段（让以后每个会话的 agent 都知道开工先看板）。
- 面板显示当前项目名、相对路径、还缺哪样东西。

## 0.2.2 — 2026-11-23

- **修**：右栏 tab 拿不到入口——`sidebarRightTabs` 服务在 `apply` 跑完才就绪，原来一次性 `ctx.get()` 拿到
  `undefined` 就永久放弃注册，插件装好了却没有任何入口。现在等服务出现再注册。

## 0.2.1 — 2026-11-23

- README 重写：pstack 是什么 / 怎么用 / 执行原理（22 套剧本 + 34 个技能 + 24 条原则）、面板怎么用、
  逻辑、目录结构、开发与热更新边界、发版三坑、已知边界、参考链接。
- 补 5 张产品截图（`docs/preview-*.png`，由 `npm run preview` 渲染真面板再截图）。

## 0.2.0 — 2026-11-23

- 查更新：`src/update.js`（`parseVersion`/`newer`/`checkUpdate`，registry 10 分钟缓存、失败不缓存、
  时钟回拨有保护），路由 `update`，标题栏版本徽标，有新版本时给可复制的升级命令。
- 开发热循环：`scripts/dev.mjs`（`npm run dev`），盯着 `src/` 改完自动重启临时宿主。
- README 补热更新边界（哪些改动刷新页面就生效、哪些要重启）。

## 0.1.0 — 2026-11-23

首个可用版本。

- **58 个技能面板**：读 `repo/skills` 的 frontmatter 与 README 分组，按 6 组列出（工作流 34 / 核心准则 10 /
  架构 6 / 验证 5 / 委派 2 / 元 1），搜索、分组筛选、详情、58 篇中文正文与英文原文切换、
  一键把斜杠命令放进输入框（接不上就退到剪贴板、再不行给手抄）。
- **skill provider**：58 个技能进斜杠菜单（57 个 `modelInvocable: false`，只有面板和 `/` 菜单是入口）。
- **项目看板**：`<项目>/.pstack/board/`，一张卡一个 markdown 文件；建卡、进展（带日期）、
  前置依赖 `after`、地图卡四段（去向 / 已经定了 / 还没想清 / 不做什么）、认领 `owner`、
  路径闸门 `scope`、并行冲突提示、可开工清单（frontier）、依赖拓扑流程图。
- **三层决策建议**（照 Jev / System One 的原语搭）：`noul`（判真假 → 把握）/ `choice`（选一个 → 技能）/
  `score`（加权 → 紧急），`COEF = {state 0.45, kind 0.25, progress 0.15, fresh 0.15}`；
  按项目 → 全局 → 开场的三层顺序给 3~5 条，每条都写成能直接点的提示词。
- **工具**：`pstack_list` / `pstack_use` / `pstack_install`（装到项目级 `.dsh/skills`）/ `pstack_board`。
- 路由 `/api/psp`（`catalog` / `skill` / `board` / `suggest` / `init`），`docs/harness/dsh.md` 写宿主对接事实。
