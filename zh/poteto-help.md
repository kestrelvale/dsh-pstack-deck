# Poteto 帮助

回答用户关于 pstack 的问题，给他一段可以直接发出去的提示词，并链到答案出处那个文件。对求助类问题，不要开始干活。用户问的是怎么做，而一次 pstack 运行要花真金白银的 token，让他自己去发那段提示词。

一条要求干活的消息，比如 "use pstack to fix this bug"，不是求助问题。读 [`poteto-mode`](../poteto-mode/SKILL.md)，在它下面把活干完，并提一次：设为 Custom Mode 可以让它一直生效。

这个文件把问题映射到持有答案的技能与指南页。细节归那些文件所有。引用之前先读你要路由到的那份文件，当它与本映射冲突时以它为准。这里的链接指向已安装的插件内部，用户可能打不开，所以给他文件的公开副本：`https://github.com/cursor/plugins/blob/main/pstack/` 加上它的路径。

## 弄清他需要什么

从消息和对话里推断需求。已经点明的情境，比如 "which skill reviews a PR?"，直接进它对应的那一节。如果需求仍然不清楚，问一个单选题，选项如下，然后只回答他选的那一节：

- 完成安装配置
- 用 `/poteto-mode` 开始一个任务
- 为某个情境挑一个技能
- 修一次跑歪了的运行
- 把 pstack 变成我自己的

检查那些会改变答案的状态，只在它确实改变答案时才提：

- 没有 pstack 设置文件（Cursor 里是 `~/.cursor/rules/pstack-models.mdc`，Claude Code 里是 `~/.claude/rules/pstack-models.md`，其他宿主里是 `~/.agents/pstack-models.md`）意味着 `/setup-pstack` 没为这个用户跑过，于是每个角色都用它的默认模型。
- 项目里没有 `verify-*` 技能或别的应用宿主，意味着代理没有脚本化的方式去驱动这个应用。当问题关乎证明某个改动确实有效时，提 `/create-verification-skill`。
- 项目里没有形式化验证技能，意味着超出测试能触及的范围，没有任何性质被检查。当问题关乎竞态、不变量，或测试很少命中的其他情形时，提 `/create-formal-verification-skill`。若已存在一个，而它覆盖的代码在该技能记录的"最后同步"提交之后发生了改动，且问题涉及那段代码，就提 `/maintain-formal-verification-skill`。

当模型规则缺失且这件事要紧时，问用户是否现在就为每个角色挑模型、并定一个推理预算。要紧的情形：用户是新手、问题关乎安装配置或成本、或答案取决于跑的是哪些模型。每个聊天最多问一次。如果需求也不清楚，两个问题一起问。给两个选择：

- 现在：把 `/setup-pstack` 给他去输入，同时也回答他的问题。
- 以后：回答他的问题，并加一行说明：在他跑 `/setup-pstack` 之前，每个角色都保持默认模型。

## 完成安装配置

1. 在聊天里用 `/add-plugin pstack` 安装，或从侧栏的 Customize 安装。在 Cursor 之外，运行 `npx skills add backnotprop/pstack` 并挑选要装的技能。
2. 运行 [`/setup-pstack`](../setup-pstack/SKILL.md)。它会问一个推理预算，给每个角色映射一个模型，并写一条规则。该规则对新聊天生效。然后它为项目各提供一次生成验证技能和形式化验证技能的机会，除非项目里已经有了。
3. 用一个真实任务启动 `/poteto-mode`，带上目标和一项能通过或失败的检查。

在用户调用某个技能之前，安装本身不改变任何东西。只有 `/setup-pstack` 会从用户的话语里被加载。细节在 [README](../../README.md) 和 [指南第 1 页](../../docs/guide/01-setup.md)。按 [`references/prompting.md`](references/prompting.md)，主动提出陪他把第一条提示词写出来。

如果担心的是成本，说清 token 花在哪、怎么少花。pstack 把额外的 token 花在子代理和评审面板上。重跑 `/setup-pstack`，挑更小的预算或更便宜的模型。角色设成 `auto` 或 `inherit-parent` 时跑在聊天的模型上，当聊天跑在 Auto 或更便宜的模型上时能省 token。面板列表越短，起的子代理越少——每一条对应一个。把 `/poteto-mode` 留给需要严谨度的活。

pstack 是为 Cursor 构建的，也能装进 Claude Code：`/plugin marketplace add cursor/plugins`，然后 `/plugin install pstack@cursor-plugins`。在那里，每个命令带 `pstack:` 前缀，比如 `/pstack:poteto-mode`。[Claude Code 适配层](../../docs/harness/claude-code.md)负责映射 Cursor 的名字，需要 Cursor 专有功能（比如 Bugbot 或 Automations）的步骤会被跳过，并附一行说明。

本镜像的技能通过 `npx skills add backnotprop/pstack` 也能在其他宿主里工作（Claude Code、Codex、Pi、OpenCode 等）。[`poteto-mode`](../poteto-mode/SKILL.md) 的 Harness 一节把 Cursor 的子代理、提问、转写和设置路径映射到各宿主自己的路径。Custom Modes 和 `/loop` 是 Cursor 的功能。

## 用 `/poteto-mode` 开始一个任务

`/poteto-mode` 把任务匹配到一个 playbook，把 playbook 的步骤复制进 TODO 清单，并在步骤需要时运行其他技能。好的提示词说明目标，以及怎么判断做完了。它不罗列技能，因为手写的顺序往往会漏掉或打乱 playbook 会保留的步骤。在帮他遣词之前，先读 [`references/prompting.md`](references/prompting.md)。[指南第 2 页](../../docs/guide/02-poteto-mode.md)有示例。

`/poteto-mode` 是否持续生效，取决于用户怎么启动它：

- 在 `/poteto-mode` 上按 Enter，会把技能挂到一条消息上。随着对话推进，它会淡出。
- Mac 上 Option+Enter、Windows 上 Alt+Enter，或从技能条目选 Use as Mode，会把它变成 Custom Mode。它每一轮都留在上下文里，直到用户退出该模式，并且它不会介入随意的聊天轮次。
- Cursor 的文档在 Agents Window 和 CLI 里列出了 Custom Modes。在其他地方，每个新任务都用 `/poteto-mode` 启动。

这件事出现时，链上 [Cursor 的技能文档](https://cursor.com/docs/skills)。对话中途，说 "new task" 会让该模式匹配一份新的 playbook。`/poteto-mode` 已经在用它 playbook 步骤孵化子代理时使用 `poteto-agent`。想让你自己的子代理得到同样的风格，用 `subagent_type: "poteto-agent"` 孵化它。

## 挑一个技能

默认答案是 `/poteto-mode`，它在步骤需要时会运行其中大多数。当用户想要的东西比 playbook 给的多或少时，直接点名某个技能。推荐之前先读那个技能，并给一条示例提示词。

| 用户想要 | 技能 |
|---|---|
| 以严谨的方式做任何非平凡的任务 | [`/poteto-mode`](../poteto-mode/SKILL.md) |
| 在代理动手前，确认它理解了目标和问题 | [`/in-your-own-words`](../in-your-own-words/SKILL.md) |
| 在发送前把提示词改得更深、而不是更长：顶尖专业人士会补充什么、他们的原始素材与方法，以及一次外部检查。它返回提示词，不做任务 | [`/sharpen`](../sharpen/SKILL.md) |
| 弄清代码现在怎么运作，或新代码该放在哪 | [`/how`](../how/SKILL.md) |
| 弄清代码为什么长成这样，或某个数字从哪来 | [`/why`](../why/SKILL.md) |
| 把一个改动或子系统讲明白 | [`/teach`](../teach/SKILL.md) |
| 补上自己在某个话题上最近的工作 | [`/recall`](../recall/SKILL.md) |
| 补上这个聊天自他最后一条消息以来的变化，用朴素的话和小的可视化，把他需要拍板的每一项都列出来，且仅凭回复就能决断 | [`/ketchup`](../ketchup/SKILL.md) |
| 像 `/ketchup` 那样补课，但用一个带字幕的短幻灯片视频，把待决事项作为文字放在下面 | [`/ketchup-video`](../ketchup-video/SKILL.md) |
| 弄清一个小 diff 可能在外面打坏什么 | [`/blast-radius`](../blast-radius/SKILL.md) |
| 在写跨函数边界的代码之前，先把类型和模块形态定下来 | [`/architect`](../architect/SKILL.md) |
| 对同一份任务书拿到多次尝试，合并成最好的一个 | [`/arena`](../arena/SKILL.md) |
| 把切片上的并行检查、或赛跑式的 worker 作为云代理来跑 | [`/swarm`](../swarm/SKILL.md) |
| 让不同模型评审一个 diff 并试着打坏它 | [`/interrogate`](../interrogate/SKILL.md) |
| 当存在便宜的本地测试时，用测试先行修 bug | [`/tdd`](../tdd/SKILL.md) |
| 对 `.ts` 或 `.tsx` 工作套用 TypeScript 规则 | [`/typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| 评审前剥掉注释，用没写过这些注释的评审者 | [`/no-comments`](../no-comments/SKILL.md) |
| 清掉文字里的 AI 痕迹 | [`/unslop`](../unslop/SKILL.md) |
| 按标准写文档、RFC、README、PR 描述或提交信息 | [`/technical-writing`](../technical-writing/SKILL.md) |
| 用朴素的话再听一遍上一条回复 | [`/bro`](../bro/SKILL.md) |
| 给代理一种脚本化驱动应用并证明行为的方式 | [`/create-verification-skill`](../create-verification-skill/SKILL.md) |
| 让验证技能及其功能地图与应用重新对齐 | [`/maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| 对竞态、不变量或测试很少触及的其他性质做形式化验证 | [`/create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| 在它覆盖的代码改动后让形式化验证重新对齐，并弄清一次失败是漂移还是 bug | [`/maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| 把用户看到的东西做成经 TLA+ 模型检查的图表给 PM 或设计师看，并给出到达每个违规状态的最短路径 | [`/statechart`](../statechart/SKILL.md) |
| 在汇报或依据一个性能数字行动之前先核实它 | [`/benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| 执行一个大改动或横切改动，或一个离开之后才能评审的改动 | [`/figure-it-out`](../figure-it-out/SKILL.md) |
| 在运行中保留决策日志，并在事后评审 | [`/show-me-your-work`](../show-me-your-work/SKILL.md) |
| 为每个角色挑模型、定推理预算 | [`/setup-pstack`](../setup-pstack/SKILL.md) |
| 把自己的工作习惯变成一个个人的模式技能 | [`/automate-me`](../automate-me/SKILL.md) |
| 把一次完成的任务教给你的东西变成技能改动 | [`/reflect`](../reflect/SKILL.md) |
| 阻止代理在这个仓库里重复同样的错误 | [`/correct`](../correct/SKILL.md) |
| 做一个页面，用按钮通过 webhook 唤醒 Grok Bot | [`/make-bot-ui`](../make-bot-ui/SKILL.md) |
| 在 pstack 里找到路 | `/poteto-help` |

如果紧邻本文件的某个技能目录没有出现在表里，读它的 frontmatter，按它的 description 路由。`principle-*` 目录在下面的原则部分统一覆盖。

易混的几组：

- `/how` 解释代码做了什么。`/why` 解释原因。`/teach` 运行其中一个或两个，并把结果讲明白。
- `/arena` 给每个 worker 同一份任务书，再合并最好的部分。`/swarm` 把工作切成切片或赛跑，返回一份报告。
- `/interrogate` 评审 diff。`/blast-radius` 在 diff 之外寻找破坏，并证明那个让改动安全的关键事实。
- `/recall` 跨最近若干聊天重建上下文。`/ketchup` 只覆盖这个聊天自用户最后一条消息以来的部分。恢复某一次具体聊天或分支是 Session pickup playbook。
- `/figure-it-out` 设计一次严谨的运行。Autonomous run playbook 把一个任务驱动到完成条件。

不在 pstack 里：

- `/deslop`、`control-cli` 和 `control-ui` 随 `cursor-team-kit` 插件发布。
- `/loop` 和 `/create-skill` 是 Cursor 内置的。
- pstack 没有 `/orchestrate` 技能。如果斜杠菜单里出现 `/orchestrate`，那是别的插件提供的。

## Playbook 与原则

Playbook 是 `/poteto-mode` 内部的步骤清单，不是技能，所以没有斜杠命令。在 `/poteto-mode` 里，描述任务就会选中一个；下面这些短语直接点名一个：

- "babysit this pr" 或 "check on pr 123" 运行 Babysit。它把 PR 推到可合并状态就停。除非用户要求 merge、land 或 ship，否则它不合并。
- "land the stack" 运行 Shipping。
- "take over this branch" 运行 Session pickup。
- "pause safely" 运行 Pause safely。
- "full autopilot on this queue" 运行 Autopilot-full。"autopilot, don't merge" 运行 Autopilot-stack。
- "run the eval playbook" 运行 Eval。

没有 `/poteto-mode` 时，"babysit this pr" 这类短语可能反而启动 Cursor 自带的同类技能。[`poteto-mode`](../poteto-mode/SKILL.md) 的 Playbooks 一节列出了每一个 playbook。[指南第 6 页](../../docs/guide/06-verify-and-ship.md)涵盖开 PR、看护 PR 和落地 PR。

pstack 没有规划技能。Cursor 的 Plan Mode 与它并行工作。对跨阶段或堆叠 PR 的工作，向 `/poteto-mode` 要一份计划，会运行 [Multi-phase plan playbook](../poteto-mode/playbooks/multi-phase-plan.md)，它写出计划但不实现。对设计问题，Prototype playbook 或 `/architect` 先在代码里把它定下来。

原则是只有一条规则的技能，`/poteto-mode` 会读它们并在回复里引用。用户很少直接调用某一条。他们用名字来引导，比如 "apply prove it works. show me the real output."。输入 `/principle-<name>` 仍然可以按需加载一条。[指南第 8 页](../../docs/guide/08-principles.md)列出了它们。

## 修一次跑歪了的运行

| 症状 | 修法 |
|---|---|
| 该模式在几轮之后不再生效 | 它是用 Enter 启动的。把它作为 Custom Mode 启动，或每个任务都用 `/poteto-mode` 启动。 |
| 一个提问被当成上一个任务的下一步 | 说 "new task"，或者说这一轮不需要该模式。 |
| 新的模型选择没有效果 | `/setup-pstack` 写下的规则对新聊天生效。开一个新聊天。 |
| 运行成本超出预期 | 见"完成安装配置"下的成本段落。 |
| 某个技能没有自己加载 | 只有 `/setup-pstack` 会从用户的话语里加载。其他的在用户输入它们、或 `/poteto-mode` 运行它们时才加载，而它不会运行每一个技能。 |
| 并行代理互相覆盖 | 给每个代理自己的 worktree，或把它们作为云代理运行——每个都有自己的机器。 |
| 一次过夜运行有推进但一无所成 | `/loop` 需要一项能通过或失败的检查，而不是一个时长。见[指南第 7 页](../../docs/guide/07-overnight.md)。 |
| 回复拿一个绿的构建就宣称成功 | 要真实命令、流程、存储下来的值或 profile。这就是 prove-it-works 原则。 |

对跑偏的运行，[`references/prompting.md`](references/prompting.md) 里有一句话的纠偏。[指南第 10 页](../../docs/guide/10-recipes-and-pitfalls.md)有更多坑和值得照抄的做法。

## 把 pstack 变成我自己的

- [`/automate-me`](../automate-me/SKILL.md) 从用户自己的历史里起草一个个人模式技能，与 `/poteto-mode` 并用。
- 一次会话之后用 [`/reflect`](../reflect/SKILL.md)，把它的教训变成用户批准的技能改动。
- `/poteto-mode write a skill for <workflow>` 运行撰写 playbook。eval playbook 会盲测一次技能改动。
- 把行为不端的技能放在它自己的 PR 里修，而不是夹在它出错的那个功能工作里。

[指南第 9 页](../../docs/guide/09-make-it-yours.md)涵盖以上各项。

## 回复

先给答案。最多在代码块里给一条示例提示词，合适时从 [`references/recipes.md`](references/recipes.md) 改写，然后给那个文件的链接。除非用户要整张地图，否则保持简短。
