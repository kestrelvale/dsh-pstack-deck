# dsh-pstack-deck

把 [pstack](https://github.com/backnotprop/pstack) 的 58 个技能做成 **DeepSeek Harness（DSH）** 的右栏面板：点一下就注入，不用记名字。再往前一步，它还是一个**项目看板**——多任务并行时告诉你哪张卡现在能开工、谁在做、会不会打架、下一步该用哪个技能。

![npm](https://img.shields.io/npm/v/dsh-pstack-deck?style=flat-square&color=8A9A8C)
![技能](https://img.shields.io/badge/技能-58_个-D7B9C8?style=flat-square)
![中文正文](https://img.shields.io/badge/中文正文-58_篇-9AA8C4?style=flat-square)
![测试](https://img.shields.io/badge/测试-46_通过-C9A97A?style=flat-square)
![许可](https://img.shields.io/badge/许可-MIT-8A9A8C?style=flat-square)

- 插件名：`dsh-pstack-deck`
- 宿主：DSH（Web 与桌面都行）
- 上游技能：pstack `c3464c1`（快照见 [repo/UPSTREAM.md](repo/UPSTREAM.md)）

---

## 截图

右栏面板，三个视图。下面这些是用 `npm run preview` 把真面板渲染成 HTML 再截的，不是手画的示意图。

**技能列表** —— 58 个技能按六组排，带中文一句话；标题栏会自己问 npm 有没有新版本。

![技能列表](docs/preview-list.png)

**技能详情** —— 中文正文，可一键切回英文原文，底部直接「放进输入框」。

![技能详情](docs/preview-detail.png)

**项目看板** —— 顶部是 3~5 条带现成提示词的建议，下面按「可开工 / 在做 / 完成 / 被挡着」分组，每张卡带推荐技能、紧急度与把握。

![项目看板](docs/preview-board.png)

**依赖流程图** —— 一列一层，箭头是「先做 → 再做」；每个没做完的节点下面挂着两格虚线：推荐的下一步技能，和「完成」。

![依赖流程图](docs/preview-flow.png)

**点节点下钻** —— 状态、认领人、动哪些路径、等谁、下一步技能与理由、可直接粘的命令。

![下钻](docs/preview-drill.png)

---

## pstack 是什么

**一句话：它不是新模型，是装进你已经在用的 AI 编程工具里的一包做事规矩。**

模型还是那个模型（Claude、GPT、随便哪个）。变的是它做事的**顺序和标准**：先搞懂，再动手，改完自己检查一遍才回话。

pstack 由 poteto 写就——React 核心团队出身，在 Cursor 期间写下它，现在做 Grok Bot。它把自己每天写代码用的那套东西抽成了一包可安装的技能，免费开源。

它要治的是这四个毛病：

- **没读懂就改。** 改在看着对、其实不对的地方。
- **只治表面。** 在显示的地方去掉重复数据，产生重复的 bug 还在。
- **没试过就说做完了。** 它说「应该没问题了」，你一跑还是坏的。
- **越改越多。** 加一堆用不上的代码，下一个 bug 就藏在里面。

装进去的东西分三层：

| 层 | 数量 | 是什么 |
|---|---|---|
| **剧本**（playbook） | 22 套 | 每类任务一套做法：修 bug、加功能、重构、追查故障…… |
| **技能**（skill） | 34 个 | 单点动作：`how` 讲清代码、`bro` 翻成大白话、`interrogate` 挑刺 |
| **原则**（principle） | 24 条 | 判断标准：「先删再加」「证明它能用」「改调用方而不是加兼容层」 |

加起来 58 个技能条目（34 个动作 + 24 条原则），装在这一份仓库里。

**适合谁：** 用 AI 做过东西、被「已完成但其实没好」坑过的人；想要做对，不在乎慢一点。
**先别用：** 改错别字、换个颜色这种小事直接跟 AI 说就行；只要最快最省额度也别用，pstack 会多检查，更慢也更费 token。

## pstack 怎么用

### 在 Claude Code / Cursor / Codex 里

**Claude Code**（插件市场）：

```
/plugin marketplace add cursor/plugins
/plugin install pstack@cursor-plugins
```

命令挂在 `pstack:` 下面，所以是 `/pstack:poteto-mode`，只打 `/poteto-mode` 不认。

**Cursor**：对话框里发 `/add-plugin pstack`，命令保持原样，不用前缀。

**Codex 和其他**（`npx skills`，需要 Node.js 22.20+）：

```bash
npx skills add backnotprop/pstack        # 装进当前项目
npx skills add backnotprop/pstack -g     # 装到全局，所有项目都能用
```

装完开一个**新对话**，输入 `/` 看到 `poteto-mode` 就是成了。项目级安装落在 `<项目>/.dsh/skills/` 或 `.agents/skills/`，全局落在 `~/.dsh/skills/`。

### 在 DSH 里

用本插件（见下一节）。它做的是同一件事，只是把 58 个技能摆成能点的面板，并把看板、依赖拓扑一起给你。

### 平时只用记住一个命令

```
/pstack:poteto-mode
```

你说目标（加上怎么算做完），它安排剩下的。比如：

> 先复现这个 bug，再修，修完给我看证据。

不用记那 58 个名字。不知道学哪个就先问 `/pstack:poteto-help`，它只回答问题，不会开始干活。

## pstack 的执行原理

pstack 每接一件事，走固定的四步。它的价值全在这个顺序里，不在某一句话写得聪明。

```
你说一句话（目标 + 怎么算做完）
        │
        ▼
① 匹配：poteto-mode 从 22 套剧本里挑一套
        │   把剧本的步骤原样抄进待办清单，不改写
        ▼
② 执行：按清单逐步调用技能
        │   读代码用 how、定设计用 architect、挑刺用 interrogate
        │   活多就派子代理，子代理守同一套规矩、各用各的工作目录
        ▼
③ 验证：检查完才交回来
        │   真实命令输出、截图、前后对比、日志断言
        │   验证不了的直说「没法确定」，不许说「应该没问题了」
        ▼
④ 交回：干了什么、查到什么、还剩什么，逐条对上清单
```

四个细节决定了它为什么比「直接让 AI 改」靠谱：

1. **先复述，再动手。** 你要的东西它会先用自己话讲一遍，你能在它动手之前就纠正。
2. **剧本是抄的，不是编的。** 挑中的剧本步骤原样进清单，所以「它这次心情好就跳步」这件事不会发生。
3. **改动越小越好。** 能删就删、不加用不上的抽象、调用方迁完就删旧接口——24 条原则里一大半在压这个。
4. **证据先于结论。** 「做完了」必须附上跑过的命令和看到的输出；跑不动的部分标成「无法验证」，而不是省略。

一句话：**它不改模型的能力，改的是模型的作业流程。** 所以它跟 Claude Code、Cursor、Codex 都能配——只要那个工具能改文件、能执行命令。

想读完整版有两条路：写代码的看 [9 步完整教程](https://pstack.xiaoxiaodong.ai/guide/0-what/)，不写代码的看 [新手 3 课](https://pstack.xiaoxiaodong.ai/start/1-why/)（20 分钟）。

---

## 装进 DSH

插件在 DSH 里有三个入口，装一次全都来：右栏面板、斜杠菜单、工具行。

**从 npm 装**

```bash
dsh plugin --profile desktop add dsh-pstack-deck@0.2.2
dsh plugin --profile web add dsh-pstack-deck@0.2.2
```

**从 GitHub 装**

```bash
dsh plugin --profile web add github:kestrelvale/dsh-pstack-deck
```

**从本地目录装**（改代码时用这个，改完重启就生效）

```bash
dsh plugin --profile web add link:/绝对路径/dsh-pstack-deck
```

装完要重启宿主：Web 重启 `dsh web`，桌面版退出并重新打开（关窗口可能只是隐藏）。

> 国内网络注意：本机默认 registry 常常是 `registry.npmmirror.com`，镜像同步有延迟。要装刚发布的版本就显式指定官方源：`--registry=https://registry.npmjs.org`。

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

## 面板怎么用

### 1. 右栏「pstack」tab

两个视图：

**技能** —— 58 个技能按六组排（workflow 34 / core 10 / architecture 6 / verification 5 / delegation 2 / meta 1），带中文一句话、参数提示、同装依赖。搜「验证」「测试」「文档」都能搜到。点开看中文正文（有对照原文的开关），点「放进输入框」把 `/技能名` 塞进输入框。

**看板** —— 一个项目一块板，存在 `<项目>/.pstack/board/`，一张卡一个 markdown 文件。

```
.pstack/board/
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

「流程」视图按依赖画拓扑。**每个没做完的节点下面还挂着两格虚线**：`→ /推荐技能` 和 `✓ 完成 #id`——这条线的预期走向一眼看完。点任意节点**下钻**：状态、认领人、动哪些路径、等谁、命令，以及「执行 / 交回 / 标记完成 / 废弃」。

---

## 逻辑：为什么长这样

### 目录就是真相，没有第二份清单

面板、路由、工具、斜杠菜单**四处都现读** `repo/skills/` 和 `.pstack/board/`。改一个 `SKILL.md`，四处一起变；没有导入、导出、缓存清单要同步。只有一处 5 秒的目录缓存，为了让输入框不卡。

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

照 [Jev / System One](https://docs.typesafe.ai/introduction) 的结构抄的骨架，但**不假装是模型**：

1. **noul（判真假）**——这张卡够清楚吗？在开工吗？最近动过吗？
2. **choice（选一个）**——从卡里选技能：缺陷→`tdd`/`correct`，说不清→`sharpen`，想法→`figure-it-out`，在做→`prove-it-works`。
3. **score（打分）**——`COEF = { state: 0.45, kind: 0.25, progress: 0.15, fresh: 0.15 }` 加权得紧急度；`certainty` 是独立第二轴，低了就标注「先确认」。

权重写在代码里，改优先级改系数，不碰任何提示词。

---

## 目录结构

```
src/
  catalog.js   读 repo/skills 的 frontmatter、分组、依赖闭包、与 ~/.dsh/skills 对比漂移
  i18n.js      58 条中文一句话 + 分组名 + 五步上手引导
  host.js      技能 provider、POST /api/psp（catalog / skill / board / suggest / update）
  board.js     看板读写、依赖图、frontier、scope 冲突、地图四段
  suggest.js   三层决策（项目层 → 全局层 → 开场层）
  update.js    问 npm 有没有新版本（数字比版本、只缓存 latest）
  tools.js     工具行
  client.js    右栏 tab（技能 / 看板 / 流程 / 下钻）
zh/            58 篇中文正文（与 repo/skills 逐篇对齐，npm run check:zh 校验）
repo/          pstack 上游只读快照（skills / plugin.json / LICENSE）
scripts/       sync-skills（推到 ~/.dsh/skills）、check-zh、preview（自渲染截图）、dev（热循环）
test/          node --test，46 条
docs/          parallel-tasks.md + 面板截图
```

## 开发

```bash
npm test           # 46 条：目录解析、路由信封、工具、看板、依赖图、建议、版本比较、客户端渲染
npm run dev        # 起一个临时宿主（默认 web profile :5599），改 src/ 自动重启
npm run preview    # 用假 React 把面板渲染成 HTML，再用 Chrome 截图，不用起宿主
npm run sync       # 把 repo/skills 推到 ~/.dsh/skills（--dry 只看差异）
npm run check:zh   # 中文正文与原文逐篇对齐检查
```

本地改代码用 `link:` 安装：

```bash
dsh plugin --profile desktop add link:/绝对路径/dsh-pstack-deck
```

### 热更新与热安装：哪些是热的

这不是我保守，是宿主的能力边界。分三半看：

| 你改了什么 | 要不要重启宿主 |
|---|---|
| `repo/skills/*.md`、`zh/*.md`、`.pstack/board/*.md` | **不要**。每次请求现读磁盘，面板点「刷新」/「重读」立刻生效 |
| `src/client.js`（面板 UI） | **要**。客户端 bundle 在启动时按内容哈希构建一次（请求里的 `?rev=`），profile 里没有可覆盖的 bundle 缓存 |
| `src/host.js` / `src/tools.js` | **要**。往 cordis 注册的技能 provider、HTTP 路由、工具都没有卸载重挂的入口 |
| 升级到新版本 | 看宿主回报的 `activation`：`client-only` → 刷新页面；否则 → 重启 |

所以「技能内容热更新」是这个项目的设计红利，「代码热更新」没有。`npm run dev` 把手动退出重开压成一次保存，仅此而已；唯一存在 HMR 通道的是 DSH 自己 checkout 里 `pnpm run dev:web` 起的那条，不覆盖 npm 装的第三方包。

面板自己会查 npm：启一次（十分钟缓存）之后，标题栏显示 `插件 0.2.2` 或琥珀色的 `↑ 0.3.0`；有新版本时技能视图顶部给一条可复制的升级命令。

### 发版

```bash
npm version patch                 # 或 minor / major
npm test && npm run check:zh
npm publish --registry=https://registry.npmjs.org --access public
```

三个坑，踩过：

- 本机默认 registry 可能是国内镜像（`registry.npmmirror.com`），**镜像不能发**，必须显式带 `--registry`。
- 账号开了 2FA 时，普通 token 发布报 `403 … two-factor authentication … required`；要么 `--otp=123456`，要么用勾了 **Bypass two-factor authentication** 的 Granular Access Token。
- npm 对新包走 staged publishing：一发布先出现 `0.0.0-stage` 占位版，几秒后才落成真实版本，别看到占位版就以为失败了。

## 已知边界

- `scope` 冲突是**路径前缀比对**，不是代码级依赖分析。同目录不同文件互依的情况挡不住。
- WIP 上限没有硬拦：认领第二张 `doing` 不会被拒绝，只是分组里看得见。
- 地图「还没想清」的雾**不会自动毕业**成新卡，要人点一下。
- 预期线路只画一步（推荐 → 完成），不画「完成之后接哪张」。
- 中文正文是逐篇人工对齐翻译，上游改版后需要重跑 `npm run check:zh` 才发现漂移。

## 参考链接

**上游与教程**

- **[backnotprop/pstack](https://github.com/backnotprop/pstack)** —— 58 个技能的全部内容、分组、剧本、原则与依赖关系的来源。本仓库的 `repo/` 是它的只读快照（`c3464c1`，同步于 2026-11-20），我们的贡献只有「怎么让人用得动」这一层。
- **[pstack 新手教程 · pstack.xiaoxiaodong.ai](https://pstack.xiaoxiaodong.ai/)** —— 中文教程站：「AI 说『做好了』之前，先让它自己试一遍」。新手 3 课（20 分钟）、完整 9 步、[技能速查](https://pstack.xiaoxiaodong.ai/skills/)、[原则 Wiki](https://pstack.xiaoxiaodong.ai/wiki/principles/)。本 README 里「pstack 是什么 / 怎么用 / 执行原理」三节的事实与措辞主要依据这个站。
- **[nevertoday/xxd-pstack](https://github.com/nevertoday/xxd-pstack)** —— 上面那个教程站的开源仓库：用大白话把 pstack 讲清楚，不会写代码也能学会，10 种语言（英/中/日/韩/西/葡/法/德/俄/阿）。它本身不是技能包，是**文档**；镜像的是 `backnotprop/pstack`，每天同步。

**本项目借鉴的东西**

- **[dsh-mattpocock-skills-deck](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck)**（Matt Pocock 技能集的 DSH 面板）—— 面板形态、右栏 tab 的注册方式、以及看板与地图机制的参照。本项目的地图四段、`frontier`、`claim` 三个概念直接来自它的 `wayfinder` 技能：
  > "A session **claims** a ticket by assigning it to the dev driving the map, **first**, before any work, so concurrent sessions skip it."<br>
  > "A ticket is **unblocked** when every ticket blocking it is closed; the **frontier** is the open, unblocked, unclaimed children, the edge of the known."
- **[Jev / System One](https://docs.typesafe.ai/introduction)** —— 三层决策（`noul` / `choice` / `score`）与「confidence 是独立第二轴」的出处，本项目的建议引擎照此结构组织。
- **[DeepSeek Harness](https://github.com/deepseek-ai)** —— 宿主：技能 provider、`connection.fetch` 路由、`sidebarRightTabs`、工具行、`dsh.bundle.patch`。

## 许可

MIT。`repo/` 下 pstack 的内容遵循其原仓库许可（见 [repo/LICENSE](repo/LICENSE)）。
