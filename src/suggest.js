// dsh-pstack-deck · 建议层（按 Jev / System One 的三层决策组织）
//
// Jev 的三种问题就是三层决策，这里是照搬结构、不假装是模型：
//   1. noul  —— 判真假：有卡吗？够清楚吗？要不要交给人？
//   2. choice—— 选一个：从这个项目的卡里挑一条，选一个技能
//   3. score —— 打分：给每条建议一个紧急度，决定谁排前面
// confidence 是第二根轴：分数说「做哪条」，把握说「这条要不要先问人」。
//
// ponytail: 这里的数字是手写规则，不是 Jev 的校准概率。它们只用来排序和标注，
// 不参与任何自动执行；要真校准得接 Jev 的 score 原语，那时把这个文件换成一次模型调用。

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { blockersOf, graph, isOpen, loadBoard, recommend } from './board.js'

const MAX_ITEMS = 5
const MIN_ITEMS = 3
const CONFIDENT = 0.5 // 低于它就别自作主张：先去问清

// ---------------------------------------------------------------- noul 层

/** 这张卡的标题/正文够不够清楚——不清楚就先别选技能，先让它变具体。 */
function noulClear(card) {
  const title = String(card.title ?? '')
  const weight = [...title].reduce((n, ch) => n + (/[\u4e00-\u9fa5]/.test(ch) ? 2 : 1), 0)
  if (weight < 12) return 0.35
  if (!String(card.body ?? '').trim()) return 0.6
  return 0.9
}

/** 这张卡是不是「已经说清了、只差动手」。 */
function noulActionable(card) {
  return noulClear(card) >= CONFIDENT
}

// -------------------------------------------------------------- score 层

// Jev 的原话是「每个问题只问一件事，组合在代码里」：下面每条 noul 只判一个事实，
// 权重全在 COEF 里——想改优先级就改系数，不用碰任何提示词。
export const COEF = {
  state: 0.45, // 推进到哪一步
  kind: 0.25, // 缺陷比想法急
  progress: 0.15, // 推了几轮还没完 → 卡住了
  fresh: 0.15, // 最近动过
}

const STATE_W = { doing: 1, todo: 0.6, idea: 0.3 }
const KIND_W = { bug: 1, task: 0.25, idea: 0 }
const FRESH_MS = 7 * 24 * 3600 * 1000

/** 一组只判真假的原子问题，值统一是 0~1。 */
function noulFactors(card, now = Date.now()) {
  const updated = Date.parse(card.updated || 0) || 0
  return {
    state: STATE_W[card.state] ?? 0.2,
    kind: KIND_W[card.kind] ?? 0,
    progress: Math.min((card.progress || 0) / 3, 1),
    fresh: updated && now - updated < FRESH_MS ? 1 : 0,
  }
}

/** 把原子问题按 COEF 组合成 0~1 的紧急度（规则打分，不是校准概率）。 */
function scoreUrgency(card, now) {
  const f = noulFactors(card, now)
  const sum = Object.entries(COEF).reduce((n, [k, w]) => n + w * (f[k] ?? 0), 0)
  return Math.round(sum * 100) / 100
}

// ------------------------------------------------------------- choice 层

/** 一张卡 → 一件具体能做的事：技能 + 为什么 + 提示词（已经写好，点一下就发）。 */
function choiceOf(card, cards, project) {
  const certainty = noulClear(card)
  const urgency = scoreUrgency(card)
  // 每条建议都自报家底：分数说「做哪条」，把握说「这条要不要先问人」
  const scope = project ? `${card.title}（项目：${project}）` : card.title

  if (!noulActionable(card)) {
    return {
      id: `${project || ''}#${card.id}`,
      cardId: card.id,
      project: project || '',
      title: card.title,
      kind: card.kind,
      state: card.state,
      skill: 'in-your-own-words',
      why: '这张卡还不够清楚，先把它说具体再动手',
      urgency,
      certainty,
      factors: noulFactors(card),
      ask: true,
      // 命令里带卡号：粘贴回去执行时，agent 知道说的是哪张卡
      prompt: `/in-your-own-words #${card.id} ${scope}：我想解决的是`,
    }
  }

  const next = recommend(card, cards)
  if (!next) return null
  return {
    id: `${project || ''}#${card.id}`,
    cardId: card.id,
    project: project || '',
    title: card.title,
    kind: card.kind,
    state: card.state,
    skill: next.skill,
    why: next.why,
    urgency,
    certainty,
    factors: noulFactors(card),
    ask: false,
    prompt: `/${next.skill} #${card.id} ${scope}`,
  }
}

// ------------------------------------------------------------------ 层选择

/** 最近动过的项目目录，跳过隐藏目录。 */
async function recentProjects(root, limit = 12) {
  let names = []
  try {
    names = (await readdir(root)).filter((n) => !n.startsWith('.'))
  } catch {
    return []
  }
  const rows = []
  for (const n of names) {
    const dir = join(root, n)
    try {
      const st = await stat(dir)
      if (st.isDirectory()) rows.push({ dir, name: n, at: st.mtimeMs })
    } catch {
      /* 读不到就当没有 */
    }
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit)
}

// 只推「现在真能开工」的卡：前置没做完的、别人已经认领的，都不该被推给你，
// 否则两个会话会一起扑到同一张卡上——这正是并行任务互相干扰的来源。
const openCards = (cards) => cards.filter((c) => isOpen(c) && c.kind !== 'map' && !c.owner && blockersOf(c, cards).length === 0)

/** 连卡都没有时也得给三条能直接发的开场。 */
const SEEDS = [
  { skill: 'in-your-own-words', title: '先用一句话说清你要做成什么', why: '目标没说清，后面每一步都在猜', urgency: 0.5, certainty: 0.5, ask: true, prompt: '/in-your-own-words 我要做的这件事是：' },
  { skill: 'figure-it-out', title: '把这件事拆成一条能审的路线', why: '大改动直接动手会锁死错的形状', urgency: 0.4, certainty: 0.7, ask: false, prompt: '/figure-it-out 先给这件事设计一条我能审的路线：' },
  { skill: 'poteto-help', title: '不知道从哪下手就先问该用哪个技能', why: '58 个技能里挑一个，比空想快', urgency: 0.3, certainty: 0.7, ask: false, prompt: '/poteto-help 我现在想做的是：' },
]

/**
 * 三层决策入口。
 * @param {{ cwd?: string, roots?: string[] }} opts
 * @returns {Promise<{layer:'project'|'global'|'seed', items:object[], scanned:number}>}
 */
export async function suggest({ cwd, roots = [join(homedir(), 'projects')] } = {}) {
  // 项目层：这个会话所在的项目自己就有开着的卡
  if (cwd) {
    const board = await loadBoard(cwd)
    const items = openCards(board.cards)
      .map((c) => choiceOf(c, board.cards, ''))
      .filter(Boolean)
      .sort((a, b) => b.urgency - a.urgency || b.certainty - a.certainty)
      .slice(0, MAX_ITEMS)
    if (items.length) {
      // 有分支时先给一条「整条线怎么走」：项目级的决策，不是单张卡的动作
      const dir = directionOf(board, '')
      return { layer: 'project', direction: dir, items: pad(dir ? [dir, ...items].slice(0, MAX_ITEMS) : items), scanned: 1 }
    }
  }

  // 全局层：这个项目还没卡，就把别的项目开着的卡拎过来
  const found = []
  for (const root of roots) {
    for (const proj of await recentProjects(root)) {
      if (proj.dir === cwd) continue
      const board = await loadBoard(proj.dir)
      const open = openCards(board.cards)
      if (!open.length) continue
      const card = open.find((c) => c.state === 'doing') ?? open.find((c) => c.state === 'todo') ?? open[0]
      const item = choiceOf(card, board.cards, proj.name)
      if (item) found.push(item)
      if (found.length >= MAX_ITEMS) break
    }
  }
  if (found.length) {
    return { layer: 'global', items: pad(found.sort((a, b) => b.urgency - a.urgency)), scanned: found.length }
  }

  // 开场层：哪儿都没卡
  return { layer: 'seed', items: SEEDS.slice(0, MIN_ITEMS), scanned: 0 }
}

/**
 * 项目级决策：把开着的卡按依赖串成几条线，挑最该往下走的那条。
 * 单张卡的动作解决不了「这个项目下一步往哪走」——那要一条线。
 */
export function directionOf(board, project) {
  const g = graph(board.cards)
  const byId = new Map(board.cards.map((c) => [c.id, c]))
  const lines = g.lines
    .map((chain) => ({ chain, head: byId.get(chain[0]), urgency: scoreUrgency(byId.get(chain[0]) ?? {}) }))
    .filter((l) => l.head)
    .sort((a, b) => b.chain.length - a.chain.length || b.urgency - a.urgency)
  const top = lines[0]
  if (!top) return null
  const next = recommend(top.head, board.cards)
  if (!next) return null
  const path = top.chain.map((id) => byId.get(id)?.title).filter(Boolean)
  const head = top.head
  const scope = project ? `${head.title}（项目：${project}）` : head.title
  return {
    id: `${project || ''}line`,
    kind: 'direction',
    cardId: head.id,
    state: head.state,
    factors: noulFactors(head),
    project: project || '',
    title: top.chain.length > 1 ? '这条线先往下走：' + path.join(' → ') : '先走这条：' + head.title,
    why: top.chain.length > 1
      ? `这个项目有 ${top.chain.length} 张卡连成一条线，先把这条线的头走完`
      : '这是眼下最急的一条',
    skill: next.skill,
    chain: top.chain,
    chainIds: top.chain,
    urgency: top.urgency,
    certainty: noulClear(head),
    ask: false,
    prompt: `/${next.skill} #${head.id} ${scope}`,
  }
}

/** 不够三条就补开场建议——一条孤零零的建议比没有更让人发愣。 */
function pad(items) {
  if (items.length >= MIN_ITEMS) return items.slice(0, MAX_ITEMS)
  const have = new Set(items.map((i) => i.skill))
  for (const seed of SEEDS) {
    if (items.length >= MIN_ITEMS) break
    if (have.has(seed.skill)) continue
    items.push(seed)
  }
  return items.slice(0, MAX_ITEMS)
}
