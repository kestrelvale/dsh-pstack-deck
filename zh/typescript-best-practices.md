# TypeScript 最佳实践

先应用 **type-system-discipline** 原则技能。

| 规则 | 要点 |
|------|---------|
| 可辨识联合 | 用 `kind` 字面量判据建模变体，让不可能的状态无法被表示。不要一堆可选字段的口袋。 |
| 品牌类型 | 用 `& { readonly __brand: "X" }` 给基本类型打品牌，使它们无法被混用。在边界校验一次。品牌来自会做校验的类型守卫（`input is AgentId`），永远不来自 `as`。 |
| 构造式建模 | 把形状建成让非法值压根构造不出来。非空用 `[T, ...T[]]`，偶数长度用 `[T, T][]`，区间用 `start` 加 `duration`。这不是运行时守卫，也不是在许愿要 refinement types。 |
| 最简单的全函数类型 | 只要对 `T[]` 的每个操作都保持全函数，就留着 `T[]`。只有当这个宽松类型逼出 `!`、一次 cast 或一个「不该发生」的 throw 时，才加强到 `NonEmpty<T>`。 |
| `unknown` 优于 `any` | 外部数据是 `unknown`。 |
| schema 先于守卫 | 手写逐属性类型守卫之前，先用仓库的运行时 schema 库，从 schema 推导类型，比如 `z.infer`。 |
| 不用 `as` cast | 每个 `as` 都是一次等着发生的运行时崩溃。只在验证之后 cast。 |
| 收窄的层级 | 判据 switch > `in` 运算符 > `typeof`/`instanceof` > 自定义类型守卫 > `as`。 |
| 类型守卫 | 必须真的验证它声称的事。说谎的守卫比 `as` 更糟，因为 bug 躲在一个声称「这是安全的」名字后面。命名为 `isX` 或 `hasX`。 |
| 穷尽性 | 在 default 分支里内联 `const _exhaustive: never = x;`，这样新增变体时编译器会报错。 |
| `satisfies` 优于 `as` | 校验值，同时不把字面量类型拓宽。 |
| 边界校验 | 在数据进入的边界处 parse 成有名字的领域类型。`Record<string, unknown>`（不管怎么写）止于那次 parse。内部信任类型。见 **boundary-discipline** 原则技能。 |
| 从 schema 推导类型 | 声明新接口之前，先用 `Pick`/`Omit`/`Parameters`/`ReturnType`/`Awaited`/`typeof`。 |
| 对象参数 | 传对象，不传位置参数，这样参数顺序本身就自带说明。热路径（逐帧渲染、分词器、解析器）上不用。 |
| 真测试 | 能真跑的，就别 mock。优先用框架真实的测试原语，带泄漏/可释放检查，并在运行中的构建里验证 UI。只 mock 你在本地跑不起来的东西。 |
| 结构化遥测 | 优先用带足够上下文的结构化 logger 诊断，能从一个 id 出发排查。上线代码里没有 `console.log`。 |

Examples: `references/patterns.md`.
