# Swarm

## 开始

在启动任何东西之前，先开一份 todolist，每个阶段一条。

1. 框定
2. 铺开
3. 汇总
4. 报告

## 阶段 A：框定

1. 说清完成判定，以及 swarm 必须返回的产物或报告。
2. 选形状。切成切片、让 N 个 worker 用同一份简报赛跑，或者两者混用。赛跑或混用的形状，在 spawn 之前先声明 `first pass`、`rank all` 或 `best-of`。
3. 从 pstack 设置文件里 `swarm workers` 那一行选 worker 模型（Cursor 里是 `~/.cursor/rules/pstack-models.mdc`，Claude Code 里是 `~/.claude/rules/pstack-models.md`，其他宿主里是 `~/.agents/pstack-models.md`）。文件缺失或那一行缺失，就用 `claude-opus-5-5-high-fast`。`auto` 或 `inherit-parent` 就省略 `model`，让 worker 跑在父模型上。你的子代理工具拒绝某个 slug，就用默认值并说出来。它连默认值都拒绝，就用它报错信息里或你宿主模型列表里同族最近的合法 slug。模型赛跑时，每条臂用哪个模型事先点名。每个子代理的推理档位按任务选，见 **poteto-mode** 技能的 Subagents 一节。
4. worker 要写东西，就给每个 worker 它自己的可写输出。worker 要验证或测量提交时，每份简报点名确切的 SHA。测量简报还要点名方法（采样数、一个样本是什么、顺序）。worker 在结果里把这两样都记下来。

## 阶段 B：铺开

在一条消息里 spawn 全部 N 个 worker，带 `subagent_type: generalPurpose`、`environment: "cloud"`、`run_in_background: true`，以及第 3 步的模型——`auto` 或 `inherit-parent` 时留空不设。只有 worker 需要访问用户电脑上的东西时，才用 `environment: "local"`。

worker 必须从一个非默认的已推送分支起步时，传 `cloud_base_branch`。

**其他宿主。** 这些参数属于 Cursor 的 `Task` 工具，`environment: "cloud"` 跑的是 Cursor 云代理。别的宿主里用它的子代理工具：Claude Code 里是 `Agent`（`subagent_type: general-purpose`），OpenCode 里是 `task`（`subagent_type: general`），Codex 里是 `spawn_agent`。那里的 worker 在本地跑，所以给每个 worker 它自己的 worktree 或输出路径。简报和模型照留。你的工具没有的参数丢掉。宿主没有子代理工具，比如没装扩展的 Pi，那就你自己跑 worker，一个接一个。

每份简报都要能独立成立。写清目标、范围、确切的切片或赛跑臂、怎么验证、要报告什么。报告用 `PASS`、`ISSUES` 或 `BLOCKED`，带证据。能证明缺陷的 worker 报 `ISSUES`，并列出它能证明的每一个问题，不是只列第一个。

有 worker 掉队，就用 N-1 继续，并注明。

## 阶段 C：汇总

读终局结果。没记下简报点名的 SHA 和方法的结果丢掉，把那个 worker 重 spawn 一次。第二次还是缺，记为缺口。缺口不算通过。切片覆盖时，每个必需切片都得有结果。赛跑时，按事先声明的选择规则执行。用 first pass、rank all 或 best-of。不要粘贴 worker 的原始转储。

## 阶段 D：报告

返回一份合并的聊天内报告，带结果表、问题一行一条、缺口或掉队，以及用过赛跑时的赛跑规则。
