# dsh-pstack-deck

## 项目看板

这个项目用 `.pstack/board/` 记任务，一张卡一个 markdown 文件。

- 开工前先看板：调 `pstack_board` 的 `op: "list"`，从「可开工」那一组里挑一张。
- 动手前先认领（`op: "claim"`），告诉别人这条你在做，别让两个会话撞在同一件事上。
- 做完写一条进展（`op: "move"`），把结论留在卡上，别只留在对话里。
- 不知道下一步做什么，调 `pstack_suggest`，它会给 3~5 条带现成提示词的动作。
