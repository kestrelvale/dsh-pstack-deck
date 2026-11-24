// dsh-pstack-deck · 在办账本
//
// 看板文件归人，这里只记「谁在做哪张卡」：每个工作区一份 JSON，卡状态一变写一条，
// 跨会话就能看见。账本不碰 .pstack/board/，删掉它只丢在办记录，不影响看板。
//
// 「读失败」和「确实没有」必须分开：文件不在 → missing:true（空账本，可重建）；
// 文件在但 JSON 坏了或不是这个形状 → 抛 parse，调用方据此提示删掉重建。

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { failAs } from './errors.js'
import { mtimeOf, rewriteText, writeNew } from './write.js'

const VERSION = 1
/** 同一 (sessionId, cardId) 只留最新一条，总额上限 500 条。 */
const MAX_ENTRIES = 500
/** 文件超过 200KB 就从最旧的裁。 */
const MAX_BYTES = 200 * 1024
const DAY = 24 * 3600e3

const badLedger = () =>
  failAs(
    'parse',
    '在办账本读不出来：文件不是合法 JSON，或者不是在办账本形状',
    '删掉这个文件会重建（只是丢在办记录，不影响看板）',
  )

/** 目录覆盖：dir 参数优先，其次环境变量，最后 ~/.dsh/pstack/work-path。 */
function dirOf(dir) {
  if (dir) return dir
  if (process.env.PSP_WORK_PATH_DIR) return process.env.PSP_WORK_PATH_DIR
  return join(homedir(), '.dsh', 'pstack', 'work-path')
}

/** 一个工作区一个文件，命名取 root 哈希前 8 位。 */
export async function reportPath(root, { dir } = {}) {
  const hash = createHash('sha256').update(String(root)).digest('hex').slice(0, 8)
  return join(dirOf(dir), `${hash}.json`)
}

/** 形状校验：只认 version 1 + root + entries 里的五字段。 */
function parseLedger(text, path) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw badLedger()
  }
  const entryOk = (e) =>
    e !== null &&
    typeof e === 'object' &&
    typeof e.sessionId === 'string' &&
    // 卡号写在票面是数字，进账本统一成字符串：老账本里可能是数字，读的时候也认
    (typeof e.cardId === 'string' || (Number.isInteger(e.cardId) && e.cardId > 0)) &&
    typeof e.title === 'string' &&
    typeof e.state === 'string' &&
    Number.isFinite(e.at)
  if (
    data === null ||
    typeof data !== 'object' ||
    data.version !== VERSION ||
    typeof data.root !== 'string' ||
    !Array.isArray(data.entries) ||
    !data.entries.every(entryOk)
  ) {
    throw badLedger()
  }
  return data
}

/** 去掉 at 最旧的 n 条，其余保持原顺序。 */
function dropOldest(list, n) {
  const victims = new Set(
    list
      .map((e, i) => ({ i, at: e.at }))
      .sort((a, b) => a.at - b.at || a.i - b.i)
      .slice(0, n)
      .map((x) => x.i),
  )
  return list.filter((_, i) => !victims.has(i))
}

/** 文件全文：先按 500 条裁，再按 200KB 裁，裁完仍是合法 JSON。 */
function pack(root, entries) {
  let list = entries.map(({ sessionId, cardId, title, state, at }) => ({
    sessionId,
    cardId,
    title,
    state,
    at,
  }))
  if (list.length > MAX_ENTRIES) list = dropOldest(list, list.length - MAX_ENTRIES)
  let text = JSON.stringify({ version: VERSION, root, entries: list })
  while (Buffer.byteLength(text, 'utf8') > MAX_BYTES && list.length > 1) {
    list = dropOldest(list, 1)
    text = JSON.stringify({ version: VERSION, root, entries: list })
  }
  return text
}

/**
 * 记一条在办：同一 (sessionId, cardId) 原地替换并刷新 at；
 * state 和 title 都没变就整篇不写（rewriteText 的 noop 保证不变脏）。
 */
export async function noteReport({ root, sessionId, cardId, title = '', state, at = Date.now(), dir } = {}) {
  const path = await reportPath(root, { dir })
  const entry = { sessionId: String(sessionId), cardId: String(cardId), title: String(title), state: String(state), at }
  const apply = (before) => {
    const data = before === null ? { version: VERSION, root, entries: [] } : parseLedger(before, path)
    const entries = data.entries
    const i = entries.findIndex((e) => e.sessionId === entry.sessionId && e.cardId === entry.cardId)
    if (i >= 0) {
      if (entries[i].state === entry.state && entries[i].title === entry.title) return before
      entries[i] = entry
    } else {
      entries.push(entry)
    }
    return pack(root, entries)
  }

  await mkdir(dirname(path), { recursive: true })
  if ((await mtimeOf(path)) === null) {
    try {
      await writeNew(path, apply(null), { cap: MAX_BYTES })
      return { path, written: true }
    } catch (e) {
      // 并发里另一个会话抢建了这份：退回到 rewriteText，在它那份上合并，别丢记录
      if (e?.kind !== 'conflict') throw e
    }
  }
  const r = await rewriteText(path, apply, { cap: MAX_BYTES })
  return { path, written: r.written }
}

/**
 * 读在办：按 at 倒序，带 age/stale；早于 archiveMs 的直接不返回但留在盘上，
 * scanned 是盘上原条目数。文件不在不算失败，返回 missing:true。
 */
export async function readWorkPath(root, { windowMs = DAY, archiveMs = 7 * DAY, now = Date.now(), dir } = {}) {
  const path = await reportPath(root, { dir })
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if (e?.code === 'ENOENT') {
      return { root, path, entries: [], missing: true, fresh: 0, archived: 0, scanned: 0 }
    }
    throw e
  }
  const data = parseLedger(text, path)
  const scanCut = now - windowMs
  const floor = now - archiveMs
  const scanned = data.entries.length
  const entries = data.entries
    .filter((e) => e.at >= floor)
    .map((e) => ({ ...e, cardId: String(e.cardId), age: now - e.at, stale: e.at < scanCut }))
    .sort((a, b) => b.at - a.at)
  const fresh = entries.filter((e) => !e.stale).length
  const archived = entries.length - fresh
  return { root, path, entries, missing: false, fresh, archived, scanned }
}