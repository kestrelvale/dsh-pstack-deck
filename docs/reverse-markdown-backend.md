# 逆向：dsh-mattpocock-skills-deck 的 Markdown 后端

对象：`~/.dsh/profiles/desktop/node_modules/dsh-mattpocock-skills-deck`（v1.9.0-beta.33，`lib/client.js` 是 3.6MB 打包产物，可读源码在 `tracker/` `refresh/` `department` 之外的 js 里）。
目的：回答四个问题——**箱子怎么摆、怎么读、怎么回写、整条链怎么跑**，再把这套骨架搬进 dsh-pstack-deck。
所有结论都带 `文件:行号`，可直接去原文核对。

---

## 0. 结论先行

1. **一张票 = 一个 .md 文件，编号就是主键**（不是 frontmatter、不是数据库）。`issues/NN-slug.md`，改 slug 不影响定位。
2. **写只有一条路**：`rewriteTicketText` 八步流水线 —— 定位 → 串行锁 → mtime 乐观锁 → 读原文 → 纯字符串变换 → 变了才写 → tmp+rename 原子落盘 → **写后重新 parse 当回执**（`issues-status.js:85`）。
3. **失败不半写**：锁对不上、mtime 变了、后端无更新时间，一律 `failAs(CONFLICT|UNSUPPORTED)`，一个字都不落盘（`write-guards.js:22`）。
4. **关系是读出来的派生量**，不是写在文件里的第二份真相（`graph.js` 每次现读 blockedBy 再算间接阻塞）。
5. **所有磁盘访问都过宿主的 fs 服务**（`read.js:18` / `write.js:47` 三级降级），权限来自会话沙箱，插件不直接 `node:fs` 碰用户文件。
6. **面板永远是派生物**：写路径返回回执 → 快照单飞 + 5 秒 TTL（`shared/time-config/values.js:373 SNAPSHOT_TTL_MS = 5e3`），插件自己不留状态文件。
7. 一句话概括这套代码的气质：**把人手改文件当成常态，把每一次自动改文件当成一次需要提交事务**。

---

## 1. 工具：REA 跑出了什么（含失败，如实写）

用 `rea-agents@6.10.1`（Node 26.13.1，本机 20.20.0 被版本闸拒绝）对插件目录做静态重建：

| 跑的scope | 结果 |
|---|---|
| 全量 `analyze-javascript-application <pkg>` | `status: partial`，崩在 `deck/registration/agent-row.js`；各关系族 `retained_relations: 0`，`unknown_count: 533/533` |
| 收窄到 `tracker/{contract,kernel,registry,rooms/markdown}` + `shared/issue-file`（4,370 字节的 `--source-path` 清单） | 仍 `status: partial`，改崩在 `tracker/contract/backend-module.js` |
| 单文件（`write-queue.js`+`path.js`；`backend-module.js`） | 无有效输出 |

REA 自己在证据包里写清了原因（`/tmp/rea-md-bundle`，10.4MB JSON，`records[0].limitations`）：
> `Source analysis was interrupted: Provider javascript-static-analysis adapter failed during analyze_javascript_application`

**结论**：REA 能证明「这份 shipped artifact 的模块图重建不出来」，不能给出可信调用图。所以结构证据改用**等价静态扫描**（import 边 + 行数 + 入度），它对这套代码是够用的，因为后端是纯 ESM、无动态 require、无打包。

扫描结果（`tracker/rooms/markdown/`，41 个 .js / 5,699 行）：

| 指标 | 值 |
|---|---|
| 内部 import 边 | 141 |
| 环 | **0**（分层干净，没有互相 import） |
| 被依赖最多的模块 | `vocabulary.js` 18 / `error-fail.js` 17 / `read.js` 14 / `parse.js` 12 / `issues-locate.js` 9 / `original-fields.js` 7 / `issues-read.js` 6 |

依赖形状：**词表与错误 → 读 → 解析 → 定位 → 改写 → 写**，全是单向。`vocabulary.js` 和 `error-fail.js` 在扇出的底部，说明这套代码把「错误怎么说」当基础设施，不是当异常处理。

---

## 2. 箱子怎么摆

### 2.1 根与文件名

- 根 `getRoot`：`<cwd>/.scratch`（`path.js:16`）。`repo.refId` 是绝对路径就直接用，是名字就 `.scratch/<name>`。
- 票文件名 `issueFileName`（`path.js:29`）：纯数字 → `String.padStart(2,'0') + '-untitled.md'`；`^\d+-` → 补 `.md`。
- 落点 `mdPath`（`path.js:37`）：kind=`spec` → `spec.md`；kind=`map` → `map.md`；普通票 → `issues/NN-slug.md`。

**主键 = 文件名前缀的两位编号**。所以：改标题只会改文件名后半段，编号不变，所有引用（blockedBy、地图指针、评论里的 link）都不受影响。这是「可人手编辑」的前提——人可以在 Finder 里改 slug、挪文件进子目录，编号还在。

### 2.2 容器 vs 票

`mkdir` 骨架由 `create-layout.js` 做，`dirOccupied`（`create-layout.js:18`）先判：目录里已有 `spec.md`/`map.md`/`issues/` 就算占用，**拒绝建第二套骨架**（防两套 .scratch 混住）。
- `map.md` / `spec.md` 是**容器文件**（key `'00'`），正文是给人读的地图；
- `issues/*.md` 是票。

### 2.3 文件里的两种边：隐藏注释给机器，字段行给人

`renderHeader`（`create-render.js:126`）生成：

```html
<!-- DSH-TITLE: … DSH-STATUS: … DSH-PARENT: … DSH-ASSIGNEES: … DSH-LABELS: … DSH-BLOCKED-BY: … DSH-IDEMPOTENCY-KEY: … DSH-CREATED: … -->
```

值里的 `--` 会被替成 `-- >`——**防注释被内容截断**。这是很细的一手：字段值里出现 `-->` 会把注释提前闭合，整份文件后面全坏。

`renderTicket`（`create-render.js:236`）排成：H1（`NN. Title`）+ 空行 + 字段行 + Acceptance + 余下正文。

所以同一份文件里有三层：
1. 隐藏注释（机器读，可被 parse 兜底）；
2. `**Status**:` / `Status：` 字段行（人读，也机器读）；
3. 自由 Markdown 正文（人的地盘）。

---

## 3. 怎么读

三段：**定位 → 解析 → 派生**。

### 3.1 定位 `issues-locate.js`

- `listEfforts`（`:30`）枚举 `.scratch/` 下各工作单元；根目录有 `map.md` 则该单元 id 为 `''`；
- `resolveIssueFile`（`:157`）：只按编号在 `issues/` 里扫，不看 slug；**跨 effort 撞编号就 `failAs(CONFLICT)` 拒绝猜**；
- `resolveMapFile`（`:241`）同理。

### 3.2 解析 `parse.js:101 parseMd(text, meta)`

- H1 去掉 `NN.` 前缀取 title；
- 字段行两种形态都认：`**Status**:` 与裸 `Status：`，**全角冒号也算**（`original-fields.js:3/6/7` 是这三条正则的出处）；
- `## Comments` 下按 `### actor — ISO` 分块（`comments.js:22 commentBlockOf`）；
- **先 `stripFencedCode` 抹掉代码块再解析**——否则正文里的示例 Markdown 会被当成字段；
- 隐藏注释兜底：`parentKeyFromFile`（`parse.js:28`）认 `<!-- parentKey: -->` 与 `<!-- DSH-PARENT: -->`。

### 3.3 派生 `graph.js`

`readBlockedBy` 每次现读票文件取 blockedBy，`getDependenciesForKey` 再扫全 effort 算**间接**阻塞；自环直接 `failAs(CONFLICT,"self-block NN")`。
`counts.js` / `page.js` / `maps.js` 同样是派生视图——**没有任何缓存的状态文件**。

这是整套设计最值钱的一条：**文件是唯一真相，其余全是算出来的**。所以"面板不刷新"这类问题在这套架构里不存在——刷新就是重算。

---

## 4. 怎么回写（本报告的核心）

### 4.1 唯一写路径 `rewriteTicketText`（`issues-status.js:85`）

```
1 locateWriteTarget              (:64)   找出要写哪个文件
2 withSingleWriter              (write-queue.js:3)  同文件串行
3 checkExpectedUpdatedAt        (write-guards.js:22) mtime 乐观锁
4 readTextFile                  (read.js:18)        读原文
5 apply(before, target)                             纯字符串变换
6 if (txt !== before)                               没变就不写
7 publishTextFile               (write.js:110)      tmp + rename
8 parseMd(txt, metaOf(...))                         写后回读当回执
```

细节：

- **锁 key**：`fileWriteKey` = 路径小写 + 去尾斜杠；Map 里每 key 一条 promise 链，`prev.then(work, work)`——前一个失败也放行下一个，不会一个失败把队列毒死。
- **乐观锁说人话**：mtime 不符 → `failAs(CONFLICT, "expectedUpdatedAt mismatch（这张票在你读到它之后已经被改过，所以这次一个字都没写）")`；拿不到 mtime → `failAs(UNSUPPORTED, "这个后端取不到这张票的更新时间，写前版本校验做不成，所以这次一个字都没写")`。
- **原子写**：先写 `<target>.<pid>.tmp` 再 rename；rename 失败 `fs.rm(tmp,{force:true})` 清垃圾。**崩溃最多留个 tmp，绝不会留半份票**。
- **回执就是重新 parse 出来的对象**，不是「我觉得写成功了」的布尔值。前端拿到的是「盘上现在这张票长什么样」。

### 4.2 三种票形态，三套改写法

形态判定在 `original-fields.js` 的 `ticketFormOf`，改写分支在 `issues-status.js:26/49/59`：

| 形态 | 状态写在哪 | 认领人的语义 |
|---|---|---|
| impl-ticket（挂 spec 的实施票） | 改粗体行 `**Status**:` | 有认领人就记 |
| map-ticket（挂地图的探索工单） | 改**裸行** `Status:` | `ready-for-agent|open` 且有认领人 → 写 `claimed`；**没认领人就把 Status 行删掉**（"未认领"用缺行表达） |
| 容器 map/spec | `upsertHiddenComment('DSH-STATUS')` | 藏在注释里，不污染给人读的正文 |

注意第二行那种设计：**状态可以用"这一行不存在"来表达**。这比写 `Status: none` 更贴近人写 Markdown 的直觉，代价是解析端要多条兜底。

### 4.3 关票的三种落笔

| 票种类 | 落什么 |
|---|---|
| impl-ticket | 追加 `### actor — ISO\nbody` 评论块（`comments.js:22`） |
| map-ticket | 追加 `## Answer` 段 |
| legacy | 写 `Close reason:` 字段 |

`reopen`（`issues-status.js:212`）只把状态推回 `ready-for-agent`，**不动历史评论**。

### 4.4 关票联动地图（这里是最容易被漏掉的一环）

`appendMapDecisionPointer`（`issues-status.js:137`）往 `map.md` 的 `## Decisions so far` 追加：

```markdown
- [标题](issues/NN-x.md): 摘要
```

- **幂等**靠 `indexOf("](link)")` 判重，不是靠状态位；
- 摘要取 `## Answer` 的第一个非空行，**超 120 字截断加 `…`**（`:126 answerGist`）。

也就是说：**结案不是"改自己的状态"，而是"同时在容器里留一条能点回去的指针"**。地图因此永远是一份可读的决策日志，而不是一堆卡的外键表。

### 4.5 整票覆盖不盲写 `patch-body.js`

面板可能把整篇正文提交上来（人编辑过），这时不能直接覆写：

- `looksLikeWholeDocument`（`:6`）：有 H1 或 `DSH-IDEMPOTENCY-KEY` 才走 merge 逻辑；
- `HIDDEN_FIELD_RE`（`:21`，白名单 `DSH-FORMAT|TITLE|STATUS|PARENT|ASSIGNEES|LABELS|BLOCKED-BY`）：盘上独有、提交里没有的隐藏字段**补回去**；
- 幂等锚用盘上那份、`created` 保留、多个 H1 只留第一个、盘上独有字段行插回 `## Comments|Answer` 之前、`restoreOriginalWordsSection` 恢复「维护者原话」区；
- `checkNoWorseForPatch`（`:52`）质量闸：一级标题 / 幂等锚 / 类型标记 / `Status·Type·Blocked by·Labels·Assignees·Close reason` 六行 / `## Comments` / `## Answer` / 维护者原话区 —— **任何一样"变少了"直接拒**。

最后这条是整套代码里最反直觉、也最正确的设计：**不相信任何一次整体覆盖，覆盖前后必须做一次"没变得更差"的比对**。

### 4.6 写日志 `write-log.js`

`beginWriteTrail`（`:3`）开票 `{route:'file', written, failed}`；`noteFileWritten`（`:6`）**只在真写了才 +1**；`emitIssueWrite`（`:26`）打 `issue.write` 事件：
`kind`（create/close/reopen/update/setLabels/setAssignees/comment）、`route`、`ok`、`written`、`failed`、`reason`（**fresh | reuse | edited | noop**：create 没写=reuse，非 create 没写=noop）、`latencyMs`。

「没写」和「写失败」被明确区分成两个不同的 reason，前端因此能说人话："这张票没变，所以没动它"，而不是含糊的成功。

---

## 5. 整条链怎么跑

### 5.1 后端注册 `tracker/rooms/markdown/index.js`

导出面（`index.js:200` 起的 `capabilities` 块）：

| 字段 | 值 | 作用 |
|---|---|---|
| `id` / `label` | `"markdown"` / `"Markdown"` | 注册表主键与显示名 |
| `commandVocabulary` | `{cliBrand:"本地 Markdown"}` | 文案层按后端换词 |
| `subIssue` / `healthCheck` | 有 | 能力声明：能不能建子票、能不能自检 |
| `presentation` | 有 | 面板怎么展示 |
| `setupPrompt` | 有 | 初始化时注入的提示词 |
| `labelPalette` | `defaultLabelPalette` | 标签颜色 |
| `create` | `createMarkdownBackend` | 工厂 |
| `budget` | `{kind:"off-network",countsRequests:false,countsPoints:false}` | **离线后端不记配额** |
| `links` | `{linkPatternSource:"#(\\d+)"}` | 正文里 `#12` 是可点链接 |
| `openRepository`/`openIssue`/`openContainer` | `"folder"` | 点开就是开文件夹 |

注册表 `registry/core.js:39 createRegistry`：按 id 注册，`matches()` 带超时；**超时或抛错一律视为该后端"不可用"**，不会让一个坏后端拖住整个面板。

三个后端（`github` / `gitlab` / `markdown`）实现同一套 capability 契约 —— 这是"多后端"真正落地的地方：**换后端不改 UI，只换 room**。

### 5.2 一次改状态的全程

```
面板点「关票」
  → deck tool 组装 operation（含 expectedUpdatedAt）
  → registry 选后端（markdown room）
  → preflight（workspace-checks.js:342 runWorkspaceChecks：骨架在不在、编号冲突、自环）
  → rewriteTicketText 八步（第 4 节）
  → 回执：重新 parse 的票对象 + trail
  → appendMapDecisionPointer 往 map.md 补一行
  → emitIssueWrite 打 issue.write 事件
  → 面板拿回执重绘，下次快照刷新再算一遍
```

### 5.3 错误词表 `contract/vocabulary.js`

`ERROR_KIND`（`:38`）八类：`env / auth / rate-limit / conflict / unsupported / not-found / network / parse`。
`STATE`（`:7`）= `open|closed`；`ISSUE_TYPE` = `issue|map|spec`；`SPEC_BODY_MARKER = '<!-- DSH-ISSUE-KIND: spec -->'`。

八类错误是**给用户看的分类**，不是给程序 catch 的 exception 类型——每类都对应一套固定人话和下一步动作。这是"环境检测页"能工作的底层：检查项失败不是异常，是一个 kind。

### 5.4 快照与刷新

- `SNAPSHOT_TTL_MS = 5e3`（`shared/time-config/values.js:373`）；
- 单飞在 `lib/snapshotInflight.js`（33 行）：同一时刻只跑一个构建，后来的请求挂在这个 promise 上；
- 信封 `lib/snapshotEnvelope.js` 包 `{mode: ok|loading|err, at, value}`。

所以面板可以随便刷——TLL 内不重算，重算时也不并发。

---

## 6. 四条不变量（这才是要搬的东西）

1. **文件是唯一真相，其余全是派生。** 没有第二份状态存储，因此不存在"面板和后端不一致"的问题。
2. **每一次写都是一个事务**：读 → 校验版本 → 变换 → 变了才写 → 原子落盘 → 写后回读。任一步失败，盘上一个字节不变。
3. **回写只做最小文本手术**，绝不重排整篇：保住人的手工排版、保住盘上独有的字段、保住幂等锚。
4. **失败是一等公民**：有 kind、有人话、有下一步，且区分「没写」与「写坏了」。

---

## 7. 我们差在哪（对照 dsh-pstack-deck 现有代码）

| 环节 | 竞品 | 我们 | 严重度 |
|---|---|---|---|
| 主键 | 文件名两位编号（`path.js:29`） | `src/board.js:113` 用 `max(id)+1`，标题变了 `src/board.js:132` 就换文件名 | 中 |
| 写路径 | 八步事务（`issues-status.js:85`） | `src/board.js:134` `writeFile(整篇)` —— **无锁、无版本闸、无原子 rename、无写后回读** | **高** |
| 并发 | `write-queue.js:3` 同文件串行 | 无。两个工具调用同时写同一张卡 → 后者静默覆盖前者 | **高** |
| 人手改文件 | mtime 乐观锁 + CONFLICT 拒写 | 无。**用户在编辑器里改过的卡，下一次自动写就被覆盖** | **高** |
| 改名 | 只改 slug，编号不动 | 写新文件 + `rm` 旧文件（`src/board.js:135`），非原子 | 中 |
| 写后回执 | 重新 parse 返回对象 | 返回布尔/字符串 | 中 |
| 关票联动 | `appendMapDecisionPointer` 幂等指针 + 120 字摘要（`issues-status.js:137`） | `src/board.js:365 finishCard` → `appendToSection`（`:344`）往地图写一行，**无按链接幂等、无摘要截断** | 中 |
| 整篇覆盖保护 | `patch-body.js` merge + `checkNoWorseForPatch` 质量闸 | 无 | 中 |
| 错误分类 | 8 类 kind + 固定人话 + 下一步 | toast 一句字符串 | 中 |
| 写日志 | `issue.write` 事件，区分 fresh/reuse/edited/noop | 无 | 低 |
| 快照 | 单飞 + 5s TTL + `mode: ok/loading/err` | 4 秒 setInterval 各刷各的 | 低 |
| 分层 | 141 条单向 import 边、零环 | `board.js` 同时管读写解析（440 行） | 低 |

**一句话诊断**：我们的面板能读能显示，但**写路径没有事务**。用户投诉的"闭环性差"不是界面缺东西，是他手改过的文件会被我们覆盖 —— 一旦被覆盖过一次，人就不敢再手改了，插件就从"和文件协作"退化成"独占文件"，闭环自然断了。

---

## 8. 迁移方案（搬到 pstack，技能库不动）

### 8.1 映射表

| 竞品 | 我们（现状） | 迁移做法 |
|---|---|---|
| `.scratch/map.md` + `issues/NN-slug.md` | `.pstack/board/NN-slug.md` + `1-<地图>.md` | 保留现布局，**编号 = 主键**；`saveCard` 不再因改名换文件，改名只改 slug 后缀 |
| 隐藏注释机器边 | 卡 = 分段 Markdown（`## 结论` / `## 进度`） | 不引入 frontmatter；在卡首加一行 `<!-- psp:id=07 parent=01 status=doing idem=… -->` 只放**不可从正文推出的**字段 |
| `rewriteTicketText` 八步 | `saveCard` 整篇覆盖 | 新 `src/write.js`：`rewriteCard(cwd, id, apply, opts)` —— 锁 + mtime 闸 + 原子写 + 写后回读 |
| `withSingleWriter` | 无 | `src/lock.js`：`withKeyLock(key, fn)`，Map 串行链 |
| `checkExpectedUpdatedAt` | 无 | 同文件；`expectedUpdatedAt` 可选，给了就校验 |
| `publishTextFile` tmp+rename | 无 | 同上 |
| `patch-body` merge + 质量闸 | 无 | `src/patch.js`：整篇提交时保住盘上独有段、幂等锚、`## 结论`，并做"没变差"检查 |
| `appendMapDecisionPointer` | `appendToSection` | 升级为 `appendMapPointer`：`- [标题](07-x.md): 摘要`，按链接幂等，摘要截 120 字 |
| `ERROR_KIND` 八类 | 字符串 throw | `src/errors.js`：`failAs(kind, msg, hint)`，host 层序列化成 `{kind, message, hint}` |
| `issue.write` 事件 | 无 | `src/write-log.js`：`{kind, written, reason, latencyMs}`，写进 host 日志 |
| 快照单飞 + TTL | 4s interval | `src/snapshot.js`：`buildSnapshot` 单飞 + 5s TTL，返回 `{mode, at, value}` |
| 三后端 room | 单 Markdown | **不抄**（见 8.3） |

### 8.2 六批次与验收断言

| 批次 | 内容 | 验收断言 |
|---|---|---|
| **P0 写路径可信** | `src/lock.js` + `src/write.js` + 改 `saveCard`/`finishCard`/`moveCard` 全走 `rewriteCard` | ① 两个并发 `saveCard` 同一卡 → 后者看到前者的结果（不是覆盖）② 外部改 mtime 后自动写 → 抛 CONFLICT 且盘上字节不变 ③ 任何一次写后 `loadBoard` 能读到刚写的内容 |
| **P1 回执与错误** | `src/errors.js` + 工具/host 返回 `{kind, hint}` | ④ 少必填 → `kind:'conflict'` 且 hint 说下一步 ⑤ 面板据此显示分类文案 |
| **P2 容器联动** | `appendMapPointer` + 摘要截断 + 链接幂等 | ⑥ 同一张卡结案两次 → 地图只有一条指针 ⑦ 摘要 >120 字时带 `…` |
| **P3 覆盖保护** | `src/patch.js` | ⑧ 提交缺 `## 结论` 的整篇 → 拒绝并保住盘上结论 ⑨ 提交删掉 H1 → 拒绝 |
| **P4 快照与面板** | `src/snapshot.js` + 面板改用它 | ⑩ 1 秒内连点刷新 10 次 → 只构建 1 次 |
| **P5 写日志与自检** | `write-log.js` + 环境页读它 | ⑪ 改一次卡 → 日志 `reason:'edited'`；没变 → `'noop'` |

合计约 **700–900 行**（比 `docs/framework-plan.md` 里估的 2,400 行小，因为砍掉三后端/配额/提示词注入）。

### 8.3 明确不抄

| 不抄 | 理由 |
|---|---|
| 三后端 + `workspace.yaml` | 我们只有一个 .pstack 布局；多后端要 room 抽象 + 能力矩阵，收益为零 |
| `setupPrompt` 提示词注入流程 | 我们 `init.js` 直写磁盘更稳，注入提示词多一次会话往返 |
| 配额/预算层 | 不联网就没有配额 |
| `publishFlow`（GitHub 发帖） | 我们的票不进 GitHub |
| 27 条技能探针 + 多候选目录探测 | 我们技能库固定 bundled，路径唯一 |

---

## 9. 风险

1. **mtime 闸会让人烦**：用户在编辑器里改了卡、没保存就点面板 → 我们拦下。必须给"我知道我改了，就是要覆盖"的显式通道（`force: true`），否则会变成新的阻塞点。
2. **编号主键**要求 `id` 永不回收：删卡后编号不能复用（现在 `max(id)+1` 满足，但删掉最大的那张再建会撞）。需在卡首注释里落 `psp:id` 兜底。
3. **写后回读**会让每次写的 I/O 翻倍。文件小（< 60KB 顶），可接受；若变慢，退化方案是回读仅校验 hash 不重 parse。
4. **`node:fs` 直连 vs 宿主 fs 服务**：竞品走 `ctx.fs` 服务（沙箱感知、跨平台路径）。我们已用 `node:fs/promises` + 自己的 `projectRoot` 兜底，需确认在 Windows / 沙箱只读会话下的行为，但**不为此改写整套**。

---

## 附：证据速查

| 事实 | 位置 |
|---|---|
| 原子写 tmp+rename | `write.js:110 publishTextFile` |
| 同文件串行 | `write-queue.js:3 withSingleWriter` |
| mtime 乐观锁 | `write-guards.js:22 checkExpectedUpdatedAt` |
| 八步流水线 | `issues-status.js:85-108 rewriteTicketText` |
| 地图指针 + 120 字摘要 | `issues-status.js:137 / :126` |
| 整篇 merge | `patch-body.js:6 / :21 / :52` |
| 文件名即主键 | `path.js:16 / :29 / :37` |
| 解析兜底 | `parse.js:28 / :101` |
| 错误八类 | `vocabulary.js:38` |
| 快照 TTL | `shared/time-config/values.js:373` |
| 后端契约 | `tracker/rooms/markdown/index.js`（capabilities 块） |
| 后端注册表 | `tracker/registry/core.js:39 createRegistry` |