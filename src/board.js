// dsh-pstack-deck · 看板层
//
// 一个项目一个看板：`<项目>/.pstack/board/<id>-<slug>.md`，一张卡一个文件。
// 为什么是文件而不是数据库：卡本来就是给人读给人改的东西，git diff 里看得见、
// 手改不会跟插件打架、换机器拷目录就走。清单每次都现读磁盘，谁都不另存索引。

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseFrontmatter } from './catalog.js'

/** 相对项目根的看板目录。 */
export const BOARD_REL = '.pstack/board'

export const KINDS = ['idea', 'bug', 'task', 'map']
export const STATES = ['idea', 'todo', 'doing', 'done', 'dropped']

const STATE_ZH = { idea: '想法', todo: '待办', doing: '在做', done: '完成', dropped: '已废弃' }
const KIND_ZH = { idea: '想法', bug: '缺陷', task: '任务', map: '地图' }

export const stateZh = (s) => STATE_ZH[s] ?? s
export const kindZh = (k) => KIND_ZH[k] ?? k

export function boardRoot(cwd) {
  return join(cwd, BOARD_REL)
}

const slug = (title) => String(title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card'
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** 一张卡里的「## 进展」条目。追加，不改写历史。 */
const progressLines = (body) => (String(body).match(/^- \d{4}-[^\n]*$/gm) ?? [])

function stringify(card) {
  const fm = [
    '---',
    `id: ${card.id}`,
    `kind: ${card.kind}`,
    `state: ${card.state}`,
    `title: ${card.title}`,
    `created: ${card.created}`,
    `updated: ${card.updated}`,
  ]
  if (card.skills?.length) fm.push(`skills: ${card.skills.join(', ')}`)
  if (card.after?.length) fm.push(`after: ${card.after.join(', ')}`)
  if (card.parent) fm.push(`parent: ${card.parent}`)
  if (card.owner) fm.push(`owner: ${card.owner}`)
  if (card.scope?.length) fm.push(`scope: ${card.scope.join(', ')}`)
  if (card.verify) fm.push(`verify: ${card.verify}`)
  fm.push('---', '')
  return fm.join('\n') + String(card.body ?? '').replace(/\s+$/, '') + '\n'
}

function toCard(file, text) {
  const { data, body } = parseFrontmatter(text)
  const id = Number(data.id)
  if (!Number.isInteger(id) || id <= 0) return null
  return {
    id,
    file,
    kind: KINDS.includes(data.kind) ? data.kind : 'idea',
    state: STATES.includes(data.state) ? data.state : 'idea',
    title: String(data.title ?? '(无标题)'),
    created: String(data.created ?? ''),
    updated: String(data.updated ?? ''),
    after: String(data.after ?? '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    skills: String(data.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    // 并行管控三件套：挂在哪张卡下、谁认领了、这张卡能动哪些路径
    parent: Number(data.parent) > 0 ? Number(data.parent) : undefined,
    owner: String(data.owner ?? '').trim() || undefined,
    scope: String(data.scope ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    verify: String(data.verify ?? '').trim() || undefined,
    body,
    progress: progressLines(body).length,
  }
}

/** 读一整个看板。目录不存在就是空看板，不是错误。 */
export async function loadBoard(cwd) {
  const dir = boardRoot(cwd)
  let files = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
  } catch {
    return { cwd, dir, cards: [] }
  }
  const cards = []
  for (const f of files) {
    try {
      const card = toCard(f, await readFile(join(dir, f), 'utf8'))
      if (card) cards.push(card)
    } catch {
      /* 单个文件坏了不该让整个看板读不出来 */
    }
  }
  cards.sort((a, b) => a.id - b.id)
  return { cwd, dir, cards }
}

/** 写一张卡（新建或更新同一个 id）。返回这张卡。 */
export async function saveCard(cwd, input) {
  const dir = boardRoot(cwd)
  await mkdir(dir, { recursive: true })
  const board = await loadBoard(cwd)
  const existing = input.id ? board.cards.find((c) => c.id === Number(input.id)) : null
  const id = existing ? existing.id : board.cards.reduce((m, c) => Math.max(m, c.id), 0) + 1
  const card = {
    id,
    kind: KINDS.includes(input.kind) ? input.kind : (existing?.kind ?? 'idea'),
    state: STATES.includes(input.state) ? input.state : (existing?.state ?? 'idea'),
    title: String(input.title ?? existing?.title ?? '').trim() || '(无标题)',
    created: existing?.created || now(),
    updated: now(),
    skills: input.skills ?? existing?.skills ?? [],
    after: input.after !== undefined ? input.after.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n !== id) : (existing?.after ?? []),
    parent: input.parent !== undefined ? (Number(input.parent) > 0 && Number(input.parent) !== id ? Number(input.parent) : undefined) : existing?.parent,
    owner: input.owner !== undefined ? (String(input.owner).trim() || undefined) : existing?.owner,
    scope: input.scope !== undefined ? input.scope.map((x) => String(x).trim()).filter(Boolean) : (existing?.scope ?? []),
    verify: input.verify !== undefined ? (String(input.verify).trim() || undefined) : existing?.verify,
    body: input.body ?? existing?.body ?? '',
  }
  // 标题变了就把文件名跟着改，看板目录在文件管理器里才好认
  const name = `${card.id}-${slug(card.title)}.md`
  const oldPath = existing ? join(dir, existing.file) : null
  await writeFile(join(dir, name), stringify(card), 'utf8')
  if (oldPath && oldPath !== join(dir, name)) await rm(oldPath, { force: true })
  return toCard(name, stringify(card))
}

/** 追加一行进展（带日期），并顺手改状态。 */
export async function addProgress(cwd, id, note, state) {
  const board = await loadBoard(cwd)
  const card = board.cards.find((c) => c.id === Number(id))
  if (!card) throw new Error(`看板里没有第 ${id} 号卡`)
  const line = `- ${new Date().toISOString().slice(0, 10)} ${state ? `[${stateZh(state)}] ` : ''}${String(note ?? '').trim()}`
  const body = card.body.replace(/\s+$/, '') + (card.body.trim() ? '\n' : '') + line + '\n'
  return saveCard(cwd, { ...card, body, state: state ?? card.state })
}

/**
 * 下一步推荐。纯规则，不调模型：卡的类型和状态决定该用哪个技能，
 * 人一眼能看出为什么，改规则也只改这张表。
 */
export function recommend(card, cards = []) {
  if (!card) return null
  if (card.state === 'done' || card.state === 'dropped') return null
  if (card.kind === 'map') return null
  // 前置没做完就改它，等于把顺序搞乱——不推荐，先做前置
  if (blockersOf(card, cards).length) return null
  if (card.kind === 'bug') {
    return card.state === 'doing'
      ? { skill: 'correct', why: '这个 bug 修完了：把它变成一条以后不会再犯的规则' }
      : { skill: 'tdd', why: '先写一个会失败的测试，再改代码' }
  }
  // 中文一个字信息量约等于两个字母，按这个折算才不会被「标题只有七个字」骗过去
  const weight = [...String(card.title)].reduce((n, ch) => n + (/[\u4e00-\u9fa5]/.test(ch) ? 2 : 1), 0)
  const vague = weight < 12 && !String(card.body ?? '').trim()
  if (vague) return { skill: 'sharpen', why: '这张卡还太粗：先把要解决的事说具体' }
  if (card.kind === 'idea') {
    const big = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped').length >= 3
    return big
      ? { skill: 'figure-it-out', why: '手上开着的卡已经不少了：先设计一条能审的路线再动手' }
      : { skill: 'figure-it-out', why: '想法落地前先设计一条能审的路线' }
  }
  return card.state === 'doing'
    ? { skill: 'prove-it-works', why: '在做：先证明它能跑，再谈完成' }
    : { skill: 'architect', why: '开工前先画类型和模块边界' }
}

/** 看板的下一步：第一条在做，否则第一条待办/想法。 */
export function nextOf(cards) {
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped')
  const pick = open.find((c) => c.state === 'doing') ?? open.find((c) => c.state === 'todo') ?? open[0]
  if (!pick) return null
  return { card: pick, ...recommend(pick, cards) }
}

/**
 * 卡片之间的关系图：谁跟着谁、走到哪了、哪条断了。
 * 拓扑按「最长前置链」分深度，同一层按卡号排——不引布局库，够用就行。
 */
export function graph(cards) {
  // 地图是上下文不是活：拓扑图里不画它，否则每条线都从它长出来
  cards = cards.filter((c) => c.kind !== 'map')
  const byId = new Map(cards.map((c) => [c.id, c]))
  const edges = []
  for (const c of cards) {
    for (const a of c.after ?? []) if (byId.has(a)) edges.push({ from: a, to: c.id })
  }
  const depth = new Map()
  const depthOf = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id)
    if (seen.has(id)) return 0 // 有环也画得出来，不让它死循环
    seen.add(id)
    const parents = (byId.get(id)?.after ?? []).filter((a) => byId.has(a))
    const d = parents.length ? Math.max(...parents.map((p) => depthOf(p, seen))) + 1 : 0
    depth.set(id, d)
    return d
  }
  const nodes = cards.map((c) => ({ id: c.id, title: c.title, kind: c.kind, state: c.state, depth: depthOf(c.id) }))
  nodes.sort((a, b) => a.depth - b.depth || a.id - b.id)

  // 每条线 = 一张没有未完成前置的卡，顺着后继走到头
  const succ = new Map()
  for (const e of edges) succ.set(e.from, [...(succ.get(e.from) ?? []), e.to])
  const open = cards.filter((c) => c.state !== 'done' && c.state !== 'dropped')
  const openIds = new Set(open.map((c) => c.id))
  const heads = open.filter((c) => !(c.after ?? []).some((a) => openIds.has(a)))
  const lines = heads.map((h) => {
    const chain = [h.id]
    let cur = h.id
    for (let i = 0; i < 20; i++) {
      const next = (succ.get(cur) ?? []).find((n) => openIds.has(n) && !chain.includes(n))
      if (next === undefined) break
      chain.push(next)
      cur = next
    }
    return chain
  })
  return { nodes, edges, lines, depthMax: Math.max(0, ...nodes.map((n) => n.depth)) }
}

// ── 并行管控 ────────────────────────────────────────────────────────────────
//
// 多任务并行只有一个问题：谁在动哪块。这里的四条规矩对应四种打架方式：
//   1. after（前置没做完就别开工）—— 顺序打架
//   2. owner（一张卡只有一个认领人/会话）—— 两个人抢同一张卡
//   3. scope（这张卡允许动的路径）—— 两个人同时改同一个文件
//   4. frontier（可开工 = 没做完 + 前置齐 + 没人认领）—— 面板只推这些
//
// ponytail: scope 用路径前缀比对，不是真正的代码级依赖分析。够挡住 90% 的
// 手滑；等真出现「改了同目录不同文件也打架」再上 AST。

/** 没做完、也没被放弃。 */
export function isOpen(card) {
  return card.state !== 'done' && card.state !== 'dropped'
}

/** 还在挡着这张卡的前置（做完的、不存在的都不算）。 */
export function blockersOf(card, cards) {
  const byId = new Map(cards.map((c) => [c.id, c]))
  return (card.after ?? []).filter((id) => byId.has(id) && isOpen(byId.get(id)))
}

/** 可现在开工的卡：没做完、前置齐、没人认领，地图本身不算活。 */
export function frontierOf(cards) {
  return cards.filter((c) => isOpen(c) && c.kind !== 'map' && !c.owner && blockersOf(c, cards).length === 0)
}

const norm = (p) => String(p).replace(/^\.\//, '').replace(/\/+$/, '')
const covers = (a, b) => {
  const x = norm(a)
  const y = norm(b)
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/')
}

/** 正在做的卡里，谁的 scope 撞了；没写 scope 的另列出来当提醒。 */
export function conflictsOf(cards) {
  const doing = cards.filter((c) => isOpen(c) && c.state === 'doing')
  const pairs = []
  for (let i = 0; i < doing.length; i++) {
    for (let j = i + 1; j < doing.length; j++) {
      const a = doing[i]
      const b = doing[j]
      if (a.owner && b.owner && a.owner === b.owner) continue // 同一个会话自己排，不算打架
      const hit = []
      for (const sa of a.scope ?? []) for (const sb of b.scope ?? []) if (covers(sa, sb)) hit.push(norm(sa) === norm(sb) ? norm(sa) : `${norm(sa)} ↔ ${norm(sb)}`)
      if (hit.length) pairs.push({ a: a.id, b: b.id, paths: [...new Set(hit)] })
    }
  }
  const unscoped = doing.filter((c) => !(c.scope ?? []).length).map((c) => c.id)
  return { pairs, unscoped }
}

/** 地图卡：一块板最多一张，挂着这次要去哪、已经定了什么、还有什么糊着。 */
export function mapOf(cards) {
  return cards.find((c) => c.kind === 'map' && isOpen(c)) ?? cards.find((c) => c.kind === 'map') ?? null
}

export const MAP_SECTIONS = [
  { key: 'destination', label: '去向' },
  { key: 'decisions', label: '已经定了' },
  { key: 'fog', label: '还没想清' },
  { key: 'out', label: '不做什么' },
]

/** 把地图正文按小标题切开。缺哪段就是空串，不编。 */
export function mapSections(card) {
  const out = {}
  // 一行行扫，比一条正则好读：碰到「## 标题」就换段，认得的标题才收
  let cur = null
  for (const line of String(card?.body ?? '').split('\n')) {
    const h = line.match(/^##+\s*(.+?)\s*$/)
    if (h) {
      const hit = MAP_SECTIONS.find((s) => s.label === h[1])
      cur = hit ? hit.key : null
      if (cur) out[cur] = out[cur] ?? []
      continue
    }
    if (cur) out[cur].push(line)
  }
  for (const { key } of MAP_SECTIONS) out[key] = (out[key] ?? []).join('\n').trim()
  return out
}

/** 地图下面挂着的卡。 */
export function childrenOf(cards, id) {
  return cards.filter((c) => c.parent === Number(id))
}
