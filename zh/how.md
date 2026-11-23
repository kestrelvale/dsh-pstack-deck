# How

探索代码库，回答"X 是怎么工作的？"这类问题。

如果范围含糊，先说出你的理解，然后去探索。用户可以纠正方向。

## 1. 讲解

启动一个只读的 general-purpose 子代理，让它一趟完成探索与讲解：Cursor 里用 `Task`，配 `subagent_type: generalPurpose` 和 `readonly: true`；Claude Code 里用 `Agent`（`subagent_type: general-purpose`）；OpenCode 里用 `task`（`subagent_type: general`）；Codex 里用 `spawn_agent`。如果你的宿主没有子代理工具，比如没装扩展的 Pi，就自己做探索和写作。把用户的问题和下面这段简报交给它：

> 你在为一位资深工程师写一份架构说明。探索代码库，写出一份讲解，让一位不熟悉这个领域的资深工程师读完之后能带走一个扎实的心智模型。他们应当足够理解这套架构，能开始自信地在其中工作。你对代码库是只读访问。

## 2. 呈现

呈现子代理的输出。为了清晰、或者为了让对话里的上下文进来做一些轻编辑是可以的。不要大幅重写。
