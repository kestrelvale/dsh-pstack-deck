// 初始化：让一个陌生项目「长出」看板，而不是打开面板看见一块空板无处可点。
//
// 初始化只写三样东西，全是 markdown / 纯文本，都能提交进仓库：
//   1. `.pstack/board/1-<slug>.md` —— 一张地图卡，四段骨架（去向/已经定了/还没想清/不做什么）
//   2. `.pstack/README.md`         —— 这个目录是什么、一卡一文件怎么手改
//   3. `AGENTS.md` 的 `## 项目看板` 段 —— 让以后每个会话的 agent 都知道开工先看板
//
// 为什么不照 matt deck 那样「注入一句提示词让 AI 建文件」：deck 要 AI 做判断（选哪个
// tracker 后端、域文档布局），pstack 这边的产物是固定的四段 markdown，写死更快也不会跑偏。
// 要是以后加需要人拍板的选项，再退回注入提示词那条路。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { projectName } from './anchor.js'
import { boardRoot, loadBoard, saveCard } from './board.js'

export const README_REL = '.pstack/README.md'
export const AGENTS_FILE = 'AGENTS.md'
export const AGENTS_MARK = '## 项目看板'

const has = async (path) => {
  try {
    await readFile(path, 'utf8')
    return true
  } catch {
    return false
  }
}

/** 地图正文骨架。四段的标题必须和 board.js 的 MAP_SECTIONS 一模一样，否则面板切不出来。 */
export function mapSkeleton(name) {
  return [
    '## 去向',
    `${name} 做完之后是什么样。写一句能验收的话，别写「完善」「优化」。`,
    '',
    '## 已经定了',
    '- （把已经拍板、不用再讨论的结论写这里）',
    '',
    '## 还没想清',
    '- （知道要做但还没想明白的，先留在这儿，想清了再开票）',
    '',
    '## 不做什么',
    '- （明确排除的范围，写下来省得反复问）',
    '',
  ].join('\n')
}

const readmeText = () => `# .pstack —— 这个项目的看板

一张卡一个 markdown 文件，路径 \`<项目>/.pstack/board/<编号>-<slug>.md\`。

- 卡头是 frontmatter（\`id / kind / state / title / after / owner / scope / parent\`），正文随便写。
- \`kind\`：\`map\` 地图、\`bug\` 缺陷、\`idea\` 想法、\`task\` 任务。
- \`state\`：\`idea\` 想法、\`todo\` 待办、\`doing\` 在做、\`done\` 完成、\`dropped\` 已废弃。
- \`after: 3, 5\` 表示要等第 3、5 号卡做完才能开工。
- \`owner\` 是认领人；同一个 scope 上的两张 \`doing\` 卡会在面板上标成并行冲突。

这些文件就是给人读、给人改的：直接编辑、\`git diff\` 里看得见、换机器拷目录就走。
面板每次都现读磁盘，不另存索引，所以手改完点一下「重读」就同步。
`

const agentsBlock = () => `
${AGENTS_MARK}

这个项目用 \`.pstack/board/\` 记任务，一张卡一个 markdown 文件。

- 开工前先看板：调 \`pstack_board\` 的 \`op: "list"\`，从「可开工」那一组里挑一张。
- 动手前先认领：\`op: "claim"\`，告诉别人这条你在做，别让两个会话撞在同一件事上。
- **干完必须收尾**：\`op: "done"\` 并写一句 \`note\`（做成了什么、验过什么），或 \`op: "drop"\` 并写为什么不做了。
  没有结论的「已完成」等于没做，卡会一直挂在「在做」——这就是这个看板唯一的规矩。
- 放掉的卡不是删掉：\`op: "reopen"\` 就能回到待办，编号不变，之前的结论还在卡里。
- 不知道下一步做什么，调 \`pstack_suggest\`，它会给 3~5 条带现成提示词的动作。
`

/** 这个项目初始化到哪一步了。只看磁盘，不猜。 */
export async function detectInit(root) {
  const board = await loadBoard(root)
  const map = board.cards.find((c) => c.kind === 'map')
  const missing = []
  if (!board.cards.length) missing.push('board')
  else if (!map) missing.push('map')
  const readme = join(root, README_REL)
  if (!(await has(readme))) missing.push('readme')
  const agents = join(root, AGENTS_FILE)
  let agentsText = ''
  try {
    agentsText = await readFile(agents, 'utf8')
  } catch {
    /* 没有 AGENTS.md 也算缺 */
  }
  if (!agentsText.includes(AGENTS_MARK)) missing.push('agents')
  return {
    root,
    name: projectName(root),
    initialized: !missing.length,
    missing,
    cards: board.cards.length,
    mapId: map?.id ?? null,
  }
}

/**
 * 初始化一个项目。重复调用是安全的：已经有的东西一样都不重写。
 * `dir` 必须是项目根（调用方负责用 anchor.projectRoot 上溯）。
 */
export async function initProject(root, opts = {}) {
  const name = projectName(root)
  const title = String(opts.title ?? '').trim() || `${name} 的路线图`
  const created = []
  const skipped = []

  await mkdir(boardRoot(root), { recursive: true })

  const board = await loadBoard(root)
  if (board.cards.some((c) => c.kind === 'map')) skipped.push('map')
  else {
    const card = await saveCard(root, { kind: 'map', title, body: mapSkeleton(name) })
    created.push(`.pstack/board/${card.file}`)
  }

  const readme = join(root, README_REL)
  if (await has(readme)) skipped.push('readme')
  else {
    await mkdir(join(root, '.pstack'), { recursive: true })
    await writeFile(readme, readmeText(), 'utf8')
    created.push(README_REL)
  }

  const agents = join(root, AGENTS_FILE)
  let agentsText = ''
  try {
    agentsText = await readFile(agents, 'utf8')
  } catch {
    agentsText = ''
  }
  if (agentsText.includes(AGENTS_MARK)) skipped.push('agents')
  else {
    const next = agentsText.trim() ? `${agentsText.replace(/\s*$/, '')}\n${agentsBlock()}` : `# ${name}\n${agentsBlock()}`
    await writeFile(agents, next, 'utf8')
    created.push(AGENTS_FILE)
  }

  return { ...(await detectInit(root)), created, skipped }
}
