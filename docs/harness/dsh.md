# pstack on DeepSeek Harness

pstack 的技能正文是按 harness 无关写的，里面举例提到 Cursor、Claude Code、Codex、OpenCode、Pi。
这份文件只做一件事：把那些名字对上 DSH 里真实的工具，并点出 DSH 没有的三样东西。

## 名字对照

| pstack 里写的 | DSH 里用 | 说明 |
|---|---|---|
| `Task` / `Agent` / `spawn_agent` | `subagent` | `subagent_codex` 跑 Codex 后端，`subagent_fork` 带上本会话上下文 |
| `subagent_type: generalPurpose` | 不给 `name` 就行 | DSH 的 `name` 只是显示名，没有「类型」这一层 |
| `subagent_type: "poteto-agent"` | 手动贴 `agents/poteto-agent.md` 的正文当 prompt | DSH 没有按名字注册子代理类型的机制，见下面「缺口」 |
| `subagent_type: "comment-sicko"` | 同上，贴 `agents/comment-sicko.md` | `no-comments` 技能里已经写了「没有注册就换成通用子代理」的退路 |
| todolist / `TodoWrite` | `todo_write` | 一次传全量清单，不是增删改 |
| `AskQuestion` / `AskUserQuestion` / `question` | `ask_user_question` | 支持多选与自定义输入；用户跳过就等于没答，不要重问 |
| `model` 参数 | `subagent` 的 `provider` + `model` | 用 `list_subagent_models` 查有哪些 |
| 思考档位 / `effort` | `subagent` 的 `reasoning_effort` | 不传就用该模型的默认档 |
| `run_in_background: true` | 默认就是后台 | 子代理起来立刻返回名字，完成时通知我 |
| `environment: "cloud"` / `"local"` | 没有这个概念 | 子代理都在本机跑；要多份隔离就用 `create_worktree` 各自开 worktree |
| `.cursor/skills/`、`.claude/skills/` … | `~/.dsh/skills/` | 项目级是 `<项目>/.dsh/skills/`。`automate-me` 找 `*-mode/SKILL.md` 时要按这个路径找 |

## 缺口（DSH 真的没有，别硬凑）

1. **按名字登记的子代理类型。** Cursor 里 `poteto-agent`、`comment-sicko` 是装进来的 agent 类型，一句 `subagent_type` 就调起来。DSH 没有这层：`repo/agents/*.md` 只是 Markdown。想用就把那份正文整段贴进 `subagent` 的 `prompt`，别只写「按 poteto-agent 的规矩」——子代理看不到你的上下文，也读不到这个文件。
2. **钩子。** `hooks` 相关写法在 DSH 没有对应物。需要「每次改完自动跑一遍」这类效果，写成真实脚本 + 在 `AGENTS.md` 里要求调用，别指望钩子。
3. **模式切换的模型绑定。** Cursor 能在 agent 定义里写死 `model`。DSH 的模型绑定在子代理调用参数上，不技能里。

## 装法

技能本体在 `repo/skills/`，面板是 `dsh-pstack-deck` 这个插件。两者的关系是单向的：

```
repo/skills/  ──npm run sync──▶  ~/.dsh/skills/   （DSH 的 / 菜单读这里）
      │
      └── 插件直接读它（面板、pstack_list、pstack_use）——不复制
```

面板顶上出现「本机副本和仓库不一致」就是该跑 `npm run sync` 了。反过来改 `~/.dsh/skills/` 里的文件不会被带回来——那里是副本，不是源。

## 一句话给模型

在 DSH 里用 pstack，等价于：不确定名字先 `pstack_list`，要执行某个技能用 `pstack_use { name, task }` 取正文并照做；点按钮那套是给人用的，效果一样。
