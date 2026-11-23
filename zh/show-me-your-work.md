# 让我看你的工作

只保留一份权威日志。

## 格式

单个 TSV 文件，每个决定一行。单元格保持单行。证据是指针，不是散文。

复制 `references/decision-log-template.tsv`（表头行）来开一份干净的日志。列：

- **ts。** ISO8601 时间戳。
- **phase。** 阶段或工作流。
- **decision。** 选了什么或做了什么，一行。
- **why。** 用大白话说原因。如果是某条原则驱动的，就直接说出来，不要用术语标签。
- **evidence。** 能证明它的链接或路径：提交 SHA、PR 号、`file:line`，或者产物、trace、截图的路径。绝不要一整段话。
- **result。** 结果或谓词状态：`tests green`、`reverted`、`pixel-diff 0`、`INCONCLUSIVE`、`open`。

一个例子，说得直白，评审扫一眼就能读懂。

```
ts	phase	decision	why	evidence	result
2026-05-24T09:02:00Z	frame	counted the work first, about 100 components and roughly 75 hours	wanted to know the size before starting a long run	commit 3a9f1c2	found 5 things to sort out before starting
2026-05-24T09:40:00Z	harness	took screenshots of the old version before changing anything	so we can compare old against new and catch any visual change	scripts/snapshot.sh, baseline/	saved 120 reference screenshots
2026-05-24T11:15:00Z	widget	moved the widget styles over without changing how it looks	keep the change small and the result identical	commit 7c21e0a, pixel-diff 0	looks identical, tests pass
2026-05-24T12:30:00Z	widget	threw out a helper's work because its screenshots were blank	checked the real files instead of trusting its summary	worktree reset	reverted, tightened the instructions for next time
```

## 记一行

每条记录都像你跟同事讲你做了什么那样写。大白话、具体动作，不要 AI 腔或抽象术语（**unslop** 技能同样适用于日志文字）。

用辅助脚本 `scripts/log.sh <logfile> <phase> <decision> <why> <evidence> <result>`。它会盖上 `ts` 时间戳，首次使用时写表头，剥掉多余的制表符和换行，并给任何以 `=`、`+`、`-` 或 `@` 开头的单元格加一个单引号前缀。直接用 `printf` 追加一行也行，但如果单元格内容来自生成结果或用户提供的文本，同样要注意这些字节。

记决定点和检查点，不是每个动作：选定的一个分叉、完成并带验证结果的一个单元、带触发原因的一次转向或回滚、浮出的一个阻塞点、修好的一个关卡。循环运行时，每次迭代一行。琐碎和显然的事跳过。

一次运行是一个代理对话，包括它后续的轮次和它的任何摘要。接手的、替换的代理，或新开的对话，都算新的一次运行。当一次运行往已经有行的日志里追加时，它的第一行 phase 是 `start`；如果它前面是另一次运行的 `start` 行，它的第一行也是 `start`。所以一次运行在后续轮次回到日志时，先读日志最后几行，看这期间有没有别的运行写过。`start` 行要写明它之前那些不是这次运行写的行的 `ts` 范围，它的 evidence 要写明这次运行，例如代理 id。`start` 这个 phase 不用在别处。

## 放在哪里

默认情况下日志是工作产物，不提交。放在工作目录的 `decisions.tsv`，多个任务同时跑时放 `.audit/<task-slug>.tsv`，并把它排除在 git 之外。

只有当这项工作足够大、评审需要这条轨迹才敢信结果时，才提交它。

## 规则

- 只追加。错误的判断用一行新的来取代它。绝不修改或删除历史。
- 优先用在仓库里提交的脚本产出的证据，而不是手工的一次性产物（**encode-lessons-in-structure** 原则技能）。

## 拿日志对转录稿做审计

运行结束时，交接之前，检查日志说的是真话。从当前工作区的会话目录读取这次运行的转录稿：在 Cursor 里是系统提示词指名的 `agent-transcripts/` 目录。在 Claude Code 里是 `~/.claude/projects/<slug>/`（工作区路径里每个非字母数字字符都换成 "-"）。在 Pi 里是 `~/.pi/agent/sessions/--<slug>--/`。在 Codex 里是 `~/.codex/sessions/` 下第一行 `payload.cwd` 等于工作区路径的那个文件。不要对所有项目的目录做 glob。那会读到无关的私人对话。拿这次运行的每一行对照实际发生的事。每一段从这次运行的一个 `start` 行开始（如果日志是这次运行创建的，就从第一行开始），到另一次运行的下一个 `start` 行结束：

- 检查每一行都对应一个真实的决定或动作。
- 检查每一行的 evidence 能打开，并且显示出这一行声称的东西。
- 影响了这项工作、却没有记下来的分叉、转向或被放弃的做法，是一个缺口。补上。

改正日志，不是改正说法。审计绝不修改或删除任何一行，哪怕是编造出来的。当某行既没有记录真实的决定也没有记录真实的动作，或者它的说法、证据是错的，就加一行来取代它，写上实际发生的事和能打开的指针。这次审计不检查这次运行那些段落之外的行。如果这次运行自己的工作证明其中某一行是错的，就按处理任何错误判断的方式取代它。

## 对轨迹做跨模型评审

交接之前，起一个子代理，用与干这活的模型不同厂商的模型。自审不能替代它。子代理读审计轨迹和这次运行的转录稿，然后标出用户该注意的地方。不是重做一遍工作，而是扫描哪里不够好或有风险。按 **poteto-mode** 技能的 Subagents 一节，为这项任务挑每个子代理的推理级别。

- 记录时证据薄弱或没有证据的决定。
- 跳过的验证步骤，或在转录稿里没有证据支撑的宣称。
- 事后看有风险的选择（过早、范围蔓延、掩盖症状）。
- 用户随手一扫就会漏掉的缺口。

只要这次运行产出了轨迹，每次回复都以一个 "Attention" 小节结尾。第一行单独写评审用的模型（`reviewed by <model>`），然后列出每个标记，指向具体的行或时刻。"No flags" 是有效取值。只写模型名不是。

## 评审轨迹

从上往下读，沿着证据指针走，抽查。GitHub 会把提交的 TSV 渲染成表格。`column -s$'\t' -t decisions.tsv` 可以在终端里渲染它。

## 组合这个技能

其他技能把审计轨迹交给这里，而不是自己发明一套。用名字引用它，让格式归它管。不要重复列定义。
