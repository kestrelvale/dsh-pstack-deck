# Setup pstack

写出 pstack 的模型设置，每个角色一个模型：

- **Cursor：** `~/.cursor/rules/pstack-models.mdc`，一条始终生效的规则。
- **Claude Code：** `~/.claude/rules/pstack-models.md`。Claude Code 会把 `~/.claude/rules/` 里的每个文件加载进每个新会话。
- **其他所有宿主**（Codex、Pi、OpenCode 及其他）：`~/.agents/pstack-models.md`。这些宿主不会自己加载它，所以 pstack 技能在挑模型时会读这个文件。

下文的"设置文件"指的就是你宿主对应的那个文件。在 Claude Code 里，如果那个文件不存在，改读 `~/.agents/pstack-models.md`，旧版本的这个技能就写在那里。

## 步骤

### 1. 探测可用模型

列出你在这个会话里能传给子代理的模型 slug（Cursor 的 `Task`、Claude Code 的 `Agent`、OpenCode 的 `task`、Codex 的 `spawn_agent`）。这是可靠来源。如果你的宿主还有能列出用户模型的命令，为了完整性优先用它（例如 `opencode models` 或 `pi --list-models`）。如果你一个都探测不到，请用户把他们有权访问的 slug 贴过来。绝不要写一个你没确认可用的真实 slug。别名 `inherit-parent` 和 `auto` 永远合法，即使它们不是被探测到的 slug。

### 2. 载入当前状态

默认的角色到模型映射就是下面第 5 步里展示的规则形状。如果设置文件已存在，读它，把它的 `# budget` 行和各角色值当作当前选择。否则从那些默认值开始。某一行如果其角色不在第 5 步里，比如 `hardest tasks`、`architect runners`、`reflect tooling` 或 `why investigators`，那是来自已退役的角色。删掉它。

旧默认值曾把另一个 Gemini 模型、后来是 `gemini-4-neon-high`，放在面板席位上。所以在任何设置文件里，面板角色（`arena runners`、`arena cross-judge pool`、`interrogate reviewers`）里的 `gemini-4-neon-high` 条目，或者 `gemini-4-neon-*` 之外的任何 `gemini-4-*` 条目，都是旧默认值。每一个都改成 `gemini-4-neon-xhigh`。Gemini 4 Neon 在任何其他档位上的条目都是用户的选择，保留。告诉用户你替换了哪些条目。

没有 `# defaults: 3` 行的设置文件来自更早的一次设置。那次设置给每个角色都写了一行，所以其中有些值是旧默认值而不是选择。在第 3 步之前，替换掉这些值：

- 一个恰好由一个 `claude-fable-*` 条目、一个 `claude-opus-*` 条目和一个 `gemini-*` 条目组成的 `arena cross-judge pool` 列表，无论顺序如何，都改成该角色第 5 步里的列表。Fable 和 Opus 是同一家厂商，所以 Fable 条目只能在 Opus 条目也能评判的场合评判。
- 一行 `# budget: unlimited` 改成 `large`，因为没有角色跑在 `xhigh` 之上。
- 如果设置文件也没有 `# defaults: 2` 行，那么凡是匹配 `grok-*` 的就是旧 slug。`feature, refactoring`、`bug-fix`、`perf-issue`、`hillclimb` 或 `swarm workers` 里的旧 slug，取该角色第 5 步的默认值。在面板角色（`arena runners`、`arena cross-judge pool`、`interrogate reviewers`）里，一个恰好由一个 `claude-opus-*` 条目和一个旧 slug 组成的列表，无论顺序如何，取该角色第 5 步的列表。在任何其他列表里，每个旧 slug 都变成 `claude-opus-5-5-high-fast`。

其他一切值都是用户的选择，保留，包括任何其他角色里的旧 slug，以及每一个 `inherit-parent` 或 `auto` 值。告诉用户你替换了哪些值。

### 3. 预算、映射、确认

**(a) 询问预算。** 优先用你的结构化提问工具（Cursor 里的 `AskQuestion`、Claude Code 里的 `AskUserQuestion`、OpenCode 里的 `question`），而不是自由文本。提供这三个选项，用这些确切的标签，并在规则里记录了当前预算时说出当前预算。如果没有规则，说明 `large` 与技能默认值一致。

- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) 应用它。** 从技能默认值构建工作表；重跑时，凡是按族、按列表、按别名（`inherit-parent`、`auto`）改动过的角色都保留。族就是 **arena** 技能阶段 A 定义的那些，所以 Fable 是独立的族。每个角色有一个目标档位，即它默认档位按预算移动后的结果。`large` 保持不变，`medium` 降一档，`small` 降两档，阶梯是 `xhigh` > `high` > `medium` > `low`。没有角色跑在 `xhigh` 之上，落在阶梯底部的目标就停在那里。大多数默认值在 `xhigh`，每个预算标签的名字就说明了它们落到哪。把角色里每个真实 slug 的档位 token 设成该角色的目标，面板条目也算。档位 token 是最后一个 token，或者在结尾 `fast` 之前的那个。如果结果不是被探测到的 slug，就用同族里档位在目标及其以下最高的那个被探测到的 slug，否则把这个角色标记为需要选择。`inherit-parent` 和 `auto` 不变。所以 `medium` 会把 `claude-opus-5-5-xhigh-fast` 变成 `claude-opus-5-5-high-fast`，把 `claude-opus-5-5-high-fast` 变成 `claude-opus-5-5-medium-fast`，而 `small` 会把它们分别变成 `claude-opus-5-5-medium-fast` 和 `claude-opus-5-5-low-fast`。Opus 5.5 永远跑它的 `-fast` slug，所以每个 Opus 5.5 值都以 `-fast` 结尾。Fable 5.2 和 Gemini 没有 fast slug，所以绝不要写。Gemini 4 Neon 的 slug 从 `low` 到 `xhigh`，没有 `max` 或 `fast` slug，所以它的席位跑在 `gemini-4-neon-xhigh`，也就是它的顶档 slug。面板角色里的 Gemini 4 Neon 条目取它自己的目标，即 `xhigh` 按预算移动后的结果，所以 `large` 保留 `gemini-4-neon-xhigh`，`medium` 写 `gemini-4-neon-high`，`small` 写 `gemini-4-neon-medium`。

**(c) 展示角色并确认。** 展示每个角色及其模型，把任何不在探测集合里的真实 slug 标记为需要选择。同时列出第 2 步删除的每一行。问是原样接受还是改动特定角色，把 `xhigh` 及以下的被探测模型、加上 `inherit-parent` 和 `auto`（两者都表示：这个角色跑在父对话模型上，这也是 Auto 用户留在 Auto 上的方式）作为选项提供。优先用结构化提问工具而不是自由文本。对于面板角色（arena runners、interrogate reviewers），值是一个列表，每个条目跑一个子代理，别名条目也算，所以列表长度决定了数量。`arena cross-judge pool` 也是一个列表，但 Arena 只跑一个评审。它只尝试与父模型不同厂商的值，按列表顺序，所以按偏好排序。Fable 和其他 Claude 模型是同一家厂商。`inherit-parent` 或 `auto` 值永远不做评判。`swarm workers` 是每个 worker 的默认模型，除非某场竞速或对比给某条臂另外指定了模型。

### 4. 校验

写下的每个真实 slug 都必须在探测集合里，并且是 `xhigh` 或以下。`inherit-parent` 和 `auto` 永远通过。如果选定的真实 slug 不可用，停下来重新问。

### 5. 写出规则

写出设置文件，包含 `# defaults: 3` 行、一行 `# budget` 写明所选标签和该标签对应的档位、以及每个角色一行，使用与 poteto-mode 相同的标签。在 Cursor 里，包含下面这段 frontmatter 并带 `alwaysApply: true`。在其他宿主里，写出不带 frontmatter 的设置文件（从第一个 `#` 行开始）。整份覆盖写，让重跑保持幂等。形状：

```
---
description: pstack per-role model choices (overrides skill defaults)
alwaysApply: true
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# 值写 `inherit-parent` 或 `auto`：该角色跑在父对话模型上（省掉子代理的 `model`，起一个通用子代理）。面板列表里的别名条目仍然计入它的扇出。
# defaults: 3
# budget: large (xhigh)
feature, refactoring: claude-opus-5-5-xhigh-fast
bug-fix: claude-opus-5-5-xhigh-fast
perf-issue: claude-opus-5-5-xhigh-fast
hillclimb: claude-opus-5-5-xhigh-fast
judgment and prose: claude-opus-5-5-xhigh-fast
arena runners: claude-fable-5-2-high, claude-opus-5-5-high-fast, gemini-4-neon-xhigh
arena cross-judge pool: claude-opus-5-5-high-fast, gemini-4-neon-xhigh
swarm workers: claude-opus-5-5-high-fast
interrogate reviewers: claude-fable-5-2-high, claude-opus-5-5-high-fast, gemini-4-neon-xhigh
```

### 6. 确认

告诉用户写到了哪个文件。在 Cursor 和 Claude Code 里，它对新会话生效。在其他宿主里，pstack 技能在挑模型时会读 `~/.agents/pstack-models.md`。重跑这个技能会更新它。

### 7. 提供一个验证技能（可选）

检查项目是否已有办法驱动真实应用来做证明（一个 `verify-*` 技能，或者一个既有的 harness）。如果没有，问一次："想要一个项目级验证技能吗，让代理能像用户那样驱动应用并证明改动确实生效？我可以用 /create-verification-skill 生成一个。"同意就调用 `/create-verification-skill`（在哪里安装 pstack 就解析到哪里：工作区、用户级或插件）。不同意就往下走，不要推销。

### 8. 提供一个形式化验证技能（可选）

检查项目是否已经有形式化验证技能（一个对代码跑模型检查器、证明或其他验证器的项目技能）。如果没有，问一次："想要一个形式化验证技能吗，让代理能证明你代码里某个关键性质在范围内的所有情况下都成立，而不只是测试能触达的那些情况？我可以用 /create-formal-verification-skill 生成一个。"同意就调用 `/create-formal-verification-skill`（在哪里安装 pstack 就解析到哪里：工作区、用户级或插件）。不同意就往下走，不要推销。
