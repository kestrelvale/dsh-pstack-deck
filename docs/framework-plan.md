# 0.7 方案：框架逻辑对齐竞品，技能库保留 pstack

**这份文件回答一个问题**：dsh-mattpocock-skills-deck 为什么让人感觉"闭环"，而我们为什么不像。
结论先说：它的闭环不在界面，在**写路径**和**检查链**上。界面只是这两件事的显示器。

对标对象：`~/.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck@1.9.0-beta.33`（下称"竞品"）。

---

## 一、先认清量级

| 维度 | 竞品 | 我们（0.6.0） |
|---|---|---|
| 非 UI 代码 | 57,474 行（剔除 3.6MB client bundle） | 3,884 行 |
| 后端 | 三个（GitHub / 本地 Markdown / GitLab）+ 注册表 | 一个（Markdown 卡） |
| agent 工具 | 10 个 `deck_*` | 7 个 `pstack_*` |
| 面板 RPC | 65 条 `wf.*` | 12 条 `methods` |
| 环境检查 | 16 项 + 3 条链 + 6 种动作 + 背退 | 6 项平铺 + 一句话 hint |
| 写操作 | Check(只读) → 票据(指纹+TTL) → Write → 回读 → 回执 | 拼字符串写盘，回读的是自己的字符串 |

**所以这套方案不是"全抄"。** 竞品里有一半是为多后端、配额、平台 API 服务的，对单人本地 markdown 板是负资产（见第七节「明确不抄」）。我们抄的是它**承重的 20%**：写路径、检查链、单飞、回读、上报。

---

## 二、九根柱子：竞品怎么做的 / 我们现在什么样

| # | 柱子 | 竞品做法（证据） | 我们现状 | 归到 |
|---|---|---|---|---|
| 1 | 工作区身份 | `resolveWorkspaceRoot` 向上 64 层认 `.git` 或 `docs/agents/issue-tracker.md`；落 `docs/agents/workspace.yaml`，写完回读比对 | `anchor.js projectRoot` 认 `.pstack` / `.git`；不落任何记录 | 已有，P2 只需把"最近工作区"记一份 |
| 2 | 环境检查 | `check-catalog-dirs.js` 目录表 → `chain-step-rows.js` 四态链 → `check-catalog-views.js` 六种动作 → `failure-backoff` | `env.js` 六个 `rows.push`，hint 是字符串，无链无动作 | **P1** |
| 3 | 技能供给 | `registerProvider` + rank 350 + 27 技能探针 + `bundled-skills-zh` 旁路 + inflight 缓存 | `catalog.js` + rank 360 + `drift` 对比（**这项我们更强**） | 已完成 |
| 4 | 数据模型 | 六 kind Freeze 表、隐藏注释（parent/labels/blockedBy/created）、`## 进度`、`## 维护者原话`、60KB 硬顶 | 四 kind（idea/todo…）、frontmatter 十字段、进展行散在正文、无长度顶 | **P0** |
| 5 | 写路径 | `body-write` 摘要校验、`withKeyLock`、`digest` 乐观锁、`edge-landing` 落点证据、失败一律"降级不臆断" | `saveCard` = 读-改-写，回读的是自己 `stringify` 的结果 | **P0** |
| 6 | 上报轴 | `deck_issue_report` 与 `deck_issue_patch` 完全分离，写 `~/.dsh/mattskillsdeck/work-path/<hash>.json` | 无。关闭即结束 | **P3** |
| 7 | 刷新/监控 | snapshot 单飞（`snapshotInflight`）、5s TTL、4s 栅格、四级退避、`snapMode` 三态、`truth.*` 四档新鲜度 | 4s `setInterval` 裸轮询，`loading/error` 两态，失败只有 toast | **P2** |
| 8 | 版本管理 | 67 个文件 = 13 能力 × (Check/Write/Mount/Scene)，`stallWatch` 看门狗、`classifyFailure` 三张归因表 | 零（`update.js` 只查 npm 版本） | **P4** |
| 9 | 面板结构 | 单一 DetailsDock + 两行顶栏、KPI 行、过滤 chip、navStack、地图详情四组子票、在办表 | 四颗硬编码 chip、单层 detail、无计数无过滤 | **P5** |

---

## 三、P0 · 写路径可信（半天，无界面改动）

**为什么排第一**：上面八根柱子全都建在"写进去的真的是写进去的"之上。现在 `board.js:136` 用 `toCard(name, stringify(card))` 当返回值——它回读的是同一个进程刚生成的字符串，磁盘被谁改了、写失败，一概不知道。

改 `src/board.js` 四处，加两个新文件：

```js
// src/lock.js（20 行）
export async function withKeyLock(key, fn)   // 进程内 Map<string, Promise> 串行化同 id 的读改写

// src/board.js
saveCard(...)       // 写盘后 readFile 回来重 parse，返回磁盘上的卡；不一致就抛「写后回读对不上」
checkAcyclic(after) // 三行 DFS：新边成环就拒，文案「这张卡会让依赖成环：#3 → #7 → #3」
KIND 校验           // 非法 kind 直接拒，不再静默降级成 idea（现在是静默的）
PROGRESS_HEADING = '## 进度'
addProgress(...)    // 改成 `- 进度：45%（时间）：说明`，旧格式行进 freeText 原样保留
BODY_LIMIT = 60 * 1024  // 写前超顶就拒，不截断
```

**验收（可跑）**：`test/board.test.mjs` 加四条——写后回读命中、并发两写不互盖、成环被拒、超顶被拒。

---

## 四、P1 · 环境检查升级成"链"（一天，用户投诉里"环境检测"的正解）

现在六项平铺，用户看到 3 红不知道先做哪件；hint 是一句话，点不了。改成竞品那套数据驱动：

```js
// src/env-catalog.js —— 目录表，加第 7 项不用改函数体
export const ENV_CATALOG = Object.freeze([
  { id:'skills',  label:'技能套件', check:{kind:'local', run:checkSkills},
    onFail:{ level:'fail', hint:'包内 skills/ 缺文件', actions:[{type:'refresh'}] } },
  { id:'zh',      ... },                       // 已有的六项搬进来
  { id:'board',   onFail:{ actions:[{type:'rpc', op:'init', label:'现在初始化'}] } },  // 真正能点的
  { id:'agents',  onFail:{ actions:[{type:'inject-prompt', prompt:'initAgentBlock'}] } },
  { id:'version', ... },
]);

// src/env-chain.js —— 四态：done / current / fail / pending
export function evaluateChain(catalog, results)  // 只把链头算 current，后面全 pending 并带 blockedBy
                                                 // 判据照抄竞品：失败且有 action = current，失败且无 action = fail

// src/env-fix.js —— 动作契约
export const ACTIONS = ['refresh','rpc','inject-prompt','open-url','wizard'];  // wizard 留空实现，用到再写

// src/env.js —— 从"函数"降格为"执行器"：跑 probe → evaluateChain → 附动作
export async function checkEnv({cwd, fresh})    // 加单飞：同 cwd 并发只跑一次（30 行 inflight Map）
```

面板 `Env` 视图加三处：
1. 顶部「配置引导 · 按顺序完成」，步骤 = 第一个未 done 的项，后面的行显示`等待前置：看板`；
2. 每行右侧一个主按钮（动作带 label 就渲染），点完文案「已提交，链条重查中…」并只重算这一条；
3. 全绿时整页收成一行「环境正常，6 项都过了」，别让绿占屏。

**验收**：新建空目录 → 打开面板 → 环境页第一条红项**是可点的按钮**（不是一句话）→ 点它 → 它变绿、第二条浮上来做链头。`test/env.test.mjs` 加链的四态断言。

---

## 五、P2 · 一次刷新：单飞 + TTL + 三态 + 新鲜度（一天）

竞品所有数据来自同一个 `composeSnapshot`，我们面板四个视图各自 `rpc`。

```js
// src/host.js
async function buildSnapshot(ctx, {fresh, ifNoneMatch})   // 唯一入口：catalog + board + env 一次算完
methods.refresh / methods.snapshot                        // 前者强制，后者带 etag 语义
```

```js
// src/cli… client.js
snapMode: 'loading' | 'ok' | 'err'   // 三态，替代现在的 loading/error 两态
FreshnessBadge                       // 「刚刚 / N 分钟前 / 更新中 / 刷新失败，正在重试」
```

关键三条规矩：
- **单飞**：非强制刷新永远并入在跑的那次；强制刷新只有在跑的那次本身是强制才并入（照抄 `snapshotInflight` 33 行）。
- **失败不伪装**：探不到就 `snapMode='err'` + 原文错误，面板显示"抓取失败"，不显示空列表。
- **TTL 只在一处**：`src/constants.js` 的 `SNAPSHOT_TTL_MS = 5000`，别散落。

**验收**：`echo ' ' >> .pstack/board/3-*.md` → 5 秒内面板自己变；把 `.pstack` 改名 → 面板说"抓取失败：没有看板"，不是空白。

---

## 六、P3 · 上报轴 + 跨会话在办表（一到两天，闭环最后一块拼图）

用户说的"状态不往回写、什么都不刷新"，一半是没刷新，一半是**关了卡就断了线**。竞品把这两件事分开：`patch` 改内容，`report` 记关系，后者写独立账本。

```js
// src/workpath.js（新，约 90 行）
export async function reportPath(root, hash8)             // ~/.dsh/pstack/work-path/<hash8>.json
export async function noteReport({root, sessionId, cardId, title, state})
export async function readWorkPath(root, {windowMs})      // 在办 24h / 存档 7d，字节上限

// board.js finishCard() 末尾：顺手 noteReport 一行，不动卡
// tools.js: pstack_board op=report     （只记账，不改卡）
// host.js:  rpc workRoute → 浮层表数据
```

面板：顶栏加一个「在办」图标 + 数字；点开是表（会话 / 卡号 / 标题 / 状态 / 动作 / 时间），标「陈旧」「本次会话」高亮；空态照竞品那句「这个工作区还没有会话记过在办卡。刷新一次面板就会出现。」读失败和"确实没有"必须分开说。

**验收**：两个会话各 claim 一张卡 → 任一面板看到两行；done 之后行变 `done` 并在 24h 窗口内留档。

---

## 七、P4 · 版本管理最小核（两到三天）

看板就是 markdown + git，却对"谁改的、能不能回滚、push 会不会覆盖"零感知。竞品用 67 个文件做这件事，我们只要 5 个能力 + 一个票据壳：

```js
// src/git.js      execFile('git', args) + stallWatch（输出 250ms–1s 心跳，静默就杀）
export async function changes(root)        // git status --porcelain -z，只读
export async function commit(root, ticket, msg)
export async function sync(root, {push})   // push 前必须 ticket + 保护规则（不许 force、不许推 detached）
export function classifyFailure(argv0, code, stderr)  // 三张表：哪一步 / 为什么 / 怎么办

// src/ticket.js   AI 不能直接改板：先拿票
export function makeTicket({op, target, fingerprint, ttlMs = 120000})
export function verifyTicket(ticket, actual)  // fingerprint = sha256 前 16 位，不符即拒
```

面板「版本」tab：改动列表（可勾）、提交表单、同步按钮、失败横幅（一句话归因 + 重试）。

**刻意不做**：branch / rebase / conflict 向导 / worktree / undo / platform(PR) / clone / submodules / 配额档位。单人本地仓用不上，抄来全是负债。

---

## 八、P5 · 面板结构收口（一天）

- `VIEWS = [{id,icon,label,priority,visible}]` 元数据驱动（替代四颗硬编码 chip），无数据时条件显隐；
- 顶栏拆两行：第一行 仓库 / 刷新 / 新鲜度 / 在办图标，第二行 tab 条；
- 看板顶部 KPI 行（可开工 / 被挡 / 已关闭；**拿不到数就显示"计数还没拿到"，绝不显示 0**）+ 过滤 chip（当前过滤带 ✕）；
- `navStack` 真返回栈，替掉 `‹ 全部`；
- 地图详情页：五段 + 子票四组（可接 / 已认领 / 被挡 / 已关闭）+ Decisions so far + 战雾 + 底部三动作（开始 / 检测空地图 / 新会话打开）——这是 pstack 自己的结构化阅读，不是抄 issue 页；
- 偏好落 `localStorage`（排序、过滤、展开），写宿主失败就退回本地，界面不回退。

---

## 九、明确不抄的五样

| 东西 | 为什么不抄 |
|---|---|
| 三后端（GitHub/GitLab/Markdown）+ `workspace.yaml` | 我们不接远端；后端抽象会让你为了一个不存在的问题写 40 个文件 |
| `setupRun` 提示词注入模板 | 竞品让 AI 按技能写 `docs/agents/*`；我们 `init.js` 直写五段骨架 + AGENTS 块，**更懒更稳**，回读校验一次就够 |
| 配额/预算层（points / requests / shards / table-cell） | 宿主服务依赖，我们没有 |
| `publishFlow`（建仓 / PR 指引） | 无发布流 |
| 27 条技能探针 + 多候选目录探测 | 我们的 `buildCatalog` 已经带 `drift{missing,changed}`，更强 |

---

## 十、整条闭环的验收动作（唯一认的验收）

新会话打开右栏 → 看板有卡 → claim → 干活 → `done` 必带结论 → 结论回写地图「已经定了」 → 在办表多一行 → 环境页那项变绿 → 版本 tab 看得见改动 → 凭票提交。

**任何一步断掉，面板上必须能看出断在哪**（哪一项红、哪一步 pending、哪次刷新失败、哪张卡没上报）。看得出 = 闭环；看不出 = 这六期里最该补的那一期没做完。

---

## 十一、批次与规模

| 批次 | 内容 | 新增/改动 | 估时 |
|---|---|---|---|
| P0 | 写路径可信 | ~300 行 + 4 test | 半天 |
| P1 | 环境链 + 动作 | ~450 行 + 1 test | 一天 |
| P2 | 单飞刷新 + 三态 | ~300 行 + 2 test | 一天 |
| P3 | 上报轴 + 在办表 | ~250 行 + 1 test | 一到两天 |
| P4 | 版本最小核 | ~600 行 + 2 test | 两到三天 |
| P5 | 面板收口 | ~500 行 | 一天 |

合计约 2,400 行，是现有 `src/` 的六成。**这不是一周的活，是六个可交付批次**，每批自带验收，做完一批就能发一次 minor。