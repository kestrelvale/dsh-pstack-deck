# No comments

派出 Comment Sicko。对接受的意见采取行动。

以 Comment Sicko 的新鲜视角为准。

## Scope

用调用方指定的文件或 diff。否则就用当前相对基线分支（默认 `main`）的 diff，包括工作区。

## Steps

1. 用 `subagent_type: "comment-sicko"` 派 `Task`。把范围传给它。按 **poteto-mode** 技能的 Subagents 一节，为这项工作挑选每个子代理的推理档位。不要复述它的规则。如果你的宿主没有把 comment-sicko 注册成子代理（除装了 pstack 插件的 Cursor 之外的任何宿主），就改派一个通用子代理：Claude Code 里是 `Agent`（`subagent_type: general-purpose`），OpenCode 里是 `task`（`subagent_type: general`），Codex 里是 `spawn_agent`。它的提示词就是 [`references/comment-sicko.md`](references/comment-sicko.md) 的原文，然后是范围。如果你的宿主没有子代理工具，比如没装扩展的 Pi，就自己把那份提示词对着范围跑一遍全新的流程。
2. 检查它的报告和 diff。拒绝应用代码的改动、越界的改动、受异常保护的删除、错述理由的 `MUST KILL`、以及把保留下来的有意为之的代码当罪证的标记。对自家代码里「怪东西」的标记，重塑成仍然可行动的形式。不要恢复那些注释。一个保留只有在证明了它涉及我们无法改变的东西时才站得住。审查漏掉的带范围 lint 与 TypeScript 抑制。正确性或安全性相关的抑制保持为可行动的 `MUST KILL`。只有给出确切例外和带范围的证据时才恢复删除。在接受单薄的 `IMPORTANT` 或 `do not remove` 删除或保留之前，追踪它涉及的符号，或对它跑 `/why`。某个删除含义不清，就不要恢复。某个保留被驳倒或仍含混，就删掉它，例外是关于外部规则的 `REVIEW` 保留——那要等到有人核实那条规则，报告时要标为未决。回退并重跑一份被拒绝的报告，并点名失败之处。如果重跑你也拒绝，就只回退它被拒的发现，报告为未决，然后带着已接受的部分继续。
3. 琐碎的已接受标记直接修掉：删死路径、去掉参数、或者用真正的 API。如果任何修复需要先定形状，就对已接受的集合和周边代码跑一次 `/architect`。停在草图。Architect 定形状。第 4 步负责实现。
4. 在范围内实现最小的根因修复。移除每一个被点名的绕过。如果根因在范围之外，就落地范围内最小的修复，其余报告为未决。**principle-fix-root-causes** 和 **principle-redesign-from-first-principles** 技能只用来指引意图。两者都不授权扩大围栏，也不授权去修围栏之外的实例。绝不外挂症状守卫。
5. 约束类注释写着 `do not remove`、`do not change wording` 或 `talk to X before changing`。涉及我们无法改变的东西的保留，留着。提供范围内最便宜的编码方式：类型、运行时、测试或 CI lint。等待交互式批准。无人值守和评测需要调用方预先批准。若获批，先编码再删除。否则就删除，把该约束报告为未决，并勾出范围之外的工作。
6. 报告删除数、被恢复的注释、`REVIEW` 保留、重跑、architect 草图、修复、编码提议、已编码项、未被强制执行的约束，以及其他未决工作。
