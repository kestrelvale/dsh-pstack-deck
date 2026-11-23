# dsh-pstack-deck

把 [pstack](https://github.com/backnotprop/pstack) 的 58 个技能做成 **DeepSeek Harness（DSH）** 右栏面板：点一下就注入，不用记名字。再往前一步，它还是一个**项目看板**——多任务并行时告诉你哪张卡现在能开工、谁在做、会不会打架、下一步该用哪个技能。

- 插件名：`dsh-pstack-deck`
- 宿主：DSH（Web 与桌面都行）
- 上游技能：pstack `c3464c1`（快照见 [repo/UPSTREAM.md](repo/UPSTREAM.md)）

---

## 装进 DSH

插件在 DSH 里有三个入口，装一次全都来：右栏面板、斜杠菜单、工具行。

**从 GitHub 装（推荐）**

```bash
dsh plugin --profile web add github:kestrelvale/dsh-pstack-deck
dsh plugin --profile desktop add github:kestrelvale/dsh-pstack-deck
```

**从本地目录装**（改代码时用这个，改完重启就生效）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-pstack-deck
```

**npm**（包名 `dsh-pstack-deck`，发布后可用）

```bash
dsh plugin --profile web add dsh-pstack-deck
```

装完要重启宿主：Web 重启 `dsh web`，桌面版退出并重新打开（关窗口可能只是隐藏）。

### DSH 是怎么找到这个包的

不需要额外注册任何东西，靠 `package.json` 里的两段声明 + 一个 patch 文件：

```jsonc
{
  "name": "dsh-pstack-deck",
  "exports": {
    ".": "./src/host.js",        // 宿主半：技能 provider + HTTP 路由 + 看板
    "./tools": "./src/tools.js",  // 工具行：pstack_list / pstack_use / pstack_board / ...
    "./client": "./src/client.js",// 客户端半：右栏 tab
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }, // 启动时把下面那三个半插进 profile
    "client": { "platform": "web", "immediately": true, "inject": [] }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: pstack-host
      name: dsh-pstack-deck
    - id: pstack-tools
      name: dsh-pstack-deck/tools
    - id: pstack-client
      name: dsh-pstack-deck/client
```

dsh 启动时读 `dsh.bundle.patch`，把这三个插件并进内存里的 profile（**不**往你的 `cordis.patch.yml` 里写东西）。市场索引也认这个字段，所以只要包发到 npm，DSH 的插件市场就能直接搜到并安装。

---

## 怎么用

### 1. 右栏「pstack」tab

两个视图：

**技能** — 58 个技能按六组排（workflow 34 / core 10 / architecture 6 / verification 5 / delegation 2 / meta 1），带中文一句话、参数提示、同装依赖。搜「验证」「测试」「文档」都能搜到。点开看中文正文（有对照原文的开关），点「用这个技能」把 `/技能名` 塞进输入框。

**看板** — 一个项目一块板，存在 `<项目>/.pstack/board/`，一张卡一个 markdown 文件。

```
. pstack/board
├── 1-把导出改成流式.md     ← 地图：这次要去哪（kind: map）
├── 2-大文件导出会-oom.md
├── 3-登录后偶发-401.md
└── 4-给看板加列筛选.md
```

看板顶部是**建议**（3~5 条，见下），中间是加卡输入框，下面是分组：`可开工 / 在做 / 完成 / 被挡着`。每张卡上能看到建议用的技能、紧急度与把握，按钮是「我来做 / 完成 / 废弃」。

### 2. 斜杠菜单

58 个技能都出现在 `/` 菜单里。**57 个是 `modelInvocable: false`**——模型不会自己挑它们，只由你点。这正是面板存在的理由：给这些技能一个入口。

### 3. 工具行

agent 自己也能用：

| 工具 | 干什么 |
|---|---|
| `pstack_list` | 列技能（按 `query` / `group` 过滤） |
| `pstack_use` | 取一个技能的正文，当作这次任务的操作说明（有中文就用中文） |
| `pstack_suggest` | 给 3~5 条带现成提示词的建议 |
| `pstack_board` | 看板：`list / add / move / claim / release / next` |
| `pstack_install` | 把技能装进某个项目的 `.dsh/skills`，让那个项目新开的会话也能用 |

### 4. 建议与流程图

建议列表每条**点开**才有内容：Jev 分解（在做 / 类型 / 进展 / 新鲜四格分）、一条能直接粘的命令（带卡号，如 `/correct #3 登录后偶发 401`）、三个按钮。

「流程」视图按依赖画拓扑：一列一层，箭头是「先做 → 再做」，虚线框是废弃的卡。**每个没做完的节点下面还挂着两格虚线**：`→ /推荐技能` 和 `✓ 完成 #id`——这条线的预期走向一眼看完。点任意节点**下钻**：状态、认领人、动哪些路径、等谁、命令，以及「执行 / 交回 / 标记完成 / 废弃」。

---

## 逻辑：为什么长这样

### 目录就是真相，没有第二份清单

面板、路由、工具、斜杠菜单**四处都现读** `repo/skills/` 和 `.pstack/board/`。改一个 `SKILL.md`，四处一起变；没有导入、导出、缓存清单要同步。`: 只有一处 5 秒的目录缓存，为了让输入框不卡。`

### 一个项目一块板，一张卡一个 markdown 文件

不接数据库、不接 issue tracker。`git diff` 能看懂的进度才是能跟进的进度。卡的字段：

```markdown
---
id: 3
kind: bug                # idea / bug / task / map
state: doing             # idea / todo / doing / done / dropped
title: 登录后偶发 401
after: 1, 2              # 要等 #1 #2 先做完（拓扑图里的箭头）
parent: 1                # 挂在 #1（地图）下面
owner: sess-a            # 谁认领了
scope: src/api, src/auth # 这张卡能动哪些路径
verify: node --test 全绿  # 做完的证据
---
正文……

- 2026-11-23 [在做] 抓到请求头里少了 cookie
```

### 多任务并行：四种打架方式，四个字段

| 会怎么出错 | 挡它的字段 |
|---|---|
| 前置没做完就开工 | `after` |
| 两个会话抢同一张卡 | `owner` |
| 同时改同一块代码 | `scope` |
| 干着干着忘了这次要去哪 | `kind: map` + 四段正文（去向 / 已经定了 / 还没想清 / 不做什么） |

**可开工（frontier）= 没做完 + 前置齐 + 没人认领。** 建议引擎只从 frontier 里挑，所以推荐列表本身就是并发闸门：被挡的、别人在做的，不会推给你。细节见 [docs/parallel-tasks.md](docs/parallel-tasks.md)。

### 建议是三层判断，不是一段话

照 Jev / System One 的结构抄的骨架，但**不假装是模型**：

1. **noul（判真假）**— 这张卡够清楚吗？在开工吗？最近动过吗？
2. **choice（选一个）**——从卡里选技能：缺陷→`tdd`/`correct`，说不清→`sharpen`，想法→`figure-it-out`，在做→`prove-it-works`。
3. **score（打分）**— `COEF = { state: 0.45, kind: 0.25, progress: 0.15, fresh: 0.15 }` 加权得紧急度；`certainty` 是独立第二轴，低了就标注「先确认」。

权重写在代码里，改优先级改系数，不碰任何提示词。

---

## 目录结构

```
src/
  catalog.js   读 repo/skills 的 frontmatter、分组、依赖闭包、与 ~/.dsh/skills 对比漂移
  i18n.js      58 条中文一句话 + 分组名 + 五步上手引导
  host.js      技能 provider、POST /api/psp（catalog / skill / board / suggest）
  board.js     看板读写、依赖图、frontier、scope 冲突、地图四段
  suggest.js   三层决策（项目层 → 全局层 → 开场层）
  tools.js     工具行
  client.js    右栏 tab（技能 / 看板 / 流程 / 下钻）
zh/            58 篇中文正文（与 repo/skills 逐篇对齐，npm run check:zh 校验）
repo/          pstack 上游只读快照（skills / plugin.json / LICENSE）
scripts/       sync-skills（推到 ~/.dsh/skills）、check-zh、preview（自渲染截图）
test/          node --test，41 条
docs/          parallel-tasks.md + 预览截图
```

## 开发

```bash
npm test           # 41 条，覆盖目录解析、路由信封、工具、看板、依赖图、建议、客户端渲染
npm run preview    # 用假 React 把面板渲染成 HTML，再用 Chrome 截图，不用起宿主
npm run sync       # 把 repo/skills 推到 ~/.dsh/skills（--dry 只看差异）
npm run check:zh   # 中文正文与原文逐篇对齐检查
```

## 已知边界

- `scope` 冲突是**路径前缀比对**，不是代码级依赖分析。同目录不同文件互依的情况挡不住。
- WIP 上限没有硬拦：认领第二张 `doing` 不会被拒绝，只是分组里看得见。
- 地图「还没想清」的雾**不会自动毕业**成新卡，要人点一下。
- 预期线路只画一步（推荐 → 完成），不画「完成之后接哪张」。

## 参考的项目

- **[backnotprop/pstack](https://github.com/backnotprop/pstack)** —— 58 个技能的全部内容、分组、原则与依赖关系的来源。本仓库的 `repo/` 是它的只读快照（`c3464c1`），我们的贡献只有「怎么让人用得动」这一层。
- **[dsh-mattpocock-skills-deck](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)**（Matt Pocock 技能集的 DSH 面板）—— 面板形态、右栏 tab 的注册方式、以及看板与地图机制的参照。本项目的地图四段、`frontier`、`claim` 三个概念直接来自它的 `wayfinder` 技能：
  > "A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it."<br>
  > "A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children, the edge of the known."
- **[Jev / System One](https://docs.typesafe.ai/introduction)** —— 三层决策（`noul` / `choice` / `score`）与「confidence 是独立第二轴」的出处，本项目的建议引擎照此结构组织。
- **[DeepSeek Harness](https://github.com/deepseek-ai)** —— 宿主：技能 provider、`connection.fetch` 路由、`sidebarRightTabs`、工具行、`dsh.bundle.patch`。

## 许可

MIT。`repo/` 下 pstack 的内容遵循其原仓库许可（见 [repo/LICENSE](repo/LICENSE)）。
